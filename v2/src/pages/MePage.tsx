import { type ChangeEvent, useState } from "react";
import { speakOnce, useVoices } from "../app/audio";
import { useV1Migration } from "../app/migration";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { currentStreak, getSettings, getStudy, saveSettings } from "../db/repo";
import type { ThemeChoice } from "../db/types";
import { importV1File } from "../migrate/v1-import";
import { canDownloadBetterVoice, frenchVoices, pickVoice, voiceId, voiceLabel } from "../speech/voices";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "night", label: "夜读" },
  { value: "day", label: "日间" },
  { value: "system", label: "跟随系统" }
];

export function MePage() {
  const settings = useLive(() => getSettings(), []);
  const study = useLive(() => getStudy(), []);
  const materialCount = useLive(() => db.materials.count(), []);
  const knownCount = useLive(() => db.cards.where("status").equals("got").count(), []);
  const voices = useVoices();
  const { detection, busy, importNow, refresh } = useV1Migration();
  const [importing, setImporting] = useState(false);

  const french = frenchVoices(voices);
  const active = settings ? pickVoice(voices, settings.voice) : null;

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const added = await importV1File(await file.text());
      toast(added.materials || added.cards ? `已导入 ${added.materials} 条素材、${added.cards} 个词句` : "文件里的内容都已经在这里了");
      refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const migrationNote =
    detection?.status === "found"
      ? `这台设备上有 1.0 的数据：${detection.counts?.materials ?? 0} 条素材、${detection.counts?.cards ?? 0} 个词句`
      : detection?.status === "imported"
        ? `已于 ${new Date(detection.record?.importedAt ?? "").toLocaleDateString("zh-CN")} 搬过来，可以再搬一次补上新内容`
        : detection?.status === "unreadable"
          ? "1.0 的数据读不出来，请在 1.0 里导出备份后用下面的“导入 1.0 备份”"
          : "这台设备上没有 1.0 的数据";

  return (
    <main className="page">
      <h1 className="page-title">我的</h1>

      <section className="stats" aria-label="学习统计">
        <div className="stat"><b className="mono accent-text">{study ? currentStreak(study) : 0}</b><span>连续学习天数</span></div>
        <div className="stat"><b className="mono">{materialCount ?? 0}</b><span>素材</span></div>
        <div className="stat"><b className="mono ok-text">{knownCount ?? 0}</b><span>已掌握词句</span></div>
      </section>

      <section className="stack-6">
        <h2 className="group-title">数据与迁移</h2>
        <div className="list">
          <button type="button" className="list-row list-button" onClick={importNow} disabled={busy || detection?.status === "none" || detection?.status === "unreadable"}>
            <span className="grow stack-2"><span>从 1.0 搬过来</span><span className="dim small">{migrationNote}</span></span>
            <span className="muted small">{busy ? "正在搬…" : ""}</span>
          </button>
          <label className="list-row list-button">
            <span className="grow stack-2"><span>导入 1.0 备份文件</span><span className="dim small">1.0 网页版、插件或 Mac 版导出的 .json</span></span>
            <span className="muted small">{importing ? "正在导入…" : ""}</span>
            <input type="file" accept=".json,application/json" className="visually-hidden" onChange={importFile} disabled={importing} />
          </label>
        </div>
        <p className="dim small note">搬运只会复制，不会改动或删除 1.0 里的任何内容。</p>
      </section>

      <section className="stack-6">
        <h2 className="group-title">朗读与 AI</h2>
        <div className="list">
          <label className="list-row">
            <span className="grow">朗读声音</span>
            <select
              className="select-plain"
              value={active ? voiceId(active) : ""}
              onChange={(event) => {
                void saveSettings({ voice: event.target.value });
                const chosen = french.find((voice) => voiceId(voice) === event.target.value);
                if (chosen && settings) speakOnce("Bonjour, je suis prêt.", { ...settings, voice: event.target.value });
              }}
              disabled={!french.length}
            >
              {french.length ? french.map((voice) => <option key={voiceId(voice)} value={voiceId(voice)}>{voiceLabel(voice)}</option>) : <option value="">没有法语声音</option>}
            </select>
          </label>
          {canDownloadBetterVoice(voices, navigator.userAgent) && (
            <p className="list-note">iPhone / Mac 可以在 设置 → 辅助功能 → 朗读内容 → 声音 → 法语 里免费下载“增强版”声音，会自然很多。</p>
          )}
          <div className="list-row">
            <span className="grow stack-2"><span>AI 讲解</span><span className="dim small">下一步上线：电脑一键安装，手机自动连上电脑</span></span>
          </div>
        </div>
      </section>

      <section className="list">
        <div className="list-row">
          <span className="grow">外观</span>
          <div className="segmented segmented-inline" role="group" aria-label="外观">
            {THEMES.map((theme) => (
              <button key={theme.value} type="button" className="segment" aria-pressed={settings?.theme === theme.value} onClick={() => void saveSettings({ theme: theme.value })}>
                {theme.label}
              </button>
            ))}
          </div>
        </div>
        <div className="list-row">
          <span className="grow">版本</span>
          <span className="mono muted small">{__APP_VERSION__}</span>
        </div>
      </section>
    </main>
  );
}
