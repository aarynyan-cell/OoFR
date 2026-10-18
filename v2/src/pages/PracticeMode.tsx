import type { Material, Settings } from "../db/types";
import { LessonTop } from "./LessonTop";

// Placeholder until the practice cards land (next step of milestone 2).
export function PracticeMode({ material, trackName, tapeTitle }: { material: Material; settings: Settings; trackName: string; tapeTitle: string }) {
  return (
    <main className="page page-lesson">
      <LessonTop material={material} mode="practice" trackName={trackName} tapeTitle={tapeTitle} />
      <p className="empty">练习正在制作中。</p>
    </main>
  );
}
