# Rendering Parity Verification Program

**Status:** Design approved by owner 2026-09-19 (chat), spec written same day. Not yet implemented.
**Relationship to the wave sequence (C0/C1/C2C/C2D/C3A/C3B/C4/...):** this is a cross-cutting
verification program, not a new wave of the translation engine itself. It exists to
continuously PROVE what those waves built, rather than relying on one-off manual checks
(the Uncharted Clouds compounding + smoothing fixes, verified today via a single manual
TradingView capture session). It does not renumber or supersede any wave.

## 1. Problem statement

The engine's rendering primitives are correct today (verified this session, see §3 for
evidence) and the Pine-semantics library has an established vendor-fixture methodology
(`tests/fixtures/vendor/`). But three things are true at once:

- Nothing re-checks this automatically. Both existing harnesses (`tools/chart_parity.py`,
  `tools/c0_visual_journey.py`) are real and working, but only run when a human/session
  invokes them by hand.
- Nobody has a map of which Pine primitive each corpus script actually exercises — only an
  incidental sense of it.
- Comparing our rendering against TradingView's is still the fully manual capture-crop-eyeball
  process used today for Uncharted Clouds. That does not scale to "thousands" of imported
  indicators, and there's no tooling shortening the loop when a human does do it.

The goal is a state where "we have parity" rests on evidence that regenerates itself, not a
memory of a one-time check.

## 2. Goals / Non-goals

**Goals**
- **G1** — Every push touching the chart-rendering engine automatically re-verifies
  built-in-indicator rendering (via `chart_parity.py`, per-push) and the community-import
  corpus (via `c0_visual_journey.py`, nightly — see §3's scope correction on what each tool
  actually covers), with no manual invocation required to catch a regression in either.
- **G2** — A living, code-derived (never hand-typed) matrix shows which Pine primitive each
  corpus script exercises, so coverage gaps are visible rather than assumed.
- **G3** — Every primitive currently at zero/thin coverage gets a real fixture script.
- **G4** — The human-driven TradingView comparison becomes fast, repeatable tooling instead
  of an ad-hoc manual session.

**Non-goals — explicit, and why**
- **NG1 — Unattended, credential-based automation of the TradingView side.** Already
  considered and rejected by owner ruling, 2026-09-18 (`docs/pine/capture-procedure.md:1147-1150`):
  *"It never reaches the vendor: that is the owner's authenticated account, and getting there
  from a tool would mean handling the owner's credentials or borrowing their Chrome profile."*
  Independently of that ruling, entering the owner's TradingView credentials or reusing an
  authenticated session from an automated tool is outside what Claude will do under any
  instruction — this is a hard boundary, not a preference to be argued past.
- **NG2 — Verifying every future imported script against TradingView, forever.** Does not
  scale past a handful of scripts, let alone thousands. Parity for an arbitrary future import
  rests on the shared rendering engine and Pine-semantics library being trustworthy — proven
  by this program's corpus and coverage matrix — not on re-checking each new script against
  the vendor individually.
