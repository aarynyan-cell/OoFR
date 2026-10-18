import { useSyncExternalStore } from "react";

// Hash routes ("#/lesson/abc") work the same from a GitHub Pages sub-folder,
// the Mac app's local files and a dev server, with no server-side rewrites.
export type Route =
  | { name: "today" }
  | { name: "tapes"; tapeId?: string }
  | { name: "lesson"; id: string }
  | { name: "add"; tapeId?: string }
  | { name: "phrases" }
  | { name: "me" };

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
      return parts[1] ? { name: "lesson", id: parts[1] } : { name: "tapes" };
    case "add":
      return { name: "add", tapeId: params.get("tape") ?? undefined };
    case "phrases":
      return { name: "phrases" };
    case "me":
      return { name: "me" };
    default:
      return { name: "today" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "tapes":
      return route.tapeId ? `#/tapes/${encodeURIComponent(route.tapeId)}` : "#/tapes";
    case "lesson":
      return `#/lesson/${encodeURIComponent(route.id)}`;
    case "add":
      return route.tapeId ? `#/add?tape=${encodeURIComponent(route.tapeId)}` : "#/add";
    case "phrases":
      return "#/phrases";
    case "me":
      return "#/me";
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
