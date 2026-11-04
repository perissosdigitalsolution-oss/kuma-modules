// ============================================================================
// KUMA Module: Official School Calendar — core logic (framework-free).
// No imports from any host codebase. Pure TypeScript + data contracts only.
// The host (Worker/Hono, NestJS, anything) adapts this layer to its stack.
// ============================================================================

export interface RawCalendarFile {
    annee_academique: string;
    pays: string;
    trimestres: { nom: string; debut: string; fin: string }[];
    conges_scolaires: { nom: string; debut: string; fin: string }[];
    evaluations_primaire_cp1_cm1?: { nom: string; date: string }[];
    evaluations_primaire_cm2?: { nom: string; date: string }[];
    [key: string]: unknown; // jours_feries_<year> and future sections
}

export interface ParsedCalendar {
    label: string;
    country: string;
    startDate: string | null;
    endDate: string | null;
    terms: { label: string; termNumber: number; startDate: string; endDate: string }[];
    breaks: { label: string; startDate: string; endDate: string }[];
    evaluations: { label: string; date: string; track: string; kind: string }[];
    holidays: { label: string; date: string; kind: string }[];
}

export interface CalendarDayStatus {
    date: string;
    isSchoolDay: boolean;
    reasonKind: 'school-day' | 'weekend' | 'holiday' | 'break' | 'before-year' | 'after-year';
    reason: string | null;
    term: { label: string; termNumber: number } | null;
}

export interface UpcomingItem {
    date: string;
    kind: 'term-start' | 'term-end' | 'break-start' | 'evaluation' | 'holiday';
    label: string;
    track?: string;
    daysUntil: number;
}

const DAY_MS = 86_400_000;

export function toIsoDate(d: Date): string {
    return d.toISOString().split('T')[0];
}

export function daysBetween(fromIso: string, toIso: string): number {
    const a = new Date(fromIso + 'T00:00:00Z').getTime();
    const b = new Date(toIso + 'T00:00:00Z').getTime();
    return Math.round((b - a) / DAY_MS);
}

/** Classify an evaluation name (official Ivorian wording) into a kind. */
export function classifyEvaluation(label: string): string {
    const l = label.toLowerCase();
    if (l.includes('examen blanc')) return 'examen_blanc';
    if (l.includes('cepe') || l.includes('national') || l.includes('entrée en 6')) return 'national';
    return 'composition';
}

function isHolidaySection(key: string): boolean {
    return /^jours_feries_/i.test(key);
}

/**
 * Parse the official MENA-style calendar file (French field names preserved)
 * into normalized module rows. Never throws on unknown extra sections —
 * ignores them so future official formats keep importing.
 */
export function parseCalendarFile(raw: RawCalendarFile): ParsedCalendar {
    if (!raw || typeof raw !== 'object') throw new Error('invalid calendar payload');
    if (!raw.annee_academique || !raw.pays) throw new Error('annee_academique and pays are required');
    if (!Array.isArray(raw.trimestres) || raw.trimestres.length === 0) {
        throw new Error('trimestres must be a non-empty array');
    }

    const parsed: ParsedCalendar = {
        label: String(raw.annee_academique),
        country: String(raw.pays),
        startDate: null,
        endDate: null,
        terms: [],
        breaks: [],
        evaluations: [],
        holidays: [],
    };

    let min = '9999-12-31';
    let max = '0000-01-01';
    for (const [i, t] of raw.trimestres.entries()) {
        if (!t?.nom || !t?.debut || !t?.fin) throw new Error('each trimestre needs nom/debut/fin');
        parsed.terms.push({ label: String(t.nom), termNumber: i + 1, startDate: String(t.debut), endDate: String(t.fin) });
        if (t.debut < min) min = String(t.debut);
        if (t.fin > max) max = String(t.fin);
    }
    parsed.startDate = min;
    parsed.endDate = max;

    for (const b of raw.conges_scolaires || []) {
        if (!b?.nom || !b?.debut || !b?.fin) continue;
        parsed.breaks.push({ label: String(b.nom), startDate: String(b.debut), endDate: String(b.fin) });
    }

    const tracks: [string, { nom: string; date: string }[] | undefined][] = [
        ['cp1-cm1', raw.evaluations_primaire_cp1_cm1],
        ['cm2', raw.evaluations_primaire_cm2],
    ];
    for (const [track, list] of tracks) {
        for (const e of list || []) {
            if (!e?.nom || !e?.date) continue;
            parsed.evaluations.push({ label: String(e.nom), date: String(e.date), track, kind: classifyEvaluation(String(e.nom)) });
        }
    }

    for (const [key, value] of Object.entries(raw)) {
        if (!isHolidaySection(key) || !Array.isArray(value)) continue;
        for (const h of value as { nom?: string; date?: string; type?: string }[]) {
            if (!h?.nom || !h?.date) continue;
            parsed.holidays.push({
                label: String(h.nom),
                date: String(h.date),
                kind: String(h.type || '').toLowerCase().includes('variable') ? 'variable' : 'fixe',
            });
        }
    }

    return parsed;
}

