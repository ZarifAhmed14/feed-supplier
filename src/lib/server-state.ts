import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = join(process.cwd(), "data", "jogan.sqlite");
const KEY = "app";

type Row = { value: string } | undefined;

function db() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const database = new Database(DB_PATH);
  database.pragma("journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  return database;
}

export function readAppState() {
  const database = db();
  try {
    return (database.prepare("SELECT value FROM app_state WHERE key = ?").get(KEY) as Row)?.value;
  } finally {
    database.close();
  }
}

export function writeAppState(value: unknown) {
  const text = JSON.stringify(value);
  if (text.length > 1_000_000) throw new Error("State exceeds 1 MB limit.");
  const database = db();
  try {
    database.prepare("INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").run(KEY, text);
  } finally {
    database.close();
  }
}

export function clearAppState() {
  const database = db();
  try {
    database.prepare("DELETE FROM app_state WHERE key = ?").run(KEY);
  } finally {
    database.close();
  }
}
