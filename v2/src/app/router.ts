import { useSyncExternalStore } from "react";

export type LessonMode = "listen" | "shadow" | "practice";

// Hash routes ("#/lesson/abc") work the same from a GitHub Pages sub-folder,
// the Mac app's local files and a dev server, with no server-side rewrites.
export type Route =
  | { name: "today" }
  | { name: "tapes"; tapeId?: string }
  | { name: "lesson"; id: string; mode?: LessonMode }
  | { name: "add"; tapeId?: string }
  | { name: "edit"; id: string }
  | { name: "phrases" }
  | { name: "review" }
  | { name: "me" }
  // From the QR code the Mac shows under 连接手机.
  | { name: "pair"; payload: string };

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case "tapes":
      return { name: "tapes", tapeId: parts[1] };
    case "lesson":
      if (!parts[1]) return { name: "tapes" };
      return { name: "lesson", id: parts[1], mode: parts[2] === "shadow" || parts[2] === "practice" ? parts[2] : "listen" };
    case "add":
      return { name: "add", tapeId: params.get("tape") ?? undefined };
    case "edit":
      return parts[1] ? { name: "edit", id: parts[1] } : { name: "tapes" };
    case "phrases":
      return { name: "phrases" };
    case "review":
      return { name: "review" };
    case "me":
      return { name: "me" };
    case "pair":
      return parts[1] ? { name: "pair", payload: parts[1] } : { name: "me" };
    default:
      return { name: "today" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "tapes":
      return route.tapeId ? `#/tapes/${encodeURIComponent(route.tapeId)}` : "#/tapes";
    case "lesson":
      return `#/lesson/${encodeURIComponent(route.id)}${route.mode && route.mode !== "listen" ? `/${route.mode}` : ""}`;
    case "add":
      return route.tapeId ? `#/add?tape=${encodeURIComponent(route.tapeId)}` : "#/add";
    case "edit":
      return `#/edit/${encodeURIComponent(route.id)}`;
    case "phrases":
      return "#/phrases";
    case "review":
      return "#/review";
    case "me":
      return "#/me";
    case "pair":
      return `#/pair/${route.payload}`;
    default:
      return "#/";
  }
}

export function navigate(route: Route, { replace = false } = {}): void {
  const target = href(route);
  if (replace) window.location.replace(target);
  else window.location.hash = target.slice(1);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  return parseRoute(hash);
}
