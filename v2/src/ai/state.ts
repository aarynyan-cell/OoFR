// Whether the local AI can be used right now, and the one-click setup that gets
// it there. The pages read this through useAi().

import { useSyncExternalStore } from "react";
import { type AiBackend, type AppSetup, AiError, type Progress, appBackend, localBackend, tauri } from "./backend";
import { type ModelChoice, chooseModel } from "./models";
import { startAutoSync, stopAutoSync } from "../sync/auto";
import { OnlineBackend, addKeys, canExplainWith, hasKeys, loadKeys } from "./online";
import { type PairedBackend, type Pairing, forgetPairing, loadPairing, pairWith, pairedBackend } from "./paired";

export type AiPhase =
  | "checking"
  // Ready to answer.
  | "ready"
  // Ollama runs, the model is not downloaded yet.
  | "needs-model"
  // Mac app only: Ollama is not installed / not running.
  | "needs-runtime"
  | "stopped"
  // Installing, starting or downloading (see step and progress).
  | "working"
  // A browser that cannot reach Ollama on this device (a phone, or a computer without it).
  | "unreachable";

export interface AiState {
  phase: AiPhase;
  where: "app" | "browser";
  model: ModelChoice;
  step: string;
  progress: Progress | null;
  error: string;
  // The paired Mac's name while its AI is used from this phone; null otherwise.
  paired: string | null;
  // This phone has been paired with a Mac (reachable or not).
  hasPairing: boolean;
  // Free online AI with the learner's own keys is in use (2.1).
  online: boolean;
  // Explanations (and checking a dictionary fix) can be asked: online AI needs
  // a key for a model that explains (any of Groq, SiliconFlow, Zhipu does).
  canExplain: boolean;
}

// Said wherever an explanation is asked for without a key for a model that explains.
export const NEEDS_EXPLAIN_KEY = "讲解要用 Groq（推荐）、硅基流动或智谱的免费密钥：在 我的 → AI 翻译与讲解 里加上";

// What the panels show while online AI answers.
export const ONLINE_MODEL: ModelChoice = { name: "在线 AI", downloadGb: 0, minMemoryGb: 0 };

const initial = (): AiState => ({ phase: "checking", where: tauri() ? "app" : "browser", model: chooseModel(null), step: "", progress: null, error: "", paired: null, hasPairing: false, online: false, canExplain: true });
let state: AiState = initial();
let backend: AiBackend | null = null;
let setup: AppSetup | null = null;
// One connection to the paired Mac, reused by every check (a new one each time would pile up).
let remote: { key: string; backend: PairedBackend } | null = null;

function remoteFor(pairing: Pairing): PairedBackend {
  const key = `${pairing.key}|${pairing.port}|${pairing.ips.join(",")}`;
  if (remote?.key !== key) {
    remote?.backend.close();
    remote = { key, backend: pairedBackend(pairing) };
  }
  return remote.backend;
}
const listeners = new Set<() => void>();

