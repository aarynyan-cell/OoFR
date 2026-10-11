"use strict";

// A tiny in-memory stand-in for the part of IndexedDB the app uses
// (open / createObjectStore / get / put / transactions), with failure switches.
function createFakeIndexedDb({ failOpen = false, hangOpen = false, failPut = false } = {}) {
  const databases = new Map();
  const switches = { failOpen, hangOpen, failPut };

  function later(fn) {
    setTimeout(fn, 0);
  }

  const indexedDB = {
    switches,
    databases,
    open(name) {
      const request = { result: null, error: null };
      if (switches.hangOpen) return request;
      later(() => {
        if (switches.failOpen) {
          request.error = new Error("open failed");
          request.onerror?.();
          return;
        }
        let data = databases.get(name);
        const isNew = !data;
        if (isNew) {
          data = { stores: new Map() };
          databases.set(name, data);
        }
        const db = {
          createObjectStore(storeName) {
            data.stores.set(storeName, new Map());
          },
          transaction(storeName) {
            const store = data.stores.get(storeName);
            const transaction = { error: null };
            let finished = false;
            const settle = (outcome) => later(() => {
              if (finished) return;
              finished = true;
              if (outcome instanceof Error) {
                transaction.error = outcome;
                transaction.onabort?.();
              } else {
                transaction.oncomplete?.();
              }
            });
            transaction.objectStore = () => ({
              get(key) {
                const pending = { result: store.get(key) };
                settle();
                return pending;
              },
              put(value, key) {
                if (switches.failPut) {
                  const error = new Error("The quota has been exceeded.");
                  error.name = "QuotaExceededError";
                  settle(error);
                  return { error };
                }
                store.set(key, JSON.parse(JSON.stringify(value)));
                settle();
                return {};
              },
              delete(key) {
                store.delete(key);
                settle();
                return {};
              }
            });
            return transaction;
          },
          close() {}
        };
        request.result = db;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
  return indexedDB;
}

module.exports = { createFakeIndexedDb };
