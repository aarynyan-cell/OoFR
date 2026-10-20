// Test versions only (the Mac's dev server): reports what happened on a real
// phone to v2/devlog.log on the Mac, so a bug can be followed without the
// tester describing it. Published builds leave this out entirely.
const started = Date.now();

export function devLog(event: string, data: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  try {
    const body = JSON.stringify({ t: Date.now() - started, event, ...data });
    void fetch("./__oofr_log", { method: "POST", body, keepalive: true }).catch(() => undefined);
  } catch {
    // Only a test aid.
  }
}
