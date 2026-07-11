# Journal 2.0 A+ — P5: Capstone (Playbook Adherence + Regime + Psychology) + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the capstone — "Your edge, by market regime — no other journal can do this" — by adding per-setup **rules + per-trade adherence**, a **regime** win-rate section (surfacing the already-captured `j2_trades.regime` + backfill), and a **Psychology** section (emotion×outcome, cost-of-mistakes, revenge/tilt), each behind its own runtime flag; plus polish (trade-card PNG, Edge-card PNG, notebook templates, day-stats header, Trades pagination).

**Architecture:** Builds on the P4 nav (Insights hub sub-nav already has Psychology + Regime **placeholders** to replace; PlaybookSection already renders setup cards). Adherence rides a new `j2_trade_adherence` side-table keyed by the stable `trade_ref` (mirroring the P2 excursions store), with the checklist mounted in the P1b Trade page's "story" section. Regime is **already stamped** on new manual trades (`j2_trades.regime`, `green/amber/orange/red`) — P5 surfaces it (add to `_TRADE_COLS`/`_row_to_trade`), backfills historical/broker trades from `breadth_monitor` day history reclassified through `regime.classify_regime`, and adds a `_regime_section`. Psychology adds a coverage-gated `_psychology_section` to `analytics.py` (mirroring `_exit_quality_section`) reading `j2_trades` mistake/emotion tags + ISO timestamps for revenge timing. Each feature ships behind a `shellFlag.js`-style per-feature runtime flag for instant rollback during the market-hours deploy freeze. Two ship milestones: **A** (capstone trio) then **B** (polish).

**Tech Stack:** FastAPI + SQLite (`j2_*` tables, `auth.db`), React + Vite SPA, ECharts, the P3 `ConfidenceStat` + Insights hub, the existing `TagChipPicker` + `PATCH /api/j2/trades/{id}`, `chartScreenshot.js` canvas export, TipTap notebook.

## Global Constraints

Every task's requirements implicitly include this. Values from the approved spec (`docs/superpowers/specs/2026-07-09-journal-a-plus-design.md` §7/§9) + research file:line facts.

