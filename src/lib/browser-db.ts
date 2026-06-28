const DB_NAME = "jogan-mvp";
const STORE = "state";
const KEY = "app";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadState<T>() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) return (await response.json()) as T | undefined;
  } catch {
    // ponytail: browser DB fallback keeps the local skeleton usable if the API is unavailable.
  }
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function saveState<T>(value: T) {
  try {
    const response = await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    if (response.ok) return;
  } catch {
    // ponytail: browser DB fallback keeps the local skeleton usable if the API is unavailable.
  }
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