- **NG3 — Pixel-exact numeric color matching against TradingView.** Pine computes fill colors
  at runtime and TradingView exposes no API to read another script's computed values back.
  Shape, smoothness, and color-family parity are the honest, verifiable bar (established this
  session: a light/dark theme mismatch alone can look like a color bug and isn't one).

## 3. Evidence gathered before writing this spec

(So this spec isn't re-derived from guesses. Each claim below was independently checked
2026-09-19, not assumed from a doc.)

- **Engine primitive coverage is essentially complete.** `presentation.js:97-98`
  (`RESTYLEABLE_DEF_STYLES` = line/stepline/histogram/area/baseline/markers),
  `presentation.js:90-95` (band/fill), `presentation.js:33-41,84` (candles),
  `markerPrimitive.js:5,29,32` (plotshape/plotchar/plotarrow), `ast/pine.js`
  (bgcolor/barcolor/plotcandle/plotbar, with dedicated tests), `ast/pineObjects.js:88`
  (`OBJECT_NAMESPACES` = line/label/box/table/linefill — all 5 Pine drawing-object types).
  Nothing Pine can express is rejected by the engine today. The gap is in the **test corpus**,
  not the engine.
- **The corpus is ~23 unique scripts, not ~38.** `tools/c0_oos_fixtures/` (18),
  `c0_parity_fixtures/` (10), `c3a_parity_fixtures/` (10) — but the two "parity" directories
  are ~90% the same files as `c0_oos_fixtures`. Any coverage accounting must dedupe by
  content/title, not count files across directories.
- **Current per-primitive coverage, read from actual script source (not filenames):**
  `plot`/line ~23, `bgcolor` 15, `fill()` 14, `plotshape` 12, `label.new`/`table.new` 9 each,
  `hline` 6, `line.new` 5, `plotcandle`/`barcolor` 4 each, histogram-style 4, `box.new` 4,
  `plotchar` 2, `style_circles` 2, `linefill.` 2, **`style_stepline` 1**, **`plotbar` 1**,
  **`plotarrow` 0**, **explicit `style_area` 0**, `baseline` unchecked (open, not confirmed zero).
- **`tools/chart_parity.py` exists, works, and tests a different thing than this spec
  originally assumed — corrected during plan-writing, not caught earlier.** It is Phase B's
  **built-in-indicator legacy-vs-engine migration gate**: its 53-case `chart_parity_cases.json`
  is 51 built-in migrations (RSI, BB, MACD, VWAP, Stochastic, ATR, SAR, Ichimoku, MFI, CCI,
  Williams %R, ADX, OBV, Donchian) and only 2 touching arbitrary user formulas. **Zero cases
  reference any script from `c0_oos_fixtures/`, `c0_parity_fixtures/`, or
  `c3a_parity_fixtures/`.** Its `diff()` (`:1299-1377`) does exact/near-exact per-channel
  pixel comparison (`ImageChops.difference`, max across R/G/B, threshold default 0) — correct
  for same-engine determinism checking, and correct for what it actually tests. Two renders
  of the same script on two different PLATFORMS (different fonts, AA, DPI, compression,
  watermarks) will never be near-pixel-identical regardless, so this comparator was never
  usable for vendor comparison either way; that conclusion holds independent of the scope
  correction. **Consequence:** wiring this tool into CI (§4.2) gives real, valuable per-push
  protection for built-in-indicator migrations — it does NOT give per-push protection for the
  community-import corpus. That corpus is currently only exercised by the nightly
  `c0_visual_journey.py` run. Extending `chart_parity_cases.json` with corpus-derived cases
  (the existing `instancesB`/`ast_user_formula_*` pattern already supports this) would close
  that gap and is real, valuable follow-on work — deliberately not folded into this program's
  first pass, called out here so it isn't mistaken for already covered.
  No perceptual-comparison library exists in this repo's dependencies today
  (`requirements.txt:60-62` has numpy/scipy/Pillow only, no scikit-image/imagehash/opencv).
- **`tools/c0_visual_journey.py` requires a full local stack.** `:884` — `--base` is
  required with no default (its own usage example, `:70`, is `http://127.0.0.1:18500`, a
  local sandbox); it logs in via a dedicated local test account (`gj_automation@local.dev`,
  `:887-888`). Full backend+frontend required — this is the heavier of the two harnesses.
- **`tools/chart_parity.py` is lighter.** `--base-a` defaults to `http://localhost:5173`
  (a bare `vite dev` server, `:1765`), Playwright-driven (`:130`) against a headless
  render-only route, no login and no backend required.
- **CI convention confirmed.** `tools/promotion_gate.py:35-62` — every `.github/workflows/*.yml`
  file needs `# promotion-gate: yes|no` in its first 40 lines or `promote-production.yml`
  refuses ALL promotions repo-wide (already happened once, to `full-suite-report.yml`, per
  that file's own header). A new check should ship `no`/report-only, mirroring
  `full-suite-report.yml`'s own precedent exactly (`continue-on-error: true`, triggers on
  push/PR/workflow_dispatch, publishes to the `ci-results` branch rather than blocking).
- **Task Scheduler convention confirmed.** No committed "create task" script exists — task
  registration has always been a one-time manual step, named `"UCT <Program> <Verb>"`, with
  `Register-ScheduledTask`/`Set-ScheduledTask` (not legacy `schtasks /create`) used for
  re-arming (`docs/runbooks/rth-scheduling.md:225`).

## 4. Architecture

### 4.1 Primitive coverage matrix (build first — no infra dependencies, unlocks visibility immediately)

New script `tools/pine_primitive_coverage.py`:
- Derives the canonical primitive list **from the engine source itself** (the files in
  §3), never hand-typed — this repo has a well-documented, repeated defect class where a
  hand-typed count or list drifts from the array it claims to describe.
- Parses every corpus script's actual Pine source (not filename) for which primitives it
  uses, dedupes the corpus by content/title first.
- Emits a matrix (primitive × script, plus per-primitive counts) as a markdown report
  (checked into `docs/pine/`) and a machine-readable JSON.
- A test/rail that fails if any primitive's coverage count is zero, so a future corpus
  change can't silently drop the only script exercising something. Mutation-proved: remove
  a primitive's sole fixture, confirm red; restore it, confirm green.

**Immediate action from today's audit:** write 3-4 new minimal fixture scripts targeting
`plotarrow` (currently 0), explicit `style_area` (currently 0), and one more each for
`plotbar`/`style_stepline` (currently 1 each) — real, minimal Pine scripts exercising
exactly that construct, not scripts borrowed from elsewhere and hoped to qualify. Re-run
the matrix afterward and confirm a floor of ≥2 scripts per primitive.

### 4.2 Continuous self-regression (CI)

New workflow, report-only per §3's confirmed convention:
- Runs `tools/chart_parity.py` against a `vite dev` server started in-workflow — fast,
  no backend, no login. Triggers on push/PR touching the chart engine directory and the
  harness scripts themselves.
- `# promotion-gate: no` on line 1, a `name:` GitHub will report on, `continue-on-error: true`.
- `tools/c0_visual_journey.py`'s full-stack requirement (backend + sandboxed login) is
  heavier — **open decision, see §6 OD1** — likely a nightly job rather than per-push,
  and possibly local (Task Scheduler) rather than in CI depending on what the backend needs
  to boot safely in a runner.

### 4.3 Vendor-comparison tooling (human-in-the-loop, made fast)

New script `tools/vendor_parity_capture.py`. The human still opens and authenticates the
TradingView chart themselves — that boundary from §2 NG1 does not move. What the tool
automates is everything around that:
- Drives our own side via Playwright, the same pattern `pine_member_pane_capture.py`
  already uses successfully (its own page, its own viewport, immune to the OS-occlusion
  class documented in `capture-procedure.md`).
- Takes the human-provided TradingView screenshot (same manual step as today) and the
  matching crop coordinates.
- Runs a **structural/perceptual** comparison — SSIM via a new dependency, `scikit-image`
  (see §6 OD2) — never `chart_parity.py`'s exact-pixel comparator, per §3's evidence.
- Flags by threshold for human review rather than hard pass/fail — a comparator that
  auto-fails on vendor-rendering noise (font AA, JPEG compression) gets ignored within a
  week; a comparator that can't fail on a real divergence isn't a comparator.
- Writes a dated report (image pair + similarity score + verdict) to `docs/pine/capture/`,
  following the existing naming convention there.

This turns a session like today's — which took real back-and-forth to capture, crop, and
compare one indicator — into a few-command operation. It does not make the vendor side
unattended, and is not intended to.

## 5. Testing strategy

- Every new script gets its own test file, matching this repo's near-universal pattern.
- The coverage-matrix rail is mutation-proved (§4.1).
- The new CI workflow gets a manual `workflow_dispatch` verification run before anything
  depends on it — a workflow nobody has seen actually fire is not a working workflow.
- `vendor_parity_capture.py`'s comparator gets a non-vacuity control (two genuinely
  different images must score as different) alongside its determinism check (the same
  image pair scores identically twice) — the same shape of control `chart_parity.py`
  already uses for its own comparator (`--perturb-b`).