- **Per-feature runtime flags (spec §182 rollback):** each capstone feature (adherence · regime · psychology · trade-PNG) ships behind its own runtime flag cloned from `shellFlag.js` (localStorage override + rollout const + `window.__uct…()` handle + `useSyncExternalStore` hook) so it can be reverted per-browser instantly without a deploy. Backend analytics additions are additive keys (absent-key-safe on the FE); the FE gates rendering on the flag. Default the capstone flags ON at ship (they're additive + reviewed) but keep the instant-revert handle.
- **Regime labels are `green/amber/orange/red`** (AMBER, not yellow) — match `settings.py` `_VALID_REGIME_KEYS`. Regime is captured ONLY on new manual/live trades (`trades.py` create paths); **broker + historical imports store `regime = NULL`** — every regime aggregate MUST have an explicit `unknown`/NULL bucket and never miscount NULL as a real regime. Backfill NULLs from `breadth_monitor` day history reclassified via `regime.classify_regime`.
- **Coverage-gated honesty everywhere (the P2 pattern):** adherence %, emotion×outcome, revenge, tilt, cost-of-mistakes all follow `_exit_quality_section`'s shape — return aggregate `None` + populated `coverage`/counts when the sample is thin, so the FE renders "computed from N of M" / "requires execution times" / "tag your trades" — NEVER a fake number or a broken chart. Reuse `ConfidenceStat` (n<10 threshold=10) for every stat cell.
- **Revenge detector guardrails (spec §7):** requires **≥2 corroborating signals** (a loss + a re-entry on the same symbol + within X minutes); **skips rows without a real time component** (`_is_date_only()` true → exclude); shows **"requires execution times"** on manual accounts whose trades are date-only (never a falsely-clean zero); a per-flag **"not revenge" dismissal** feeds a suppression list. Tilt = a small corner **glyph** on calendar day cells (shape-distinct from the P&L color, one per cell, colorblind-safe, UIcon not emoji).
- **Adherence side-table keyed by `trade_ref`** (`ext:external_id`/`id:row_id`, `trade_refs.py`) — NOT the volatile trade `id` (broker resync mints fresh uuids). Mirror `excursions_store.py` (composite PK `(user_id, trade_ref)`, INSERT OR REPLACE, `list_…_for_user` → `{trade_ref: dict}`). The Trade page's optimistic `patchTrade` PATCHes `/api/j2/trades/{id}`; adherence writes via a dedicated endpoint keyed by the resolved `trade_ref`.
- **Scoping decisions (research-grounded, documented — NOT gaps):** (1) the JOURNAL day-page (`DayDetailPage`) is ALREADY functionally unified (metrics + trades + reflection + attachments + rules render today) — P5 does NOT rebuild it; a light consolidation of the three note-writing components is optional polish only. (2) The full TRADES one-table merge (open positions vs closed trades share only ~4/16 columns, semantically disjoint) is DEFERRED — P4's `?seg=` segmented UX stays; P5 adds only the `All` segment + server-side pagination (the useful part). (3) The Edge Score card + `ConfidenceStat` are ALREADY shipped (P3) — P5 only adds a PNG export to the Edge card. Do NOT rebuild these.
- **No emoji** (UIcon). **Broker merge invariant:** `grep -c broker_sync api/main.py` ≥ 7 before push. **Additive only:** Journal 1.0 is already fully removed from disk; touch only `journal_two`/`journal-2-0`. New `j2_*` tables/columns via `_PHASE_2_ALTERS`/`_J2_SCHEMA` (`IF NOT EXISTS`, idempotent).
- **Baseline test state:** ~20 pre-existing backend failures (15 `test_options` + 5 `test_coach_chat_tools`; +3 `test_interventions` flap by wall-clock). NEVER attribute to P5.
- **Ship window** ≥4:20 PM ET / <9:15 AM ET; owner authorized override for this initiative. Per-feature flags are the real safety net.

---

# MILESTONE A — Capstone trio: Adherence + Regime + Psychology

Ships as one deployable slice. Announcement: "Your edge, by market regime — plus the discipline and psychology behind it."

---

### Task A1: Per-feature runtime flag module

**Files:** Create `app/src/pages/journal-2-0/featureFlags.js` + `featureFlags.test.js`

**Interfaces:** a parametrized clone of `shellFlag.js`. Export, per feature (`adherence`, `psychology`, `regime`, `tradePng`): a `useFeatureFlag(name)` hook (default ON), `setFeatureFlag(name, on)`, and `window.__uctJ2Feature(name, on)` DevTools handle. localStorage key `uct.j2.feature.<name>` (`'1'`/`'0'`), same-tab event + `useSyncExternalStore` so a flip re-renders consumers. A `FEATURE_DEFAULTS = {adherence:true, psychology:true, regime:true, tradePng:true}`.

**Context:** Research: `shellFlag.js` is the exact template (localStorage override + event + `useSyncExternalStore` + window handle). Each capstone surface gates its render on `useFeatureFlag('…')` so a misbehaving feature reverts per-browser instantly (market-hours freeze). Backend stays additive; the flag is FE-only.

- [ ] **Step 1: Write `featureFlags.test.js`** — default ON; `setFeatureFlag('psychology', false)` → `useFeatureFlag('psychology')` false + event fires; `window.__uctJ2Feature` present; unknown name safe.
- [ ] **Step 2: Run, verify fail.** `cd app && npx vitest run src/pages/journal-2-0/featureFlags.test.js`
- [ ] **Step 3: Implement** (mirror shellFlag).
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p5): per-feature runtime flag module (mirrors shellFlag)`

---

### Task A2: Rules-per-setup schema + settings UI

**Files:**
- Modify: `api/services/journal_two/settings.py` (add `setupRules` field + validation)
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx` (TRADE SETUPS section ~line 897 — per-setup rule editing)
- Test: `api/services/journal_two/test_settings.py` + a FE test if practical

**Interfaces:** settings gains `setupRules: { [setupName]: [{id, label}] }` (a per-setup list of rule labels — the checklist template for that setup). Validation: `_validate_setup_rules` mirroring `calendar.py::_validate_rules` (`{id: str, label: str}` shape, cap per setup, drop rules for non-existent setups). The modal's TRADE SETUPS section: each setup row can expand to add/remove its rules (reuse the day-rules add/remove pattern). Rules are `{id, label}` (no `checked` — checked state lives per-trade in the adherence record).

