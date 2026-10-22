import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { OoFRDatabase, V2_DB_NAME, setDatabase } from "../src/db/database";
import { copyFromV2 } from "../src/db/fromV2";

// 3.0 installs alongside 2.0 on the same site: on first start it copies 2.0's
// data into its own database and leaves 2.0's untouched.

const stamp = "2026-10-01T10:00:00.000Z";

describe("bringing 2.0's data into 3.0", () => {
  it("copies everything but the pairing, once, and leaves 2.0 as it was", async () => {
    const v2 = new OoFRDatabase(V2_DB_NAME);
    await v2.tapes.add({ id: "t", title: "旅行", description: "", color: "#E9C46A", order: 0, createdAt: stamp, updatedAt: stamp });
    await v2.kv.bulkPut([
      { key: "settings", value: { rate: 0.75 } },
      { key: "pairing", value: { key: "secret" } }
    ]);
    v2.close();

    const v3 = new OoFRDatabase("oofr3-test-a");
    setDatabase(v3);
    expect(await copyFromV2()).toBe(1);
    expect((await v3.tapes.get("t"))?.title).toBe("旅行");
    expect((await v3.kv.get("settings"))?.value).toEqual({ rate: 0.75 });
    expect(await v3.kv.get("pairing")).toBeUndefined();
    // Once only.
    await v3.tapes.clear();
    expect(await copyFromV2()).toBe(0);
    expect(await v3.tapes.count()).toBe(0);

    const again = new OoFRDatabase(V2_DB_NAME);
    expect(await again.tapes.count()).toBe(1);
    expect((await again.kv.get("pairing"))?.value).toEqual({ key: "secret" });
    again.close();
  });

  it("leaves a 3.0 that already has data alone", async () => {
    const v3 = new OoFRDatabase("oofr3-test-b");
    setDatabase(v3);
    await v3.tapes.add({ id: "mine", title: "我的", description: "", color: "#7CC1B6", order: 0, createdAt: stamp, updatedAt: stamp });
    expect(await copyFromV2()).toBe(0);
    expect((await v3.tapes.toArray()).map((tape) => tape.id)).toEqual(["mine"]);
  });
});
