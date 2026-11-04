// ============================================================================
// KUMA Module: Official School Calendar — frontend view (self-contained).
//
// No host imports: own i18n dict (FR-first), own service, own data bundle.
// Works embedded (host router) or standalone (any React 18+ app, any CSS stack
// with Tailwind). Pure Tailwind utilities only — no host CSS classes.
//
// Props let each host adapt without forking:
//   lang      'fr' (default) | 'en'
//   apiBase   module API base (default '/api/v1/modules/calendar')
//   getToken  auth token provider (default localStorage 'kuma_token')
//   userRole  role string; Import tab shows for school leadership only
//             (falls back to localStorage 'kuma_user'.role)
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Coffee, FileUp, GraduationCap, PartyPopper, Sun, XCircle, CheckCircle2 } from 'lucide-react';
import { CalendarService } from './calendar.service';
import type { CalendarYearSummary, CalendarYearDetail, TodayPayload } from './calendar.service';
import { OFFICIAL_CALENDAR_CI_2026_2027 } from './data';

type Lang = 'fr' | 'en';

export interface CalendarModuleViewProps {
    lang?: Lang;
    apiBase?: string;
    getToken?: () => string | null;
    userRole?: string;
    embedded?: boolean;
}

const LEADERSHIP_ROLES = new Set(['admin', 'director', 'directeur', 'directrice', 'founder', 'fondatrice', 'manager', 'gestionnaire']);

const DICT = {
    fr: {
        title: 'Calendrier scolaire officiel',
        subtitle: 'Trimestres, congés, évaluations et jours fériés',
        tabToday: "Aujourd'hui", tabTerms: 'Trimestres', tabEval: 'Évaluations', tabHolidays: 'Jours fériés', tabImport: 'Importer',
        loading: 'Chargement…',
        notConfigured: 'Aucun calendrier officiel importé pour cette école.',
        todayIsSchoolDay: 'Jour de classe',
        todayNotSchoolDay: 'Pas de classe',
        reasonSchool: 'Journée de cours', reasonWeekend: 'Week-end', reasonHoliday: 'Jour férié',
        reasonBreak: 'Congés', reasonBetween: 'Entre deux trimestres',
        nextEvents: 'Prochains jalons',
        daysUntil: (n: number) => (n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`),
        term: 'Trimestre', termStart: 'Début des cours', termEnd: 'Fin du trimestre',
        breakStart: 'Début des congés', evaluation: 'Évaluation', holiday: 'Férié',
        trackCp1Cm1: 'CP1 → CM1', trackCm2: 'CM2 (CEPE)',
        kindComposition: 'Composition', kindExamenBlanc: 'Examen blanc', kindNational: 'Épreuve nationale',
        kindFixe: 'Fixe', kindVariable: 'Variable (religieux)',
        importTitle: 'Importer un calendrier officiel',
        importBundled: 'Calendrier officiel 2026-2027 (Côte d\'Ivoire)',
        importBundledDesc: '3 trimestres · 5 congés · 9 évaluations · 14 jours fériés',
        importFromFile: '…ou charger un fichier JSON',
        importing: 'Import en cours…',
        importSuccess: (label: string, replaced: boolean) => replaced ? `Calendrier ${label} mis à jour` : `Calendrier ${label} importé`,
        importForbidden: 'Seuls les responsables de l\'école peuvent importer un calendrier.',
        years: 'Années importées',
        refreshed: 'Calendrier à jour',
    },
    en: {
        title: 'Official school calendar',
        subtitle: 'Terms, breaks, evaluations and public holidays',
        tabToday: 'Today', tabTerms: 'Terms', tabEval: 'Evaluations', tabHolidays: 'Public holidays', tabImport: 'Import',
        loading: 'Loading…',
        notConfigured: 'No official calendar imported for this school yet.',
        todayIsSchoolDay: 'School day',
        todayNotSchoolDay: 'No school',
        reasonSchool: 'Class day', reasonWeekend: 'Weekend', reasonHoliday: 'Public holiday',
        reasonBreak: 'School break', reasonBetween: 'Between terms',
        nextEvents: 'Next milestones',
        daysUntil: (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`),
        term: 'Term', termStart: 'Term starts', termEnd: 'Term ends',
        breakStart: 'Break starts', evaluation: 'Evaluation', holiday: 'Holiday',
        trackCp1Cm1: 'CP1 → CM1', trackCm2: 'CM2 (CEPE)',
        kindComposition: 'Composition', kindExamenBlanc: 'Mock exam', kindNational: 'National exam',
        kindFixe: 'Fixed', kindVariable: 'Variable (religious)',
        importTitle: 'Import an official calendar',
        importBundled: 'Official 2026-2027 calendar (Côte d\'Ivoire)',
        importBundledDesc: '3 terms · 5 breaks · 9 evaluations · 14 public holidays',
        importFromFile: '…or load a JSON file',
        importing: 'Importing…',
        importSuccess: (label: string, replaced: boolean) => replaced ? `Calendar ${label} updated` : `Calendar ${label} imported`,
        importForbidden: 'Only school leadership can import a calendar.',
        years: 'Imported years',
        refreshed: 'Calendar up to date',
    },
} as const;

