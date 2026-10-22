// Turns a recording into samples (for the waveform, the loudness check and
// joining takes) without opening the speakers. A live AudioContext on an
// iPhone takes part in the phone's audio; after one or two of them the
// microphone recorded nothing until the page was reloaded (seen on a real
// iPhone, test log 2026-10-21). An offline one only does the arithmetic.

type OfflineContextClass = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export function canDecode(): boolean {
  return Boolean(offlineContextClass());
}

function offlineContextClass(): OfflineContextClass | undefined {
  if (typeof window === "undefined") return undefined;
  return window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: OfflineContextClass }).webkitOfflineAudioContext;
}

// The decoded audio (at 48 kHz unless asked otherwise), or null when this browser cannot decode it.
export async function decodeAudio(blob: Blob, sampleRate = 48000): Promise<AudioBuffer | null> {
  const OfflineContext = offlineContextClass();
  if (!OfflineContext) return null;
  try {
    return await new OfflineContext(1, 1, sampleRate).decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  }
}
