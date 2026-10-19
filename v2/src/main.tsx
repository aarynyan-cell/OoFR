import "@fontsource/literata/latin-400.css";
import "@fontsource/literata/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { spellOutNumbers } from "./db/repo";
import { addStarterContentIfEmpty } from "./db/starter";
import { detectV1 } from "./migrate/v1-import";

async function prepare(): Promise<void> {
  // Ask the browser not to clear our data when the device runs low on space
  // (iOS in particular is more willing to grant this to home-screen apps).
  void navigator.storage?.persist?.().catch(() => false);
  try {
    // A first-time learner gets the demo tape, unless 1.0 data is waiting to be
    // brought over (it holds the same demo lesson).
    const v1 = await detectV1();
    if (v1.status === "none") await addStarterContentIfEmpty();
    await spellOutNumbers();
  } catch (error) {
    console.error("OoFR could not prepare its data", error);
  }
}

void prepare().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
