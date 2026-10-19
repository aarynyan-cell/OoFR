import { useEffect } from "react";
import { type AiState, cancelAiSetup, progressText, refreshAi, setupAi, useAi } from "../ai/state";
import { useLive } from "../db/live";
import { getSettings, saveSettings } from "../db/repo";
import { Modal } from "./Modal";

// Phones and tablets cannot run the model themselves; they will use the computer's.
export function isPhone(): boolean {
  return /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

// One line for the settings list.
export function aiSummary(ai: AiState): string {
  switch (ai.phase) {
    case "checking":
      return "正在检查…";
    case "ready":
      return `已就绪 · ${ai.model.name}，在这台设备上运行`;
    case "needs-model":
      return "还差一步：下载 AI 模型";
    case "needs-runtime":
      return "点一下，一键安装";
    case "stopped":
      return "没有启动，点一下启动";
    case "working":
      return `${ai.step}… ${progressText(ai.progress)}`;
    default:
      return isPhone() ? "手机的 AI 由电脑提供" : "这个浏览器连不上本机 AI";
  }
}

export function AiPanel() {
  const ai = useAi();
  const settings = useLive(() => getSettings(), []);
  const percent = ai.progress && ai.progress.total > 0 ? Math.round((ai.progress.completed / ai.progress.total) * 100) : 0;
  const gb = ai.model.downloadGb;

  return (
    <div className="stack-10 ai-panel">
      {ai.phase === "checking" && <p className="dim">正在检查这台设备上的 AI…</p>}

      {ai.phase === "ready" && (
        <>
          <span className="pill pill-ok">已就绪 · {ai.model.name}</span>
          <p className="dim small">讲解和译文都在这台设备上生成，不会上传到网络。</p>
          {settings && (
            <label className="check-row">
              <input type="checkbox" checked={settings.aiPrepare} onChange={(event) => void saveSettings({ aiPrepare: event.target.checked })} />
              <span className="grow stack-2">
                <span>打开素材时自动准备</span>
                <span className="dim small">补上缺的译文，并提前生成接下来几句的讲解</span>
              </span>
            </label>
          )}
        </>
      )}

      {ai.phase === "needs-model" && (
        <>
          <p>还差一步：下载 AI 模型 {ai.model.name}（约 {gb} GB，只需下载一次）。</p>
          <button type="button" className="button button-primary button-block" onClick={() => void setupAi()}>一键下载</button>
        </>
      )}

      {ai.phase === "needs-runtime" && (
        <>
          <p>一键装好本机 AI：先装 Ollama（免费、开源，只在这台电脑上运行），再下载 AI 模型（约 {gb} GB）。之后不联网也能用。</p>
          <button type="button" className="button button-primary button-block" onClick={() => void setupAi()}>一键安装</button>
        </>
      )}

      {ai.phase === "stopped" && (
        <>
          <p>本机 AI 没有启动。</p>
          <button type="button" className="button button-primary button-block" onClick={() => void setupAi()}>启动</button>
        </>
      )}

      {ai.phase === "working" && (
        <>
          <p>{ai.step}…</p>
          <span className="progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
          <p className="mono small dim" aria-live="polite">{progressText(ai.progress)}{percent ? ` · ${percent}%` : ""}</p>
          <p className="dim small">可以先去学别的，下载会在后台继续。</p>
          <button type="button" className="button button-outline" onClick={() => void cancelAiSetup()}>取消</button>
        </>
      )}

      {ai.phase === "unreachable" &&
        (isPhone() ? (
          <p>手机上的 AI 由你的电脑提供：在电脑上的 OoFR 里点“连接手机”，再用手机扫码。连接功能即将上线；在那之前，可以在电脑上生成讲解，再把学习包导入手机。</p>
        ) : (
          <>
            <p>这个浏览器连不上本机 AI。用 OoFR 电脑版可以一键安装；如果已经装好 Ollama，打开它后点“重新检测”。</p>
            <button type="button" className="button button-outline" onClick={() => void refreshAi()}>重新检测</button>
          </>
        ))}

      {ai.error && <p className="error-text small" role="alert">{ai.error}</p>}
    </div>
  );
}

export function AiSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    void refreshAi();
  }, []);
  return (
    <Modal title="本机 AI" onClose={onClose}>
      <div className="stack-16 sheet-scroll">
        <h2 className="sheet-title">本机 AI</h2>
        <AiPanel />
        <button type="button" className="button button-outline" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  );
}
