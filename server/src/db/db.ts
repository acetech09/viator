import Database from 'better-sqlite3';
import { DB_PATH, ensureDataDir } from '../config.js';
import { runMigrations } from './migrations.js';

// Thin wrapper around better-sqlite3 so the rest of the app depends on a small surface.
// If the native module ever fails to install on Windows, this is the only file that
// needs to swap to node:sqlite.
export type DB = Database.Database;

let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  ensureDataDir();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
