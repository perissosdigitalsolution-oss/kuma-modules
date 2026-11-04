#!/usr/bin/env node
// Apply the module schema (idempotent) to a D1 database.
//   node scripts/apply-schema.mjs [--local]
// Env: KUMA_D1_NAME (default kuma-school-production-db), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = process.env.KUMA_D1_NAME || 'kuma-school-production-db';
const scope = process.argv.includes('--local') ? '--local' : '--env production --remote';

execSync(
    `npx wrangler d1 execute ${db} ${scope} --file "${path.join(MODULE_ROOT, 'server', 'schema.sql')}"`,
    { stdio: 'inherit', cwd: process.cwd() }
);
console.log(`✓ mod_calendar_* tables ready on ${db}`);
