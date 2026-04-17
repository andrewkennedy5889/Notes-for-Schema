import { describe, it, expect, beforeEach } from 'vitest';
import {
  commitsMatch,
  formatRelative,
  humanizeSource,
  readDismissed,
  writeDismissed,
  DISMISSED_MAX,
  DISMISSED_KEY,
  readPendingDeploy,
  writePendingDeploy,
  clearPendingDeploy,
  PENDING_DEPLOY_KEY,
  shouldAutoSync,
} from './sync-helpers';
import type { SyncStatus } from './api';

function installLocalStorageShim() {
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
}

describe('commitsMatch', () => {
  it('returns false for nullish on either side', () => {
    expect(commitsMatch(null, 'abc')).toBe(false);
    expect(commitsMatch('abc', null)).toBe(false);
    expect(commitsMatch(null, null)).toBe(false);
    expect(commitsMatch(undefined, 'abc')).toBe(false);
  });

  it('returns false for empty/whitespace strings', () => {
    expect(commitsMatch('', 'abc')).toBe(false);
    expect(commitsMatch('   ', 'abc')).toBe(false);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(commitsMatch('  ABC \n', 'abc')).toBe(true);
    expect(commitsMatch('Abc1234', 'aBC1234')).toBe(true);
  });

  it('matches identical strings', () => {
    expect(commitsMatch('abc1234', 'abc1234')).toBe(true);
  });

  it('matches short prefix to full SHA in either direction', () => {
    expect(commitsMatch('abc1234', 'abc1234567890')).toBe(true);
    expect(commitsMatch('abc1234567890', 'abc1234')).toBe(true);
  });

  it('returns false when neither is a prefix of the other', () => {
    expect(commitsMatch('abc1234', 'def5678')).toBe(false);
    expect(commitsMatch('abc1234', 'abd1234')).toBe(false);
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-04-17T14:00:00Z');

  it('returns "just now" for very recent times', () => {
    expect(formatRelative('2026-04-17T13:59:57Z', now)).toBe('just now');
  });

  it('formats seconds', () => {
    expect(formatRelative('2026-04-17T13:59:30Z', now)).toBe('30s ago');
  });

  it('formats singular minute', () => {
    expect(formatRelative('2026-04-17T13:59:00Z', now)).toBe('1 minute ago');
  });

  it('formats plural minutes', () => {
    expect(formatRelative('2026-04-17T13:45:00Z', now)).toBe('15 minutes ago');
  });

  it('formats hours', () => {
    expect(formatRelative('2026-04-17T11:00:00Z', now)).toBe('3 hours ago');
  });

  it('formats days', () => {
    expect(formatRelative('2026-04-15T14:00:00Z', now)).toBe('2 days ago');
  });

  it('tolerates timestamps without Z suffix', () => {
    expect(formatRelative('2026-04-17T13:59:00', now)).toBe('1 minute ago');
  });

  it('returns the raw string for unparseable input', () => {
    expect(formatRelative('not-a-date', now)).toBe('not-a-date');
  });
});

describe('humanizeSource', () => {
  it('title-cases hyphenated source strings', () => {
    expect(humanizeSource('manual-push')).toBe('Manual Push');
    expect(humanizeSource('auto-pull')).toBe('Auto Pull');
    expect(humanizeSource('deploy-push')).toBe('Deploy Push');
    expect(humanizeSource('deploy-push-timeout')).toBe('Deploy Push Timeout');
  });

  it('leaves single words capitalized', () => {
    expect(humanizeSource('manual')).toBe('Manual');
    expect(humanizeSource('inbound')).toBe('Inbound');
  });

  it('tolerates empty segments without crashing', () => {
    expect(humanizeSource('foo--bar')).toBe('Foo  Bar');
  });
});

describe('readDismissed / writeDismissed', () => {
  beforeEach(() => installLocalStorageShim());

  it('returns empty array when no value is stored', () => {
    expect(readDismissed()).toEqual([]);
  });

  it('parses a valid stored array', () => {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(['a', 'b', 'c']));
    expect(readDismissed()).toEqual(['a', 'b', 'c']);
  });

  it('filters out non-string entries', () => {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(['a', 1, null, 'b']));
    expect(readDismissed()).toEqual(['a', 'b']);
  });

  it('resets and returns [] when stored value is corrupt JSON', () => {
    localStorage.setItem(DISMISSED_KEY, '{not-json');
    expect(readDismissed()).toEqual([]);
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('[]');
  });

  it('returns [] when stored value is non-array JSON', () => {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify({ foo: 'bar' }));
    expect(readDismissed()).toEqual([]);
  });

  it('writeDismissed caps the list at DISMISSED_MAX', () => {
    const long = Array.from({ length: DISMISSED_MAX + 10 }, (_, i) => `id-${i}`);
    writeDismissed(long);
    const stored = JSON.parse(localStorage.getItem(DISMISSED_KEY) as string) as string[];
    expect(stored.length).toBe(DISMISSED_MAX);
    // Oldest are evicted — newest are kept
    expect(stored[0]).toBe(`id-10`);
    expect(stored[stored.length - 1]).toBe(`id-${DISMISSED_MAX + 9}`);
  });

  it('writeDismissed round-trips through readDismissed', () => {
    writeDismissed(['x', 'y']);
    expect(readDismissed()).toEqual(['x', 'y']);
  });
});

