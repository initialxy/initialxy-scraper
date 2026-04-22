import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | undefined;
  expirationDate: number | undefined;
  session: boolean;
}

interface CookieRow {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: number;
  httpOnly: number;
  sameSite: string | null;
  expirationDate: number | null;
  session: number;
}

export class CookieStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cookies (
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        domain TEXT NOT NULL,
        path TEXT NOT NULL,
        secure INTEGER NOT NULL DEFAULT 0,
        httpOnly INTEGER NOT NULL DEFAULT 0,
        sameSite TEXT,
        expirationDate REAL,
        session INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (domain, name, path)
      )
    `);
  }

  save(cookie: StoredCookie): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO cookies (name, value, domain, path, secure, httpOnly, sameSite, expirationDate, session)
       VALUES (@name, @value, @domain, @path, @secure, @httpOnly, @sameSite, @expirationDate, @session)`
    );
    stmt.run({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure ? 1 : 0,
      httpOnly: cookie.httpOnly ? 1 : 0,
      sameSite: cookie.sameSite || null,
      expirationDate: cookie.expirationDate || null,
      session: cookie.session ? 1 : 0,
    });
  }

  saveAll(cookies: StoredCookie[]): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO cookies (name, value, domain, path, secure, httpOnly, sameSite, expirationDate, session)
       VALUES (@name, @value, @domain, @path, @secure, @httpOnly, @sameSite, @expirationDate, @session)`
    );
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const cookie of cookies) {
        insert.run({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure ? 1 : 0,
          httpOnly: cookie.httpOnly ? 1 : 0,
          sameSite: cookie.sameSite || null,
          expirationDate: cookie.expirationDate || null,
          session: cookie.session ? 1 : 0,
        });
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  loadAll(): StoredCookie[] {
    const now = Date.now() / 1000;
    const rows = this.db
      .prepare(
        `SELECT * FROM cookies
         WHERE session = 0
           AND (expirationDate IS NULL OR expirationDate > ?)`
      )
      .all(now) as unknown as CookieRow[];

    return rows.map((row) => ({
      name: row.name,
      value: row.value,
      domain: row.domain,
      path: row.path,
      secure: row.secure === 1,
      httpOnly: row.httpOnly === 1,
      sameSite: row.sameSite || undefined,
      expirationDate: row.expirationDate || undefined,
      session: row.session === 1,
    }));
  }

  loadByDomain(domain: string): StoredCookie[] {
    const now = Date.now() / 1000;
    const rows = this.db
      .prepare(
        `SELECT * FROM cookies
         WHERE domain = ?
           AND session = 0
           AND (expirationDate IS NULL OR expirationDate > ?)`
      )
      .all(domain, now) as unknown as CookieRow[];

    return rows.map((row) => ({
      name: row.name,
      value: row.value,
      domain: row.domain,
      path: row.path,
      secure: row.secure === 1,
      httpOnly: row.httpOnly === 1,
      sameSite: row.sameSite || undefined,
      expirationDate: row.expirationDate || undefined,
      session: row.session === 1,
    }));
  }

  deleteByDomain(domain: string): void {
    this.db.prepare('DELETE FROM cookies WHERE domain = ?').run(domain);
  }

  clear(): void {
    this.db.exec('DELETE FROM cookies');
  }

  cleanup(): number {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(
      `DELETE FROM cookies
       WHERE session = 1
          OR (session = 0 AND expirationDate IS NOT NULL AND expirationDate <= ?)`
    );
    const result = stmt.run(now);
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
  }
}
