// Where the local AI runs. Every route ends at Ollama on this computer's
// loopback address; nothing is ever sent to a server on the internet.
//   app   - the OoFR Mac app, which installs, starts and talks to Ollama itself
//   local - a browser on the computer where Ollama is already running
//   paired - a phone using a paired Mac's AI over the local network (paired.ts)

export const OLLAMA = "http://127.0.0.1:11434";

export interface ChatBody {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  stream: false;
  think: false;
  keep_alive: string;
  format?: unknown;
  options?: Record<string, number>;
}

export interface Progress {
  text: string;
  completed: number;
  total: number;
}

export interface AiBackend {
  kind: "app" | "local" | "paired";
  // Ollama's version when it answers, else null.
  version(): Promise<string | null>;
  models(): Promise<string[]>;
  chat(body: ChatBody, signal?: AbortSignal): Promise<string>;
  pull(model: string, onProgress: (progress: Progress) => void, signal?: AbortSignal): Promise<void>;
}

export class AiError extends Error {}

// Ollama reports a download as a stream of JSON lines.
export async function readPullStream(body: ReadableStream<Uint8Array>, onProgress: (progress: Progress) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = done ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
      if (item.error) throw new AiError(item.error);
      onProgress({ text: item.status ?? "", completed: item.completed ?? 0, total: item.total ?? 0 });
    }
    if (done) return;
  }
}

export function localBackend(fetcher: typeof fetch = (...args) => fetch(...args)): AiBackend {
  const get = async (path: string, ms: number) => {
    const response = await fetcher(`${OLLAMA}${path}`, { signal: AbortSignal.timeout(ms) });
    if (!response.ok) throw new AiError(`本机 AI 返回 ${response.status}`);
    return response.json();
  };
  return {
    kind: "local",
    async version() {
      try {
        return String(((await get("/api/version", 2000)) as { version?: string }).version ?? "") || null;
      } catch {
        return null;
      }
    },
    async models() {
      const data = (await get("/api/tags", 5000)) as { models?: { name?: string; model?: string }[] };
      return (data.models ?? []).map((item) => item.name || item.model || "").filter(Boolean);
    },
    async chat(body, signal) {
      const response = await fetcher(`${OLLAMA}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      if (!response.ok) throw new AiError(`本机 AI 返回 ${response.status}`);
      return String(((await response.json()) as { message?: { content?: string } }).message?.content ?? "");
    },
    async pull(model, onProgress, signal) {
      const response = await fetcher(`${OLLAMA}/api/pull`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: true }), signal });
      if (!response.ok || !response.body) throw new AiError(`模型下载失败（${response.status}）`);
      await readPullStream(response.body, onProgress);
    }
  };
}

// The Mac app's commands (desktop/src-tauri). Setup steps that only the app can
// do (install and start Ollama) are in AppSetup.
interface Tauri {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> };
}

export interface AppStatus {
  runtimeInstalled: boolean;
  serverRunning: boolean;
  models: { name?: string; model?: string }[];
  availableBytes: number;
  memoryBytes?: number;
  osSupported: boolean;
  osVersion: string;
}

export interface AppSetup {
  status(): Promise<AppStatus>;
  installRuntime(onProgress: (progress: Progress) => void): Promise<void>;
  start(): Promise<void>;
  cancel(): Promise<void>;
}

export function tauri(): Tauri | null {
  const value = (globalThis as { __TAURI__?: Tauri }).__TAURI__;
  return value?.core?.invoke ? value : null;
}

const message = (error: unknown) => new AiError(typeof error === "string" ? error : error instanceof Error ? error.message : "本机 AI 出错了");

async function withProgress<T>(app: Tauri, onProgress: (progress: Progress) => void, run: () => Promise<T>): Promise<T> {
  const stop = await app.event.listen<{ message: string; completed: number; total: number }>("ai-setup-progress", ({ payload }) =>
    onProgress({ text: payload.message, completed: payload.completed, total: payload.total })
  );
  try {
    return await run();
  } catch (error) {
    throw message(error);
  } finally {
    stop();
  }
}

export function appBackend(app: Tauri): AiBackend & { setup: AppSetup } {
  return {
    kind: "app",
    async version() {
      try {
        return (await app.core.invoke<AppStatus>("ai_status")).serverRunning ? "app" : null;
      } catch {
        return null;
      }
    },
    async models() {
      return (await app.core.invoke<AppStatus>("ai_status")).models.map((item) => item.name || item.model || "").filter(Boolean);
    },
    async chat(body, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const result = await app.core.invoke<{ message?: { content?: string } }>("ai_chat", { request: body });
        return String(result.message?.content ?? "");
      } catch (error) {
        throw message(error);
      }
    },
    pull(model, onProgress) {
      return withProgress(app, onProgress, () => app.core.invoke("ai_pull_model", { model })).then(() => undefined);
    },
    setup: {
      status: () => app.core.invoke<AppStatus>("ai_status"),
      installRuntime: (onProgress) => withProgress(app, onProgress, () => app.core.invoke("ai_install_runtime")).then(() => undefined),
      start: () => app.core.invoke("ai_start").then(() => undefined, (error) => Promise.reject(message(error))),
      cancel: () => app.core.invoke("ai_cancel_setup").then(() => undefined)
    }
  };
}