describe('readPendingDeploy / writePendingDeploy / clearPendingDeploy', () => {
  beforeEach(() => installLocalStorageShim());

  it('returns null when nothing is stored', () => {
    expect(readPendingDeploy()).toBeNull();
  });

  it('round-trips a valid pending deploy object', () => {
    const p = { targetCommit: 'abc1234', startTime: 1700000000000, filesChanged: 3, remoteUrl: 'https://x.y' };
    writePendingDeploy(p);
    expect(readPendingDeploy()).toEqual(p);
  });

  it('returns null for malformed stored values', () => {
    localStorage.setItem(PENDING_DEPLOY_KEY, JSON.stringify({ notTargetCommit: true }));
    expect(readPendingDeploy()).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    localStorage.setItem(PENDING_DEPLOY_KEY, '{bad json');
    expect(readPendingDeploy()).toBeNull();
  });

  it('clearPendingDeploy removes the key', () => {
    writePendingDeploy({ targetCommit: 'abc', startTime: 1, filesChanged: 0 });
    clearPendingDeploy();
    expect(readPendingDeploy()).toBeNull();
    expect(localStorage.getItem(PENDING_DEPLOY_KEY)).toBeNull();
  });
});

describe('shouldAutoSync', () => {
  const base: SyncStatus = {
    configured: true,
    remoteUrl: 'https://x.y',
    schema: { match: true, missingOnRemote: [], missingOnLocal: [] },
    local: { changeCount: 0, changes: [] },
    remote: { changeCount: 0, changes: [] },
  };

  it('returns null when auto-sync is disabled', () => {
    expect(shouldAutoSync({ ...base, local: { changeCount: 5, changes: [] } }, false)).toBeNull();
  });

  it('returns null when status is null', () => {
    expect(shouldAutoSync(null, true)).toBeNull();
  });

  it('returns null when not configured', () => {
    expect(shouldAutoSync({ ...base, configured: false }, true)).toBeNull();
  });

  it('returns null when schema mismatches', () => {
    const s = { ...base, schema: { match: false, missingOnRemote: ['_splan_x'], missingOnLocal: [] } };
    expect(shouldAutoSync({ ...s, local: { changeCount: 5, changes: [] } }, true)).toBeNull();
  });

  it('returns "push" when only local has changes', () => {
    expect(shouldAutoSync({ ...base, local: { changeCount: 5, changes: [] } }, true)).toBe('push');
  });

  it('returns "pull" when only remote has changes', () => {
    expect(shouldAutoSync({ ...base, remote: { changeCount: 3, changes: [] } }, true)).toBe('pull');
  });

  it('returns null when both sides have changes (conflict)', () => {
    const s = { ...base, local: { changeCount: 2, changes: [] }, remote: { changeCount: 3, changes: [] } };
    expect(shouldAutoSync(s, true)).toBeNull();
  });

  it('returns null when both sides are clean', () => {
    expect(shouldAutoSync(base, true)).toBeNull();
  });

  it('tolerates missing remote/local fields', () => {
    expect(shouldAutoSync({ ...base, local: undefined, remote: undefined }, true)).toBeNull();
  });
});
