# Journal 2.0 Coaching Layer — Roadmap

> **Status:** roadmap doc. Each phase below gets its own full-detail plan when its turn comes — this doc captures scope, key decisions, dependencies, and rough effort so the order is locked in.

**Goal:** Evolve Journal 2.0 from a data-recorder into a **Journal + Playbook + AI Coach + analyst team** that intervenes at decision time and provides feedback, not just records outcomes.

**North-star user experience:**
- Before the trade: form shows live coaching ("you're 4-7 on Bull Flag YTD, -2.1R total"; "regime is ORANGE, size auto-scaled to 60%"; "wait — daily loss limit hit 22 min ago, cooling-off until 2:47pm").
- During the trade: hold-time + management nudges in Open Positions.
- After the trade: weekly AI-generated review with concrete behavioral asks ("you re-entered after 2/3 stops this week; consider a 1-loss daily cap on this setup").

**Architecture principle:** Build the **rules-based** discipline + coaching layer first (Phases A–F). It's deterministic, testable, fast, and free. The **AI/LLM coach** layer (Phase G) sits on top and uses the same underlying data — it doesn't replace the deterministic layer, it adds judgment to it.

**What's out of scope:**
- Tax/accounting features (wash-sale, HIFO, year-end exports). Patrick said "we are not tax people."
- Chart-accuracy work (separate active initiative).
- Live broker integration / order routing. Journal stays read-only on the broker side.

---

## Phase A — Trade Entry Guards

**Effort:** 1 day. **Plan:** `2026-05-08-j2-discipline-phase-a-entry-guards.md` (this commit).

**Scope:** Three new per-account settings — `defaultSizePct`, `defaultRMultipleTarget`, `maxRiskPerTradePct` — wired into the AddPosition + AddTrade modals as auto-prefill and a soft-block banner. The prefill saves keystrokes; the soft-block is the user's first-line risk discipline.

**Key decisions made:**
- All three settings are **optional** (null = disabled). Existing accounts get null defaults — no behavior change unless the user opts in.
- Risk-per-trade cap is a **soft block** (red banner + disabled Save with an "Override" button), not a hard rejection. Users always have an out — the friction is the feature.
- `defaultRMultipleTarget` is **display-only** in v1 (no `target_price` column on j2_positions). Persistence + "did you hit your plan?" analytics arrives in a later plan if needed — don't expand schema until the value is proven.

**Deliverable:** Settings modal has new "ENTRY DEFAULTS & GUARDS" section. AddPosition pre-fills shares + shows a suggested target line + warns/blocks when implied $ risk exceeds the cap.

---

## Phase B — Daily / Session Discipline

**Effort:** 2 days. **Plan:** TBD.

**Scope:** Three settings — `dailyLossLimitPct` (or `$` absolute), `coolingOffMinutesAfterLossR` (e.g. "10 minutes after any -1R+ trade"), `noTradeWindowsET` (array of `{start, end, label}`, e.g. lunch chop, opening volatility). All three trigger a full-screen overlay on AddPosition/AddTrade with a countdown + override.

**Key decisions to make:**
- New endpoint `/api/j2/accounts/{id}/discipline/state` returns `{ locked: bool, reason: string, unlockAt: timestamp, overrideAllowed: bool }`. SWR-polled at 5s while a J2 modal is open.
- Today's P&L = sum of `pnl_dollar` from `j2_trades` where `exit_date::date = today_ET`. Need a small helper service `discipline.py`. Cache 30s.
- "Cooling-off" needs the timestamp of the last losing trade exit — already in `j2_trades.exit_date` but stored as date, not timestamp. **Decision needed:** add `exit_at` (timestamp column) or accept "since last losing day" granularity. Lean toward adding the timestamp column — minute-level is the whole point.
- No-trade windows are timezone-bound to ET (market hours). Render in user's local-time labels but evaluate against `America/New_York`.

**Risks:** Cooling-off is the highest-friction setting. Default off; users opt in.

---

## Phase C — Setup-Aware Coaching

**Effort:** 2 days. **Plan:** TBD.

