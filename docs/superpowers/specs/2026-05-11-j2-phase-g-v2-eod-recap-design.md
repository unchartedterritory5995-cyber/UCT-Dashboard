# Journal 2.0 Coaching Layer — Phase G v2 Design: EOD Recap

**Status:** spec, awaiting user review.
**Initiative:** J2.0 Coaching Layer (Phase G v2 — second Compass surface).
**Predecessor:** Phase G v1 (Coach Core + Weekly Review) shipped 2026-05-11 at master `abff4d3`.

---

## 1. Goal

Add a second Compass surface — a daily end-of-day recap of the trader's closed trades + a brief comment on what they're still holding overnight. Auto-generated at 4:30pm ET on trading days via the existing APScheduler instance, with a manual fallback CTA on the Compass tab. The recap is a short conversational note (200-300 words) in the Compass voice already established in v1, surfaces in the Compass tab alongside Weekly Reviews, and feeds into Weekly Review memory.

**Why this surface next:**
- Architectural reuse: same async orchestrator pattern as Weekly Review; lowest-risk extension of Coach Core.
- Daily iteration cycle on Compass quality — every trading day generates one, so quality improvements compound quickly.
- Establishes the "Compass remembers what happened yesterday" memory pattern that future surfaces (pre-trade verdict, chat) will lean on.

**Explicitly OUT of scope for v2:** pre-trade verdict, conversational chat, multi-agent committee, RAG, user-configurable persona, email delivery, audio TTS, EOD updating Trader Profile (Weekly Review remains the sole profile-writer).

---

## 2. Output Structure + Voice

EOD recaps obey the Compass voice principles already encoded in `COMPASS_SYSTEM_PROMPT`. A new section appended to that prompt defines the EOD-specific format. Compass writes:

- **200-300 words target, 400-word hard cap.**
- **Prose paragraphs only.** No headers, no bullets, no emojis.
- **Opening line: the punch line of the day** — the single most-notable observation. Not the P&L number unless it's the actual headline.
- **Body: 1-2 specific observations** from today's trades. Cite trades by symbol when relevant ("the late entry on NVDA cost you 1.4R"). Reference mistake/emotion tags when the user applied them. Calibrated language ("looks like", "the data suggests") — never absolute.
- **Multi-day arc references when applicable** — Compass weaves in patterns the trader has been exhibiting across multiple days when the assembler surfaces them ("third consecutive Bull Flag loss," "second day above the daily-loss limit"). See §3 for what the assembler computes.
- **One closing sentence about open positions** if any are held overnight. Awareness only — no recommendations. ("You're carrying 3 overnight — biggest is +1.8R on AAPL; two are flat.")
- **Exactly one reflective question** at the end. The question is the most-important content in the recap and is held to an explicit rubric:
  - MUST reference a specific data point from today (a trade, a tag, an exit time, a setup, a P&L number). Generic emotional check-ins ("how are you feeling?") are forbidden.
  - MUST NOT be answerable yes/no.
  - MUST ask about a *pattern* across at least two data points (today's trades, today vs yesterday, or today vs the week's focus) — not a re-litigation of a single decision.
  - Good examples (encoded in the system prompt): "What changed between the first NVDA entry that worked and the second that gave it back?" / "When you sized up after the morning win, what were you assuming that the afternoon proved wrong?" / "You took two Bull Flags today; the data is now 5 wins and 8 losses on that setup this quarter — what's the case for taking the 14th?"
  - Bad examples (also encoded): "How did you feel about today?" / "Did you stick to your plan?" / "Want to keep trading Bull Flags?"
- **No "Today's focus" or directive asks** — that's the Weekly Review's job. EOD is reflective, not prescriptive.

**Empty-day handling:**
- 0 closes AND 0 open positions → no generation. Compass tab shows "No activity today — Compass is taking the day off."
- 0 closes + at least 1 open position → generate a brief holdings note (~80 words). One observation about the positions, one reflective question. No body about closed-trade patterns (there were none).

---

## 3. Data Scope

