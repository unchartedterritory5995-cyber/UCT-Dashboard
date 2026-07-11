# Journal 2.0 A+ — P6: Coach Amplification (FINAL phase) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the coaching loop — score Compass's own verdicts against outcomes, turn recurring mistakes into evidence-linked rules, suggest tags, and celebrate discipline — so the journal doesn't just record behavior, it *amplifies* the good and flags the costly.

**Architecture:** Builds entirely on shipped surfaces. The verdict→outcome join (`j2_trades.context_at_entry → compass_verdict_id → j2_verdicts.id`) already exists (P1b) — P6 reads it into a **verdict scorecard**. Recurring-mistake data (`analytics.psychology.costOfMistakes.byMistake`, P5) gets a **"Make this a rule"** affordance writing a new provenance-carrying `j2_journal_rules` store (suggestion-only, never auto-arms — per spec §153). The trade row + `revenge_detect` flags drive a **deterministic tag suggester**. Achievement signals (goal ≥100%, `nudges.winStreakCount`, `adherencePct==1.0`, clean discipline) surface as **CoachStrip `sev:'success'` rows**, deduped once-per-achievement via `calendar_seen`. Every feature ships behind its own runtime flag (the P5 `featureFlags.js` pattern) for instant revert.

**Tech Stack:** FastAPI + SQLite (`j2_*` tables, `auth.db`), React + Vite SPA, the P5 `featureFlags.js` + `ConfidenceStat` + Insights hub + CoachStrip + `TagChipPicker`, the shipped Compass coaching layer (`j2_verdicts`, `j2_profile_suggestions`, `interventions`, `discipline`).

## Global Constraints

Every task's requirements implicitly include this.

