//! 连接手机: a phone uses this Mac's local AI over a direct WebRTC data channel
//! on the local network. No server on the internet is involved, and Ollama
//! itself stays on 127.0.0.1: a paired phone can only make the requests that
//! `validate_chat_request` allows.
//!
//! The phone writes the Mac's side of the WebRTC session itself (from the QR
//! code: addresses, port, certificate fingerprint), so no signalling server is
//! needed. The Mac is ICE-lite; the phone picks the Mac's ICE username as
//! "oofr+v1/" + its own ICE password, which is how the Mac learns that password
//! from the first connectivity check. The phone pins the Mac's certificate; the
//! Mac recognises the phone by the key it received when it was paired.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use str0m::change::SdpOffer;
use str0m::channel::ChannelId;
use str0m::config::DtlsCert;
use str0m::ice::IceCreds;
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

pub const UFRAG_PREFIX: &str = "oofr+v1/";
const PREFERRED_PORT: u16 = 47800;
const MAX_SESSIONS: usize = 8;
const PAIRING_CODE_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_MESSAGE_BYTES: usize = 256 * 1024;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    /// SHA-256 of the key the phone holds; the key itself is never stored here.
    key_hash: String,
    pub paired_at: u64,
    pub last_seen: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    port: u16,
    devices: Vec<Device>,
}

struct Pending {
    code: String,
    expires: Instant,
}

#[derive(Default)]
pub struct PairState {
    running: Mutex<Option<Running>>,
    pending: Arc<Mutex<Vec<Pending>>>,
}

struct Running {
    port: u16,
    fingerprint: String,
    stop: Arc<AtomicBool>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_secs()).unwrap_or(0)
}

pub fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut buffer))
        .expect("system random source");
    hex(&buffer)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_hex(text: &str) -> String {
    hex(&Sha256::digest(text.as_bytes()))
}

fn store_path(name: &str) -> Result<PathBuf, String> {
    Ok(crate::support_dir()?.join(name))
}