A new `assemble_day(user_id, account_id, day_iso, conn)` function in `coach_data_assembler.py` produces this dict (mirrors the shape of `assemble_week` but daily-scoped):

```python
{
    "trader_profile": str,                  # j2_accounts.trader_profile markdown
    "memory": {
        "recent_eod_summaries": [           # last 2 EOD recaps (this account)
            {"day": "2026-05-10", "summary": str},
            {"day": "2026-05-09", "summary": str},
        ],
        "last_weekly_summary": str,         # from last weekly_review row
        "this_weeks_focus": str | None,     # structured field from last weekly review's metadata
    },
    "recent_arcs": [                        # 0-3 multi-day patterns (see §3.1)
        "3rd consecutive loss on Bull Flag (today's CRWD, Tuesday's NVDA, Monday's TSLA)",
        "second day this week exceeding the 1% risk cap",
        ...
    ],
    "today": {
        "date": "2026-05-11",
        "trades": [trade dict, ...],        # closed trades today (full detail, mistake_tags, emotion_tags, regime)
        "aggregates": {                     # today-only
            "trade_count": int,
            "wins": int, "losses": int, "bes": int,
            "win_rate": float | None,
            "avg_r": float | None,
            "net_pnl_dollar": float,
            "net_pnl_pct": float,
        },
        "discipline_events": {              # reuse Phase A-F polish: today-only
            "risk_cap_breaches": int, "risk_cap_overrides": int,
            "daily_loss_lockouts": int,     # always 0 or 1 for a single day
            "cooling_off_fires": int,
            "no_trade_window_blocks": int,
            "a_plus_taken": int,
        },
        "open_positions": [                 # j2_positions WHERE closed_at IS NULL
            {
                "symbol": str, "side": str, "shares": float,
                "entry_price": float, "stop_price": float,
                "entry_date": str, "days_held": int,
                "unrealized_r": float | None,   # computed via live price snapshot if available; null if not
                "current_price": float | None,
            }, ...
        ],
    },
    "week_to_date": {
        "range": "2026-05-11 to 2026-05-11",  # Monday to today
        "trade_count": int,
        "net_pnl_dollar": float,
        "wins": int, "losses": int,
    },
    "vs_yesterday": {
        "prior_day_net_pnl_dollar": float,  # if any yesterday trades
    },
    "feedback_signals": [{day, summary}],   # last few EOD recaps user marked unhelpful (avoid those patterns)
}
```

