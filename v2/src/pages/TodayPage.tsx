import { href } from "../app/router";
import { useV1Migration } from "../app/migration";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { currentStreak, getStudy, materialsOfTape, progressOf, recentMaterials, reviewQueue, trackLabel } from "../db/repo";
import type { Material, Tape } from "../db/types";
import { frenchSpacing } from "../text/typography";
import { CassetteCover, MiniCassette } from "../ui/Cassette";
import { ChevronIcon, PlayIcon, ReelIcon } from "../ui/icons";

function greeting(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function TodayPage() {
  const now = new Date();
  const study = useLive(() => getStudy(), []);
  const tapes = useLive(() => db.tapes.toArray(), []);
  const materials = useLive(() => db.materials.toArray(), []);
  const recent = useLive(() => recentMaterials(3), []);
  const cardCount = useLive(() => db.cards.count(), []);
  const dueCount = useLive(async () => reviewQueue(await db.cards.toArray()).length, []);
  const { detection, busy, importNow } = useV1Migration();

  const tapeOf = (material: Material) => tapes?.find((tape) => tape.id === material.tapeId);
  // Nothing played yet: suggest the first material of the first tape.
  const firstTape = tapes?.slice().sort((a, b) => a.order - b.order).find((tape) => materials?.some((material) => material.tapeId === tape.id));
  const current = recent?.[0] ?? (firstTape ? materialsOfTape(materials ?? [], firstTape.id)[0] : undefined);
  const streak = study ? currentStreak(study, now) : 0;

  return (
    <main className="page">
      <header className="page-head">
        <div className="stack-4">
          <span className="mono eyebrow">{`${now.getMonth() + 1}.${now.getDate()} · ${WEEKDAYS[now.getDay()]}`}</span>
          <h1 className="page-title">{greeting(now.getHours())}</h1>
        </div>
        {streak > 0 && <span className="pill pill-accent">连续 {streak} 天</span>}
      </header>

      {detection?.status === "found" && detection.counts && (
        <section className="card migrate-card" aria-label="1.0 的学习数据">
          <div className="stack-4">
            <b>发现 1.0 的学习数据</b>
            <span className="muted small">
              {detection.counts.tapes} 盘磁带 · {detection.counts.materials} 条素材 · {detection.counts.cards} 个词句
              {detection.counts.recordings ? ` · ${detection.counts.recordings} 段录音` : ""}
            </span>
            <span className="dim small">只是复制过来，1.0 里的原数据不会改动。</span>
          </div>
          <button type="button" className="button button-primary" onClick={importNow} disabled={busy}>
            {busy ? "正在搬…" : "一键搬过来"}
          </button>
        </section>
      )}

      {current && <ContinueCard material={current} tape={tapeOf(current)} materials={materials ?? []} />}

      {dueCount ? (
        <a className="card row-link" href={href({ name: "review" })}>
          <span className="icon-tile icon-tile-ok"><ReelIcon size={22} /></span>
          <span className="grow stack-2">
            <b>今日复习 {dueCount} 个词句</b>
            <span className="muted small">约 {Math.max(1, Math.round((dueCount * 12) / 60))} 分钟</span>
          </span>
          <ChevronIcon size={20} />
        </a>
      ) : (
        <a className="card row-link" href={href({ name: "phrases" })}>
          <span className="icon-tile icon-tile-ok"><ReelIcon size={22} /></span>
          <span className="grow stack-2">
            <b>词句本</b>
            <span className="muted small">{cardCount ? `已收藏 ${cardCount} 个词句，今天的复习都做完了` : "在课程里点“收藏”，好句子会出现在这里"}</span>
          </span>
          <ChevronIcon size={20} />
        </a>
      )}

      <section className="stack-8">
        <div className="section-head">
          <h2 className="section-title">最近听过</h2>
          <a className="text-button" href={href({ name: "add" })}>＋ 新建素材</a>
        </div>
        {recent && recent.length > 0 ? (
          <div className="list">
            {recent.map((material) => (
              <a key={material.id} className="list-row" href={href({ name: "lesson", id: material.id })}>
                <MiniCassette color={tapeOf(material)?.color ?? "#D8D3C4"} />
                <span className="grow stack-2">
                  <b>{material.title}</b>
                  <span className="muted small">{tapeOf(material)?.title ?? "磁带"} · {material.sentences.length} 句 · {progressOf(material).label}</span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="empty">还没有听过的素材。打开一盘磁带开始吧。</p>
        )}
      </section>
    </main>
  );
}

function ContinueCard({ material, tape, materials }: { material: Material; tape?: Tape; materials: Material[] }) {
  const total = material.sentences.length;
  const position = Math.min(material.position, total - 1);
  const track = tape ? materialsOfTape(materials, tape.id).findIndex((item) => item.id === material.id) : -1;
  const progress = progressOf(material);
  return (
    <section className="card continue-card" aria-label="继续播放">
      <CassetteCover
        color={tape?.color ?? "#E9C46A"}
        title={material.title}
        side={track >= 0 ? trackLabel(track).slice(0, 1) : "A"}
        counter={`${String(position + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`}
        progress={progress.ratio}
      />
      <div className="continue-row">
        <div className="grow stack-4">
          <span className="dim small">{progress.started ? "上次停在" : "从这里开始"}</span>
          <p className="fr continue-text" lang={material.language}>{frenchSpacing(material.sentences[position]?.text ?? "")}</p>
        </div>
        <a className="round-button round-accent" href={href({ name: "lesson", id: material.id })} aria-label={`继续播放 ${material.title}`}>
          <PlayIcon size={22} />
        </a>
      </div>
    </section>
  );
}
