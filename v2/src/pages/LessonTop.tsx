import { type LessonMode, href } from "../app/router";
import type { Material } from "../db/types";
import { BackIcon, MoreIcon } from "../ui/icons";

const MODES: { mode: LessonMode; label: string }[] = [
  { mode: "listen", label: "听读" },
  { mode: "shadow", label: "跟读" },
  { mode: "practice", label: "练习" }
];

// Title bar and the 听读 / 跟读 / 练习 switch shared by the three lesson modes.
export function LessonTop({ material, mode, trackName, tapeTitle }: { material: Material; mode: LessonMode; trackName: string; tapeTitle: string }) {
  return (
    <div className="lesson-top">
      <header className="lesson-head">
        <a className="icon-button" href={href({ name: "tapes", tapeId: material.tapeId })} aria-label="返回磁带"><BackIcon /></a>
        <div className="grow stack-2">
          <h1 className="lesson-title">{material.title}</h1>
          <span className="mono eyebrow">{[tapeTitle, "SIDE A", trackName].filter(Boolean).join(" · ")}</span>
        </div>
        <a className="icon-button" href={href({ name: "edit", id: material.id })} aria-label="编辑或删除这条素材"><MoreIcon size={22} /></a>
      </header>
      <nav className="segmented lesson-modes" aria-label="学习模式">
        {MODES.map((item) => (
          <a key={item.mode} className="segment" aria-current={item.mode === mode ? "page" : undefined} href={href({ name: "lesson", id: material.id, mode: item.mode })}>
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
