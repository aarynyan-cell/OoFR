import { useEffect, useState } from "react";

// Registers the offline service worker (production builds only) and offers a
// reload when a new version has been downloaded in the background.
export function UpdateNotice() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((registration) => {
        const watch = (worker: ServiceWorker | null) => {
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
          });
        };
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => watch(registration.installing));
      })
      .catch((error) => console.warn("OoFR: offline mode unavailable", error));
  }, []);

  if (!waiting) return null;
  return (
    <div className="update-notice" role="status">
      <span>新版本已下载好</span>
      <button type="button" className="button button-primary button-small" onClick={() => waiting.postMessage("skip-waiting")}>刷新</button>
    </div>
  );
}
