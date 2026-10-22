import { useEffect, useState } from "react";
import { OnlineBackend, type OnlineKeys as Keys, PROVIDERS, PROVIDER_ORDER, type ProviderId, canExplainWith, cleanKeys, loadKeys, looksComplete, saveKeys } from "../ai/online";
import { tauri } from "../ai/backend";
import { importKeysFromMac, refreshAi, useAi } from "../ai/state";
import { toast } from "../app/toast";
import { confirmAction } from "./Confirm";

// "gsk_ab…wxyz": enough to tell keys apart without showing them.
const masked = (key: string) => (key.length > 12 ? `${key.slice(0, 5)}…${key.slice(-4)}` : "…");

type Checks = Record<string, "checking" | "ok" | "bad">;

const empty = (): Keys => ({ groq: [], siliconflow: [], zhipu: [], gemini: [] });
const emptyText = (): Record<ProviderId, string> => ({ groq: "", siliconflow: "", zhipu: "", gemini: "" });
const total = (keys: Keys) => PROVIDER_ORDER.reduce((sum, provider) => sum + keys[provider].length, 0);

// What a half-copied key of each provider should look like.
const INCOMPLETE: Record<ProviderId, string> = {
  groq: "Groq 的密钥不完整：应该以 gsk_ 开头，请整串复制",
  siliconflow: "硅基流动的密钥不完整：应该以 sk- 开头，请整串复制",
  zhipu: "智谱的密钥不完整：完整的密钥中间有一个点，像 xxxx.yyyy，请整串复制",
  gemini: "Gemini 的密钥不完整：应该以 AIza 开头，请整串复制"
};

