(function initOoFROllama(globalScope) {
  "use strict";

  const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";

  class OllamaError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "OllamaError";
      this.code = code;
      this.details = details;
    }
  }

  function normalizeEndpoint(value) {
    const raw = String(value || DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new OllamaError("invalid-endpoint", "Ollama 地址格式不正确");
    }
    if (!/^https?:$/.test(url.protocol)) {
      throw new OllamaError("invalid-endpoint", "Ollama 地址必须使用 http 或 https");
    }
    return url.toString().replace(/\/$/, "");
  }

  function parseJsonContent(value) {
    const content = String(value || "").trim();
    if (!content) throw new OllamaError("empty-response", "模型没有返回内容");
    try {
      return JSON.parse(content);
    } catch {
      const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
      const object = content.match(/\{[\s\S]*\}/)?.[0];
      try {
        return JSON.parse(fenced || object || "");
      } catch {
        throw new OllamaError("invalid-json", "模型返回的内容不是有效 JSON", { content });
      }
    }
  }

  function createTimeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  class Client {
    constructor(options = {}) {
      this.endpoint = normalizeEndpoint(options.endpoint);
      this.model = String(options.model || "").trim();
      this.timeoutMs = Number(options.timeoutMs) || 30000;
      this.keepAlive = String(options.keepAlive || "30m");
      this.resolvedModelPromise = null;
    }

    async request(path, options = {}) {
      if (globalScope.OoFRDesktopAi?.isDesktop?.()) {
        try {
          if (path === "/api/tags") {
            const status = await globalScope.OoFRDesktopAi.status();
            return { models: status.models || [] };
          }
          if (path === "/api/chat" && options.body) {
            return await globalScope.OoFRDesktopAi.chat(options.body);
          }
          throw new OllamaError("desktop-unsupported", `桌面桥接暂不支持 ${path}`);
        } catch (error) {
          if (error instanceof OllamaError) throw error;
          const message = error?.message || String(error);
          const code = /model/i.test(message) && /not found|未安装/i.test(message) ? "model-not-found" : "unreachable";
          throw new OllamaError(code, message, { desktop: true });
        }
      }
      const timeout = createTimeoutSignal(options.timeoutMs || this.timeoutMs);
      try {
        const response = await fetch(`${this.endpoint}${path}`, {
          method: options.method || "GET",
          headers: options.body ? { "Content-Type": "application/json" } : undefined,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: timeout.signal
        });
        const text = await response.text();
        let payload = null;
        if (text) {
          try { payload = JSON.parse(text); } catch { payload = { error: text }; }
        }
        if (!response.ok) {
          const message = payload?.error || `Ollama 返回 HTTP ${response.status}`;
          const code = response.status === 404 && /model/i.test(message) ? "model-not-found" : "http-error";
          throw new OllamaError(code, message, { status: response.status });
        }
        return payload || {};
      } catch (error) {
        if (error instanceof OllamaError) throw error;
        if (error?.name === "AbortError") {
          throw new OllamaError("timeout", "Ollama 响应超时，请稍后重试或换用更小的模型");
        }
        throw new OllamaError("unreachable", "无法连接本机 Ollama", { cause: error?.message || String(error) });
      } finally {
        timeout.clear();
      }
    }

    async listModels() {
      const payload = await this.request("/api/tags", { timeoutMs: 6000 });
      return (payload.models || [])
        .map((item) => ({
          name: String(item?.name || item?.model || "").trim(),
          size: Number(item?.size || 0),
          details: item?.details || {}
        }))
        .filter((item) => item.name);
    }

    async resolveModel({ refresh = false } = {}) {
      if (!refresh && this.resolvedModelPromise) return this.resolvedModelPromise;
      const pending = this.resolveModelUncached();
      this.resolvedModelPromise = pending;
      try {
        return await pending;
      } catch (error) {
        if (this.resolvedModelPromise === pending) this.resolvedModelPromise = null;
        throw error;
      }
    }

    async resolveModelUncached() {
      const models = await this.listModels();
      if (!models.length) throw new OllamaError("no-models", "Ollama 已连接，但还没有安装模型");
      if (!this.model || this.model === "auto") {
        return [...models].sort((left, right) => {
          const leftSize = left.size > 0 ? left.size : Number.MAX_SAFE_INTEGER;
          const rightSize = right.size > 0 ? right.size : Number.MAX_SAFE_INTEGER;
          return leftSize - rightSize;
        })[0].name;
      }
      const exact = models.find((item) => item.name === this.model);
      const compatible = models.find((item) => item.name.startsWith(`${this.model}:`));
      if (!exact && !compatible) {
        throw new OllamaError("model-not-found", `尚未安装模型 ${this.model}`, { models });
      }
      return (exact || compatible).name;
    }

    async chatJson({ prompt, system, schema, timeoutMs, model, options = {}, keepAlive }) {
      const selectedModel = model || await this.resolveModel();
      const messages = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });
      const payload = await this.request("/api/chat", {
        method: "POST",
        timeoutMs: timeoutMs || this.timeoutMs,
        body: {
          model: selectedModel,
          keep_alive: keepAlive || this.keepAlive,
          stream: false,
          think: false,
          format: schema || "json",
          messages,
          options: { temperature: 0, num_predict: 1600, ...options }
        }
      });
      return { data: parseJsonContent(payload?.message?.content), model: selectedModel };
    }
  }

  function describeError(error) {
    if (error?.code === "no-models") return "已连接，但尚未安装模型";
    if (error?.code === "model-not-found") return error.message;
    if (error?.code === "timeout") return error.message;
    if (error?.code === "invalid-endpoint") return error.message;
    if (error?.code === "invalid-json" || error?.code === "empty-response") return "模型输出格式异常，请重试";
    return "无法连接；请确认 Ollama 正在运行并允许当前网页访问";
  }

  const api = { Client, OllamaError, DEFAULT_ENDPOINT, normalizeEndpoint, describeError };
  globalScope.OoFROllama = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
