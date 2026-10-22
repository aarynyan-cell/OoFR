import type { SpeechPlayer } from "./player";

// The system's media controls (iPhone Dynamic Island and lock screen, Mac media
// keys) work OoFR's player; they never start the audio on their own, and they
// show what the player is doing. Without this, the phone's controls drove the
// audio element behind the player's back.
export function connectMediaControls(session: MediaSession | undefined, player: SpeechPlayer): void {
  if (!session) return;
  const handle = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Not offered by this browser.
    }
  };
  handle("play", () => {
    if (player.getState().status === "paused") player.resume();
  });
  handle("pause", () => {
    if (player.getState().status === "playing") player.pause();
  });
  handle("stop", () => player.stop());
  for (const action of ["seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"] as MediaSessionAction[]) handle(action, null);
  // 后台播放 only: the lock screen's ⏮ / ⏭ move between sentences of the playing track.
  let skipping = false;
  player.subscribe(() => {
    const state = player.getState();
    session.playbackState = state.status === "playing" ? "playing" : state.status === "paused" ? "paused" : "none";
    if (state.status === "idle") session.metadata = null;
    const background = Boolean(state.background) && state.status !== "idle";
    if (background === skipping) return;
    skipping = background;
    handle("previoustrack", background ? () => player.skipTo(player.getState().index - 1) : null);
    handle("nexttrack", background ? () => player.skipTo(player.getState().index + 1) : null);
  });
}
