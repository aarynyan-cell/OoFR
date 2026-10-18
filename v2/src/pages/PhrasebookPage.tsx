import { type FormEvent, useState } from "react";
import { speakOnce } from "../app/audio";
import { href } from "../app/router";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { type CardFilter, createWordbook, deleteWordbook, filterCards, getSettings, reviewQueue, setCardStatus } from "../db/repo";
import type { Card } from "../db/types";
import { frenchSpacing } from "../text/typography";
import { CardSheet } from "../ui/CardSheet";
import { Modal } from "../ui/Modal";
import { PlayIcon, SearchIcon } from "../ui/icons";

const FILTERS: { value: CardFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "待学" },
  { value: "got", label: "已掌握" },
  { value: "incomplete", label: "待补充" }
];

export function PhrasebookPage() {
  const cards = useLive(() => db.cards.toArray(), []);
  const wordbooks = useLive(() => db.wordbooks.toArray(), []);
  const settings = useLive(() => getSettings(), []);
  const [filter, setFilter] = useState<CardFilter>("all");
  const [wordbookId, setWordbookId] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creatingBook, setCreatingBook] = useState(false);

  const shown = filterCards(cards ?? [], filter, query, wordbookId);
  const dueCount = cards ? reviewQueue(cards).length : 0;
  const open = cards?.find((card) => card.id === openId);
  const selectedBook = wordbooks?.find((book) => book.id === wordbookId);

  const toggleStatus = (card: Card) => {
    const next = card.status === "got" ? "learning" : "got";
    void setCardStatus(card.id, next);
    toast(next === "got" ? "标记为已掌握" : "移回待学");
  };

  const removeBook = async () => {
    if (!selectedBook || !window.confirm(`删除词本「${selectedBook.title}」？里面的词句不会删除。`)) return;
    await deleteWordbook(selectedBook.id);
    setWordbookId("");
    toast("词本已删除");
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1 className="page-title">词句</h1>
        {dueCount > 0 && <a className="button button-primary button-small" href={href({ name: "review" })}>复习 {dueCount} 个</a>}
      </header>

      <div className="segmented segmented-4" role="group" aria-label="按状态筛选">
        {FILTERS.map((option) => (
          <button key={option.value} type="button" className="segment" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
            {option.label}
          </button>
        ))}
      </div>

      <div className="chips chips-scroll" role="group" aria-label="词本">
        {wordbooks?.map((wordbook) => (
          <button key={wordbook.id} type="button" className="chip" aria-pressed={wordbookId === wordbook.id} onClick={() => setWordbookId(wordbookId === wordbook.id ? "" : wordbook.id)}>
            {wordbook.title} · {(cards ?? []).filter((card) => card.wordbookIds.includes(wordbook.id)).length}
          </button>
        ))}
        <button type="button" className="chip chip-dashed" onClick={() => setCreatingBook(true)}>＋ 新词本</button>
        {selectedBook && <button type="button" className="text-button" onClick={removeBook}>删除这个词本</button>}
      </div>

      <label className="search">
        <SearchIcon size={18} />
        <span className="visually-hidden">搜索词句</span>
        <input type="search" placeholder="搜索法语或中文" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      {shown.length ? (
        <ul className="list list-plain">
          {shown.map((card) => (
            <li key={card.id} className="list-row">
              <button type="button" className="round-button round-outline" aria-label={`播放 ${card.text}`} onClick={() => settings && speakOnce(card.text, settings, card.language)}>
                <PlayIcon size={16} />
              </button>
              <button type="button" className="grow stack-2 row-open" onClick={() => setOpenId(card.id)} aria-label={`打开 ${card.text}`}>
                <b className={`fr ${card.kind === "word" ? "card-word" : "card-phrase"}`} lang={card.language}>{frenchSpacing(card.text)}</b>
                <span className="muted small">{card.kind === "word" ? "单词" : "句子"} · {card.translation || "释义待补充"}</span>
              </button>
              <button
                type="button"
                className={`tag tag-button ${card.status === "got" ? "tag-ok" : card.translation ? "" : "tag-todo"}`}
                onClick={() => toggleStatus(card)}
                aria-label={`${card.text}：${card.status === "got" ? "已掌握，点一下移回待学" : "待学，点一下标记为已掌握"}`}
              >
                {card.status === "got" ? "已掌握" : card.translation ? "待学" : "待补充"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{cards?.length ? "没有符合条件的词句" : "还没有收藏。上课时点“收藏”，好句子会来到这里。"}</p>
      )}

      {open && settings && <CardSheet card={open} wordbooks={wordbooks ?? []} settings={settings} onClose={() => setOpenId(null)} />}
      {creatingBook && <NewWordbookSheet onClose={() => setCreatingBook(false)} />}
    </main>
  );
}

function NewWordbookSheet({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const book = await createWordbook(title);
    toast(`已新建词本「${book.title}」，打开词句就能放进去`);
    onClose();
  };
  return (
    <Modal title="新建词本" onClose={onClose}>
      <form className="stack-16" onSubmit={submit}>
        <h2 className="sheet-title">新建词本</h2>
        <label className="field">
          名字
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="比如：旅行用语" maxLength={30} />
        </label>
        <div className="row-12">
          <button type="button" className="button button-outline grow" onClick={onClose}>取消</button>
          <button type="submit" className="button button-primary grow">新建</button>
        </div>
      </form>
    </Modal>
  );
}
