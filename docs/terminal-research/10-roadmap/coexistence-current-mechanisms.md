---
id: D-08
title: Coexistence — how new surfaces are introduced beside old ones today
role: Migration / Coexistence Architect (current mechanisms)
wave: 1
group: D
category: internal-system
scope: uct-dashboard worktree (app/src, api/, docs/), read-only cross-repo grep of morning-wire · uct_intelligence · uct-intelligence · uct-sunday-scan
confidence: 🟢 high for code-resident mechanisms; 🟡 for production flag state (not read this session)
evidence_ceiling: No Railway variable read, no production log read, no browser session. Every "is it ON in production" statement is CLAIM. Raising it needs one read-only `railway variables --service web --kv` (names only) or `tools/flag_ledger_audit.py`.
sources: app/src/App.jsx, app/src/components/{NavBar,MobileNav,navGroups,AuthGuard}.jsx, app/src/components/mobile/MoreSheet.jsx, app/src/pages/dashboard/doors.js, app/src/widgets/registry.js, app/src/pages/charts/{ChartsWorkspace,WidgetHost}.jsx, app/src/pages/Calendar.jsx, app/src/pages/calendar/*, app/src/hooks/usePreferences.js, app/src/pages/journal-2-0/{shellFlag,featureFlags}.js, api/services/auth_service.py, api/services/entitlements.py, api/services/feature_flag_index.py, docs/feature_flags.json, tools/flag_ledger_audit.py, docs/runbooks/cutover-watch.md, docs/operations/phase-7-launch-checklist.md, docs/decisions/2026-08-06-closed-bar-alert-cutover.md, git log on terminal-research
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-08 — Migration / Coexistence Architect (current mechanisms)

**Vocabulary reminder for later readers:** TERMINAL-CURRENT = the shipped surface at route `/calendar`, display-named "UCT Terminal" since 2026-09-01. TERMINAL-NEXT = the product this program designs. Everything below about "the calendar" means TERMINAL-CURRENT.

**What this document is.** An inventory of the mechanisms this codebase *already has* for standing a new surface up beside an old one, the exact edit list for adding a surface, the persisted-state hazards, the inbound dependency map for `/calendar`, and coexistence options priced against that reality. Options, not a decision.

**Companion:** D-09 owns the capability map of Terminal-Current; §7 here supplies only the headers to seed the parity matrix (charter Part CDLXII). D-10 owns flag-system internals; §6 here describes only what a rollout can use today.

---

## 0. The three-sentence answer

**OBSERVATION.** This repository already contains four distinct, independently proven coexistence mechanisms — (a) a **runtime per-browser rollout dial** in frontend source (`shellFlag.js`, `StockChart.jsx`), (b) an **environment gate + ledger** for backend features (`docs/feature_flags.json` + `api/services/feature_flag_index.py`), (c) a **parallel route with an unchanged sibling** (Journal 2.0 beside Journal 1.0; `/live-massive` beside `/live-flow`), and (d) a **mode toggle inside one route** (Multi-Chart Grid inside `/charts`). Adding a fifth surface is a ~10-file additive edit and touches no Terminal-Current behaviour.

**INTERPRETATION.** Standing Terminal-Next up beside Terminal-Current is *cheap and precedented*. What is expensive and unprecedented is **replacing** `/calendar` — because four persisted-state keys, one widget-type key, two embed hosts, three external screenshot consumers and one free-tier deep-link rule all name it.

**CONFIDENCE.** 🟢 for the mechanisms and the edit list (read directly from source). 🟡 for production arming state.

---

## 1. Precedents — how new surfaces got introduced here before

Each row: mechanism · staging · rollback · what went wrong.

### 1.1 Journal 2.0 — parallel rebuild, then a runtime shell flip

**OBSERVATION.** Two generations of the Journal shipped side by side twice over. First as **two products sharing one route family**: Journal 1.0 and Journal 2.0 shared no components and no database tables (J2 uses the `j2_` table prefix), and J2 was reached as the last sub-tab. Second, *within* J2, as a **runtime-switchable shell**: `/journal` renders a selector that returns the legacy 8-tab `JournalTwoRoot` for `'v8'` or the new nested-route `JournalLayout` for `'v5'`.

**EVIDENCE.**
- `app/src/App.jsx:229-247` `JournalShellSelector()` — the seam. Reads `useJ2Shell()`; v8 has no `<Outlet/>`, so the deep `/journal/*` child routes are structurally unreachable under the legacy shell. CONFIRMED by source.
- `app/src/pages/journal-2-0/shellFlag.js` — `J2_SHELL_ROLLOUT_PCT = 100`; localStorage override `uct.j2.shell` ∈ {`v5`,`v8`}; stable per-browser bucket `uct.j2.shell.bucket`; same-tab `uct-j2shell-change` event so consumers re-read without a reload; DevTools handle `window.__uctJ2Shell('v8')`. Storage unavailable → `'v8'` (safest = legacy).
- Staging is in the git history, in order: `bacb921de` "runtime shell kill-switch (uct.j2.shell, mirrors barsPush)" → `dc04a9978` "**ship Milestone A dark (rollout 0)**" → `bcff250fc` "**flip shell rollout to 100**". CONFIRMED (commits on this branch's history).
- Per-feature kill switches for the capstone surfaces: `app/src/pages/journal-2-0/featureFlags.js` — `FEATURE_DEFAULTS` (adherence, psychology, regime, tradePng, verdictScore, tagSuggest, makeRule, celebrate, firstInsight), all default **true**, `window.__uctJ2Feature(name, false)`. Its own header states the design intent: *"the flag exists for the instant kill, not a staged rollout."*

**INTERPRETATION.** This is the closest existing analogue to Terminal-Next-beside-Terminal-Current, and it demonstrates the full ladder: build dark at 0% → flip a source constant to widen the cohort (a deploy) → per-browser instant revert (no deploy). The reason the rollout dial is a **source constant plus localStorage** rather than a server flag is stated in the file: a same-day deploy rollback was impossible under the then-current market-hours deploy freeze, so reversibility had to be runtime.

⚠️ **The freeze that motivated it is gone.** CLAUDE.md's "Live Options Flow — Deploy Survival" section records the market-hours push freeze and both its guards removed 2026-08-24 by owner decision. So the *argument* for a localStorage dial is weaker now than when it was written — but the mechanism is still the only per-browser instant revert in the product.

**RELEVANCE TO UCT.** Terminal-Next can copy this verbatim: one selector component, one `*_ROLLOUT_PCT` constant, one localStorage override. It gives Stage 1 (dark), Stage 2 (internal via DevTools handle) and Stage 3 (percentage cohort) with **zero backend work**.

**CONFIDENCE.** 🟢 (source + commit messages). **EVIDENCE CEILING:** the rollout dial's *current* value is 100 in source; whether the deployed bundle carries that value is CLAIM until a production bundle is read.

**RECOMMENDATION.** Treat `shellFlag.js` as the template file to copy, not to import — it is J2-specific by key name. Copying preserves the four properties that make it safe: stable bucket, same-tab event, safest-fallback on storage failure, DevTools handle.

**OPEN QUESTION.** The dial is per-browser, not per-account. Is "this member is in the beta" required to follow the member across devices? Nothing in the repo does that today (§6).

### 1.2 Compass Brain Bridge — dark, env-flag-gated, both surfaces

**OBSERVATION.** A whole subsystem (nightly Brain Pack → R2 → installed on the web pod → 5 tools exposed to voice *and* text Compass) shipped with **all flags default OFF**, plus a runnable exam that gates the flip.

**EVIDENCE.** CLAIM level — CLAUDE.md "Compass Brain Bridge (mentor initiative) — dark, flag-gated (2026-07-02)". Flags named there: `BRAIN_PACK_ENABLED`, `UCT_INTEL_PATH`, `BRAIN_TOOLS_ENABLED`, `COMPASS_MENTOR_MODE` (`0`/`1`/`admin`). Corroborated in code: `docs/feature_flags.json` is the ledger those names must appear in, and `api/services/feature_flag_index.py` derives the gate list by AST.

**INTERPRETATION.** Two mechanisms worth naming for Terminal-Next:
1. **`COMPASS_MENTOR_MODE` is tri-state — `0` / `1` / `admin`.** That is the only *server-side* "internal users only" cohort switch documented in this codebase, and it is a single env var, not a user table column.
2. **A deploy gate that is a runnable exam** — the report card (`scripts/run_report_card.py`, `api/services/compass_eval/`) with a documented rule "exit 1 = do NOT ship". Terminal-Next's Stage 5 "capability parity assessment" (charter Part XXXVIII) has a working idiom here.

**CONFIDENCE.** 🟡 — the flag *names* are CLAIM from CLAUDE.md; I did not read the Railway variable set. **EVIDENCE CEILING:** `tools/flag_ledger_audit.py` (read-only, `railway variables --kv`) is the one command that resolves it.

### 1.3 Awareness Engine — dark behind TWO gates

**OBSERVATION.** Double-gated: the scheduler job registers only under `COMPASS_AUTOMATION_ENABLED`, and the job function itself re-checks `AWARENESS_ENGINE_ENABLED`. Rollback = unset either one; no code change, no rebuild.

**EVIDENCE.** CLAIM — CLAUDE.md "Awareness Engine — Milestone 1 (dark, flag-gated · 2026-07-02)", including its own correction: the section previously asserted the flag was OFF from a code default, and a live read on 2026-08-09 found both ON. The correction's own rule is quoted there: *"Never assert a flag state from a code default or a past decision."*

**INTERPRETATION.** The **double gate** is the transferable pattern: registration gate (does the job exist) separate from execution gate (does it do anything). For Terminal-Next it maps to *route registration* vs *route rendering* — and the analogue matters, because a route that is registered but renders nothing is far easier to reason about than one that appears and disappears from the route table.

**CONFIDENCE.** 🟡 (CLAIM). This precedent also carries the program's cleanest cautionary tale about reading flag state from source.

### 1.4 Live Flow → Live Massive — a genuine cutover with a redirect, not a delete

**OBSERVATION.** The Bullflow-backed `/live-flow` page was retired to the Massive-backed `/live-massive`. The **route was kept** and made a redirect; the page component was **un-imported**; the reason was written at the route; a rail pins all of it.

**EVIDENCE.** `app/src/routes/liveFlowRetired.route.test.jsx` (read in full). It asserts, by name:
1. `path="/live-flow"` still exists — *"a bookmark must not 404"*;
2. its element is `<Navigate to="/live-massive" replace />` (with `replace`, "don't trap Back on the redirect");
3. `import('./pages/LiveFlow')` is **absent** from `App.jsx` — *"Left imported, the chunk still ships and the page stays one edit from being routed again by someone who does not know why it was unrouted"*;
4. a **control**: `/live-massive` is still routed and still imported — so the file cannot pass by reading the wrong `App.jsx`;
5. the retirement **reason** appears in the comment above the route (asserted to mention "bullflow").
- Owner quote embedded in the file: *"live flow is from massive, bullflow is no more" — owner, 2026-07-27.* Related commit `c4ad9eec5` "fix: stop running Bullflow — it is retired, not a lapsed subscription".
- The P5 service cutover half is CLAIM from CLAUDE.md: web serves flow reads via `api/flow_proxy.py` under `FLOW_READS_PROXY_ENABLED=1` + `WORKER_INTERNAL_URL`; rollback = flip the env sets back and redeploy flow-worker-then-web; web's `/data/flow.db` kept as a frozen pre-cutover copy.

**INTERPRETATION.** This is the **retirement template** and it has five parts worth copying literally if `/calendar` is ever retired: keep the URL, redirect with `replace`, un-import the dead page, record the reason *at the route*, and write a rail with a control. Note the deliberate asymmetry — the *route* survives, the *chunk* does not.

**RELEVANCE TO UCT.** If Terminal-Next ever supersedes Terminal-Current, `/calendar` should become a redirect, never a 404 — the inbound-dependency map in §4 makes that non-negotiable.

**CONFIDENCE.** 🟢 for the route half (the test file is the artifact). 🟡 for the service half.

### 1.5 Patterns page retirement / live-scan retirement — the "flag OFF is the decision" idiom

**OBSERVATION.** Two retirements are expressed as *unset or zeroed environment flags with a written reason*, not as deleted code.

**EVIDENCE.**
- `api/main.py:2312-2315` — the pattern-vision universe scan is gated by `PATTERN_VISION_ENABLED`, **default on** in code (`os.environ.get("PATTERN_VISION_ENABLED", "1") != "1"` → return).
- `docs/feature_flags.json:10` names it as the canonical example: *"`PATTERN_VISION_ENABLED=0` was a deliberate retirement; twelve others measured on 2026-08-30 were simply never decided. Nothing could tell them apart."*
- `api/services/screener/scan_evaluator.py:498-505` — `SCAN_LIVE_SWEEP_ENABLED`, **default OFF, READ PER CALL** (so it can be turned off without a deploy). Consumer at `api/routers/scan_results.py:184`.
- ⭐ The `feature_flags.json` `_readme` states the governing insight verbatim: *"a gate that defaults off and is set nowhere is indistinguishable, from outside the repo, from a gate that is off ON PURPOSE."* Statuses are `armed` / `dark` (note MUST say why) / `pending` (note + since MUST be present).

**INTERPRETATION.** A "retirement" here is a **ledger entry plus an env value**, not a deletion. Terminal-Next's Stage 7 (legacy retirement) therefore has a cheap, reversible first move available: gate Terminal-Current's *rendering* behind a flag whose default is ON, so retirement is a value change and rollback is a value change.

**CONFIDENCE.** 🟢.

### 1.6 The `/calendar` display rename — what changed, what deliberately stayed

**OBSERVATION.** The rename was display-only and unusually well documented in its own commit messages.

**EVIDENCE — and one correction to the contract's premise.** The contract names `88b87a32b` as the rename commit. `git show --stat 88b87a32b` is a **merge commit** (`Merge remote-tracking branch 'origin/master' into feat/uct-terminal-rename`) touching `pine.js`, its test, and the buzz runbook — *not* the rename. The rename is two commits on that branch:

| Commit | Date | Content |
|---|---|---|
| `b958aefb4` | 2026-09-01 22:06 | "Rename the Calendar surface to 'UCT Terminal'" — 18 files |
| `7c8d89581` | 2026-09-01 22:23 | "Rename: finish the accessible/attribute strings the first pass missed" — 5 files |

**What changed** (from `b958aefb4`'s own body + verified against current source): `NavBar.jsx:23`, `MobileNav.jsx:23` (route→title map), `mobile/MoreSheet.jsx:39`, `pages/dashboard/doors.js:22` (Zone D door **label** only), `pages/calendar/CalendarHeader.jsx:613` (the page's own header), `pages/calendar/MyStocksHub.jsx:484` (back link), `pages/Landing.jsx` (×4 + the screenshot alt), `Settings.jsx:1934`, `Subscribe.jsx:47`, `Pricing.jsx:34`, `intro/IntroAnimation.jsx:273` (capability pill), `widgets/registry.js:387` (`labels.{header,menu,tab}`), `pages/CalendarRender.jsx:126` (the `/r/calendar` strip), `charts/widgets/CalendarWidget.jsx` (3 titles + a loading string), `pages/Calendar.jsx:764` (`aria-label`).

**What deliberately stayed** (stated in both commit bodies, verified in source today): the route `/calendar` and `/calendar/mystocks`; the Zone D door **key** `calendar` (`doors.js:22`, and `api/routers/dashboard_signposts.py` is keyed by it); the widget **type key** `calendar` (`registry.js:386`, `WidgetHost.jsx:62`); `/api/calendar/*`; `icon: 'calendar'`; every filename and component name; every CSS class; the journal's own nested `/journal/calendar` surface; and the widget **blurb** — which stayed because it *describes function* rather than restating the label (`registry.js:564` "Earnings & market events for any day."). That last one is the rename rule in one line: **describes function ⇒ common noun; names the surface ⇒ rename.**

**Three places a literal swap read wrong**, per the commit body: the registry `tab` chip took `'Terminal'` (not the full name, matching `optionsflow`→`'Flow'`); `CalendarRender`'s strip became "UCT Terminal · notable earnings by market cap" so the *earnings* descriptor was not lost; the phone filters sheet became "Filters" because the full name overran the header.

**What went wrong / was nearly missed.**
1. **The page's own header had NO rail** — the title could have been renamed to anything or dropped and the suite stayed green. `CalendarHeader.test.jsx` now pins it.
2. **`NavBar.test.jsx` matched the nav link by `/calendar/i`** — a capital-C grep never sees that. The commit body records: *"the suite caught it, not the sweep."*
3. **The first pass was a capital-`C` sweep and was structurally blind to lowercase attribute strings** — the second commit found five more user-visible strings, four untouched by the first.

**RELEVANCE TO UCT.** This is the direct evidence for charter Part CCXXXII: a display rename in this codebase costs ~23 files and *two* passes, and the case-sensitivity failure is already measured. Any Terminal-Next naming decision that implies re-labelling Terminal-Current should budget a case-insensitive sweep plus a suite run, and should expect the suite — not the sweep — to be the instrument that finds the last ones.

**CONFIDENCE.** 🟢.

### 1.7 The Dashboard "cockpit" retirement — kept-file, countdown idiom

**OBSERVATION.** Seven Dashboard tiles were replaced by Zone D doors. The files were **kept, un-mounted, and each given a written reason in the reachability allow-list**.

**EVIDENCE.** `app/src/components/screener/reachable.test.js:285-330`. Verbatim from the file:
> *"⛔ THE FILES ARE KEPT ON PURPOSE, and this is the repo's own idiom for it: `pages/LiveFlow.jsx` above, and `api/routers/trades.py` — cut the mount, keep the file as rollback backup, record the decision. Rolling one of these back is re-adding an import and a `<div>`; deleting them now would make it a rewrite, before anyone has used the new home for a morning.*
> *⚠️ EACH IS A COUNTDOWN, NOT A PARKING SPACE."*

The `/calendar`-relevant entry: `'app/src/components/tiles/CatalystFlow.jsx': 'COCKPIT RETIREMENT — replaced by Zone D\'s "UCT Terminal" door (/calendar), which carries tonight\'s AMC reporter count. Kept as rollback backup.'`

**INTERPRETATION.** There is already a *named, machine-enforced register* of "retired but retained" modules with per-entry reasons and an explicit expiry expectation. A Terminal-Next migration that supersedes Terminal-Current components should add entries here rather than deleting files — the rail then names them, so nobody silently re-derives them as orphans (`reachable.test.js` walks the real import graph from `App.jsx` with an AST over all of `app/src`).

**CONFIDENCE.** 🟢.

### 1.8 Coming-soon gating of the public site — an env-var front door

**OBSERVATION.** The whole public marketing front door is swapped by one build-time constant, with an explicit non-gated set.

**EVIDENCE.** `app/src/utils/comingSoon.js` — `export const COMING_SOON = import.meta.env.VITE_COMING_SOON === '1'`; the file's own docstring: *"Launch day is one env change (`VITE_COMING_SOON=0` on the frontend, `COMING_SOON_MODE` unset on the backend) … No code revert."* `App.jsx:202-207` `PreLaunchGate` redirects logged-out visitors to `/`, and **logged-in members bypass it entirely** (`if (user) return <Navigate to={isPaid ? '/dashboard' : '/morning-wire'} replace />`). Applied at `App.jsx:320,322,323,334,338,341` — `/landing`, `/signup`, `/subscribe`, `/compare`, `/brokers`, `/pricing`. Deliberately **not** gated (from the docstring): `/login`, `/terms`, `/privacy`, password-reset and email-verify flows, and the token-gated `/r/*` renderers the Substack pipeline depends on. `App.jsx:291` additionally suppresses the 9-second intro film on `/` while COMING_SOON is on.

**INTERPRETATION.** The transferable shape is **a gate component wrapping a subset of routes, with the exempt set written down and justified**. A `<TerminalNextGate>` wrapping the new route(s) is a two-line addition following an idiom already in the file.

⚠️ **This is a build-time constant** (`import.meta.env` is inlined by Vite). Changing it requires a rebuild + deploy, not a variable restart. That distinguishes it from every backend flag above and matters for rollback timing.

**CONFIDENCE.** 🟢.

---

## 2. Touch points — the exact edit list for a new surface

Adding a route + nav door + flag + entitlement. Every path verified in source this session.

### 2.1 Required (a surface is not reachable without these)

| # | File | Edit | Notes |
|---|---|---|---|
| 1 | `app/src/App.jsx` | `const X = lazyPage('/x', () => import('./pages/X'))` **and** `<Route path="/x" element={<X />} />` inside `<Route element={<AuthGuard />}><Route element={<Layout />}>` | `lazyPage` (App.jsx:53-57) registers the importer in `pageImporters` so the boot prefetch (App.jsx:123-134, longest-prefix-wins) warms the chunk in parallel with auth. Plain `lazy()` also works — the header says the prefetch list *"is free to lag behind the route table"*. |
| 2 | `app/src/pages/X.jsx` + `X.module.css` | new | No CSS registry — modules are imported by the page. ⚠️ CSS-modules hashes bare `#id` selectors (known repo defect); geometry an external screenshotter targets by id must go inline. |
| 3 | `api/main.py` | `from api.routers import x_router` + `app.include_router(x_router.router)` | 119 `include_router` calls today; mounts are a flat block at ~L6928-7040. |
| 4 | `api/routers/x.py` | new router | Auth via `Depends(get_current_user)` / `require_paid` per handler. |

### 2.2 Required for the surface to be *visible*

| # | File | Edit |
|---|---|---|
| 5 | `app/src/components/NavBar.jsx` | add to `NAV_ITEMS` (L16-33) — `{ to, label, icon }`. **Exported** so `navGroups.test.js` can check bucketing without restating the list. |
| 6 | `app/src/components/navGroups.js` | add the route to a group's `routes` array — otherwise the item lands in a headingless trailing `_ungrouped` bucket (`NavBar.jsx:47-62` `GROUPED_NAV_ITEMS`) rather than vanishing. |
| 7 | `app/src/components/MobileNav.jsx` | add to `ROUTE_TITLES` (L18-37) or the mobile top bar shows `'UCT'`. Longest-prefix wins (`titleFor`). |
| 8 | `app/src/components/mobile/MoreSheet.jsx` | add to the sectioned directory (calendar's entry is L39). Since `MobileTabBar` was removed 2026-09-01, MoreSheet is the **single** mobile directory. |
| 9 | `app/src/pages/dashboard/doors.js` | *optional* — a Zone D door `{key,label,to,icon}`. ⛔ The `key` is a **backend contract**: `api/routers/dashboard_signposts.py` is keyed by it (doors.js header, and signposts L205-209 for `calendar`). |

### 2.3 Gating

| # | File | Edit |
|---|---|---|
| 10 | `app/src/components/AuthGuard.jsx` | `FREE_PAGES` is `['/morning-wire']` at L112. Adding nothing = the route is **paid-only by default** via the final `if (!isPaid && !isFreePage)` at L167. Admin-only needs an explicit clause (the `/alert-tester` precedent, L118-124). |
| 11 | `app/src/components/NavBar.jsx:39` + `mobile/MoreSheet.jsx:70` | `FREE_PAGES` is **hand-duplicated in three files**, each with a "Keep in sync" comment. See §2.5 — this is a known second-authority hazard. |
| 12 | `docs/feature_flags.json` | mandatory entry if the backend gate defaults off. `tests/test_feature_flag_ledger.py` fails **by name** on a new AST-discovered gate with no entry (`api/services/feature_flag_index.py` derives the gate list). |
| 13 | `api/services/entitlements.py` | only if a *breadth* limit is needed. One toolkit (`"all"`) ships; `toolkit_for` reads `user["toolkit"]`, and **there is no `toolkit` column on `users`** (schema: `id, email, password_hash, display_name, role, created_at` — `api/services/auth_db.py`), so it always falls back today. |

### 2.4 Tests that fail *by name* when a route is added or moved

These are the standing rails. They are not obstacles — they are the reason a new door cannot ship unreachable.

- `app/src/components/navGroups.route.test.jsx` — renders the **real `App`** at the URLs `navigableTargets()` produces and asserts none lands on `'Page not found'`. Also asserts `/catalysts` alone does **not** resolve (the one deliberate match-prefix-only gap), so the rail cannot pass vacuously.
- `app/src/pages/dashboard/doors.route.test.jsx` + `ZoneDoors.route.test.jsx` — RESOLUTION: renders `App` at the hrefs `ZoneDoors` itself produced. (`doors.test.js` is FORMAT-only; its header records that it once *claimed* to resolve routes and never did.)
- `app/src/routes/lostDoors.route.test.jsx` — the wire-cut rail for `/flow-scoreboard`, `/traders`, `/alert-tester`. Its header is the strongest statement in the repo of why a component test cannot be a door rail: *"`FlowScoreboard.test.jsx`-style component rendering stays green for the entire time no route reaches it."*
- `app/src/components/screener/reachable.test.js` — AST walk of the real import graph from `App.jsx` over **all of `app/src`**; entry points read off `vite.config.js`. Follows `lazy(() => import())`, `new Worker(new URL(...))`, `?raw` query specifiers. A new page not reachable from `App.jsx` fails here.
- `tests/test_navigation_targets_resolve.py` — resolves every value in `voice_client_action_tools.PAGE_ALIASES` and every key in `voice.py::_PAGE_DESCRIPTIONS` against `App.jsx`'s route table, **excluding the catch-all** (its own header calls that exclusion "the load-bearing line in this file"). A Terminal-Next voice alias is covered the day it is written.
- `app/src/components/navGroups.test.js` — every `NAV_ITEMS` entry maps into exactly one `NAV_GROUPS` bucket.
- `app/src/widgets/registry.test.js` — pins `WIDGET_REGISTRY` ⇄ `WORKSPACE_WIDGETS` (a registry id with no host binding fails loudly).

### 2.5 High-conflict shared files (charter Part CCIV)

Ranked by how many independent features must edit the same lines.

| File | Why high-conflict |
|---|---|
| **`app/src/App.jsx`** (559 lines) | THE routing authority + intro-suppression list + `/r/*` list + `PreLaunchGate` applications + `SWR_CONFIG` + the J2 shell selector. Every new surface touches it. Designate an owner. |
| **`api/main.py`** (~7,000 lines) | 119 `include_router` calls, every APScheduler `add_job`, the lifespan, the warm-on-boot block. CLAUDE.md records a partner commit that *silently dropped* the broker-sync mount, producing a 405 — hence the standing `grep -c broker_sync api/main.py ≥ 7` check. |
| **`app/src/components/NavBar.jsx` / `MobileNav.jsx` / `mobile/MoreSheet.jsx`** | Three surfaces, one taxonomy (`navGroups.js`), **plus three hand-copies of `FREE_PAGES`** with "keep in sync" comments — a second-authority-over-one-value in the exact shape this repo has burned itself on repeatedly. |
| **`app/src/components/AuthGuard.jsx`** | Every entitlement rule funnels here; the `/calendar` free-tier deep-link clause lives at L144-148. |
| **`app/src/widgets/registry.js`** + `pages/charts/WidgetHost.jsx` | Every widget type; two files that must move together (pinned by `registry.test.js`). |
| **`app/src/hooks/usePreferences.js`** | The module-level write queue and the `chart_settings` merge rule are shared by every persisted-pref writer in the app. |
| **`app/src/styles/tokens.css` / `breakpoints.css`** | Design-system tokens; the canonical breakpoint literals (640 / 1024) are owned here. |
| **`api/services/auth_db.py`** | Central schema + migration list. |
| **Partner-owned (do not touch without ack):** `OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py` | Per `OWNER_SEED_FACTS.md` §4. A one-line non-partner change to `live_massive_router.py` on 2026-09-01 is documented in CLAUDE.md as an exception with owner go-ahead. |

**OBSERVATION → RECOMMENDATION.** For parallel Terminal-Next development, the cheapest conflict reducer is to make each of `App.jsx`, `api/main.py`, `NavBar.jsx` a **one-line-per-feature** edit (a route line, an `include_router` line, a `NAV_ITEMS` line) and put everything else in new files. That is already how the codebase is shaped; the risk is a feature that wants to restructure one of these three.

---

## 3. Persisted-key hazards — why a rename wipes saved views

### 3.1 The storage mechanism (this is the whole argument)

**OBSERVATION.** User preferences are an **opaque key/value table with no key migration anywhere in the read path**.

**EVIDENCE.**
- `api/services/auth_db.py:227` — `CREATE TABLE IF NOT EXISTS user_preferences (...)` with `pref_key` / `pref_value`, unique on `(user_id, pref_key)`.
- `api/services/auth_service.py:1422-1433` `get_user_preferences` — `SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?` → a flat dict. **No aliasing, no fallback, no migration.**
- `api/services/auth_service.py:1435-1443` `set_user_preference` — `INSERT … ON CONFLICT(user_id, pref_key) DO UPDATE`.
- `api/routers/auth.py:1640-1647` — `GET/POST /api/auth/preferences`; the POST body is `{key: str, value: str}`.
- `app/src/hooks/usePreferences.js` — SWR over `/api/auth/preferences`; `DEFAULTS` covers only `default_chart_tf` and `theme`.

**INTERPRETATION.** A renamed key is simply **a key with no rows**. The read returns `undefined`, the component falls back to its coded default, and the member's saved view is gone — silently, with no error and no way for the member to tell it from a bug. Nothing in the stack detects it. This is the mechanical basis for the seed-fact prohibition.

**CONFIDENCE.** 🟢 (read end-to-end: component → hook → endpoint → SQL → schema).

### 3.2 The Terminal-Current key inventory

Enumerated from `grep -no "calendar_[a-z_0-9]*" app/src` (non-test), then each verified at its call site.

| Key | Written at | Read at | What is lost on rename |
|---|---|---|---|
| `calendar_view_v3` | `pages/Calendar.jsx:171` | `Calendar.jsx:151` | Board / Table / Month choice → resets to `board` |
| `calendar_filters_v2` | `Calendar.jsx:172` | `Calendar.jsx:161` | audience, cap filters, sort → resets to `DEFAULT_FILTERS` |
| `calendar_mystocks_sources` | `Calendar.jsx:173` **and** `calendar/MyStocksHub.jsx:352` | `Calendar.jsx:170`, `MyStocksHub.jsx:351` | the My-Stocks source picker → resets to `ALL_SOURCES`. ⚠️ **Two writers, one key** — a rename must move both. |
| `calendar_event_types_v2` | `Calendar.jsx:191` | `Calendar.jsx:187` | earnings/macro/IPO/dividend chip state → resets to `DEFAULT_EVENT_TYPES`. **⭐ Not named in the D-08 contract — a fourth key.** |
| `calendar_widget_settings` | `pages/charts/widgets/calendarWidgetSettings.js:7` (`CALENDAR_WIDGET_SETTINGS_KEY`) | same | per-widget calendar appearance settings. **⭐ A fifth key, also not in the contract.** |
| *(legacy, read-only)* `calendar_view_v2`, `calendar_density`, `calendar_filters` | — | `Calendar.jsx:150,153,166` | already-migrated predecessors; still read once |

### 3.3 ⭐ The read-fallback shim pattern EXISTS — and it is in this exact file

**OBSERVATION.** The contract asks whether a read-fallback shim exists elsewhere. It exists **here**, three times over, and it is the established idiom for changing a calendar preference key.

**EVIDENCE — `app/src/pages/Calendar.jsx:145-191`, verbatim structure:**

```js
const _viewV2 = prefs.calendar_view_v2
const _savedViewV3 = prefs.calendar_view_v3
const view = _savedViewV3 || (
  _viewV2 === 'month' ? 'month'
  : (_viewV2 === 'feed' && prefs.calendar_density === 'rows') ? 'table'
  : 'board'
)
...
const _savedFiltersV2 = parsePref(prefs.calendar_filters_v2, null)
const filters = _savedFiltersV2
  ? { ...DEFAULT_FILTERS, ..._savedFiltersV2 }
  : { ...DEFAULT_FILTERS, ...parsePref(prefs.calendar_filters, {}),
      audience: DEFAULT_FILTERS.audience, sort: DEFAULT_FILTERS.sort }
```

The in-file comments state the rule: *"v2 prefs migrate once: feed+rows→table, else board"*, and for filters *"Legacy metric filters carry over once; audience/sort reset to the new default, then every choice persists under v2."* For `calendar_event_types_v2` the comment records the **opposite** deliberate choice: *"Bumping the key resets everyone to the new earnings-only default"* — because macro used to be a locked always-on chip, so every legacy saved value carried it *not by choice*.

**INTERPRETATION.** The shim is **read-old-write-new**: the new key is authoritative when present; the old key is read once as a fallback and never written again. It has three properties worth stating precisely:
1. It is **lossy on partial fields by design** (filters carry metric choices but reset audience/sort).
2. It **never migrates the row** — the old key stays in the table forever, so the fallback path is permanent unless someone writes a sweep. Cheap, but it means the "legacy read" branch is load-bearing indefinitely.
3. It is **per-key and hand-written**, not a framework. Five keys ⇒ five shims.

**RELEVANCE TO UCT.** The seed-fact prohibition ("renaming persisted keys is prohibited") remains the right default, but this evidence sharpens *why*: it is not that renaming is impossible, it is that **each rename costs a bespoke shim, and a forgotten one is silent**. If Terminal-Next needs new preference keys, the safe move is **new keys with new names** (e.g. `tnext_*`) and no touching of the `calendar_*` family at all — coexistence, not migration.

**CONFIDENCE.** 🟢.

### 3.4 The widget-type key inside `charts_workspace_layout` — a DIFFERENT failure mode

**OBSERVATION.** Renaming the `calendar` widget type key does **not** wipe the saved layout. It produces a visibly broken tile.

**EVIDENCE.**
- The layout blob is `charts_workspace_layout`, a JSON string of `{cols, widgets:[{id, type, x, y, w, h, opts:{...}}]}` — written at `ChartsWorkspace.jsx:965, 977, 1704, 1762, 1818, 1882`, read at L724, L732.
- `parseLayout` (`ChartsWorkspace.jsx:297-331`) migrates 12→24 columns and auto-fits legacy heights, then `return { ...parsed, widgets: clampWidgetsToRows(widgets), cols }`. **It does not filter by known type.** An unknown `type` survives parsing intact.
- `WidgetHost.jsx:77-78` — `const binding = WORKSPACE_WIDGETS[type]; if (!binding) return <div className={styles.unknownWidget}>Unknown widget type: {type}</div>`.
- The registry entry is `registry.js:386` `calendar:` and the host binding is `WidgetHost.jsx:62` `calendar: { component: CalendarWidget, props: standardProps }`, pinned equal by `registry.test.js`.

**INTERPRETATION.** So the two hazards are **different in kind and both matter**:
- **Preference keys** → *silent* reset to defaults. The member cannot tell it from a bug.
- **Widget type key** → *loud* "Unknown widget type: calendar" occupying the tile's grid slot. Recoverable by removing and re-adding the widget, but every member with the widget on a board sees it, and the grid geometry is preserved so it looks like a crash rather than a migration.

⚠️ A third consumer: `api/services/indicator_alert_service.py:1368` `_INSTANCE_BLOBS = ("charts_workspace_layout", "chart_settings", …)` — the layout blob is read server-side too, so a shape change is not purely a frontend concern.

**RECOMMENDATION.** Whatever else is decided: **the widget type key `calendar` is a data value inside every member's saved board.** Terminal-Next should register a *new* type id (e.g. `terminal`) and leave `calendar` bound. Two ids can coexist in `WIDGET_REGISTRY` indefinitely at the cost of two menu entries; that is a labelling problem, not a data problem.

**CONFIDENCE.** 🟢.

### 3.5 Other persisted state that names the calendar

- `pages/journal-2-0/components/notebook/*` — a notebook embed stores `{type:'calendar', params:{date, econStars, selectedSym, tbdOpen, sections, settings}}` **verbatim inside the note document** (`registry.js:392-401` `paramsSchema`, with the comment *"Keep keys STABLE — every stored notebook doc carries them verbatim"*). A type or param rename orphans embeds inside members' saved notes — durable content, not a view preference.
- `calendar_seen` (`api/services/calendar_seen.py`) — server-side read/unseen state for the My Stocks hub.
- `j2_calendar_pnl_basis` — **unrelated**; belongs to the Journal calendar (§4.3).

---

## 4. Inbound dependencies on `/calendar` — the "what breaks if replaced" list

### 4.1 In-app doors (all break as navigation if the route is removed)

| Consumer | Path:line | Effect of removal |
|---|---|---|
| Desktop nav rail | `NavBar.jsx:23` | dead link → 404 (and `navGroups.route.test.jsx` goes RED) |
| Mobile directory | `mobile/MoreSheet.jsx:39` | dead link |
| Mobile top-bar title | `MobileNav.jsx:23` | title falls back to `'UCT'` |
| Route taxonomy | `navGroups.js:22` | `/calendar` is a match-prefix for the **Markets** group; removing it un-highlights Markets |
| Dashboard Zone D door | `pages/dashboard/doors.js:22` (key `calendar`) | door 404s; `doors.route.test.jsx` + `ZoneDoors.route.test.jsx` RED. ⛔ The **key** additionally keys `api/routers/dashboard_signposts.py:205-209`, which serves the "On deck / tonight's AMC reporter count" card |
| My Stocks back-link | `calendar/MyStocksHub.jsx:484` | broken back navigation |
| Header hub link | `calendar/CalendarHeader.jsx:655` | `→ /calendar/mystocks` |
| Voice navigator | `api/services/voice_client_action_tools.py:36` — `"calendar"`, `"events"`, `"earnings calendar"` all → `/calendar` | Compass walks members into `NotFound`. ⭐ This is the **exact defect class** `tests/test_navigation_targets_resolve.py` was written for (the `/traders` incident) — so it would go RED, by name |
| Compass page context | `api/routers/voice.py:1318` | `_PAGE_BLURBS["calendar"]`, keyed via `PAGE_ALIASES`; a bad key is **loud** here (`_by_path` raises at import) |
| Mobile audit harness | `tools/mobile_audit.py:58` | hand-typed route list; would audit the 404 page (the known vacuity mode) |
| Modal phone check | `tools/modal_phone_check.py:111` | `GET /calendar?earnings={sym}&esection=setup` |

### 4.2 Deep links with parameters

**OBSERVATION.** `/calendar` is a **parameterized deep-link target with its own routing module and a free-tier fallback rule** — the most externally-shared surface in the product.

**EVIDENCE.**
- `pages/calendar/useEarningsModalRoute.js:42-56` — `EARNINGS_PARAM='earnings'`, `SECTION_PARAM='esection'`, `WEEK_PARAM='week'`, and `export const ROUTED_PATHS = ['/calendar', '/calendar/mystocks']` with the comment *"§4.4: the param is honored on these two surfaces ONLY. CatalystFlow is deliberately absent."*
- `pages/Calendar.jsx:88` — `/calendar?week=YYYY-MM-DD&d=YYYY-MM-DD` is deep-linkable.
- `components/AuthGuard.jsx:144-148` — the §13 free-tier rule (owner call 2026-08-05): a non-paid visit to `/calendar?earnings=SYM` with a valid ticker is redirected to `/research/:sym` (the paywall teaser) instead of a bare bounce, *"the most viral surface in the product, spent as an unexplained bounce."* Rails: `AuthGuard.calendarDeepLink.test.jsx` (incl. path-traversal and XSS param cases).
- `components/intro/IntroAnimation.jsx:62` — the intro's Escape handling is aware that a `?earnings=` deep link opens a modal *behind* the film.

**INTERPRETATION.** Replacing `/calendar` breaks **shared links already in the wild** — Discord messages, DMs, bookmarks — none of which is enumerable from any repository. The free-tier redirect makes it worse: it is the product's designed acquisition path.

### 4.3 Embeds — three hosts, and one that is NOT the same data path

| Embed | Path | Data path | Same as Terminal-Current? |
|---|---|---|---|
| `/charts` workspace widget | `pages/charts/widgets/CalendarWidget.jsx:320` | `GET /api/calendar?week=…&full_impact=1` | ✅ **Yes** — same endpoint |
| Notebook embed | `journal-2-0/components/notebook/CalendarEmbed.jsx` → mounts **the real `CalendarWidget`** under a frozen workspace context (`WidgetEmbedView.jsx:40` maps `calendar:`) | same `/api/calendar` | ✅ **Yes** — *"one component, two hosts"* (file docstring). `onOptsChange={null}`, `journalDoor={false}` |
| `journal-2-0` CalendarTab | `journal-2-0/tabs/CalendarTab.jsx` → `hooks/useJ2Calendar.js:44` | `GET /api/j2/calendar?…` (`api/routers/journal_two.py:1955`) — **closed-trade P&L**, not earnings | ❌ **NO — a different feature that shares only the word "Calendar"** |

**⭐ Direct answer to the contract's question.** The journal's CalendarTab is **not** the same data path and is **not** part of Terminal-Current. Its route is `/journal/calendar` (`JournalLayout.jsx:54`, `JournalMobileNav.jsx:31`), its pref is `j2_calendar_pnl_basis`, its mode key is `uct.j2.calendar.mode`, and the rename commit `7c8d89581` explicitly lists *"the journal's own nested /journal/calendar surface"* among things deliberately untouched. **Do not include it in any Terminal-Current parity matrix.**

**CONFIDENCE.** 🟢.

### 4.4 The `/r/calendar` render route and its real consumers

**OBSERVATION — and a correction to the contract's premise.** `/r/calendar` is **not** used by the chart-renderer service.

**EVIDENCE.**
- `App.jsx:396` — `<Route path="/r/calendar" element={<CalendarRender />} />`, registered **outside** `AuthGuard` (logged-out, token-gated data). Also listed in the intro-suppression array at `App.jsx:286`.
- `pages/CalendarRender.jsx:66` fetches `/api/calendar?week=…`; its strip reads "UCT Terminal · notable earnings by market cap" (L126).
- `api/routers/calendar.py:56` documents the pairing: *"`App.jsx` mounts `/r/calendar` → `CalendarRender.jsx` OUTSIDE `AuthGuard`"*; `api/routers/render_panels.py:461` records that `/api/calendar` was kept open *"precisely because `/r/calendar` needs it."*
- **Actual consumers, both external repos:**
  - `morning-wire/substack/panelshot.py:3` — *"Navigates a headless browser to DASHBOARD_URL/r/catalysts and /r/calendar"*.
  - `uct-sunday-scan/sunday_scan/panels.py:5` — *"EARNINGS -> the dashboard's own /r/calendar panel, screenshotted"*; L15 notes ECON is local *"because there is no dashboard equivalent"*; L303 carries a ⛔ warning about replacing that screenshot.
- **`services/chart_renderer/app.py` references `/r/chart` only** (L12, L19) — no `/r/calendar`. CONFIRMED by grep of the service directory.

**INTERPRETATION.** `/r/calendar` is a **screenshot contract with two external pipelines**. Its visual layout — not just its data — is consumed. Changing it changes the Substack wire and the Sunday Scan issue.

### 4.5 The `/api/calendar` data contract — the widest dependency of all

Independent of the SPA route, **six** consumers read `/api/calendar`:

| Consumer | Path:line |
|---|---|
| Sunday Scans | `uct-sunday-scan/sunday_scan/calendar_data.py:629` (`?week=`), `:621` (`/api/calendar/month` fallback) — with a documented week-parameter guard at L17-26 |
| Substack "earnings ahead" | `morning-wire/substack/earnings_ahead.py:25` — and `morning-wire/docs/00-READER-REVIEW-LEDGER-2026-08-24.md:24` records a real roster disagreement from this cross-service read |
| Options Flow page | `app/src/pages/OptionsFlow.jsx:810` (partner-owned; noted, not described further) |
| Live Massive router | `api/live_massive_router.py:3964` (partner-owned) |
| Massive WS worker | `api/massive_ws_worker.py:1510` (partner-owned) |
| Discord `#event-calendar` + Sunday Scan PNG | `api/services/calendar_week_poster.py` (gate `CALENDAR_WEEK_POST_ENABLED`, `api/main.py:5793`) and `api/routers/render_panels.py:506` `GET /r/calendar-week.png`, which deliberately calls `build_payloads` so *"the PNG in the newsletter is byte-identical to the one in #event-calendar"* |

Plus in-repo: `calendar_alerts.py` (pre-report alerts, `CALENDAR_ALERTS_ENABLED`), `main.py:903-989` warm-on-boot (`_calendar`, `_enrichment`, `earnings-previews`), `main.py:995` the 90s enrichment warm.

### 4.6 What we did NOT find

**OBSERVATION.** A cross-repo grep for `uctintelligence.com/calendar` over the dashboard worktree and all four sibling repos returned **no member-facing hardcoded links** to the SPA route. `/c/Users/Patrick/uct_intelligence` (the Discord bot) contains **zero** `/calendar` references.

**INTERPRETATION.** The route's external exposure is via **human-shared links and bookmarks**, which no repository can enumerate — not via generated content. That is the residual risk, and it is unmeasurable from here.

**EVIDENCE CEILING.** Substack post bodies, Discord message history, sent emails and YouTube descriptions are outside this worktree. To bound the risk one would need the Discord channel export and the Substack archive.

### 4.7 The "what breaks if `/calendar` is replaced" list

**Immediate (member-visible, same deploy):**
1. Every shared/bookmarked `/calendar?earnings=SYM&esection=…` link — including the free-tier acquisition path.
2. Desktop nav, MoreSheet, mobile title, Zone D door.
3. The voice navigator's three aliases.
4. `/calendar/mystocks` and its back-link.
5. Saved `/charts` boards containing the calendar widget → "Unknown widget type" tiles.
6. Notebook notes containing a calendar embed.

**Next scheduled run (invisible until it fails):**
7. The Sunday Scan earnings panel (`/r/calendar` screenshot).
8. The Substack wire's panel shot.
9. `#event-calendar` weekly Discord post + the `/r/calendar-week.png` newsletter image (if the data path moves too).

**Test suite (immediately, by name — this is the good news):**
10. `navGroups.route.test.jsx`, `doors.route.test.jsx`, `ZoneDoors.route.test.jsx`, `tests/test_navigation_targets_resolve.py`, `AuthGuard.calendarDeepLink.test.jsx`, `Calendar.deepLinkWeek.test.jsx`, `useEarningsModalRoute.test.jsx`, `CalendarHeader.test.jsx`, `myStocksHub.test.jsx`.

**Silent (nothing reports it):**
11. The five persisted `calendar_*` preference keys, if renamed (§3.2).

---

## 5. Coexistence options, priced against the code (PROVISIONAL ranking)

⚠️ **The ranking is PROVISIONAL.** It is a cost/blast-radius ordering derived from code, not a product decision. Naming implications defer to charter Part CCXXXII and owner ruling; migration decisions defer to Document B §34 escalation.

### Option A — New route + runtime rollout dial (the Journal 2.0 shape)

- **Files:** `App.jsx` (2 lines), new `pages/terminalNext/*`, `NavBar.jsx` (1 line), `navGroups.js` (1 word), `MobileNav.jsx` (1 line), `MoreSheet.jsx` (1 line), new `terminalNextFlag.js` (copy of `shellFlag.js`), optional `api/main.py` + new router.
- **Blast radius on Terminal-Current:** **zero.** No shared file's *behaviour* changes; only additive list entries.
- **Flag/entitlement:** frontend `*_ROLLOUT_PCT` + localStorage override. `AuthGuard` default (not in `FREE_PAGES`) makes it paid-only with no edit.
- **Rollback:** per-browser instant (`window.__uctTerminalNext('off')`); cohort narrow = constant + deploy (~10 min).
- **URL / back button:** its own URL, fully bookmarkable, back works natively. Both surfaces addressable simultaneously.
- **Naming:** needs a member-visible label distinct from "UCT Terminal" while both are in the nav (Part CCXXXII: "UCT Terminal / Terminal Beta" is the charter's own suggestion).
- **Risk:** **two "Terminal" entries in the nav rail simultaneously.** Rail width is measured — the rename commit records `'UCT Terminal'` at 86.4px against a 128px label budget — so a second entry fits, but the *taxonomy* confusion is real and is a naming problem, not an engineering one.

### Option B — New route, admin-only, no nav entry (the `/alert-tester` shape)

- **Files:** `App.jsx` (2 lines) + one `AuthGuard.jsx` clause extending `isAdminOnly` (L118-124). **No nav edits at all.**
- **Blast radius:** zero. Members cannot see or reach it.
- **Flag:** none needed — `role === 'admin'` is the gate. `ADMIN_EMAILS` (`api/routers/auth.py:104-106`) promotes accounts at login and on boot (`api/main.py:2432-2449`).
- **Rollback:** delete two lines, or leave it — nobody sees it.
- **URL / back button:** normal.
- **Naming:** irrelevant — no member sees a label.
- **Risk:** ⛔ **the `lostDoors` failure mode.** `/alert-tester` and `/traders` both became unreachable without one test going red. A no-nav route must ship *with* a route-resolution rail on day one, or it becomes the next entry in `lostDoors.route.test.jsx`.
- **Note:** this is the cheapest possible Stage 1+2 and is essentially free.

### Option C — A mode toggle inside `/charts` (the Multi-Chart Grid shape)

- **Precedent:** Multi-Chart Grid is a second **mode** of the existing `/charts` route — `ChartsWorkspace.jsx:2025` `const gridMode = mc.state.mode === 'grid' || gridSpikeRequested`, entered from "Open Layout ▾ → ▦ Multi Chart" (an owner decision 2026-07-17 that it is *not* a header tab), persisted in its own `multichart_state` pref.
- **Files:** `ChartsWorkspace.jsx` (a high-conflict file), new mode components, new pref key.
- **Blast radius:** **on `/charts`, not on Terminal-Current.** But `/charts` is the workspace that *hosts the calendar widget*, so it is not blast-radius-free either.
- **Flag/entitlement:** inherits `/charts` (paid).
- **Rollback:** mode default + a menu entry.
- **URL / back button:** ⚠️ **weakest option here.** The mode is a *pref*, not a URL segment, so a Terminal-Next view is not bookmarkable or shareable and the back button does not leave it. Given §4.2 (deep links are Terminal-Current's most valuable property) this is a material regression in kind.
- **Risk:** conflates two products in one route; `charts_workspace_layout` sanitization surface grows.

### Option D — A tab inside Terminal-Current (`/calendar?view=next`)

- **Precedent:** the calendar's own Wire/Board/Table/Month segment (`calendar_view_v3`); the admin-gated Breadth "Analogues" tab (`Breadth.jsx:836-837` — `const items = isAdmin ? [...BREADTH_TAB_ITEMS, {key:'analogues', label:'Analogues'}] : BREADTH_TAB_ITEMS`, with a guard at L943 that bounces a non-admin off the tab).
- **Files:** `pages/Calendar.jsx` + `calendar/CalendarHeader.jsx` — **directly editing Terminal-Current.**
- **Blast radius:** ⛔ **highest.** Every change is inside the surface the seed facts say must take no destructive change. The `calendar_view_v3` value space would gain a member; a stale saved value is a real failure mode.
- **Flag/entitlement:** the Breadth pattern gives admin-gated tab visibility for free.
- **Rollback:** revert a tab entry; but any persisted `view` value written during the beta outlives the revert unless the read-fallback handles it.
- **URL:** ✅ query-param addressable, and the calendar already owns `?week`/`?d`/`?earnings`/`?esection`.
- **Naming:** ✅ **best** — one nav entry, no member-visible naming decision needed at all during the beta.
- **Verdict:** attractive for naming, expensive for safety.

### Option E — Secondary route under the existing prefix (`/calendar/next`)

- **Precedent:** `/calendar/mystocks` already exists as a sibling under the same prefix (`App.jsx:438`), with `lazyPage` and the longest-prefix prefetch (`App.jsx:121-122`, whose comment names exactly this case).
- **Files:** `App.jsx` (2 lines) + new page. Optionally no nav entry (a link from `CalendarHeader`, as `/calendar/mystocks` is reached at `CalendarHeader.jsx:655`).
- **Blast radius:** near-zero — one link in `CalendarHeader.jsx` if you want a door.
- **Flag:** inherits the `/calendar` paid gate; ⚠️ **but not the free-tier deep-link clause** — `AuthGuard.jsx:144` matches `location.pathname === '/calendar'` exactly, so `/calendar/next` falls through to the plain `FREE_HOME` bounce. That is a *behaviour difference to know about*, not a bug.
- **URL / back:** ✅ full, native, bookmarkable.
- **Naming:** ✅ good — the URL implies the relationship without a second nav label.
- **Risk:** couples Terminal-Next's URL to a route the program may eventually want to retire. Also `navGroups.js` `routes` prefix-matching means `/calendar/next` already lights "Markets" with no edit.

### Option F — A full parallel product route (`/terminal`) with `/calendar` untouched

- **Precedent:** Journal 2.0 beside Journal 1.0 (no shared code, no shared tables, `j2_` prefix).
- **Files:** same as Option A plus a new backend router family (`/api/terminal/*`) and new pref keys (`tnext_*`).
- **Blast radius:** zero, and — uniquely — **zero shared persisted state**, which is the property the seed facts care most about.
- **Rollback:** un-route; keep the files (the cockpit-retirement idiom, §1.7).
- **URL / back:** ✅ full.
- **Naming:** needs the Part CCXXXII decision up front.
- **Risk:** duplicate data-fetch paths against the same providers → double provider cost and a second authority over the same numbers, which this repo has burned itself on repeatedly. If the calendar data is shared, share the *endpoint*, not a copy.

### PROVISIONAL ranking

| Rank | Option | One-line reason |
|---|---|---|
| 1 | **B** (admin-only route, no nav) for **Stage 1–2** | Cheapest possible dark ship; zero member surface; two lines. Ships with a route rail. |
| 2 | **A** or **E** for **Stage 3–4** | A gives a first-class nav identity; E gives the relationship for free and defers the naming decision. Choose on Part CCXXXII, not on cost — they are within a file or two of each other. |
| 3 | **F** if Terminal-Next's data model genuinely diverges | Buys total isolation; pay for it only if the divergence is real. |
| 4 | **D** | Best naming answer, worst safety answer. Only if the owner rules that one nav entry is required. |
| 5 | **C** | Loses URL addressability, which is Terminal-Current's most valuable property. |

**A path that is not an option but a sequence:** B → E/A → (F if needed) is entirely additive at every step, and every step's rollback is a deleted line.

---

## 6. Staged rollout mechanics available today

### 6.1 What exists

| Mechanism | Where | Granularity | Rollback |
|---|---|---|---|
| Admin-only route | `AuthGuard.jsx:118-124` (`isAdminOnly`) | role | code |
| Admin-only *tab* | `Breadth.jsx:836-837, 943` (`isAdmin ? [...items, analogues] : items`) | role | code |
| `ADMIN_EMAILS` | `api/routers/auth.py:104-106` (+ owner and one admin hardcoded); boot promotion `api/main.py:2432-2449`; login promotion `auth.py:199` | account | env var |
| Paid gate | `AuthGuard.jsx` + `Depends(require_paid)` server-side | plan | — |
| Per-browser % rollout | `shellFlag.js` `J2_SHELL_ROLLOUT_PCT`; `StockChart.jsx:895` `BARS_PUSH_ROLLOUT_PCT`, `:947` `BARS_HISTORY_SPLIT_ROLLOUT_PCT` | browser | localStorage (instant) / constant + deploy |
| Per-browser feature kill | `journal-2-0/featureFlags.js` `window.__uctJ2Feature(name, false)` | browser | instant |
| Backend env gate | `os.environ.get(...)`; read-per-call in the best cases (`scan_evaluator.py:498-505`) | global (or per-service) | Railway var + redeploy |
| Tri-state internal cohort | `COMPASS_MENTOR_MODE` ∈ `0`/`1`/`admin` | global/role | env |
| Double gate | Awareness Engine: registration flag + execution flag | global | env |
| Build-time site gate | `VITE_COMING_SOON` + `<PreLaunchGate>` | global | rebuild + deploy |
| Flag ledger | `docs/feature_flags.json` (`armed`/`dark`/`pending`) + `api/services/feature_flag_index.py` (AST-derived) + `tests/test_feature_flag_ledger.py` (fails **by name**) + `tools/flag_ledger_audit.py` (read-only Railway compare, exit 1 on drift) | — | — |
| Cutover gate instruments | `tools/cutover_watch.py` + `docs/runbooks/cutover-watch.md` (exit 0=GO / 1=NO-GO, `--self-test` proves it can refuse); `docs/operations/phase-7-launch-checklist.md` (5-day operator review, ≥85% accept rate) ; `docs/decisions/2026-08-06-closed-bar-alert-cutover.md` (a decision record whose **`**Status:**` line is itself a test assertion**) | — | — |

### 6.2 ⭐ What does NOT exist — the gap for Stage 3

**OBSERVATION.** There is **no per-user, server-side feature flag or beta-cohort mechanism.** "Selected members opt in" (charter Part XXXVIII Stage 3) cannot be expressed today.

**EVIDENCE.**
- `users` schema is `id, email, password_hash, display_name, role, created_at` (`api/services/auth_db.py`) — **no `toolkit`, no `beta`, no `cohort` column.**
- `api/services/entitlements.py:254-276` `toolkit_for` reads `user.get("toolkit")` and falls back — its own docstring says *"ONE TOOLKIT SHIPS, AND THE LOOKUP IS STILL REAL"* and *"Nothing here stores per-user state yet, so no key is minted."* With no column, the lookup is always the default.
- `TOOLKITS` (L241-249) has exactly one entry, `"all"`, with every cap `None` except `max_definitions`.
- Every percentage rollout is keyed on a **localStorage browser bucket**, so a member on two devices can be in the beta on one and not the other, and a cleared browser leaves the cohort.
- `role` has exactly two observed values (`'member'` default, `'admin'`).

**INTERPRETATION.** Stage 1 (dark), Stage 2 (internal) and Stage 4 (default-on beside the old) are all buildable **today with no new infrastructure**. Stage 3 (selected members) is the only stage that requires something new.

**RECOMMENDATION — smallest reliable addition (charter Part XXXIX asks for exactly this).** Two candidates, both small:
1. **A preference-backed flag.** `user_preferences` is already a per-user key/value store with an endpoint. `setPref('beta_terminal_next', '1')` costs zero schema work — but it is **member-writable** via `POST /api/auth/preferences` (`auth.py:1645`, body `{key, value}` with no key allowlist), so it is an *opt-in* mechanism, not an entitlement. That may be exactly right for a beta.
2. **A `toolkit` (or `cohort`) column on `users`.** ~1 migration line in `auth_db.py`'s alter list + a second `TOOLKITS` entry. `entitlements.py` is *already written to read it* — the docstring says the day a second toolkit is sold *"the only edit is in `TOOLKITS`"*. This is the entitlement-grade answer.

⛔ Do not build a third mechanism. The repo already has one entitlement seam (`entitlements.py`) and one per-user scoping precedent (`alert_user_series.scoped_key(user_id, address)`, cited in `toolkit_for`'s docstring); a new parallel cohort table would be the second-authority defect this codebase names more often than any other.

**CONFIDENCE.** 🟢 for the absence (schema read directly). 🟡 for whether an unread migration adds a column at runtime — `auth_db.py`'s migration list was grepped for "toolkit" and returned nothing.

### 6.3 What a Stage 1–3 rollout would require

| Stage | Needs | Exists? |
|---|---|---|
| 1 — dark behind a flag | route registered, renders nothing / admin-only | ✅ Option B, two lines |
| 2 — internal users | `ADMIN_EMAILS` + `role === 'admin'` gate, or `COMPASS_MENTOR_MODE=admin`-style tri-state | ✅ |
| 3 — selected members opt in | per-user persistent cohort | ❌ **the one gap** — see §6.2 |
| 4 — default available, legacy remains | rollout dial to 100 + nav entry | ✅ |
| 5 — parity assessment | a gate instrument | ✅ idioms exist (`cutover_watch.py`, phase-7 checklist, the report-card deploy gate); the **matrix itself** does not — §7 |
| 6 — migration decision | owner escalation | out of scope here |
| 7 — legacy retirement | redirect + un-import + reason-at-route + rail + kept-file ledger entry | ✅ fully templated (§1.4, §1.7) |

---

## 7. Migration gates — headers to seed the legacy parity matrix (Part CDLXII)

**Scope note.** D-09 owns the capability detail. These are **headers only**, derived from the route surface, its persisted keys, its endpoints and its inbound contracts — so D-09's map can be merged into a matrix without a second enumeration. Merge target: `docs/terminal-research/` D-09 artifact.

Each row must eventually be marked one of: **migrated · improved · intentionally removed · replaced · still legacy-only.**

**A. Views and layout**
1. Wire view · 2. Board view (default) · 3. Table view · 4. Month view · 5. Week strip / week navigation (`?week=`, `?d=`) · 6. Today's Brief · 7. Macro band · 8. Day detail drawer

**B. Scoping and filtering**
9. My Stocks scope (union of watchlists / flagged / J2 positions / UCT20, `/api/calendar/my-sets`) · 10. Watchlist / Positions / UCT20 / All scopes · 11. Market-cap filters · 12. Audience filter · 13. Sort + rank order (incl. the "never fall back to the provider's alphabetical order" ruling, `db699cd26`) · 14. Event-type chips (earnings / macro / IPO / dividend) · 15. Quick search (ephemeral by design) · 16. "N hidden" + "Show all" undo (`8614d1c8d`)

**C. Per-ticker depth (the earnings modal)**
17. Deep-link contract `?earnings=SYM&esection=…` · 18. The five modal tabs (rebuilt 2026-08-31; the only surface on `--glass-*` tokens) · 19. Fundamentals / fwd-PE · 20. SEC filings · 21. AI call recap + sentiment + guidance · 22. Verbatim transcripts + keyword search + TTS · 23. Expected/implied move · 24. Beat history · 25. Analyst percentiles · 26. Live reaction / gap %

**D. Adjacent surfaces**
27. `/calendar/mystocks` hub (Earnings / News / Calls / Filings / Insights + read-unseen) · 28. `CalendarWidget` on `/charts` · 29. `CalendarEmbed` in the notebook (frozen-params contract) · 30. `/r/calendar` render page (**screenshot contract** — Substack + Sunday Scan) · 31. `/r/calendar-week.png` + the `#event-calendar` Discord post · 32. Zone D "On deck" signpost card · 33. iCal / webcal export (`/api/calendar/export.ics`) · 34. Pre-report alerts (`CALENDAR_ALERTS_ENABLED`)

**E. Cross-cutting**
35. Company logos (`/api/ticker-logo/{sym}`, ~99.5% coverage, monogram fallback) · 36. Free-tier deep-link redirect to `/research/:sym` · 37. Touch tier ≤1024px compliance (44px floor) · 38. The five persisted preference keys (§3.2) · 39. Enrichment batching (`/api/calendar/enrichment-batch`) + warm-on-boot · 40. Past-day backfill from Finnhub + the `_PAST_SESSION_CAP=150` vs live-40 asymmetry

⛔ **`/journal/calendar` is NOT on this list** — different feature, different data path (§4.3).

---

## 8. Cross-cutting recommendations

1. **Never rename a `calendar_*` preference key, a widget type id, or a notebook embed param.** Coexist with new names (`tnext_*`, type `terminal`). The read-fallback shim exists and works (§3.3), but each one is bespoke and a forgotten one is silent.
2. **If `/calendar` ever goes, it becomes a redirect** — `<Navigate to="…" replace />`, page un-imported, reason at the route, rail with a control. The template is `liveFlowRetired.route.test.jsx`; it is five assertions long.
3. **Ship any Terminal-Next route with its route-resolution rail in the same commit.** Three doors in this repo were built, tested, green, and connected to nothing (`lostDoors.route.test.jsx`). A component test cannot catch it.
4. **The one infrastructure gap worth closing is a per-user cohort** (§6.2), and `entitlements.py` is already written to receive it. Everything else the staged rollout needs already ships.
5. **Budget two passes for any display-name work**, and expect the *test suite*, not a grep, to find the last strings (`b958aefb4` → `7c8d89581`).
6. **Treat `App.jsx`, `api/main.py` and the nav trio as single-owner files** during parallel Terminal-Next development, and keep each feature's edit there to one line.
7. **`/r/calendar` is a visual contract**, not just a route. Any change to it should be validated against `morning-wire/substack/panelshot.py` and `uct-sunday-scan/sunday_scan/panels.py` before it ships.

---

## GAPS

- **Production flag state was not read.** Every "armed / dark" statement above is CLAIM. One read-only command closes it: `py tools/flag_ledger_audit.py` (or `railway variables --service web --kv`, names only). The contract did not authorize it and the preamble restricts it.
- **`docs/feature_flags.json` was sampled, not enumerated.** I read the `_readme`, the first ~15 entries, and grepped for calendar-related names (`CALENDAR_ALERTS_ENABLED`, `CALENDAR_WEEK_POST_ENABLED`, `SCAN_LIVE_SWEEP_ENABLED`, `PATTERN_VISION_ENABLED`). A full flag census belongs to D-10.
- **Journal 2.0's *original* beta introduction** (the "last sub-tab" era) is CLAIM from CLAUDE.md; I verified only the later `shellFlag.js` generation from source and commits.
- **`docs/plans/` and `docs/superpowers/plans/` were listed but not read.** `docs/plans/` holds nothing coexistence-shaped (newest is 2026-08-25); `docs/superpowers/plans/` was not enumerated and may contain a Journal 2.0 or calendar-rebuild plan with more staging detail.
- **Backend route enumeration was by grep on `include_router`, not by importing `api.main:app` and walking `app.routes`.** CLAUDE.md documents the latter as the reliable method (986 routes). My `/api/calendar/*` surface list is therefore a floor, not a census.
- **CSS-module/token touch points are asserted from convention**, not from a build. No CSS registry exists to enumerate.
- **No production behaviour was observed.** No health endpoint, no logs, no browser.

## NOT INSPECTED

- **Railway** — any service, variable, log or deployment. Out of bounds per the preamble.
- **The production pod and `/data`** — out of bounds.
- **The local backend on port 8077** — explicitly untrustworthy per the preamble.
- **`C:\Users\Patrick\uct-dashboard`** and every other worktree — stale/unrelated per the preamble.
- **Partner-owned files beyond noting their `/api/calendar` call sites** — `OptionsFlow.jsx:810`, `live_massive_router.py:3964`, `massive_ws_worker.py:1510` are recorded as inbound dependencies only, deliberately not described further.
- **The test suite was not run.** Named rails are identified by reading them; none was executed (the preamble forbids running the suite without contract authorization).
- **External surfaces that may carry `/calendar` links** — Discord message history, Substack post bodies, sent emails, YouTube descriptions. Not reachable from any repository; see §4.6.
- **`app/src/pages/Calendar.jsx` in full** (only the preference block, header and route wiring), and the ~50 files under `app/src/pages/calendar/` — that is D-09's map, not this contract's.
