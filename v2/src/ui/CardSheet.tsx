import { type FormEvent, useState } from "react";
import { speakOnce } from "../app/audio";
import { toast } from "../app/toast";
import { createWordbook, removeCard, updateCard } from "../db/repo";
import type { Card, Settings, Wordbook } from "../db/types";
import { frenchSpacing } from "../text/typography";
import { Modal } from "./Modal";
import { SpeakerIcon } from "./icons";

// One phrasebook entry: fill in its meaning, mark it, sort it into wordbooks.
export function CardSheet({ card, wordbooks, settings, onClose }: { card: Card; wordbooks: Wordbook[]; settings: Settings; onClose: () => void }) {
  const [translation, setTranslation] = useState(card.translation);
  const [newBook, setNewBook] = useState("");

  const saveTranslation = async () => {
    if (translation.trim() === card.translation) return;
    await updateCard(card.id, { translation });
    toast("释义已保存");
  };

  const toggleBook = (id: string) =>
    void updateCard(card.id, { wordbookIds: card.wordbookIds.includes(id) ? card.wordbookIds.filter((item) => item !== id) : [...card.wordbookIds, id] });

  const addBook = async (event: FormEvent) => {
    event.preventDefault();
    if (!newBook.trim()) return;
    const book = await createWordbook(newBook);
    await updateCard(card.id, { wordbookIds: [...card.wordbookIds, book.id] });
    setNewBook("");
    toast(`已新建词本「${book.title}」`);
  };

  const remove = async () => {
    if (!window.confirm(`从词句本删除「${card.text}」？`)) return;
    await removeCard(card.id);
    toast("已删除");
    onClose();
  };

  return (
    <Modal title={card.text} onClose={() => void saveTranslation().then(onClose)}>
      <div className="stack-16 sheet-scroll">
        <div className="row-between">
          <div className="stack-4 grow">
            <span className="dim small">{card.kind === "word" ? "单词" : "句子"}{card.sourceTitle ? ` · 来自 ${card.sourceTitle}` : ""}</span>
            <p className={`fr ${card.kind === "word" ? "word-title" : "explain-text"}`} lang={card.language}>{frenchSpacing(card.text)}</p>
            {(card.ipa || card.partOfSpeech) && <p className="dim small"><span className="ipa">{card.ipa}</span>{card.ipa && card.partOfSpeech ? " · " : ""}{card.partOfSpeech}</p>}
          </div>
          <button type="button" className="round-button round-outline" onClick={() => speakOnce(card.text, settings, card.language)} aria-label="朗读"><SpeakerIcon size={20} /></button>
        </div>

        <label className="field">
          中文释义
          <textarea rows={2} value={translation} placeholder="还没有释义，可以在这里补上" onChange={(event) => setTranslation(event.target.value)} onBlur={saveTranslation} />
        </label>

        <div className="segmented segmented-2" role="group" aria-label="掌握情况">
          <button type="button" className="segment" aria-pressed={card.status !== "got"} onClick={() => void updateCard(card.id, { status: "learning" })}>{card.status === "new" ? "待学" : "学习中"}</button>
          <button type="button" className="segment" aria-pressed={card.status === "got"} onClick={() => void updateCard(card.id, { status: "got" })}>已掌握</button>
        </div>

        <div className="field" role="group" aria-label="词本">
          放进词本
          <div className="chips">
            {wordbooks.map((book) => (
              <button key={book.id} type="button" className="chip" aria-pressed={card.wordbookIds.includes(book.id)} onClick={() => toggleBook(book.id)}>{book.title}</button>
            ))}
          </div>
          <form className="row-8" onSubmit={addBook}>
            <input className="grow" value={newBook} onChange={(event) => setNewBook(event.target.value)} placeholder="新词本的名字" maxLength={30} aria-label="新词本的名字" />
            <button type="submit" className="button button-outline button-small" disabled={!newBook.trim()}>新建</button>
          </form>
        </div>

        <button type="button" className="button button-danger" onClick={remove}>从词句本删除</button>
      </div>
    </Modal>
  );
}
