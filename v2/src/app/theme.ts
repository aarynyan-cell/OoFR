import type { ThemeChoice } from "../db/types";

const THEME_COLORS = { night: "#16191A", day: "#F4F1E9" } as const;
let systemQuery: MediaQueryList | null = null;
let currentChoice: ThemeChoice = "system";

function resolved(choice: ThemeChoice): "night" | "day" {
  if (choice !== "system") return choice;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "day" : "night";
}

function paint(): void {
  const theme = resolved(currentChoice);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

// 夜读 / 日间 / 跟随系统. "System" follows the phone's dark mode as it changes.
export function applyTheme(choice: ThemeChoice): void {
  currentChoice = choice;
  if (!systemQuery && window.matchMedia) {
    systemQuery = window.matchMedia("(prefers-color-scheme: light)");
    systemQuery.addEventListener?.("change", () => currentChoice === "system" && paint());
  }
  paint();
}
