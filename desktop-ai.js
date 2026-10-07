(function attachOoFRDesktopAi(scope) {
  function tauriCore() {
    return scope.__TAURI__?.core || scope.__TAURI_INTERNALS__ || null;
  }

  function isDesktop() {
    return Boolean(tauriCore()?.invoke);
  }

  async function invoke(command, args = {}) {
    const core = tauriCore();
    if (!core?.invoke) throw new Error("OoFR desktop bridge is unavailable");
    return core.invoke(command, args);
  }

  async function listen(eventName, handler) {
    const eventApi = scope.__TAURI__?.event;
    if (!eventApi?.listen) return () => {};
    return eventApi.listen(eventName, (event) => handler(event.payload));
  }

  scope.OoFRDesktopAi = {
    isDesktop,
    status: () => invoke("ai_status"),
    installRuntime: () => invoke("ai_install_runtime"),
    pullModel: (model = "gemma3:4b") => invoke("ai_pull_model", { model }),
    start: () => invoke("ai_start"),
    chat: (request) => invoke("ai_chat", { request }),
    stop: () => invoke("ai_stop"),
    cancelSetup: () => invoke("ai_cancel_setup"),
    listenProgress: (handler) => listen("ai-setup-progress", handler)
  };
})(globalThis);
