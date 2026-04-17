#!/usr/bin/env node
/**
 * Migrate existing scheduled agents to the v2 prompt (inputs-broker architecture).
 *
 * Reads .splan/agent-schedules.json, deletes each live Anthropic trigger, then
 * POSTs to the local server's /api/agents/schedules to recreate each schedule
 * with the server-side-baked v2 prompt. The recreation path snapshots the
 * fresh promptSnapshot and expectedSchemaFingerprint.
 *
 * Preconditions:
 *  - Local server running on PORT (default 3100).
 *  - SCHEDULED_AGENT_TOKEN set in the local .env (interpolated into the prompt).
 *  - SCHEDULED_AGENT_REMOTE_URL (or SYNC_REMOTE_URL) set to the Railway URL.
 *
 * This script is destructive in that it deletes live Anthropic triggers. Always
 * verify the local server is healthy before running. The v1 triggers are gone
 * once this completes — to roll back, recreate v1 schedules by hand.
 *
 * Usage: npm run migrate-schedules-v2
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const SCHEDULES_FILE = path.join(PROJECT_DIR, '.splan', 'agent-schedules.json');
const MIGRATION_MARKER = path.join(PROJECT_DIR, '.splan', 'migrations-applied.json');
const PORT = process.env.PORT || '3100';
const BASE = `http://localhost:${PORT}`;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
}

async function main() {
  const marker = readJson(MIGRATION_MARKER, {});
  if (marker['schedules.v2'] === true && !process.argv.includes('--force')) {
    console.log('schedules.v2 already applied. Pass --force to re-run.');
    process.exit(0);
  }

  const schedules = readJson(SCHEDULES_FILE, {});
  const agentIds = Object.keys(schedules);
  if (agentIds.length === 0) {
    console.log('No schedules to migrate.');
    marker['schedules.v2'] = true;
    writeJson(MIGRATION_MARKER, marker);
    return;
  }

  console.log(`Found ${agentIds.length} schedule(s) to migrate: ${agentIds.join(', ')}`);

  for (const agentId of agentIds) {
    const existing = schedules[agentId];
    console.log(`\n── ${agentId} ──`);
    console.log(`  cron: ${existing.cronExpression}`);
    console.log(`  oldTriggerId: ${existing.triggerId}`);

    if (existing.triggerId) {
      try {
        console.log('  deleting old Anthropic trigger…');
        execSync(`claude schedule delete ${existing.triggerId}`, {
          stdio: 'inherit',
          shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
          cwd: PROJECT_DIR,
        });
      } catch (e) {
        console.error(`  WARN: delete failed (${e.message}); continuing with recreate.`);
      }
    }

    console.log('  recreating schedule via local server…');
    const body = {
      agentId,
      agentName: existing.agentName ?? agentId,
      config: {
        cronExpression: existing.cronExpression,
        cronLabel: existing.cronLabel ?? '',
        promptOverride: existing.promptOverride,
        paramDefaults: existing.paramDefaults ?? {},
        // triggerId omitted — we already deleted it above.
      },
      // prompt field deliberately empty: for registry agents, server builds
      // the prompt from the code template. The PRD pattern.
      prompt: '',
    };
    const res = await fetch(`${BASE}/api/agents/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`  FAILED: ${JSON.stringify(json)}`);
      process.exit(1);
    }
    console.log(`  ok. new triggerId=${json.triggerId}`);
  }

  marker['schedules.v2'] = true;
  marker['schedules.v2.appliedAt'] = new Date().toISOString();
  writeJson(MIGRATION_MARKER, marker);
  console.log('\nAll schedules migrated. Marker written to', MIGRATION_MARKER);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
