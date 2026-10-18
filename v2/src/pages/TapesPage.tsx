import { type CSSProperties, type FormEvent, useState } from "react";
import { href, navigate } from "../app/router";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { TAPE_COLORS } from "../db/defaults";
import { useLive } from "../db/live";
import { createTape, listTapes, materialsOfTape, progressOf, trackLabel } from "../db/repo";
import type { Material, Tape } from "../db/types";
import { Modal } from "../ui/Modal";
import { ChevronIcon, SearchIcon } from "../ui/icons";

export function TapesPage({ tapeId }: { tapeId?: string }) {
  const tapes = useLive(() => listTapes(), []);
  const materials = useLive(() => db.materials.toArray(), []);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

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

      <div className="shelf" role="group" aria-label="选择磁带">
        {tapes?.map((tape) => (
          <a
            key={tape.id}
            className="shelf-tape"
            href={href({ name: "tapes", tapeId: tape.id })}
            aria-current={tape.id === selected?.id && !needle ? "true" : undefined}
            style={{ "--tape-color": tape.color } as CSSProperties}
          >
            <span className="shelf-label">
              <b>{tape.title}</b>
              <span className="shelf-window" aria-hidden="true"><span className="reel reel-small" /><span className="reel reel-small" /></span>
            </span>
            <span className="muted small">{materialsOfTape(materials ?? [], tape.id).length} 条素材</span>
          </a>
        ))}
      </div>

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
          <a className="text-button" href={href({ name: "add", tapeId: selected?.id })}>＋ 新建素材</a>
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

      {creating && <NewTapeSheet onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewTapeSheet({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(TAPE_COLORS[0]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const tape = await createTape(title, color);
    toast(`已新建磁带：${tape.title}`);
    onClose();
    navigate({ name: "tapes", tapeId: tape.id });
  };
  return (
    <Modal title="新建磁带" onClose={onClose}>
      <form className="stack-16" onSubmit={submit}>
        <h2 className="sheet-title">新建磁带</h2>
        <label className="field">
          名字
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="比如：旅行用语" maxLength={40} />
        </label>
        <div className="field" role="group" aria-label="标签颜色">
          标签颜色
          <div className="row-8">
            {TAPE_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className="color-choice"
                style={{ background: option }}
                aria-pressed={option === color}
                aria-label={option === TAPE_COLORS[0] ? "琥珀" : option === TAPE_COLORS[1] ? "青绿" : "米白"}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
        </div>
        <div className="row-12">
          <button type="button" className="button button-outline grow" onClick={onClose}>取消</button>
          <button type="submit" className="button button-primary grow">新建</button>
        </div>
      </form>
    </Modal>
  );
}
