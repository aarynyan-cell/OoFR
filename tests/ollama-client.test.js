const test = require("node:test");
const assert = require("node:assert/strict");
const { Client, OllamaError, normalizeEndpoint } = require("../ollama-client.js");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("normalizes a local endpoint", () => {
  assert.equal(normalizeEndpoint("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");
});

test("auto selects the first installed model and parses structured chat output", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/tags")) return jsonResponse({ models: [{ name: "gemma4:26b" }] });
    return jsonResponse({ message: { content: '{"summary":"ok"}' } });
  };

  const client = new Client({ model: "auto" });
  const result = await client.chatJson({
    prompt: "Explain",
    schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }
  });

  assert.equal(result.model, "gemma4:26b");
  assert.deepEqual(result.data, { summary: "ok" });
  const requestBody = JSON.parse(calls[1].options.body);
  assert.equal(requestBody.model, "gemma4:26b");
  assert.equal(requestBody.think, false);
  assert.equal(requestBody.keep_alive, "30m");
  assert.equal(requestBody.options.num_predict, 1600);
});

test("reuses the resolved model for consecutive requests", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let tagCalls = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/api/tags")) {
      tagCalls += 1;
      return jsonResponse({ models: [{ name: "small:latest" }] });
    }
    return jsonResponse({ message: { content: '{"summary":"ok"}' } });
  };
  const client = new Client({ model: "auto" });
  await client.chatJson({ prompt: "one" });
  await client.chatJson({ prompt: "two" });
  assert.equal(tagCalls, 1);
});

test("auto mode chooses the smallest installed model", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options = {}) => {
    if (url.endsWith("/api/tags")) {
      return jsonResponse({ models: [
        { name: "large:latest", size: 18_000_000_000 },
        { name: "small:latest", size: 3_000_000_000 }
      ] });
    }
    const body = JSON.parse(options.body);
    return jsonResponse({ message: { content: JSON.stringify({ model: body.model }) } });
  };
  const result = await new Client({ model: "auto" }).chatJson({ prompt: "choose" });
  assert.equal(result.model, "small:latest");
  assert.deepEqual(result.data, { model: "small:latest" });
});

test("reports an unavailable configured model", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => jsonResponse({ models: [{ name: "gpt-oss:20b" }] });

  const client = new Client({ model: "missing:latest" });
  await assert.rejects(() => client.resolveModel(), (error) => {
    assert.ok(error instanceof OllamaError);
    assert.equal(error.code, "model-not-found");
    return true;
  });
});

test("accepts JSON wrapped in a markdown fence", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => url.endsWith("/api/tags")
    ? jsonResponse({ models: [{ name: "test:latest" }] })
    : jsonResponse({ message: { content: "```json\n{\"translation\":\"你好\"}\n```" } });

  const result = await new Client({ model: "test:latest" }).chatJson({ prompt: "Translate" });
  assert.equal(result.data.translation, "你好");
});