**Context:** Research: `setups` is a plain `list[str]`; rules-per-setup is greenfield. Copy the `{id,label,checked}` shape from `calendar.py:911-931` (drop `checked` here — that's per-trade). `crypto.randomUUID()` for ids (as `DayRulesChecklist` does).

- [ ] **Step 1: Write failing tests** — `_validate_setup_rules` accepts `{VCP:[{id,label}]}`, rejects bad shapes, drops rules for setups not in `setups`; settings round-trips `setupRules`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (settings field + validation + modal editor).
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): rules-per-setup config (setupRules in settings + TRADE SETUPS editor)`

---

### Task A3: `j2_trade_adherence` side-table + store + write endpoint

**Files:**
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS` — new `j2_trade_adherence` table)
- Create: `api/services/journal_two/adherence_store.py` (CRUD, mirror `excursions_store.py`)
- Modify: `api/routers/journal_two.py` (`GET/PUT /trades/{trade_id}/adherence`)
- Test: `api/services/journal_two/test_adherence_store.py`

**Interfaces:**
- Table `j2_trade_adherence`: PK `(user_id, trade_ref)`, cols `setup TEXT, checked_rule_ids TEXT (JSON array), total_rules INT, adherence_pct REAL, updated_at`. (adherence_pct = checked/total; stored for cheap aggregate joins.)
- `adherence_store.py`: `upsert_adherence(user_id, trade_ref, setup, checked_ids, total_rules)`, `get_adherence(user_id, trade_ref)` (camelCase), `list_adherence_for_user(user_id) → {trade_ref: dict}`, `existing_refs`.
- Routes: `GET /api/j2/trades/{trade_id}/adherence` (resolve trade→trade_ref, return the record or null) + `PUT /api/j2/trades/{trade_id}/adherence` body `{setup, checkedRuleIds, totalRules}` → upsert, returns the record. Auth `get_current_user`, user-scoped.

**Context:** Research: mirror `excursions_store.py` exactly (composite PK, INSERT OR REPLACE, `{trade_ref: dict}`). `trade_ref_for_row` resolves the stable key. The Trade page resolves trade→ref via `get_trade_detail(...)["tradeRef"]` (as attachments do).

- [ ] **Step 1: Write failing tests** — upsert + get round-trips; adherence_pct computed; list keyed by trade_ref; user-scoped (2-user isolation); route resolves trade→ref.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** `feat(j2-p5): j2_trade_adherence side-table + store + PUT/GET endpoints`

---

### Task A4: Trade-page adherence checklist

**Files:**
- Modify: `app/src/pages/journal-2-0/components/trade/TradeDetailPage.jsx` (add an Adherence card in "the story" section ~460-519)
- Create: `app/src/pages/journal-2-0/components/trade/AdherenceChecklist.jsx` + test
- Create: `app/src/pages/journal-2-0/hooks/useJ2Adherence.js` (SWR over the A3 endpoint)

**Interfaces:** in the Trade page's story section, an Adherence card: given the trade's `setup`, look up that setup's rules from `settings.setupRules[setup]`, render each as a checkbox; the checked set persists via `PUT /trades/{id}/adherence` (optimistic, like `patchTrade`); shows "N of M rules followed → adherence X%". When the setup has no rules configured → a muted "Define rules for {setup} in Settings" affordance. Gated on `useFeatureFlag('adherence')`.

**Context:** Research: mounts in `TradeDetailPage.jsx:460-519` (already has TagChipPicker + optimistic PATCH patterns to mirror). Reads `settings.setupRules` (A2). No emoji.

- [ ] **Step 1: Write `AdherenceChecklist.test.jsx`** — renders the setup's rules; checking one PUTs the adherence; shows adherence %; no-rules → the Settings affordance; flag-off → hidden.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement + wire into TradeDetailPage.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): Trade-page adherence checklist (rules-per-setup, writes adherence)`

---

### Task A5: Adherence % + adherence-vs-expectancy on setup cards

