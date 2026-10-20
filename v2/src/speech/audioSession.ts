// iPhone Safari switches the phone between "playback" (the original sentence)
// and "recording" (the learner) on its own. After a sentence has played, its
// recorder can come back silent for every take that follows (seen on a real
// iPhone: the microphone on, not muted, and no sound at all). While 跟读 is
// open, OoFR tells Safari it plays and records in turns, so there is no switch.
// Browsers without this (Chrome, Android, older iPhones) are left as they are.

import { devLog } from "../app/devlog";

interface AudioSessionLike {
  type: string;
}

function audioSession(): AudioSessionLike | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as { audioSession?: AudioSessionLike }).audioSession;
}

function setType(session: AudioSessionLike, type: string): boolean {
  try {
    session.type = type;
    return session.type === type;
  } catch {
    return false;
  }
}

// Keeps the phone ready to play and record; the returned function puts back what was there.
export function holdRecordingSession(session = audioSession()): () => void {
  if (!session) return () => {};
  const before = session.type;
  if (!setType(session, "play-and-record")) return () => {};
  devLog("session-hold", { before });
  return () => {
    if (session.type === "play-and-record") setType(session, before === "play-and-record" ? "auto" : before);
  };
}

// After a silent take: let go of the session and take it back, so the microphone starts afresh.
export async function restartRecordingSession(session = audioSession(), pauseMs = 300): Promise<void> {
  if (!session) return;
  const held = session.type;
  setType(session, "auto");
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
  setType(session, held === "auto" ? "play-and-record" : held);
  devLog("session-restart", { type: session.type });
}