/** What kind of day is `date`? Terms first (school day), then holidays, breaks, weekends. */
export function dayStatus(cal: ParsedCalendar, date: string): CalendarDayStatus {
    const term = cal.terms.find((t) => date >= t.startDate && date <= t.endDate);
    const inYearWindow = !!cal.startDate && !!cal.endDate && date >= cal.startDate && date <= cal.endDate;

    if (term) {
        const holiday = cal.holidays.find((h) => h.date === date);
        if (holiday) {
            return { date, isSchoolDay: false, reasonKind: 'holiday', reason: holiday.label, term: { label: term.label, termNumber: term.termNumber } };
        }
        const brk = cal.breaks.find((b) => date >= b.startDate && date <= b.endDate);
        if (brk) {
            return { date, isSchoolDay: false, reasonKind: 'break', reason: brk.label, term: { label: term.label, termNumber: term.termNumber } };
        }
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        if (dow === 0 || dow === 6) {
            return { date, isSchoolDay: false, reasonKind: 'weekend', reason: 'Week-end', term: { label: term.label, termNumber: term.termNumber } };
        }
        return { date, isSchoolDay: true, reasonKind: 'school-day', reason: null, term: { label: term.label, termNumber: term.termNumber } };
    }

    if (!inYearWindow) {
        if (cal.startDate && date < cal.startDate) {
            return { date, isSchoolDay: false, reasonKind: 'before-year', reason: `Avant l'année ${cal.label}`, term: null };
        }
        const brk = cal.breaks.find((b) => date >= b.startDate && date <= b.endDate);
        if (brk) return { date, isSchoolDay: false, reasonKind: 'break', reason: brk.label, term: null };
        return { date, isSchoolDay: false, reasonKind: 'after-year', reason: `Après l'année ${cal.label}`, term: null };
    }

    // Between terms: holiday / break / weekend check still applies.
    const holiday = cal.holidays.find((h) => h.date === date);
    if (holiday) return { date, isSchoolDay: false, reasonKind: 'holiday', reason: holiday.label, term: null };
    const brk = cal.breaks.find((b) => date >= b.startDate && date <= b.endDate);
    if (brk) return { date, isSchoolDay: false, reasonKind: 'break', reason: brk.label, term: null };
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) return { date, isSchoolDay: false, reasonKind: 'weekend', reason: 'Week-end', term: null };
    return { date, isSchoolDay: false, reasonKind: 'break', reason: 'Entre deux trimestres', term: null };
}

/** All dated events within [date, date+days], soonest first. */
export function upcoming(cal: ParsedCalendar, date: string, days: number, limit: number): UpcomingItem[] {
    const to = toIsoDate(new Date(new Date(date + 'T00:00:00Z').getTime() + days * DAY_MS));
    const items: UpcomingItem[] = [];
    const push = (d: string, kind: UpcomingItem['kind'], label: string, track?: string) => {
        if (d > to || d < date) return;
        items.push({ date: d, kind, label, track, daysUntil: daysBetween(date, d) });
    };
    for (const t of cal.terms) { push(t.startDate, 'term-start', t.label); push(t.endDate, 'term-end', t.label); }
    for (const b of cal.breaks) push(b.startDate, 'break-start', b.label);
    for (const e of cal.evaluations) push(e.date, 'evaluation', e.label, e.track);
    for (const h of cal.holidays) push(h.date, 'holiday', h.label);
    items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    return items.slice(0, Math.max(1, limit));
}
