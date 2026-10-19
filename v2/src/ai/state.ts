// Whether the local AI can be used right now, and the one-click setup that gets
// it there. The pages read this through useAi().

import { useSyncExternalStore } from "react";
import { type AiBackend, type AppSetup, AiError, type Progress, appBackend, localBackend, tauri } from "./backend";
import { type ModelChoice, chooseModel } from "./models";

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
}

let state: AiState = { phase: "checking", where: tauri() ? "app" : "browser", model: chooseModel(null), step: "", progress: null, error: "" };
let backend: AiBackend | null = null;
let setup: AppSetup | null = null;
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

async function check(): Promise<void> {
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
  if (!(await local.version())) {
    backend = null;
    return update({ phase: "unreachable" });
  }
  backend = local;
  const model = chooseModel(browserMemoryGb());
  const models = await local.models().catch((): string[] => []);
  update({ phase: models.includes(model.name) ? "ready" : "needs-model", model });
}

let checking: Promise<void> | null = null;

export function refreshAi(): Promise<void> {
  if (state.phase === "working") return Promise.resolve();
  checking ??= check()
    .catch((error) => update({ phase: "unreachable", error: describe(error) }))
    .finally(() => {
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
  state = { phase: "checking", where: tauri() ? "app" : "browser", model: chooseModel(null), step: "", progress: null, error: "" };
  backend = null;
  setup = null;
  checking = null;
}