**Files:**
- Modify: `api/services/journal_two/playbook_stats.py` (join adherence like exit-eff; add `adherence`, `adherenceCoverage`, `adherenceVsExpectancy`)
- Modify: `app/src/pages/journal-2-0/components/insights/PlaybookSection.jsx` (add an Adherence ConfidenceStat cell + the split)
- Test: `api/services/journal_two/test_playbook_stats.py` (extend) + PlaybookSection test

**Interfaces:** `playbook_stats._setup_record` gains `adherence` (mean adherence_pct over the setup's trades that HAVE an adherence record), `adherenceCoverage {eligible, computed}` (coverage-gated like exit-eff), and `adherenceVsExpectancy` ({adhered:{expectancy,n}, notAdhered:{expectancy,n}} — bucket the setup's trades by adhered [≥ some threshold, e.g. adherence_pct ≥ 0.8] vs not, compute expectancy per bucket). PlaybookSection adds an "Adherence" `ConfidenceStat` cell (coverage-gated identically to Exit Eff.) + a small "adhered vs not" expectancy line.

**Context:** Research: the exit-eff join (`playbook_stats.py:118-173`) is the exact template — `list_adherence_for_user` → `{trade_ref: dict}`, join per row via `trade_ref_for_row`. The card cell mirrors the Exit Eff. cell (`PlaybookSection.jsx:182-196`).

- [ ] **Step 1: Write failing tests** — seed a setup with adherence records; assert adherence mean + coverage + the adhered-vs-not expectancy split; null when no adherence records.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): per-setup adherence % + adherence-vs-expectancy on Playbook cards`

---

### Task A6: Surface `j2_trades.regime` + historical backfill

**Files:**
- Modify: `api/services/journal_two/trades.py` (`_TRADE_COLS` + `_row_to_trade` add `regime`)
- Create: `api/services/journal_two/regime_backfill.py` (reclassify breadth_monitor day history → per-day regime; backfill NULL-regime trades)
- Modify: `api/routers/journal_two.py` (`POST /admin/regime-backfill`, admin, gated)
- Test: `api/services/journal_two/test_regime_backfill.py`

**Interfaces:**
- `_TRADE_COLS` + `_row_to_trade` expose `regime` (the already-stamped column). Absent/NULL → `regime: null`.
- `regime_backfill.py`: `build_regime_by_day()` — reads `breadth_monitor.get_history(days)` per-day exposure score, reclassifies via `regime.classify_regime` → `{date: 'green'|'amber'|'orange'|'red'}`. `backfill_regime(user_id=None, force=False)` — for trades with `regime IS NULL`, look up the trade's `trading_day_et` (or exit_date prefix) in the regime-by-day map + UPDATE. Bounded, idempotent. (Broker/historical trades gain a best-effort regime; days with no breadth history stay NULL/`unknown`.)
- `POST /api/j2/admin/regime-backfill` (require_admin, `?limit=`).

**Context:** Research: `j2_trades.regime` exists + written at entry (trades.py) but NOT surfaced (`_TRADE_COLS`/`_row_to_trade` omit it). Backfill source = `breadth_monitor.py` `breadth_snapshots`/`get_history` reclassified via `regime.classify_regime` (labels green/amber/orange/red). Broker imports = NULL by design.

- [ ] **Step 1: Write failing tests** — `_row_to_trade` includes regime; `build_regime_by_day` maps exposure→label; `backfill_regime` fills a NULL-regime trade from the day map + leaves genuinely-unknown days NULL; idempotent.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + confirm broker_sync grep unaffected.**
- [ ] **Step 5: Commit** `feat(j2-p5): surface j2_trades.regime + breadth-history regime backfill + admin endpoint`

---

### Task A7: Regime win-rate analytics + RegimeSection

**Files:**
- Modify: `api/services/journal_two/analytics.py` (`_regime_section`; add to `get_analytics` return + `_fetch_trades` SELECT `regime`)
- Create: `app/src/pages/journal-2-0/components/insights/RegimeSection.jsx` + test
- Modify: `app/src/pages/journal-2-0/components/insights/InsightsHub.jsx` (replace the Regime `ComingSoon` placeholder ~103-109)

**Interfaces:** `analytics._regime_section(rows)` → `{ byRegime: [{regime, tradeCount, winRate, avgR, expectancy}], unknownCount }` bucketing closed trades by `regime` (green/amber/orange/red + an explicit `unknown` for NULL). Coverage/confidence: each bucket carries `tradeCount` so the FE grays n<10 (ConfidenceStat). `RegimeSection` renders ONE "win rate by regime" bar (the spec's slimmed scope — no matrix), color-coded by regime, with an "unknown" bucket labeled honestly + an inline "What are regimes?" popover. Replaces the InsightsHub Regime placeholder. Gated `useFeatureFlag('regime')`.

**Context:** Research: analytics.py has ZERO regime code (greenfield); `_fetch_trades` must SELECT `regime`. Mount = `InsightsHub.jsx:103-109` placeholder. Labels green/amber/orange/red + unknown. "since regime history began" honesty label (regime capture started at P2-era; backfill fills the rest).

- [ ] **Step 1: Write failing tests** — seed trades across regimes + NULL; `_regime_section` buckets correctly with an unknown bucket; RegimeSection renders the bar + grays n<10 + shows the popover.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): win-rate-by-regime analytics + RegimeSection (Insights hub)`

