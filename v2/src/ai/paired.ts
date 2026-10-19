// 连接手机: a phone uses the local AI of a paired Mac over a direct WebRTC data
// channel on the same network (desktop/src-tauri/src/pair.rs has the Mac side).
// Nothing goes through a server: the page writes the Mac's side of the session
// from the QR code (addresses, port, certificate fingerprint) and pins its
// certificate; the Mac knows this phone by the key it gave it when pairing.

import { db } from "../db/database";
import { type AiBackend, AiError, type ChatBody } from "./backend";

export const PAIRING_KEY = "pairing";
// Where phones open OoFR (the pairing QR code links there). A test build sets
// VITE_PHONE_URL to the Mac's own dev server.
export const PHONE_URL = import.meta.env.VITE_PHONE_URL || "https://aarynyan-cell.github.io/OoFR/";
const UFRAG_PREFIX = "oofr+v1/";
const OPEN_TIMEOUT = 12000;

export interface Pairing {
  ips: string[];
  host: string;
  port: number;
  // Mac certificate fingerprint, "AA:BB:…".
  fp: string;
  // One-time code from the QR code (before pairing) or this phone's key (after).
  code?: string;
  key?: string;
  mac?: string;
}

function fromBase64url(text: string): string {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST = /^[A-Za-z0-9-]{1,63}\.local$/;
const FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// The QR code holds a link ("…#/pair/<payload>") or just the payload.
export function parsePairing(text: string): Pairing | null {
  const payload = text.trim().replace(/^.*#\/pair\//, "");
  try {
    const data = JSON.parse(fromBase64url(payload)) as Record<string, unknown>;
    const ips = Array.isArray(data.ips) ? data.ips.filter((ip): ip is string => typeof ip === "string" && IPV4.test(ip)).slice(0, 6) : [];
    const host = typeof data.host === "string" && HOST.test(data.host) ? data.host : "";
    const port = Number(data.port);
    const fp = typeof data.fp === "string" ? data.fp.toUpperCase() : "";
    const code = typeof data.code === "string" && /^[0-9a-f]{8,64}$/.test(data.code) ? data.code : "";
    if (data.v !== 1 || (!ips.length && !host) || !Number.isInteger(port) || port < 1 || port > 65535 || !FINGERPRINT.test(fp) || !code) return null;
    return { ips, host, port, fp, code };
  } catch {
    return null;
  }
}

export async function loadPairing(): Promise<Pairing | null> {
  return ((await db.kv.get(PAIRING_KEY))?.value as Pairing | undefined) ?? null;
}

export async function savePairing(pairing: Pairing): Promise<void> {
  await db.kv.put({ key: PAIRING_KEY, value: pairing });
}

export async function forgetPairing(): Promise<void> {
  await db.kv.delete(PAIRING_KEY);
}

export function deviceName(userAgent = navigator.userAgent): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(userAgent)) return "Android 手机";
  return "浏览器";
}

// The Mac's side of the session, written by the phone (the Mac is ICE-lite and
// takes its ICE username from what the phone uses here).
export function answerFor(pairing: Pairing, localSdp: string): string {
  const password = /a=ice-pwd:(\S+)/.exec(localSdp)?.[1];
  if (!password) throw new AiError("这个浏览器不支持直接连接电脑");
  const mid = /a=mid:(\S+)/.exec(localSdp)?.[1] ?? "0";
  const ufrag = UFRAG_PREFIX + password;
  const address = pairing.ips[0] ?? "0.0.0.0";
  return [
    "v=0",
    "o=- 1 1 IN IP4 0.0.0.0",
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${mid}`,
    "a=ice-lite",
    `m=application ${pairing.port} UDP/DTLS/SCTP webrtc-datachannel`,
    `c=IN IP4 ${address}`,
    `a=mid:${mid}`,
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${ufrag}`,
    `a=fingerprint:sha-256 ${pairing.fp}`,
    "a=setup:passive",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    ...pairing.ips.map((ip, index) => `a=candidate:${index + 1} 1 udp ${2130706431 - index} ${ip} ${pairing.port} typ host`),
    ""
  ].join("\r\n");
}

type Message = Record<string, unknown> & { t?: string; id?: number };

class Link {
  private waiting = new Map<number, { resolve: (value: Message) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private next = 1;
  closed = false;

  private constructor(private readonly pc: RTCPeerConnection, private readonly channel: RTCDataChannel) {
    channel.onmessage = (event) => {
      let message: Message;
      try {
        message = JSON.parse(String(event.data)) as Message;
      } catch {
        return;
      }
      const waiter = typeof message.id === "number" ? this.waiting.get(message.id) : undefined;
      if (!waiter) return;
      this.waiting.delete(message.id!);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    };
    const lost = () => this.close(new AiError("和电脑的连接断开了"));
    channel.onclose = lost;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") lost();
    };
  }

