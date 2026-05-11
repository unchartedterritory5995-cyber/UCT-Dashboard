# Journal 2.0 Coaching Layer — Phase G v1 Design: Coach Core + Weekly Review

**Status:** spec, awaiting user review.
**Initiative:** J2.0 Coaching Layer (Phase G of the 7-phase roadmap; Phases A–F shipped 2026-05-08 through 2026-05-10).
**North-star vision:** Journal + Playbook + AI Coach + team of analysts. This spec defines the **Coach Core** abstraction and ships it through the first surface: **Weekly Review**.

---

## 1. Goal

Build a single AI Coach (codename **Compass**) that:
- Feels like a top-tier professional trading coach to every individual user.
- Has persistent memory across sessions — both an editable Trader Profile and a log of prior Coach outputs.
- Reads structured signals from Phases A–F as ground truth; never recomputes them; never hallucinates numbers.
- Ships first via a **weekly review** surface that runs on demand (lazy generation) when the user opens the new "🧭 Compass" tab in J2 after a closed trading week.

**Explicitly NOT in v1 scope:** EOD recap surface, pre-trade verdict surface, conversational chat tab, multi-agent specialist team, RAG / vector-store integration, user-configurable persona, scheduled cron generation, email delivery, audio TTS rendering. All deferred to subsequent Phase G slices.

---

## 2. The Coach: Compass

### 2.1 Identity & character

A single canonical Coach character named **Compass**. The name ties to the Uncharted Territory brand (intro-animation cartographer, "Navigate the market, effectively" tagline) and avoids the gender/cultural baggage of a human name.

Compass is a senior trading partner with decades of pattern recognition — both market structure and trader psychology. The character:

- Direct without being harsh. Doesn't praise easily. Doesn't catastrophize.
- Asks more than tells. Reflective by default.
- Treats trading as craft, not gambling. Respects discipline. Skeptical of certainty.
- Comfortable with "I don't know" and "the data is too thin to call this."
- Calibrated. Doesn't generalize from a single trade.

### 2.2 Voice principles (encoded in system prompt)

1. **Evidence-grounded.** Every claim points to data ("you're 4-9 on Bull Flag in Q2"). No abstract platitudes.
2. **Questions over directives.** "What made this different?" not "You should have done X."
3. **Specific over general.** "Your last 3 stops were 8% wide vs your usual 5%" not "your stops are bad."
4. **Calibrated language.** "Likely", "the data suggests" — never absolute.
5. **Respects autonomy.** Coach informs and asks; trader decides.

### 2.3 Tone register by surface

- **Weekly Review** — reflective, structured, slightly formal. Monday-morning desk meeting.
- (Future) **EOD Recap** — warmer, conversational. Debrief over a beer.
- (Future) **Pre-Trade Verdict** — terse, 2–3 sentences. No softening.
- (Future) **Conversational tab** — matches the user's energy.

### 2.4 What Compass does NOT do

- No bullish/bearish forecasts. Doesn't predict markets.
- No "you got this!" cheerleading.
- No financial advice in the regulatory sense — discusses the trader's behavior + decisions, not investment recommendations.
- No moralizing about losses.

### 2.5 Future evolution (out of v1 scope)

- User can rename Compass and adjust voice dials (blunt↔gentle, terse↔verbose, technical↔psychological). The fixed-canonical-Compass remains the default.
- Optional voice + sound (TTS), email delivery, scheduled generation.

---

## 3. Trader Profile

A markdown-shaped doc Compass maintains about each user. Read at the start of every Coach interaction; updated as the final step of every Weekly Review.

### 3.1 Storage

```sql
ALTER TABLE j2_accounts ADD COLUMN trader_profile TEXT NOT NULL DEFAULT '';
```

One profile per account. Single markdown blob. Soft cap ~2000 tokens, enforced by Compass via system prompt instruction ("summarize and consolidate; don't accumulate forever").

### 3.2 Reference shape (Compass-authored markdown)

