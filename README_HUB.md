# Kuma Module Extensions Hub 🇨🇦️⛔🇲🇹🇬🇳

Welcome to the **KUMA Module Extensions Hub** — a public registry of self-contained modules that extend Kuma School Management deployments. Each module:

* **Owns its own data** — module tables (`mod_calendar_*`, `mod_inventory_*`, etc.)
* **Works embedded OR standalone** — mount inside your worker or deploy on the side
* **Ships data + code + installer** — zip, git clone, or npm install (future)

---

## 📦 Modules

| Module | Country | Description | Version | Install |
|---|---|---|---|---|
| **calendar-ci** | Côte d'Ivoire | Official primary calendar (terms, breaks, CEPE, holidays) | v1.0.0 | see below |
| **calendar-ml** | Mali | Primary calendar (planned) | — | planned |
| **inventory** | Global | Stock forecasting, procurement workflow | — | planned |

---

## 🚀 Quick start: Add calendar-ci

```bash
# Option 1: Download a single zip (ideal for villages)
curl -sL https://github.com/perissosdigitalsolution-oss/kuma-modules/raw/main/calendar-ci.zip -o calendar-ci.zip
unzip calendar-ci.zip && cd calendar-ci
node scripts/install.mjs        # prints the 2 lines you need
```

```bash
# Option 2: Git clone everything
git clone https://github.com/perissosdigitalsolution-oss/kuma-modules.git
cd kuma-modules/calendar-ci
npm install && node scripts/install.mjs
```

The installer prints the exact 2 lines to add in your host codebase:

```ts
import { createCalendarModule } from '../../modules/calendar-ci/server/calendarModule';
app.route('/api/v1/modules/calendar', createCalendarModule());
```

---

## 🏗️ Adding your own module

1. Fork this repository.
2. Create `<my-module>/` following the `calendar-ci/` pattern:
   * `module.json` — manifest with `id`, `version`, `mountPath`, entry points
   * `server/schema.sql` — idempotent `CREATE TABLE IF NOT EXISTS mod_mymodule_*` only
   * `server/logic.ts` — pure TypeScript, no host imports
   * `frontend/` — any React 18+ view
   * `scripts/install.mjs` — installer + `--zip` builder
3. Open a Pull Request — we’ll review and tag your module version.

---

## 🛡️ Security & honesty

* Role-gated import (only `admin/director/manager` can change calendars)
* No host data is ever read/written by a module
* All mutations logged in `activity_logs` for audit

---

## License

MIT — free to use in Kuma School projects worldwide.
