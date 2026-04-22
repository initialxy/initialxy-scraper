import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CookieStore } from './cookie_store.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('CookieStore', () => {
  let store: CookieStore;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-store-test-'));
    dbPath = path.join(tmpDir, 'cookies.db');
    store = new CookieStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.unlinkSync(dbPath);
    fs.rmdirSync(path.dirname(dbPath));
  });

  it('should save and load a cookie', () => {
    const cookie = {
      name: 'session',
      value: 'abc123',
      domain: 'example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    };

    store.save(cookie);
    const loaded = store.loadAll();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(cookie);
  });

  it('should save multiple cookies', () => {
    store.save({
      name: 'a',
      value: '1',
      domain: 'a.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });
    store.save({
      name: 'b',
      value: '2',
      domain: 'b.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'strict',
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(2);
  });

  it('should replace cookie with same key (domain + name + path)', () => {
    store.save({
      name: 'session',
      value: 'old',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });
    store.save({
      name: 'session',
      value: 'new',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].value).toBe('new');
  });

  it('should expire session cookies on load', () => {
    store.save({
      name: 'session',
      value: 'abc',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: undefined,
      session: true,
    });

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(0);
  });

  it('should expire cookies past their expiration date', () => {
    store.save({
      name: 'old',
      value: 'expired',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 - 3600,
      session: false,
    });

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(0);
  });

  it('should keep valid non-session cookies', () => {
    store.save({
      name: 'persistent',
      value: 'data',
      domain: 'example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      expirationDate: Date.now() / 1000 + 86400,
      session: false,
    });

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('persistent');
  });

  it('should load cookies by domain', () => {
    store.save({
      name: 'a',
      value: '1',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });
    store.save({
      name: 'b',
      value: '2',
      domain: 'other.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    const loaded = store.loadByDomain('example.com');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('a');
  });

  it('should delete cookies by domain', () => {
    store.save({
      name: 'a',
      value: '1',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });
    store.save({
      name: 'b',
      value: '2',
      domain: 'other.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    store.deleteByDomain('example.com');
    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('b');
  });

  it('should clear all cookies', () => {
    store.save({
      name: 'a',
      value: '1',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });
    store.save({
      name: 'b',
      value: '2',
      domain: 'other.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    store.clear();
    const loaded = store.loadAll();
    expect(loaded).toHaveLength(0);
  });

  it('should handle batch save', () => {
    const cookies = [
      {
        name: 'a',
        value: '1',
        domain: 'a.com',
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: undefined,
        expirationDate: Date.now() / 1000 + 3600,
        session: false,
      },
      {
        name: 'b',
        value: '2',
        domain: 'b.com',
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: undefined,
        expirationDate: Date.now() / 1000 + 3600,
        session: false,
      },
      {
        name: 'c',
        value: '3',
        domain: 'c.com',
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: undefined,
        expirationDate: Date.now() / 1000 + 3600,
        session: false,
      },
    ];
    store.saveAll(cookies);

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(3);
  });

  it('should create database directory if it does not exist', () => {
    const nestedPath = path.join(os.tmpdir(), 'cookie-store-test-nested', 'sub', 'cookies.db');
    const nestedStore = new CookieStore(nestedPath);

    // better-sqlite3 creates the file on open
    expect(fs.existsSync(nestedPath)).toBe(true);
    nestedStore.close();
    fs.unlinkSync(nestedPath);
    fs.rmdirSync(path.join(os.tmpdir(), 'cookie-store-test-nested', 'sub'));
    fs.rmdirSync(path.join(os.tmpdir(), 'cookie-store-test-nested'));
  });

  it('should store sameSite correctly', () => {
    store.save({
      name: 'cookie',
      value: 'val',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: 'strict',
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    const loaded = store.loadAll();
    expect(loaded[0].sameSite).toBe('strict');
  });

  it('should handle undefined sameSite', () => {
    store.save({
      name: 'cookie',
      value: 'val',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    const loaded = store.loadAll();
    expect(loaded[0].sameSite).toBeUndefined();
  });

  it('should remove session cookies on cleanup', () => {
    store.save({
      name: 'session',
      value: 'abc',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: undefined,
      session: true,
    });
    store.save({
      name: 'persistent',
      value: 'data',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    const removed = store.cleanup();
    expect(removed).toBe(1);

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('persistent');
  });

  it('should remove expired cookies on cleanup', () => {
    store.save({
      name: 'expired',
      value: 'old',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 - 3600,
      session: false,
    });
    store.save({
      name: 'valid',
      value: 'new',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: undefined,
      expirationDate: Date.now() / 1000 + 3600,
      session: false,
    });

    const removed = store.cleanup();
    expect(removed).toBe(1);

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('valid');
  });

  it('should return 0 when nothing to cleanup', () => {
    const removed = store.cleanup();
    expect(removed).toBe(0);
  });
});