---

### Task A8: Psychology analytics — `_psychology_section`

**Files:**
- Modify: `api/services/journal_two/analytics.py` (`_psychology_section`; `_fetch_trades` SELECT `mistake_tags, emotion_tags, entry_date, exit_date`)
- Create: `api/services/journal_two/revenge_detect.py` (the time-gated revenge detector, pure)
- Test: `api/services/journal_two/test_psychology_section.py` + `test_revenge_detect.py`

**Interfaces:** `analytics._psychology_section(rows)` → coverage-gated (mirror `_exit_quality_section`):
- `emotionOutcomes`: per distinct emotion tag → `{emotion, tradeCount, avgPnl, winRate}` (≥3-trade display gate per emotion — return but flag thin).
- `costOfMistakes`: `{total: Σ pnlDollarNet over trades with non-empty mistake_tags, byMistake: [{mistake, total, count}]}`.
- `revenge`: from `revenge_detect.detect(rows)` — pairs (a losing trade → a re-entry on the SAME symbol within X minutes), requiring ≥2 corroborating signals, SKIPPING rows without a real time component (`_is_date_only`). Returns `{flags: [{symbol, tradeRefs, minutesApart}], timeComponentCoverage: {timed, total}}`. When most trades are date-only → the FE shows "requires execution times."
- `tilt`: a per-ET-day tilt signal (e.g. a day with ≥N losses in rapid succession, or a revenge flag) → `{byDay: {date: tiltLevel}}` (feeds A10's calendar glyph).
- `revenge_detect.py`: pure function over rows with parsed ISO instants; a `suppressed_pairs` param (the dismissal suppression list) excludes dismissed pairs.

**Context:** Research: greenfield; mirror `_exit_quality_section` coverage gating (`analytics.py:615-729`). Revenge needs entry_date/exit_date ISO instants (time only when `_is_date_only` false). Cost-of-mistakes = pnlDollarNet over tagged trades. Mistake vocab includes `revenge`.

- [ ] **Step 1: Write failing tests** — emotionOutcomes per-emotion avg/winRate + ≥3 gate; costOfMistakes sums net over tagged; revenge detects a same-symbol timed re-entry-after-loss, SKIPS date-only rows, honors suppression; tilt byDay.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** `feat(j2-p5): coverage-gated psychology analytics (emotion×outcome, cost-of-mistakes, revenge, tilt)`

---

### Task A9: Psychology section frontend + dismissal

**Files:**
- Create: `app/src/pages/journal-2-0/components/insights/PsychologySection.jsx` + `.module.css` + test
- Modify: `app/src/pages/journal-2-0/components/insights/InsightsHub.jsx` (replace Psychology placeholder ~96-102)
- Backend (small): a revenge-dismissal endpoint `POST /api/j2/psychology/dismiss-revenge` writing a suppression list (a tiny `j2_revenge_dismissals` table or a settings field) — OR store dismissals client-side (localStorage) for v1 if simpler; document.

**Interfaces:** `PsychologySection` reads `analytics.psychology` (A8) + renders 3 panels: (1) Emotion×Outcome — a horizontal bar of avg P&L by emotion (green/red, ≥3-trade gate, tooltip win-rate+count); (2) Cost of Mistakes — the headline $ + a per-mistake breakdown; (3) Revenge/Tilt — the revenge flags with a per-flag "Not revenge" dismissal (→ suppression) + a "requires execution times" honest state on date-only/manual accounts. Empty state (import-only, all-untagged) → the designed pitch card (A11 launches the rapid-tag flow). Gated `useFeatureFlag('psychology')`. No emoji; ConfidenceStat for gated cells.

**Context:** Research: mount = `InsightsHub.jsx:96-102`. Mirror the deleted-J1 3-panel spec (emotion×outcome matrix + ≥3 gate). The zero-data pitch card style is in `TodayZeroData.jsx`.

- [ ] **Step 1: Write failing tests** — 3 panels render from mocked analytics.psychology; ≥3-emotion gate grays thin; "Not revenge" dismiss fires; date-only account → "requires execution times"; all-untagged → pitch card; flag-off → hidden.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement (+ the dismissal persistence).**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): Psychology section (emotion×outcome, cost-of-mistakes, revenge/tilt + dismissal)`

---

### Task A10: Tilt glyph on calendar day cells

**Files:**
- Modify: `api/services/journal_two/calendar.py` (day bucket gains a `tilt` flag from that day's trades)
- Modify: `app/src/pages/journal-2-0/components/calendar/DayCell.jsx` (a corner tilt glyph)
- Test: calendar test + DayCell test

**Interfaces:** `calendar.py`'s per-day bucket (`_aggregate_trades` ~164-224) gains `tilt: bool` (or `tiltLevel`) computed from that ET-day's trades (reuse the A8 tilt logic / revenge signal — e.g. a day carrying a revenge flag or ≥N rapid losses). `DayCell` renders a small colorblind-safe UIcon glyph in the `.head` badge row when `day.tilt`, shape-distinct from the P&L color tint, one per cell, with a title/aria "tilt day." Gated `useFeatureFlag('psychology')` (tilt is a psychology signal).

**Context:** Research: `DayCell.jsx:55-84` badge row is the home; the day payload has no tilt field today (`calendar.py:164-224`) — P5 adds it. Colorblind-safe + shape-distinct (not a second color ring). No emoji.

- [ ] **Step 1: Write failing tests** — a day with the tilt signal gets `tilt:true` in the bucket; DayCell renders the glyph (with aria) when tilt, not otherwise; flag-off → no glyph.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): tilt glyph on calendar day cells`