- **Per-feature runtime flags:** each P6 feature (`verdictScore` · `tagSuggest` · `makeRule` · `celebrate`) rides `app/src/pages/journal-2-0/featureFlags.js` (`window.__uctJ2Feature('verdictScore', false)` = instant per-browser revert). Default ON (reviewed + additive). A flag-off surface renders nothing AND fires no network request.
- **Coverage-gated honesty (the P2/P5 pattern) everywhere:** the verdict scorecard's denominator is ONLY trades whose `contextAtEntry.compass_verdict_id` is set (post-P1b, modal-entered, paid). Broker/CSV/pre-P1b trades carry `context_at_entry == '{}'` → they are "no verdict logged", NEVER counted as a miss. Show "computed from N of M trades" + `ConfidenceStat` n<10 shading. Never a fake accuracy number on a thin sample.
- **"Make this a rule" is SUGGESTION-ONLY (spec §153):** it creates a persisted rule record with EVIDENCE PROVENANCE ("created from your Jun 30 review: no_stop tagged 8× · −$2.1k lifetime") that is DISPLAYED as a reminder + suggestion card. It MUST NOT auto-arm an intervention, mutate a discipline guardrail, or change trading behavior. Adding a rule is a STRENGTHENING action → NOT "elevated" (only loosening a guardrail is elevated, per `update_discipline_setting`). No LLM required for v1 — the label + evidence come from the finding the user clicked.
- **Tag suggestions are DETERMINISTIC + HONEST for v1:** a pure heuristic over the trade row (`originalStop==entryPrice` or `rMultiple==null` → suggest `no_stop`; the trade's `tradeRef` in `revenge_detect` flags → suggest `revenge` + `revenge-driven`; a low-exit-efficiency winner → `cut_winner`/`early_exit`) — SUGGEST, never auto-apply. Accept routes through the EXISTING merge/dedup write path (`tag_trade` execute OR `PATCH /trades/{id}` with `[...current, suggested]`), so accepting is idempotent and never clobbers existing tags. An LLM tier is explicitly OUT OF SCOPE for P6 v1 (note it as a future tier).
- **Celebrations are TASTEFUL + rate-limited:** a positive **row inside the existing CoachStrip** (`sev:'success'`, gold `UIcon`, NO confetti, NO emoji), NOT a new band (memory: "don't stack a control band per feature"). Each achievement fires EXACTLY ONCE via a durable once-per key (reuse `calendar_seen.mark_seen` server pattern with `item_type='celebration'`, `item_key='goal_weekly_2026-W28'` etc.) — never every render.
- **No emoji** (UIcon). **Additive only** (journal_two/journal-2-0). New tables/cols via idempotent `CREATE TABLE IF NOT EXISTS` / the `_PHASE_2_ALTERS` pattern. **Broker merge invariant:** `grep -c broker_sync api/main.py` ≥ 7 before push.
- **Baseline test state:** ~20 pre-existing backend failures (15 `test_options` past-expiration + 5 `test_coach_chat_tools`) + 3 `test_interventions` wall-clock flap. NEVER attribute to P6.
- **Ship window** ≥4:20 PM ET / <9:15 AM ET; owner authorized override for this initiative. Per-feature flags are the safety net.

---

### Task P6-1: P6 per-feature flags

**Files:** Modify `app/src/pages/journal-2-0/featureFlags.js` (+ `featureFlags.test.js`).

**Interfaces:** extend `FEATURE_DEFAULTS` with `verdictScore: true, tagSuggest: true, makeRule: true, celebrate: true`. No other change — the module (hook/setter/`window.__uctJ2Feature`/`useSyncExternalStore`) already handles arbitrary keys.

**Context:** P5-A1 built the module. This is a one-line default extension + a test asserting the 4 new flags default ON and are individually revertible.

- [ ] **Step 1: Extend `FEATURE_DEFAULTS`** with the 4 keys.
- [ ] **Step 2: Extend `featureFlags.test.js`** — each new flag defaults true; `setFeatureFlag('verdictScore', false)` flips it.
- [ ] **Step 3: Run** `cd app && npx vitest run src/pages/journal-2-0/featureFlags.test.js`.
- [ ] **Step 4: Commit** `feat(j2-p6): register verdictScore/tagSuggest/makeRule/celebrate flags`

---

### Task P6-2: Verdict-vs-outcome scorecard — backend

**Files:**
- Create: `api/services/journal_two/verdict_scorecard.py`
- Modify: `api/routers/journal_two.py` (`GET /api/j2/accounts/{account_id}/verdict-scorecard`)
- Test: `api/services/journal_two/test_verdict_scorecard.py`

**Interfaces:** `get_verdict_scorecard(user_id, account_id=None, spec=None) -> dict`:
```
{
  byVerdict: [
    { label: 'GO',   taken: {n, winRate, avgR, netPnl} },
    { label: 'HOLD', taken: {n, winRate, avgR, netPnl} },
    { label: 'SKIP', overridden: {n, winRate, avgR, netPnl}, obeyed: <int> },
  ],
  coverage: { tradesWithVerdict, tradesTotal },
  skipOverrideHeadline: { n, lossRate, netPnl } | null,   // the "you took SKIP anyway → lost X%" hero
}
```
- **Taken cells:** group CLOSED trades whose `context_at_entry` JSON has a `compass_verdict_id`, by their `compass_verdict_label` (GO/HOLD/SKIP). Compute winRate = wins/(wins+losses) (MATCH the app convention — breakevens excluded from denominator, like setup/regime/emotion), avgR (mean rMultiple, null-safe), netPnl (Σ pnlDollarNet), n.
- **SKIP-obeyed:** anti-join — count `j2_verdicts` rows with `label='SKIP'` whose `id` is NOT referenced by any trade's `context_at_entry.compass_verdict_id` (for this user/account). These are SKIPs the user obeyed (no trade). Scope by account_id + spec date range if the verdict has created_at in range.
- **skipOverrideHeadline:** the headline stat = SKIP.overridden (took-anyway) with its lossRate (losses/(wins+losses)) + netPnl — this is the moral of the scorecard. Null when overridden.n == 0.
- Read the trades via the same path analytics uses (`trades_where(spec)` for scope). Read `j2_verdicts` directly (schema `db.py:267-288`). context_at_entry parse must be defensive (empty '{}' → no verdict).
- **Coverage:** `tradesWithVerdict` = closed trades with a verdict id; `tradesTotal` = all closed trades in scope. The FE gates on this.

**Context:** Research: the join is live (`trades.py:933` surfaces `contextAtEntry`; `AddPositionModal.jsx:243`/`AddTradeModal.jsx:145` stamp it). `j2_verdicts` has no trade FK — the link is trade-side. No verdict-list endpoint exists → this is the first read of `j2_verdicts` beyond generate.

- [ ] **Step 1: Write failing tests** — seed verdicts (GO/HOLD/SKIP) + closed trades stamped with `context_at_entry={compass_verdict_id, compass_verdict_label}`: byVerdict cells compute correct winRate/n; a SKIP-labeled trade (took-anyway) lands in SKIP.overridden; a SKIP verdict with NO matching trade counts in obeyed; trades with empty context_at_entry are excluded (coverage denominator only); skipOverrideHeadline null when no overrides. winRate excludes breakevens.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (service + endpoint, auth `get_current_user`, user+account-scoped).
- [ ] **Step 4: Run tests + `python -c "import api.main"` + broker_sync grep.**
- [ ] **Step 5: Commit** `feat(j2-p6): verdict-vs-outcome scorecard service + endpoint`

---

### Task P6-3: Verdict scorecard — frontend (Insights "Coach" section)

**Files:**
- Create: `app/src/pages/journal-2-0/components/insights/VerdictScorecard.jsx` (+ `.module.css`) + test
- Create: `app/src/pages/journal-2-0/hooks/useVerdictScorecard.js` (SWR over P6-2)
- Modify: `app/src/pages/journal-2-0/components/insights/InsightsHub.jsx` (add a 6th "Coach" section)

**Interfaces:** InsightsHub's `SECTIONS` array (currently 5: Playbook/Exit Quality/Edge/Psychology/Regime) gains `{ key: 'coach', label: 'Coach' }` with a gated render branch (mirror how A7/A9 added regime/psychology sections). `VerdictScorecard` reads `useVerdictScorecard(accountId, apiParams)` and renders:
- The **headline** when `skipOverrideHeadline`: a prominent honest line — "You overrode Compass's SKIP {n} times → lost {lossRate}% of them ({netPnl})." (red-toned; the moral).
- A **byVerdict** row set: GO / HOLD / SKIP-overridden each with win rate (via `ConfidenceStat`, grays n<10), n, avg R, net P&L; plus a "SKIP obeyed {obeyed}×" honest note.
- **Coverage footnote:** "Scored from {tradesWithVerdict} of {tradesTotal} trades — only trades entered after checking with Compass carry a verdict." (so a user with 0 verdict-linked trades sees an honest empty state, NOT a fake 0%).
- **Empty state** (tradesWithVerdict === 0): a designed "Run a pre-trade verdict (🧭 on Add Position) and this scorecard comes alive" pitch (mirror the psychology empty-state style).
- Gate on `useFeatureFlag('verdictScore')` (when off, InsightsHub keeps the section out / renders a ComingSoon; simplest: hide the Coach nav item + section when off — match the A7 flag pattern). No emoji; UIcon.

**Context:** Research: InsightsHub `:44-50` SECTIONS + `:102-126` gated lazy mount. ConfidenceStat is the n<10 cell. The scorecard is the P6 announcement — the coach grades itself.

- [ ] **Step 1: Write failing tests** — renders byVerdict rows + the skip-override headline from mocked data; grays a cell with n<10; coverage footnote reflects tradesWithVerdict/Total; empty (0 verdict trades) → the pitch; flag off → section not shown.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement + wire into InsightsHub.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p6): Verdict scorecard (Insights → Coach section)`

---

### Task P6-4: AI-suggested tags (deterministic) — service + surfaces

**Files:**
- Create: `api/services/journal_two/tag_suggest.py` (pure) + endpoint in `api/routers/journal_two.py` (`GET /api/j2/trades/{trade_id}/tag-suggestions`)
- Create: `app/src/pages/journal-2-0/components/trade/TagSuggestions.jsx` + test
- Modify: `TradeDetailPage.jsx` (mount above the mistake/emotion TagChipPickers) + `components/psychology/RapidTagFlow.jsx` (mount above its pickers)
- Test: `api/services/journal_two/test_tag_suggest.py`

**Interfaces:** `tag_suggest.suggest_for_trade(trade_row, revenge_flag: bool) -> {mistakes: [str], emotions: [str], reasons: {tag: reason}}`:
- `originalStop == entryPrice` OR `rMultiple is None` (no real stop) → `mistakes += ['no_stop']`, reason "No stop was logged on this trade."
- `revenge_flag` (this trade's tradeRef is in `revenge_detect.detect` flags) → `mistakes += ['revenge']`, `emotions += ['revenge-driven']`, reason "Re-entered {symbol} shortly after a loss on it."
- (optional, if exit-efficiency available) a winner closed well below MFE → `mistakes += ['cut_winner']` / `['early_exit']`.
- Only suggest tags the account's taxonomy actually contains (intersect with `settings.mistakeTags`/`emotionTags` OR the STANDARD_* lists); NEVER suggest a tag already applied to the trade.
- Endpoint `GET /trades/{id}/tag-suggestions` resolves the trade, computes the revenge flag (call `revenge_detect.detect` over the user's recent timed trades OR reuse the psychology section's revenge set), returns `{mistakes, emotions, reasons}`. Cheap; user-scoped.
- **Frontend `TagSuggestions`:** given the suggestion payload + current tags, render a compact "Suggested: no_stop · revenge  [Accept all]" chip row (each chip individually acceptable, or Accept-all). Accepting a mistake tag calls the parent's existing optimistic tag write (`patchTrade({ mistakeTags: [...current, tag] })` on TradeDetailPage; `setMistakeSel` in RapidTagFlow) — the SAME merge path, so it's idempotent. Dismiss (×) hides the suggestion locally. Gate on `useFeatureFlag('tagSuggest')`. No emoji.

**Context:** Research: all signals are on `_row_to_trade`; `revenge_detect.py` flags by tradeRef; the write path is the existing merge (`tag_trade` execute / PATCH). Surfaces = TradeDetailPage `:555-571` (above the pickers) + RapidTagFlow `:206-224`.

- [ ] **Step 1: Write failing tests** — no-stop trade → suggests `no_stop`; a revenge-flagged trade → `revenge`+`revenge-driven`; never suggests an already-applied tag; never suggests a tag outside the taxonomy; a clean trade → empty.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement service + endpoint + `TagSuggestions` + both mounts.**
- [ ] **Step 4: Run tests (backend + FE component) + build.**
- [ ] **Step 5: Commit** `feat(j2-p6): deterministic AI-suggested tags (Trade page + rapid-tag)`

---

### Task P6-5: "Make this a rule" — backend rule store

**Files:**
- Modify: `api/services/journal_two/db.py` (new `j2_journal_rules` table via the idempotent pattern)
- Create: `api/services/journal_two/journal_rules.py` (CRUD)
- Modify: `api/routers/journal_two.py` (`POST /rules`, `GET /rules`, `POST /rules/{id}/dismiss`)
- Test: `api/services/journal_two/test_journal_rules.py`

**Interfaces:**
- Table `j2_journal_rules`: `id TEXT PK, user_id, account_id, label TEXT NOT NULL, evidence TEXT, source_type TEXT (psychology|review|manual|chat), source_id TEXT, status TEXT (active|dismissed) DEFAULT 'active', created_at, updated_at`. (No `checked` — a journal rule is a persistent reminder, NOT a per-day checkbox. NO auto-arm columns.)
- `journal_rules.py`: `create_rule(user_id, account_id, label, evidence, source_type, source_id) -> dict`, `list_rules(user_id, account_id=None, status='active') -> [dict]`, `dismiss_rule(user_id, rule_id) -> dict` (status→dismissed), `count_active(user_id, account_id)`. Validate label non-empty (trim, cap length), source_type in the allowed set. Idempotency: allow duplicate labels (a user may re-affirm) but consider a soft de-dup on (user, account, label, status='active') — pick "allow but the FE warns"; document. User-scoped throughout.
- Routes: `POST /api/j2/accounts/{account_id}/rules` body `{label, evidence, sourceType, sourceId}` → create; `GET /api/j2/accounts/{account_id}/rules?status=active`; `POST /api/j2/rules/{rule_id}/dismiss`. Auth `get_current_user`.
- **Critically: this store is READ-ONLY to trading behavior.** No intervention fires from it; no discipline guardrail reads it. It is displayed only (P6-6 FE).

**Context:** Research: spec §153 = suggestion cards + evidence, nothing auto-arms. `j2_profile_suggestions` (`db.py:325-335`) is the provenance precedent (source_type/source_id/status). This is a NEW parallel store (rules ≠ profile suggestions).

- [ ] **Step 1: Write failing tests** — create round-trips (label+evidence+source); list filters by status + account; dismiss flips status; user isolation (user B never sees user A's rules); label validation.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement (table + service + endpoints).**
- [ ] **Step 4: Run tests + import + broker_sync grep.**
- [ ] **Step 5: Commit** `feat(j2-p6): j2_journal_rules store + create/list/dismiss endpoints`

---

### Task P6-6: "Make this a rule" — frontend affordance + My Rules list

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useJournalRules.js` (SWR over P6-5)
- Create: `app/src/pages/journal-2-0/components/insights/MakeRuleButton.jsx` (the affordance) + `MyRulesList.jsx` + tests
- Modify: `app/src/pages/journal-2-0/components/insights/PsychologySection.jsx` (add a "Make this a rule" action on each `costOfMistakes.byMistake` row) + a surface for the active rules list.

