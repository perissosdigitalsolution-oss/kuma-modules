// ============================================================================
// KUMA Module: Official School Calendar — frontend service (ZERO host deps).
// Plain fetch; token resolver injectable (defaults to the KUMA platform's
// localStorage key `kuma_token`). apiBase overridable for standalone deploys.
// ============================================================================

export interface CalendarTerm { label: string; term_number: number; start_date: string; end_date: string }
export interface CalendarBreak { label: string; start_date: string; end_date: string }
export interface CalendarEvaluation { label: string; date: string; track: string; kind: string }
export interface CalendarHoliday { label: string; date: string; kind: string }

export interface CalendarYearSummary {
    id: string; label: string; country: string; start_date: string | null; end_date: string | null;
    source_version: string | null; imported_at: string;
    terms_count: number; evaluations_count: number; breaks_count: number; holidays_count: number;
}

export interface CalendarYearDetail {
    apiVersion: string;
    year: Record<string, unknown>;
    terms: CalendarTerm[]; breaks: CalendarBreak[]; evaluations: CalendarEvaluation[]; holidays: CalendarHoliday[];
}

export interface DayStatus {
    date: string; isSchoolDay: boolean;
    reasonKind: 'school-day' | 'weekend' | 'holiday' | 'break' | 'before-year' | 'after-year';
    reason: string | null;
    term: { label: string; termNumber: number } | null;
}

export interface TodayPayload {
    apiVersion: string; date: string; configured: boolean;
    year?: { id: string; label: string; country: string };
    status?: DayStatus;
    nextEvents?: { date: string; kind: string; label: string; track?: string; daysUntil: number }[];
}

export interface UpcomingPayload {
    apiVersion: string; date: string; configured: boolean;
    items: { date: string; kind: string; label: string; track?: string; daysUntil: number }[];
}

export interface ImportResult {
    apiVersion: string;
    imported: { label: string; country: string; yearId: string };
    counts: { terms: number; breaks: number; evaluations: number; holidays: number };
    replaced: boolean;
}

export interface CalendarServiceConfig {
    /** Base URL of the module API. Default: /api/v1/modules/calendar (embedded mode). */
    apiBase?: string;
    /** Token provider. Default: localStorage 'kuma_token' (KUMA platform key). */
    getToken?: () => string | null;
}

const DEFAULT_TOKEN_KEY = 'kuma_token';

export class CalendarService {
    private apiBase: string;
    private getToken: () => string | null;

    constructor(config: CalendarServiceConfig = {}) {
        this.apiBase = (config.apiBase || '/api/v1/modules/calendar').replace(/\/$/, '');
        this.getToken = config.getToken || (() => {
            try { return localStorage.getItem(DEFAULT_TOKEN_KEY); } catch { return null; }
        });
    }

    private async request<T>(path: string, init?: RequestInit): Promise<T> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> || {}) };
        const token = this.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${this.apiBase}${path}`, { ...init, headers });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            const message = (body as { error?: string })?.error || `Request failed (${res.status})`;
            throw new Error(message);
        }
        return body as T;
    }

    health(): Promise<{ module: string; apiVersion: string; version: string }> {
        return this.request('/v1/health');
    }
    listYears(): Promise<{ apiVersion: string; years: CalendarYearSummary[] }> {
        return this.request('/v1/years');
    }
    getYear(label: string): Promise<CalendarYearDetail> {
        return this.request(`/v1/years/${encodeURIComponent(label)}`);
    }
    today(date?: string): Promise<TodayPayload> {
        const q = date ? `?date=${date}` : '';
        return this.request(`/v1/today${q}`);
    }
    upcoming(days = 60, limit = 20): Promise<UpcomingPayload> {
        return this.request(`/v1/upcoming?days=${days}&limit=${limit}`);
    }
    /** payload = the official MENA-format calendar file (as distributed in data/). */
    importCalendar(payload: unknown): Promise<ImportResult> {
        return this.request('/v1/import', { method: 'POST', body: JSON.stringify(payload) });
    }
}
