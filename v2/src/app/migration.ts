import { useCallback, useEffect, useState } from "react";
import { toast } from "./toast";
import { type V1Detection, detectV1, importV1FromThisDevice } from "../migrate/v1-import";

// Shared by 今日 (the one-tap card) and 我的 (data section).
export function useV1Migration() {
  const [detection, setDetection] = useState<V1Detection | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void detectV1().then(setDetection, () => setDetection({ status: "none" }));
  }, []);

  useEffect(refresh, [refresh]);

  const importNow = useCallback(async () => {
    setBusy(true);
    try {
      const added = await importV1FromThisDevice();
      const parts = [
        added.materials && `${added.materials} 条素材`,
        added.cards && `${added.cards} 个词句`,
        added.recordings && `${added.recordings} 段录音`
      ].filter(Boolean);
      toast(parts.length ? `已搬过来：${parts.join("、")}` : "1.0 的内容都已经在这里了");
    } catch (error) {
      toast(error instanceof Error ? error.message : "搬运失败，请稍后再试");
    } finally {
      setBusy(false);
      refresh();
    }
  }, [refresh]);

  return { detection, busy, importNow, refresh };
}