**Interfaces:**
- `MakeRuleButton`: a small "Make this a rule" action. On a recurring-mistake row (PsychologySection `CostPanel`, `:236-280`), clicking it opens a compact confirm (prefilled `label` e.g. "No entry without a stop" derived from the mistake tag + `evidence` = "{mistake} tagged {count}× · {total$} lifetime", `sourceType='psychology'`, `sourceId=<mistake>`). Confirm → `POST /rules` (via `useJournalRules().create`). One confirm, no auto-arm; a subtle "Rule saved" toast/inline. Gate on `useFeatureFlag('makeRule')`.
  - Provide a small mapping from mistake tag → a sensible default rule label (e.g. `no_stop → "Always log a stop before entry"`, `revenge → "No re-entry within 30 min of a loss"`, `oversized → "Never exceed my max size"`, `overtrading → "Cap daily trade count"`) with a generic fallback ("Avoid {mistake}"); the label is editable in the confirm.
- `MyRulesList`: renders `useJournalRules(accountId).rules` (active) as a simple list ("My Rules" — label + evidence subtext + dismiss ×). Mount it in the Psychology section (below the panels) OR a small "My Rules" card — pick the Psychology section (co-located with where rules are created) to avoid a new band. Dismiss → `POST /rules/{id}/dismiss` + optimistic remove. When no rules → nothing (or a one-line "Turn recurring mistakes into rules above").
- No emoji; UIcon; match section styling.

