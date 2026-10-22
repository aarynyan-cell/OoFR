import { type ChangeEvent, useState } from "react";
import { tauri } from "../ai/backend";
import { useAi } from "../ai/state";
import { speakOnce, useVoices } from "../app/audio";
import { useV1Migration } from "../app/migration";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { currentStreak, getSettings, getStudy, saveSettings, shadowedThisWeek } from "../db/repo";
import type { ThemeChoice } from "../db/types";
import { backupFileName, createBackup, importAnyFile, restoreSnapshot, snapshotInfo } from "../backup/backup";
import { shareOrDownload } from "../app/download";
import { canDownloadBetterVoice, frenchVoices, pickVoice, voiceId, voiceLabel, voiceQuality } from "../speech/voices";
import { AiSheet, aiSummary } from "../ui/AiSheet";
import { ChevronIcon } from "../ui/icons";
import { confirmAction } from "../ui/Confirm";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "night", label: "夜读" },
  { value: "day", label: "日间" },
  { value: "system", label: "跟随系统" }
];

// Apple lets web pages (Safari, the iPhone home-screen app) use only the two basic
// voices; downloaded enhanced voices work in the Mac app and in Edge / Chrome.
function voiceNote(voices: SpeechSynthesisVoice[]): string {
  const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const webkitOnly = apple && !/Chrome|Edg\//.test(navigator.userAgent) && !tauri();
  if (voices.some((voice) => voice.voiceURI?.startsWith("mac:"))) return "已连接电脑：选带“电脑朗读”的声音，由电脑用增强版声音读，读过的句子会存在这台设备上，之后不连电脑也能用。";
  if (webkitOnly) return "苹果只允许网页使用两个基础声音，系统里下载的“增强版”只有应用能用。手机和电脑上的 OoFR 应用扫码连接后，就会用电脑的增强版声音朗读。";
  if (canDownloadBetterVoice(voices, navigator.userAgent)) return "可以在 系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音 里免费下载法语“增强版”声音，会自然很多。";
  return "";
}

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days <= 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`;
}

export function MePage() {
  const settings = useLive(() => getSettings(), []);
  const study = useLive(() => getStudy(), []);
  const knownCount = useLive(() => db.cards.where("status").equals("got").count(), []);
  const voices = useVoices();
  const { detection, busy, importNow, refresh } = useV1Migration();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const undoInfo = useLive(() => snapshotInfo(), []);
  const ai = useAi();
  const [aiOpen, setAiOpen] = useState(false);

  // The joke voices (Grandma, Eddy…) stay out of the list unless one is already chosen.
  const french = frenchVoices(voices).filter((voice) => voiceQuality(voice) !== "novelty" || voiceId(voice) === settings?.voice);
  const active = settings ? pickVoice(voices, settings.voice) : null;
  // 后台播放 joins the Mac's voice into one track: the Mac app always has it, a phone once it has met the Mac.
  const macVoice = Boolean(tauri()) || voices.some((voice) => voice.voiceURI?.startsWith("mac:"));

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const { kind, added, updated } = await importAnyFile(await file.text());
      const parts = [added.materials && `${added.materials} 条素材`, added.cards && `${added.cards} 个词句`, added.recordings && `${added.recordings} 段录音`, updated && `更新 ${updated} 项`].filter(Boolean);
      const what = kind === "package" ? "学习包" : kind === "v1" ? "1.0 备份" : "备份";
      toast(parts.length ? `${what}已导入：${parts.join("、")}` : `${what}里的内容都已经在这里了`);
      refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const backup = await createBackup(__APP_VERSION__);
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      const outcome = await shareOrDownload(blob, backupFileName());
      if (outcome !== "cancelled") {
        await saveSettings({ lastBackupAt: new Date().toISOString() });
        toast(`备份已生成（${(blob.size / 1024 / 1024).toFixed(1)} MB），请存到安全的地方`);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "备份没能生成");
    } finally {
      setExporting(false);
    }
  };

  const undoImport = async () => {
    if (!undoInfo || !(await confirmAction(`把素材和词句本恢复到 ${new Date(undoInfo.at).toLocaleString("zh-CN")} 导入之前的样子？之后新增的内容会一起撤回。`, { confirmLabel: "撤回" }))) return;
    toast((await restoreSnapshot()) ? "已恢复到导入之前" : "没有可以恢复的数据");
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
        <div className="stat"><b className="mono">{study ? shadowedThisWeek(study) : 0}</b><span>本周跟读句数</span></div>
        <div className="stat"><b className="mono ok-text">{knownCount ?? 0}</b><span>已掌握词句</span></div>
      </section>

      <section className="stack-6">
        <h2 className="group-title">数据与迁移</h2>
        <div className="list">
          <button type="button" className="list-row list-button" onClick={importNow} disabled={busy || detection?.status === "none" || detection?.status === "unreadable"}>
            <span className="grow stack-2"><span>从 1.0 搬过来</span><span className="dim small">{migrationNote}</span></span>
            <span className="muted small">{busy ? "正在搬…" : ""}</span>
          </button>
          <button type="button" className="list-row list-button" onClick={exportAll} disabled={exporting}>
            <span className="grow stack-2"><span>导出完整备份</span><span className="dim small">素材、词句本、复习进度和录音都在里面</span></span>
            <span className="muted small">{exporting ? "正在生成…" : settings?.lastBackupAt ? `上次 ${relativeDays(settings.lastBackupAt)}` : "还没备份过"}</span>
          </button>
          <label className="list-row list-button">
            <span className="grow stack-2"><span>导入备份或学习包</span><span className="dim small">2.0 备份、1.0 备份、电脑做好的学习包都可以</span></span>
            <span className="muted small">{importing ? "正在导入…" : ""}</span>
            <input type="file" accept=".json,application/json" className="visually-hidden" onChange={importFile} disabled={importing} />
          </label>
          {undoInfo && (
            <button type="button" className="list-row list-button" onClick={undoImport}>
              <span className="grow stack-2"><span>恢复导入前的数据</span><span className="dim small">撤回 {new Date(undoInfo.at).toLocaleString("zh-CN")} 的导入</span></span>
            </button>
          )}
        </div>
        <p className="dim small note">导入只会添加或补全，不会删除；搬运 1.0 只是复制，1.0 里的内容不会改动。</p>
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
          {voiceNote(voices) && <p className="list-note">{voiceNote(voices)}</p>}
          <div className="list-row">
            <span className="grow">每句读几遍</span>
            <div className="segmented segmented-inline segmented-count" role="group" aria-label="每句读几遍">
              {[1, 2, 3, 4, 5].map((count) => (
                <button key={count} type="button" className="segment" aria-pressed={settings?.repeat === count} aria-label={`${count} 遍`} onClick={() => void saveSettings({ repeat: count })}>
                  {count}
                </button>
              ))}
            </div>
          </div>
          <label className="list-row">
            <span className="grow stack-2">
              <span>后台播放</span>
              <span className="dim small">{macVoice ? "锁屏或切到别的 App 时，整课接着播放" : "锁屏时接着播放整课。要用电脑朗读的声音，先连接一次电脑"}</span>
            </span>
            <input type="checkbox" className="switch" checked={settings?.backgroundPlay ?? false} onChange={(event) => void saveSettings({ backgroundPlay: event.target.checked })} />
          </label>
          <button type="button" className="list-row list-button" onClick={() => setAiOpen(true)}>
            <span className="grow stack-2"><span>本机 AI</span><span className="dim small">{aiSummary(ai)}</span></span>
            <ChevronIcon size={18} />
          </button>
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
      {aiOpen && <AiSheet onClose={() => setAiOpen(false)} />}
    </main>
  );
}
