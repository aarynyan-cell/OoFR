const DB_NAME = "multape.lexicons.v1";
const DB_VERSION = 2;
const STORE_NAME = "packages";
const CHUNK_STORE_NAME = "chunks";
const MANIFEST_URL = "./lexicons/manifest.json";
const LEGACY_PACKAGE_TYPE = "multape.lexicon.v1";
const CHUNKED_INSTALL_TYPE = "multape.lexicon.installation.v2";

export async function loadLexiconManifest() {
  const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Unable to load lexicon manifest: ${response.status}`);
  }
  return response.json();
}

export async function loadInstalledLexicon(pair) {
  const packageData = await getPackage(pair);
  if (!packageData) return null;
  if (packageData.type === CHUNKED_INSTALL_TYPE) {
    return loadChunkedLexicon(packageData);
  }
  return inflateLegacyLexicon(packageData);
}

export async function downloadLexiconPackage(packageInfo, onProgress = () => {}) {
  if (packageInfo?.chunks) {
    return downloadChunkedLexiconPackage(packageInfo, onProgress);
  }
  if (!packageInfo?.file) {
    throw new Error("Lexicon package file is missing");
  }

  return downloadLegacyLexiconPackage(packageInfo, onProgress);
}

export async function deleteLexiconPackage(pair) {
  const db = await openDb();
  const storeNames = [STORE_NAME];
  if (db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
    storeNames.push(CHUNK_STORE_NAME);
  }
  const transaction = db.transaction(storeNames, "readwrite");
  const done = transactionToPromise(transaction);
  transaction.objectStore(STORE_NAME).delete(pair);
  if (storeNames.includes(CHUNK_STORE_NAME)) {
    await deleteChunkRecords(transaction.objectStore(CHUNK_STORE_NAME), pair);
  }
  await done;
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

async function downloadChunkedLexiconPackage(packageInfo, onProgress) {
  const pair = packageInfo.pair;
  const chunks = normalizeChunkManifest(packageInfo);
  if (!chunks.entries.length) {
    throw new Error(`Lexicon package has no entry chunks: ${pair}`);
  }
  const totalBytes = sumChunkBytes(chunks) || Number(packageInfo.bytes || 0);
  const totalChunks = chunks.entries.length + chunks.forms.length;
  const previousPackage = await getPackage(pair);
  const previousChunkKeys = chunkKeysFromPackage(previousPackage);
  const installPrefix = `${pair}:install:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  const writtenKeys = [];
  const installedChunks = { entries: [], forms: [] };
  let completedBytes = 0;
  let completedChunks = 0;

  const lexicon = emptyLexicon(pair);
  lexicon.meta = packageMeta(packageInfo);
  reportProgress(onProgress, 1, "preparing");

  try {
    for (const [kind, list] of [["entries", chunks.entries], ["forms", chunks.forms]]) {
      for (let index = 0; index < list.length; index += 1) {
        const chunk = list[index];
        const text = await fetchLexiconText(chunk.file, {
          completedBytes,
          totalBytes,
          chunkBytes: Number(chunk.bytes || 0),
          onProgress,
          detail: `${completedChunks + 1}/${totalChunks}`
        });
        const rows = parseRows(text, pair, kind, index);
        if (kind === "entries") {
          appendEntryRows(lexicon, rows);
        } else {
          appendFormRows(lexicon, rows);
        }
        const key = chunkKey(installPrefix, kind, index);
        await putChunk(key, text);
        writtenKeys.push(key);
        installedChunks[kind].push({
          key,
          count: chunk.count || rows.length,
          bytes: chunk.bytes || byteLength(text)
        });
        completedBytes += Number(chunk.bytes || byteLength(text));
        completedChunks += 1;
        reportProgress(onProgress, progressFromBytes(completedBytes, totalBytes, 96), "indexing", `${completedChunks}/${totalChunks}`);
        await yieldToBrowser();
      }
    }

    const record = {
      type: CHUNKED_INSTALL_TYPE,
      pair,
      version: packageInfo.version || "",
      sourceLanguage: packageInfo.sourceLanguage || "",
      targetLanguage: packageInfo.targetLanguage || "",
      builtAt: packageInfo.builtAt || "",
      sources: packageInfo.sources || [],
      bytes: packageInfo.bytes || totalBytes || 0,
      entriesCount: lexicon.entriesCount,
      formsCount: lexicon.formsCount,
      chunks: installedChunks
    };

    reportProgress(onProgress, 98, "saving");
    await putPackage(pair, record);
    await deleteChunksByKeys(previousChunkKeys.filter((key) => !writtenKeys.includes(key)));
    reportProgress(onProgress, 100, "done");
    return lexicon;
  } catch (error) {
    await deleteChunksByKeys(writtenKeys).catch(() => {});
    throw error;
  }
}

async function downloadLegacyLexiconPackage(packageInfo, onProgress) {
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
        reportProgress(onProgress, Math.min(92, Math.round((loaded / total) * 92)), "downloading");
      }
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    reportProgress(onProgress, 92, "downloading");
  }

  reportProgress(onProgress, 94, "parsing");
  const packageData = JSON.parse(text);
  validatePackage(packageInfo.pair, packageData);
  reportProgress(onProgress, 97, "saving");
  await putPackage(packageInfo.pair, packageData);
  reportProgress(onProgress, 100, "done");
  return inflateLegacyLexicon(packageData);
}

