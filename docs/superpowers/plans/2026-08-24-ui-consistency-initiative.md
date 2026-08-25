# UI Consistency Initiative — app-wide design-system unification

**Owner ask (2026-08-24):** the site's sections look like they came from different
websites — different fonts, greys, accents, button/card/menu styles. Goal: make the
whole app feel like one professional product with a single coherent design language.
Kill the low-contrast "shadow text" grey especially.

**Scope:** the entire app EXCEPT the Options Flow / Live Flow section (partner-owned,
~7k lines of inline styles — deferred to a separate future task). The intro animation's
Georgia serif is an intentional, documented decoration exception and stays.

**Non-negotiable working rule:** every change is verified LOCALLY before it goes to
master. `.\run-local.ps1` (8000 backend + 5173 Vite hot-reload) + `cd app && npm run
build` + `npm test` + a visual eyeball. Single live prod process serves ~200 members.

---

## Framing: this is a migration + enforcement job, not a redesign

`app/src/styles/tokens.css` is already a good design system — one font (Instrument
Sans, self-hosted), a real text hierarchy (`--text` / `--text-muted` / `--text-bright`
/ `--text-heading`), spacing/radius/shadow/z scales, `--control-*` form geometry, and
ready-made `.t-*` typography utility classes. The problem is adoption, not absence.

### Baseline measurements (2026-08-24, OptionsFlow excluded)
- **1,464** hardcoded `color:` declarations (raw hex/rgba) vs **2,713** tokenized →
  ~35% of all text color bypasses the system.
- The single muted-text role (`--text-muted: #8c8674`) is served by a dozen-plus
  hand-typed greys: `#a8a290`×19, `#706b5e`×12, `#9aa7b4`×10, `#6b7480`×9,
  `#8c8675`×7 (literally the token, off by one hex digit), `#7f8ea3`×7, `#8a8a8a`×6,
  `#8b96a3`×5, plus `rgba(255,255,255,0.4/0.5/0.6)`×39 (the "shadow text" ghosting).
- Fonts are mostly fine: ~18 stray monospace decls (JetBrains/IBM Plex Mono) fighting
  the "numbers render in Instrument Sans" rule; everything else already on token.
- **Bonus:** because hardcoded colors don't flip for `[data-theme="light"]`, every one
  of those 1,464 is also a light-theme bug. Tokenizing fixes consistency AND unlocks a
  real light theme at the same time.

### Tooling reality
- No stylelint yet (eslint only). The guardrail = a clean stylelint add.
- Local run + build + vitest all confirmed working.

---

## Phases

Each phase ends with a LOCAL verification gate (run app + build + tests + visual) and,
only after that passes, an optional push. Work on a **dedicated branch, ideally an
isolated git worktree** — a concurrent `feat/app-themes` session shares this clone's
working dir (see user memory), so verify branch + `git status` before any commit.

### Phase 0 — Scaffolding & inventory (no visual change)
1. Create the working branch / worktree.
2. Add `stylelint` + `stylelint-config-standard` as devDeps; add an `app/.stylelintrc`
   that flags raw hex/rgba in `color:` outside `tokens.css`. **Start in WARN/report
   mode** so it inventories without blocking the build. Add `"lint:css"` script.
3. Generate the machine map: every distinct off-token grey/white → its intended token
   (`--text` / `--text-muted` / `--text-bright` / `--text-heading`). This is the
   worklist Phase 1 executes against. Save under `docs/superpowers/` for reference.
4. Gate: `npm run build` still green; `npm run lint:css` produces the expected report.

### Phase 1 — Grey / text consolidation (the visible win)
Map every ghost-grey and low-opacity-white text color to the correct text token,
file by file. This is what makes your screenshot's "shadow text" legible app-wide.
- Handle `rgba(255,255,255,0.4-0.6)` text → `var(--text-muted)` / `--text` per role.
- Handle the ~18 mono font decls → `var(--font-sans)` (or `.t-num` for numeric cells).
- Do it in reviewable batches by area (tiles, pages, chart chrome, calendar, journal…).
- Gate per batch: local visual before/after screenshots + build + tests.

### Phase 2 — Turn on enforcement
1. Flip the stylelint rule from warn → **error** for raw `color:` hex outside
   `tokens.css`.
2. Fix any remaining stragglers to green.
3. Wire `lint:css` into the local pre-push routine so drift physically can't return.
- Gate: `npm run lint:css` clean; build + tests green.

### Phase 3 — Component primitives (buttons, cards, menus, inputs)
Adopt the existing but underused primitives so every control is one shape/style:
`--control-pad-*` / `--control-radius` / `--control-font` for inputs & buttons;
one card recipe (border/radius/shadow/surface tokens); menus already have the
`--menu-*` palette — make the stragglers use it. Consolidate button variants into a
small known set (primary / secondary / ghost / danger).
- Gate: local sweep of representative pages; build + tests.

### Phase 4 — Section-by-section visual sweep
Walk each page (Dashboard, Breadth, Charts chrome, Calendar, Journal, Model Book,
UCT20, Screener, Settings, Community, Support, Desk…), screenshot, and fix the
remaining "this looks like a different site" stragglers against the now-consistent
token base. `tools/mobile_audit.py` gives per-route screenshots without a device.

### Phase 5 — Light theme completion (falls out of the above)
With colors tokenized, audit `[data-theme="light"]` per section and fill the remaining
light-palette gaps (the `--glass-*` deferral noted in tokens.css, etc.). Largely a
verification pass rather than new work.

---

## Guardrails / do-not-regress
- OptionsFlow / Live Flow untouched (partner-owned; separate task).
- Intro animation Georgia serif stays (documented decoration exception).
- Numbers/prices stay Instrument Sans, NOT a mono stack (documented owner decision in
  tokens.css) — the mono cleanup repoints TO Instrument Sans, never away.
- `tokens.css` is the single source of truth; the whole point is that nothing else
  defines a raw color. Chart CANVAS colors (designTokens.js / chartDefaults.js) are a
  separate JS source of truth and out of CSS scope.
- Nothing to master unverified locally.