**Scope:** Two pieces.
1. **Live setup expectancy** in AddPosition/AddTrade: when user picks a setup from the dropdown, show a small panel "Your record on `Bull Flag`: 12 trades, 41% win rate, +1.2R avg, +14.8R YTD. Last 5: W L L W L." Pulled from `j2_trades` filtered by `setup` and account.
2. **A+ setup whitelist**: a multi-select field in settings (sourced from the existing `setups` list) marking which setups may exceed `maxRiskPerTradePct`. Add Position's risk cap silently lifts to e.g. `maxRiskPerTradePct × 1.5` if the chosen setup is on the whitelist.

**Key decisions to make:**
- Expectancy panel: cache or compute on every keystroke? Lean toward on-demand SWR with 60s cache, keyed by `(account_id, setup_name)`.
- Setup picker dropdown needs a small UI change to show a star (★) next to whitelisted A+ setups — visual reinforcement.
- Whitelisted-setup risk override: settings should expose the *multiplier* (default 1.5×) so power users can crank it.

**Dependencies:** Phase A must ship first (the cap exists to override).

---

## Phase D — Regime-Aware Sizing

**Effort:** 2 days. **Plan:** TBD.

**Scope:** UCT engine pushes `wire_data["exposure"]["score"]` (0–150) and a regime classifier (`"GREEN" | "AMBER/YELLOW" | "ORANGE" | "RED"`) daily. We already consume that elsewhere. New feature:
1. Per-account setting `regimeSizeMultipliers`: `{green: 1.0, amber: 0.8, orange: 0.6, red: 0.0}`. AddPosition multiplies `defaultSizePct` (Phase A) by the active regime's multiplier and shows a banner explaining the scaling.
2. On trade close, stamp `regime_at_entry` on the `j2_trades` row. Adds an `entry_regime` TEXT column. Backfill existing rows with `null`.
3. Analytics tab gets a new dimension: "win rate by regime."

**Key decisions to make:**
- Where does the J2 backend read the regime from? Either from the in-memory wire_data cache (cheap, but resets on Railway redeploy and seeded from `/data/wire_data.json`) or from a new daily snapshot table (durable, costs a write/day). Lean toward the cache — engine push runs daily, redeploys reseed from volume.
- Multiplier of 0 = "hostile, skip." UI: red banner saying "regime is RED, this setting blocks entry. Override?" instead of silently filling in 0 shares.

**Dependencies:** Phase A (defaultSizePct exists).

---

## Phase E — Custom Mistakes + Emotions Taxonomy

**Effort:** 2 days. **Plan:** TBD.

**Scope:** J2 currently has **no mistake or emotion capture in the trade close flow** — confirmed via grep. This phase builds it from scratch.

1. Two new per-account settings: `mistakeTags: string[]` and `emotionTags: string[]`. Seed defaults match the OLD Journal's 17/15 lists for continuity. User can add/remove/reorder via chip UI in PortfolioSettingsModal.
2. ClosePositionModal + AddTradeModal grow two new chip-picker fields populated from the account's tag lists.
3. New columns on `j2_trades`: `mistake_tags TEXT` (JSON array), `emotion_tags TEXT` (JSON array). Default `[]`.
4. Analytics tab dimension: "win rate by mistake," "P&L by emotion."

**Key decisions to make:**
- Are tags shared across accounts or per-account? Lean per-account (already the per-account settings model). User who wants shared can copy the list.
- Required vs optional? Phase A's "required reflection on close" is a Phase F feature — keep mistakes/emotions optional in this phase.

---

## Phase F — Streak Nudges + Hold-Time Alerts

**Effort:** 1.5 days. **Plan:** TBD.

**Scope:** Three small nudges that surface in the J2 header / Open Positions header without modal interruption:
1. **Loss streak nudge:** after 3 consecutive losing trades today, show a yellow banner: "you're 3 down today. Take 15? `[Snooze 1h]`"
2. **Win streak nudge:** after 5 consecutive winners, "5 in a row. Don't size up out of euphoria. `[Got it]`"
3. **Hold-time staleness:** Open Positions header shows "2 positions held 30+ days with no notes — `Review these` →" linking to a filtered view.

