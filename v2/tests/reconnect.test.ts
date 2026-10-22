import { afterAll, describe, expect, it, vi } from "vitest";

// A phone that loses its Mac (locked, network dropped) finds it again on its
// own: every 20 seconds while OoFR is open, and when it is back on screen.
// Before, one failed try left it lost until 重新连接 was pressed.

const pageListeners = new Map<string, () => void>();
const scope = globalThis as unknown as { document?: unknown; window?: unknown };
const before = { document: scope.document, window: scope.window };
scope.document = { visibilityState: "visible", addEventListener: (type: string, listener: () => void) => pageListeners.set(type, listener) };
scope.window = { addEventListener: (type: string, listener: () => void) => pageListeners.set(type, listener) };
afterAll(() => Object.assign(scope, before));

let reachable = false;
let tries = 0;

vi.mock("../src/ai/backend", async (original) => ({
  ...(await original<typeof import("../src/ai/backend")>()),
  tauri: () => null,
  // No Ollama on a phone.
  localBackend: () => ({ kind: "local", version: async () => null, models: async () => [] })
}));
vi.mock("../src/sync/auto", () => ({ startAutoSync: () => undefined, stopAutoSync: () => undefined }));
// No online keys on this phone.
vi.mock("../src/ai/online", async (original) => ({
  ...(await original<typeof import("../src/ai/online")>()),
  loadKeys: async () => ({ groq: [], siliconflow: [], zhipu: [], gemini: [] })
}));
vi.mock("../src/ai/paired", async (original) => ({
  ...(await original<typeof import("../src/ai/paired")>()),
  loadPairing: async () => ({ ips: ["10.0.0.2"], host: "", port: 47800, fp: "AA", key: "key", mac: "Mac" }),
  pairedBackend: () => ({
    kind: "paired",
    status: async () => {
      tries += 1;
      if (!reachable) throw new Error("the Mac is gone");
      return { serverRunning: true, models: ["qwen3.5:9b"], memoryBytes: 16 * 2 ** 30 };
    },
    close: () => undefined
  })
}));

const { aiState, pairedMac, refreshAi } = await import("../src/ai/state");

describe("finding the Mac again", () => {
  it("looks again every 20 seconds while open, and is connected once the Mac is back", async () => {
    vi.useFakeTimers();
    await refreshAi();
    expect(aiState().phase).toBe("unreachable");
    expect(pairedMac()).toBeNull();
    const first = tries;

    reachable = true;
    await vi.advanceTimersByTimeAsync(20000);
    expect(tries).toBe(first + 1);
    expect(pairedMac()).not.toBeNull();
    expect(aiState().phase).toBe("ready");
    vi.useRealTimers();
  });

  it("checks the connection when OoFR comes back on screen", async () => {
    const triesBefore = tries;
    pageListeners.get("visibilitychange")?.();
    await vi.waitFor(() => expect(tries).toBe(triesBefore + 1));
  });
});
