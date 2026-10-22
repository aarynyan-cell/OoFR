import { type FormEvent, useState } from "react";
import { href, navigate } from "../app/router";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { TAPE_PALETTE } from "../db/defaults";
import { useLive } from "../db/live";
import { createTape, deleteTape, freshTapeColor, listTapes, materialsOfTape, progressOf, reorderTapes, trackLabel, updateTape } from "../db/repo";
import type { Material, Tape } from "../db/types";
import { Modal } from "../ui/Modal";
import { TapeShelf } from "../ui/TapeShelf";
import { ChevronIcon, SearchIcon } from "../ui/icons";
import { confirmAction } from "../ui/Confirm";

export function TapesPage({ tapeId }: { tapeId?: string }) {
  const tapes = useLive(() => listTapes(), []);
  const materials = useLive(() => db.materials.toArray(), []);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingTape, setEditingTape] = useState<Tape | null>(null);

  const selected = tapes?.find((tape) => tape.id === tapeId) ?? tapes?.[0];
  const needle = query.trim().toLocaleLowerCase("fr-FR");
  const shown: { material: Material; index: number; tape?: Tape }[] = needle
    ? (materials ?? [])
        .filter((material) => `${material.title} ${material.sentences.map((sentence) => sentence.text).join(" ")}`.toLocaleLowerCase("fr-FR").includes(needle))
        .map((material) => {
          const tape = tapes?.find((item) => item.id === material.tapeId);
          return { material, tape, index: tape ? materialsOfTape(materials ?? [], tape.id).indexOf(material) : 0 };
        })
    : selected
      ? materialsOfTape(materials ?? [], selected.id).map((material, index) => ({ material, index, tape: selected }))
      : [];

  return (
    <main className="page page-flush">
      <header className="page-head gutter">
        <h1 className="page-title">磁带</h1>
        <button type="button" className="button button-outline button-small" onClick={() => setCreating(true)}>＋ 新建磁带</button>
      </header>

      {tapes && (
        <TapeShelf
          tapes={tapes}
          counts={new Map(tapes.map((tape) => [tape.id, materialsOfTape(materials ?? [], tape.id).length]))}
          selectedId={needle ? undefined : selected?.id}
          onReorder={(ids) => {
            // The tape being looked at stays open (without one in the address, the first tape is shown).
            if (!tapeId && selected) navigate({ name: "tapes", tapeId: selected.id }, { replace: true });
            void reorderTapes(ids);
          }}
        />
      )}

      <label className="search gutter-margin">
        <SearchIcon size={18} />
        <span className="visually-hidden">搜索素材</span>
        <input type="search" placeholder="搜索所有磁带里的素材" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      <section className="gutter stack-8">
        <div className="section-head">
          <h2 className="section-title">
            {needle ? `搜索结果 · ${shown.length} 条` : <><span className="mono accent-text small">SIDE A</span> {selected?.title ?? ""}</>}
          </h2>
          <span className="row-8">
            {selected && !needle && <button type="button" className="text-button" onClick={() => setEditingTape(selected)}>编辑磁带</button>}
            <a className="text-button" href={href({ name: "add", tapeId: selected?.id })}>＋ 新建素材</a>
          </span>
        </div>
        {shown.length ? (
          <div className="list">
            {shown.map(({ material, index, tape }) => {
              const progress = progressOf(material);
              return (
                <a key={material.id} className="list-row" href={href({ name: "lesson", id: material.id })}>
                  <span className={`mono track${progress.started && !progress.done ? " accent-text" : ""}`}>{trackLabel(index)}</span>
                  <span className="grow stack-4">
                    <b>{material.title}</b>
                    <span className={`small ${progress.done ? "ok-text" : "muted"}`}>
                      {needle && tape ? `${tape.title} · ` : ""}{material.sentences.length} 句 · {progress.label}
                    </span>
                    <span className="progress" aria-hidden="true">
                      <span className={progress.done ? "progress-done" : ""} style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                    </span>
                  </span>
                  <ChevronIcon size={20} />
                </a>
              );
            })}
          </div>
        ) : (
          <p className="empty">{needle ? "没有找到相关素材" : "这盘磁带还是空的，点“新建素材”粘贴一段法语吧。"}</p>
        )}
      </section>

      {creating && <TapeSheet tapes={tapes ?? []} onClose={() => setCreating(false)} />}
      {editingTape && <TapeSheet tape={editingTape} tapes={tapes ?? []} onClose={() => setEditingTape(null)} />}
    </main>
  );
}

// New tape, or (with a tape) rename, recolour or delete it.
function TapeSheet({ tape, tapes, onClose }: { tape?: Tape; tapes: Tape[]; onClose: () => void }) {
  const [title, setTitle] = useState(tape?.title ?? "");
  // A new tape starts with a colour no other tape has.
  const [color, setColor] = useState(tape?.color ?? freshTapeColor(tapes));
  const others = tapes.filter((item) => item.id !== tape?.id);
  const choices = [...TAPE_PALETTE, ...(TAPE_PALETTE.some((item) => item.color.toUpperCase() === color.toUpperCase()) ? [] : [{ color, name: "原来的颜色" }])];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (tape) {
      await updateTape(tape.id, { title, color });
      toast("已保存");
      onClose();
      return;
    }
    const created = await createTape(title, color);
    toast(`已新建磁带：${created.title}`);
    onClose();
    navigate({ name: "tapes", tapeId: created.id });
  };
  const remove = async () => {
    if (!tape || !(await confirmAction(`删除磁带「${tape.title}」？里面的素材不会删除，会移到另一盘磁带。`, { confirmLabel: "删除", danger: true }))) return;
    const { movedTo, moved } = await deleteTape(tape.id);
    toast(moved ? `已删除，${moved} 条素材移到了「${movedTo}」` : "已删除");
    onClose();
    navigate({ name: "tapes" }, { replace: true });
  };
  return (
    <Modal title={tape ? "编辑磁带" : "新建磁带"} onClose={onClose}>
      <form className="stack-16" onSubmit={submit}>
        <h2 className="sheet-title">{tape ? "编辑磁带" : "新建磁带"}</h2>
        <label className="field">
          名字
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="比如：旅行用语" maxLength={40} />
        </label>
        <div className="field" role="group" aria-label="标签颜色">
          标签颜色
          <div className="color-grid">
            {choices.map((option) => {
              const taken = others.some((item) => item.color.toUpperCase() === option.color.toUpperCase());
              return (
                <button
                  key={option.color}
                  type="button"
                  className={`color-choice${taken ? " is-taken" : ""}`}
                  style={{ backgroundColor: option.color }}
                  aria-pressed={option.color.toUpperCase() === color.toUpperCase()}
                  aria-label={`${option.name}${taken ? "（别的磁带在用）" : ""}`}
                  title={option.name}
                  onClick={() => setColor(option.color)}
                />
              );
            })}
          </div>
        </div>
        <div className="row-12">
          <button type="button" className="button button-outline grow" onClick={onClose}>取消</button>
          <button type="submit" className="button button-primary grow">{tape ? "保存" : "新建"}</button>
        </div>
        {tape && <button type="button" className="button button-danger" onClick={remove}>删除这盘磁带</button>}
      </form>
    </Modal>
  );
}
