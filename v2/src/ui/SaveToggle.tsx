import type { Tone } from "../db/repo";
import { BookmarkIcon, BookmarkFilledIcon } from "./icons";

// The one 收藏 / 已收藏 control used everywhere (lesson, word card, practice,
// shadowing summary). Tapping it again removes the item from the phrasebook.
export function SaveToggle({
  saved,
  tone,
  onToggle,
  variant = "button",
  label = "收藏"
}: {
  saved: boolean;
  tone?: Tone;
  onToggle: () => void;
  variant?: "action" | "button" | "small";
  label?: string;
}) {
  const className = {
    action: "action",
    button: "button button-outline",
    small: "button button-outline button-small"
  }[variant];
  return (
    <button
      type="button"
      className={`${className} save-toggle${saved ? ` is-saved tone-${tone ?? "new"}` : ""}`}
      onClick={onToggle}
      aria-pressed={saved}
      title={saved ? "再点一下取消收藏" : "收藏到词句本"}
    >
      {saved ? <BookmarkFilledIcon size={variant === "action" ? 20 : 18} /> : <BookmarkIcon size={variant === "action" ? 20 : 18} />}
      {saved ? "已收藏" : label}
    </button>
  );
}
