---
id: D-01
title: Existing Front-End Archaeology — the dashboard SPA as it actually is
role: Existing Front-End Archaeologist
wave: 1
group: D
category: internal-system
scope: uct-dashboard `app/` (Vite + React 19 SPA), worktree `terminal-research` @ a4ef6f240
confidence: 🟢
evidence_ceiling: Static read only — no build, no test run, no browser. Bundle sizes, render-time behaviour, and which tests currently pass are NOT DETERMINED. Two structural claims (the reachability rail's verdict on `pages/Confluence.jsx`; stylelint's live warning count) would be settled by `npm run test`/`npm run lint:css`, which this contract did not authorise.
sources: app/package.json, app/vite.config.js, app/vite.config.parity-bands.mjs, app/eslint.config.js, app/.stylelintrc.json, app/index.html, app/src/App.jsx, app/src/main.jsx, app/src/components/AuthGuard.jsx, app/src/components/NavBar.jsx, app/src/components/Layout.jsx, app/src/components/mobile/, app/src/components/screener/reachable.test.js, app/src/widgets/registry.js, app/src/pages/charts/WidgetHost.jsx, app/src/pages/dashboard/doors.js, app/src/styles/, app/src/context/, app/src/hooks/, docs/brand-design-system.md, CLAUDE.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-01 — Existing Front-End Archaeology

**Vocabulary reminder.** TERMINAL-CURRENT = the surface at route `/calendar`, display-named "UCT Terminal". TERMINAL-NEXT = the product this program designs. This report inventories the front end that TERMINAL-NEXT must either inherit, reuse, or replace.

**Scale, measured 2026-09-02 (`find` + `wc` over `app/src`):**

| Measure | Count |
|---|---|
| `.js` / `.jsx` files under `app/src` | 2,068 |
| …of which `*.test.js(x)` | 959 |
| Non-test JS/JSX lines | 285,485 |
| Test JS/JSX lines | 196,063 |
| CSS files | 386 (378 `*.module.css` + 8 plain) |
| CSS lines | 87,068 |
| `TODO` / `FIXME` / `HACK` / `XXX` in non-test source | **3** |

That last row is the headline of §11: this codebase does not carry its debt in TODO comments. It carries it in *long explanatory block comments beside guard rails*, and in an explicit allow-list of things that are deliberately unwired. Read those, not a grep for TODO.

---

## 1 · Tooling

### OBSERVATION
`app/` is a Vite 7 + React 19 SPA. No TypeScript (`@types/react` is present as a devDep for editor IntelliSense only; there is not a single `.ts`/`.tsx` file). No Next.js, no SSR.

**Scripts** (`app/package.json:6-14`) — seven, not the five in the contract's KNOWN FACTS:

| Script | Command |
|---|---|
| `dev` | `vite` |
| `build` | `vite build && node scripts/build-cot-facts.mjs && node scripts/build-flow-facts.mjs` |
| `lint` | `eslint .` |
| `lint:css` | `stylelint "src/**/*.css"` |
| `preview` | `vite preview` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |

The two extra `build` steps are **not** front-end bundling. `app/scripts/build-cot-facts.mjs` emits `app/dist/cot-facts.cjs` and `build-flow-facts.mjs` emits `app/dist/flow-facts.cjs`; the FastAPI backend shells out to those Node bundles (`api/services/cot_prewarm.py`, `api/services/flow_aggregate.py`) so the server runs the *browser's* analytics rather than a Python port of them. Entry points `pages/cot/cotFactsEntry.js` and `pages/optionsFlow/flowFactsEntry.js` are recorded in the reachability allow-list precisely because a walk from `App.jsx` cannot see a build-script entry.

**Dependencies: 44 runtime / 16 dev** — the contract's KNOWN FACTS are exact. Grouped by actual use site:

| Group | Packages | Where used |
|---|---|---|
| Framework | `react` 19.2, `react-dom`, `react-router-dom` 7.13 | everywhere; `App.jsx` |
| Server state | `swr` ^2.4 | **169 non-test modules** import from `'swr'` |
| Charting (4 libs) | `lightweight-charts` 5.2.0 (pinned), `echarts` + `echarts-for-react`, `chart.js` + `react-chartjs-2`, `recharts` | see §8 |
| Layout / DnD | `react-grid-layout` ^1.5.3, `@dnd-kit/{core,sortable,utilities}` | `/charts` workspace; `@dnd-kit` in **exactly one file** |
| Virtualisation | `@tanstack/react-virtual` ^3.13 | 4 call sites (§7) |
| Keyboard | `react-hotkeys-hook` ^5.2.4 | **5 files, all Journal 2.0** (§9) |
| Rich text | `@tiptap/*` (9 packages) | Journal Notebook, Community composer, ModelBook |
| Code editor | `@codemirror/*` (6 packages) + `@lezer/highlight` | the formula/indicator builder (`components/chart/builder/editor/CodeEditor.jsx`) |
| Formula parsing | `jsep` 1.4.0 (pinned) | the AST engine (§11) |
| Voice / wake word | `@picovoice/porcupine-web`, `@picovoice/web-voice-processor` | `components/voice/`, lazily loaded, paid-gated |
| Discord | `@discord/embedded-app-sdk` | `pages/DiscordActivity.jsx` (the `/r/activity` route) |
| Import/export | `papaparse`, `mammoth` (.docx), `markdown-it` + `markdown-it-task-lists`, `fflate`, `spark-md5` | Notebook importer, CSV export |
| Capture | `modern-screenshot` | chart capture (`utils/chartCapture.js`) |
| Misc UI | `tippy.js` | tooltips |

**Vite config** (`app/vite.config.js`, 13.2 KB — most of it load-bearing comment). Three custom plugins:

1. `comingSoonMeta()` — a `transformIndexHtml` hook that, when `VITE_COMING_SOON=1`, rewrites `<title>`, description, all OG/Twitter tags **and the JSON-LD block** at build time, because crawlers read served HTML and never run JS. It swaps the OG image to a *different filename* (`og-coming-soon.png?v=…`) rather than replacing `og-image.png`, since social platforms cache preview images by full URL. The shipped `index.html:37` title is the launch title — *"UCT Intelligence — 10 subscriptions in 1. The complete trading desk."* — and the "Coming soon" title the contract quotes is produced only by this build-time swap.
2. `stripManifestProse()` — `apply: 'build'` only. Strips 68 KB of English rulings out of `components/chart/engine/ast/closedTable.json` (169 KB) before it reaches the browser, leaving the file on disk untouched because the Python lane reads the same file. The keep-list lives in one place (`manifestProse.js::KEEP`) and a test walks both lanes for property *access*.
3. `vite.config.parity-bands.mjs` (separate config, self-described **THROWAWAY**) — Side A of a "Flip-C" visual parity gate: rebuilds the tree with `PANE_MODE = 'bands'` substituted at *transform* time rather than by editing source, because `core.autocrlf=true` makes "restored byte-for-byte" unprovable after a temporary edit. It asserts the substitution applied *exactly once* and errors if the needle is stale — a silent no-op would build side A as a copy of side B and report zero changed pixels as a pass.

**Chunking** (`vite.config.js` `build.rollupOptions.output.manualChunks`) is the **object form**, deliberately, with a long comment explaining that the function form silently dumps React-dependent libraries into `vendor-misc` and crashes at runtime. Five named chunks: `vendor-react` (which lists *every* React entry point — `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client`, `scheduler`, `react-router-dom`), `vendor-swr`, `vendor-charts` (lightweight-charts), `vendor-echarts`. `recharts` and `@tiptap` are **deliberately unlisted**: naming them would force a chunk into existence that Rollup then uses to host shared modules, which is measured (2026-08-09) to have put 231 KB gz of rich-text editor + a second chart library on the **login screen**. `chunkSizeWarningLimit: 4000`.

**No path aliases.** Every import is relative (`../../components/...`). The reachability rail resolves `@/` and `/src/` forms defensively, but nothing in source uses them.

**ESLint** (`app/eslint.config.js`, 787 bytes) is minimal: flat config, `js.configs.recommended` + `react-hooks` flat recommended + `react-refresh/vite`, one custom rule (`no-unused-vars` with `varsIgnorePattern: '^[A-Z_]'`). `ecmaVersion: 2020` in `languageOptions` but `'latest'` in `parserOptions` — harmless but inconsistent. **There is no import/order, no a11y plugin, no complexity ceiling, no max-lines.** Nothing in ESLint constrains file size, and §11 shows the result.

**Stylelint** (`app/.stylelintrc.json`) is a *single rule*: `declaration-property-value-allowed-list` forcing `color:` to be `var(--…)`, a near-black hex, or a CSS keyword. Severity is `"warning"`, not error, and the config's own `//` note says the remaining flags are deliberate light-theme overrides and that tightening to error is a follow-up. `ignoreFiles`: `tokens.css`, `OptionsFlow*.css`, `DarkPool*.css`, `components/intro/**`. **Nothing lints `background`, `font-family`, spacing, or breakpoints** — see §6 and §10.

**Vitest config** lives inside `vite.config.js` under `test:` and is unusually well-instrumented, every value with a measurement beside it:
- `environment: 'jsdom'`, `globals: true`, `pool: 'forks'`, `setupFiles: './src/test-setup.js'`
- `execArgv: ['--max-old-space-size=8192']` — must stay top-level; it lived under `poolOptions.forks.execArgv` until 2026-08-01 and Vitest 4 removed `poolOptions`, so the flag silently reached no worker.
- `maxWorkers: '50%'` — with a measured table showing cumulative test time *triples* from 25% to the default 23 forks while wall time barely moves.
- `testTimeout: 15000` — with the finding that 115 tests exceed 2,000 ms on a clean run and 73 exceed 3,333 ms, so a 2× cache-cold slowdown tips a systemic margin, not one test.
- `server.deps.inline` + `alias` redirect `@picovoice/porcupine-web` to `src/test-stubs/porcupine-web.js` (the only file in `test-stubs/`) because the real package's exports don't resolve under Vitest.

**`src/test-setup.js`** (10.6 KB) raises Testing Library's `asyncUtilTimeout` to **4000 ms** — separate from `testTimeout` and not raised by it — with a comment recording three consecutive reproductions that each killed a *different* unrelated test, concluding "a population, not a defect". It also purges SWR's module-global cache *and* its dedupe markers before each test, and shims jsdom's missing `matchMedia`.

**`src/test-utils.jsx`** (968 bytes) exports one helper, `renderWithProviders(ui, {route})`, wrapping `MemoryRouter` + `AuthProvider` + `VoiceProvider`, and re-exports all of `@testing-library/react`.

### EVIDENCE
`app/package.json`; `app/vite.config.js`; `app/vite.config.parity-bands.mjs`; `app/eslint.config.js`; `app/.stylelintrc.json`; `app/src/test-setup.js`; `app/src/test-utils.jsx`; `app/index.html:37`. All **CONFIRMED** by direct read.

### INTERPRETATION
The build is a *hand-tuned* Vite config, not a template. Three separate mechanisms exist purely to stop a silent no-op from reading as a pass (the parity needle assertion, the manifest-prose keep-list test, the `execArgv` placement note). That is a mature culture. What is *absent* is equally telling: no TypeScript, no path aliases, no lint rule that constrains structure, and a stylelint config that governs exactly one CSS property at warning severity.

### RELEVANCE TO UCT
TERMINAL-NEXT inherits a build system that is already good at bundling and already knows how to keep a route-only library off the login screen. It does **not** inherit any structural enforcement: nothing today would stop TERMINAL-NEXT's first page from becoming another 9,000-line file. If Terminal-Next wants a component contract, the enforcement has to be added, and this repo's own idiom (a rail that can fail, with a control proving it can) is the shape to copy.

### CONFIDENCE
🟢 high. **EVIDENCE CEILING:** I did not run `npm run build`, so actual chunk names/sizes and whether `manualChunks` still behaves as commented are NOT DETERMINED. A `vite build` plus the module→chunk dump the config itself recommends would confirm.

### RECOMMENDATION
Consider TypeScript for TERMINAL-NEXT's new surfaces specifically (not a migration of 285 KLOC), and consider adding `eslint-plugin-jsx-a11y` and a `max-lines` warning — both are cheap and both address gaps this codebase demonstrably has.

### OPEN QUESTION
Is the absence of TypeScript a deliberate owner call or accumulated inertia? Nothing in `CLAUDE.md` or the configs states a reason.

---

## 2 · Routing

### OBSERVATION

`app/src/App.jsx` is **760 lines / 36.3 KB** and holds the entire route table plus five inline gate components. `main.jsx` (1.2 KB) does nothing but `createRoot` + `<StrictMode>` + a service-worker *kill switch* (the SW was removed because cache-first made bundle updates invisible; `/sw.js` is now fetched only to make an old registration self-uninstall).

**`src/routes/` contains no routing code** — only two rails: `lostDoors.route.test.jsx` (12.8 KB) and `liveFlowRetired.route.test.jsx`. Both render the real `App` at real hrefs and assert none lands on the 404 page.

**The `lazyPage` / door-prefix registry** (`App.jsx:39-57`, `120-137`). `lazyPage(path, importer)` records the importer in a module-level `Map` *and* returns `lazy(importer)` — one importer serving both, so the prefetch can never resolve a different module than `lazy()` does. At module scope (before React mounts) it reads `window.location.pathname` and picks the **longest registered prefix** (`here === key || here.startsWith(key + '/')`, `key.length > best.length`), then fires that importer. The stated reason, measured on prod 2026-08-29: `AuthGuard` holds every protected route at a splash until `/api/auth/me` *and* `/api/maintenance` answer, so a ~1.2 s auth round-trip sat strictly in front of a multi-hundred-KB page chunk (auth/me 665→1879 ms; page chunks not requested until 1891 ms). It is explicitly a best-effort accelerator, not a gate — a page left on plain `lazy()` simply keeps the old behaviour.