**Source mapping:**
- Trades: `j2_trades` filtered by `exit_date` in [today_00:00 ET, today+1 00:00 ET) UTC.
- Open positions: `j2_positions WHERE closed_at IS NULL AND user_id=? AND account_id=?`.
- Live unrealized R: use existing `useLivePrices` data path on the backend if available; otherwise leave `unrealized_r` as `null` (Compass will say "current marks not available").
- Discipline events: reuse `_discipline_events(conn, user_id, account_id, start, end)` with `start=today_00:00`, `end=today+1_00:00`.
- This week's focus: **read directly from the last weekly review's `metadata.this_weeks_focus` structured field** (no regex parsing). Weekly review generation is amended to write this as a discrete metadata field at write time (parsed once, by the post-generation extractor, from Compass's output structure). If absent, fall back to `null`.

### 3.1 Recent arcs (the multi-day pattern surface)

Single-day debriefs are commodity AI. The defining elite move is multi-day pattern detection — surfacing the **arcs** that only a continuous trade journal can see. The assembler computes a `recent_arcs: list[str]` field, where each entry is a structured one-line observation. Compass weaves these into the recap when present.

Concrete arc detectors (deterministic, run by the assembler — no LLM):

- **Consecutive setup losses** — "3rd consecutive loss on Bull Flag (today's CRWD, Tuesday's NVDA, Monday's TSLA)."
- **Consecutive discipline-cap breaches** — "second day this week exceeding the 1% risk cap (yesterday on AAPL, today on META)."
- **Cumulative daily-loss-limit threshold approached** — "the week's total drawdown (-2.4%) is now within 0.5% of your weekly comfort range based on prior performance."
- **Repeated mistake tag** — "fourth time this week the `FOMO` tag is on a trade — the prior three were losses."
- **Days since last winning trade** — "today is the 3rd day in a row with no closing winner."
- **Regime-mismatch streak** — "third trade taken in an ORANGE regime when your `regimeSizeMultipliers` say 0.6x; sizing was full each time."

The assembler caps `recent_arcs` at 3 entries — the most-significant ones — so the prompt stays focused. If no arcs are detected, the field is an empty list; Compass treats absence as "no pattern worth naming."

Each detector is a small, testable function in `coach_data_assembler.py`. Adding a new arc detector in the future is a single function + a single test, no orchestrator changes.

---

## 4. Generation Flow

Two paths, both routing to the same orchestrator function `coach.generate_eod_recap(user_id, account_id, day, *, client, conn)`.

### 4.1 Scheduled auto-generation (4:30pm ET weekdays)

- Existing APScheduler instance in `api/main.py` lifespan (already running for the COT scheduler — reuse, do not create a second scheduler).
- New cron trigger: Monday–Friday at 16:30 America/New_York.
- Job (`_compass_eod_job`) does:
  1. Read `os.environ.get("ANTHROPIC_API_KEY")`. If missing, log a warning and exit.
  2. Open a connection. Query `SELECT id, user_id FROM j2_accounts WHERE compass_enabled = 1`.
  3. For each `(account_id, user_id)`:
     - Compute today's ET date.
     - Check if any `j2_trades.exit_date` row OR `j2_positions WHERE closed_at IS NULL` exists for this account.
     - If neither → skip.
     - Else → call `coach.generate_eod_recap(user_id, account_id, day=today_et_iso)`.
     - Catch + log exceptions per-account so one failure doesn't block the rest.
  4. Close the connection.

Sequential execution. At ~3-10s/recap × N accounts, the batch takes <2 minutes for the foreseeable user base. No queue, no parallelism in v2.

### 4.2 Manual generation (Compass tab CTA)

New endpoint:

```
POST /api/j2/accounts/{account_id}/coach/eod-recaps/generate
  body: { day?: "YYYY-MM-DD" }  # defaults to today_et_iso()
```

Synchronous (blocks ~10-30s). Returns the recap dict (mirrors weekly's return shape). Calls the same orchestrator. Idempotent — if a recap with `day=requested_day` already exists for this account, returns it without re-calling Anthropic.

### 4.3 Orchestrator (`coach.generate_eod_recap`)

Mirrors `generate_weekly_review` plus a new post-generation validation pass:

1. Idempotency check: existing `j2_coach_outputs WHERE output_type='eod_recap' AND user_id=? AND account_id=? AND json_extract(metadata, '$.day') = ? AND forgotten = 0` → return existing if found.
2. Assemble data via `coach_data_assembler.assemble_day(...)`.
3. Build user message via `coach_prompts.assemble_eod_user_message(data)`.
4. Call `client.write_eod_recap(system_prompt=COMPASS_SYSTEM_PROMPT, user_message=...)`. (Note: extends `CoachClientProto` with a third method — see §5.)
5. **Post-generation validation pass (`coach_validation.validate_eod_output`)** — see §4.4.
6. Persist to `j2_coach_outputs` with `output_type='eod_recap'`, `metadata={"day": day_iso, "validation": {...}}` (validation summary embedded).
7. Return the persisted dict.

**No profile-update call.** EOD does not write to `j2_accounts.trader_profile`. Weekly remains the sole profile writer.

### 4.4 Post-generation validation (the elite reliability move)

A single hallucinated R-multiple or invented trade symbol destroys trust. Principles-in-the-prompt alone are insufficient — at production scale they fail occasionally. The orchestrator runs an output validation pass after the LLM call and retries with corrective context if checks fail. New service module: `coach_validation.py`.

The validator checks:

**A. Numeric grounding.** Extract every numeric token from the Compass output that looks like a trade metric (regex matches for `R-multiples` like `+1.4R` / `-1R`, `dollar amounts` like `$420` / `-$1,200`, `percentages` like `2.4%`, `share counts`, `price levels`). For each, verify it appears (within rounding tolerance — 1 decimal place) in the injected data. Numbers that don't appear are flagged.

**B. Symbol grounding.** Extract uppercase ticker-like tokens (2-5 chars, all caps, word-boundary). Each must appear in either today's trades, today's open positions, or the trader profile. Unknown symbols are flagged.

**C. Tag grounding.** Mistake/emotion tags Compass references (matched against the account's configured mistake/emotion tag lists from settings) must have been applied to at least one trade in the recent context. Compass cannot invent that "you tagged today's NVDA with FOMO" if it didn't.

**D. Format compliance.** Word count ≤400, exactly one `?` in the body (the reflective question), no markdown headers (`#`/`##`/`###`), no bullet points (`-` at line start), no emoji.

**E. Question rubric** (best-effort, lighter touch). Confirms the question isn't a yes/no pattern (regex check for common yes/no openings: `Did you`, `Were you`, `Is it`, `Are you`, `Have you`, `Was it`). Doesn't enforce the data-point reference rule programmatically — that's the prompt's job — but flags missing question mark.

**Retry policy:**
- 0 violations → persist with `validation.passed = true`.
- 1+ violations → retry once with a corrective user-message addendum: "Your prior draft contained these unverified claims: [list]. Rewrite the recap using only the data I gave you. Specifically, replace each unverified value or symbol with a verified one or omit the sentence entirely. Do not invent."
- After 1 retry, if violations remain → persist anyway, but stamp `validation.passed = false`, `validation.flags = [...]` into metadata. The frontend reads this and renders a small "⚠ Compass made unverified claims — review carefully" badge on the recap. The trader gets to decide whether to forget/regenerate; they're not silently lied to.

**Why this matters for elite:** the difference between "AI feature with the occasional unverifiable claim" and "trusted coach" is exactly this guardrail. The trader can look at any number Compass quotes and know the assembler injected it. That's the foundation of trust.

---

## 5. Storage + API + Client Wrapper

**Storage:** no new tables, no new columns. `j2_coach_outputs.output_type` already enumerates `eod_recap` per the v1 schema CHECK constraint.

**API endpoints** (new, under `/api/j2/accounts/{id}/coach/`):

```
GET    /eod-recaps                     list (id, day, summary, feedback, created_at, viewed_at)
GET    /eod-recaps/{recap_id}          single recap body + metadata
POST   /eod-recaps/generate            { day? } → blocking 10-30s
POST   /eod-recaps/{recap_id}/regen    1/day rate-limited; forget + re-generate
POST   /eod-recaps/{recap_id}/feedback { feedback: 'helpful'|'unhelpful' }
POST   /eod-recaps/{recap_id}/forget   soft-delete
POST   /eod-recaps/{recap_id}/viewed   marks metadata.viewed_at; clears the in-app banner
```

All behind `get_current_user`. Service-layer functions scope by `user_id`.

**Client wrapper** (`AnthropicClient` in `coach.py`):

Add a third method `write_eod_recap(system_prompt, user_message) -> {body, summary, key_observations}`. Same prompt-caching pattern as `write_review`. Temperature 0.5 (slightly more variation in voice than Weekly's 0.4 since the EOD is more conversational). Max tokens 1200 (cap matches the 400-word hard cap with headroom).

**System prompt:** the EOD format spec is appended as Section 6 of `COMPASS_SYSTEM_PROMPT` (an additional ~400 tokens). Cached the same way as the rest of the prompt. Adding it doesn't bust the cache for Weekly Review prompts because the entire system prompt is cached as one block — Anthropic charges the same per-token-cached cost whether the prompt is 2500 or 2900 tokens.

---

## 6. Frontend Integration

**Compass tab layout grows:**

The tab currently shows: `[generate weekly CTA] → [list of weekly reviews] → [Trader Profile editor]`. v2 inserts a new "Daily Recaps" section between the weekly CTA and the weekly list.

```
🧭 Compass

[banner: "No review yet for the week of YYYY-MM-DD" + Generate CTA]   ← existing

## Daily Recaps   ← NEW
[if today's recap not yet generated AND today is a trading day:
   small inline CTA "Generate today's recap →"]
- Mon May 12 — "<summary line>"  [👍 👎 Regen 🗑]
- Fri May 9  — "<summary line>"  [👍 👎 Regen 🗑]
- Thu May 8  — "<summary line>"  [👍 👎 Regen 🗑]
[Show last 7 days inline; "View older" link expands]

## Weekly Reviews   ← existing
[list of weekly reviews]

## Compass's notes on you   ← existing Trader Profile editor
```

**In-J2-app banner (cross-tab):** when an EOD recap exists for today and `metadata.viewed_at` is null, the J2 root shell renders a dismissible gold strip above the nested-tab bar:

> 🧭 Compass wrapped today's session — read it →

Click → routes to Compass tab, fires `POST /coach/eod-recaps/{id}/viewed`, banner disappears.

Dismissing the banner (×) also marks viewed.

If the user has multiple accounts with unread EODs, banner says "🧭 Compass wrapped today's session in 2 accounts — read →" and links to the Account selector.

**New components:**
- `app/src/pages/journal-2-0/components/EODRecap.jsx` — single-recap render. Same markdown helper as `CompassReview` (extract `renderMarkdown` to a shared util in v2 so EOD + Weekly both use it).
- `app/src/pages/journal-2-0/components/EODRecapBanner.jsx` — the cross-tab notification strip.

**New hooks:**
- `app/src/pages/journal-2-0/hooks/useJ2EODRecaps.js` — SWR over `/eod-recaps` + generate/regenerate/feedback/forget/viewed actions.
- `app/src/pages/journal-2-0/hooks/useJ2UnviewedEOD.js` — small hook that returns the most recent unread EOD recap for the current account (used by the banner).

---

## 7. Memory Integration with Weekly Review

Two changes to `assemble_week` and to the Weekly Review orchestrator:

**7.1 EOD context injection into Weekly prompts.** The Weekly Review's prompt currently retrieves the last 3 weekly review summaries. Phase G v2 extends `assemble_week` to ALSO retrieve EOD recap summaries from the current week and inject them as a `weekly_eod_context` field — a list of `{day, summary}` for each EOD in [week_start, week_end].

Implementation: in `assemble_week`, add a query for `j2_coach_outputs WHERE output_type='eod_recap' AND user_id=? AND account_id=? AND json_extract(metadata, '$.day') BETWEEN ? AND ? ORDER BY metadata->>'$.day' ASC`. The Weekly prompt's system prompt is updated to acknowledge this context ("if `weekly_eod_context` is present, use it to ground patterns you've already named in daily notes — refine, don't re-state").

This is the principal value-add of EOD beyond standalone debriefs: each EOD acts as a "draft observation" that the Weekly Review consolidates.

**7.2 Structured `this_weeks_focus` on the Weekly Review row.** Currently the EOD assembler would have to regex-parse the weekly review's body to extract "this week's focus." Phase G v2 amends the Weekly Review orchestrator to extract this discretely at write time. After the Weekly Review LLM call returns, a small extractor (`coach_validation.extract_this_weeks_focus(body)`) finds the `## This week's focus` section (with tolerant header matching: case-insensitive, with or without colon, with or without emoji) and stores its content as a discrete metadata field:

```json
{
  "week_start": "2026-05-04",
  "key_observations": [...],
  "this_weeks_focus": "Skip Pullback setups entirely. You're -3.1R YTD..."
}
```

The EOD assembler reads `memory.this_weeks_focus` directly from metadata. No regex parsing at read time. If extraction fails at write time (Compass deviated from the format), the field is `null` and the EOD assembler treats absence gracefully.

**7.3 EOD recaps DO NOT update `trader_profile`.** Only Weekly Reviews update it. This keeps the profile stable + reduces per-EOD cost.

---

## 8. Trust & Error Paths

### 8.1 No-hallucination contract

Same as v1: Compass uses only data injected. The EOD section of the system prompt restates this explicitly for the conversational form ("you have only today's data, the open-position snapshot, and the week-to-date totals — never invent numbers, dates, or symbols").

A unit test feeds a sample `assemble_day` dict into a `FakeClient` that returns a known body, then asserts numeric tokens in the body appear in the input.

### 8.2 Failure modes

- **Anthropic API failure (scheduled path):** the per-account try/except logs the error and continues. The user can manually regenerate later from the Compass tab.
- **Anthropic API failure (manual path):** returns 503 to frontend with a readable detail (same pattern as v1).
- **Anthropic key missing:** scheduler logs "Compass EOD scheduler disabled: ANTHROPIC_API_KEY not set" once at app startup. Manual endpoint returns 503.
- **No closed trades AND no open positions:** orchestrator returns `{"skipped": true, "reason": "no_activity"}` without writing a row. Manual CTA on the Compass tab shows the empty state.
- **Compass disabled per-account:** scheduler skips that account; manual endpoint returns 403.
- **Idempotency race:** scheduler + manual triggered simultaneously for same (account, day) — both reach the orchestrator; the SECOND one's idempotency check finds the first's just-written row and returns it. Last writer never wins because the orchestrator's INSERT-then-return path is atomic per connection.
- **Live-price unavailability for unrealized R:** open-position section reports prices as `null`; Compass's prompt instructs "if `current_price` is null, omit the position's R from the holdings sentence — say 'a few open positions overnight' instead."

### 8.3 Feedback loop

Reuses Phase G v1's pattern. `👍`/`👎`/`forget` endpoints scoped by user_id (same security model as Weekly). Feedback marked unhelpful gets injected into future EOD prompts via `feedback_signals` in the user message.

### 8.4 Privacy

EOD recaps never sync to the Community tab. Compass enable toggle (per Phase G v1) gates auto-generation AND manual endpoint identically.

---

## 9. Implementation File Map

| Path | Action | Role |
|---|---|---|
| `api/services/journal_two/coach_prompts.py` | Modify | Add Section 6 (EOD format spec, including the reflective-question rubric with good/bad examples) to `COMPASS_SYSTEM_PROMPT`. Add `assemble_eod_user_message(data)` helper. |
| `api/services/journal_two/coach_data_assembler.py` | Modify | Add `assemble_day(user_id, account_id, day_iso, conn)` function. Add 6 multi-day arc detectors (consecutive setup losses, repeated mistake tag, regime mismatch streak, etc.). Add `weekly_eod_context` retrieval in `assemble_week`. |
| `api/services/journal_two/coach_validation.py` | **Create** | `validate_eod_output(body, data) → {passed, flags}`. `extract_this_weeks_focus(body) → str | None`. Numeric + symbol + tag grounding + format compliance checks. Light-touch question rubric. |
| `api/services/journal_two/test_coach_validation.py` | **Create** | Tests: hallucinated number is flagged; invented symbol is flagged; correct output passes; this_weeks_focus extraction handles header variants. |
| `api/services/journal_two/coach.py` | Modify | Add `generate_eod_recap` orchestrator with the validation pass + 1-retry corrective loop. Add `write_eod_recap` method on `AnthropicClient`. Add `list_eod_recaps`, `get_eod_recap`, `set_eod_viewed` helpers. Amend `generate_weekly_review` to write `this_weeks_focus` to metadata via `coach_validation.extract_this_weeks_focus`. |
| `api/services/journal_two/test_coach.py` | Modify | New tests: EOD idempotency, no-activity skip, fake-client integration. |
| `api/services/journal_two/test_coach_data_assembler.py` | Modify | New tests: `assemble_day` shape, today filter, this-week's-focus extraction, `weekly_eod_context` retrieval. |
| `api/routers/journal_two.py` | Modify | 7 new endpoints under `/coach/eod-recaps/*`. |
| `api/main.py` | Modify | Register the APScheduler EOD cron job in the lifespan handler. |
| `app/src/pages/journal-2-0/hooks/useJ2EODRecaps.js` | Create | SWR + actions. |
| `app/src/pages/journal-2-0/hooks/useJ2UnviewedEOD.js` | Create | Banner-state hook. |
| `app/src/pages/journal-2-0/components/EODRecap.jsx` | Create | Single-recap render. |
| `app/src/pages/journal-2-0/components/EODRecap.test.jsx` | Create | Vitest cases. |
| `app/src/pages/journal-2-0/components/EODRecapBanner.jsx` | Create | Cross-tab notification strip. |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | Modify | Insert "Daily Recaps" section between weekly CTA and weekly list. |
| `app/src/pages/journal-2-0/JournalTwoRoot.jsx` | Modify | Mount `EODRecapBanner` above nested tab bar. |
| `app/src/pages/journal-2-0/components/CompassReview.jsx` | Modify | Extract `renderMarkdown` helper to a shared util (`lib/coachMarkdown.js`) so EODRecap can reuse it. |
| `app/src/pages/journal-2-0/lib/coachMarkdown.js` | Create | Shared minimal-markdown renderer. |

---

## 10. Cost Estimate

Per EOD recap call (estimated):
- System prompt cached: ~3300 tokens (v2 size with the EOD section + reflective-question rubric + good/bad examples) at $0.30 / 1M cached → $0.001.
- User message (today's data + memory + arcs): ~2000-3500 tokens uncached at $3/M → $0.006-0.011.
- Output: ~400 tokens at $15/M → $0.006.
- **Total per recap (no validation retry): ~$0.013 - $0.018.**

Validation retry budget: ~15-20% of recaps are expected to trigger one retry during the first few weeks while the prompt is being tuned, dropping to <5% once the system prompt is stable. With retry:
- Worst-case retry: roughly doubles the call cost (system prompt cached, user message recached as part of the conversation continuation but the addendum is small). **Per-retry incremental cost: ~$0.010**.
- Per-recap-with-retry: ~$0.025.

Per account per month (22 trading days, active every day, with 10% retry rate):
- 22 × ($0.015 × 1.10) = **~$0.36/account/month**.

For 10 active accounts: ~$3.60/month total Compass cost from EOD alone (on top of Weekly's $1-2). Combined v1+v2 Compass cost is comfortably under $6/account/month for typical activity — well within the user's stated cost ceiling.

If a particular user's data scope is huge (50+ closed trades a day on an HFT-style account), per-recap cost could approach $0.06 with retry. Daily ceiling: $1.30/day. Still tractable.

---

## 11. Out of Scope (Future v3+ slices)

**Elite enhancements deferred to v3 polish:**

- **Visible feedback adjustment loop.** When the trader marks recaps unhelpful, the next Weekly Review explicitly tells them how Compass adjusted ("You flagged 2 recaps as generic last week; I've tightened to focus on specific trade examples"). Closes the trust loop and shows Compass is responsive, not just a passive feed. Requires adjustment-tracking in the prompt assembly + UX surfacing.
- **One-shot "Ask Compass about this →" follow-up per recap.** Below each EOD, an inline input lets the trader type one follow-up question; Compass returns a 1-2 sentence answer stored in the recap's metadata. Hard cap of one follow-up per recap so this doesn't become full chat — that's v4 (the Conversational Coach tab).
- **Quality metrics dashboard.** 👍/👎 rates per output type, regeneration rate, time-to-read after notification. Per-account adjustment signals fed back into prompt tuning.
- **Graduated banner escalation.** First-day banner is gentle; if unread for 2+ days, banner color shifts; if unread for 3+ days, Compass enters quiet mode and stops generating until the trader re-engages. Coach respects the relationship — pushing too hard kills the habit.
- **Compass milestone moments.** "First month review," anniversary notes, multi-week pattern callouts when the trader has put in enough volume for trends to be statistically meaningful.

**Standard deferred features:**

- **Email delivery** via Resend. Adds markdown→HTML rendering for email-friendly format.
- **Audio TTS** rendering (use existing voice infra).
- **Mobile push notification** when EOD lands.
- **Per-trade narration mode** — currently Compass picks 1-2 observations; a future toggle could expand to one-paragraph-per-trade.
- **EOD updating Trader Profile** — currently only Weekly writes the profile; daily update could be added if profile drift becomes a real problem.
- **Snooze / mute EOD** — if a user wants Compass to skip Tuesdays for a stretch.
- **Vacation mode** — "I'm away for N days, pause Compass" without disabling the account.
- **Shareable recap links** — opt-in, UUID-gated read-only URL so a trader can send a recap to a mentor.

---

## 12. Success Criteria

- Auto-generation at 4:30pm ET on Mon-Fri produces a recap for every active account that traded today.
- A user opening the dashboard at 5pm ET sees the cross-tab banner.
- Clicking through opens the Compass tab with today's recap pre-loaded; banner dismisses; `viewed_at` is set.
- The recap is in the Compass voice, references at least one specific trade by symbol, ends with one reflective question that obeys the §2 rubric (specific data point, not yes/no, asks about a pattern), mentions overnight holdings when present.
- **Numeric grounding holds**: every number in the recap (R-multiples, dollar amounts, percentages) appears in the injected data. The validation pass rejects + retries on hallucination; if a recap ships with `validation.passed=false`, the frontend renders the "⚠ unverified claims" badge.
- **Multi-day arcs surface when detected**: when the assembler flags a real arc (3rd consecutive Bull Flag loss, repeated mistake tag, regime mismatch streak), Compass weaves the arc into the recap by name. Standalone-feeling debriefs on days when arcs exist count as a quality regression.
- The following Weekly Review references at least one daily observation from the week's EOD recaps ("the FOMO pattern Compass flagged Tuesday and Thursday is concentrated in your Bull Flag entries").
- Manual generation works in the Compass tab CTA, returns within 30s (95th percentile) — including a validation-retry budget.
- An account with `compass_enabled = false` is skipped by the scheduler and rejected by the manual endpoint.
- Empty-activity days do not write empty rows.

---

## 13. Risks + Open Items

- **APScheduler cron registration timing.** The COT scheduler already runs; we need to add the EOD job alongside it without disrupting the existing schedule. Plan task should verify the scheduler instance is reused (not duplicated).
- **Live-price availability for unrealized R.** UCT has live-price infra (15s polling, WebSocket stream). The EOD scheduler runs at 4:30pm — right after market close — so prices should be fresh. But the assembler should handle gracefully when the price snapshot is missing or stale.
- **Cross-account batching at scale.** Sequential generation for ~10 accounts is fine. For 100+ accounts, the batch could exceed 5-10 minutes. v3 polish item: parallelize with a bounded ThreadPoolExecutor.
- **System prompt growth.** Adding Section 6 brings the prompt to ~2900 tokens. We're still well under the practical cache size cap (~10K is safe). At ~5K we might want to start splitting per-surface system prompts.
- **`this_weeks_focus` extraction at Weekly-Review-write-time still uses a tolerant matcher** (case-insensitive, with/without colon, with/without emoji), but if Compass entirely omits the section, the field is null and the EOD assembler degrades gracefully. The system prompt's Weekly Review section already mandates this section as "always one to two asks, never zero" — that constraint plus a structured extractor with tolerance handles the common cases.
- **Validation retry rate is empirical.** The 10% target retry rate is an estimate; if real-world rates climb to 30%+, that's a signal to tighten the system prompt's numeric/symbol-grounding language. The validation flags themselves become the training signal for prompt iteration. v3 polish: a weekly synthesizer that reports "Compass hallucinated N numeric tokens this week — these are the patterns" to help engineers tune the prompt.
- **Numeric extraction regex coverage.** The validator regex must match the formats Compass actually writes (`+1.4R`, `-1R`, `$420`, `2.4%`, `1,200 shares`). Missing a format = false-negative on the grounding check. Tests cover the common shapes; new shapes get added when discovered.
- **The Weekly Review's prompt now includes daily EOD context.** Cache invalidation is fine (system prompt is the cached portion; user message is fresh). But the Weekly's token budget per generation grows by ~5 × 200 = 1000 tokens of EOD memory. Per-Weekly cost goes up slightly. Acceptable.
- **No test for the scheduler integration itself.** Unit tests cover the orchestrator + assembler with FakeClient. The scheduler is tested via manual smoke (the implementation plan should call this out).