const kindLabel = (t: ReturnType<typeof getDict>, kind: string) =>
    kind === 'examen_blanc' ? t.kindExamenBlanc : kind === 'national' ? t.kindNational : t.kindComposition;

function getDict(lang: Lang) { return DICT[lang]; }

export default function CalendarModuleView({ lang = 'fr', apiBase, getToken, userRole, embedded = false }: CalendarModuleViewProps) {
    const t = useMemo(() => getDict(lang), [lang]);
    const svc = useMemo(() => new CalendarService({ apiBase, getToken }), [apiBase, getToken]);

    const [tab, setTab] = useState<'today' | 'terms' | 'eval' | 'holidays' | 'import'>('today');
    const [today, setToday] = useState<TodayPayload | null>(null);
    const [years, setYears] = useState<CalendarYearSummary[]>([]);
    const [detail, setDetail] = useState<CalendarYearDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

    const effectiveRole = useMemo(() => {
        if (userRole) return userRole.toLowerCase();
        try {
            const u = JSON.parse(localStorage.getItem('kuma_user') || '{}');
            return String(u.role || '').toLowerCase();
        } catch { return ''; }
    }, [userRole]);
    const canImport = LEADERSHIP_ROLES.has(effectiveRole);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [tp, ys] = await Promise.all([svc.today().catch(() => null), svc.listYears().catch(() => ({ years: [] }))]);
            setToday(tp);
            setYears(ys.years || []);
            const latest = (ys.years || [])[0];
            setDetail(latest ? await svc.getYear(latest.label).catch(() => null) : null);
        } finally {
            setLoading(false);
        }
    }, [svc]);

    useEffect(() => { loadAll(); }, [loadAll]);

    const doImport = async (payload: unknown) => {
        setImporting(true); setMessage(null);
        try {
            const res = await svc.importCalendar(payload);
            setMessage({ ok: true, text: t.importSuccess(res.imported.label, res.replaced) });
            await loadAll();
            setTab('today');
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Import failed';
            setMessage({ ok: false, text: msg === 'Forbidden' ? t.importForbidden : msg });
        } finally {
            setImporting(false);
        }
    };

    const onFile = (file: File | null) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try { doImport(JSON.parse(String(reader.result))); }
            catch { setMessage({ ok: false, text: 'Invalid JSON file' }); }
        };
        reader.readAsText(file);
    };

    const status = today?.status;
    const statusPill = !today?.configured ? null
        : status?.isSchoolDay ? { icon: <CheckCircle2 size={16} />, cls: 'bg-emerald-50 text-emerald-700', text: t.todayIsSchoolDay }
        : { icon: <XCircle size={16} />, cls: 'bg-amber-50 text-amber-700', text: `${t.todayNotSchoolDay} — ${status?.reason || ''}` };

    const tabCls = (active: boolean) =>
        `px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${active ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

    return (
        <div className="space-y-5 text-slate-800">
            {!embedded && (
                <div className="flex items-center gap-3">
                    <CalendarDays className="text-indigo-600" size={22} />
                    <div>
                        <h2 className="text-xl font-bold leading-tight">{t.title}</h2>
                        <p className="text-xs text-slate-500">{t.subtitle}</p>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <button className={tabCls(tab === 'today')} onClick={() => setTab('today')}>{t.tabToday}</button>
                <button className={tabCls(tab === 'terms')} onClick={() => setTab('terms')}>{t.tabTerms}</button>
                <button className={tabCls(tab === 'eval')} onClick={() => setTab('eval')}>{t.tabEval}</button>
                <button className={tabCls(tab === 'holidays')} onClick={() => setTab('holidays')}>{t.tabHolidays}</button>
                {canImport && <button className={tabCls(tab === 'import')} onClick={() => setTab('import')}>{t.tabImport}</button>}
            </div>

            {loading ? (
                <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-400">{t.loading}</div>
            ) : tab === 'today' ? (
                <div className="space-y-4">
                    {!today?.configured ? (
                        <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-500">
                            {t.notConfigured}
                            {canImport && (
                                <div className="mt-3">
                                    <button onClick={() => setTab('import')} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:opacity-90">
                                        <FileUp size={15} /> {t.tabImport}
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="rounded-2xl border border-slate-100 bg-white p-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{today.date}</p>
                                        <p className="mt-1 text-sm font-semibold">{today.year?.label} · {today.year?.country}</p>
                                    </div>
                                    {statusPill && (
                                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${statusPill.cls}`}>
                                            {statusPill.icon} {statusPill.text}
                                        </span>
                                    )}
                                </div>
                                {status?.term && (
                                    <p className="mt-2 text-xs text-slate-500">{t.term} {status.term.termNumber} — {status.term.label}</p>
                                )}
                            </div>
                            {(today.nextEvents || []).length > 0 && (
                                <div className="rounded-2xl border border-slate-100 bg-white p-5">
                                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{t.nextEvents}</h4>
                                    <div className="space-y-2">
                                        {(today.nextEvents || []).map((ev) => (
                                            <div key={`${ev.kind}-${ev.date}-${ev.label}`} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-sm">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    {ev.kind === 'evaluation' ? <GraduationCap size={15} className="shrink-0 text-indigo-500" />
                                                        : ev.kind === 'holiday' ? <PartyPopper size={15} className="shrink-0 text-rose-500" />
                                                        : ev.kind === 'break-start' ? <Coffee size={15} className="shrink-0 text-amber-500" />
                                                        : <CalendarDays size={15} className="shrink-0 text-slate-400" />}
                                                    <span className="truncate font-medium text-slate-700">{ev.label}</span>
                                                </div>
                                                <span className="ml-2 whitespace-nowrap text-xs text-slate-500">{ev.date} · {t.daysUntil(ev.daysUntil)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            ) : !detail ? (
                <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-500">{t.notConfigured}</div>
            ) : tab === 'terms' ? (
                <div className="space-y-3">
                    {detail.terms.map((term) => (
                        <div key={term.label} className="rounded-2xl border border-slate-100 bg-white p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-bold">{term.label}</p>
                                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700">
                                    {t.term} {term.term_number}
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">{term.start_date} → {term.end_date}</p>
                            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                                <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: '100%' }} />
                            </div>
                            {detail.breaks.filter((b) => b.start_date >= term.start_date && b.start_date <= term.end_date).map((b) => (
                                <p key={b.label} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
                                    <Coffee size={10} /> {b.label} · {b.start_date} → {b.end_date}
                                </p>
                            ))}
                        </div>
                    ))}
                </div>
            ) : tab === 'eval' ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {(['cp1-cm1', 'cm2'] as const).map((track) => (
                        <div key={track} className="rounded-2xl border border-slate-100 bg-white p-4">
                            <h4 className="mb-3 flex items-center gap-2 text-sm font-bold">
                                <GraduationCap size={16} className="text-indigo-500" />
                                {track === 'cm2' ? t.trackCm2 : t.trackCp1Cm1}
                            </h4>
                            <div className="space-y-2">
                                {detail.evaluations.filter((e) => e.track === track).map((e) => (
                                    <div key={`${e.label}-${e.date}`} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-sm">
                                        <span className="truncate font-medium text-slate-700">{e.label}</span>
                                        <span className="ml-2 whitespace-nowrap text-xs text-slate-500">
                                            {kindLabel(t, e.kind)} · {e.date}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : tab === 'holidays' ? (
                <div className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="space-y-2">
                        {detail.holidays.map((h) => (
                            <div key={`${h.label}-${h.date}`} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-sm">
                                <div className="flex min-w-0 items-center gap-2">
                                    <PartyPopper size={15} className="shrink-0 text-rose-500" />
                                    <span className="truncate font-medium text-slate-700">{h.label}</span>
                                </div>
                                <span className="ml-2 whitespace-nowrap text-xs text-slate-500">{h.date} · {h.kind === 'variable' ? t.kindVariable : t.kindFixe}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-100 bg-white p-5">
                        <h4 className="text-sm font-bold">{t.importTitle}</h4>
                        {message && (
                            <p className={`mt-2 rounded-xl px-3 py-2 text-xs font-semibold ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                {message.text}
                            </p>
                        )}
                        <button
                            disabled={importing}
                            onClick={() => doImport(OFFICIAL_CALENDAR_CI_2026_2027)}
                            className="mt-3 w-full rounded-xl bg-indigo-600 p-3 text-left text-white hover:opacity-90 disabled:opacity-50"
                        >
                            <span className="flex items-center gap-2 text-sm font-bold">
                                <Sun size={16} /> {importing ? t.importing : t.importBundled}
                            </span>
                            <span className="mt-0.5 block text-xs opacity-80">{t.importBundledDesc}</span>
                        </button>
                        <label className="mt-3 block cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">
                            {t.importFromFile}
                            <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
                        </label>
                    </div>
                    {years.length > 0 && (
                        <div className="rounded-2xl border border-slate-100 bg-white p-5">
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{t.years}</h4>
                            <div className="space-y-2">
                                {years.map((y) => (
                                    <div key={y.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-sm">
                                        <span className="font-semibold">{y.label}</span>
                                        <span className="text-xs text-slate-500">
                                            {y.terms_count} {t.tabTerms.toLowerCase()} · {y.evaluations_count} {t.tabEval.toLowerCase()} · {y.holidays_count} {t.tabHolidays.toLowerCase()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