---

### Task A11: Rapid-tag empty-state flow

**Files:**
- Create: `app/src/pages/journal-2-0/components/psychology/RapidTagFlow.jsx` + test
- Modify: `PsychologySection.jsx` (the empty-state pitch card launches it)

**Interfaces:** a modal/sheet that walks the user's last ~20 closed trades (from `GET /api/j2/trades`, newest-first), each with a `TagChipPicker` for mistake + emotion tags, PATCHing one trade at a time (`PATCH /api/j2/trades/{id}` accepts mistakeTags/emotionTags) with a "Skip"/"Next" flow. On completion, revalidate `/api/j2/analytics` so Psychology "comes alive." The launch pitch card ("Tag your last 20 trades — 2 minutes — and this section comes alive") lives in PsychologySection's empty state.

**Context:** Research: greenfield UI, backend ready (PATCH accepts tags). Reuse `TagChipPicker` + the optimistic PATCH pattern. Empty-state detection = closed trades exist but all `mistakeTags==[] && emotionTags==[]`.

- [ ] **Step 1: Write failing tests** — the flow lists trades; tagging one PATCHes; Next advances; completion revalidates analytics; the pitch card launches it.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): rapid-tag flow (tag last 20 trades) + Psychology empty-state pitch`

---

**MILESTONE A SHIP GATE:** full backend suite (20-baseline shape), FE `journal-2-0` + `lib/journal-2-0` suites, `npm run build`, `grep -c broker_sync api/main.py` ≥ 7, `python -c "import api.main"`. Whole-branch adversarial review + fix pass. Rebase onto `origin/master`, re-verify, push. Verify deploy (health swap; `/admin/regime-backfill` auth-gated). **Run the regime backfill in prod** (`POST /api/j2/admin/regime-backfill`) so historical/broker trades get a regime. Announcement: "Your edge, by market regime + the discipline behind it."

---

# MILESTONE B — Polish: trade-card PNG + Edge PNG + notebook templates + day-stats + Trades pagination

---

### Task B1: Trade-card PNG export

**Files:**
- Create: `app/src/pages/journal-2-0/lib/tradeCardPng.js` (canvas-draw a dark/gold trade card)
- Modify: `app/src/pages/journal-2-0/components/trade/TradeDetailPage.jsx` (a "Save as image"/"Copy image" action)
- Test: `tradeCardPng.test.js` (jsdom canvas mock) + FE

**Interfaces:** `renderTradeCardPng(trade) → Promise<Blob>` — an offscreen canvas hand-drawing a branded dark/gold card (mirror `app/src/components/chart/chartScreenshot.js::composeScreenshot`: UCT gold `#c9a84c`, "UCT INTELLIGENCE", tagline) with the trade's symbol/side/entry/exit/pnl$/R/setup. Reuse `chartScreenshot.js`'s `downloadBlob(blob, filename)` + `copyBlobToClipboard(blob)`. Trade page action: "Save image" (download) / "Copy image" (clipboard). Gated `useFeatureFlag('tradePng')`. No new dep.