**Context:** Research: the recurring-mistake rows are the trigger (`PsychologySection` CostPanel). The rule is a reminder surfaced in-place; NOT auto-armed. Keep it inside the existing Psychology section (no new band).

- [ ] **Step 1: Write failing tests** — MakeRuleButton opens the confirm with a prefilled label+evidence from a mistake row; confirm POSTs the rule; MyRulesList renders active rules + dismiss removes one; flag off → no button/list.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement + wire into PsychologySection.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p6): Make-this-a-rule affordance + My Rules list (Psychology section)`

---

### Task P6-7: Celebration moments

**Files:**
- Create: `api/services/journal_two/celebrations.py` (detect achievements) + fold into the overview payload OR a small endpoint
- Modify: `api/services/journal_two/overview.py` (add a `celebrations` array to the Today overview payload — the 1-fetch source) + `api/services/calendar_seen.py` usage for once-per dedupe
- Modify: `app/src/pages/journal-2-0/components/CoachStrip.jsx` (render `sev:'success'` celebration rows from the overview) 
- Test: `api/services/journal_two/test_celebrations.py`

**Interfaces:** `celebrations.detect(user_id, account_id) -> [ {key, kind, message} ]` — each an achievement:
- **goal hit:** a period's `goal_progress` crossed ≥1.0 → `{key: 'goal_'+period+'_'+periodId, kind:'goal', message:'Weekly goal hit — {netPnl}. Bank it.'}`.
- **win streak:** `nudges.winStreakCount >= threshold` → `{key:'winstreak_'+count, kind:'streak', message:'{n} wins in a row — process is working.'}` (note: CoachStrip already has a caution win-streak row; the celebration is a genuinely positive variant — coordinate so they don't double-fire; prefer folding: the celebration REPLACES/augments the existing win row copy with a reinforcing tone. Read CoachStrip's existing win-streak row first).
- **clean discipline day:** market closed + `discipline.locked==false` all session + ≥1 trade → `{key:'cleanday_'+date, kind:'discipline', message:'Full session, no discipline breaches. That’s the edge.'}`.
- **100%-adherence trade:** a just-closed trade with `adherencePct==1.0` → `{key:'adherence100_'+tradeRef, kind:'adherence', message:'Followed every {setup} rule on {symbol}.'}`.
- **Once-per gate (durable):** before emitting, check `calendar_seen.get_seen(user_id, 'celebration')` — skip keys already seen; on emit, `calendar_seen.mark_seen(user_id, 'celebration', key)` (idempotent `ON CONFLICT DO NOTHING`). So each achievement surfaces exactly once, cross-device. (The detection runs when the overview is fetched — mark-seen on emit; the FE dismiss is not required since it's once-per, but a dismiss can also mark-seen.)
- **CoachStrip:** render each celebration as a `sev:'success'` row (gold `UIcon` e.g. `star-fill`, the message) folded into the existing severity-ordered strip — NOT a new band. Gate the celebration rows on `useFeatureFlag('celebrate')`.
- Keep detection CHEAP (reuse the overview's already-loaded aggregates: goal_progress, winStreakCount, discipline state — don't add heavy queries).

**Context:** Research: signals exist (`accounts.goal_progress` ≥1.0, `nudges.winStreakCount`, `discipline.compute_discipline_state`, `adherence_store` 100%); CoachStrip has a `sev:'success'` row already; `calendar_seen.mark_seen` = the durable once-per pattern; overview.py is the Today 1-payload source.

- [ ] **Step 1: Write failing tests** — goal ≥1.0 emits a goal celebration keyed by period; a win-streak at threshold emits once; the same key is NOT re-emitted after mark_seen (once-per); a locked/breached day does NOT emit clean-day.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement (detect + overview fold + CoachStrip rows).**
- [ ] **Step 4: Run tests + build + broker_sync grep.**
- [ ] **Step 5: Commit** `feat(j2-p6): celebration moments (CoachStrip success rows, once-per via calendar_seen)`

---

**P6 SHIP GATE:** full backend suite (20-baseline shape), FE `journal-2-0` + `lib/journal-2-0` suites, `npm run build`, `grep -c broker_sync api/main.py` ≥ 7, `python -c "import api.main"`. Whole-branch adversarial review + fix pass. Rebase onto `origin/master`, re-verify, push. Verify deploy (health swap + a new endpoint probe, e.g. `GET /api/j2/accounts/{id}/verdict-scorecard` unauth → 401). Update memory: **Journal 2.0 A+ initiative COMPLETE (P1a–P6)**. Announcement: "Compass now grades its own calls, turns your mistakes into rules, suggests tags, and celebrates the discipline."

## Self-Review (spec coverage)

- §9 P6 "make this a rule" (evidence-linked, suggestion-only, nothing auto-arms) → P6-5/P6-6. ✅
- §9 P6 verdict-vs-outcome scoring → P6-2/P6-3 (the shipped `compass_verdict_id` join). ✅
- §9 P6 AI-suggested tags → P6-4 (deterministic v1; LLM tier deferred). ✅
- §9 P6 celebration moments → P6-7 (CoachStrip success rows, once-per). ✅
- §182 per-feature flags → P6-1. ✅
- Coverage-gated honesty + no-emoji + no-new-band + additive → Global Constraints, enforced per task.

## Execution Handoff

Execute via **subagent-driven-development**: fresh implementer per task + task review + whole-branch review at the end (this is the final phase — the whole-branch review is the initiative's last gate). P6-1 (flags) first. Each feature is flag-gated for instant runtime rollback.