function validatePackage(expectedPair, packageData) {
  if (!packageData || packageData.type !== LEGACY_PACKAGE_TYPE) {
    throw new Error("Unsupported lexicon package");
  }
  if (packageData.pair !== expectedPair) {
    throw new Error(`Lexicon pair mismatch: expected ${expectedPair}, got ${packageData.pair}`);
  }
  if (!Array.isArray(packageData.entries) || !Array.isArray(packageData.forms)) {
    throw new Error("Lexicon package is missing entries or forms");
  }
}

async function loadChunkedLexicon(packageData) {
  const lexicon = emptyLexicon(packageData.pair);
  lexicon.meta = packageMeta(packageData);

  for (const chunk of packageData.chunks?.entries || []) {
    const text = await getChunk(chunk.key);
    if (!text) throw new Error(`Missing lexicon chunk: ${chunk.key}`);
    appendEntryRows(lexicon, parseRows(text, packageData.pair, "entries", 0));
    await yieldToBrowser();
  }
  for (const chunk of packageData.chunks?.forms || []) {
    const text = await getChunk(chunk.key);
    if (!text) throw new Error(`Missing lexicon chunk: ${chunk.key}`);
    appendFormRows(lexicon, parseRows(text, packageData.pair, "forms", 0));
    await yieldToBrowser();
  }

  return lexicon;
}

function inflateLegacyLexicon(packageData) {
  const lexicon = emptyLexicon(packageData.pair);
  lexicon.meta = packageMeta(packageData);
  appendEntryRows(lexicon, packageData.entries);
  appendFormRows(lexicon, packageData.forms);
  return lexicon;
}

function appendEntryRows(lexicon, rows) {
  rows.forEach((row) => {
    const [key, word, ipa, meaning, pos] = row;
    if (!key) return;
    if (!lexicon.entries[key]) {
      lexicon.entriesCount += 1;
    }
    lexicon.entries[key] = {
      word: word || key,
      ipa: ipa || "",
      meaning: meaning || "",
      pos: pos || ""
    };
  });
}

function appendFormRows(lexicon, rows) {
  rows.forEach((row) => {
    const [form, lemma] = row;
    if (form && lemma && form !== lemma) {
      if (!lexicon.forms[form]) {
        lexicon.formsCount += 1;
      }
      lexicon.forms[form] = lemma;
    }
  });
}

function packageMeta(packageData) {
  return {
    version: packageData.version || "",
    sources: packageData.sources || [],
    builtAt: packageData.builtAt || "",
    sourceLanguage: packageData.sourceLanguage || "",
    targetLanguage: packageData.targetLanguage || "",
    packageBytes: packageData.bytes || 0
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

async function getChunk(key) {
  const db = await openDb();
  return requestToPromise(db.transaction(CHUNK_STORE_NAME, "readonly").objectStore(CHUNK_STORE_NAME).get(key));
}

async function putChunk(key, text) {
  const db = await openDb();
  return requestToPromise(db.transaction(CHUNK_STORE_NAME, "readwrite").objectStore(CHUNK_STORE_NAME).put(text, key));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
        db.createObjectStore(CHUNK_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeChunkManifest(packageInfo) {
  const chunks = packageInfo.chunks || {};
  return {
    entries: normalizeChunkList(chunks.entries),
    forms: normalizeChunkList(chunks.forms)
  };
}

function normalizeChunkList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((chunk) => chunk?.file);
}

function parseRows(text, pair, kind, index) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) {
    throw new Error(`Invalid ${kind} chunk for ${pair}: ${index}`);
  }
  return rows;
}

async function fetchLexiconText(file, options) {
  const response = await fetch(`./lexicons/${file}`, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Lexicon chunk download failed: ${response.status}`);
  }

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
      const completed = options.completedBytes + loaded;
      reportProgress(options.onProgress, progressFromBytes(completed, options.totalBytes, 96), "downloading", options.detail);
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    loaded = options.chunkBytes || byteLength(text);
    const completed = options.completedBytes + loaded;
    reportProgress(options.onProgress, progressFromBytes(completed, options.totalBytes, 96), "downloading", options.detail);
  }
  return text;
}

function sumChunkBytes(chunks) {
  return [...chunks.entries, ...chunks.forms].reduce((sum, chunk) => sum + Number(chunk.bytes || 0), 0);
}

function progressFromBytes(completed, total, maxPercent) {
  if (!total) return maxPercent;
  return Math.max(2, Math.min(maxPercent, Math.round((completed / total) * maxPercent)));
}

function reportProgress(onProgress, percent, stage = "downloading", detail = "") {
  onProgress({
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    stage,
    detail
  });
}

function byteLength(text) {
  return new Blob([text]).size;
}

function chunkKey(pair, kind, index) {
  return `${pair}:${kind}:${String(index).padStart(4, "0")}`;
}

function chunkKeysFromPackage(packageData) {
  if (!packageData || packageData.type !== CHUNKED_INSTALL_TYPE) return [];
  return [...(packageData.chunks?.entries || []), ...(packageData.chunks?.forms || [])]
    .map((chunk) => chunk.key)
    .filter(Boolean);
}

async function deleteChunksByKeys(keys) {
  if (!keys.length) return;
  const db = await openDb();
  const transaction = db.transaction(CHUNK_STORE_NAME, "readwrite");
  const store = transaction.objectStore(CHUNK_STORE_NAME);
  keys.forEach((key) => store.delete(key));
  await transactionToPromise(transaction);
}

function deleteChunkRecords(store, pair) {
  return new Promise((resolve, reject) => {
    const lower = `${pair}:`;
    const upper = `${pair}:\uffff`;
    const request = store.openCursor(IDBKeyRange.bound(lower, upper));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