**Context:** Research: `chartScreenshot.js` is the dep-free canvas-draw template with `downloadBlob`/`copyBlobToClipboard` ready. EdgeScoreCard is link-only (B2 adds its PNG). No html2canvas dep.

- [ ] **Step 1: Write tests** — `renderTradeCardPng` returns a Blob (mock canvas.toBlob); the Trade page action calls download/copy; flag-off → hidden.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): trade-card PNG export (dep-free canvas, brand-matched)`

---

### Task B2: PNG export on the Edge Score card

**Files:**
- Modify: `app/src/pages/journal-2-0/components/insights/EdgeScoreCard.jsx` (add "Save as image" beside "Copy link")
- Create (if shared): reuse `tradeCardPng.js`'s canvas helpers OR a small `edgeCardPng.js`
- Test: EdgeScoreCard test (extend)

**Interfaces:** the existing EdgeScoreCard (P3 B5) gains a "Save as image" action next to "Copy link" (`EdgeScoreCard.jsx:108-116`) that canvas-draws the score card (score + formula + components) to a PNG via `downloadBlob`/`copyBlobToClipboard`. Reuse the B1 canvas approach.

**Context:** Research: EdgeScoreCard is fully built + link-only; the surgical add is the image action. Reuse chartScreenshot helpers.

- [ ] **Step 1: Write tests** — the "Save as image" action produces a Blob + downloads; Copy-link still works.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): PNG export on the Edge Score card`

---

### Task B3: Notebook templates (3-template library)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/notebookTemplates.js` (3 `bodyJson` builders: trade review · weekly plan · daily prep)
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (a "New from template" menu) + the note-create flow to seed `bodyJson`
- Test: `notebookTemplates.test.js` + NotebookTab test

**Interfaces:** `notebookTemplates.js` exports `TEMPLATES = [{key, label, build() → tiptapDoc}]` for trade-review / weekly-plan / daily-prep — each returns a valid TipTap `{type:'doc', content:[…]}` scaffold (headings + paragraphs + placeholder prompts; NO table nodes — the editor's StarterKit lacks `@tiptap/extension-table`, so express structure as headings/bullet lists). NotebookTab's "+ New note" becomes a small menu ("Blank · Trade review · Weekly plan · Daily prep"); a template pick POSTs `/api/j2/notes` with the seeded `bodyJson` + a title.

**Context:** Research: `notes.py::create_note` accepts `bodyJson` (currently always empty). `convert_playbook_to_tiptap` is the doc-builder pattern. ⚠️ NO table extension — headings/lists only. Templates not a template engine (spec).

- [ ] **Step 1: Write tests** — each template builds a valid TipTap doc (type:'doc', content non-empty, no `table` nodes); NotebookTab template menu creates a note with the seeded body.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): notebook 3-template library (trade review / weekly plan / daily prep)`

---

### Task B4: Day-stats header block

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/DayStatsHeader.jsx` + test
- Modify: `NoteEditorPage.jsx` (render the header above the editor when the note has a `ticker`/date context) OR the day page