**20 registered prefixes:** `/dashboard /morning-wire /research /uct-20 /breadth /calendar /calendar/mystocks /screener /ai-search /options-flow /flow-scoreboard /live-massive /traders /dark-pool /post-market /model-book /setup-library /desk /desk/article /charts`. The `/calendar` vs `/calendar/mystocks` pair is the case the longest-prefix rule exists for.

**Route table.** `auth` column: `public` = outside `AuthGuard`; `token` = outside AuthGuard, the share token is the credential; `paid` = inside AuthGuard and gated by `isPaid`; `free` = in `FREE_PAGES`; `admin` = `role === 'admin'`.

| Path | Element | Auth | Chunk |
|---|---|---|---|
| `/` | `DiscordActivity` if Discord launch, else `PublicOnly` → `ComingSoon` (or `Landing` when `VITE_COMING_SOON` off) | public | lazy |
| `/landing` | `PreLaunchGate` → `Landing` | public | lazy |
| `/login` | `PublicOnly` → `Login` | public | lazy |
| `/signup`, `/subscribe` | `PreLaunchGate` → `Signup` / `Subscribe` | public | lazy |
| `/forgot-password` | `PublicOnly` → `ForgotPassword` | public | lazy |
| `/reset-password`, `/verify-email`, `/verify-pending` | ungated (mid-flow members) | public | lazy |
| `/terms`, `/privacy`, `/methodology` | ungated | public | lazy |
| `/compare`, `/brokers`, `/pricing` | `PreLaunchGate` | public | lazy |
| `SHARED_SCREEN_ROUTE` | `SharedScreen` | token | lazy |
| `SHARED_NOTE_ROUTE` | `SharedNotePage` | token (+ server `J2_SHARE_LINKS_ENABLED`) | lazy |
| `TRACK_RECORD_ROUTE` | `TrackRecordPage` | token (+ server `J2_TRACK_RECORD_ENABLED`) | lazy |
| `SHARED_FORMULA_ROUTE` | `SharedFormula` | token, but server pair is `require_paid` | lazy |
| `/r/chart` | `ChartRender` | public (token param) | lazy |
| `/r/activity` | `DiscordActivity` | public | lazy |
| `/r/{catalysts,calendar,internals,tweets,flow,breadth,themes,book,econ,earncards,earnresults,movers,buzz}` | 13 `*Render` pages | public | lazy |
| `/alert-tester` | `AlertTester` — **outside `<Layout/>`** | admin | lazy |
| `/dashboard` | `Dashboard` | paid | lazyPage |
| `/morning-wire` | `MorningWire` | **free (the only free page)** | lazyPage |
| `/uct-20` | `UCT20` | paid | lazyPage |
| `/breadth` | `Breadth` | paid | lazyPage |
| `/charts` | `ChartsWorkspace` | paid | lazyPage |
| `/theme-tracker`, `/watchlists`, `/multi-chart` | `LegacyRedirect` → `/charts` | paid | lazy |
| `/research/:sym` | `ResearchPage` — **let through, renders its own paywall teaser** | paid-ish | lazyPage |
| **`/calendar`** | **`Calendar`** (TERMINAL-CURRENT) | **paid**, with a §13 free-tier deep-link carve-out | lazyPage |
| **`/calendar/mystocks`** | **`MyStocksHub`** | paid | lazyPage |
| `/screener` | `Screener` | paid | lazyPage |
| `/formulas/reference` | `FormulaReference` | paid | lazy |
| `FORMULA_LIBRARY_PATH` | `FormulaLibrary` | paid (ruling: stays behind paywall) | lazy |
| `/ai-search` | `AiSearchPage` | paid | lazyPage |
| `/options-flow` | `OptionsFlowRoute` (forwards `?view=scoreboard`) | paid | lazyPage |
| `/live-flow` | `<Navigate to="/live-massive">` | paid | — |
| `/live-massive` | `LiveFlowMassive` | paid | lazyPage |
| `/flow-scoreboard` | `FlowScoreboard` | paid | lazyPage |
| `/traders` | `Traders` | paid | lazyPage |
| `/dark-pool` | `DarkPool` | paid | lazyPage |
| `/post-market` | `PostMarket` | paid | lazyPage |
| `/model-book` | `ModelBook` | paid | lazyPage |
| `/setup-library` | `SetupLibrary` | paid | lazyPage |
| `/desk` | `Desk` | paid | lazyPage |
| `/desk/article/:slug` | `ArticleReader` | paid | lazyPage |
| `/educational-videos` | `<Navigate to="/desk?section=videos">` | paid | — |
| `/journal` + 9 children | `JournalShellSelector` → `JournalLayout` (v5, has `<Outlet/>`) or `JournalTwoRoot` (v8, no Outlet) | paid | lazy ×11 |
| `/community`, `/community/:threadId` | `Community` | paid | lazy |
| `/journal-2-0/{calendar/:date, report, position/:sym, trade/:id}` | 4 detail pages | paid | lazy |
| `/support`, `/settings` | `Support`, `Settings` (`/settings` is paid-gated) | paid | lazy |
| `/catalysts/history` | `CatalystsHistory` | paid | lazy |
| `/admin`, `/admin/{chart-health,patterns,pattern-review,landing-analytics}` | 5 pages | admin | lazy |
| `*` | `NotFound` | — | lazy |

**`AuthGuard`** (`components/AuthGuard.jsx`, 187 lines) is an `<Outlet/>` guard doing seven things in order: (1) a `/api/maintenance` fetch on mount, blocking non-admins behind an inline `MaintenancePage`; (2) a one-shot 4 s/10 s auto-retry pair when `/api/auth/me` failed *transiently* — "a blip must never log anyone out"; (3) `!user` → `/login`; (4) unverified email (non-admin) → `/verify-pending`; (5) admin-only prefix check covering `/admin*` **and** `/alert-tester`; (6) `/settings` requires `isPaid`; (7) the §13 carve-out: `/calendar?earnings=NVDA` for a non-paid user redirects to `/research/NVDA` (the paywall teaser) instead of silently dropping the param — reusing the calendar's own `normalizeSym` rather than a second regex.

**⛔ `FREE_PAGES = ['/morning-wire']` — and it is hand-copied into three files.** `AuthGuard.jsx:110`, `NavBar.jsx:39`, `MoreSheet.jsx:70`, each with a comment saying "Keep in sync with FREE_PAGES in …". `CLAUDE.md`'s "Auth & User System" section still claims *"Free tier: Dashboard, Breadth, Charts, Options Flow, Journal, Model Book accessible without payment"* — that is **false** at this commit; only `/morning-wire` is free (owner decision 2026-07-19, recorded in the `AuthGuard` comment).

**The `/r/*` render routes are consumed server-side, not by members.** `api/routers/render_panels.py` serves their data endpoints (`/r/catalysts`, `/r/buzz`, `/r/flow`, `/r/book`, `/r/econ`, `/r/themes`, `/r/tweets`, `/r/chart-settings`, `/r/breadth`, `/r/calendar-week.png`, `/r/earnings-history`, `/r/breadth-monitor`), and `api/services/discord_chart_house.py:259` builds `…/r/chart?…` URLs for the Discord `/chart` command; `api/services/buzz_image.py:190` builds `…/r/buzz?token=…`. They are headless screenshot targets for the Morning Wire → Substack pipeline and Discord. They render **logged out** and are excluded from the intro animation by an explicit path list in `App.jsx`.

**Redirects and 404.** Four `<Navigate>` redirects (`/live-flow`, `/educational-videos`, and the §13/`FREE_HOME` bounces), three `LegacyRedirect` routes (which strip `?tab=` but preserve other query params), and a `*` catch-all to `NotFound`. `RouteErrorBoundary` wraps the whole `<Routes>`; `StalledLoadFallback` is the Suspense fallback and shows a recovery panel after ~20 s because `React.lazy` caches its promise and only a document reload can retry a chunk that never settles.

### EVIDENCE
`app/src/App.jsx:39-57` (lazyPage), `:120-137` (longest-prefix prefetch), `:277-556` (route table); `app/src/components/AuthGuard.jsx:110` (`FREE_PAGES`), `:139-146` (§13); `app/src/components/NavBar.jsx:39`; `app/src/components/mobile/MoreSheet.jsx:70`; `api/routers/render_panels.py:81-506`; `api/services/discord_chart_house.py:259`. All **CONFIRMED** by direct read. The `AuthGuard` behaviour in production is a **CLAIM** from source — I did not observe a live redirect.

### INTERPRETATION
The route table is flat, explicit, and heavily annotated with *restoration archaeology*: at least five routes carry comments recording that they were silently deleted by an unexplained web-UI commit and later restored (`/alert-tester`, `/flow-scoreboard`, `/traders`), and four share-link routes derive their path from a module the copy-link button also imports — one authority per value. This is a codebase that has been burned by hand-typed paths and has built rails against it.

