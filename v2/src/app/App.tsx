import { useEffect } from "react";
import { refreshAi } from "../ai/state";
import { startSyncHost } from "../sync/host";
import { useLive } from "../db/live";
import { getSettings } from "../db/repo";
import { AddMaterialPage } from "../pages/AddMaterialPage";
import { LessonPage } from "../pages/LessonPage";
import { MePage } from "../pages/MePage";
import { PairPage } from "../pages/PairPage";
import { PhrasebookPage } from "../pages/PhrasebookPage";
import { ReviewPage } from "../pages/ReviewPage";
import { TapesPage } from "../pages/TapesPage";
import { TodayPage } from "../pages/TodayPage";
import { ConfirmHost } from "../ui/Confirm";
import { TabBar } from "../ui/TabBar";
import { useRoute } from "./router";
import { applyTheme } from "./theme";
import { useToast } from "./toast";
import { UpdateNotice } from "./update";

export function App() {
  const route = useRoute();
  const settings = useLive(() => getSettings(), []);
  const message = useToast();

  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings?.theme]);

  // Finds the local AI once at start, so lessons can use it straight away; the
  // Mac app also starts answering its paired phones' syncs.
  useEffect(() => {
    void refreshAi();
    startSyncHost();
  }, []);

  // Newer browsers return a promise from scrollTo, which an effect must not return.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name]);

  const withTabs = route.name === "today" || route.name === "tapes" || route.name === "phrases" || route.name === "me";
  return (
    <div className={`app${withTabs ? " app-with-tabs" : ""}`}>
      {route.name === "today" && <TodayPage />}
      {route.name === "tapes" && <TapesPage tapeId={route.tapeId} />}
      {route.name === "lesson" && <LessonPage key={route.id} id={route.id} mode={route.mode} />}
      {route.name === "add" && <AddMaterialPage tapeId={route.tapeId} />}
      {route.name === "edit" && <AddMaterialPage key={route.id} editId={route.id} />}
      {route.name === "phrases" && <PhrasebookPage />}
      {route.name === "review" && <ReviewPage />}
      {route.name === "me" && <MePage />}
      {route.name === "pair" && <PairPage payload={route.payload} />}
      {withTabs && <TabBar active={route.name} />}
      <UpdateNotice />
      <ConfirmHost />
      <div className={`toast${message ? " toast-show" : ""}`} role="status" aria-live="polite">{message}</div>
    </div>
  );
}