fn load_saved() -> Saved {
    store_path("pair-devices.json")
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save(saved: &Saved) -> Result<(), String> {
    let path = store_path("pair-devices.json")?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(saved).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

/// The Mac's certificate, kept across launches so a paired phone keeps trusting it.
fn certificate() -> Result<DtlsCert, String> {
    let cert_path = store_path("pair-cert.der")?;
    let key_path = store_path("pair-key.der")?;
    if let (Ok(certificate), Ok(private_key)) = (fs::read(&cert_path), fs::read(&key_path)) {
        if !certificate.is_empty() && !private_key.is_empty() {
            return Ok(DtlsCert { certificate, private_key });
        }
    }
    let cert = str0m::crypto::from_feature_flags()
        .dtls_provider
        .generate_certificate()
        .ok_or("无法生成连接证书")?;
    fs::write(&key_path, &cert.private_key).map_err(|error| error.to_string())?;
    fs::write(&cert_path, &cert.certificate).map_err(|error| error.to_string())?;
    Ok(cert)
}

pub fn fingerprint(cert: &DtlsCert) -> String {
    Sha256::digest(&cert.certificate).iter().map(|byte| format!("{byte:02X}")).collect::<Vec<_>>().join(":")
}

/// IPv4 addresses on active interfaces (Wi-Fi, Ethernet, a phone's hotspot).
fn local_addresses() -> Vec<String> {
    let output = Command::new("/sbin/ifconfig").output().map(|output| String::from_utf8_lossy(&output.stdout).to_string()).unwrap_or_default();
    output
        .lines()
        .filter_map(|line| line.trim().strip_prefix("inet "))
        .filter_map(|rest| rest.split_whitespace().next())
        .filter(|address| !address.starts_with("127.") && !address.starts_with("169.254."))
        .map(str::to_string)
        .collect()
}

/// "MacBook-Air.local": lets the phone find the Mac again when its address changes.
fn local_host_name() -> String {
    Command::new("/usr/sbin/scutil")
        .args(["--get", "LocalHostName"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|name| !name.is_empty())
        .map(|name| format!("{name}.local"))
        .unwrap_or_default()
}

/// The local address the Mac answers a phone from (the interface routing to it).
fn local_address_for(peer: SocketAddr, port: u16) -> Option<SocketAddr> {
    let probe = UdpSocket::bind(if peer.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }).ok()?;
    probe.connect(peer).ok()?;
    Some(SocketAddr::new(probe.local_addr().ok()?.ip(), port))
}

/// USERNAME of a STUN binding request, or None for anything else.
pub fn stun_username(buf: &[u8]) -> Option<String> {
    if buf.len() < 20 || u16::from_be_bytes([buf[0], buf[1]]) != 0x0001 || buf[4..8] != [0x21, 0x12, 0xA4, 0x42] {
        return None;
    }
    let mut at = 20;
    while at + 4 <= buf.len() {
        let kind = u16::from_be_bytes([buf[at], buf[at + 1]]);
        let len = u16::from_be_bytes([buf[at + 2], buf[at + 3]]) as usize;
        if at + 4 + len > buf.len() {
            return None;
        }
        if kind == 0x0006 {
            return String::from_utf8(buf[at + 4..at + 4 + len].to_vec()).ok();
        }
        at += 4 + ((len + 3) & !3);
    }
    None
}

fn ice_chars(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
}

/// The phone's offer as the Mac infers it from the first connectivity check.
pub fn inferred_offer(username: &str, peer: IpAddr) -> Option<(String, String)> {
    let (server_ufrag, client_ufrag) = username.split_once(':')?;
    let client_pwd = server_ufrag.strip_prefix(UFRAG_PREFIX)?;
    if !ice_chars(client_ufrag) || client_pwd.len() < 22 || !ice_chars(client_pwd) {
        return None;
    }
    let family = if peer.is_ipv4() { "IP4" } else { "IP6" };
    // The phone's certificate is not known here; it proves itself with its key instead.
    let placeholder = vec!["00"; 32].join(":");
    let sdp = format!(
        "v=0\r\no=- 1 1 IN {family} {peer}\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n\
         c=IN {family} {peer}\r\na=mid:0\r\na=ice-ufrag:{client_ufrag}\r\na=ice-pwd:{client_pwd}\r\na=fingerprint:sha-256 {placeholder}\r\n\
         a=setup:actpass\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    );
    Some((server_ufrag.to_string(), sdp))
}

struct Session {
    rtc: Rtc,
    // The Mac's address on the interface this phone reached it through.
    local: SocketAddr,
    channel: Option<ChannelId>,
    device: Option<String>,
}

/// What a session asked for, answered later from the async runtime.
struct Reply {
    peer: SocketAddr,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairInfo {
    /// Base64url JSON for the QR code: addresses, host name, port, fingerprint, one-time code.
    payload: String,
    devices: Vec<Device>,
    port: u16,
}

fn base64url(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for index in 0..=chunk.len() {
            out.push(TABLE[(n >> (18 - 6 * index) & 63) as usize] as char);
        }
    }
    out
}

impl PairState {
    /// Starts listening (if not yet) and returns a fresh one-time pairing code.
    pub fn info(&self, client: reqwest::Client) -> Result<PairInfo, String> {
        let (port, fingerprint) = self.ensure_running(client)?;
        let code = random_hex(12);
        {
            let mut pending = self.pending.lock().map_err(|_| "配对状态不可用")?;
            pending.retain(|item| item.expires > Instant::now());
            pending.push(Pending { code: code.clone(), expires: Instant::now() + PAIRING_CODE_TTL });
        }
        let payload = json!({
            "v": 1,
            "ips": local_addresses(),
            "host": local_host_name(),
            "port": port,
            "fp": fingerprint,
            "code": code,
        });
        Ok(PairInfo { payload: base64url(payload.to_string().as_bytes()), devices: load_saved().devices, port })
    }

    pub fn devices(&self) -> Vec<Device> {
        load_saved().devices
    }

    pub fn forget(&self, id: &str) -> Result<Vec<Device>, String> {
        let mut saved = load_saved();
        saved.devices.retain(|device| device.id != id);
        save(&saved)?;
        Ok(saved.devices)
    }

    /// Listens only when a phone has been paired or a QR code is shown.
    pub fn start_if_paired(&self, client: reqwest::Client) {
        if !load_saved().devices.is_empty() {
            if let Err(error) = self.ensure_running(client) {
                eprintln!("OoFR pairing listener: {error}");
            }
        }
    }

    fn ensure_running(&self, client: reqwest::Client) -> Result<(u16, String), String> {
        let mut running = self.running.lock().map_err(|_| "配对状态不可用")?;
        if let Some(current) = running.as_ref() {
            return Ok((current.port, current.fingerprint.clone()));
        }
        let cert = certificate()?;
        let fingerprint = fingerprint(&cert);
        let mut saved = load_saved();
        // The port used before (a paired phone remembers it), else the usual one, else any free port.
        let socket = [saved.port, PREFERRED_PORT, 0]
            .into_iter()
            .filter(|port| *port != 0)
            .find_map(|port| UdpSocket::bind(("0.0.0.0", port)).ok())
            .or_else(|| UdpSocket::bind(("0.0.0.0", 0)).ok())
            .ok_or("无法打开连接端口")?;
        let port = socket.local_addr().map_err(|error| error.to_string())?.port();
        if saved.port != port {
            saved.port = port;
            save(&saved)?;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let pending = self.pending.clone();
        let flag = stop.clone();
        std::thread::Builder::new()
            .name("oofr-pair".into())
            .spawn(move || serve(socket, port, cert, pending, flag, client))
            .map_err(|error| error.to_string())?;
        *running = Some(Running { port, fingerprint: fingerprint.clone(), stop });
        Ok((port, fingerprint))
    }
}

fn serve(socket: UdpSocket, port: u16, cert: DtlsCert, pending: Arc<Mutex<Vec<Pending>>>, stop: Arc<AtomicBool>, client: reqwest::Client) {
    let _ = socket.set_read_timeout(Some(Duration::from_millis(20)));
    let mut sessions: HashMap<SocketAddr, Session> = HashMap::new();
    let (reply_to, replies): (Sender<Reply>, Receiver<Reply>) = channel();
    let mut buf = vec![0u8; 2048];
    while !stop.load(Ordering::SeqCst) {
        if let Ok((size, peer)) = socket.recv_from(&mut buf) {
            let data = &buf[..size];
            if !sessions.contains_key(&peer) && sessions.len() < MAX_SESSIONS {
                if let Some(session) = new_session(data, peer, port, &cert) {
                    sessions.insert(peer, session);
                }
            }
            if let Some(session) = sessions.get_mut(&peer) {
                if let Ok(contents) = data.try_into() {
                    let destination = session.local;
                    let _ = session.rtc.handle_input(Input::Receive(Instant::now(), Receive { proto: Protocol::Udp, source: peer, destination, contents }));
                }
            }
        }
        while let Ok(reply) = replies.try_recv() {
            if let Some(session) = sessions.get_mut(&reply.peer) {
                send(session, &reply.message);
            }
        }
        let mut closed = Vec::new();
        for (peer, session) in sessions.iter_mut() {
            if session.rtc.handle_input(Input::Timeout(Instant::now())).is_err() {
                closed.push(*peer);
                continue;
            }
            loop {
                match session.rtc.poll_output() {
                    Ok(Output::Transmit(transmit)) => {
                        let _ = socket.send_to(&transmit.contents, transmit.destination);
                    }
                    Ok(Output::Timeout(_)) => break,
                    Ok(Output::Event(Event::IceConnectionStateChange(IceConnectionState::Disconnected))) => {
                        closed.push(*peer);
                        break;
                    }
                    Ok(Output::Event(Event::ChannelOpen(id, _))) => session.channel = Some(id),
                    Ok(Output::Event(Event::ChannelData(data))) => {
                        // Data can arrive before the channel-open event; answer on the channel it came on.
                        session.channel.get_or_insert(data.id);
                        if data.data.len() > MAX_MESSAGE_BYTES {
                            closed.push(*peer);
                            break;
                        }
                        let text = String::from_utf8_lossy(&data.data).to_string();
                        if !handle(session, *peer, &text, &pending, &reply_to, &client) {
                            closed.push(*peer);
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(_) => {
                        closed.push(*peer);
                        break;
                    }
                }
            }
        }
        for peer in closed {
            sessions.remove(&peer);
        }
    }
}

fn new_session(data: &[u8], peer: SocketAddr, port: u16, cert: &DtlsCert) -> Option<Session> {
    let username = stun_username(data)?;
    let (server_ufrag, offer) = inferred_offer(&username, peer.ip())?;
    let local = local_address_for(peer, port)?;
    let mut rtc = RtcConfig::new()
        .set_ice_lite(true)
        .set_fingerprint_verification(false)
        .set_local_ice_credentials(IceCreds { ufrag: server_ufrag.clone(), pass: server_ufrag })
        .set_dtls_cert(cert.clone())
        .build(Instant::now());
    rtc.add_local_candidate(Candidate::host(local, "udp").ok()?);
    rtc.sdp_api().accept_offer(SdpOffer::from_sdp_string(&offer).ok()?).ok()?;
    Some(Session { rtc, local, channel: None, device: None })
}

fn send(session: &mut Session, message: &str) {
    if let Some(id) = session.channel {
        if let Some(mut channel) = session.rtc.channel(id) {
            let _ = channel.write(false, message.as_bytes());
        }
    }
}

/// Handles one message; false closes the session (unknown phone, bad message).
fn handle(session: &mut Session, peer: SocketAddr, text: &str, pending: &Arc<Mutex<Vec<Pending>>>, reply_to: &Sender<Reply>, client: &reqwest::Client) -> bool {
    let Ok(message) = serde_json::from_str::<Value>(text) else { return false };
    let kind = message.get("t").and_then(Value::as_str).unwrap_or("");
    #[cfg(debug_assertions)]
    eprintln!("pair: {peer} {kind} (known: {})", session.device.is_some());
    if session.device.is_none() {
        if kind != "hello" {
            return false;
        }
        return match hello(&message, pending) {
            Some((device, key)) => {
                session.device = Some(device);
                let mut welcome = json!({ "t": "welcome", "mac": local_host_name().trim_end_matches(".local") });
                if let Some(key) = key {
                    welcome["key"] = json!(key);
                }
                send(session, &welcome.to_string());
                true
            }
            None => {
                send(session, &json!({ "t": "denied" }).to_string());
                false
            }
        };
    }
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let reply_to = reply_to.clone();
    let client = client.clone();
    match kind {
        "status" => {
            tauri::async_runtime::spawn(async move {
                let running = crate::server_version(&client).await.is_some();
                let models: Vec<Value> = if running { crate::model_list(&client).await } else { Vec::new() };
                let names: Vec<String> = models.iter().filter_map(|model| model.get("name").and_then(Value::as_str).map(str::to_string)).collect();
                let message = json!({ "t": "status", "id": id, "serverRunning": running, "models": names, "memoryBytes": crate::memory_bytes() }).to_string();
                let _ = reply_to.send(Reply { peer, message });
            });
            true
        }
        "chat" => {
            let request = message.get("request").cloned().unwrap_or(Value::Null);
            if let Err(error) = crate::validate_chat_request(&request) {
                send(session, &json!({ "t": "error", "id": id, "message": error }).to_string());
                return true;
            }
            tauri::async_runtime::spawn(async move {
                let message = match crate::forward_chat(&client, &request).await {
                    Ok(response) => json!({ "t": "result", "id": id, "response": response }),
                    Err(error) => json!({ "t": "error", "id": id, "message": error }),
                };
                let _ = reply_to.send(Reply { peer, message: message.to_string() });
            });
            true
        }
        "ping" => {
            send(session, &json!({ "t": "pong", "id": id }).to_string());
            true
        }
        _ => true,
    }
}

/// A known phone (by key), or a new one with a valid one-time code (it gets its key).
fn hello(message: &Value, pending: &Arc<Mutex<Vec<Pending>>>) -> Option<(String, Option<String>)> {
    let mut saved = load_saved();
    if let Some(key) = message.get("key").and_then(Value::as_str) {
        let hash = sha256_hex(key);
        let device = saved.devices.iter_mut().find(|device| device.key_hash == hash)?;
        device.last_seen = now_secs();
        let id = device.id.clone();
        let _ = save(&saved);
        return Some((id, None));
    }
    let code = message.get("code").and_then(Value::as_str)?;
    {
        let mut pending = pending.lock().ok()?;
        let index = pending.iter().position(|item| item.code == code && item.expires > Instant::now())?;
        pending.remove(index);
    }
    let key = random_hex(32);
    let name: String = message.get("name").and_then(Value::as_str).unwrap_or("手机").chars().take(40).collect();
    let device = Device { id: random_hex(8), name, key_hash: sha256_hex(&key), paired_at: now_secs(), last_seen: now_secs() };
    let id = device.id.clone();
    saved.devices.push(device);
    save(&saved).ok()?;
    Some((id, Some(key)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding_request(username: &str) -> Vec<u8> {
        let mut attribute = vec![0x00, 0x06];
        attribute.extend_from_slice(&(username.len() as u16).to_be_bytes());
        attribute.extend_from_slice(username.as_bytes());
        while attribute.len() % 4 != 0 {
            attribute.push(0);
        }
        let mut packet = vec![0x00, 0x01];
        packet.extend_from_slice(&(attribute.len() as u16).to_be_bytes());
        packet.extend_from_slice(&[0x21, 0x12, 0xA4, 0x42]);
        packet.extend_from_slice(&[7; 12]);
        packet.extend_from_slice(&attribute);
        packet
    }

    #[test]
    fn reads_the_username_of_a_connectivity_check() {
        let username = "oofr+v1/abcdefghijklmnopqrstuvwx:Dkhu";
        assert_eq!(stun_username(&binding_request(username)).as_deref(), Some(username));
        assert_eq!(stun_username(&[0x16, 0xfe, 0xfd]), None);
        let mut response = binding_request(username);
        response[1] = 0x01;
        response[0] = 0x01;
        assert_eq!(stun_username(&response), None);
    }

    #[test]
    fn infers_the_phone_offer_only_from_an_oofr_username() {
        let (ufrag, sdp) = inferred_offer("oofr+v1/abcdefghijklmnopqrstuvwx:Dkhu", "172.20.10.1".parse().unwrap()).unwrap();
        assert_eq!(ufrag, "oofr+v1/abcdefghijklmnopqrstuvwx");
        assert!(sdp.contains("a=ice-ufrag:Dkhu\r\n"));
        assert!(sdp.contains("a=ice-pwd:abcdefghijklmnopqrstuvwx\r\n"));
        assert!(sdp.contains("c=IN IP4 172.20.10.1"));
        for username in ["other/abcdefghijklmnopqrstuvwx:Dkhu", "oofr+v1/short:Dkhu", "oofr+v1/abcdefghijklmnopqrstuvwx:bad\r\nline", "no-colon"] {
            assert!(inferred_offer(username, "10.0.0.2".parse().unwrap()).is_none(), "{username:?}");
        }
    }

    #[test]
    fn encodes_the_qr_payload_as_base64url() {
        assert_eq!(base64url(b"hello"), "aGVsbG8");
        assert_eq!(base64url(b"\xfb\xff"), "-_8");
    }

    #[test]
    fn pairing_codes_work_once_and_phones_come_back_with_their_key() {
        let dir = std::env::temp_dir().join(format!("oofr-pair-test-{}", random_hex(4)));
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("OOFR_SUPPORT_DIR", &dir);
        let pending = Arc::new(Mutex::new(vec![Pending { code: "c0de".into(), expires: Instant::now() + PAIRING_CODE_TTL }]));
        assert!(hello(&json!({ "t": "hello", "code": "wrong" }), &pending).is_none());
        let (id, key) = hello(&json!({ "t": "hello", "code": "c0de", "name": "iPhone" }), &pending).unwrap();
        let key = key.unwrap();
        assert!(hello(&json!({ "t": "hello", "code": "c0de" }), &pending).is_none(), "a code works once");
        assert_eq!(hello(&json!({ "t": "hello", "key": key }), &pending).unwrap(), (id.clone(), None));
        assert!(hello(&json!({ "t": "hello", "key": "not-the-key" }), &pending).is_none());
        let saved = load_saved();
        assert_eq!(saved.devices.len(), 1);
        assert_ne!(saved.devices[0].key_hash, key, "only the hash is stored");
        let _ = fs::remove_dir_all(&dir);
    }
}