**Key decisions to make:**
- Snooze persistence: localStorage or server-side? Lean localStorage — these nudges are advisory, no audit need.
- Required-reflection-on-close gate is also a fit here: settings flag "require lesson note on losses" / "require lesson note on wins."

---

## Phase G — AI Coach + Analyst Team

**Effort:** unknown — **needs its own deep brainstorm session before any plan.**

**Scope (working theory, to be refined):** A team of LLM-driven analysts that ingest the user's full trading record and produce feedback at three cadences:

1. **Pre-trade Analyst** (synchronous, ~5s latency): When user opens AddPosition with a symbol + setup, an LLM call ingests `(symbol, setup, account_history_for_this_setup, current_regime, market_context)` and returns a 2-sentence "go / no-go-worth-thinking" verdict. Caches per `(symbol, setup, day)` to bound cost.
2. **EOD Coach** (async, runs at 4:30pm ET): Reads the day's trades + day notes, writes a 1-paragraph debrief into `j2_day_notes.coach_recap`. Highlights specific behavioral patterns — "you re-entered AAPL 12 minutes after stopping out for the third time this month."
3. **Weekly Review Committee** (async, Sundays): Multi-agent — separate "Risk Analyst" / "Setup Analyst" / "Process Analyst" / "Psychology Analyst" subagents each write their section, a final "Head Coach" synthesizer produces the week's one-page review. Posted to a new `j2_coach_reviews` table, surfaced in Overview tab.

**Open questions for the brainstorm:**
- **Models:** Haiku for cheap synchronous calls, Sonnet for EOD, Opus for the weekly committee? Or all-Haiku with prompt caching?
- **Context strategy:** how much of the trade record fits in the prompt? Need a summarization tier.
- **Cost model:** per-user budget cap. At what cost-per-month does this become unviable? Need a back-of-envelope.
- **Tooling:** does the AI get tool-call access to query the user's data, or do we pre-build the context as JSON and stuff it in?
- **Trust + override:** what does the UX look like when the AI is wrong? Always-visible "this was unhelpful" feedback button.
- **Privacy:** community sharing already opt-in. AI coaching uses user's own data only — no cross-user training.
- **Hallucination guardrails:** the analyst can NEVER make up numbers. Tool-call architecture (Claude API tool use) probably the safer bet over context-stuffed prompts.

**Dependencies:** All of A–F. The deterministic layer must exist for the AI layer to ground its claims in real data.

---

## Order of operations

| Phase | Effort | Why this slot? |
|-------|--------|----------------|
| A | 1d | Foundation: caps + defaults that B, C, D all depend on. |
| B | 2d | Highest user-perceived value of the rules-based phases. Stops tilt-trading. |
| C | 2d | Connects existing setup data to the entry surface. Differentiator. |
| D | 2d | UCT-only feature. Other journals literally can't ship this. |
| E | 2d | Sets up trade-level data the AI coach (G) will need. |
| F | 1.5d | Polish layer; not strictly needed before G but cheap. |
| G | TBD | Needs brainstorm before plan. Don't start until A–F land. |

**Total deterministic-layer effort:** ~10–11 days of focused work, shippable phase-by-phase.

---

## Cross-cutting concerns

- **Migrations:** every phase ALTERs `j2_accounts` or `j2_trades`. Use the existing idempotent `_PHASE_2_ALTERS` list pattern in `db.py`. Never use destructive migrations.
- **Tests:** every backend phase ships with `test_<feature>.py`; every frontend phase ships with at least one component test.
- **Telemetry:** consider a lightweight `j2_coaching_events` table to log when a guard fires + whether the user overrode it. Useful for the AI coach later ("you've overridden the daily-loss lockout 11 times this month — is the limit too tight?").
- **Override transparency:** every soft-block has an "Override" button. Tracking which setting they override most often is itself a coaching insight.
- **Performance:** keep all guards client-side where possible. Server only when truth requires (today's P&L, last-loss timestamp).
