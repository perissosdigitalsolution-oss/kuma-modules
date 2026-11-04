// ============================================================================
// KUMA Module: Official School Calendar — Hono sub-app (mountable).
//
// Embedded mode (host worker):
//   import { createCalendarModule } from '../../modules/calendar-ci/server/calendarModule';
//   app.route('/api/v1/modules/calendar', createCalendarModule());
//   → the host's global /api/v1 auth + tenant middlewares protect it.
//
// Standalone mode: server/standalone/index.ts mounts the SAME factory and
// supplies its own auth middleware that sets the same context vars
// (tenantId, jwtPayload). No host code is ever imported here.
//
// Only external dependency: hono (peer dependency of the module).
// ============================================================================
import { Hono } from 'hono';
import { parseCalendarFile, dayStatus, upcoming, toIsoDate, type ParsedCalendar, type RawCalendarFile } from './logic';

/** Roles allowed to import/replace a calendar (school leadership). */
const CALENDAR_ADMIN_ROLES = new Set([
    'admin', 'director', 'directeur', 'directrice', 'founder', 'fondatrice',
    'manager', 'gestionnaire',
]);

/** Minimal D1 surface used by the module (works with Cloudflare D1). */
interface ModuleDB {
    prepare(sql: string): {
        bind(...vals: unknown[]): {
            first<T = Record<string, unknown>>(): Promise<T | null>;
            all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
            run(): Promise<unknown>;
        };
        first<T = Record<string, unknown>>(): Promise<T | null>;
        all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
    batch(stmts: unknown[]): Promise<unknown>;
}

interface ModuleEnv { DB: ModuleDB; [k: string]: unknown }
type ModContext = { env: ModuleEnv } & Record<string, unknown>;

interface ModPayload { sub?: string; role?: string; schoolId?: string; tenantId?: string; email?: string }

function resolveContext(c: ModContext): { tenantId: string; role: string; userId: string } {
    const payload = ((c.get as (k: string) => unknown)?.('jwtPayload') || {}) as ModPayload;
    const tenantId = String(
        (c.get as (k: string) => unknown)?.('tenantId') || payload.schoolId || payload.tenantId || 'default'
    );
    return { tenantId, role: String(payload.role || '').toLowerCase(), userId: String(payload.sub || '') };
}

function genId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

/** Load the newest calendar year (by start_date) for a school, fully expanded. */
async function loadLatestCalendar(db: ModuleDB, tenantId: string): Promise<ParsedCalendar & { id: string; sourceVersion: string | null } | null> {
    const year = await db.prepare(
        'SELECT * FROM mod_calendar_years WHERE school_id = ? ORDER BY COALESCE(start_date, \'9999\') DESC, imported_at DESC LIMIT 1'
    ).bind(tenantId).first<{ id: string; label: string; country: string; start_date: string | null; end_date: string | null; source_version: string | null }>();
    if (!year) return null;

    const [terms, breaks, evals, hols] = await Promise.all([
        db.prepare('SELECT * FROM mod_calendar_terms WHERE year_id = ? ORDER BY term_number ASC').bind(year.id).all(),
        db.prepare('SELECT * FROM mod_calendar_breaks WHERE year_id = ? ORDER BY start_date ASC').bind(year.id).all(),
        db.prepare('SELECT * FROM mod_calendar_evaluations WHERE year_id = ? ORDER BY date ASC').bind(year.id).all(),
        db.prepare('SELECT * FROM mod_calendar_holidays WHERE year_id = ? ORDER BY date ASC').bind(year.id).all(),
    ]);

    return {
        id: year.id,
        label: year.label,
        country: year.country,
        startDate: year.start_date,
        endDate: year.end_date,
        sourceVersion: year.source_version,
        terms: (terms.results || []).map((t: Record<string, unknown>) => ({
            label: String(t.label), termNumber: Number(t.term_number) || 1, startDate: String(t.start_date), endDate: String(t.end_date),
        })),
        breaks: (breaks.results || []).map((b: Record<string, unknown>) => ({
            label: String(b.label), startDate: String(b.start_date), endDate: String(b.end_date),
        })),
        evaluations: (evals.results || []).map((e: Record<string, unknown>) => ({
            label: String(e.label), date: String(e.date), track: String(e.track), kind: String(e.kind),
        })),
        holidays: (hols.results || []).map((h: Record<string, unknown>) => ({
            label: String(h.label), date: String(h.date), kind: String(h.kind),
        })),
    };
}

export function createCalendarModule() {
    const app = new Hono();

    // ── GET /v1/years ────────────────────────────────────────────────────────
    app.get('/v1/years', async (c: ModContext) => {
        try {
            const { tenantId } = resolveContext(c);
            const { results } = await c.env.DB.prepare(`
                SELECT y.id, y.label, y.country, y.start_date, y.end_date, y.source_version, y.imported_at,
                    (SELECT COUNT(*) FROM mod_calendar_terms t WHERE t.year_id = y.id) AS terms_count,
                    (SELECT COUNT(*) FROM mod_calendar_evaluations e WHERE e.year_id = y.id) AS evaluations_count,
                    (SELECT COUNT(*) FROM mod_calendar_breaks b WHERE b.year_id = y.id) AS breaks_count,
                    (SELECT COUNT(*) FROM mod_calendar_holidays h WHERE h.year_id = y.id) AS holidays_count
                FROM mod_calendar_years y WHERE y.school_id = ?
                ORDER BY COALESCE(y.start_date, '9999') DESC
            `).bind(tenantId).all();
            return c.json({ apiVersion: 'v1', years: results || [] });
        } catch (e) {
            console.error('[calendar-module] years error:', e);
            return c.json({ error: 'Failed to list calendar years' }, 500);
        }
    });

    // ── GET /v1/years/:label — full detail ──────────────────────────────────
    app.get('/v1/years/:label', async (c: ModContext) => {
        try {
            const { tenantId } = resolveContext(c);
            const label = c.req.param('label');
            const year = await c.env.DB.prepare(
                'SELECT * FROM mod_calendar_years WHERE school_id = ? AND label = ? LIMIT 1'
            ).bind(tenantId, label).first<{ id: string }>();
            if (!year) return c.json({ error: 'Calendar year not found' }, 404);

            const [terms, breaks, evals, hols] = await Promise.all([
                c.env.DB.prepare('SELECT * FROM mod_calendar_terms WHERE year_id = ? ORDER BY term_number ASC').bind(year.id).all(),
                c.env.DB.prepare('SELECT * FROM mod_calendar_breaks WHERE year_id = ? ORDER BY start_date ASC').bind(year.id).all(),
                c.env.DB.prepare('SELECT * FROM mod_calendar_evaluations WHERE year_id = ? ORDER BY date ASC').bind(year.id).all(),
                c.env.DB.prepare('SELECT * FROM mod_calendar_holidays WHERE year_id = ? ORDER BY date ASC').bind(year.id).all(),
            ]);
            return c.json({
                apiVersion: 'v1',
                year: { label, ...year },
                terms: terms.results || [],
                breaks: breaks.results || [],
                evaluations: evals.results || [],
                holidays: hols.results || [],
            });
        } catch (e) {
            console.error('[calendar-module] year detail error:', e);
            return c.json({ error: 'Failed to fetch calendar year' }, 500);
        }
    });

    // ── POST /v1/import — school leadership only; idempotent upsert ─────────
    app.post('/v1/import', async (c: ModContext) => {
        try {
            const { tenantId, role, userId } = resolveContext(c);
            if (!CALENDAR_ADMIN_ROLES.has(role)) return c.json({ error: 'Forbidden' }, 403);

            const raw = await c.req.json<RawCalendarFile>();
            const parsed = parseCalendarFile(raw);

            const now = new Date().toISOString();
            const yearId = genId('mcy');
            const db = c.env.DB;

            // Idempotent: replace any previous import of the same (school, country, label).
            const existing = await db.prepare(
                'SELECT id FROM mod_calendar_years WHERE school_id = ? AND country = ? AND label = ?'
            ).bind(tenantId, parsed.country, parsed.label).first<{ id: string }>();
            if (existing) await db.batch([
                db.prepare('DELETE FROM mod_calendar_terms WHERE year_id = ?').bind(existing.id),
                db.prepare('DELETE FROM mod_calendar_breaks WHERE year_id = ?').bind(existing.id),
                db.prepare('DELETE FROM mod_calendar_evaluations WHERE year_id = ?').bind(existing.id),
                db.prepare('DELETE FROM mod_calendar_holidays WHERE year_id = ?').bind(existing.id),
                db.prepare('DELETE FROM mod_calendar_years WHERE id = ?').bind(existing.id),
            ]);

            const stmts: unknown[] = [];
            stmts.push(db.prepare(`
                INSERT INTO mod_calendar_years (id, school_id, country, label, start_date, end_date, source_version, imported_by, imported_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(yearId, tenantId, parsed.country, parsed.label, parsed.startDate, parsed.endDate, '1.0.0', userId, now, now));
            for (const t of parsed.terms) {
                stmts.push(db.prepare(
                    'INSERT INTO mod_calendar_terms (id, school_id, year_id, label, term_number, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).bind(genId('cmt'), tenantId, yearId, t.label, t.termNumber, t.startDate, t.endDate));
            }
            for (const b of parsed.breaks) {
                stmts.push(db.prepare(
                    'INSERT INTO mod_calendar_breaks (id, school_id, year_id, label, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)'
                ).bind(genId('cmb'), tenantId, yearId, b.label, b.startDate, b.endDate));
            }
            for (const e of parsed.evaluations) {
                stmts.push(db.prepare(
                    'INSERT INTO mod_calendar_evaluations (id, school_id, year_id, label, date, track, kind) VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).bind(genId('cme'), tenantId, yearId, e.label, e.date, e.track, e.kind));
            }
            for (const h of parsed.holidays) {
                stmts.push(db.prepare(
                    'INSERT INTO mod_calendar_holidays (id, school_id, year_id, label, date, kind) VALUES (?, ?, ?, ?, ?, ?)'
                ).bind(genId('cmh'), tenantId, yearId, h.label, h.date, h.kind));
            }
            await db.batch(stmts);

            return c.json({
                apiVersion: 'v1',
                imported: { label: parsed.label, country: parsed.country, yearId },
                counts: {
                    terms: parsed.terms.length,
                    breaks: parsed.breaks.length,
                    evaluations: parsed.evaluations.length,
                    holidays: parsed.holidays.length,
                },
                replaced: !!existing,
            });
        } catch (e) {
            if (e instanceof Error && (e.message.includes('required') || e.message.includes('must be') || e.message.includes('invalid'))) {
                return c.json({ error: e.message }, 400);
            }
            console.error('[calendar-module] import error:', e);
            return c.json({ error: 'Failed to import calendar' }, 500);
        }
    });

    // ── GET /v1/today?date=YYYY-MM-DD ───────────────────────────────────────
    app.get('/v1/today', async (c: ModContext) => {
        try {
            const { tenantId } = resolveContext(c);
            const date = c.req.query('date') || toIsoDate(new Date());
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);

            const cal = await loadLatestCalendar(c.env.DB, tenantId);
            if (!cal) return c.json({ apiVersion: 'v1', date, configured: false });
            return c.json({
                apiVersion: 'v1',
                date,
                configured: true,
                year: { id: cal.id, label: cal.label, country: cal.country },
                status: dayStatus(cal, date),
                nextEvents: upcoming(cal, date, 90, 3),
            });
        } catch (e) {
            console.error('[calendar-module] today error:', e);
            return c.json({ error: 'Failed to compute today status' }, 500);
        }
    });

    // ── GET /v1/upcoming?days=60&limit=20 ───────────────────────────────────
    app.get('/v1/upcoming', async (c: ModContext) => {
        try {
            const { tenantId } = resolveContext(c);
            const date = c.req.query('date') || toIsoDate(new Date());
            const days = Math.max(1, Math.min(365, Number(c.req.query('days') || '60')));
            const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') || '20')));

            const cal = await loadLatestCalendar(c.env.DB, tenantId);
            if (!cal) return c.json({ apiVersion: 'v1', date, configured: false, items: [] });
            return c.json({
                apiVersion: 'v1',
                date,
                configured: true,
                year: { id: cal.id, label: cal.label },
                items: upcoming(cal, date, days, limit),
            });
        } catch (e) {
            console.error('[calendar-module] upcoming error:', e);
            return c.json({ error: 'Failed to compute upcoming events' }, 500);
        }
    });

    // ── GET /v1/health — unauthenticated capability probe ───────────────────
    app.get('/v1/health', (c: ModContext) => c.json({
        module: 'kuma-module-calendar-ci',
        apiVersion: 'v1',
        version: '1.0.0',
        time: new Date().toISOString(),
    }));

    return app;
}
