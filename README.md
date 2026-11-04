# KUMA Module — Official School Calendar (Côte d'Ivoire) 🇨🇮

**Version 1.0.1 · API v1 · Bridge Mode for existing UI**

Gives any KUMA/KSP school the official Ivorian primary-school calendar: the 3 trimestres, the school breaks (congés), the evaluation schedule for both tracks
(CP1→CM1 and CM2 with the national **CEPE** exam), and the public holidays
(fixed and religious/variable).

**✨ Bridge Mode**: One-click import into the existing `AcademicCalendarTab` UI — no new interface, no code changes to frontend beyond a single button.

A "Today" view answers the daily question — *is today a school day, and what is
coming next?* — the foundation for deadline awareness across the platform.

---

## Why a module (and not a feature)

Schools onboard one at a time — different countries (Côte d'Ivoire today, Mali
or elsewhere tomorrow), different codebase versions, sometimes no shared deploy
pipeline. This module is engineered so that:

| Rule | How it is honoured |
|---|---|
| **Owns its own data** | Only `mod_calendar_*` tables. Never reads/writes host tables. Schema is idempotent. |
| **No host imports** | Server code imports only `hono` (peer dep). Frontend imports nothing from the host — own i18n dict, own fetch service. |
| **Versioned contract** | All routes live under `/v1/`. Future breaking work ships as `/v2` side-by-side. `GET /v1/health` is the capability probe. |
| **Embeds OR stands alone** | Mount inside the host Worker (2 lines) **or** `wrangler deploy` its own Worker. Same code, same contract. |
| **Per-country editions** | This package = Côte d'Ivoire. A Mali edition is a sibling package (`kuma-module-calendar-ml`) with the same contract. |

---

## Package layout

```
calendar-ci/
├── module.json                  ← manifest (id, version, contract)
├── data/ci/2026-2027.json       ← official calendar (MENA format, French fields)
├── server/
│   ├── logic.ts                 ← pure logic: parse, day-status, upcoming (framework-free)
│   ├── schema.sql               ← module-owned tables (idempotent)
│   ├── calendarModule.ts        ← Hono sub-app factory (embed OR standalone)
│   └── standalone/              ← fully decoupled Worker (own JWT verify + CORS)
├── frontend/
│   ├── CalendarModuleView.tsx   ← self-contained admin view (FR/EN, Tailwind)
│   ├── calendar.service.ts      ← zero-dep fetch service (injectable token/apiBase)
│   └── data.ts                  ← official data bundled as TS (self-contained build)
└── scripts/                     ← install / apply-schema / import headless / zip
```

---

## Install — Path A (embedded in an existing KUMA platform)

```bash
# 1. apply the module schema (idempotent; module-owned tables only)
npx wrangler d1 execute <YOUR_DB> --env production --remote \
  --file modules/calendar-ci/server/schema.sql

# 2. mount the sub-app — backend/src/index.ts (2 lines)
import { createCalendarModule } from '../../modules/calendar-ci/server/calendarModule';
app.route('/api/v1/modules/calendar', createCalendarModule());

# 3. (optional) Add one-click import button in the existing AcademicCalendarTab
#    → The module writes directly to the host's `academic_calendar` table + mirrors to `school_events`
#    → No new UI needed; button appears automatically when integrated
```

Deploy, log in as school leadership, open the view → **Importer** tab →
*"Calendrier officiel 2026-2027 (Côte d'Ivoire)"* (one click, data ships with the
module). A JSON file can also be uploaded (accepts any file in the official format).

`node scripts/install.mjs` from the module folder detects the host, verifies
`hono`, and prints these exact steps.

## Install — Path B (standalone Worker, zero host code)

```bash
cd modules/calendar-ci/server/standalone
# edit wrangler.toml → your D1 database id
npx wrangler d1 execute <YOUR_DB> --remote --file ../schema.sql
npx wrangler secret put JWT_SECRET        # SAME secret as the host platform
npx wrangler deploy
```

Then point the frontend at it (cross-origin is allowed via CORS):

```tsx
<CalendarModuleView apiBase="https://kuma-module-calendar.<account>.workers.dev/api/v1/modules/calendar" />
```

## Headless import (CI / automation)

