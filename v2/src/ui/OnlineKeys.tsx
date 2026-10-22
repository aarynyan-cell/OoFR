import { useEffect, useState } from "react";
import { OnlineBackend, PROVIDERS, type ProviderId, cleanKeys, loadKeys, looksComplete, saveKeys } from "../ai/online";
import { refreshAi, useAi } from "../ai/state";
import { toast } from "../app/toast";
import { confirmAction } from "./Confirm";

// "sk-abcd…wxyz": enough to tell keys apart without showing them.
const masked = (key: string) => (key.length > 12 ? `${key.slice(0, 5)}…${key.slice(-4)}` : "…");

type Checks = Record<string, "checking" | "ok" | "bad">;

// Free online AI with the learner's own keys (2.1). Keys stay on this device.
export function OnlineKeys() {
  const ai = useAi();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<Record<ProviderId, string>>({ siliconflow: "", zhipu: "" });
  const [saved, setSaved] = useState<Record<ProviderId, string[]>>({ siliconflow: [], zhipu: [] });
  const [checks, setChecks] = useState<Checks>({});

  useEffect(() => {
    void loadKeys().then((keys) => {
      setSaved(keys);
      if (!keys.siliconflow.length && !keys.zhipu.length) setEditing(true);
    });
  }, []);

  // An empty box keeps that provider's keys.
  const save = async () => {
    const typed = { siliconflow: cleanKeys(text.siliconflow), zhipu: cleanKeys(text.zhipu) };
    // Half a key (most often Zhipu's, copied only up to the dot) is not kept.
    const incomplete = (Object.keys(typed) as ProviderId[]).filter((provider) => typed[provider].some((key) => !looksComplete(provider, key)));
    if (incomplete.length) {
      toast(incomplete.includes("zhipu") ? "智谱的密钥不完整：完整的密钥中间有一个点，像 xxxx.yyyy，请整串复制" : "硅基流动的密钥不完整：应该以 sk- 开头，请整串复制");
      return;
    }
    const keys = {
      siliconflow: text.siliconflow.trim() ? typed.siliconflow : saved.siliconflow,
      zhipu: text.zhipu.trim() ? typed.zhipu : saved.zhipu
    };
    await saveKeys(keys);
    setSaved(keys);
    setEditing(!keys.siliconflow.length && !keys.zhipu.length);
    setText({ siliconflow: "", zhipu: "" });
    await refreshAi();
    void check(keys);
  };

  // Test versions on this Mac: the keys in v2/.env.local, without typing them.
  const loadTestKeys = async () => {
    try {
      const response = await fetch("./__oofr_dev_keys");
      if (!response.ok) throw new Error(String(response.status));
      const keys = (await response.json()) as Record<ProviderId, string[]>;
      setText({ siliconflow: keys.siliconflow.join("\n"), zhipu: keys.zhipu.join("\n") });
    } catch {
      toast("只能在装着测试密钥文件的这台电脑上读取");
    }
  };

  const check = async (keys = saved) => {
    const all = (Object.keys(keys) as ProviderId[]).flatMap((provider) => keys[provider].map((key) => [provider, key] as const));
    setChecks(Object.fromEntries(all.map(([, key]) => [key, "checking"])));
    for (const [provider, key] of all) {
      const ok = await OnlineBackend.check(provider, key);
      setChecks((current) => ({ ...current, [key]: ok ? "ok" : "bad" }));
    }
  };

  const count = saved.siliconflow.length + saved.zhipu.length;
  const results = Object.values(checks);
  const allBad = results.length > 0 && results.every((result) => result === "bad");

  const clear = async () => {
    if (!(await confirmAction("清除这台设备上保存的全部在线 AI 密钥？", { confirmLabel: "清除", danger: true }))) return;
    const empty = { siliconflow: [], zhipu: [] };
    await saveKeys(empty);
    setSaved(empty);
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
            <span className="pill error-text">密钥都不可用：请检查是否复制完整、是否已实名认证</span>
          ) : (
            <span className="pill pill-ok">{saved.zhipu.length ? "已就绪 · 在线翻译和讲解" : "已就绪 · 在线翻译"}</span>
          )}
          {!saved.zhipu.length && <p className="small accent-text">讲解和“释义有误？”的检查要用智谱的免费密钥，加上后就能用。</p>}
          <ul className="stack-4 key-list">
            {(Object.keys(saved) as ProviderId[]).flatMap((provider) =>
              saved[provider].map((key) => (
                <li key={key} className="small">
                  {PROVIDERS[provider].name} <span className="mono dim">{masked(key)}</span>{" "}
                  {checks[key] === "checking" ? <span className="dim">检测中…</span> : checks[key] === "ok" ? <span className="ok-text">可用</span> : checks[key] === "bad" ? <span className="error-text">不可用</span> : null}
                </li>
              ))
            )}
          </ul>
          <p className="dim small">手机和电脑都能直接用，不需要电脑上的 AI。密钥只存在这台设备上，不会备份或同步；句子会发给你选的服务商。</p>
          <div className="row-8">
            <button type="button" className="button button-small button-outline" onClick={() => void check()}>检测密钥</button>
            <button type="button" className="button button-small button-outline" onClick={() => setEditing(true)}>修改密钥</button>
          </div>
        </>
      ) : (
        <>
          <p className="dim small">
            填入你自己的免费密钥，手机和电脑都能直接生成译文和讲解。注册：
            <a href={PROVIDERS.siliconflow.signup} target="_blank" rel="noreferrer">硅基流动</a>（需实名认证）、
            <a href={PROVIDERS.zhipu.signup} target="_blank" rel="noreferrer">智谱</a>，在控制台的“API 密钥”里新建一个，复制过来。
          </p>
          {(Object.keys(PROVIDERS) as ProviderId[]).map((provider) => (
            <label key={provider} className="stack-4">
              <span className="small">{PROVIDERS[provider].name} 密钥{saved[provider].length ? `（已有 ${saved[provider].length} 个，留空则不变）` : ""}</span>
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
            <button
              type="button"
              className="button button-small button-primary"
              onClick={() => void save()}
            >
              保存
            </button>
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
