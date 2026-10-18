import { useState } from "react";
import { speakOnce } from "../app/audio";
import { toast } from "../app/toast";
import { db } from "../db/database";
import { useLive } from "../db/live";
import { type CardFilter, filterCards, getSettings, removeCard, setCardStatus } from "../db/repo";
import type { Card } from "../db/types";
import { CloseIcon, PlayIcon, SearchIcon } from "../ui/icons";

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

  const shown = filterCards(cards ?? [], filter, query, wordbookId);

  const toggleStatus = (card: Card) => {
    const next = card.status === "got" ? "learning" : "got";
    void setCardStatus(card.id, next);
    toast(next === "got" ? "标记为已掌握" : "移回待学");
  };

  const remove = (card: Card) => {
    if (!window.confirm(`从词句本删除「${card.text}」？`)) return;
    void removeCard(card.id);
    toast("已删除");
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1 className="page-title">词句</h1>
      </header>

      <div className="segmented segmented-4" role="group" aria-label="按状态筛选">
        {FILTERS.map((option) => (
          <button key={option.value} type="button" className="segment" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
            {option.label}
          </button>
        ))}
      </div>

      {wordbooks && wordbooks.length > 0 && (
        <div className="chips chips-scroll" role="group" aria-label="词本">
          {wordbooks.map((wordbook) => (
            <button
              key={wordbook.id}
              type="button"
              className="chip"
              aria-pressed={wordbookId === wordbook.id}
              onClick={() => setWordbookId(wordbookId === wordbook.id ? "" : wordbook.id)}
            >
              {wordbook.title} · {(cards ?? []).filter((card) => card.wordbookIds.includes(wordbook.id)).length}
            </button>
          ))}
        </div>
      )}

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
              <span className="grow stack-2">
                <b className={`fr ${card.kind === "word" ? "card-word" : "card-phrase"}`} lang={card.language}>{card.text}</b>
                <span className="muted small">{card.kind === "word" ? "单词" : "句子"} · {card.translation || "释义待补充"}</span>
              </span>
              <button type="button" className={`tag tag-button ${card.status === "got" ? "tag-ok" : card.translation ? "" : "tag-todo"}`} onClick={() => toggleStatus(card)} aria-label={`${card.text}：${card.status === "got" ? "已掌握，点一下移回待学" : "待学，点一下标记为已掌握"}`}>
                {card.status === "got" ? "已掌握" : card.translation ? "待学" : "待补充"}
              </button>
              <button type="button" className="icon-button icon-button-small" aria-label={`删除 ${card.text}`} onClick={() => remove(card)}>
                <CloseIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{cards?.length ? "没有符合条件的词句" : "还没有收藏。上课时点“收藏”，好句子会来到这里。"}</p>
      )}
    </main>
  );
}
