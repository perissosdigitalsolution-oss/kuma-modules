#!/usr/bin/env node
// ============================================================================
// KUMA Module installer — Official School Calendar (Côte d'Ivoire).
//
//   node scripts/install.mjs              → detect host, print integration steps
//   node scripts/install.mjs --apply-schema → also apply schema.sql via wrangler
//   node scripts/install.mjs --zip        → build the distributable zip
//   node scripts/install.mjs --sync-data  → regenerate frontend/data.ts from data/
//
// The module is HOST-AGNOSTIC: nothing is copied into the host codebase.
// The host mounts ONE route + imports ONE component (printed below).
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const manifest = JSON.parse(readFileSync(path.join(MODULE_ROOT, 'module.json'), 'utf8'));

function findHost() {
    let dir = path.resolve(MODULE_ROOT, '..');
    for (let i = 0; i < 4; i++) {
        if (existsSync(path.join(dir, 'backend', 'src', 'index.ts'))) return dir;
        const next = path.resolve(dir, '..');
        if (next === dir) break;
        dir = next;
    }
    return null;
}

if (args.has('--sync-data')) {
    const dataFile = path.join(MODULE_ROOT, 'data', 'ci', '2026-2027.json');
    const raw = JSON.parse(readFileSync(dataFile, 'utf8'));
    const out = `// AUTO-GENERATED from data/ci/2026-2027.json — official MENA calendar, Côte d'Ivoire.
// Regenerate: node scripts/install.mjs --sync-data
// Shipped as TypeScript so the module bundle is self-contained (no host tsconfig changes).

export interface OfficialCalendarFile {
    annee_academique: string;
    pays: string;
    trimestres: { nom: string; debut: string; fin: string }[];
    conges_scolaires: { nom: string; debut: string; fin: string }[];
    evaluations_primaire_cp1_cm1: { nom: string; date: string }[];
    evaluations_primaire_cm2: { nom: string; date: string }[];
    [key: string]: unknown;
}

export const OFFICIAL_CALENDAR_CI_2026_2027: OfficialCalendarFile = ${JSON.stringify(raw, null, 4)};

export default OFFICIAL_CALENDAR_CI_2026_2027;
`;
    writeFileSync(path.join(MODULE_ROOT, 'frontend', 'data.ts'), out);
    console.log('✓ frontend/data.ts regenerated');
}

if (args.has('--zip')) {
    const { execSync } = await import('node:child_process');
    const outName = `${manifest.id}-${manifest.version}.zip`;
    execSync(`cd "${path.dirname(MODULE_ROOT)}" && zip -qr "${outName}" "${path.basename(MODULE_ROOT)}" -x "*/node_modules/*"`, { stdio: 'inherit' });
    console.log(`✓ ${path.join(path.dirname(MODULE_ROOT), outName)}`);
    process.exit(0);
}

console.log(`\n${manifest.name} v${manifest.version}\n`);

const hostRoot = findHost();
if (hostRoot) {
    const pkg = JSON.parse(readFileSync(path.join(hostRoot, 'backend', 'package.json'), 'utf8'));
    const honoOk = !!(pkg.dependencies?.hono || pkg.devDependencies?.hono || pkg.peerDependencies?.hono);
    console.log(`✓ Host detected: ${hostRoot}`);
    console.log(`${honoOk ? '✓' : '✗'} hono ${honoOk ? 'found' : 'MISSING'} in backend/package.json\n`);
    // TypeScript/Vite/esbuild resolve bare imports (react, hono, lucide-react…)
    // by walking up from the importing file. Give the module a node_modules
    // directory of per-package symlinks so embedded mode type-checks & builds.
    const feNodeModules = path.join(hostRoot, 'kuma-school-frontent-update', 'node_modules');
    const beNodeModules = path.join(hostRoot, 'backend', 'node_modules');
    const linkDir = path.join(MODULE_ROOT, 'node_modules');
    const wanted = { hono: beNodeModules, react: feNodeModules, 'lucide-react': feNodeModules };
    const { mkdirSync, symlinkSync, statSync } = await import('node:fs');
    try { mkdirSync(linkDir, { recursive: true }); } catch { /* exists */ }
    let linked = 0;
    for (const [pkg, fromDir] of Object.entries(wanted)) {
        const target = path.join(fromDir, pkg);
        const dest = path.join(linkDir, pkg);
        if (!existsSync(target) || existsSync(dest)) continue;
        try { symlinkSync(path.relative(linkDir, target), dest, 'dir'); linked++; } catch { /* non-fatal */ }
    }
    if (linked) console.log(`✓ linked ${linked} package(s) into module node_modules (TS/Vite resolution)\n`);
} else {
    console.log('ℹ No host codebase detected next to the module — standalone deployment is a perfect fit.\n');
}

console.log('── EMBEDDED INSTALL (2 lines in the host) ─────────────────────────────');
console.log('1) backend/src/index.ts — mount the sub-app:');
console.log(`   import { createCalendarModule } from '../../modules/calendar-ci/server/calendarModule';`);
console.log(`   app.route('${manifest.mountPath}', createCalendarModule());`);
console.log('2) frontend — add a menu entry that renders:');
console.log(`   import CalendarModuleView from '<path-to>/modules/calendar-ci/frontend/CalendarModuleView';`);
console.log(`   <CalendarModuleView lang={language === 'en' ? 'en' : 'fr'} />`);
console.log('3) schema (idempotent, module-owned tables):');
console.log(`   npx wrangler d1 execute <DB> --remote --file modules/calendar-ci/server/schema.sql\n`);

console.log('── STANDALONE INSTALL (zero host code) ────────────────────────────────');
console.log('   cd modules/calendar-ci/server/standalone');
console.log('   # edit wrangler.toml → your D1 database id');
console.log('   npx wrangler d1 execute <DB> --remote --file ../schema.sql');
console.log('   npx wrangler secret put JWT_SECRET   # SAME secret as the host platform');
console.log('   npx wrangler deploy');
console.log('   → frontend: <CalendarModuleView apiBase="https://<worker>/api/v1/modules/calendar" />');
console.log(`\nAPI contract (stable): ${manifest.mountPath}/v1/{years,years/:label,import,today,upcoming,health}\n`);

if (args.has('--apply-schema') && hostRoot) {
    const { execSync } = await import('node:child_process');
    const db = process.env.KUMA_D1_NAME || 'kuma-school-production-db';
    console.log(`── Applying schema to D1 "${db}" (remote) ──`);
    execSync(
        `cd "${path.join(hostRoot, 'backend')}" && npx wrangler d1 execute ${db} --env production --remote --file "${path.join(MODULE_ROOT, 'server', 'schema.sql')}"`,
        { stdio: 'inherit' }
    );
    execSync(
        `cd "${path.join(hostRoot, 'backend')}" && npx wrangler d1 execute ${db} --env production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('module:calendar-ci@${manifest.version}');"`,
        { stdio: 'inherit' }
    );
    console.log(`✓ schema applied + registered as module:calendar-ci@${manifest.version}`);
}