```markdown
# Trader Profile

## Trading style
- Time horizon: swing (avg hold 4-12 days)
- Primary setups: Bull Flag, Pullback, VCP
- Strongest setup: Bull Flag (12-7 YTD, +14.2R)
- Weakest setup: Pullback (4-11 YTD, -3.1R)
- Trade frequency: ~3 trades/week

## Strengths
- Excellent at letting winners run when conviction is high
- Tight risk management on initial entries
- Pre-market prep notes consistently strong

## Weaknesses / leaks
- Sizes up after wins (3 of last 4 oversized trades happened post-win)
- Revenge trades after losses, particularly Tuesdays
- Late entries on Pullback setups — frequently chasing

## Behavioral patterns
- Tuesday losses correlate with thin prep notes
- Performance dips noticeably in ORANGE regime
- Strongest hours: 10:00-11:30 ET; weakest: 14:00-15:30 ET

## Preferences (told or inferred)
- Wants blunt feedback
- Cares about Process scoring
- Doesn't want analogies; wants data

## Current focus
- Q2 focus: cut size on Pullback setups by 50% until win rate ≥40%
- Process score target: 75+

## Open threads Compass is tracking
- Why are Thursday afternoons soft? Suggestive but not conclusive.
```

### 3.3 Lifecycle

