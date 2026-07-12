const DB_NAME = "multape.lexicons.v1";
const DB_VERSION = 1;
const STORE_NAME = "packages";
const MANIFEST_URL = "./lexicons/manifest.json";

export async function loadLexiconManifest() {
  const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Unable to load lexicon manifest: ${response.status}`);
  }
  return response.json();
}

export async function loadInstalledLexicon(pair) {
  const packageData = await getPackage(pair);
  return packageData ? inflateLexicon(packageData) : null;
}

export async function downloadLexiconPackage(packageInfo, onProgress = () => {}) {
  if (!packageInfo?.file) {
    throw new Error("Lexicon package file is missing");
  }

  const response = await fetch(`./lexicons/${packageInfo.file}`, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Lexicon package download failed: ${response.status}`);
  }

  const total = Number(response.headers.get("content-length") || 0);
  let loaded = 0;
  let text = "";

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (total > 0) {
        onProgress(Math.min(99, Math.round((loaded / total) * 100)));
      }
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    onProgress(95);
  }

  const packageData = JSON.parse(text);
  validatePackage(packageInfo.pair, packageData);
  await putPackage(packageInfo.pair, packageData);
  onProgress(100);
  return inflateLexicon(packageData);
}

export async function deleteLexiconPackage(pair) {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(pair));
}

export function emptyLexicon(pair) {
  return {
    pair,
    meta: null,
    entries: Object.create(null),
    forms: Object.create(null),
    entriesCount: 0,
    formsCount: 0
  };
}

function validatePackage(expectedPair, packageData) {
  if (!packageData || packageData.type !== "multape.lexicon.v1") {
    throw new Error("Unsupported lexicon package");
  }
  if (packageData.pair !== expectedPair) {
    throw new Error(`Lexicon pair mismatch: expected ${expectedPair}, got ${packageData.pair}`);
  }
  if (!Array.isArray(packageData.entries) || !Array.isArray(packageData.forms)) {
    throw new Error("Lexicon package is missing entries or forms");
  }
}

function inflateLexicon(packageData) {
  const entries = Object.create(null);
  const forms = Object.create(null);

  packageData.entries.forEach((row) => {
    const [key, word, ipa, meaning, pos] = row;
    if (!key) return;
    entries[key] = {
      word: word || key,
      ipa: ipa || "",
      meaning: meaning || "",
      pos: pos || ""
    };
  });

  packageData.forms.forEach((row) => {
    const [form, lemma] = row;
    if (form && lemma && form !== lemma) {
      forms[form] = lemma;
    }
  });

  return {
    pair: packageData.pair,
    meta: {
      version: packageData.version || "",
      sources: packageData.sources || [],
      builtAt: packageData.builtAt || "",
      sourceLanguage: packageData.sourceLanguage || "",
      targetLanguage: packageData.targetLanguage || ""
    },
    entries,
    forms,
    entriesCount: Object.keys(entries).length,
    formsCount: Object.keys(forms).length
  };
}

async function getPackage(pair) {
  const db = await openDb();
  return requestToPromise(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(pair));
}

async function putPackage(pair, packageData) {
  const db = await openDb();
  return requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(packageData, pair));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