function update(patch: Partial<AiState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAi(): AiState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function aiState(): AiState {
  return state;
}

export function onAiChange(listener: () => void): () => void {
  return subscribe(listener);
}

// The backend and model to use, only while the AI is ready.
export function readyAi(): { backend: AiBackend; model: string } | null {
  return state.phase === "ready" && backend ? { backend, model: state.model.name } : null;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "本机 AI 出错了");

// Browsers only say "at least 8 GB" (and Safari nothing); a small number is still useful.
function browserMemoryGb(): number | null {
  const value = (navigator as { deviceMemory?: number }).deviceMemory;
  return typeof value === "number" && value < 8 ? value : null;
}

// The paired Mac while it answers (its voices read for this phone); null otherwise.
let connectedMac: PairedBackend | null = null;
const macListeners = new Set<() => void>();

export function pairedMac(): PairedBackend | null {
  return connectedMac;
}

export function onPairedMac(listener: () => void): () => void {
  macListeners.add(listener);
  return () => macListeners.delete(listener);
}

function setConnectedMac(mac: PairedBackend | null): void {
  if (mac === connectedMac) return;
  connectedMac = mac;
  macListeners.forEach((listener) => listener());
}

// A paired phone keeps its Mac (syncing, the Mac's voices) even when its AI
// comes from online, and looks for it again when it is lost.
async function syncWithPairedMac(): Promise<string | null> {
  const pairing = await loadPairing();
  if (!pairing) {
    setConnectedMac(null);
    return null;
  }
  const mac = remoteFor(pairing);
  try {
    await mac.status();
    startAutoSync(mac);
    setConnectedMac(mac);
    return pairing.mac || "电脑";
  } catch {
    stopAutoSync();
    setConnectedMac(null);
    lookAgainLater();
    return null;
  }
}

let online: { key: string; backend: OnlineBackend } | null = null;

async function check(): Promise<void> {
  // 2.1: the learner's own free online keys come first, on every device.
  const keys = await loadKeys();
  if (hasKeys(keys)) {
    const key = JSON.stringify(keys);
    if (online?.key !== key) online = { key, backend: new OnlineBackend(keys) };
    backend = online.backend;
    setup = null;
    update({ phase: "ready", model: ONLINE_MODEL, online: true, canExplain: canExplainWith(keys), error: "" });
    const mac = await syncWithPairedMac();
    return update({ paired: mac, hasPairing: Boolean(await loadPairing()) });
  }
  update({ online: false, canExplain: true });
  const app = tauri();
  if (app) {
    const desktop = appBackend(app);
    backend = desktop;
    setup = desktop.setup;
    const status = await setup.status();
    const model = chooseModel(status.memoryBytes ? status.memoryBytes / 2 ** 30 : null);
    if (!status.runtimeInstalled) return update({ phase: "needs-runtime", model });
    if (!status.serverRunning) {
      // Installed but not running: start it without asking.
      try {
        await setup.start();
      } catch (error) {
        return update({ phase: "stopped", model, error: describe(error) });
      }
    }
    const models = await desktop.models();
    return update({ phase: models.includes(model.name) ? "ready" : "needs-model", model });
  }
  const local = localBackend();
  if (!actAsPhone() && (await local.version())) {
    backend = local;
    const model = chooseModel(browserMemoryGb());
    const models = await local.models().catch((): string[] => []);
    return update({ phase: models.includes(model.name) ? "ready" : "needs-model", model, paired: null, hasPairing: false });
  }
  // A phone: use the AI of the Mac it was paired with.
  const pairing = await loadPairing();
  if (pairing) {
    const mac = remoteFor(pairing);
    try {
      const status = await mac.status();
      backend = mac;
      // Connected: lessons and the phrasebook sync in the background, AI or not.
      startAutoSync(mac);
      setConnectedMac(mac);
      const model = chooseModel(status.memoryBytes ? status.memoryBytes / 2 ** 30 : null);
      const phase = !status.serverRunning ? "stopped" : status.models.includes(model.name) ? "ready" : "needs-model";
      return update({ phase, model, paired: pairing.mac || "电脑", hasPairing: true, error: "" });
    } catch {
      backend = null;
      stopAutoSync();
      setConnectedMac(null);
      lookAgainLater();
      return update({ phase: "unreachable", paired: null, hasPairing: true });
    }
  }
  backend = null;
  update({ phase: "unreachable", paired: null, hasPairing: false });
}

// The phone takes the online AI keys saved in the paired Mac app (over the
// paired connection only). Returns how many were new.
export async function importKeysFromMac(): Promise<number> {
  const mac = connectedMac;
  if (!mac) throw new AiError("先连上配对的电脑");
  let answer: Record<string, unknown>;
  try {
    answer = await mac.exchange({ t: "keys-get" }, 15000);
  } catch {
    throw new AiError("电脑没有回应：请打开电脑上的 OoFR 在线版（3.0 以上）");
  }
  if (answer.t !== "keys") throw new AiError("电脑上的 OoFR 还不能传密钥，请更新到在线版");
  const added = await addKeys((answer.keys ?? {}) as Partial<Record<string, string[]>>);
  await refreshAi();
  return added;
}

// After scanning the Mac's QR code.
export async function pairPhone(pairing: Pairing): Promise<string> {
  const paired = await pairWith(pairing);
  await refreshAi();
  return paired.mac || "电脑";
}

export async function unpairPhone(): Promise<void> {
  stopAutoSync();
  setConnectedMac(null);
  remote?.backend.close();
  remote = null;
  await forgetPairing();
  backend = null;
  update({ phase: "unreachable", paired: null, hasPairing: false, error: "" });
}

let checking: Promise<void> | null = null;

// Test versions: this computer's browser plays the phone (uses the paired Mac
// app, not its own Ollama), so the phone's path can be tried on the Mac.
function actAsPhone(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem("oofr.dev.phone") === "1";
  } catch {
    return false;
  }
}

