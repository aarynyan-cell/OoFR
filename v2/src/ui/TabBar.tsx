import type { ReactNode } from "react";
import { type Route, href } from "../app/router";
import { BookmarkIcon, CassetteIcon, HomeIcon, UserIcon } from "./icons";

const TABS: { name: Route["name"]; label: string; icon: ReactNode; to: Route }[] = [
  { name: "today", label: "今日", icon: <HomeIcon />, to: { name: "today" } },
  { name: "tapes", label: "磁带", icon: <CassetteIcon />, to: { name: "tapes" } },
  { name: "phrases", label: "词句", icon: <BookmarkIcon />, to: { name: "phrases" } },
  { name: "me", label: "我的", icon: <UserIcon />, to: { name: "me" } }
];

export function TabBar({ active }: { active: Route["name"] }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((tab) => (
        <a key={tab.name} href={href(tab.to)} className="tab" aria-current={tab.name === active ? "page" : undefined}>
          {tab.icon}
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  );
}
