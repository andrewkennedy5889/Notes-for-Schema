/**
 * Tests for server/app-mode.ts — the APP_MODE env-var reader and requireLocal
 * middleware that gate dev-only routes (deploy-code, github-config rotation,
 * agent launch) from the hosted instance.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { type Request, type Response } from 'express';
import http from 'http';
import {
  readAppMode,
  getAppMode,
  resetAppModeForTesting,
  requireLocal,
} from '../server/app-mode.js';

const TEST_PORT = 3198;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('readAppMode', () => {
  it('defaults to local when APP_MODE is unset', () => {
    expect(readAppMode({})).toBe('local');
  });

  it('returns hosted when APP_MODE=hosted', () => {
    expect(readAppMode({ APP_MODE: 'hosted' })).toBe('hosted');
  });

  it('is case-insensitive and ignores whitespace', () => {
    expect(readAppMode({ APP_MODE: '  HOSTED  ' })).toBe('hosted');
    expect(readAppMode({ APP_MODE: 'Local' })).toBe('local');
  });

  it('falls back to local for unknown values', () => {
    expect(readAppMode({ APP_MODE: 'production' })).toBe('local');
    expect(readAppMode({ APP_MODE: '' })).toBe('local');
  });
});

describe('requireLocal middleware', () => {
  let server: http.Server;

  beforeEach(() => {
    // Each test spins up a fresh tiny app so route order is deterministic.
    const app = express();
    app.post('/gated', requireLocal, (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    server = app.listen(TEST_PORT);
  });

  afterAll(() => {
    resetAppModeForTesting(); // restore from env
  });

  it('allows requests when mode is local', async () => {
    resetAppModeForTesting('local');
    expect(getAppMode()).toBe('local');

    const res = await fetch(`${BASE_URL}/gated`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('returns 403 with mode:hosted when mode is hosted', async () => {
    resetAppModeForTesting('hosted');
    expect(getAppMode()).toBe('hosted');

    const res = await fetch(`${BASE_URL}/gated`, { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.mode).toBe('hosted');
    expect(body.error).toMatch(/hosted instance/i);

    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('re-evaluates mode on each request so toggling applies immediately', async () => {
    resetAppModeForTesting('local');
    const allow = await fetch(`${BASE_URL}/gated`, { method: 'POST' });
    expect(allow.status).toBe(200);

    resetAppModeForTesting('hosted');
    const block = await fetch(`${BASE_URL}/gated`, { method: 'POST' });
    expect(block.status).toBe(403);

    await new Promise<void>(resolve => server.close(() => resolve()));
  });
});
