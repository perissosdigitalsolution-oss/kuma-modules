#!/usr/bin/env node
// Headless import of the official calendar via the module API (no browser).
//   KUMA_URL=https://...  KUMA_EMAIL=admin@...  KUMA_PASSWORD=... \
//   KUMA_MODULE_BASE=/api/v1/modules/calendar \
//   node scripts/import-via-api.mjs [data/ci/2026-2027.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.KUMA_URL || '').replace(/\/$/, '');
if (!base) { console.error('Set KUMA_URL (e.g. https://kuma-school-backend-production...workers.dev)'); process.exit(1); }
const email = process.env.KUMA_EMAIL, password = process.env.KUMA_PASSWORD;
if (!email || !password) { console.error('Set KUMA_EMAIL and KUMA_PASSWORD'); process.exit(1); }

const fileArg = process.argv[2];
const dataFile = fileArg
    ? path.resolve(process.cwd(), fileArg)
    : path.join(MODULE_ROOT, 'data', 'ci', '2026-2027.json');
const payload = JSON.parse(readFileSync(dataFile, 'utf8'));
const moduleBase = process.env.KUMA_MODULE_BASE || '/api/v1/modules/calendar';

const loginRes = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
});
if (!loginRes.ok) { console.error(`Login failed: ${loginRes.status}`); process.exit(1); }
const { access_token: token } = await loginRes.json();
if (!token) { console.error('No access_token in login response'); process.exit(1); }

const res = await fetch(`${base}${moduleBase}/v1/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
});
const body = await res.json().catch(() => ({}));
console.log(res.ok ? `✓ ${JSON.stringify(body)}` : `✗ ${res.status} ${JSON.stringify(body)}`);
process.exit(res.ok ? 0 : 1);