- **First weekly review** writes the initial profile (Compass synthesizes from existing trade history).
- **Subsequent weekly reviews** update it (small focused LLM call: current profile + this week's notable observations → new profile).
- **User edits** anytime via the "Compass's notes on you" editor on the Compass tab. User edits are authoritative — Compass treats user-edited sections as ground truth.
- **"Clear and start fresh"** button — wipes the profile; the next weekly review rebuilds from scratch.

---

## 4. Coach Output Memory

A log of every Compass output, used as retrievable context for future Coach calls.

### 4.1 Storage

```sql
CREATE TABLE IF NOT EXISTS j2_coach_outputs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    output_type TEXT NOT NULL CHECK(output_type IN
                  ('weekly_review','eod_recap','pre_trade_verdict','chat_turn','profile_update')),
    body        TEXT NOT NULL,
    summary     TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    feedback    TEXT,           -- 'helpful' | 'unhelpful' | NULL
    forgotten   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_coach_outputs_lookup
    ON j2_coach_outputs(user_id, account_id, output_type, created_at DESC);
```

`body` is the full markdown. `summary` is a 1-2 sentence Compass-generated retrieval anchor. `metadata` JSON holds `week_start`, `trade_ids`, `key_observations[]`, and per-output-type fields. `feedback` is updatable. `forgotten=1` excludes the row from retrieval but keeps it for audit.

### 4.2 Retrieval

For a Weekly Review prompt, retrieval injects:
- The last 3 weekly-review **summaries** (not bodies) — `ORDER BY created_at DESC LIMIT 3` where `output_type='weekly_review' AND forgotten=0`.
- The `key_observations[]` arrays from each of those 3 reviews' metadata.

Body is never injected into a prompt — too token-heavy. Body is only for the archive view.

Future surfaces (EOD, chat) will retrieve different slices but write to the same table.

### 4.3 No vector retrieval in v1

v1 corpus is tiny (~52 weekly reviews/year per account). Top-N by recency is sufficient. The schema supports adding an `embedding` column later when the conversational surface ships.

---

## 5. Weekly Review Surface

### 5.1 Output structure (enforced by system prompt)

```
# Week of YYYY-MM-DD — Compass's Review

[Head Coach synthesis — 2-3 sentences capturing the week's actual takeaway]

## Performance
- Net P&L: $X (Y%)
- Trades: N (W/L/B) · Win rate · Avg R · Profit Factor
- vs last week: [delta + brief narrative]

## Process
- Process score avg: X/100 (vs last week's Y)
- A+ setups taken: N
- Risk-cap breaches: N · Discipline lockouts hit: N · Overrides used: N

## Setups
- Best this week: [name] — N trades, X%, +XR
- Worst this week: [name] — N trades, X%, -XR
- [1-2 sentence pattern observation]

## Psychology
- Most-tagged emotion: [name] · Win rate when [emotion]: X%
- Most-tagged mistake: [name]
- [1-2 sentence behavioral observation]

## Risk
- Max daily drawdown: -$X (on day Y)
- Max concurrent positions: N
- Days at daily-loss limit: N · Days cooling-off fired: N

## This week's focus
[1-2 concrete behavioral asks for next week — not generic.]
```

Numbers come from injected structured data. Compass's job is interpretation + narrative — never computation.

### 5.2 Cadence: lazy on-demand generation (no cron in v1)

When the user opens the Compass tab on Sunday/Monday (or any day post-Friday-close), the frontend checks whether a weekly review exists for the most-recently-closed Mon-Fri week. If missing → CTA: "Generate this week's review →". Click → blocking ~10-30s request → returns the rendered review.

No background job, no cron, no APScheduler. Future polish: scheduled generation + email delivery.

### 5.3 Edge cases

- **0 closed trades in the week** → no review; UI shows "No trades closed this week. Compass will check back next week."
- **1-2 trades** → review still generated; system prompt instructs Compass to acknowledge thinness ("This was a thin week — take it with a grain of salt").
- **All-Accounts view** → Compass is per-account; UI shows "Select an account to view its Compass review."
- **New account with no history** → first review writes the initial Trader Profile from whatever trade history exists.

---

## 6. Prompt Assembly

### 6.1 System prompt (~2500-3000 tokens; stored as Python constant in `coach_prompts.py`)

Four parts, fixed order:

1. **Identity** — verbatim from §2.1. ~400 tokens.
2. **Voice principles** — the 5 voice rules from §2.2 + the "what Compass does NOT do" list from §2.4. ~300 tokens.
3. **Domain knowledge** — pro-trader principles distilled. ~1200-1800 tokens. Covers:
   - Risk per trade (R-multiple thinking, position sizing relative to account)
   - Setup grammar (what makes a Bull Flag good vs bad — same vocabulary the trader uses in J2)
   - Regime trading (UCT regime thresholds green/amber/orange/red — must match Phase D's classification)
   - Behavioral patterns (revenge trading, tilt, FOMO, anchoring, recency bias)
   - Process discipline vocabulary (J2's: setup, R, stop, BE, regime, A+, process score)
   - UCT-specific concepts (exposure score, breadth thresholds, MA stack, when relevant)
4. **Weekly Review output spec** — exact section structure from §5.1, with per-section rules ("Performance section: ALWAYS lead with the headline number, comparison to last week required, use sign on changes"). ~400 tokens.

### 6.2 User message (assembled at call time)

```
## Trader Profile
<j2_accounts.trader_profile markdown blob — or "First review for this trader" if empty>

## Coach memory (last 3 weekly reviews)
- 2026-04-26: <summary> | obs: <key_observations[]>
- 2026-04-19: <summary> | obs: <key_observations[]>
- 2026-04-12: <summary> | obs: <key_observations[]>

## This week's data (Mon DD - Fri DD)

### Trades closed
<table: symbol, setup, side, entry/exit, R, $P&L, mistake_tags, emotion_tags, regime, hold_days, process_score>

### Aggregates
- W/L/B counts, win rate, avg R, profit factor, net $/%, process score avg

### Discipline events
- Risk-cap breaches: N (overrides: N)
- Daily-loss lockouts: N · Cooling-off fired: N · No-trade-window blocks: N

### Setup performance
<per-setup: trades, win rate, avg R, total R>

### Psychology
- Emotion → outcome breakdown
- Mistake → outcome breakdown

### Regime context per day
<per-day: date, regime label, market summary if available>

### vs Last week
<deltas: P&L, win rate, process score, mistake count>

### User feedback signals
<outputs marked unhelpful — Compass should avoid those patterns>

---
Write this trader's weekly review. Follow the structure exactly. Be Compass.
```

### 6.3 Prompt caching

Configured from day 1 (architecture, not optimization):
- System prompt → `cache_control: ephemeral`. Static across all users.
- Trader Profile → `cache_control: ephemeral`. Per-user, changes ~weekly.
- Last 3 review summaries → `cache_control: ephemeral`. Per-user, changes weekly.
- This-week data → NOT cached (fresh per call).

Anthropic's 5-min cache TTL works fine for the typical "user clicks generate → poll → review render" flow (single-shot). Future surfaces (chat) may benefit from 1-hour extended caching.

### 6.4 Model and parameters

- **Model:** `claude-sonnet-4-6` for v1 (both Review call and Profile-update call).
- **Temperature:** 0.4 (slight variation across runs, no robotic feel, no incoherence).
- **max_tokens:** 2000 for the review; 2000 for the profile update.
- **Future:** if a multi-agent committee ships in a later Phase G slice, Opus 4.7 becomes the synthesizer; Sonnet stays for sub-analysts.

### 6.5 Two-call flow per generation

1. **Review call** — Sonnet writes the markdown review using the assembled user message.
2. **Profile update call** — focused Sonnet call: `current_profile + just-written_review` → updated profile. Cap output 2000 tokens.

Both calls write rows to `j2_coach_outputs`. Review row has `output_type='weekly_review'`; profile update row has `output_type='profile_update'`. The updated profile also lives in `j2_accounts.trader_profile`.

---

## 7. Phase A-F Integration (no recomputation; Coach interprets only)

The Coach NEVER recomputes signals. The deterministic layer is the source of truth. A `coach_data_assembler.py` orchestrator pulls structured signals from existing services and assembles them into the user message.

| Phase | Signal | Source |
|---|---|---|
| A | Risk caps, default size, R-target, breaches + overrides this week | `j2_accounts` settings + `j2_trades` filter |
| B | Daily-loss lockouts, cooling-off fires, no-trade-window blocks this week | `j2_trades.exit_date` walk + settings |
| C | Per-setup stats (incl. A+ flag) | `setup_stats.get_setup_stats` per setup the user traded |
| D | Regime at trade entry, regime sizing multipliers | `j2_trades.regime` + settings |
| E | Mistake/emotion tags per trade + outcome correlations | `j2_trades.mistake_tags` / `emotion_tags` |
| F | Loss/win streak counts, stale-position count | `nudges.get_nudges_state` |
| Live | Current regime snapshot | `regime.get_current_regime` |

The assembler computes "vs last week" deltas by running the same aggregations on the prior week's trades.

---

## 8. Trust & Feedback Loop

### 8.1 No-hallucination contract

The system prompt explicitly instructs:
> "Use only numbers from the injected data. If you don't have data to support a claim, say 'the data is too thin to call this' — never extrapolate or invent. Quote setup names, regime labels, and tag names exactly as they appear in the data."

Implementation test: a regression test extracts all numbers from a sample Compass output and asserts each appears in the injected data. (Test runs once during dev; not enforced per-call in production.)

### 8.2 Per-output feedback

- 👍 "helpful" / 👎 "unhelpful" buttons on every weekly review.
- Stored as `feedback` column on `j2_coach_outputs`.
- Future generations inject "User marked these recent outputs as unhelpful: [...] — avoid those patterns" into the user message.

### 8.3 Forget

- Per-output "Forget this" button → sets `forgotten=1`.
- Row stays for audit but is excluded from retrieval.

### 8.4 Error handling

- Anthropic API failure → retry once with backoff; second failure returns 500 + user-friendly message ("Compass couldn't generate this review — please retry").
- Malformed Coach output (missing sections) → store as-is; UI surfaces a "regenerate?" prompt. Don't fail hard.
- Profile-update call failure → review still returned successfully; profile-update silently retried on next generation.
- Anthropic key missing in env → return a clear "Compass is not configured for this deployment" error to the frontend.

### 8.5 Privacy

- "Enable Compass" toggle per-account in PortfolioSettingsModal (default ON). When OFF, no API calls, no data to Anthropic.
- Compass outputs never cross to the Community tab regardless of Phase A's `shareJournalData`.
- Trader Profile is human-readable; user can clear it at any time.
- All data sent to Anthropic is the user's own data scoped to one account.

---

## 9. API Surfaces

All under `/api/j2/accounts/{id}/coach/`:

```
GET    /weekly-reviews                    list (id, week_start, summary, feedback, created_at)
GET    /weekly-reviews/{review_id}        single review body + metadata
POST   /weekly-reviews/generate           {weekStart?} → blocking ~10-30s, returns full review
POST   /weekly-reviews/{review_id}/regen  rate-limited 1/day per review
POST   /weekly-reviews/{review_id}/feedback   { feedback: 'helpful'|'unhelpful' }
POST   /weekly-reviews/{review_id}/forget     soft-delete; removes from retrieval

GET    /profile                            Trader Profile markdown
PUT    /profile                            user edit { profile: "..." }
POST   /profile/clear                      wipes profile for fresh rebuild
```

Idempotency: simultaneous `generate` requests for the same `(account_id, week_start)` collapse to a single in-flight job; the second request blocks on the same result.

---

## 10. Frontend

New top-level J2 tab: **🧭 Compass**.

v1 single-page layout:
- **Top bar** — CTA: "Generate this week's review →" when most-recent review is older than the most-recently-closed Mon-Fri.
- **Reviews list** — newest first. Each row: date · headline · feedback indicator · click-to-expand.
- **Expanded review** — full-screen markdown render with sticky section-nav. Actions: 👍/👎 · Regenerate · Forget · Export markdown.
- **"Compass's notes on you"** (collapsible at bottom) — editable Trader Profile. View / Edit / Clear.

Hooks:
- `useJ2CoachReviews(accountId)` — SWR list + actions
- `useJ2TraderProfile(accountId)` — SWR get/put

Settings:
- A small section in PortfolioSettingsModal: "COMPASS — Enable AI Coach for this account" toggle (default ON).

---

## 11. Implementation File Map

| File | Role |
|---|---|
| `api/services/journal_two/db.py` | Schema migration: 1 ALTER + 1 CREATE TABLE + 1 INDEX |
| `api/services/journal_two/coach.py` | Orchestrator: `generate_weekly_review(user_id, account_id, week_start)` |
| `api/services/journal_two/coach_prompts.py` | System prompt + user-message assembly helpers |
| `api/services/journal_two/coach_data_assembler.py` | Pulls structured signals from A-F services |
| `api/services/journal_two/test_coach.py` | Unit tests (mock Anthropic) + assembler integration tests |
| `api/routers/journal_two.py` | 8 new endpoints (above) |
| `app/src/pages/journal-2-0/hooks/useJ2CoachReviews.js` | SWR list + actions |
| `app/src/pages/journal-2-0/hooks/useJ2TraderProfile.js` | SWR get/put |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | Tab UI shell |
| `app/src/pages/journal-2-0/components/CompassReview.jsx` | Single-review rendering |
| `app/src/pages/journal-2-0/components/TraderProfileEditor.jsx` | Profile editor block |
| `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx` | Add COMPASS toggle |
| Tests | `app/src/pages/journal-2-0/components/CompassReview.test.jsx`, `TraderProfileEditor.test.jsx` |

---

## 12. Out of Scope (Future Phase G slices)

These will each get their own brainstorm + spec + plan, sequenced after v1 ships and we learn from usage:

- **EOD Recap surface** — daily, async, per-trade narration + 1-paragraph debrief.
- **Pre-Trade Verdict surface** — synchronous, inline in AddPosition, 2-3 sentence verdict.
- **Conversational Coach tab** — interactive, stateful chat.
- **Multi-agent specialist team** — Risk / Setup / Process / Psychology analysts + Head Coach synthesizer (Approach B from brainstorm).
- **RAG / UCT KB integration** — retrieval over UCT Intelligence KB (Approach C from brainstorm).
- **User-configurable persona** — name + tone dials.
- **Scheduled generation** — Sunday cron job that pre-generates.
- **Email delivery** — weekly review delivered via Resend.
- **Audio version** — TTS rendering using existing voice infra.
- **Cost optimization layer** — batch API for async, prompt caching tuning, Haiku cascading, per-account budget caps. Architecture supports all of these; tuning happens after v1.

---

## 13. Success Criteria

- A user with at least 3 closed trades in a week can open the Compass tab and generate a weekly review that:
  - Is grounded in their actual data (no invented numbers).
  - Has the Compass voice (direct, evidence-grounded, calibrated).
  - References at least one specific behavioral pattern they exhibited.
  - Provides 1-2 concrete behavioral asks for next week.
- The Trader Profile populates on first run and updates intelligently across reviews.
- Subsequent reviews reference the prior week's observations ("Last week we noted... — this week the pattern...").
- User-marked-unhelpful outputs visibly shift the next generation's tone or content.

---

## 14. Risks & Open Items

- **Compass voice consistency** — depends entirely on prompt quality. Mitigation: hand-tune the system prompt with several iteration rounds during implementation; capture "good" and "bad" reference outputs in the test suite.
- **Hallucination** — the no-hallucination contract is prompt-level, not enforced. Mitigation: regression test verifies numbers; user feedback button surfaces the failures.
- **Sonnet quality on dense data** — 30-50 trades + per-setup tables + psychology breakdown is a lot to synthesize. If Sonnet struggles, the fallback is to chunk the input (week-aggregates + top-10 trades narrative) or promote to Opus for the synthesizer call.
- **Cost** — deferred. Architecture supports caching + batch + cascading. Estimated < $0.10 per weekly review per account at v1 with caching on.
