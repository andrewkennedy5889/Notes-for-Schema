import type { Request, Response, NextFunction } from 'express';

export type AppMode = 'local' | 'hosted';

export function readAppMode(env: NodeJS.ProcessEnv = process.env): AppMode {
  const raw = (env.APP_MODE ?? '').toLowerCase().trim();
  return raw === 'hosted' ? 'hosted' : 'local';
}

// Cached at module load so every request sees a stable value. Tests that need
// to flip the mode should call resetAppModeForTesting() after mutating env.
let cachedMode: AppMode = readAppMode();

export function getAppMode(): AppMode {
  return cachedMode;
}

export function resetAppModeForTesting(mode?: AppMode): void {
  cachedMode = mode ?? readAppMode();
}

export function requireLocal(req: Request, res: Response, next: NextFunction): void {
  if (getAppMode() === 'local') return next();
  res.status(403).json({
    error: 'This endpoint is disabled on the hosted instance. Run it from the local app.',
    mode: 'hosted',
  });
}
