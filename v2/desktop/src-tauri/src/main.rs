#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use flate2::read::GzDecoder;
use fs2::available_space;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

mod pair;

const OLLAMA_VERSION: &str = "0.34.0";
const OLLAMA_URL: &str =
    "https://github.com/ollama/ollama/releases/download/v0.34.0/ollama-darwin.tgz";
const OLLAMA_SHA256: &str = "dd12b00bcce2d6551178e67ada90d5af9f75bdb54a118b96655250fa3e8ef734";
const OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434";
/// Runtime, the standard model (6.6 GB) and room to spare.
const REQUIRED_BYTES: u64 = 10 * 1024 * 1024 * 1024;
/// The models OoFR uses (src/ai/models.ts). The webview cannot make the app
/// download or run any other model.
const ALLOWED_MODELS: [&str; 2] = ["qwen3.5:9b", "qwen3.5:4b"];
const MAX_CHAT_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Default)]
struct AiState {
    owned_child: Mutex<Option<Child>>,
    cancel_setup: AtomicBool,
    /// True while an install or model download is running (only one at a time).
    setup_busy: AtomicBool,
    client: reqwest::Client,
}

/// Marks setup as busy until dropped, so a failed or cancelled run always releases it.
struct SetupGuard<'a>(&'a AtomicBool);

impl<'a> SetupGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Result<Self, String> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| SetupGuard(flag))
            .map_err(|_| "另一个安装或下载任务正在进行，请等它结束".to_string())
    }
}

impl Drop for SetupGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn validate_model(model: &str) -> Result<(), String> {
    if ALLOWED_MODELS.contains(&model) {
        Ok(())
    } else {
        Err(format!("OoFR 只使用 {}，不能下载或运行其他模型", ALLOWED_MODELS.join(" / ")))
    }
}

/// Basic shape check for a chat request coming from the webview.
fn validate_chat_request(request: &Value) -> Result<(), String> {
    let object = request.as_object().ok_or("本地 AI 请求格式无效")?;
    let model = object.get("model").and_then(Value::as_str).unwrap_or("");
    validate_model(model)?;
    if !object.get("messages").map(Value::is_array).unwrap_or(false) {
        return Err("本地 AI 请求缺少 messages".to_string());
    }
    if request.to_string().len() > MAX_CHAT_REQUEST_BYTES {
        return Err("本地 AI 请求过大".to_string());
    }
    Ok(())
}

/// Removes a child that has already exited, and says whether one is still running.
fn child_is_running(slot: &mut Option<Child>) -> bool {
    match slot {
        Some(child) => match child.try_wait() {
            Ok(None) => true,
            _ => {
                *slot = None;
                false
            }
        },
        None => false,
    }
}

fn owned_child_running(state: &AiState) -> Result<bool, String> {
    let mut guard = state.owned_child.lock().map_err(|_| "AI 进程状态不可用".to_string())?;
    Ok(child_is_running(&mut guard))
}

fn stop_owned_child(state: &AiState) -> bool {
    if let Ok(mut guard) = state.owned_child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            return true;
        }
    }
    false
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SetupProgress {
    stage: String,
    message: String,
    completed: u64,
    total: u64,
    percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatus {
    runtime_installed: bool,
    runtime_path: Option<String>,
    runtime_source: String,
    server_running: bool,
    models: Vec<Value>,
    available_bytes: u64,
    os_version: String,
    os_supported: bool,
    arch: String,
    managed_process: bool,
    /// Installed memory, so the webview can pick a model that fits.
    memory_bytes: u64,
}

fn support_dir() -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(dir) = std::env::var_os("OOFR_SUPPORT_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let base = dirs::data_dir().ok_or_else(|| "无法定位 Application Support".to_string())?;
    let path = base.join("OoFR");
    fs::create_dir_all(&path).map_err(|error| format!("无法创建 OoFR 数据目录：{error}"))?;
    Ok(path)
}

fn private_runtime_dir() -> Result<PathBuf, String> {
    let path = support_dir()?.join("runtime");
    fs::create_dir_all(&path).map_err(|error| format!("无法创建运行时目录：{error}"))?;
    Ok(path)
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|path| path.join(name))
            .find(|path| is_executable(path))
    })
}