## 6. Open decisions

- **OD1** — Does `c0_visual_journey.py`'s full-stack run (real backend + sandboxed login)
  run inside GitHub Actions, or does it stay a local/Task-Scheduler job? Depends on whether
  the backend can boot with test-safe env vars inside a CI runner. First implementation
  step should be a quick feasibility spike on this, before committing to either path.
- **OD2** — Add `scikit-image` as a new dependency for perceptual comparison, rather than
  hand-rolling SSIM against existing scipy. Recommended (mature, standard, small surface),
  but it is a new dependency and gets called out rather than added silently.

## 7. Risks

- **RISK-011** (existing, `RISK_REGISTER.md`) — fast synthetic typing into the Pine
  Import paste textarea can hang the browser tab. Relevant if any new tooling here ever
  scripts input into that same textarea; paste-equivalent value-set was confirmed clean.
- Corpus duplication (§3) means a naive "count files" approach to coverage will overstate
  it — the coverage script must dedupe by content, not path.
- Scope discipline: it is easy for "primitive coverage" to creep into "every possible Pine
  construct" (functions, not just visual primitives). This program is scoped to **visual
  rendering primitives** only — Pine-semantics (`ta.*` function) coverage is the existing,
  separate `tests/fixtures/vendor/` methodology and is not re-scoped by this doc.

## 8. Sequencing

1. Primitive coverage matrix + report (§4.1) — fastest, no infra dependencies.
2. Fill the four identified coverage gaps with new fixture scripts.
3. CI wiring for `chart_parity.py` self-regression (§4.2), report-only.
4. Resolve OD1; wire the scheduled full-journey run accordingly.
5. `vendor_parity_capture.py` (§4.3) — buildable today; proving it end-to-end still
   requires one real human-driven TradingView capture session, same as today.
