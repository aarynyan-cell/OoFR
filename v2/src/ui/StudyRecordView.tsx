import type { ReactNode } from "react";
import type { Badge, StudyRecord } from "../app/studyRecord";
import { localDateKey } from "../db/defaults";
import { BookmarkIcon, CassetteIcon, CheckIcon, MicIcon, ReelIcon, SparkleIcon } from "./icons";

// 学习记录 on 我的: the streak on a tape counter, a calendar of the last weeks,
// totals, and badges to collect.

const WEEKS = 16;

const BADGE_ICONS: Record<Badge["icon"], (props: { size?: number }) => ReactNode> = {
  reel: ReelIcon,
  mic: MicIcon,
  bookmark: BookmarkIcon,
  check: CheckIcon,
  sparkle: SparkleIcon,
  cassette: CassetteIcon
};

export function StudyRecordView({ record, today = new Date() }: { record: StudyRecord; today?: Date }) {
  const earned = record.badges.filter((badge) => badge.value >= badge.goal).length;
  return (
    <section className="record" aria-label="学习记录">
      <div className="record-hero">
        <div className="stack-6 grow">
          <span className="record-label">连续学习</span>
          <span className="record-counter" aria-label={`连续学习 ${record.streak} 天`}>
            <span className="mono">{String(Math.min(record.streak, 999)).padStart(3, "0")}</span>
            <span className="record-unit">天</span>
          </span>
          <span className="record-today">
            {record.studiedToday ? "今天已经学过了" : record.streak ? "今天还没学：听一课就能接上" : "今天学一点，就是第一天"}
          </span>
        </div>
        <div className="record-reels" aria-hidden="true">
          <span className="reel" />
          <span className="reel" />
        </div>
        <div className="record-best">
          <span>最长</span>
          <b className="mono">{record.bestStreak}</b>
          <span>天</span>
        </div>
      </div>

      <Calendar days={record.days} today={today} />

      <div className="record-totals">
        <Total value={record.daysStudied} label="学习天数" />
        <Total value={record.shadowed} label="跟读句数" />
        <Total value={record.mastered} label="已掌握" />
        <Total value={record.finished} label="听完课文" />
      </div>

      <div className="stack-8">
        <div className="row-between">
          <h3 className="group-title">成就</h3>
          <span className="dim small">已获得 {earned} / {record.badges.length}</span>
        </div>
        <div className="badges">
          {record.badges.map((badge) => (
            <BadgeTile key={badge.id} badge={badge} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Total({ value, label }: { value: number; label: string }) {
  return (
    <div className="record-total">
      <b className="mono">{value}</b>
      <span>{label}</span>
    </div>
  );
}

function BadgeTile({ badge }: { badge: Badge }) {
  const Icon = BADGE_ICONS[badge.icon];
  const done = badge.value >= badge.goal;
  const ratio = Math.min(1, badge.value / badge.goal);
  return (
    <div className={`badge${done ? " is-earned" : ""}`} title={badge.hint}>
      <span className="badge-icon"><Icon size={20} /></span>
      <b className="badge-title">{badge.title}</b>
      {done ? (
        <span className="badge-note">已获得</span>
      ) : (
        <>
          <span className="badge-note">{badge.hint} · {Math.min(badge.value, badge.goal)}/{badge.goal}</span>
          <span className="badge-progress" aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
        </>
      )}
    </div>
  );
}

// The last 16 weeks, a column per week (Monday on top); darker = more studied.
function Calendar({ days, today }: { days: Map<string, number>; today: Date }) {
  const start = new Date(today);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const todayKey = localDateKey(today);
  const cells: { key: string; level: number; future: boolean; month: number; date: number }[] = [];
  for (let index = 0; index < WEEKS * 7; index += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = localDateKey(day);
    const count = days.get(key) ?? 0;
    cells.push({ key, level: count === 0 ? 0 : count < 3 ? 1 : count < 8 ? 2 : 3, future: key > todayKey, month: day.getMonth() + 1, date: day.getDate() });
  }
  const studied = cells.filter((cell) => cell.level > 0).length;
  // A month's name above the week it starts in.
  const months = Array.from({ length: WEEKS }, (_, week) => {
    const first = cells[week * 7];
    const previous = week ? cells[(week - 1) * 7] : null;
    return !previous || previous.month !== first.month ? `${first.month}月` : "";
  });
  return (
    <div className="calendar">
      <div className="calendar-months" aria-hidden="true">
        {months.map((label, week) => (
          <span key={week}>{label}</span>
        ))}
      </div>
      <div className="calendar-grid" role="img" aria-label={`最近 ${WEEKS} 周学习了 ${studied} 天`}>
        {cells.map((cell) => (
          <span key={cell.key} className={`calendar-day level-${cell.level}${cell.future ? " is-future" : ""}${cell.key === todayKey ? " is-today" : ""}`} title={`${cell.month}月${cell.date}日`} />
        ))}
      </div>
      <div className="row-between calendar-foot">
        <span className="dim small">最近 {WEEKS} 周学了 {studied} 天</span>
        <span className="calendar-legend" aria-hidden="true">
          少<span className="calendar-day level-0" /><span className="calendar-day level-1" /><span className="calendar-day level-2" /><span className="calendar-day level-3" />多
        </span>
      </div>
    </div>
  );
}
