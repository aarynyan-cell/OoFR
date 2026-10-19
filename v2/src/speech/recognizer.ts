// Free speech recognition built into the browser (Safari on iPhone and Mac,
// Chrome, Edge). It listens while the learner records; where it is missing or
// refuses, shadowing still works and only the automatic check is skipped.

interface RecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

function recognitionClass(): RecognitionConstructor | null {
  const scope = globalThis as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function canRecognize(): boolean {
  return Boolean(recognitionClass());
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The last recognition, until it has really ended. Safari records nothing for a
// new take while the previous recognition is still finishing.
let previous: { ended: Promise<void>; abort: () => void } | null = null;

export async function recognitionSettled(): Promise<void> {
  const last = previous;
  if (!last) return;
  const done = await Promise.race([last.ended.then(() => true), sleep(600).then(() => false)]);
  if (!done) {
    last.abort();
    await Promise.race([last.ended, sleep(800)]);
  }
  if (previous === last) previous = null;
}

export interface Listening {
  // Resolves with what was heard ("" when nothing usable came back).
  finish(): Promise<string>;
  cancel(): void;
}

export function listen(lang = "fr-FR"): Listening | null {
  const Recognition = recognitionClass();
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  const parts: string[] = [];
  let resolveEnded: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  recognition.onresult = (event) => {
    parts.length = 0;
    for (const result of Array.from(event.results)) if (result.isFinal && result[0]) parts.push(result[0].transcript);
  };
  recognition.onerror = () => resolveEnded();
  recognition.onend = () => resolveEnded();
  try {
    recognition.start();
  } catch {
    return null;
  }
  const abort = () => {
    try {
      recognition.abort();
    } catch {
      resolveEnded();
    }
  };
  previous = { ended, abort };
  return {
    async finish() {
      try {
        recognition.stop();
      } catch {
        resolveEnded();
      }
      // Some engines never report the end; do not keep the learner waiting, and do not leave it running.
      const done = await Promise.race([ended.then(() => true), sleep(4000).then(() => false)]);
      if (!done) abort();
      return parts.join(" ").trim();
    },
    cancel() {
      try {
        recognition.abort();
      } catch {
        // already stopped
      }
    }
  };
}