Three architectural facts matter most for TERMINAL-NEXT:
1. **Auth is a render-time gate on a client-side route table.** Every protected page waits on two round-trips before its chunk is even requested; the `lazyPage` prefetch is a workaround for that ordering, not a fix.
2. **`/calendar` is registered as an ordinary paid route with one carve-out.** Nothing about its registration is special. Renaming it would be a one-line route change *and* a persisted-preference migration (D-11's territory) — the plumbing key `calendar` appears in the nav (`NavBar.jsx`), the Zone D door registry (`pages/dashboard/doors.js`), and the widget registry.
3. **The `/r/*` family is a second, headless product surface** already in production, running the same React components logged out for server-side image generation.

### RELEVANCE TO UCT
If TERMINAL-NEXT is a new route inside this SPA, it inherits `AuthGuard`'s two-fetch preamble and must register in `lazyPage` to get chunk prefetch. If it is a new shell, the `/r/*` precedent shows the components are already separable from the app chrome — that is a real, proven reuse path for embedding Terminal-Next panels in Discord/Substack output. The triplicated `FREE_PAGES` is the kind of defect Terminal-Next should not reproduce: derive it once and import it three times.

### CONFIDENCE
🟢 high for the route table and gate logic (read directly). 🟡 for "who consumes `/r/*`" — the backend references are CONFIRMED as code, but whether every one of the 14 render routes is *called* in the last 30 days is NOT DETERMINED (that is log evidence I was not authorised to gather).

### RECOMMENDATION
Derive `FREE_PAGES` from one module. And treat the `lazyPage` prefix registry as the pattern for any Terminal-Next sub-routing: it already handles the nested-path case correctly and fails safe by omission.

### OPEN QUESTION
Is TERMINAL-NEXT expected to live inside this `App.jsx` route table, or as a separate shell? The answer changes whether `AuthGuard`'s serialised auth→chunk ordering is inherited or escaped.

---

## 3 · Pages inventory

### OBSERVATION

`src/pages/` holds **60 top-level `.jsx` page files** (non-test) plus 19 subfolders totalling ~590 non-test modules. Distribution:

| Subfolder | Non-test modules | What it is |
|---|---|---|
| `journal-2-0/` | 267 | Journal 2.0 — by far the largest single feature area |
| `charts/` | 100 | the `/charts` workspace (D-06 owns judgment) |
| `breadth/` | 65 | Breadth views, grouping, treemap |
| `screener/` | 26 | scanner shell + virtualized grid |
| `calendar/` | 25 | TERMINAL-CURRENT internals (D-09 owns) |
| `research/` | 19 | `/research/:sym` ticker research page |
| `community/` | 15 | The Floor |
| `desk/` | 15 | The Desk (videos/articles/courses) |
| `cot/` | 13 | COT positioning rail + pure-JS analytics |
| `modelbook/` | 10 | Setup Library views |
| `optionsFlow/` | 8 | flow compute + facts entry |
| `admin/` | 5 | 4 admin pages + helper |
| `dashboard/` | 5 | the four-zone cockpit (§5) |
| `formulas/` | 5 | formula library/reference/share |
| `watchlist/` | 4 | watchlist helpers |
| `theme-tracker/` | 2 | theme helpers |
| `education/` | 1 | — |
| `parityBars/` | 0 (2 JSON fixtures + 1 test) | chart-parity fixtures |

**Top-level pages, by status.** Every one of the 60 files, with its route and status:

*Active, routed (44):* `Admin` `/admin` · `AiSearchPage` `/ai-search` · `AlertTester` `/alert-tester` (admin, outside Layout) · `Breadth` `/breadth` · `BrokersPage` `/brokers` · `Calendar` `/calendar` **(TERMINAL-CURRENT)** · `CatalystsHistory` `/catalysts/history` · `ChartRender` `/r/chart` · `ComingSoon` `/` (pre-launch) · `Compare` `/compare` · `DarkPool` `/dark-pool` · `Dashboard` `/dashboard` · `DiscordActivity` `/r/activity` + `/` under Discord launch · `FlowScoreboard` `/flow-scoreboard` · `ForgotPassword` · `Landing` `/landing` · `LiveFlowMassive` `/live-massive` · `Login` · `Methodology` · `ModelBook` `/model-book` · `MorningWire` `/morning-wire` (the only free page) · `NotFound` `*` · `OptionsFlow` `/options-flow` **(partner-owned)** · `PostMarket` `/post-market` · `Pricing` · `Privacy` · `ResetPassword` · `Screener` `/screener` · `Settings` `/settings` · `SetupLibrary` `/setup-library` · `Signup` · `Subscribe` · `Support` `/support` · `Terms` · `Traders` `/traders` (restored 2026-08-09; door is the voice assistant, not the sidebar) · `UCT20` `/uct-20` · `VerifyEmail` · `VerifyPending` — plus the 13 `*Render` pages (`BookRender` `BreadthRender` `BuzzRender` `CalendarRender` `CatalystsRender` `EarnCardsRender` `EarnResultsRender` `EconRender` `FlowRender` `InternalsRender` `MoversRender` `ThemesRender` `TweetsRender`) on `/r/*`.

*Active, mounted but not routed (3):* `CotData.jsx` and `BreadthCharts.jsx` are imported directly by `Breadth.jsx` as tabs (there is no `/screener/cot` route). `ThemeTrackerPage.jsx` and `Watchlists.jsx` are lazily imported in `App.jsx` but their routes are `LegacyRedirect`s — they now render **inside `/charts` widgets** (`ThemesWidget.jsx`, `WatchlistWidget.jsx`, `EtfHoldingsResults.jsx`, `PeriodSortResults.jsx`, `ScannerResults.jsx`) via an `embedded` prop.

*Dark / unreachable (6):*

| File | Status | Recorded? |
|---|---|---|
| `pages/LiveFlow.jsx` (2,371 lines) | **Dead rail.** The Bullflow page; Bullflow retired 2026-07-27. `/live-flow` now redirects to `/live-massive`. Kept as a flow-family unit with the partner's `liveflow_worker*.py`. | ✅ in allow-list |
| `pages/LiveFlow_admin.jsx` | Partner-owned, zero importers, awaiting ack | ✅ |
| `pages/OptionsFlow_admin.jsx` (9,972 lines — **the second-largest file in the repo**) | Partner-owned, zero importers, awaiting ack | ✅ |
| `pages/EducationalVideos.jsx` | A 4-line re-export shim over the live `pages/desk/VideosSection`; its test carries 4 admin-gating assertions with no counterpart in VideosSection's own tests | ✅ |
| `src/LiveFlow_integration_guide.jsx` + `src/useFlowWebSocket.js` | Partner-owned pair; the hook is reachable only from the guide, so they move together or not at all | ✅ |
| **`pages/Confluence.jsx`** | **A complete, working page — "Confluence Radar", ~90 lines of filters + `TickerPopup` chips — reading a live backend `GET /api/confluence`, with ZERO importers, NO route, and NO allow-list entry.** | ❌ **not recorded** |

**The `Confluence` finding.** `pages/Confluence.jsx` imports `hooks/useConfluence.js`, which polls `/api/confluence` every 120 s. `hooks/pollingSites.rail.test.js:239-263` records that `useConfluence.js` "arrived with the Confluence Radar board (`4849ddc2a`) and turned this rail red in the FULL suite". So the *hook* was noticed and recorded; the *page* was not. The page reaches no route, no widget registry entry (`grep -i confluence` over `widgets/registry.js` and `pages/charts/` returns nothing), and no import. This is a fully-built product surface a member cannot reach — the exact class `CLAUDE.md`'s "⚰️ DOCUMENTED BUT UNREACHABLE" section exists to prevent.

**Parallel-rebuild pairs.**

1. **`LiveFlow.jsx` vs `LiveFlowMassive.jsx`** — resolved. Different data rails (Bullflow SSE vs Massive OPRA WS→FlowDB); `LiveFlowMassive` (4,911 lines) is canonical and routed; `LiveFlow` is unrouted rollback backup. Not a duplicate to merge — a retirement in progress.
2. **`OptionsFlow.jsx` (9,263) vs `OptionsFlow_admin.jsx` (9,972)** — both partner-owned, the admin variant unrouted. ~19,000 lines of the repo's 285,000 sit in this pair.
3. **Journal shells: `JournalLayout.jsx` (v5) vs `JournalTwoRoot.jsx` (v8)** — a *live* dual shell behind `shellFlag.js` (`J2_SHELL_ROLLOUT_PCT = 100`, per-browser localStorage override `uct.j2.shell`, DevTools handle `window.__uctJ2Shell('v8')`). The duplication is not the two shells; it is `journal-2-0/surfaces/` (9 v5 surfaces) sitting beside `journal-2-0/tabs/` (8 v8 tabs) covering the same ground. v8 has no `<Outlet/>`, so the nine nested `/journal/*` routes are unreachable under it by design.
4. **`components/EmptyState.jsx` vs `components/research-kit/EmptyState.jsx`** — two components of the same name; the first is allow-listed as orphaned-by-master (its last importer was the deleted `pages/Patterns.jsx`) and kept as a "branded primitive"; the second is live inside research-kit.
5. **`ComingSoon.jsx` vs `Landing.jsx`** — deliberate: `Landing` stays mounted at `/landing` and returns to `/` when `VITE_COMING_SOON` is unset. One env change, no code revert.

**Journal 1.0 is gone from the front end.** `CLAUDE.md` documents `app/src/pages/journal/Journal.jsx` with 7 tabs, `TradeDrawer.jsx`, `OverviewTab.jsx`, etc. **There is no `pages/journal/` directory.** Only `pages/journal-2-0/` exists. Every "Trade Journal — Elite Review System" file path in `CLAUDE.md` is stale.

### EVIDENCE
`ls`/`find` over `app/src/pages/`; `app/src/pages/Confluence.jsx:1-25`; `app/src/hooks/useConfluence.js:5-12`; `app/src/hooks/pollingSites.rail.test.js:239-263`; `app/src/components/screener/reachable.test.js:290-430` (the 24-entry allow-list); `app/src/pages/journal-2-0/shellFlag.js:20`; `app/src/App.jsx:481-529`. **CONFIRMED** by direct read. That the reachability rail *would currently fail* on `Confluence.jsx` is a **CLAIM** — I did not run the suite.

### INTERPRETATION
The page tree is healthy at the edges and heavy in the middle. Six of 60 top-level pages are dark, and five of those six are *deliberately* dark with a recorded reason and a named owner. The sixth is an accident of exactly the kind this repo has built machinery to catch — which suggests the machinery ran before the page landed, not that it failed.

The real structural fact is the weight distribution: Journal 2.0 (267 modules), the charts workspace (100), and the two partner Options Flow files (~19 KLOC) are three-quarters of the surface area. TERMINAL-NEXT will be competing with those for engineering attention, not with the small pages.

### RELEVANCE TO UCT
The `embedded`-prop pattern — `ThemeTrackerPage`, `Watchlists` and `Screener` each render either as a standalone page or inside a `/charts` widget from the *same file*, gated by one boolean — is the single most reusable idea in the page tree for a Terminal-Next that wants panels and pages to be the same code. It works today, in production, for five widgets.

### CONFIDENCE
🟢 for the inventory; 🟡 for the `Confluence.jsx` verdict (its dead-ness is 🟢 CONFIRMED; whether the rail is currently red is 🔴 and would be settled by `cd app && npx vitest run src/components/screener/reachable.test.js`).

### RECOMMENDATION
Decide `Confluence.jsx` deliberately — route it, widget it, or delete it with `useConfluence.js` and the `/api/confluence` endpoint. Leaving it is how the next engineer learns that an orphan is the idiom.

### OPEN QUESTION
Was Confluence Radar intended as a Terminal-Next surface rather than a dashboard page? Its shape (cap-band grouping, BULL/BEAR filter, BUILDING/STEADY/ESTABLISHED status) reads like a scanner panel, not a page.

---

## 4 · State and data fetching

### OBSERVATION

**There is no state-management library.** No Redux, no Zustand, no Jotai, no MobX, no `@tanstack/react-query` — `grep` over all of `app/src` returns zero hits for every one. Server state is **SWR** (`swr` ^2.4, imported by 169 non-test modules). Client state is `useState`/`useReducer` in components plus two React contexts and a handful of module-level stores.

**Global SWR defaults** (`App.jsx:216-223`, a `<SWRConfig>` wrapping the whole tree):
```
revalidateOnFocus: false
revalidateOnReconnect: false
dedupingInterval: 8000
focusThrottleInterval: 10000
errorRetryCount: 3
```
The comment records why: library defaults caused a refetch storm on every navigation and focus regain (the "switching tabs is slow" symptom); live data stays fresh through each hook's own `refreshInterval`, which these defaults don't touch.

**Fetch wrappers.** There is no single fetch client. Three patterns coexist:
- `utils/jsonFetcher.js` — the *intended* one. It **throws** on any non-2xx with `err.status` attached, and its 37-line docstring is the best single artefact in the repo for understanding the codebase's failure philosophy: a 402 returns valid JSON (`{"detail": …}`), so the naive `r => r.json()` fetcher makes a paywalled page render as an *empty* one, and `(data || []).map(...)` "looks like the fix and is the worse bug". Throwing is what makes SWR populate `error` so the surface can say "you need a plan" instead of "you have nothing".
- Per-hook inline fetchers — the dominant pattern by count. E.g. `usePreferences.js:5` `url => fetch(url).then(r => r.ok ? r.json() : {})`, `useTapeFeed.js:3` `… : [])`, `NavBar.jsx:11` `… : null`. Each picks its own failure fallback.
- `useMobileSWR(key, fetcher, options)` (`hooks/useMobileSWR.js`) — an SWR wrapper that (a) **doubles** `refreshInterval` on touch devices, (b) **×10s** it when `marketHoursOnly` is set and the market is fully closed, and (c) sets `refreshInterval: 0` when `document.visibilityState !== 'visible'`. It is the polling-cost governor, and `hooks/pollingSites.rail.test.js` is a rail listing every bare-SWR polling site that has *not* taken it, each with a written reason.

**Contexts — there are exactly two providers, both mounted at the root** (`App.jsx:276-280`):

| Context | File | Carries |
|---|---|---|
| `AuthContext` | `context/AuthContext.jsx` (7.9 KB) | `{user, plan, isPaid, subscription, trial, annualAvailable, loading, authTransient, login, verifyTotp, signup, logout, startCheckout, openPortal, refetch, retryAuth}`. `isPaid` (line 171) is the single source of truth: `role === 'admin' \|\| plan ∈ {pro,premium,lifetime} \|\| trial.active`, mirroring the backend's `is_paid_or_trial()`. It uses raw `fetch` + `useState`, **not** SWR. `useIsPaid()` is a safe variant that defaults `true` with no provider (test-only path; the backend 402 is the authoritative gate). |
| `VoiceContext` | `context/VoiceContext.jsx` (16.4 KB) | `useReducer`-based voice/realtime session state; also exports two *module-level* functions `setVoicePageHint` / `getVoicePageHint` that live outside React entirely. |

Four narrower contexts exist below the root: `MoreSheetContext` (mobile menu opener, provided in `Layout.jsx`), `TickerHubContext` (also in `Layout.jsx`), `WorkspaceContext` + `ChartsSymContext` (both `/charts`-scoped), and `J2PriceProvider` (Journal-scoped).

**Preferences reach components through `usePreferences`** (`hooks/usePreferences.js`), an SWR-backed read of `/api/auth/preferences` with server-side TEXT storage and a **module-level per-key write queue**. That queue is worth naming: sixteen grid cells call `usePreferences()` sixteen times, so a per-hook ref would serialise nothing; and two in-flight POSTs can arrive in either order, with the server keeping whichever *arrives* last — so one request per key at a time makes arrival order equal merge order. Failed writes are neutralised in the chain so one flaky POST cannot silently stop all later saves. `chart_settings` gets a bespoke deep merge (`mergeSettingsOverride`, imported not reimplemented).

**Polling vs push.** 89 hooks in `hooks/`. Polling dominates (SWR `refreshInterval`). Push is three separate, deliberately byte-separate pools, all in `src/lib/`:
- `priceStreamManager.js` (11 KB) — one browser-wide SSE pool for live prices, ticker-union'd, ≤50/bucket, 400 ms debounced reconnect. Kill switch `localStorage['uct.ssePool.disabled']`.
- `barsStreamManager.js` (15 KB) — a *separate* pool for the Massive bars push feed, so a bug in bars can never break live prices. Kill switch `uct.barsPool.disabled`.
- `chatStreamManager.js` (18 KB) — streaming chat.
- `useFlowWebSocket.js` (src root, 3.3 KB) — the only true WebSocket client; **unreachable** (its sole importer is the partner's integration guide). D-05 owns real-time.

Two module-level (non-React) stores: `hooks/livePriceStore.js` and `lib/chartReadoutStore.js`.

### EVIDENCE
`grep` for `zustand|redux|react-query|@tanstack/react-query` over `app/src` → 0 hits (**CONFIRMED**). `app/src/App.jsx:216-223`; `app/src/utils/jsonFetcher.js`; `app/src/hooks/useMobileSWR.js`; `app/src/hooks/usePreferences.js:30-60`; `app/src/context/AuthContext.jsx:171-180`; `app/src/lib/{priceStreamManager,barsStreamManager,chatStreamManager}.js`. All **CONFIRMED** by direct read.

### INTERPRETATION
SWR-only is a coherent choice for a read-heavy market dashboard, and the two governors around it (`SWRConfig` defaults + `useMobileSWR`) are the right shape. The weakness is the **fetcher**: `jsonFetcher.js` exists, is correct, is documented at length — and is not the default. Most call sites still inline a fetcher with a bespoke non-ok fallback (`{}`, `[]`, `null`), each of which converts an error into a plausible-looking empty state. The docstring says this cost four surfaces a white screen once and a false-empty once; the fix shipped as an *available* module rather than an *enforced* one.

Auth being raw `fetch` + `useState` rather than SWR is why `AuthGuard` needs its own hand-rolled 4 s/10 s retry pair and an `authTransient` flag — SWR's `errorRetryCount` would have covered it.

### RELEVANCE TO UCT
TERMINAL-NEXT should adopt `jsonFetcher` (or a successor) as the *only* fetcher and make it enforceable, because a terminal that renders "no data" when it means "not entitled" or "the feed is down" is worse than one that renders nothing at all. The `usePreferences` write queue is a genuinely reusable asset for any multi-panel layout that persists server-side. And the two-pool separation (prices vs bars) is the correct precedent for adding a third stream without risking the first two.

### CONFIDENCE
🟢 high. **EVIDENCE CEILING:** which streams are actually delivering in production is D-05's question and NOT DETERMINED here.

### RECOMMENDATION
Add a lint rule or rail forbidding a bare `fetch(...).then(r => r.json())` in a new hook; point it at `jsonFetcher`. This repo's own rails are the model — `pollingSites.rail.test.js` already does exactly this for `useMobileSWR`.

### OPEN QUESTION
Is there an owner-level view on whether Terminal-Next should keep SWR or move to a subscription-first client (the panels are mostly streaming)? Nothing in the repo records that decision.

---

## 5 · Shared components and the shell

### OBSERVATION

`src/components/` holds **29 top-level non-test modules** and 20 subfolders (~915 files total). Top level: `AlertBell` `AppErrorFallback` `AppThemePicker` `AuthGuard` `BrandSplash` `CompanyLogo` `EmptyState` `ErrorBoundary` `ErrorState` `FeedbackWidget` `FundamentalSnapshot` `IntradayDayPopover` `JournalBacklinks` `Layout` `MobileNav` `MoversSidebar` `NavBar` `PageHeader` `PatternFeedbackChip` `PullToRefresh` `RouteErrorBoundary` `RsBadge` `Skeleton` `Sparkline` `StalledLoadFallback` `StockChart` `TickerActions` `TickerPopup` `TileCard` + `navGroups.js`.

Subfolders by size: `chart/` (138), `research-kit/` (29), `research/` (24), `tiles/` (19), `mobile/` (17), `voice/` (15), `video/` (12), `calendar/` (7), `screener/` (5), `fundamentals/` (4), `admin/` (4), `dashboard/` (3), `quote/` (2), `intro/` (2), `brand/` `breadth/` `community/` `ui/` `watchlist/` (1 each).

**The shell** is one component. `Layout.jsx` (107 lines) renders:
```
<TickerHubProvider>
  <MoreSheetContext.Provider value={openMore}>
    <div className={styles.shell}>        /* display:flex; height:100dvh; overflow:hidden */
      <NavBar />                          /* desktop left rail */
      <MobileNav onMenu={openMore} />     /* ≤1024px fixed top bar */
      <main className={styles.main}>      /* flex:1; overflow-y:auto  ← THE app scroller */
        {children ?? <Outlet />}
      </main>
      <FeedbackWidget />
      <MoreSheet open={moreOpen} … />
      <TickerHubSheet />
```
It also owns theme application: it reads `usePreferences`, resolves `uct:`-prefixed catalog themes through `styles/appThemes.js` (`applyAppTheme` / `clearAppThemeVars` / `writeThemeCache`), and calls `initBarsPack()`.

**⛔ The app scrolls `.main`, not `window`.** `Layout.module.css:1-12` — `.shell { overflow: hidden }`, `.main { overflow-y: auto }`. Any scroll listener must use capture phase or attach to `.main`. This is a global constraint on every panel Terminal-Next adds.

**`NavBar.jsx`** exports `NAV_ITEMS` — **17 entries**, bucketed at module scope into `NAV_GROUPS` (`components/navGroups.js`), with an explicit headingless trailing bucket so an ungrouped item "falls into a headingless trailing bucket rather than silently vanishing":

`/dashboard` Dashboard · `/morning-wire` Morning Wire · `/charts` Charts · `/ai-search` AI Search · `/uct-20` UCT 20 · `/breadth` Breadth · **`/calendar` "UCT Terminal"** · `/screener` Screener · `/options-flow` Options Flow · `/flow-scoreboard` Flow Record · `/live-massive` Live Flow · `/post-market` Post Market · `/model-book` Model Book · `/desk` The Desk · `/journal` Journal · `/community` Community · `/support` Support.

Settings + Admin are pinned separately at the bottom. Locked pages (everything but `/morning-wire` for non-paid) are hidden. `NavBar` also polls `/api/voice/insights/pending` (30 s, paid only) for the Compass badge and `/api/community/status` (2 min) for the community gate.

**`MobileNav`** is a fixed top bar at ≤1024px: menu button + page title + movers shortcut + `AlertBell`. **`MobileTabBar` no longer exists** — `components/mobile/` contains no such file, and `CLAUDE.md` records its removal on 2026-09-01 with a guard test (`pages/charts/mobileShellHeight.test.js`) against resurrection. **CONFIRMED by absence.** The single menu is `MoreSheet.jsx` (sectioned Core/Markets/Trading/Help/Account, identity header, free/paid/admin gating, active-route highlight, Compass badge), and every trigger opens *that* one.

**`components/mobile/` primitives — built, exported, and mostly unmounted.** Render-site counts (`<Component` in non-test source, excluding self):

| Primitive | Render sites | Verdict |
|---|---|---|
| `Sheet.jsx` | 35 importers | 🟢 the real success — the responsive modal everything uses |
| `useLongPress.js` | 7 | 🟢 adopted |
| `ContextPopover.jsx` | 3 | 🟡 adopted |
| `FiltersSheet.jsx` | 2 (`calendar/CalendarHeader`, `screener/shell/ScannerShell`) | 🟡 |
| `SegmentedNav.jsx` | 1 | 🟡 |
| `TickerHubSheet.jsx` | 1 (`Layout`) | 🟢 |
| **`ResponsiveTable.jsx`** | **0** | 🔴 built, documented in `CLAUDE.md` as the canonical responsive table, never rendered |
| **`DensitySwitcher.jsx`** | **0** | 🔴 |
| **`StickyActionBar.jsx`** | **0** | 🔴 |
| **`useSwipeAction.js`** | **0** | 🔴 |

⭐ **And the reachability rail cannot see this.** All ten are re-exported from `components/mobile/index.js`, and two files import *something* from that barrel (`FiltersSheet`). A named re-export from an imported barrel makes every sibling "reachable" to an AST walk, so four never-rendered primitives sit inside the rail's green. This is a real limit of the repo's best structural guard, worth recording: **reachable ≠ mounted.**

**Modals.** There is no shared modal component. `docs/brand-design-system.md` §10 documents a "Modal pattern (ModalShell)" — the only `ModalShell` in the tree is `pages/journal-2-0/components/ModalShell.module.css`, a **CSS module with no component**. Modals are built per-surface, either on `mobile/Sheet.jsx` (35 sites) or hand-rolled with a portal + `addEventListener('keydown')`.

**Error / empty / loading states.** Four boundaries and three state components:
- `RouteErrorBoundary` wraps `<Routes>`; `ErrorBoundary` is the generic class component; `AppErrorFallback` is the rendered fallback; `ChartErrorBoundary` guards Chart.js (per `CLAUDE.md`).
- `BrandSplash` — the auth/loading splash. `StalledLoadFallback` — the Suspense fallback that surfaces a recovery panel after ~20 s.
- `Skeleton.jsx` — 36 importers 🟢. `ErrorState.jsx` — 7 🟡. `EmptyState.jsx` — 11 importers **but the module is allow-listed as unreachable**, orphaned when master deleted `pages/Patterns.jsx`; the 11 are `components/research-kit/EmptyState`, a different file of the same name.

**`TileCard.jsx`** (26 lines) is the canonical content container: `{title, icon, badge, actions, children}`, `role="region"`, `aria-label={title}`, and an optional `UIcon` name for the header — the icon is a *prop*, so `title` stays a plain string and the `aria-label` stays correct. Small, correct, widely used.

**`UIcon`** (`components/ui/UIcon.jsx`, 508 lines) is the icon system: one `ICONS` object, **86 glyph keys** (measured by AST-shaped `awk` over the object body; `CLAUDE.md` says "~65" — stale), each an inline SVG path, gold-embossed by default with a reduced-motion-gated shimmer, `gold={false}` to fall back to `currentColor`. **273 non-test files import it.** This is the most successful shared primitive in the codebase by adoption.

### EVIDENCE
`app/src/components/Layout.jsx:1-107`; `app/src/components/Layout.module.css:1-12`; `app/src/components/NavBar.jsx:15-40`; `app/src/components/mobile/index.js`; render-site counts by `grep -rn "<Component" --include='*.jsx' . | grep -v '\.test\.'`; `app/src/components/TileCard.jsx`; `app/src/components/ui/UIcon.jsx:17+`; `docs/brand-design-system.md` §10. All **CONFIRMED**.

### INTERPRETATION
The shell is small and correct — one Layout, one nav rail, one mobile menu, one scroller. Where the component layer is weak is *adoption*: a mobile primitive kit was built as a system (barrel export, docs, a documented "pick per surface" rule for `ResponsiveTable`) and four tenths of it never got mounted, while the design doc describes a `ModalShell` that does not exist as a component. The pattern is consistent — **primitives get built to spec and then each new surface hand-rolls its own anyway**, because nothing makes reuse the path of least resistance and the reachability rail is structurally blind to a barrel-exported orphan.

The counter-example is `UIcon`: 273 importers, because there is no cheaper way to get an icon (emoji are explicitly banned) and the API is one line.

### RELEVANCE TO UCT
Terminal-Next is, at its core, a set of panels in a shell — precisely the layer that is weakest here. Two concrete inheritances are worth taking: `TileCard` (the aria-correct container) and `Sheet` (the one primitive that actually won). Two are worth *not* inheriting as-is: `ResponsiveTable` (unproven — zero production render sites, so any claim about how it behaves is untested) and "ModalShell" (does not exist). And the barrel-export blind spot means Terminal-Next's own reuse rail must count *render sites*, not imports.

### CONFIDENCE
🟢 high for the inventory and the counts. 🟡 for the interpretation that reuse fails for want of enforcement — that is inference from the pattern, not from a recorded decision.

### RECOMMENDATION
Before designing Terminal-Next panels, decide the fate of the four unmounted mobile primitives: they are either the panel kit's foundation (in which case mount them and the count becomes evidence) or they are dead weight (in which case delete them and stop the docs from promising them).

### OPEN QUESTION
Why was `ResponsiveTable` never adopted — was card-mode rejected on a real surface, or did it simply never get picked up? The answer decides whether Terminal-Next can reuse it.

---

## 6 · Design system

### OBSERVATION

**Files.** `src/index.css` (1.4 KB) is the only stylesheet `main.jsx` imports. It `@import`s three: `styles/tokens.css` (24.9 KB, **572 lines**), `styles/breakpoints.css` (1.7 KB), `styles/buttons.css` (4.7 KB). Its own body is 40 lines of *global* classes for TipTap-rendered content (`.community-ticker-chip`, `.community-user-mention`) which cannot live in a CSS module.

**⚰️ `src/App.css` (661 bytes) has ZERO importers.** It is the untouched Vite scaffold — `#root { max-width: 1280px; margin: 0 auto; padding: 2rem; text-align: center }`, a spinning React logo keyframe, `.read-the-docs`. It ships in the repo and is never loaded. It is not in the reachability allow-list (the rail scans `.js`/`.jsx`, not `.css`). Harmless, but it is a 660-byte lie about the app's root layout sitting in the file a new engineer opens second.

**Tokens** (`styles/tokens.css`) — the real design system, and it is genuinely good:

| Scale | Values |
|---|---|
| Brand | `--ut-green/-bright/-dim/-glow`, `--ut-red/-bright/-dim`, `--ut-gold/-bright/-dim/-glow`, `--ut-cream`; `--accent: var(--ut-gold)` (aliased so it follows per-theme gold) |
| Surfaces | `--bg --bg-surface --bg-elevated --bg-hover --border --border-accent --header-line --header-shadow` |
| Text | `--text --text-muted --text-bright --text-heading` |
| Semantics | `--gain/-bg/-border`, `--loss/-bg/-border`, `--warn/-bg/-border` |
| Spacing | `--space-xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48` |
| Radii | `--radius-sm 4 · md 6 · lg 8 · xl 12 · 2xl 16 · pill 999`; `--control-radius: var(--radius-lg)` |
| Z-index | `--z-base 1 · dropdown 100 · sticky 200 · nav 300 · fab 350 · backdrop 399 · drawer 400 · modal 1000 · toast 1100` |
| Touch | `--tap-min: 44px` |
| Type | `--font-sans / --font-mono / --font-display / --font-heading` — **all four resolve to `'Instrument Sans'`** |

The file carries its own archaeology: a "LEGACY ALIASES" block defining nine names (`--color-danger` et al.) used across ~212 declarations that were **never defined anywhere**, with the note that an undefined `var()` with no fallback is an invalid declaration the browser drops silently, so `color: var(--color-danger)` never made an error message red — verified at the root of the running app, not by grep.

**Themes.** Two mechanisms coexist:
1. **Attribute themes in `tokens.css`:** `:root` (default = the Graphite ramp), `[data-theme="oled"]`, `[data-theme="light"]`, plus `[data-charts-theme='sunrise']` for the chart palette. Only **two** `[data-theme]` blocks exist.
2. **A JS theme catalog** (`styles/appThemes.js`, 11.3 KB): `APP_THEMES` = **18 palettes** in two families — 12 dark (`slate` `graphite` `carbon` `navy` `forest` `espresso` `plum` `nord` `gunmetal` `bordeaux` `storm` + 1) and 6 light (`paper` `cream` `coolgray` `softblue` `sand` `mint`) — applied by writing inline CSS variables onto an element (`applyAppTheme`), namespaced `uct:` in the stored preference, with a `THEME_CACHE_KEY = 'uct.appTheme.v1'` localStorage cache for first paint.

`usePreferences` DEFAULTS set `theme: 'oled'`, while `tokens.css`'s bare `:root` is Graphite — so the "no preference" ramp and the "no explicit choice" default are two different palettes. Both are defensible; they are simply two authorities on "what does a new user see".

**`docs/brand-design-system.md` is 52 KB and its §7 says the theme variants are "default / OLED / Dim".** There is no `Dim` theme anywhere in `tokens.css` or `appThemes.js`. §10 documents a `ModalShell` that exists only as a CSS file. Treat the doc as a **CLAIMS** artefact.

**CSS Modules.** 378 `*.module.css` vs 8 plain stylesheets (`index.css`, `App.css`, `tokens.css`, `breakpoints.css`, `buttons.css`, and three `*.mobile.css` additive layers for partner-owned pages). **Zero bare `#id` selectors exist in any `.module.css`** (`grep -c "^#[a-zA-Z]"` → 0), so the documented CSS-Modules-hashes-`#id` hazard is currently not being triggered — but nothing enforces that, and the hazard is real (a hashed `#id` selector silently matches nothing).

**Typography drift — one measurable defect.** `font-family` declarations outside `tokens.css` that don't use `var(--font-*)`, by value:

| Value | Count | Verdict |
|---|---|---|
| `inherit` | 228 | benign |
| `Georgia, 'Times New Roman', serif` | 11 | documented exception (intro-animation cartography) |
| **`'IBM Plex Mono', ui-monospace, monospace`** | **11** | 🔴 **IBM Plex Mono is not loaded anywhere.** `index.html` declares exactly two `@font-face` families — `'Instrument Sans'` and `'Instrument Sans Tab'` — and `app/public/fonts/` holds only five Instrument Sans `.woff2` files. These 11 declarations silently fall through to the OS monospace. |
| `'Instrument Sans Tab', 'Instrument Sans', monospace` | 9 | 🟢 real — a self-hosted tabular-figures variant |
| bare `'Instrument Sans', …` | 11 | 🟡 should be `var(--font-sans)` |

The 10 files declaring IBM Plex Mono include `components/StockChart.module.css`, `components/screener/ScanResults.module.css`, `components/RsBadge.module.css`, and three `/r/*` render pages (`BreadthRender.jsx`, `FlowRender.jsx`, `ThemesRender.jsx`) — i.e. **the chart, the scanner results, and three server-rendered images**, all rendering numbers in whatever mono the host machine happens to have. On the Railway/Playwright renderer that is a different font from the developer's Mac.

**Numeric typography is otherwise taken seriously:** 343 `tabular-nums` / `font-variant-numeric` declarations across the CSS, and `tokens.css:512,519` sets it on the mono utility classes.

**Fonts are self-hosted** (`app/public/fonts/*.woff2`, served by a `/fonts` mount in `api/main.py`, preloaded from `index.html`) with a load-bearing comment: the chart's canvas axis bakes whichever font resolves at draw time, so a third-party font host would be a *correctness* dependency of every chart, not a styling one.

**Number-format utilities are scattered.** There is no `format.ts`. At least 25 exported formatters live in 10+ modules: `utils/profileFormat.js` (`fmtPct` `fmtVol` `fmtEps` `fmtRevenue` `fmtQuarter` `fmtShares` `fmtEarnDate` `fmtAge`), `utils/timeAgo.js` (`formatET` `formatETTime` `formatETDate` `formatETFull` `timeAgoShort`), `utils/feedFormat.js`, `pages/cot/cotFormat.js` (`fmtDate` `fmtNum`), `components/research-kit/charts/format.js` (`formatSigned`), `components/chart/signatureData.js` (`fmtNotional`), `components/research/QuoteStrip.jsx` (`fmtPrice` `fmtVol` — a *second* `fmtVol`), `components/screener/ScanResults.jsx` (`formatHitValue`), plus inline helpers like `pages/Confluence.jsx`'s `usd()`. `CLAUDE.md` documents a third `fmtRev()` in `CatalystFlow.jsx`.

### EVIDENCE
`app/src/index.css`; `app/src/App.css` (zero importers — `grep -rn "App.css"` over `app/src` and `app/index.html` → 0); `app/src/styles/tokens.css:12-262, 328-542`; `app/src/styles/appThemes.js:75-190`; `app/index.html:73-130`; `ls app/public/fonts/`; `grep -rho "font-family: *[^;]*" --include='*.css' | sort | uniq -c`; `docs/brand-design-system.md` §7, §10. All **CONFIRMED** by direct read.

### INTERPRETATION
The token layer is a real design system — scaled, semantic, theme-aware, self-documenting, with 18 palettes and an explicit z-index ladder. What is missing is the layer *above* it: nothing maps tokens to components, so each surface re-derives its own spacing and its own number formatting from the same primitives. The stylelint config governs one property at warning severity, which is exactly why `font-family` drift went unnoticed: a font nobody loaded has been styling the chart and the scanner for long enough that ten files agree on it.

Two claims in `docs/brand-design-system.md` (a "Dim" theme, a `ModalShell` component) do not correspond to code. That doc is the handoff artefact a designer would be given.

### RELEVANCE TO UCT
A trading terminal is *mostly* number rendering. Two facts here are load-bearing for TERMINAL-NEXT:
1. **There is already a self-hosted tabular font (`Instrument Sans Tab`) and 343 `tabular-nums` declarations** — the alignment discipline exists and can be inherited directly.
2. **There is no single number-formatting authority**, so "how does this product render $1.2B / -3.47% / 09:31:04 ET" has at least three different answers today. Terminal-Next should ship one formatter module before its first panel, or it will make a fourth.

The 18-palette catalog is a genuine differentiator to keep; the `[data-theme]` + inline-var dual mechanism is a complexity Terminal-Next inherits whether it wants to or not.

### CONFIDENCE
🟢 high — every number here is measured, not quoted. **EVIDENCE CEILING:** whether the IBM Plex Mono fallback is *visually* wrong on the production renderer is NOT DETERMINED (would need a rendered screenshot from the Railway pod, which this contract forbids).

### RECOMMENDATION
Three cheap fixes with outsized value for Terminal-Next: delete `App.css`; replace the 11 `IBM Plex Mono` declarations with `'Instrument Sans Tab'` (already loaded, already tabular); and extend `.stylelintrc.json` to cover `font-family` the way it covers `color`.

### OPEN QUESTION
Is the 18-palette theme catalog a product commitment Terminal-Next must honour, or a dashboard-era feature it can narrow? Supporting 18 palettes across a dense new surface is a real per-panel cost.

---

## 7 · Tables and grids

### OBSERVATION

**There is no shared table component.** Every dense grid is built per-surface. What exists:

**Virtualisation — `@tanstack/react-virtual`, 4 call sites:**

| Site | Shape |
|---|---|
| `pages/screener/shell/VirtualResults.jsx` | ⭐ the most developed: an **ARIA grid** over `useVirtualizer`, rows positioned by `top` and **never `transform`** (a transformed ancestor breaks `position: sticky` on the ticker column, so the live-price overlay and load-more append both have to avoid it), `overscan: 12`, two row heights (`compact: 30` / `comfortable: 38`), column widths derived from `columnDefs.js` + `descFor(key)` rather than hand-listed, `LIVE_WINDOW = 300`, auto-append near the end, optional live-price re-sort via `sortRowsLive` |
| `pages/screener/shell/ResultCards.jsx` | the card-mode sibling for narrow widths |
| `pages/Breadth.jsx` | virtualized monitor table |
| `pages/Watchlists.jsx` | virtualized list, with `observeElementRect` |

`CLAUDE.md`'s launch-hardening section lists "table virtualization (react-virtual installed/unused)" as a *remaining* item — **that is stale**: it is installed and used in four places.

**Sorting.** Implemented independently at least five times, all click-header + caret + `aria-sort`, each in its own module: `screener/shell/VirtualResults.jsx` (`sort`/`onSort` props + `liveSort.js`), `journal-2-0/components/TradesTable.jsx`, `journal-2-0/components/PositionsTable.jsx` (whose `sortKeyFor()` mirrors its own Row's display logic — live-price P&L, broker no-real-stop blanking, option-row N/A), `components/tiles/CatalystTable.jsx`, `pages/Watchlists.jsx`. `CLAUDE.md` records that the shared `.thBtn`/`.sortCaret`/`.thBtnActive` CSS is *duplicated* in both Journal `.module.css` files.

**Column preferences.** Two mechanisms, no shared one:
- `pages/screener/shell/ColumnPicker.jsx` (+ `columnDefs.js`, `ColumnDesc.jsx` for per-column descriptions) — the screener's.
- `pages/journal-2-0/components/ColumnsPicker.jsx` — Journal's, and **the only `@dnd-kit` consumer in the entire codebase** (drag-reorder columns). Used by `OpenPositionsTab` and `TradeJournalTab`.
- `pages/Watchlists.jsx` persists its own columns to `localStorage['uct.watchlist.cols']` with "Price View / Performance / Short-Term" presets.

**CSV export — 13 sites, at least four independent implementations:** `pages/screener/exportCsv.js`, `pages/screener/shell/csvExport.js` (two, in the same feature), `pages/journal-2-0/lib/csvTemplates.js` + `lib/importer/commit.js` + `components/ImportCsvModal.jsx` (import side, `papaparse`), plus ad-hoc blobs in `pages/Admin.jsx`, `pages/Breadth.jsx`, `pages/Watchlists.jsx`, `pages/ModelBook.jsx`, `pages/modelbook/SetupsView.jsx`, `components/IntradayDayPopover.jsx`, `journal-2-0/components/analytics/TaxCenterSection.jsx`, `pages/OptionsFlow_admin.jsx`.

**Density.** `--tap-min: 44px` is the only density token. `VirtualResults` has a two-value `density` prop; `components/mobile/DensitySwitcher.jsx` exists and exports `DENSITY_OPTIONS` but has **zero render sites**. `tokens.css:326` has a comment about a scale that "lifts text that opted into the scale, so tables keep their information density", i.e. density is handled by opt-out rather than by a system.

**The heat-map cell system** (`pages/Breadth.module.css`) is the one genuinely shared table *visual* language: an 8-tier background ramp (`.bgG3 … .bgR3`) driven by `cellClass(col, val, row)`, documented in `CLAUDE.md` and reused by the Breadth monitor, the treemap and `BreadthViews`.

### EVIDENCE
`grep -rn "@tanstack/react-virtual"` → 4 non-test sites (**CONFIRMED**); `app/src/pages/screener/shell/VirtualResults.jsx:1-45`; `grep -rln "ColumnsPicker"` → 3 files; `grep -rln "text/csv|toCsv|papaparse"` → 13 files; `grep -rn "<DensitySwitcher"` → 0. All **CONFIRMED**.

### INTERPRETATION
`VirtualResults.jsx` is a competent, production-proven virtualized data grid with correct ARIA semantics and a hard-won constraint (`top`, not `transform`) recorded in a comment. It is also **scoped to the screener** and imports screener-specific `columnDefs`. Everything else re-invents sorting, column picking and CSV export locally. The `sticky`-vs-`transform` finding in particular is the kind of thing that gets rediscovered painfully — it is worth extracting to a shared component *for the finding alone*, independent of the code.

### RELEVANCE TO UCT
A trading terminal is a table product. This is the highest-leverage extraction in the whole front end: one `<DataGrid>` carrying virtualization, sticky first column, ARIA grid roles, sort, column picker, density and CSV export would replace five sorting implementations and four CSV implementations, and `VirtualResults.jsx` is 80% of it already. **Recommend D-06/architecture treat `screener/shell/VirtualResults.jsx` as the seed, not a greenfield table.**

### CONFIDENCE
🟢 high for the inventory. 🟡 for "80% of it already" — that is a judgment from reading its head and column logic, not from porting it.

### RECOMMENDATION
Extract the grid before Terminal-Next's first table, and carry the `top`-not-`transform` comment with it verbatim.

### OPEN QUESTION
Does Terminal-Next need cell-level editing or only display? `VirtualResults` is read-only plus a context menu; editable cells would change the extraction substantially.

---

## 8 · Charts — why four libraries

### OBSERVATION

Four charting libraries ship. Measured use sites (non-test):

| Library | Use sites | What it draws | Why it is the one |
|---|---|---|---|
| **`lightweight-charts` 5.2.0** (pinned exact) | **3** — `components/StockChart.jsx`, `components/tiles/UCT20Performance.jsx`, `pages/journal-2-0/components/trade/TradeReplay.jsx` | every price chart in the product | TradingView's own canvas engine; the only one that does streaming candle updates at tick rate |
| **`echarts` ^6 + `echarts-for-react`** | **11** — `research-kit/charts/{echartsCore,Histogram,LollipopChart,MetricTrendChart,RevisionColumns,SeriesChart}`, `pages/BreadthCharts.jsx`, `pages/breadth/views/TreemapView.jsx`, `pages/charts/widgets/{NhnlPulseWidget,ScatterWidget}`, `journal-2-0/{tabs/AnalyticsTab, TrackRecordPage, components/PerformancePanel, components/analytics/RiskExitsSection, components/broker/BrokerEquityCurve}` | analytics: treemaps, scatter, histograms, multi-series lines with `dataZoom` | the only one of the four with treemap + `dataZoom` + `visualMap` + `markLine` out of the box |
| **`chart.js` + `react-chartjs-2`** | **1** — `pages/CotData.jsx` | the five stacked COT panes (proxy price, Commercials, Large Specs, Small Specs, Open Interest) | mixed bar+line with a per-axis `afterDataLimits` callback; `CLAUDE.md` records "**COT charts are Chart.js — do NOT replace those**", and the axis scaling depends on Chart.js internals (`afterDataLimits`, `BarController` + `BarElement` both registered) |
| **`recharts` ^2.15** | **1** — `components/tiles/UCT20Backtest.jsx` (mounted from `pages/UCT20.jsx:11,623`) | one backtest equity chart | no stated reason; the smallest and most replaceable footprint |

`echarts` and `recharts` are **deliberately excluded from `manualChunks`** so they land in Rollup's auto-created shared chunks hanging off lazy routes rather than off the entry — the comment records that forcing a `recharts`/`tiptap` chunk put 231 KB gz on the login screen.

**The chart component boundary:**
- `components/StockChart.jsx` — **15,500 lines**, the largest file in the repo. It owns candle rendering, five chart types, MA overlays, HVC volume, markers, price lines, the crosshair OHLCV legend, live-bar arbitration between two feeds, and the "six writer sites" single-writer invariant (`barsPushActive`) whose index is derived from the file's own AST by `components/chart/engine/__tests__/singleWriterIndex.test.js` rather than typed.
- `components/chart/` — **138 non-test modules**: `ChartToolbar.jsx` (1,846), `ChartDrawingOverlay.jsx` (3,263), `ChartSettingsModal.jsx` (1,508), `ChartCalloutOverlay.jsx`, `SymbolSearch.jsx`, `chartDefaults.js`, `keyboardShortcuts.js`, `builder/` (the formula builder + CodeMirror editor), `engine/` (see §11), `patternShapes/`.
- `pages/charts/` — **100 modules**: the workspace shell (`ChartsWorkspace.jsx`, 2,623), `WidgetHost.jsx`, `WidgetHeader.jsx`, `WorkspaceContext.jsx`, `ChartsSymContext.jsx`, plus four subdirs — `widgets/` (39 `.jsx`), `grid/` (17 — the N×M multi-chart mode), `mobile/` (11 — `MobileChartsApp`, `MobileSymbolStrip` and six sheets), `popout/` (3 — `PopoutWindow`, `PopoutShell`, `PoppedLayout`). D-06 owns the judgment on this.
- `pages/ChartRender.jsx` — the headless `/r/chart` renderer used by the Discord `/chart` command and the Substack pipeline.

**Widget registry.** `src/widgets/registry.js` (38.8 KB) exports `WIDGET_REGISTRY` (deep-frozen) with **18 types**: `chart watchlist themes scanner fundamentals breadth aisearch news notebook profile alerts calendar optionsflow periodsort nhnl nhnlPulse volumescan scatter`, plus derived exports (`WIDGET_IDS`, `WORKSPACE_MENU_TYPES`, `TAB_MENU_TYPES`, `MOBILE_MENU_TYPES`, `JOURNAL_MENU_TYPES`, `THEME_FOLLOW_TYPES`, `WIDGET_CATEGORIES`, `WIDGET_CATALOG`). `pages/charts/WidgetHost.jsx:44-72` holds `WORKSPACE_WIDGETS`, the component bindings for the same 18 keys, and `registry.test.js` (21 KB) pins that the two can never drift.

Note the widget key **`calendar`** — TERMINAL-CURRENT is a widget type as well as a route and a Zone D door key.

### EVIDENCE
`grep -rln "from 'lightweight-charts'"` → 3; `grep -rln "from 'echarts|echarts-for-react"` → 11; `grep -rln "react-chartjs-2|from 'chart\.js'"` → 1; `grep -rln "from 'recharts'"` → 1; `app/vite.config.js` manualChunks comment; `app/src/widgets/registry.js:149,520-553`; `app/src/pages/charts/WidgetHost.jsx:44-72`; `wc -l` for file sizes. All **CONFIRMED**.

### INTERPRETATION
Four libraries is not four *equivalent* choices. Three of the four are load-bearing and near-irreplaceable: `lightweight-charts` is the price chart, `echarts` is the analytics vocabulary (treemap/scatter/dataZoom), and `chart.js` is a single page with axis behaviour that depends on library internals and an explicit "do not replace" ruling. **`recharts` is the only genuinely redundant one** — one file, one chart, no recorded reason, and its exclusion from `manualChunks` already treats it as a cost to be minimised rather than a dependency to be embraced.

`StockChart.jsx` at 15,500 lines is the single biggest architectural liability in the front end and the single biggest asset. It is the reason the price chart works; it is also unsplittable by any incremental refactor, and the codebase has responded by building AST-derived rails *over* it (the single-writer index) rather than decomposing it.

### RELEVANCE TO UCT
TERMINAL-NEXT's charts almost certainly mean `lightweight-charts` + `StockChart.jsx`, because the streaming/arbitration/sanity-check logic in that file represents months of incident recovery (the DDOG 100× phantom, the Heikin-Ashi raw-candle bug, the fetch-herd outage). Rewriting it is not a chart rewrite; it is re-earning those incidents. The realistic path is to consume `StockChart` as-is behind a narrower prop surface — which is exactly what `pages/charts/grid/GridChartCell.jsx` already does ("composed on StockChart directly with the ChartWidget canvas recipe — NEVER ChartWidget itself").

Dropping `recharts` is a free ~1 dependency and one file.

### CONFIDENCE
🟢 high for the use-site counts and the boundary. 🟡 for "near-irreplaceable" — that is judgment; the Chart.js half is 🟢 because `CLAUDE.md` carries an explicit ruling.

### RECOMMENDATION
Port `UCT20Backtest.jsx` to `echarts` and drop `recharts`. Treat `StockChart.jsx` as a black box with a contract, not a refactor target.

### OPEN QUESTION
Does Terminal-Next need chart types `lightweight-charts` cannot draw (depth/heatmap/footprint)? If yes, that is a fifth library decision and should be made once, deliberately, rather than per-panel.

---

## 9 · Keyboard and interaction

### OBSERVATION

**There is no global shortcut registry.** Keyboard handling is three disconnected systems:

1. **`react-hotkeys-hook` — 5 files, all Journal 2.0.** `JournalLayout.jsx` and `JournalTwoRoot.jsx` each register `shift+/` (cheat sheet) plus **nine `g>x` chords** (`g>o g>p g>j g>a g>n g>y g>t g>k g>c`) — the *same nine chords declared twice*, once per shell, doing different things (v5 navigates routes via `goToChord`, v8 sets `nestedTab` state). `LogTradeButton.jsx`, `tabs/OpenPositionsTab.jsx` (`a` → add position) and `tabs/TradeJournalTab.jsx` add single keys. The cheat sheet is `journal-2-0/components/ShortcutCheatSheet.jsx`. **Nothing outside `/journal` uses this library.**

2. **`components/chart/keyboardShortcuts.js`** — the chart's own declaration, and the most carefully-reasoned keyboard artefact in the repo. It exports `INDICATOR_CHORDS` (four frozen `{defId, keys, code, modifier}` rows: `Ctrl+I`→rsi, `Ctrl+O`→macd, `Ctrl+B`→bb, `Alt+U`→vwap) and `TF_ORDER` (`['1','5','15','30','60','D','W','M']`, the single source for both the timeframe bar and the repeat-press cycle). Its header records that this "one file" grew to *four regions across two files* — the table, the matcher, `StockChart`'s `toggle:` switch and its `e.altKey` block — two of which declare and two of which consume, and that `Alt+U` spent a whole phase declared in one place and handled in another because `matchShortcut` deliberately rejects Alt (so browser Alt shortcuts keep working). `code` is the layout-independent physical key, not the character. There is a `KeyboardHelpOverlay.jsx`.

3. **87 non-test files attach a raw `addEventListener('keydown', …)`** to `window` or `document` — modals, popovers, the drawing overlay, `Sheet`, `useFocusTrap`, `SymbolSearch`, `IntroAnimation`, `GlobalVideoLayer`, `TickerPopup`, the CodeMirror wrapper, and dozens more. Each manages its own capture/bubble phase, its own `preventDefault`, and its own input-field exemption.

**`@dnd-kit` — one consumer.** `pages/journal-2-0/components/ColumnsPicker.jsx` only. Three `@dnd-kit` packages ship for one column-reorder UI. (`pages/Watchlists.jsx` does drag-reorder with **native HTML5 DnD**, not `@dnd-kit` — two drag implementations, neither shared.)

**`react-grid-layout` — 8 modules**, all `/charts`: `pages/charts/ChartsWorkspace.jsx` (the Responsive grid, `cols=12`, `FIXED_ROWS=20`, dynamic `rowHeight` via `ResizeObserver`), `rowHeight.js`, `findOpenSlot.js`, `placement/GhostPreview.jsx`, `placement/regions.js`, `widgets/ViewHoldingsControl.jsx`, `widgets/registry.js`, and `components/chart/ChartToolbar.jsx`. D-06 evaluates the workspace.

**Touch interaction:** `components/mobile/useLongPress.js` (450 ms, 10 px tolerance, haptic, *also accepts right-click* so one binding serves both inputs — 7 sites), `useSwipeAction.js` (0 sites), `haptics.js`, and the chart's `DrawingQuickBar` touch quick-action bar with capture-phase listeners and explicit `[data-uct-qbar]` exemptions.

### EVIDENCE
`grep -rln "react-hotkeys-hook"` → 5 files (**CONFIRMED**); `grep -rn "useHotkeys("` → 20 registrations; `app/src/components/chart/keyboardShortcuts.js:1-45`; `grep -rln "addEventListener('keydown'"` → 87 non-test files; `grep -rln "@dnd-kit"` → 1; `grep -rln "react-grid-layout"` → 8. All **CONFIRMED**.

### INTERPRETATION
The chart has a *real* keyboard architecture — physical `code` matching, a declared chord table, a deliberate Alt carve-out, a help overlay, and a written history of what happens when declaration and consumption drift apart. That architecture stops at the chart. Everywhere else, keyboard is 87 independent `keydown` listeners plus a hotkey library scoped to one feature (which itself declares the same nine chords twice).

The consequence is predictable and already documented in the owner's own memory (`lesson_two_commands_one_physical_key`, `⌨️ changing a control's AXIS promotes a latent key conflict`): with no registry, two surfaces can claim the same key and nothing detects it until a user finds it.

### RELEVANCE TO UCT
A terminal is a keyboard product. This is the second-highest-leverage gap after tables. TERMINAL-NEXT needs a **single shortcut registry** — one place where a binding is declared, one matcher, one "am I in a text field" rule, one conflict rail. `components/chart/keyboardShortcuts.js` is the right *model* (frozen declarations, physical `code`, an explicit rejected-modifier rule) and the wrong *scope*.

### CONFIDENCE
🟢 high — all counts measured.

### RECOMMENDATION
Build the registry before the first Terminal-Next binding, and give it a rail that fails on a duplicate `(code, modifier, scope)` triple. This repo's rails culture will support that; it just has never been asked for globally.

### OPEN QUESTION
Should Terminal-Next adopt `react-hotkeys-hook` app-wide, or replace it? It is currently a 5-file dependency carrying 20 registrations, and its chord support (`g>o`) is the one thing raw listeners handle badly.

---

## 10 · Responsive and mobile

### OBSERVATION

**Three tiers, two boundaries, declared twice and kept in sync by convention.**
- JS: `styles/breakpoints.js` — `BP = {phone: 640, tablet: 1024}` and `MQ` (`phone`, `tablet`, `desktop`, `tabletDown`, `touchDown`, `coarsePointer`, `noHover`). Typed hooks in `hooks/useBreakpoint.js` (`useIsPhone` / `useIsTablet` / `useIsTouch` / `useIsDesktop` / `useHasCoarsePointer` / `useHasNoHover`), all over `hooks/useMediaQuery.js`.
- CSS: `styles/breakpoints.css` — no PostCSS custom-media plugin ("avoids build risk across the CSS-module surface"), so the canonical `@media` strings are **copied by convention**: PHONE `(max-width: 640px)`, TABLET `(min-width: 641px) and (max-width: 1024px)`, TOUCH `(max-width: 1024px)`, DESKTOP `(min-width: 1025px)`. It also defines four utilities: `.hideOnPhone`, `.showOnPhone`, `.hideOnTouch`, `.touchTarget`, and a `@media (hover: none)` neutraliser `.hoverReveal`.

**Adoption, measured:** 209 CSS files contain `max-width: 640px`; **131** contain `max-width: 1024px`. So the phone tier is ~60% more widely handled than the tablet tier — the numeric shape of the "tablet was not a smaller phone; it was uncovered" finding.

**⛔ THE TOUCH TIER IS ≤1024, NOT ≤640**, and that is enforced by a rail: `styles/tapFloor.test.js` walks *every* stylesheet and asserts a relationship, not a roster — "whatever a file declares a finger target at 390 px it must also declare at 820 px". Its header records the measurement that motivated it: `tools/mobile_audit.py` found **360 sub-44px targets at 820 px against 15 at 390 px** before the sweep. The rail's own stated limit is important: it reads *declarations*, not rendered boxes, because jsdom computes no layout — so a `min-height` on an inline `<a>` satisfies it and still renders small. Passing is necessary, not sufficient; `tools/mobile_audit.py` remains ground truth.

**Mobile CSS files:** only three dedicated ones, all additive layers over partner-owned or inline-styled pages — `pages/OptionsFlow.mobile.css`, `pages/DarkPool.mobile.css`, `pages/LiveFlowMassive.mobile.css`. Everything else handles mobile inside its own `.module.css`.

**Mobile nav:** one top bar (`MobileNav`, ≤1024 px) + one sheet (`MoreSheet`). The bottom `MobileTabBar` was removed 2026-09-01 and its `--mobile-tabbar-h` token is gone. On the phone chart shell — where the top bar also hides — the app-menu door is the Menu button in `pages/charts/mobile/MobileSymbolStrip.jsx`, reached through `MoreSheetContext`.

**Mobile chart surface** is a genuine parallel implementation, not a stylesheet: `pages/charts/mobile/` holds `MobileChartsApp.jsx` plus `MobileSymbolStrip`, `MobileChartToolbar`, and five sheets (`MobileAlertSheet`, `MobileChartTypeSheet`, `MobileIndicatorSheet`, `MobileMoreSheet`, `MobileSymbolSheet`, `MobileTfSheet`).

**⚠️ The documented stale-at-first-paint hazard.** `hooks/useMediaQuery.js` seeds from `matchMedia(q).matches` at *mount* and updates only on a media `change` event; in a fixed mobile context the viewport never changes, so a JS `useIsTouch()` read can render the desktop variant on a phone. The rule (`CLAUDE.md`, "Mobile layout gotcha") is: use CSS `@media` for layout/positioning, reserve `useIsTouch()` for click-triggered conditional rendering.

**What breaks density:** the `--tap-min: 44px` floor is in direct tension with dense tables. `CLAUDE.md` records the concrete case — "a 21px tape row cannot take a 44px target" — and `VirtualResults`'s `compact` row height is **30 px**, i.e. a compact screener row is structurally below the touch floor. `DensitySwitcher` exists and is unmounted (§5), so today the resolution is per-surface and implicit.

**Floating chrome:** the voice orb (`voice/FloatingOrb.jsx`, paid-only, bottom-right) and the feedback `?` (`FeedbackWidget.jsx`, bottom-left) are `position: fixed` above the safe area and auto-hide on scroll-down via `hooks/useHideOnScroll.js` — which must use **capture phase**, because the app scrolls `.main`, not `window` (§5).

### EVIDENCE
`app/src/styles/breakpoints.js`; `app/src/styles/breakpoints.css`; `app/src/styles/tapFloor.test.js:1-22`; `grep -rl "max-width: *640px" --include='*.css'` → 209, `…1024px` → 131; `ls app/src/components/mobile/` (no `MobileTabBar`); `ls app/src/pages/charts/mobile/`; `app/src/pages/screener/shell/VirtualResults.jsx:16`. All **CONFIRMED**.

### INTERPRETATION
The breakpoint system is well-designed and, unusually, has a rail that measures a *relationship* rather than a list — the single best piece of responsive engineering here. The weaknesses are (a) the CSS side is copy-by-convention with no plugin, so the 640/1024 discipline depends on reviewers; (b) the tablet tier is measurably less covered than the phone tier; and (c) the 44 px floor and dense-table density are in unresolved tension, with the tool built to resolve it (`DensitySwitcher`) unmounted.

### RELEVANCE TO UCT
If TERMINAL-NEXT is desktop-first and dense, the 44 px floor is its central responsive question, not a detail. The honest options are a genuine density mode (mount `DensitySwitcher`, define a second token set) or an explicit "this surface is desktop/tablet only" ruling. Copying the phone-tier defaults into a terminal grid will produce either 30 px rows that fail the rail or 44 px rows that halve the information density.

### CONFIDENCE
🟢 high for the system and the counts. 🟡 for "tablet is less covered" — the 209/131 ratio is a proxy (a file may handle tablet via a `min-width: 1025` desktop rule instead), though `tapFloor.test.js`'s own measured 360-vs-15 finding independently supports it.

### RECOMMENDATION
Resolve the density-vs-tap-floor question as a *ruling* before Terminal-Next's first table, and record it where `tapFloor.test.js` can enforce it.

### OPEN QUESTION
Is TERMINAL-NEXT a phone product at all? The touch tier costs real density, and nothing in the charter I have read states the target device mix.

---

## 11 · Code health

### OBSERVATION

**Debt is not in TODOs.** `TODO|FIXME|HACK|XXX` across all non-test source: **3 occurrences**. Debt lives instead in (a) long explanatory comments beside guards, (b) a 24-entry allow-list of deliberately-unwired modules, and (c) file size.

**Largest non-test files:**

| Lines | File |
|---|---|
| 15,500 | `components/StockChart.jsx` |
| 9,972 | `pages/OptionsFlow_admin.jsx` *(partner-owned, unrouted)* |
| 9,263 | `pages/OptionsFlow.jsx` *(partner-owned)* |
| 7,218 | `components/chart/engine/ast/pine.js` |
| 4,911 | `pages/LiveFlowMassive.jsx` |
| 4,728 | `components/chart/engine/ast/thinkscript.js` |
| 3,606 | `pages/DarkPool.jsx` |
| 3,263 | `components/chart/ChartDrawingOverlay.jsx` |
| 2,809 | `components/chart/engine/ast/interpret.js` |
| 2,699 | `pages/Watchlists.jsx` |
| 2,623 | `pages/charts/ChartsWorkspace.jsx` |
| 2,489 | `pages/Settings.jsx` |
| 2,371 | `pages/LiveFlow.jsx` *(unrouted)* |
| 2,351 | `components/chart/builder/BuilderSheet.jsx` |
| 2,338 | `pages/ModelBook.jsx` |
| 2,270 | `components/chart/engine/nativeRegistry.js` |
| 2,254 | `pages/Admin.jsx` |
| 2,002 | `components/chart/engine/defSchema.js` |
| 1,935 | `components/chart/engine/ast/pcf.js` |
| 1,846 | `components/chart/ChartToolbar.jsx` |

Ten files exceed 2,300 lines; two exceed 9,000. No lint rule constrains this.

**Dead / dormant code — the authoritative list is `components/screener/reachable.test.js`.** That rail walks the real import graph from `App.jsx` + `main.jsx` + config entry points with an **AST** (resolving static imports, `import type`, bare side-effect, `export * from`, `lazy(() => import())`, `await import()`, `require()`, `import.meta.glob`, `vi.mock`, `@/` and `/src/` aliases, and `index.*` directory resolution), scoped to **all of `app/src`**, and lists 24 deliberate exceptions in `AWAITING_A_DECISION`, each with a written reason. Its own header states the two rules that make it shrink-only: an entry cannot outlive its file, and it cannot outlive its reason (it fails the moment a listed path becomes reachable). It also refuses a blanket "only tests import it" exemption, naming four modules that would have escaped under one.

The 24, grouped:

| Group | Modules | Reason recorded |
|---|---|---|
| **Dashboard cockpit retirement (2026-08-30)** | `tiles/LeadershipTile` `tiles/CatalystFlow` `tiles/OptionsFlowPreview` `tiles/SectorRotation` `tiles/IntradayPulse` `tiles/CompassTodayTile` `dashboard/DeskVideoRail` (+ `dashboard/buildRail`, `video/BrandBadge` by inheritance) | 8 preview tiles replaced by Zone D signposts — ~90 px each instead of ~4,000 px. Kept as rollback backup; explicitly "a COUNTDOWN, not a parking space" |
| **Superseded (not backup)** | `tiles/TapeFeed` (+ `tiles/NewsFeed` by inheritance) | MoversSidebar re-implements the tape against `useTweetFeed`; restoring TapeFeed restores a *duplicate*. ⚠️ One recorded consequence: under `VITE_TWITTER_UI_ENABLED=0`, TapeFeed was the only path that rendered `NewsFeed`, so flag-off users lose the news list outright |
| **Branded primitive kept** | `components/EmptyState` | orphaned when master deleted `pages/Patterns.jsx`; kept because it mirrors the live `ErrorState` and the pattern engine is paused, not dead |
| **Measurement infrastructure** | `chart/engine/registrySizes.js`, `chart/engine/ast/doorCoverage.js` | hand-written declarations whose consumer is a *rail*, not a route — deriving them would make them true by construction |
| **Build-script entry points** | `pages/cot/cotFactsEntry.js`, `pages/optionsFlow/flowFactsEntry.js` | consumed by `npm run build` → Node bundles the Python backend shells out to |
| **Partner-owned, awaiting ack** | `pages/OptionsFlow_admin`, `pages/LiveFlow_admin`, `LiveFlow_integration_guide` (+ `useFlowWebSocket` by inheritance) | — |
| **Flow-family unit** | `pages/LiveFlow.jsx` | retired Bullflow rail; deletion is partner coordination |
| **Shim** | `pages/EducationalVideos.jsx` | 4-line re-export whose test carries assertions VideosSection's own tests lack |
| **In-flight, not this session's** | `hooks/useTapeFeed.js` | *its most recent commit is literally "revert(web): restore useTapeFeed.js — it was never mine to delete"* |
| **Specced-but-unbuilt scaffolding** | `hooks/useTickerMentions.js` | its intended mount (a "Desk" tab in TickerPopup) does not exist; wiring it to StockChart would *reverse* a deliberate error policy |

**Not recorded anywhere, found in this audit:** `pages/Confluence.jsx` (§3) and `src/App.css` (§6).

**Duplication, by kind:**
- Sorting: 5 independent implementations (§7). CSV export: 4+ (§7).
- Number formatters: 25+ across 10 modules, including two distinct `fmtVol` (§6).
- `FREE_PAGES = ['/morning-wire']` hand-copied into 3 files (§2).
- Journal `surfaces/` (9) vs `tabs/` (8) — a live dual shell (§3).
- Nine `g>x` chords declared twice (§9).
- Two drag-and-drop implementations (`@dnd-kit` vs native HTML5) (§9).

**Client-side experimental flags.** Two mechanisms:
1. **Build-time `import.meta.env.VITE_*` — 13 distinct names**, by occurrence: `VITE_CHART_RENDER_TOKEN` (14), `VITE_TWITTER_UI_ENABLED` (3), then one each of `VITE_WS_HOST` `VITE_REALTIME_BARS` `VITE_PICOVOICE_ACCESS_KEY` `VITE_MASSIVE_STREAM` `VITE_MASSIVE_CURATED_STREAM` `VITE_LAUNCH_DATE` `VITE_GRID_WARM_ENABLED` `VITE_DISCORD_CHART_APP_ID` `VITE_DESK_BG_AUDIO_ENABLED` `VITE_COMING_SOON` `VITE_CATALYST_UI_ENABLED`.
2. **Runtime `localStorage` overrides — a real, repeated pattern.** Three generations of the same idiom: `StockChart`'s bars-push gate (`uct.barsPush.enabled` + a stable per-browser bucket + `BARS_PUSH_ROLLOUT_PCT`), `journal-2-0/shellFlag.js` (`uct.j2.shell`, `J2_SHELL_ROLLOUT_PCT = 100`, `window.__uctJ2Shell('v8')`), and `journal-2-0/featureFlags.js` (a *parametrized clone* — 9 named features, all defaulting ON, `window.__uctJ2Feature(name, on)`, `useSyncExternalStore` backed, subscribing to both a same-tab `Event` and the cross-tab `storage` event, with unknown names defaulting **off** so a typo can never enable an unbuilt surface). At least 19 `uct.*` localStorage keys are read across the app, including the kill switches `uct.ssePool.disabled`, `uct.barsPool.disabled`, `uct.listprewarm.off`.

The stated reason for the runtime tier: a market-hours deploy freeze made same-day rollback impossible, so a flip had to be reversible per-browser without a deploy. `CLAUDE.md` records the freeze was **removed 2026-08-24**, so the constraint that produced this machinery no longer exists — but the machinery (and its instant-revert value) does.

**Surprisingly sophisticated / clearly built for expansion.** Three things stand out:

1. **The indicator/formula engine — `components/chart/engine/` (~30 modules) + `engine/ast/` (~50).** It is a *transpiler suite*: `ast/pine.js` (7,218 lines — TradingView Pine), `ast/thinkscript.js` (4,728 — thinkorswim), `ast/pcf.js` (1,935 — TC2000), `ast/interpret.js` (2,809 — the evaluator), `ast/dialect.js`, `ast/foreignLanguage.js`, `ast/vocabulary.js`, `ast/sentence.js`, `ast/lint.js`, `ast/trees.js`, `ast/closedTable.json` (169 KB manifest, 68 KB of it rulings), `ast/conceptVocabulary.json`, `ast/starterScans.json`, plus `defSchema.js` (2,002), `nativeRegistry.js` (2,270), `binder.js`, `pool.js`, `placement.js`, `eligibility.js`, `serverCompute.js`, `readout.js`, `paneLayout.js`. `registrySizes.js` declares the shipped catalogue by hand — 16 native (`rsi macd bb vwap stoch atr sar ichimoku mfi cci williamsR adx obv donchian avwap atrBands`) + 1 server (`rsLine`) + an **empty `ast` lane which is itself a claim**: an `ast` definition is a *user's formula*, installed per session through `installUserDefinitions` into a session index, never into the shipped catalogue. The declaration imports nothing on purpose so `nativeRegistry.test.js` can disagree with it, and an AST scan asserts none of its counts is a numeric literal.
   **This is a user-programmable indicator platform with importers for three competitor script languages, a CodeMirror editor, a linter, a share-link system, a public reference page (`/formulas/reference`) and a members' library (`/formulas/library`).** It dwarfs everything else in ambition.
2. **The `/charts` widget system** — 18 registered types, a deep-frozen registry with derived menu memberships, a drift-pinning test, four menu contexts (workspace/tab/mobile/journal), a multi-chart N×M grid mode with a staggered mount queue and container-driven warm, and a popout-window shell.
3. **The rails culture itself.** `reachable.test.js` (AST import graph, with a control proving the dynamic edge is load-bearing), `tapFloor.test.js` (a relationship, not a roster), `pollingSites.rail.test.js` (an allow-list that must shrink), `registry.test.js`, `singleWriterIndex.test.js` (derives the writer set from `StockChart.jsx`'s AST), `tokens.reachable.test.js`, `doors.route.test.jsx` (renders the real App at real hrefs), `lostDoors.route.test.jsx`. Several carry explicit **controls** proving the probe can fail — the repo has internalised `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.

**Documentation health.** `CLAUDE.md` (249 KB) is explicitly a CLAIMS document and its own "⚰️ DOCUMENTED BUT UNREACHABLE" table is the single owner of the orphan claims. Claims I checked and found **stale** at this commit:

| `CLAUDE.md` claim | Reality |
|---|---|
| "Free tier: Dashboard, Breadth, Charts, Options Flow, Journal, Model Book" | `FREE_PAGES = ['/morning-wire']` only |
| `hooks/useTapeFeed.js` **DELETED** | **exists**; restored by a revert commit; recorded in the allow-list |
| `journal-2-0/components/BrokerEquityCurve.jsx` **DELETED**, "the data outlived the renderer" | **exists and is LIVE** at `journal-2-0/components/broker/BrokerEquityCurve.jsx`, mounted in `tabs/AnalyticsTab.jsx:164` and `tabs/OpenPositionsTab.jsx:356`. The equity curve renders. |
| `UIcon` "~65-glyph registry" | **86** glyph keys |
| `UIcon` "222 import statements" | **273** files import it |
| "Nav Tabs … Calendar" | the label is **"UCT Terminal"** (the 2026-09-01 display rename) |
| Project Structure tree, and all "Trade Journal — Elite Review System" paths (`pages/journal/*`) | **`pages/journal/` does not exist**; only `journal-2-0/` |
| "table virtualization (react-virtual installed/unused)" | installed and used at 4 sites |
| `docs/brand-design-system.md` §7 "default / OLED / Dim" | there is no `Dim`; there are `[data-theme="oled"]`, `[data-theme="light"]`, and an 18-palette JS catalog |
| `docs/brand-design-system.md` §10 "ModalShell" | exists only as a CSS module in `journal-2-0/`; there is no `ModalShell` component |

Claims I checked and found **accurate**: `MobileTabBar` removed; `MoreSheet` is the single mobile menu; `BREADTH_TAB_ITEMS` (Monitor · Views · Daily · COT Data · Data Charts + admin-only Analogues); Chart.js confined to COT; the `manualChunks` object-form rationale; the widget registry / `WidgetHost` pairing.

### EVIDENCE
`grep -c "TODO|FIXME|HACK|XXX"` → 3; `find … | xargs wc -l | sort -rn`; `app/src/components/screener/reachable.test.js:250-430`; `app/src/pages/journal-2-0/featureFlags.js`, `shellFlag.js`; `grep -o "import\.meta\.env\.VITE_[A-Z_0-9]*"` → 13 names; `app/src/components/chart/engine/registrySizes.js:40-95`; `app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx:26,164` and `tabs/OpenPositionsTab.jsx:32,356`; `app/src/components/ui/UIcon.jsx`. All **CONFIRMED** by direct read.

### INTERPRETATION
This is an unusual codebase: extremely high *rail* quality, extremely low *structural* enforcement, and near-zero conventional debt markers. The result is that correctness is very well defended (a bug that ships tends to get an AST-derived rail written over it) while **shape** is not defended at all (nothing stops a 15,500-line component, five sorting implementations, or a fully-built unreachable page).

The stale-documentation pattern is worth naming precisely: `CLAUDE.md`'s own thesis is that a hand-typed enumeration beside the source that owns it goes stale, and the document proves its own thesis in at least ten places — including one where it declares a live, mounted component deleted.

### RELEVANCE TO UCT
Two inheritances matter most for TERMINAL-NEXT:
- **Inherit the rails culture.** The AST-derived reachability rail, the relationship-not-roster tap-floor rail, and the shrink-only allow-list are genuinely excellent and directly transferable.
- **Do not inherit the shape.** Terminal-Next should adopt a size ceiling, a single shortcut registry, a single data grid and a single formatter module *on day one*, because this codebase demonstrates that in the absence of enforcement, good primitives get built and then bypassed.

And the indicator/formula engine is the strategic asset. Three competitor-language importers, a session-installable user-definition lane, a share system and a paywalled library is a *platform*, not a feature — Terminal-Next's positioning should be built around it rather than beside it.

### CONFIDENCE
🟢 high for every measured count and every file-level claim (all read directly). 🟡 for the interpretation. **EVIDENCE CEILING:** I did not run the suite, so "the reachability rail is currently red on `Confluence.jsx`" and "stylelint currently emits N warnings" are NOT DETERMINED.

### RECOMMENDATION
Correct the ten stale `CLAUDE.md` / brand-doc claims listed above — particularly the `BrokerEquityCurve` row, which tells the next engineer a live feature is dead and invites them to delete or rebuild it.

### OPEN QUESTION
Was the market-hours deploy freeze's removal (2026-08-24) meant to retire the localStorage rollout-dial pattern, or is that pattern now the standing release mechanism?

---

## 12 · Test coverage shape

### OBSERVATION

**959 test files, 196,063 test lines against 285,485 source lines — a 0.69 test:source line ratio and roughly one test file per 1.16 non-test modules.** `CLAUDE.md` cites ~3,100 tests at one point and 13,629 elsewhere; I did not run the suite, so the case count is NOT DETERMINED.

**Distribution by area:**

| Area | Test files |
|---|---|
| `pages/` | 456 |
| `components/` | 432 |
| `hooks/` | 28 |
| `utils/` | 20 |
| `lib/` | 11 |
| `styles/` | 3 |
| `routes/` | 2 |
| `context/` | 2 |
| src root | 2 |
| `widgets/`, `constants/`, `__tests__/` | 1 each |

Within `pages/`: `journal-2-0` 143 · `breadth` 70 · `charts` 61 · `screener` 27 · `calendar` 27 · `desk` 15 · `research` 13 · `dashboard` 11 · `optionsFlow` 10 · `cot` 10 · `community` 4 · `formulas` 3 · `modelbook` 2 · `admin` 2 · `watchlist` 1 · `parityBars` 1.

**How components are tested.** Vitest + jsdom + `@testing-library/react`, rendered through `renderWithProviders` (MemoryRouter + AuthProvider + VoiceProvider). `global.fetch` is mocked per test; `test-setup.js` purges SWR's module-global cache *and* dedupe markers before each test so a later mount cannot silently reuse an earlier test's resolved data.

**Test *kinds*, and this is the interesting part.** Four distinct kinds coexist:

1. **Ordinary component tests** — the bulk.
2. **Route-resolution tests** that render the *real* `App` at real hrefs and assert the result is not `NotFound`: `routes/lostDoors.route.test.jsx`, `routes/liveFlowRetired.route.test.jsx`, `pages/dashboard/doors.route.test.jsx`, `pages/screener/sharedScreen.route.test.jsx`, `pages/formulas/{formulaLibrary,formulaReference,sharedFormula}.route.test.jsx`, `journal-2-0/sharedNote.route.test.jsx`.
3. **Wire tests** that mock *nothing on the path under test*, so they go red when the wire is cut while every component stays correct — `pages/Screener.scanmount.test.jsx` is the named exemplar, written after a 2026-08-08 audit found 8 features "built, tested, green, and connected to nothing".
4. **Structural rails** that read source with an AST rather than rendering anything: `components/screener/reachable.test.js` (import graph over all of `app/src`), `styles/tapFloor.test.js` (every stylesheet), `styles/tokens.{test,reachable.test}.js`, `hooks/pollingSites.rail.test.js`, `widgets/registry.test.js`, `chart/engine/__tests__/singleWriterIndex.test.js`, `chart/engine/ast/doorCoverage.test.js`, `src/__tests__/sourcesAreText.test.js`, `src/innerHtmlIdentity.test.js`.

Several rails carry explicit **controls** — an assertion that the probe can see a sibling it is not looking for — so they cannot pass for the wrong reason.

**What is untested or thin:**
- `context/` — 2 test files for two root providers (`AuthContext.test.jsx`, `VoiceContext.pageHint.test.js`). `AuthGuard`'s seven-branch gate ladder has no dedicated test file at the top level.
- `hooks/` — 28 tests for **89 hooks**: roughly two-thirds of hooks have no direct test.
- `utils/` — 20 for 28 modules.
- The three partner-owned mega-files (`OptionsFlow.jsx`, `OptionsFlow_admin.jsx`, `LiveFlowMassive.jsx` ≈ 24 KLOC) have 10 tests between them in `pages/optionsFlow/`.
- `App.test.jsx` is **532 bytes** — the 760-line route table's own smoke test is minimal; the real route coverage lives in the eight route-resolution files above.
- **No end-to-end / browser tests inside `app/`.** The browser-truth harness is `tools/mobile_audit.py` (Python Playwright), outside this scope, and `tapFloor.test.js`'s header explicitly defers to it.
- **No visual regression tests**, other than the throwaway Flip-C parity build (`vite.config.parity-bands.mjs`), which compares rendered pixels across two builds and is deleted after use.

### EVIDENCE
`find app/src \( -name '*.test.js' -o -name '*.test.jsx' \)` → 959; line counts via `xargs cat | wc -l`; per-area breakdown by `awk -F/`; `app/src/test-setup.js`; `app/src/App.test.jsx` (532 bytes); the rail files named above. All **CONFIRMED**. Pass/fail state of the suite: **NOT DETERMINED**.

### INTERPRETATION
The coverage *shape* mirrors the code's strengths and gaps exactly. Where the team has been burned — severed wires, unreachable modules, sub-44px tablet targets, drifting registries, a seventh developing-bar writer — there is a purpose-built structural rail with a control. Where nothing has visibly broken — hooks, contexts, the guard ladder — there is little. That is a rational allocation of effort, but it means coverage is *incident-shaped*: it defends against the past well and against a new class not at all.

The absence of any in-repo browser test is the sharpest gap, and the codebase knows it: `tapFloor.test.js` says in its own header that jsdom computes no layout and passing is "necessary, not sufficient", and the owner's memory carries `THE BROWSER SEES WHAT NO TEST CAN`.

### RELEVANCE TO UCT
TERMINAL-NEXT will be dense, keyboard-driven and layout-sensitive — three properties jsdom cannot measure. Its verification plan needs a browser tier from the start (the `/r/*` headless-render precedent shows the components already run outside the app shell, which makes screenshot testing cheap here). The four rail kinds above are directly reusable and should be part of Terminal-Next's definition of done, especially kind 3 (the wire test), which is the one that catches "built, tested, green, connected to nothing".

### CONFIDENCE
🟢 for the file counts and the kinds. 🟡 for "two-thirds of hooks untested" — a hook may be covered indirectly by a consumer's test, so the direct-test ratio understates true coverage.

### RECOMMENDATION
Add a browser tier for Terminal-Next (Playwright, in-repo, at 390/820/1200 px iframes per the owner's standing lesson) rather than relying on `tools/mobile_audit.py` alone.

### OPEN QUESTION
What is the actual current pass/fail state and case count of `npm test`? Every coverage judgment above is structural, not empirical, because running the suite was outside this contract.

---

## GAPS

Things within my mission that my budget or authorisation did not reach:

1. **No build, no test run, no lint run, no browser.** Consequently: real chunk sizes, whether `manualChunks` still keeps `recharts`/`tiptap` off the entry, the suite's pass/fail state and case count, stylelint's live warning count, and whether `reachable.test.js` is currently red on `pages/Confluence.jsx` are all **NOT DETERMINED**. Each is one command away (`npm run build`, `npx vitest run`, `npm run lint:css`).
2. **Per-file purpose lines for the ~590 modules in `pages/` subfolders.** I inventoried all 60 top-level pages individually and characterised each subfolder with its entry points and size, but did not write a one-liner for every file inside `journal-2-0/` (267), `charts/` (100) or `breadth/` (65). D-06 and D-09 own two of those three.
3. **`components/` subfolder depth.** I counted and characterised all 20 subfolders and read the shell, mobile, ui, dashboard and tiles layers, but did not enumerate the 138 modules in `components/chart/` or the 29 in `research-kit/` individually.
4. **Accessibility.** I recorded what I stumbled on (`TileCard`'s `role="region"` + `aria-label`, `VirtualResults`'s ARIA grid, `aria-sort` on sortable headers, no `eslint-plugin-jsx-a11y`) but did not audit a11y systematically. It is not in my question list, and it deserves its own pass for a keyboard-first terminal.
5. **Bundle composition.** Which routes pull which vendor chunks today — the config's own comment says to verify by module→chunk dump and "never by reading this list", and I read the list.
6. **Git history.** I answered no question by `git log`/`blame`; every "when did this change" statement above is sourced from a comment in the code that names a date or commit, and is therefore a CLAIM by that comment, not a verified history fact. The specific commit hashes I repeat (`4849ddc2a`, `64960303b`, `d26cee0c`, `ed53f9b6`) come from in-repo comments, unverified.
7. **CSS depth.** 87,068 lines of CSS across 386 files; I measured tokens, breakpoints, the font-family drift and the `#id` hazard, but did not audit specificity, dead selectors, or per-module size.

## NOT INSPECTED

Out of reach or out of scope, and why:

- **`api/` and everything server-side** — out of scope by contract, except three read-only greps to answer "who consumes the `/r/*` routes" (`api/routers/render_panels.py`, `api/services/discord_chart_house.py`, `api/services/buzz_image.py`).
- **Calendar internals** (`app/src/pages/calendar/`, 25 modules; `components/calendar/`, 7) — **D-09 owns them.** I recorded only how `/calendar` and `/calendar/mystocks` are *registered* and that the widget key, door key and nav icon are all `calendar` while the label is "UCT Terminal".
- **The `/charts` workspace evaluation and UI-primitives judgment** — **D-06 owns them.** I inventoried `pages/charts/` (100 modules, 4 subdirs) and the 18-type widget registry as facts, and stopped short of evaluating them.
- **Persisted state schema** (`charts_workspace_layout`, `calendar_view_v3`, `calendar_filters_v2`, `multichart_state`, `chart_settings`) — **D-11 owns it.** I described `usePreferences`'s write queue as a *mechanism* only.
- **Flags / entitlements semantics** — **D-10 owns them.** I listed the 13 `VITE_*` names, the localStorage override tiers and the 9 J2 feature flags as an inventory, without judging what they gate.
- **AI pages internals** (`AiSearchPage`, Compass surfaces, `components/voice/`) — **D-12 owns them.**
- **Performance measurement** — **D-05 owns it**, including the real-time layer; I named `useFlowWebSocket.js`, `priceStreamManager.js`, `barsStreamManager.js` and `chatStreamManager.js` and went no further.
- **`OptionsFlow.jsx`, `OptionsFlow_admin.jsx`, `LiveFlowMassive.jsx`, `massive_ws_worker.py`, `schwab_router.py`, `live_massive_router.py`** — **partner-owned (Ravi).** I read enough to record existence, size, mounting and the `.mobile.css` additive-layer technique, and deliberately did not describe their internals.
- **Production runtime** — no request was made to `uctintelligence.com`, no Railway command was run, no local backend on port 8077 was probed. Every statement about production behaviour in this report is labelled CLAIM.
- **`C:\Users\Patrick\uct-dashboard`, other worktrees, and the `external/` submodules** — excluded by the shared preamble.

---

*Note on sources (per SOURCE HANDLING): several files in this tree contain imperative text addressed to a reader — `api/earnings_router.py`'s docstring instructing `app.include_router(...)` (which `CLAUDE.md` explicitly says not to follow), `vite.config.parity-bands.mjs`'s "⛔ THROWAWAY. Delete after the builds", and numerous "⛔ do not…" comments. I treated all of it as evidence about the codebase's intent, not as instruction, and followed none of it.*