  // Connects and says hello; returns the link and what the Mac answered.
  static async open(pairing: Pairing): Promise<{ link: Link; welcome: Message }> {
    if (typeof RTCPeerConnection === "undefined") throw new AiError("这个浏览器不支持直接连接电脑");
    const pc = new RTCPeerConnection({ iceServers: [] });
    const channel = pc.createDataChannel("oofr");
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await pc.setRemoteDescription({ type: "answer", sdp: answerFor(pairing, pc.localDescription?.sdp ?? "") });
      // The Mac's .local name finds it again after its address changed; a browser that cannot resolve it ignores it.
      if (pairing.host) {
        await pc.addIceCandidate({ candidate: `candidate:9 1 udp 2130706000 ${pairing.host} ${pairing.port} typ host`, sdpMid: /a=mid:(\S+)/.exec(pc.localDescription?.sdp ?? "")?.[1] ?? "0" }).catch(() => undefined);
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new AiError("连不上电脑")), OPEN_TIMEOUT);
        channel.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      const welcome = await new Promise<Message>((resolve, reject) => {
        const timer = setTimeout(() => reject(new AiError("电脑没有回应")), 6000);
        channel.onmessage = (event) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(String(event.data)) as Message);
          } catch {
            reject(new AiError("电脑的回应无法识别"));
          }
        };
        channel.send(JSON.stringify({ t: "hello", v: 1, name: deviceName(), ...(pairing.key ? { key: pairing.key } : { code: pairing.code }) }));
      });
      if (welcome.t !== "welcome") throw new AiError("这台电脑不认识这部手机了，请重新扫码配对");
      return { link: new Link(pc, channel), welcome };
    } catch (error) {
      pc.close();
      throw error;
    }
  }

  request(message: Message, timeout: number, signal?: AbortSignal): Promise<Message> {
    if (this.closed) return Promise.reject(new AiError("和电脑的连接断开了"));
    const id = this.next++;
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new AiError("电脑太久没有回应"));
      }, timeout);
      this.waiting.set(id, { resolve, reject, timer });
      signal?.addEventListener("abort", () => {
        this.waiting.delete(id);
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
      this.channel.send(JSON.stringify({ ...message, id }));
    });
  }

  close(error = new AiError("连接已关闭")): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiting.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiting.clear();
    this.pc.close();
  }
}

// Pairs with the Mac shown in a QR code; the phone keeps the key it receives.
export async function pairWith(pairing: Pairing): Promise<Pairing> {
  const { link, welcome } = await Link.open(pairing);
  link.close();
  if (typeof welcome.key !== "string") throw new AiError("配对没有完成，请重新扫码");
  const paired: Pairing = { ips: pairing.ips, host: pairing.host, port: pairing.port, fp: pairing.fp, key: welcome.key, mac: typeof welcome.mac === "string" ? welcome.mac : "" };
  await savePairing(paired);
  return paired;
}

export interface MacStatus {
  serverRunning: boolean;
  models: string[];
  memoryBytes: number;
}

export function pairedBackend(pairing: Pairing): AiBackend & { status(): Promise<MacStatus> } {
  let link: Link | null = null;
  let opening: Promise<Link> | null = null;
  const connect = async () => {
    if (link && !link.closed) return link;
    opening ??= Link.open(pairing)
      .then(({ link: opened }) => (link = opened))
      .finally(() => {
        opening = null;
      });
    return opening;
  };
  const status = async (): Promise<MacStatus> => {
    const answer = await (await connect()).request({ t: "status" }, 10000);
    return {
      serverRunning: answer.serverRunning === true,
      models: Array.isArray(answer.models) ? answer.models.filter((name): name is string => typeof name === "string") : [],
      memoryBytes: Number(answer.memoryBytes) || 0
    };
  };
  return {
    kind: "paired",
    status,
    async version() {
      try {
        return (await status()).serverRunning ? "paired" : null;
      } catch {
        return null;
      }
    },
    async models() {
      return (await status()).models;
    },
    async chat(body: ChatBody, signal?: AbortSignal) {
      const answer = await (await connect()).request({ t: "chat", request: body }, 300000, signal);
      if (answer.t === "error") throw new AiError(String(answer.message ?? "电脑上的本机 AI 出错了"));
      const response = answer.response as { message?: { content?: string } } | undefined;
      return String(response?.message?.content ?? "");
    },
    async pull() {
      throw new AiError("请在电脑上的 OoFR 里下载 AI 模型");
    }
  };
}
