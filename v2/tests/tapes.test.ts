import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { OoFRDatabase, db, setDatabase } from "../src/db/database";
import { TAPE_COLORS } from "../src/db/defaults";
import { createTape, freshTapeColor, listTapes, reorderTapes, spreadTapeColors } from "../src/db/repo";
import type { Tape } from "../src/db/types";

let run = 0;
beforeEach(() => {
  setDatabase(new OoFRDatabase(`oofr2-tapes-${(run += 1)}`));
});

const tape = (id: string, color: string, createdAt: string, order = 0): Tape => ({ id, title: id, description: "", color, order, createdAt, updatedAt: createdAt });

describe("tape label colours", () => {
  it("gives each new tape a colour no other tape has, while there are some left", async () => {
    const made = [];
    for (let index = 0; index < TAPE_COLORS.length; index += 1) made.push(await createTape(`磁带 ${index}`));
    expect(new Set(made.map((item) => item.color)).size).toBe(TAPE_COLORS.length);
    // All taken: the least used one comes back.
    expect(TAPE_COLORS).toContain((await createTape("又一盘")).color);
  });

  it("picks the least used colour, in palette order", () => {
    expect(freshTapeColor([])).toBe(TAPE_COLORS[0]);
    expect(freshTapeColor([{ color: TAPE_COLORS[0].toLowerCase() }, { color: TAPE_COLORS[2] }])).toBe(TAPE_COLORS[1]);
  });

  it("spreads tapes that share a colour once; the oldest keeps its colour and user choices after that stay", async () => {
    await db.tapes.bulkAdd([
      tape("a", TAPE_COLORS[0], "2026-01-01T00:00:00.000Z"),
      tape("b", TAPE_COLORS[0], "2026-01-02T00:00:00.000Z"),
      tape("c", TAPE_COLORS[1], "2026-01-03T00:00:00.000Z"),
      tape("d", TAPE_COLORS[1], "2026-01-04T00:00:00.000Z")
    ]);
    expect(await spreadTapeColors()).toBe(2);
    const colors = (await db.tapes.toArray()).sort((x, y) => x.id.localeCompare(y.id)).map((item) => item.color);
    expect(colors[0]).toBe(TAPE_COLORS[0]);
    expect(colors[2]).toBe(TAPE_COLORS[1]);
    expect(new Set(colors).size).toBe(4);
    // Later the learner may give two tapes the same colour on purpose.
    await db.tapes.update("d", { color: TAPE_COLORS[0] });
    expect(await spreadTapeColors()).toBe(0);
    expect((await db.tapes.get("d"))?.color).toBe(TAPE_COLORS[0]);
  });
});

describe("tape order", () => {
  it("keeps the dragged order without touching what syncs", async () => {
    await db.tapes.bulkAdd([tape("a", "#111111", "2026-01-01T00:00:00.000Z", 0), tape("b", "#222222", "2026-01-01T00:00:00.000Z", 1), tape("c", "#333333", "2026-01-01T00:00:00.000Z", 2)]);
    await reorderTapes(["c", "a", "b"]);
    const tapes = await listTapes();
    expect(tapes.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(tapes.every((item) => item.updatedAt === "2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("puts a new tape at the end", async () => {
    await db.tapes.bulkAdd([tape("a", "#111111", "2026-01-01T00:00:00.000Z", 5)]);
    expect((await createTape("新的")).order).toBe(6);
  });
});
