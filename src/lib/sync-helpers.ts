import type { SyncStatus } from "./api";

// Tolerant commit-hash comparison: case, whitespace, and full-vs-short SHA.
export function commitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(nb) || nb.startsWith(na);
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const ts = Date.parse(iso.includes('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  if (Number.isNaN(ts)) return iso;
  const diff = now - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

export function formatLocalTime(iso: string): string {
  const ts = Date.parse(iso.includes('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleTimeString();
}

export function humanizeSource(src: string): string {
  return src
    .split('-')
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ');
}

// F5: dismissed-attempt localStorage helpers
export const DISMISSED_KEY = 'splan_dismissedAttempts';
export const DISMISSED_MAX = 50;

export function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('not an array');
    return arr.filter((x: unknown) => typeof x === 'string');
  } catch {
    try { localStorage.setItem(DISMISSED_KEY, '[]'); } catch { /* ignore */ }
    return [];
  }
}

export function writeDismissed(list: string[]): void {
  try {
    const trimmed = list.slice(-DISMISSED_MAX);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(trimmed));
  } catch { /* storage full */ }
}

// F8: pending-deploy persistence
export interface PendingDeploy {
  targetCommit: string;
  startTime: number;
  filesChanged: number;
  remoteUrl?: string;
}

export const PENDING_DEPLOY_KEY = 'splan_pendingDeploy';
export const PENDING_DEPLOY_MAX_AGE_MS = 30 * 60 * 1000;

export function readPendingDeploy(): PendingDeploy | null {
  try {
    const raw = localStorage.getItem(PENDING_DEPLOY_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj.targetCommit === 'string' && typeof obj.startTime === 'number') return obj;
    return null;
  } catch { return null; }
}

export function writePendingDeploy(p: PendingDeploy): void {
  try { localStorage.setItem(PENDING_DEPLOY_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function clearPendingDeploy(): void {
  try { localStorage.removeItem(PENDING_DEPLOY_KEY); } catch { /* ignore */ }
}

// F6: decide whether auto-sync should fire, and in which direction
export function shouldAutoSync(status: SyncStatus | null, autoSyncEnabled: boolean): 'push' | 'pull' | null {
  if (!autoSyncEnabled) return null;
  if (!status || !status.configured) return null;
  if (status.schema && !status.schema.match) return null;
  const local = status.local?.changeCount ?? 0;
  const remote = status.remote?.changeCount ?? 0;
  if (local > 0 && remote === 0) return 'push';
  if (remote > 0 && local === 0) return 'pull';
  return null;
}
