-- ============================================================================
-- KUMA Module: Official School Calendar (Côte d'Ivoire) — v1.0.0
-- Module-owned tables (mod_calendar_*). NEVER touches host schema.
-- Idempotent: safe to run on every install/upgrade.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mod_calendar_years (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    country TEXT NOT NULL,
    label TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    source_version TEXT,
    imported_by TEXT,
    imported_at TEXT NOT NULL,
    updated_at TEXT,
    UNIQUE(school_id, country, label)
);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_years_school ON mod_calendar_years(school_id);

CREATE TABLE IF NOT EXISTS mod_calendar_terms (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    year_id TEXT NOT NULL,
    label TEXT NOT NULL,
    term_number INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_terms_year ON mod_calendar_terms(year_id);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_terms_school_dates ON mod_calendar_terms(school_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS mod_calendar_breaks (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    year_id TEXT NOT NULL,
    label TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_breaks_year ON mod_calendar_breaks(year_id);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_breaks_school_dates ON mod_calendar_breaks(school_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS mod_calendar_evaluations (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    year_id TEXT NOT NULL,
    label TEXT NOT NULL,
    date TEXT NOT NULL,
    track TEXT NOT NULL DEFAULT 'general',
    kind TEXT NOT NULL DEFAULT 'composition'
);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_evaluations_year ON mod_calendar_evaluations(year_id);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_evaluations_school_date ON mod_calendar_evaluations(school_id, date);

CREATE TABLE IF NOT EXISTS mod_calendar_holidays (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    year_id TEXT NOT NULL,
    label TEXT NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'fixe'
);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_holidays_year ON mod_calendar_holidays(year_id);
CREATE INDEX IF NOT EXISTS idx_mod_calendar_holidays_school_date ON mod_calendar_holidays(school_id, date);

-- ============================================================================
-- Unified calendar_events_view for date validation (no indexes allowed on view in D1)
-- UNION of all event types. Query: school_id, start_date, end_date, is_blocking.
-- ============================================================================
DROP VIEW IF EXISTS mod_calendar_events_view;
CREATE VIEW mod_calendar_events_view AS
SELECT 'term' as source, t.id || '-term' as id, t.school_id, t.year_id as academic_year_id,
       'term' as category, t.label as title, t.start_date, t.end_date, CAST(0 as BOOLEAN) as is_blocking
FROM mod_calendar_terms t
UNION ALL
SELECT 'break' as source, b.id || '-brk' as id, b.school_id, b.year_id,
       'break' as category, b.label, b.start_date, b.end_date, CAST(1 as BOOLEAN)
FROM mod_calendar_breaks b
UNION ALL
SELECT 'evaluation' as source, e.id || '-eval' as id, e.school_id, e.year_id,
       'evaluation' as category, e.label, e.date, e.date, CAST(0 as BOOLEAN)
FROM mod_calendar_evaluations e
UNION ALL
SELECT 'holiday' as source, h.id || '-hol' as id, h.school_id, h.year_id,
       'holiday' as category, h.label, h.date, h.date, CAST(1 as BOOLEAN)
FROM mod_calendar_holidays h;