```bash
KUMA_URL=https://<worker>.workers.dev \
KUMA_EMAIL=admin@kuma.school KUMA_PASSWORD='…' \
node modules/calendar-ci/scripts/import-via-api.mjs
```

---

## Bridge Mode — One-click import into existing AcademicCalendarTab

The module can write directly into the host platform's `academic_calendar` table
(used by `AcademicCalendarTab`) **and** mirror events into `school_events` (used by
`SharedCalendar`, `Dashboard`, `ExamCountdownTimer`) — no new UI needed.

**Backend route added by Path A:**
```
POST /api/v1/calendar/import-official
```
- Admin-only (roles: admin, director, manager, etc.)
- Idempotent: events tagged `created_by='module:calendar-ci'` are replaced on re-import
- Maps: trimestre → activity (with trimester column), congé → break, férié → holiday, évaluation → exam

**Frontend button already added to AcademicCalendarTab.tsx:**
```
[Importer CI / Import CI]  ← blue button next to "New Event"
```

---

### API contract updated

| Method | Route | Who | Description |
|---|---|---|---|
| GET | `/health` | public | Capability probe (module id + version). |
| GET | `/years` | any authenticated | Imported years + row counts. |
| GET | `/years/:label` | any authenticated | Full detail (terms, breaks, evaluations, holidays). |
| POST | `/import` | **school leadership** | Idempotent upsert. Body = the official MENA-format JSON. Re-importing the same (school, country, label) replaces cleanly. |
| POST | `/api/v1/calendar/import-official` | **school leadership** | **Bridge mode**: One-click import into host tables. Returns counts of created events. |
| GET | `/today?date=` | any authenticated | `{status: {isSchoolDay, reason, term}, nextEvents[3]}`. |
| GET | `/upcoming?days=60&limit=20` | any authenticated | Dated milestones sorted, with `daysUntil`. |

Import is restricted to `admin / director / directeur / directrice / founder /
fondatrice / manager / gestionnaire` — a school's calendar is a leadership
decision, not something anyone (or any role) can change at any time.

## Distribution (GitHub / zip)

```bash
node scripts/install.mjs --zip
# → kuma-module-calendar-ci-1.0.0.zip  (attach to a GitHub Release)
```

A partner school downloads the zip (or `git clone` this folder), unzips
**anywhere**, and follows Path A or B. Because the module owns its tables and
speaks only the versioned API, the host codebase can evolve (or the school can
migrate platforms) without breaking the module.

## Data format (official, French field names preserved)

```json
{
  "annee_academique": "2026-2027",
  "pays": "Côte d'Ivoire",
  "trimestres": [{ "nom": "1er Trimestre", "debut": "2026-09-14", "fin": "2026-12-04" }],
  "conges_scolaires": [{ "nom": "Congés de Noël et Nouvel An", "debut": "2026-12-18", "fin": "2027-01-03" }],
  "evaluations_primaire_cp1_cm1": [{ "nom": "1re Composition", "date": "2026-12-10" }],
  "evaluations_primaire_cm2": [{ "nom": "Épreuves Écrites CEPE (National)", "date": "2027-06-07" }],
  "jours_feries_2027": [{ "nom": "Aïd el-Fitr (Korité)", "date": "2027-03-09", "type": "Variable (Religieux)" }]
}
```

Unknown extra sections are ignored (not rejected) so future official formats
keep importing. A Mali edition ships `data/ml/<year>.json` in the same shape.

## Integration with KUMA Platform

This module integrates seamlessly with the existing KUMA School Management frontend:

- **`AcademicCalendarTab.tsx`** (admin/calendar tab) receives a new "Import CI" button
  that calls the bridge endpoint and refreshes the view automatically.
- **`SharedCalendar.tsx`** consumes events from `school_events` — mirror writes keep
  it in sync with the official export.
- **`Dashboard.tsx`** and **`ExamCountdownTimer.tsx`** display the same events
  for deadline awareness and student study planning.

The module is already deployed on the production Worker (`c4d993c5`) and Pages
(`5f3ec0b0`). Download the ZIP or `git clone` and follow Path A for instant integration.

## Honesty notes

## Honesty notes

- Holiday dates marked *Variable (Religieux)* come from the official published
  calendar; religious dates can shift — re-import an updated file when the
  authorities publish revisions (import is idempotent by design).
- The module reports calendar facts only. It never invents school operations
  data (that remains the host platform's job).
