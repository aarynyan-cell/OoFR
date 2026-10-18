// What a first-time learner sees: one tape with the 1.0 demo lesson. Only added
// when 2.0 is empty and there is no 1.0 data waiting to be brought over (that
// data usually holds the same demo lesson already).

import { db } from "./database";
import { nowIso } from "./defaults";
import type { Material, Tape } from "./types";

export const STARTER_TAPE_ID = "starter_tape";
export const STARTER_MATERIAL_ID = "demo_lesson";

const DEMO = [
  ["Bonjour, comment allez-vous aujourd'hui ?", "你好，今天过得怎么样？", "a", "Camille"],
  ["Je vais bien, merci. Et vous ?", "我很好，谢谢。你呢？", "b", "Alex"],
  ["Je voudrais pratiquer le français pendant dix minutes.", "我想练习十分钟法语。", "a", "Camille"],
  ["Bien sûr, on peut commencer quand vous voulez.", "当然，你想什么时候开始都可以。", "b", "Alex"],
  ["Pouvez-vous répéter cette phrase plus lentement ?", "你可以把这句话说慢一点吗？", "a", "Camille"],
  ["Bien sûr. À tout à l'heure !", "当然。待会儿见！", "b", "Alex"]
] as const;

export function starterContent(): { tape: Tape; material: Material } {
  const timestamp = nowIso();
  return {
    tape: { id: STARTER_TAPE_ID, title: "入门练习", description: "第一盘磁带", color: "#E9C46A", order: 0, createdAt: timestamp, updatedAt: timestamp },
    material: {
      id: STARTER_MATERIAL_ID,
      tapeId: STARTER_TAPE_ID,
      title: "每天十分钟法语",
      language: "fr",
      materialType: "情景对话",
      description: "用一段轻量对话练习问候、重复和时间表达。",
      notes: "",
      sentences: DEMO.map(([text, translation, speakerId, speakerLabel], index) => ({
        id: `demo_turn_${index + 1}`,
        text,
        translation,
        speakerId,
        speakerLabel,
        explanation: null,
        recordingKey: "",
        recordingMs: 0
      })),
      lexicalUnits: [],
      position: 0,
      finishedAt: null,
      studyCount: 0,
      lastStudiedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };
}

export async function addStarterContentIfEmpty(): Promise<boolean> {
  return db.transaction("rw", db.tapes, db.materials, async () => {
    if ((await db.tapes.count()) || (await db.materials.count())) return false;
    const { tape, material } = starterContent();
    await db.tapes.add(tape);
    await db.materials.add(material);
    return true;
  });
}