// Free online AI with the learner's own keys (2.1). Keys stay on this device.
export function OnlineKeys() {
  const ai = useAi();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(emptyText);
  const [saved, setSaved] = useState<Keys>(empty);
  const [checks, setChecks] = useState<Checks>({});
  const [importing, setImporting] = useState(false);
  // A phone connected to its Mac can take the keys saved there in one tap.
  const canImport = Boolean(ai.paired) && !tauri();

  useEffect(() => {
    void loadKeys().then((keys) => {
      setSaved(keys);
      if (!total(keys)) setEditing(true);
    });
  }, []);

  // An empty box keeps that provider's keys.
  const save = async () => {
    const keys = empty();
    for (const provider of PROVIDER_ORDER) {
      const typed = cleanKeys(text[provider]);
      // Half a key (most often Zhipu's, copied only up to the dot) is not kept.
      if (typed.some((key) => !looksComplete(provider, key))) return toast(INCOMPLETE[provider]);
      keys[provider] = text[provider].trim() ? typed : saved[provider];
    }
    await saveKeys(keys);
    setSaved(keys);
    setEditing(!total(keys));
    setText(emptyText());
    await refreshAi();
    void check(keys);
  };

  // Test versions on this Mac: the keys in v2/.env.local, without typing them.
  const loadTestKeys = async () => {
    try {
      const response = await fetch("./__oofr_dev_keys");
      if (!response.ok) throw new Error(String(response.status));
      const keys = { ...empty(), ...((await response.json()) as Partial<Keys>) };
      const next = emptyText();
      const skipped: string[] = [];
      for (const provider of PROVIDER_ORDER) {
        const whole = keys[provider].filter((key) => looksComplete(provider, key));
        next[provider] = whole.join("\n");
        if (whole.length < keys[provider].length) skipped.push(PROVIDERS[provider].name);
      }
      setText(next);
      if (skipped.length) toast(`测试文件里${skipped.join("、")}的密钥不完整，先没填`);
    } catch {
      toast("只能在装着测试密钥文件的这台电脑上读取");
    }
  };

  const takeFromMac = async () => {
    setImporting(true);
    try {
      const added = await importKeysFromMac();
      const keys = await loadKeys();
      setSaved(keys);
      toast(added ? `已从电脑导入 ${added} 个密钥` : "电脑上没有这台手机还没有的密钥");
      if (total(keys)) {
        setEditing(false);
        void check(keys);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "没能从电脑导入密钥");
    } finally {
      setImporting(false);
    }
  };

  const importButton = canImport && (
    <button type="button" className="button button-small button-outline align-start" onClick={() => void takeFromMac()} disabled={importing}>
      {importing ? "正在从电脑导入…" : `从电脑「${ai.paired}」导入密钥`}
    </button>
  );

  const check = async (keys = saved) => {
    const all = PROVIDER_ORDER.flatMap((provider) => keys[provider].map((key) => [provider, key] as const));
    setChecks(Object.fromEntries(all.map(([, key]) => [key, "checking"])));
    for (const [provider, key] of all) {
      const ok = await OnlineBackend.check(provider, key);
      setChecks((current) => ({ ...current, [key]: ok ? "ok" : "bad" }));
    }
  };

  const count = total(saved);
  const explains = canExplainWith(saved);
  const results = Object.values(checks);
  const allBad = results.length > 0 && results.every((result) => result === "bad");

  const clear = async () => {
    if (!(await confirmAction("清除这台设备上保存的全部在线 AI 密钥？", { confirmLabel: "清除", danger: true }))) return;
    await saveKeys(empty());
    setSaved(empty());
    setChecks({});
    setEditing(true);
    await refreshAi();
  };

  return (
    <section className="stack-10 online-keys">
      <h3 className="sheet-subtitle">在线 AI（免费）</h3>
      {count > 0 && !editing ? (
        <>
          {allBad ? (
            <span className="pill error-text">密钥都不可用：请检查是否复制完整</span>
          ) : (
            <span className="pill pill-ok">{explains ? "已就绪 · 在线翻译和讲解" : "已就绪 · 在线翻译"}</span>
          )}
          <ul className="stack-4 key-list">
            {PROVIDER_ORDER.flatMap((provider) =>
              saved[provider].map((key) => (
                <li key={key} className="small">
                  {PROVIDERS[provider].name} <span className="mono dim">{masked(key)}</span>{" "}
                  {checks[key] === "checking" ? <span className="dim">检测中…</span> : checks[key] === "ok" ? <span className="ok-text">可用</span> : checks[key] === "bad" ? <span className="error-text">不可用</span> : null}
                </li>
              ))
            )}
          </ul>
          {!saved.gemini.length && (
            <p className="small dim">想让手机自己也有自然的法语朗读？再加一个 Gemini 的免费密钥（不用电脑）。</p>
          )}
          {!saved.groq.length && (
            <div className="stack-6">
              <p className="small accent-text">推荐再加一个 Groq 的免费密钥：翻译和讲解都更快、更准。</p>
              <button type="button" className="button button-small button-primary align-start" onClick={() => setEditing(true)}>添加 Groq 密钥</button>
            </div>
          )}
          <p className="dim small">手机和电脑都能直接用，不需要电脑上的 AI。密钥只存在你自己的设备上，不会备份或同步；句子会发给你选的服务商。</p>
          {tauri() && <p className="dim small">配对的手机可以在它的“AI 翻译与讲解”里一键从这台电脑导入这些密钥（只经过你们之间的直连）。</p>}
          {importButton}
          <div className="row-8">
            <button type="button" className="button button-small button-outline" onClick={() => void check()}>检测密钥</button>
            <button type="button" className="button button-small button-outline" onClick={() => setEditing(true)}>修改密钥</button>
          </div>
        </>
      ) : (
        <>
          {importButton && (
            <div className="stack-6">
              {importButton}
              <p className="dim small">电脑上已经填过密钥的话，一键拿过来就行（只经过你们之间的直连）。</p>
            </div>
          )}
          <p className="dim small">填入你自己的免费密钥，手机和电脑都能直接生成译文和讲解。有一个就能用，推荐 Groq。在服务商网站的“API Keys”里新建一个，用复制按钮整串复制过来。</p>
          {PROVIDER_ORDER.map((provider) => (
            <label key={provider} className="stack-4">
              <span className="small">
                <b>{PROVIDERS[provider].name}</b> · {PROVIDERS[provider].note}
                {saved[provider].length ? `（已有 ${saved[provider].length} 个，留空则不变）` : ""}
                {" · "}
                <a href={PROVIDERS[provider].signup} target="_blank" rel="noreferrer">注册 / 取密钥</a>
              </span>
              <textarea
                className="key-input mono"
                rows={2}
                spellCheck={false}
                autoComplete="off"
                placeholder="一行一个"
                value={text[provider]}
                onChange={(event) => setText((current) => ({ ...current, [provider]: event.target.value }))}
              />
            </label>
          ))}
          <div className="row-8">
            <button type="button" className="button button-small button-primary" onClick={() => void save()}>保存</button>
            {import.meta.env.DEV && <button type="button" className="button button-small button-outline" onClick={() => void loadTestKeys()}>读取测试密钥（这台电脑）</button>}
            {count > 0 && <button type="button" className="button button-small button-outline" onClick={() => setEditing(false)}>取消</button>}
            {count > 0 && <button type="button" className="button button-small button-outline" onClick={() => void clear()}>清除全部密钥</button>}
          </div>
        </>
      )}
      {ai.online && ai.paired && <p className="dim small">另外已连接电脑「{ai.paired}」，磁带、素材和词句本会自动同步。</p>}
    </section>
  );
}