fn find_named_file(root: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    if depth == 0 || !root.exists() {
        return None;
    }
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|value| value.to_str()) == Some(name) {
            return Some(path);
        }
        // Hidden directories hold a half-finished extraction; never use them.
        let hidden = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.starts_with('.'))
            .unwrap_or(false);
        if path.is_dir() && !hidden {
            if let Some(found) = find_named_file(&path, name, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn find_ollama() -> Option<(PathBuf, &'static str)> {
    if let Some(path) = find_in_path("ollama") {
        return Some((path, "system"));
    }
    for path in [
        PathBuf::from("/opt/homebrew/bin/ollama"),
        PathBuf::from("/usr/local/bin/ollama"),
        PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"),
    ] {
        if is_executable(&path) {
            return Some((path, "system"));
        }
    }
    private_runtime_dir()
        .ok()
        .and_then(|root| find_named_file(&root, "ollama", 4))
        .map(|path| (path, "private"))
}

fn macos_version() -> String {
    Command::new("/usr/bin/sw_vers")
        .args(["-productVersion"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn memory_bytes() -> u64 {
    Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8_lossy(&output.stdout).trim().parse().ok())
        .unwrap_or(0)
}

fn macos_supported(version: &str) -> bool {
    version
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
        >= 14
}

async fn server_version(client: &reqwest::Client) -> Option<Value> {
    client
        .get(format!("{OLLAMA_ENDPOINT}/api/version"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()
}

async fn model_list(client: &reqwest::Client) -> Vec<Value> {
    let response = match client
        .get(format!("{OLLAMA_ENDPOINT}/api/tags"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
    {
        Ok(response) => response,
        Err(_) => return Vec::new(),
    };
    response
        .json::<Value>()
        .await
        .ok()
        .and_then(|payload| payload.get("models").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

fn emit_progress(app: &AppHandle, stage: &str, message: &str, completed: u64, total: u64) {
    let percent = if total > 0 {
        (completed as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let _ = app.emit(
        "ai-setup-progress",
        SetupProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            completed,
            total,
            percent,
        },
    );
}

#[tauri::command]
async fn ai_status(state: State<'_, AiState>) -> Result<AiStatus, String> {
    let client = state.client.clone();
    let running = server_version(&client).await.is_some();
    let models = if running {
        model_list(&client).await
    } else {
        Vec::new()
    };
    let runtime = find_ollama();
    let data_dir = support_dir()?;
    let free = available_space(&data_dir).map_err(|error| format!("无法读取磁盘空间：{error}"))?;
    let version = macos_version();
    let managed_process = owned_child_running(&state)?;
    Ok(AiStatus {
        runtime_installed: runtime.is_some(),
        runtime_path: runtime
            .as_ref()
            .map(|(path, _)| path.to_string_lossy().to_string()),
        runtime_source: runtime
            .as_ref()
            .map(|(_, source)| source.to_string())
            .unwrap_or_else(|| "missing".to_string()),
        server_running: running,
        models,
        available_bytes: free,
        os_supported: macos_supported(&version),
        os_version: version,
        arch: std::env::consts::ARCH.to_string(),
        managed_process,
        memory_bytes: memory_bytes(),
    })
}

/// Unpacks the Ollama archive into a hidden temporary directory next to the
/// final one, checks that it contains an `ollama` executable, and only then
/// moves it into place. A failed or interrupted extraction therefore never
/// leaves something that `find_ollama` could mistake for a working install.
fn extract_runtime(archive_path: &Path, root: &Path) -> Result<PathBuf, String> {
    let staging = root.join(format!(".unpack-{OLLAMA_VERSION}"));
    let final_dir = root.join(format!("ollama-{OLLAMA_VERSION}"));
    let _ = fs::remove_dir_all(&staging);
    let outcome = (|| -> Result<PathBuf, String> {
        let file = File::open(archive_path).map_err(|error| format!("无法打开 Ollama 安装包：{error}"))?;
        let mut archive = tar::Archive::new(GzDecoder::new(file));
        archive
            .unpack(&staging)
            .map_err(|error| format!("Ollama 解压失败：{error}"))?;
        let executable = find_named_file(&staging, "ollama", 4)
            .ok_or_else(|| "安装包中没有找到 Ollama 可执行文件".to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&executable)
                .map_err(|error| error.to_string())?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).map_err(|error| error.to_string())?;
        }
        let relative = executable
            .strip_prefix(&staging)
            .map_err(|error| error.to_string())?
            .to_path_buf();
        let _ = fs::remove_dir_all(&final_dir);
        fs::rename(&staging, &final_dir).map_err(|error| format!("无法完成安装：{error}"))?;
        Ok(final_dir.join(relative))
    })();
    if outcome.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    outcome
}

#[tauri::command]
async fn ai_install_runtime(app: AppHandle, state: State<'_, AiState>) -> Result<Value, String> {
    if let Some((path, source)) = find_ollama() {
        return Ok(json!({ "path": path, "source": source, "reused": true }));
    }
    let _busy = SetupGuard::acquire(&state.setup_busy)?;
    let root = private_runtime_dir()?;
    let free = available_space(&root).map_err(|error| format!("无法读取磁盘空间：{error}"))?;
    if free < REQUIRED_BYTES {
        return Err("至少需要 10 GB 可用空间才能安装本机 AI".to_string());
    }
    state.cancel_setup.store(false, Ordering::SeqCst);
    let archive_path = root.join(format!("ollama-{OLLAMA_VERSION}.tgz.part"));
    emit_progress(&app, "runtime", "正在下载 Ollama 运行时…", 0, 0);
    let response = state
        .client
        .get(OLLAMA_URL)
        .send()
        .await
        .map_err(|error| format!("Ollama 下载失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("Ollama 下载失败：{error}"))?;
    let total = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&archive_path)
        .await
        .map_err(|error| format!("无法保存 Ollama：{error}"))?;
    let mut hasher = Sha256::new();
    let mut completed = 0_u64;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        if state.cancel_setup.load(Ordering::SeqCst) {
            let _ = tokio::fs::remove_file(&archive_path).await;
            return Err("安装已取消".to_string());
        }
        let bytes = chunk.map_err(|error| format!("Ollama 下载中断：{error}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|error| format!("无法保存 Ollama：{error}"))?;
        hasher.update(&bytes);
        completed += bytes.len() as u64;
        emit_progress(&app, "runtime", "正在下载 Ollama 运行时…", completed, total);
    }
    file.flush()
        .await
        .map_err(|error| format!("无法完成 Ollama 下载：{error}"))?;
    let digest = format!("{:x}", hasher.finalize());
    if digest != OLLAMA_SHA256 {
        let _ = tokio::fs::remove_file(&archive_path).await;
        return Err("Ollama 下载校验失败，文件已丢弃".to_string());
    }
    emit_progress(&app, "runtime", "正在解压 Ollama 运行时…", total, total);
    let archive_for_extract = archive_path.clone();
    let root_for_extract = root.clone();
    let executable = tokio::task::spawn_blocking(move || extract_runtime(&archive_for_extract, &root_for_extract))
        .await
        .map_err(|error| format!("Ollama 解压任务失败：{error}"))??;
    let _ = tokio::fs::remove_file(&archive_path).await;
    Ok(json!({ "path": executable, "source": "private", "reused": false }))
}

/// Keeps the log from growing without bound: the previous run's log is kept as `.1`.
fn open_log(path: &Path) -> Result<File, String> {
    if fs::metadata(path).map(|meta| meta.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())
}

async fn wait_for_server(client: &reqwest::Client, attempts: u32) -> Option<Value> {
    for _ in 0..attempts {
        if let Some(version) = server_version(client).await {
            return Some(version);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    None
}

#[tauri::command]
async fn ai_start(app: AppHandle, state: State<'_, AiState>) -> Result<Value, String> {
    let client = state.client.clone();
    if let Some(version) = server_version(&client).await {
        return Ok(json!({ "started": false, "reused": true, "version": version }));
    }
    let version = macos_version();
    if !macos_supported(&version) {
        return Err(format!(
            "OoFR 需要 macOS 14 或更高版本；当前为 {version}"
        ));
    }
    // A second call while our own Ollama is still starting waits for it
    // instead of mistaking it for a foreign program on the port.
    let already_starting = owned_child_running(&state)?;
    if already_starting {
        return wait_for_server(&client, 80)
            .await
            .map(|version| json!({ "started": false, "reused": true, "version": version }))
            .ok_or_else(|| "Ollama 启动超时，请查看 OoFR 日志".to_string());
    }
    if TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], 11434)),
        Duration::from_millis(500),
    )
    .is_ok()
    {
        return Err("端口 11434 已被其他程序占用，且该程序不是可用的 Ollama".to_string());
    }
    let executable = find_ollama()
        .ok_or_else(|| "尚未安装 Ollama 运行时".to_string())?
        .0;
    let log_dir = support_dir()?.join("logs");
    fs::create_dir_all(&log_dir).map_err(|error| format!("无法创建日志目录：{error}"))?;
    let stdout = open_log(&log_dir.join("ollama.log"))?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let child = Command::new(executable)
        .arg("serve")
        .env("OLLAMA_HOST", "127.0.0.1:11434")
        .env("OLLAMA_NO_CLOUD", "1")
        // The API server is cheap to keep available; the model is not. Requests
        // send keep_alive "3m" so the model leaves memory soon after a lesson.
        .env("OLLAMA_KEEP_ALIVE", "3m")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("Ollama 启动失败：{error}"))?;
    *state.owned_child.lock().map_err(|_| "AI 进程状态不可用")? = Some(child);
    emit_progress(&app, "start", "正在启动本地 AI…", 0, 0);
    if let Some(version) = wait_for_server(&client, 80).await {
        return Ok(json!({ "started": true, "reused": false, "version": version }));
    }
    stop_owned_child(&state);
    Err("Ollama 启动超时，请查看 OoFR 日志".to_string())
}

#[tauri::command]
async fn ai_pull_model(
    app: AppHandle,
    state: State<'_, AiState>,
    model: String,
) -> Result<Value, String> {
    validate_model(&model)?;
    let _busy = SetupGuard::acquire(&state.setup_busy)?;
    state.cancel_setup.store(false, Ordering::SeqCst);
    let response = state
        .client
        .post(format!("{OLLAMA_ENDPOINT}/api/pull"))
        .json(&json!({ "model": &model, "stream": true }))
        .send()
        .await
        .map_err(|error| format!("模型下载请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("模型下载请求失败：{error}"))?;
    let mut stream = response.bytes_stream();
    let mut pending = Vec::<u8>::new();
    while let Some(chunk) = stream.next().await {
        if state.cancel_setup.load(Ordering::SeqCst) {
            return Err("模型下载已取消；下次会从已有进度继续".to_string());
        }
        pending.extend_from_slice(&chunk.map_err(|error| format!("模型下载中断：{error}"))?);
        while let Some(position) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=position).collect();
            if let Ok(payload) = serde_json::from_slice::<Value>(&line) {
                if let Some(error) = payload.get("error").and_then(Value::as_str) {
                    return Err(error.to_string());
                }
                let completed = payload
                    .get("completed")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let total = payload.get("total").and_then(Value::as_u64).unwrap_or(0);
                let status = payload
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("正在下载模型");
                emit_progress(&app, "model", status, completed, total);
            }
        }
    }
    emit_progress(&app, "ready", &format!("{model} 已安装"), 1, 1);
    Ok(json!({ "model": model, "ready": true }))
}

#[tauri::command]
async fn ai_chat(state: State<'_, AiState>, request: Value) -> Result<Value, String> {
    validate_chat_request(&request)?;
    forward_chat(&state.client, &request).await
}

/// One chat request to Ollama on the loopback address (from this window or a paired phone).
async fn forward_chat(client: &reqwest::Client, request: &Value) -> Result<Value, String> {
    client
        .post(format!("{OLLAMA_ENDPOINT}/api/chat"))
        .timeout(Duration::from_secs(240))
        .json(request)
        .send()
        .await
        .map_err(|error| format!("本地 AI 请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("本地 AI 请求失败：{error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("本地 AI 返回无效数据：{error}"))
}

/// Shows the QR code for pairing a phone: starts listening and makes a one-time code.
#[tauri::command]
fn pair_info(ai: State<'_, AiState>, pairing: State<'_, pair::PairState>) -> Result<Value, String> {
    serde_json::to_value(pairing.info(ai.client.clone())?).map_err(|error| error.to_string())
}

#[tauri::command]
fn pair_devices(pairing: State<'_, pair::PairState>) -> Value {
    json!(pairing.devices())
}

#[tauri::command]
fn pair_forget(pairing: State<'_, pair::PairState>, id: String) -> Result<Value, String> {
    Ok(json!(pairing.forget(&id)?))
}

/// Shadowing needs the microphone; when it was refused, this opens the system's microphone list.
#[tauri::command]
fn open_microphone_settings() -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// QR code modules as rows of "1"/"0", for the page to draw.
#[tauri::command]
fn qr_rows(text: String) -> Result<Vec<String>, String> {
    if text.len() > 1200 {
        return Err("二维码内容过长".to_string());
    }
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M).map_err(|error| error.to_string())?;
    let width = code.width();
    let colors = code.to_colors();
    Ok(colors
        .chunks(width)
        .map(|row| row.iter().map(|color| if *color == qrcode::Color::Dark { '1' } else { '0' }).collect())
        .collect())
}

#[tauri::command]
fn ai_cancel_setup(state: State<'_, AiState>) -> Value {
    state.cancel_setup.store(true, Ordering::SeqCst);
    json!({ "cancelled": true })
}

#[tauri::command]
fn ai_stop(state: State<'_, AiState>) -> Result<Value, String> {
    let managed = stop_owned_child(&state);
    Ok(json!({ "stopped": managed, "managed": managed }))
}

fn main() {
    // Development only: run the phone connection without a window, to test
    // pairing from a browser ("cargo run -- --pair-server").
    #[cfg(debug_assertions)]
    if std::env::args().any(|arg| arg == "--pair-server") {
        let pairing = pair::PairState::default();
        let info = pairing.info(reqwest::Client::new()).expect("pairing listener");
        println!("{}", serde_json::to_string(&info).unwrap());
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    }
    tauri::Builder::default()
        .manage(AiState::default())
        .manage(pair::PairState::default())
        .setup(|app| {
            // A phone paired earlier can connect without anyone touching the Mac.
            let client = app.state::<AiState>().client.clone();
            app.state::<pair::PairState>().start_if_paired(client);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai_status,
            ai_install_runtime,
            ai_pull_model,
            ai_start,
            ai_chat,
            ai_stop,
            ai_cancel_setup,
            pair_info,
            pair_devices,
            pair_forget,
            qr_rows,
            open_microphone_settings
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                stop_owned_child(&window.state::<AiState>());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building OoFR")
        .run(|app, event| {
            // Cmd+Q and other exits may skip window events; never leave our Ollama behind.
            if matches!(event, RunEvent::Exit) {
                stop_owned_child(&app.state::<AiState>());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn supports_sonoma_and_newer() {
        assert!(!macos_supported("13.7.8"));
        assert!(macos_supported("14.0"));
        assert!(macos_supported("26.6.2"));
        assert!(!macos_supported(""));
    }

    #[test]
    fn pins_the_verified_official_runtime() {
        assert_eq!(OLLAMA_VERSION, "0.34.0");
        assert!(OLLAMA_URL.starts_with("https://github.com/ollama/ollama/releases/download/"));
        assert_eq!(OLLAMA_SHA256.len(), 64);
        assert_eq!(OLLAMA_ENDPOINT, "http://127.0.0.1:11434");
    }

    #[test]
    fn reserves_space_for_runtime_and_model() {
        assert_eq!(REQUIRED_BYTES, 10 * 1024 * 1024 * 1024);
    }

    #[test]
    fn only_oofr_models_can_be_downloaded() {
        assert!(validate_model("qwen3.5:9b").is_ok());
        assert!(validate_model("qwen3.5:4b").is_ok());
        for model in ["", "llama3", "gemma3:4b", "qwen3.5:27b", "qwen3.5:9b ", "qwen3.5:9b;rm", "../qwen3.5:9b"] {
            assert!(validate_model(model).is_err(), "{model:?} must be refused");
        }
    }

    #[test]
    fn chat_requests_need_an_oofr_model_and_messages_and_a_sane_size() {
        let ok = json!({ "model": "qwen3.5:9b", "messages": [{ "role": "user", "content": "hi" }], "stream": false });
        assert!(validate_chat_request(&ok).is_ok());
        assert!(validate_chat_request(&json!("text")).is_err());
        assert!(validate_chat_request(&json!({ "messages": [] })).is_err());
        assert!(validate_chat_request(&json!({ "model": "", "messages": [] })).is_err());
        assert!(validate_chat_request(&json!({ "model": "gemma4:26b", "messages": [] })).is_err());
        assert!(validate_chat_request(&json!({ "model": "qwen3.5:9b" })).is_err());
        let huge = json!({ "model": "qwen3.5:9b", "messages": ["x".repeat(MAX_CHAT_REQUEST_BYTES + 1)] });
        assert!(validate_chat_request(&huge).is_err());
    }

    #[test]
    fn reads_the_installed_memory() {
        assert!(memory_bytes() >= 4 * 1024 * 1024 * 1024);
    }

    #[test]
    fn only_one_setup_task_runs_at_a_time_and_it_is_released_afterwards() {
        let flag = AtomicBool::new(false);
        let first = SetupGuard::acquire(&flag).expect("first task starts");
        assert!(SetupGuard::acquire(&flag).is_err());
        drop(first);
        assert!(SetupGuard::acquire(&flag).is_ok());
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("oofr-test-{name}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_archive(path: &Path, files: &[(&str, &[u8])]) {
        let encoder = GzEncoder::new(File::create(path).unwrap(), Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, content) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, name, *content).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap().flush().unwrap();
    }

    #[test]
    fn a_good_archive_is_installed_in_one_step_and_made_executable() {
        let root = scratch_dir("good");
        let archive = root.join("ollama.tgz");
        write_archive(&archive, &[("bin/ollama", b"#!/bin/sh\n"), ("lib/helper.txt", b"x")]);
        let executable = extract_runtime(&archive, &root).expect("installs");
        assert!(executable.is_file());
        assert!(executable.starts_with(root.join(format!("ollama-{OLLAMA_VERSION}"))));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&executable).unwrap().permissions().mode() & 0o111, 0o111);
        }
        assert!(!root.join(format!(".unpack-{OLLAMA_VERSION}")).exists(), "staging directory is gone");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_archive_without_ollama_leaves_nothing_that_looks_installed() {
        let root = scratch_dir("bad");
        let archive = root.join("broken.tgz");
        write_archive(&archive, &[("readme.txt", b"no binary here")]);
        assert!(extract_runtime(&archive, &root).is_err());
        assert!(!root.join(format!(".unpack-{OLLAMA_VERSION}")).exists());
        assert!(!root.join(format!("ollama-{OLLAMA_VERSION}")).exists());
        assert!(find_named_file(&root, "ollama", 4).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_half_finished_extraction_is_never_picked_up() {
        let root = scratch_dir("hidden");
        fs::create_dir_all(root.join(".unpack-leftover")).unwrap();
        fs::write(root.join(".unpack-leftover").join("ollama"), b"partial").unwrap();
        assert!(find_named_file(&root, "ollama", 4).is_none());
        fs::create_dir_all(root.join("ollama-real")).unwrap();
        fs::write(root.join("ollama-real").join("ollama"), b"ok").unwrap();
        assert_eq!(find_named_file(&root, "ollama", 4), Some(root.join("ollama-real").join("ollama")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_child_that_already_exited_is_not_reported_as_running() {
        let mut slot = Command::new("/usr/bin/true").spawn().ok();
        if let Some(child) = slot.as_mut() {
            let _ = child.wait();
        }
        assert!(!child_is_running(&mut slot));
        assert!(slot.is_none());
    }
}
