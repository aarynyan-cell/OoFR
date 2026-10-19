// Microphone permission for shadowing: ask as soon as it is needed, and when it
// was refused, say exactly where to turn it back on for this device. A web page
// cannot open browser or system settings itself; the Mac app can open the
// system's microphone settings.

import { tauri } from "../ai/backend";

export type MicState = "granted" | "prompt" | "denied" | "unknown";

export async function micState(): Promise<MicState> {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return (status?.state as MicState | undefined) ?? "unknown";
  } catch {
    // Older Safari cannot be asked about the microphone in advance.
    return "unknown";
  }
}

// Shows the browser's (or system's) allow-microphone question right away.
export async function askMicrophone(): Promise<MicState> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch (error) {
    return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "unknown";
  }
}

export function canOpenSystemSettings(): boolean {
  return Boolean(tauri());
}

export async function openSystemSettings(): Promise<void> {
  await tauri()?.core.invoke("open_microphone_settings");
}

// Where to turn the microphone back on, in the learner's words.
export function micSteps(userAgent = navigator.userAgent, standalone = matchMedia?.("(display-mode: standalone)").matches ?? false): string[] {
  if (tauri()) return ["点下面的“打开系统设置”", "在“麦克风”列表里打开 OoFR", "回到 OoFR 再点一次录音"];
  const iPhone = /iPhone|iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  if (iPhone && standalone) return ["打开 iPhone 的“设置” → Safari 浏览器 → 麦克风", "选“询问”或“允许”", "回到 OoFR 再点一次录音"];
  if (iPhone) return ["点地址栏左边的“大小”图标（aA）→ 网站设置", "把“麦克风”改成“允许”", "再点一次录音"];
  if (/Edg\//.test(userAgent) || /Chrome\//.test(userAgent)) {
    return ["点地址栏最左边的图标（网站信息）", "把“麦克风”改成“允许”", "刷新页面后再点一次录音", "如果还是不行：打开 Mac 的“系统设置 → 隐私与安全性 → 麦克风”，打开这个浏览器"];
  }
  if (/Safari\//.test(userAgent)) return ["菜单栏 Safari 浏览器 → 设置 → 网站 → 麦克风", "把这个网站改成“允许”", "再点一次录音"];
  if (/Android/.test(userAgent)) return ["点地址栏左边的图标 → 权限", "打开“麦克风”", "再点一次录音"];
  return ["在浏览器的网站设置里允许这个网站使用麦克风", "再点一次录音"];
}