// A phone that lost its Mac (locked, the network changed or dropped) looks for
// it again: when OoFR is back on screen, when the network is back, and every
// 20 seconds while it is open. Before, one failed try left it lost until the
// learner pressed 重新连接.
const LOOK_AGAIN_MS = 20000;
let lookAgain: ReturnType<typeof setTimeout> | undefined;

function lostMac(): boolean {
  return Boolean(state.hasPairing) && !connectedMac;
}

function lookAgainLater(): void {
  clearTimeout(lookAgain);
  lookAgain = setTimeout(() => {
    if (!lostMac()) return;
    if (document.visibilityState === "visible") void refreshAi();
    else lookAgainLater();
  }, LOOK_AGAIN_MS);
}

// A request to the Mac failed: make sure the connection is still there.
export function checkMacAgain(): void {
  if (state.hasPairing) void refreshAi();
}

if (typeof document !== "undefined") {
  // Back on screen (e.g. the phone was unlocked): the connection may have been cut meanwhile.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.hasPairing) void refreshAi();
  });
  window.addEventListener("online", () => {
    if (state.hasPairing) void refreshAi();
  });
}

// Asked again while a look is under way (keys just saved, a phone unlocked):
// that look may have started before the change, so it runs once more.
let lookAgainAfter = false;

export function refreshAi(): Promise<void> {
  if (state.phase === "working") return Promise.resolve();
  if (checking) {
    lookAgainAfter = true;
    return checking;
  }
  checking = (async () => {
    do {
      lookAgainAfter = false;
      await check().catch((error) => update({ phase: "unreachable", error: describe(error) }));
    } while (lookAgainAfter);
  })().finally(() => {
    checking = null;
  });
  return checking;
}

// A failed request may mean Ollama was closed; look again.
export function noteAiFailure(error: unknown): void {
  if (error instanceof TypeError || /fetch|connect|refused|load failed/i.test(describe(error))) void refreshAi();
}

const GB = 2 ** 30;

export function progressText(progress: Progress | null): string {
  if (!progress) return "";
  if (progress.total > 0 && progress.completed < progress.total) return `${(progress.completed / GB).toFixed(1)} / ${(progress.total / GB).toFixed(1)} GB`;
  if (/verifying/i.test(progress.text)) return "正在校验";
  if (/writing|success/i.test(progress.text)) return "即将完成";
  return progress.text && !/^pulling/i.test(progress.text) ? progress.text : "准备中";
}

let controller: AbortController | null = null;

// One click: whatever is missing (program, start, model) is done in order.
export async function setupAi(): Promise<void> {
  if (state.phase === "working" || state.phase === "checking") return;
  const before = state.phase;
  controller = new AbortController();
  let last = 0;
  const onProgress = (progress: Progress) => {
    // Ollama reports many times a second; the screen needs a few.
    const now = Date.now();
    if (now - last < 250 && progress.completed < progress.total) return;
    last = now;
    update({ progress });
  };
  try {
    if (setup && before === "needs-runtime") {
      update({ phase: "working", step: "安装本机 AI 程序", progress: null, error: "" });
      await setup.installRuntime(onProgress);
    }
    if (setup && (before === "needs-runtime" || before === "stopped")) {
      update({ phase: "working", step: "启动本机 AI", progress: null, error: "" });
      await setup.start();
    }
    if (!backend) throw new AiError("连不上本机 AI");
    if (backend.kind === "paired") throw new AiError("请在电脑上的 OoFR 里完成这一步");
    if (!(await backend.models()).includes(state.model.name)) {
      update({ phase: "working", step: `下载 AI 模型（约 ${state.model.downloadGb} GB，只需一次）`, progress: null, error: "" });
      await backend.pull(state.model.name, onProgress, controller.signal);
    }
    update({ phase: "ready", step: "", progress: null, error: "" });
  } catch (error) {
    const cancelled = controller.signal.aborted || /取消/.test(describe(error));
    update({ phase: before, step: "", progress: null });
    await refreshAi();
    update({ error: cancelled ? "已取消。下次会接着已下载的部分继续" : describe(error) });
  } finally {
    controller = null;
  }
}

export async function cancelAiSetup(): Promise<void> {
  controller?.abort();
  await setup?.cancel().catch(() => undefined);
}

// Tests start from a clean state.
export function resetAiForTests(): void {
  remote?.backend.close();
  remote = null;
  online = null;
  state = initial();
  backend = null;
  setup = null;
  checking = null;
}