**Interfaces:** a `DayStatsHeader` that, given a date, fetches the existing day metrics (`useJ2DayDetail(date)` → `/api/j2/calendar/day/{date}` `metrics` = netPnl/pnl%/rSum/tradeCount/winners/losers/winRate) and renders a compact stats strip above the note editor (for notes keyed to a date) OR at the top of the day page. Read-only, no new backend.

**Context:** Research: day metrics ready via `get_day_detail` / `useJ2DayDetail` (no new backend). Render above the editor (like `DayMetricsRow`). Decide the trigger: a note with a date context, or always on the day page. Keep it simple — a date prop.

- [ ] **Step 1: Write tests** — DayStatsHeader renders the day metrics from a mocked useJ2DayDetail; empty day → a muted "no trades this day".
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): day-stats header block`

---

### Task B5: Trades `All` segment + server-side pagination

**Files:**
- Modify: `app/src/lib/journal-2-0/scope.js` (add `limit`/`offset` to the codec + apiParams)
- Modify: `app/src/pages/journal-2-0/hooks/useJ2Trades.js` (page state) + `tabs/TradeJournalTab.jsx` (page controls)
- Modify: `app/src/pages/journal-2-0/surfaces/TradesSurface.jsx` (add an `All` segment)
- Modify: `app/src/pages/journal-2-0/lib/localStorageMigrate.js` (the real `uct.j2.openPositions.columns` + `tradeJournal.columns` → note; keep additive)
- Test: scope test + TradeJournalTab pagination test

**Interfaces:** the scope codec gains `limit`/`offset` (sc_limit/sc_offset) + `scopeToApiParams` emits them; `useJ2Trades` drives paging from them; TradeJournalTab shows "N of M" + prev/next (or load-more) page controls (the `{trades,total,limit,offset}` envelope already exists). TradesSurface adds an `All` segment (Open Positions | Closed Trades | All) — `All` shows the closed-trades table with an "includes open" note OR (simplest v1) `All` = the closed-trades server list with pagination (document the scope; the true open+closed one-table union is deferred per the Global Constraints).

**Context:** Research: pagination envelope + total display exist; NO page controls / limit-offset in the codec. The full one-table merge is DEFERRED (disjoint columns). Scope to pagination + the `All` segment. `useJ2ColumnPrefs` tolerates the eventual merged key.

- [ ] **Step 1: Write tests** — scope codec round-trips limit/offset; apiParams emits them; TradeJournalTab page controls change offset + refetch; the `All` segment renders.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p5): Trades server-side pagination + All segment`

---

**MILESTONE B SHIP GATE:** full backend + FE suites, build, broker_sync grep, import. Whole-branch review + fix pass. Rebase, push, verify deploy. Update memory (P5 shipped; P6 next). Announcement: "Share your trades, plan in the notebook, page through your history."

---

## Self-Review (spec coverage)

- §7 Playbook per-trade adherence (rules-per-setup, checked-per-trade, adherence % + adherence-vs-expectancy, drill-through) → A2-A5. ✅
- §7 Psychology (emotion×outcome, cost-of-mistakes, revenge ≥2-signal+time-gated+dismissal+manual-copy, tilt glyph, empty-state rapid-tag) → A8-A11. ✅
- §7 Regime (per-trade capture forward + win-rate-by-regime bar + popover + backfill + unknown bucket) → A6-A7. ✅
- §7 confidence shading everywhere → reuse ConfidenceStat (P3) in every gated cell. ✅
- §7/§9 weekly Edge Score shareable card → already shipped P3; P5 adds PNG (B2). ✅
- §9 trade-card PNG → B1. Notebook templates → B3. Day-stats header → B4. ✅
- §9/§182 per-feature flags → A1. ✅
- §55 Trades merge → scoped to pagination + All segment (B5); full one-table merge DEFERRED (documented, disjoint columns). 
- §57 Journal day-page unification → already functionally built; light/deferred (documented).
- §5.4/§7 regime-history verification (P1a task) → resolved: breadth_monitor history reclassify (A6).

## Execution Handoff

Execute via **subagent-driven-development**: fresh implementer per task + task review + whole-branch review at each milestone boundary. A1 (flags) first. Ship at the two milestone gates. Each capstone feature is flag-gated for instant runtime rollback.
