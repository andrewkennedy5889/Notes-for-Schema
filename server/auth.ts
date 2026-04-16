import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const COOKIE_NAME = 'splan_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

function makeToken(password: string): string {
  return crypto.createHmac('sha256', password).update('schema-planner-session').digest('hex');
}

function getCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const match = raw.split(';').find(c => c.trim().startsWith(`${name}=`));
  return match ? match.split('=').slice(1).join('=').trim() : undefined;
}

export const authRouter = Router();

// Login page
authRouter.get('/auth/login', (_req: Request, res: Response) => {
  res.type('html').send(loginHtml());
});

// Login handler
authRouter.post('/auth/login', (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!AUTH_PASSWORD || password !== AUTH_PASSWORD) {
    return void res.type('html').send(loginHtml('Incorrect password'));
  }
  const token = makeToken(AUTH_PASSWORD);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`);
  res.redirect('/');
});

// Logout
authRouter.post('/auth/logout', (_req: Request, res: Response) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
  res.redirect('/auth/login');
});

// Auth check (for frontend to detect logged-in state)
authRouter.get('/auth/check', (req: Request, res: Response) => {
  if (!AUTH_PASSWORD) return void res.json({ authenticated: true, authEnabled: false });
  const token = getCookie(req, COOKIE_NAME);
  const expected = makeToken(AUTH_PASSWORD);
  res.json({ authenticated: token === expected, authEnabled: true });
});

// Middleware: protect all routes when AUTH_PASSWORD is set
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth if no password configured (local dev)
  if (!AUTH_PASSWORD) return next();

  // Allow auth routes through
  if (req.path.startsWith('/auth/')) return next();

  const token = getCookie(req, COOKIE_NAME);
  const expected = makeToken(AUTH_PASSWORD);

  if (token === expected) return next();

  // API requests get 401
  if (req.path.startsWith('/api/')) {
    return void res.status(401).json({ error: 'Unauthorized' });
  }

  // Everything else redirects to login
  res.redirect('/auth/login');
}

function loginHtml(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#0f172a">
  <title>Schema Planner</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100dvh;
      padding: env(safe-area-inset-top, 1rem) 1rem env(safe-area-inset-bottom, 1rem);
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 360px;
    }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 0.5rem; }
    input[type="password"] {
      width: 100%;
      padding: 0.75rem;
      border-radius: 8px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 1rem;
      outline: none;
      -webkit-appearance: none;
    }
    input:focus { border-color: #3b82f6; }
    button {
      width: 100%;
      padding: 0.75rem;
      border-radius: 8px;
      border: none;
      background: #3b82f6;
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 1rem;
      -webkit-appearance: none;
    }
    button:active { background: #2563eb; }
    .error { color: #f87171; font-size: 0.875rem; margin-top: 0.75rem; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Schema Planner</h1>
    <p class="subtitle">Enter your password to continue</p>
    <form method="POST" action="/auth/login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" autofocus required>
      <button type="submit">Sign In</button>
      ${error ? `<p class="error">${error}</p>` : ''}
    </form>
  </div>
</body>
</html>`;
}
