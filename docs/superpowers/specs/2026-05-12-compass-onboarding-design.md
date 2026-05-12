# Compass Onboarding Interview — Design Spec

**Date:** 2026-05-12
**Author:** UCT
**Status:** Approved by user, pending plan
**Predecessor:** `2026-05-11-compass-chat-design.md` (Compass Chat shipped 2026-05-11)

## 1. Goal

Give every Compass-enabled account a deep, Compass-led onboarding interview that establishes:
- A substantive **Trader Profile** (markdown blob on `j2_accounts.trader_profile`)
- An initial **`this_weeks_focus`** if the trader articulates a clear weekly goal
- **Initial account settings** (risk caps, daily loss limit, A+ setups) inferred from answers and confirmed inline
- A **raw Q&A archive** in `j2_onboarding_responses` for audit + future re-synthesis

After this build, a new trader can sit down with Compass for 10-15 minutes and walk away with a coach who knows their style, strengths, weaknesses, and goals — *before* the first trade is logged.

## 2. Why now

Compass Chat (Phase G v3) shipped 2026-05-11 and is conversational. But Compass currently meets every new trader **cold** — it can only read what's already in `j2_*` tables. The Trader Profile is built only AFTER the first Weekly Review, which requires the trader to have logged trades first. Result: Compass's first weeks of coaching a new trader are generic until the data accumulates.

A pro coach doesn't work this way. They interview you first. That interview is the foundation of everything they say to you for the next year.

This build closes that gap. Reuses 70% of the Compass Chat surface (same panel, same streaming, same persistence). Adds an "interview mode" the trader can enter via a single button.

## 3. High-level architecture

The onboarding interview is **a special chat conversation**. Same chat panel. Same streaming. Same DB. The only differences:

1. **An `onboarding_mode` flag** on `j2_accounts` that, when true, appends a Section 8 directive to the system prompt — Compass switches from "answer questions" mode to "lead the interview" mode.
2. **Three new action tools** Compass invokes during the interview (record answer, propose setting, complete onboarding).
3. **One new endpoint** to kick the interview off (`POST /coach/chat/start_onboarding`).
4. **UI tweaks** to the existing `CompassChat` panel that surface the start CTA, the progress badge, and the pause/redo controls.

```
┌────────────────────────────────────────────────────────┐
│  Compass tab → "🧭 Talk to Compass" panel              │
│       │                                                 │
│       │  if onboarded=false → "🧭 Start onboarding"    │
│       │  if onboarding_mode=1 → "Onboarding · N of 10" │
│       │  if onboarded=true → normal chat                │
│       ▼                                                 │
│  POST /coach/chat/start_onboarding (NEW)                │
│       │                                                 │
│       ▼                                                 │
│  coach_chat.start_onboarding(...)  (NEW)                │
│       │  sets onboarding_mode=1, assigns session_id     │
│       │  inserts [BEGIN_ONBOARDING] sentinel user msg   │
│       │                                                 │
│       ▼                                                 │
│  handle_user_turn (existing)                            │
│       │  checks onboarding_mode → appends Section 8     │
│       │  Compass reads sentinel + asks first question   │
│       │  Compass calls record_onboarding_answer / etc.  │
│       │  Compass calls complete_onboarding when done    │
│       │                                                 │
│       ▼                                                 │
│  on complete: onboarded=1, onboarding_mode=0,           │
│  trader_profile written, this_weeks_focus written       │
└────────────────────────────────────────────────────────┘
```

## 4. Data model

### 4.1 New columns on `j2_accounts`

```sql
ALTER TABLE j2_accounts ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE j2_accounts ADD COLUMN onboarding_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE j2_accounts ADD COLUMN onboarding_session_id TEXT;
```

`onboarded`: 0 until `complete_onboarding` runs. Drives the empty-state CTA.
`onboarding_mode`: 1 while interview is active. Drives the system prompt addendum.
`onboarding_session_id`: current interview's session UUID. Lets the trader pause/resume; lets "redo" preserve old responses under a different session_id.

### 4.2 New table `j2_onboarding_responses`

```sql
CREATE TABLE j2_onboarding_responses (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  session_id  TEXT NOT NULL,           -- groups one interview run
  category    TEXT NOT NULL,            -- 'identity'|'account'|'style'|'setups'|
                                         -- 'sizing'|'strengths'|'weaknesses'|
                                         -- 'psychology'|'process'|'goals'
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  asked_at    TEXT NOT NULL
);

CREATE INDEX idx_j2_onboarding_session
  ON j2_onboarding_responses(account_id, session_id, asked_at);
```

One row per Q&A pair. Compass logs each via `record_onboarding_answer` tool.

### 4.3 Trader Profile output format

When Compass calls `complete_onboarding(...)`, it writes a markdown profile to `j2_accounts.trader_profile`. Suggested structure (Compass has license to deviate within reason):

```markdown
# Trader Profile — [Name]

## Identity
[2-3 sentences: years trading, mode (full/part/hobby), why they trade]

## Account context
[Account size, hours available, life context that affects head]

## Style
[Time frame, instruments, hold duration, long/short bias]

## Setups
- A+: [setup name + brief description of perfect example]
- Common: [other setups they take]
- Retired: [setups they stopped, with reason]

## Sizing + Risk
[Typical %, hard line, daily loss limit, scale-in/out approach]

## Strengths
[2-3 sentences: what they do well, validated edge]

## Weaknesses / Open threads Compass is tracking
[2-4 sentences: known leaks, behaviors they want to change]

## Psychology
[Common emotions, tilt triggers, weak hours/days]

## Process
[Pre-market routine, review cadence, plan vs. screen-driven]

## Current focus
[1-2 sentences: this-week + this-quarter goals; specific behaviors to change]

## What they want from me
[1 sentence: accountability, pattern-spotting, devil's advocate, etc.]
```

This is the SAME schema as the profile that Weekly Review's `write_profile_update` produces — onboarding seeds it; Weekly Review iterates on it.

## 5. The interview itself — 10 categories

The interview prompt (Section 8) instructs Compass to cover all 10 categories before terminating. Compass picks order adaptively, asks follow-up questions when an answer hints at something deeper, moves on when a category is sufficiently covered.

### Category checklist

| # | Category | Core questions |
|---|---|---|
| 1 | **Identity + Why** | Name preference; years trading; mode (full/part/hobby); why trading; 3-5yr vision |
| 2 | **Account + Life Context** | Live account size; paper account size if separate; hours available per day; time of day; life factors |
| 3 | **Style + Time Frame** | Day/swing/position/mix; long/short bias; instruments; typical hold |
| 4 | **Setups** | 2-3 most-taken setups; the A+ one with edge; setups retired and why |
| 5 | **Sizing + Risk Rules** | Typical % risked; hard never-cross line; daily loss limit; scale-in/out preference |
| 6 | **Strengths** | One thing genuinely proud of; edge over past-self-1yr-ago; A+ execution rate |
| 7 | **Weaknesses** | Mistake costing the most $; behavior can't seem to stop; blowup-day pattern |
| 8 | **Psychology** | Most-frequent emotion; post-loss next-60-min behavior; post-win size discipline; worst time of day/week |
| 9 | **Process** | Pre-market routine; post-close review cadence; watchlist; plan-driven vs screen-driven |
| 10 | **Goals + What from Compass** | This-week great; this-quarter great; specific 30d behavior to change; what coaching role |

### Adaptive follow-up rubric

Compass dives deeper when:
- Trader gives a vague answer ("I trade swings" → "Daily or weekly chart?")
- Trader names a setup ("Bull Flags" → "Pole length, base tightness, breakout volume requirements?")
- Trader names a weakness ("FOMO" → "When does FOMO hit hardest — open, midday, post-winner?")
- Trader's answer reveals a contradiction (claims 0.5% sizing but mentions a blowup → "What sizing happened on the blowup?")

Compass moves on when:
- Trader gives a substantive answer covering multiple sub-questions
- Trader signals "next" or "rather not say"
- The category has 1+ logged answer

### Termination criteria

Compass calls `complete_onboarding(...)` when ALL of:
1. At least one `record_onboarding_answer` entry exists in EACH of the 10 categories.
2. Trader has been explicitly asked about strengths, weaknesses, AND this-week goal.
3. Compass shows a DRAFT profile in chat and gives the trader a chance to revise: *"Here's what I've gathered. Anything to change before I save?"*
4. Trader accepts the draft (or asks for changes, which Compass refines until accepted).

## 6. Tool catalog additions

Four new entries in `coach_chat_tools.py`. Two read, two action.

### `get_onboarding_progress` (read, no confirmation)
```json
{
  "name": "get_onboarding_progress",
  "description": "Returns which onboarding categories have been answered in the current session and how many questions have been asked.",
  "input_schema": {"type": "object", "properties": {}}
}
```
Returns `{session_id, categories_covered: [str], categories_remaining: [str], questions_asked: N, started_at}`. Called by Compass at the start of every onboarding turn so it knows where to pick up.

### `record_onboarding_answer` (write, silent — no confirmation)
```json
{
  "name": "record_onboarding_answer",
  "description": "Record a question + the trader's answer to the onboarding archive. Compass calls this each time the trader gives a substantive answer.",
  "input_schema": {
    "type": "object",
    "properties": {
      "category": {"type": "string", "enum": ["identity","account","style","setups","sizing","strengths","weaknesses","psychology","process","goals"]},
      "question": {"type": "string"},
      "answer": {"type": "string"}
    },
    "required": ["category","question","answer"]
  },
  "requires_confirm": false
}
```

Exception to the "all action tools require confirm" rule (§9 of Compass Chat spec): this tool is silent archive-only, no user-facing state change. Silent writes are acceptable because the trader is in active back-and-forth with Compass; explicit per-answer confirmation would shatter the conversational feel.

### `propose_account_settings` (write, preview/confirm)
```json
{
  "name": "propose_account_settings",
  "description": "Propose initial discipline settings inferred from interview answers. The trader sees a preview card and confirms each setting individually.",
  "input_schema": {
    "type": "object",
    "properties": {
      "maxRiskPerTradePct": {"type": "number"},
      "dailyLossLimitPct": {"type": "number"},
      "coolingOffMinutesAfterLoss": {"type": "integer"},
      "aPlusSetups": {"type": "array", "items": {"type": "string"}}
    }
  },
  "requires_confirm": true
}
```

Standard preview/confirm flow. Preview narration: *"Set risk cap to 1%, daily loss limit to 3%, A+ setups to [Bull Flag, Pullback]?"*. User clicks Confirm → all fields update atomically. Cancel → none update.

### `complete_onboarding` (write, preview/confirm — terminal)
```json
{
  "name": "complete_onboarding",
  "description": "Finalize the interview. Writes trader_profile, sets onboarded=1, exits onboarding_mode, optionally seeds this_weeks_focus.",
  "input_schema": {
    "type": "object",
    "properties": {
      "trader_profile": {"type": "string", "description": "Full markdown profile (use the template from §4.3)"},
      "this_weeks_focus": {"type": "string", "description": "Optional — if the trader articulated a specific weekly behavior goal"}
    },
    "required": ["trader_profile"]
  },
  "requires_confirm": true
}
```

Preview shows the trader the proposed profile + optional focus. *"Save this profile? You can edit it anytime in Settings."* Confirm → writes everything, exits onboarding mode. After execution, Compass writes a graceful "you're set up" farewell message.

## 7. System prompt — Section 8 (onboarding directive)

Appended to `COMPASS_SYSTEM_PROMPT` ONLY when `onboarding_mode=1` (see §8 in this spec). Cached separately.

```
## 8. Onboarding interview mode

You're conducting a structured onboarding interview. The trader clicked
"Start interview" to give you the context you need to coach them well.

### Your job

Conduct a thoughtful 10-minute interview covering 10 categories:
1. Identity + Why
2. Account + Life Context
3. Style + Time Frame
4. Setups they actually trade
5. Sizing + Risk Rules
6. Strengths — what they do well
7. Weaknesses — known leaks
8. Psychology + Triggers
9. Process + Routine
10. Goals + what they want from Compass

For EACH category, you must log at least one answer via `record_onboarding_answer`.

### How to interview

- **Lead. Don't wait.** You're driving. Compass picks one question, asks
  it cleanly, listens, and decides what to ask next.
- **Pick order adaptively.** Start with whatever feels natural (often
  identity → context → style). Don't follow the numbered list mechanically.
- **Dig deeper when something hints at depth.** If the trader names a
  setup, ask what their perfect version looks like. If they name a
  weakness, ask when it shows up. If they give a vague answer, ask
  for specifics.
- **Move on when a category is covered.** Don't grind. Substantive
  one-paragraph answer ≥ checklist completion.
- **Track progress.** Call `get_onboarding_progress` at the start of each
  turn so you know what's been covered and what's left.

### When the trader answers

Call `record_onboarding_answer(category, question, answer)` BEFORE asking
the next question. Silent write — the trader doesn't see this tool call.

### When you infer a setting

If the trader's answer reveals a clear discipline rule — "I risk 1% per
trade" or "Bull Flags are my A+" — pause the interview and call
`propose_account_settings` with the inferred field(s). The trader gets
a confirm card. Either way, continue the interview after.

### Off-topic redirect

If the trader asks an off-topic question mid-interview, gently redirect:
"Let's finish the interview first — then we can dig into anything. So:
[restate last question]"

Exception: if the trader gets genuinely frustrated and says "skip this"
or "I want to chat now," pause gracefully:
"Got it. I've saved what we have. Hit 'Resume interview' in the menu
when you want to finish. For now — what's on your mind?"

You should NOT call read tools (list_recent_trades, etc.) during the
interview. Those are for post-onboarding chat.

### Termination

Call `complete_onboarding(...)` when:
- All 10 categories have at least one logged answer
- Strengths, weaknesses, and a this-week goal are all explicitly covered
- You've shown the trader a draft profile and they've accepted (or
  iterated on it). Show the draft FIRST, in a regular chat message,
  with the question "Anything to change before I save this?"

### Tone

Warm but professional. Curious, not nosy. You're meeting a serious
trader, not running a survey. They've earned the right to be heard.
```

## 8. Backend changes — orchestrator wiring

In `coach_chat.py`, `handle_user_turn` adds before building the system prompt:

```python
row = _conn.execute(
    "SELECT onboarding_mode FROM j2_accounts WHERE id = ? AND user_id = ?",
    (account_id, user_id),
).fetchone()
onboarding = bool(row and row["onboarding_mode"])
system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT
if onboarding:
    system_prompt += "\n\n" + coach_prompts.COMPASS_ONBOARDING_DIRECTIVE
```

(Direct SQL query rather than going through `accounts_service.get_account_settings` — avoids depending on whether the camelCase translator surfaces the new columns. The implementer can extend the settings translator separately if desired; the orchestrator's read here is intentionally surgical.)

Anthropic prompt caching: the base prompt stays cached; the appendix is a separate cache block that only fires when onboarding is active.

## 9. New endpoint

```python
POST /api/j2/accounts/{account_id}/coach/chat/start_onboarding
```

Body: empty or `{resume: bool}`. Response: SSE stream identical shape to `/chat/stream`.

Behavior:
1. Validate user owns the account + `compassEnabled=True`.
2. If `onboarded=1`: return 400 (use `/redo_onboarding` instead).
3. If `onboarding_mode=1`: this is resume — fetch existing `session_id`, re-stream Compass's resume opener. Compass calls `get_onboarding_progress` and picks up.
4. Else (fresh start): set `onboarding_mode=1`, generate new `session_id`, persist a synthetic user message `[BEGIN_ONBOARDING_INTERVIEW]` in `j2_chat_messages`, then call `handle_user_turn` to get Compass's opener.

Synthetic user message is a special invisible marker — the system prompt's Section 8 says *"When you see `[BEGIN_ONBOARDING_INTERVIEW]`, introduce yourself warmly and ask the first question."* The frontend hides messages matching this sentinel.

Companion endpoint: `POST /coach/chat/redo_onboarding` — only callable when `onboarded=1`. Resets `onboarded=0`, sets `onboarding_mode=1`, assigns NEW `session_id`, preserves the prior session's responses, returns SSE.

Companion endpoint: `POST /coach/chat/skip_onboarding` — only callable when `onboarded=0` AND `onboarding_mode=0`. Sets `onboarded=1` silently with no profile. Returns 200 JSON. Used by the "Skip and start chatting →" link on the empty state.

## 10. Frontend changes — CompassChat panel

### Empty state when `onboarded=false` AND `onboarding_mode=false`

Replace the 4 suggested-prompt chips with one large CTA:

```
            🧭

       Welcome to Compass.

  Before we start coaching, I'd like
   to interview you for a few minutes
    so I can be useful to you.

  [    🧭 Start onboarding interview    ]

         Skip and start chatting →
```

`Start onboarding interview` button → POST `/start_onboarding` → SSE stream begins.

`Skip` link → POST a small endpoint (`/skip_onboarding`) that sets `onboarded=1` silently, then renders the standard empty state with the 4 suggested prompts.

### Header during `onboarding_mode=true`

Header morphs from "🧭 Talk to Compass" to:

```
🧭 Onboarding interview · 4 of 10 covered                         [ ⋯ ]
```

Progress count comes from `get_onboarding_progress`. The overflow menu adds two items:
- "Pause interview (resume anytime)"
- "Clear conversation" (existing)

Pause is a soft-leave — just lets the trader switch tabs. Clicking back into Compass while `onboarding_mode=1` resumes from where Compass left off.

### Post-onboarding (`onboarded=true`)

Normal Compass chat panel. Overflow menu gains one new item:

- "Redo onboarding" (with confirmation: *"This starts a fresh interview. Your existing profile stays unless you complete the new one. Continue?"*)

### Sentinel message hiding

Messages whose content equals `[BEGIN_ONBOARDING_INTERVIEW]` are hidden from the scrollback render. They exist in `j2_chat_messages` but don't display.

### Inline `propose_account_settings` cards

Render in the chat scrollback exactly like the existing `ChatActionCard` — gold accent, Confirm/Keep buttons. No new component needed.

### Draft-profile review step

When Compass writes the draft, it's just a normal assistant message with a long markdown body. Renders with the existing `ChatMessage` + `renderMarkdown` — the profile structure renders as nested headings + bullets naturally.

## 11. Safety

| Safeguard | Mechanism |
|---|---|
| **Compass-enabled gate** | `/start_onboarding` and `/redo_onboarding` both 403 when `compassEnabled=false`. |
| **Kill switch** | Existing `COMPASS_CHAT_ENABLED=false` env var stops onboarding too (it's just a chat call). |
| **Rate limit** | Existing 200/day still applies. A deep interview is ~25 turns — well within budget. |
| **Audit trail** | `j2_onboarding_responses` archives every Q&A with timestamp + session_id. |
| **Action confirmation** | `propose_account_settings` and `complete_onboarding` both require explicit Confirm (existing pattern). |
| **Off-topic redirect** | Encoded in Section 8 prompt. Compass gently steers back. |
| **Abandonment protection** | `onboarding_mode=1` persists; resume on next visit; no data loss. |
| **Redo doesn't destroy** | New `session_id` for redo; old responses kept. Trader can audit later. |
| **Hallucination audit** | Existing async audit pass runs on assistant messages during onboarding too. Numbers cited by Compass should match the trader's stated values. |

## 12. Cost

Per onboarding (one-time per trader):
- ~20-30 user turns × ~$0.05-0.10/turn = **$1-4 per trader**
- Each turn: small prompt (system + Section 8 + history) + small output. Heavy prompt caching keeps marginal cost low.

Redo: same cost as a fresh onboarding.

## 13. Test plan

### Backend unit tests (`test_coach_chat_tools.py` + `test_coach_chat.py`)

- `test_record_onboarding_answer_inserts_row` — writes Q&A to `j2_onboarding_responses`
- `test_record_onboarding_answer_rejects_unknown_category` — schema validation
- `test_get_onboarding_progress_returns_covered_and_remaining` — seeded with 4 answers across 3 categories
- `test_propose_account_settings_preview_returns_narration` — seeds inferred fields, preview describes change
- `test_propose_account_settings_execute_updates_multiple_fields_atomically` — single confirm writes all fields
- `test_complete_onboarding_writes_profile_and_marks_onboarded` — verifies all 3 state writes (profile, onboarded=1, onboarding_mode=0, optional focus)
- `test_complete_onboarding_includes_this_weeks_focus_when_supplied` — focus lands on metadata
- `test_start_onboarding_marks_mode_and_assigns_session` — happy path
- `test_start_onboarding_resume_returns_existing_session` — second call when mode already active
- `test_start_onboarding_blocked_when_already_onboarded` — 400 with redo hint
- `test_handle_user_turn_appends_section_8_when_onboarding_mode` — verify prompt content
- `test_redo_onboarding_preserves_prior_responses` — old session_id rows remain; new session_id rows accumulate

### Frontend tests (`CompassChat.test.jsx` additions)

- `renders Start Onboarding CTA when onboarded=false`
- `renders Onboarding header with progress count when onboarding_mode=true`
- `clicking Start Onboarding calls /start_onboarding`
- `renders Redo Onboarding option in overflow menu when onboarded=true`
- `hides messages whose content equals [BEGIN_ONBOARDING_INTERVIEW]`

### Smoke (manual, post-deploy)

1. Fresh account (`onboarded=false`) → see Start CTA.
2. Click Start → Compass introduces itself + asks first question.
3. Answer 5-10 questions → progress counter increments.
4. Drop a number ("I risk 1%") → preview card appears inline.
5. Refresh tab mid-interview → Compass resumes.
6. Complete interview → see draft → accept → profile saved.
7. Verify `j2_accounts.trader_profile` contains the structured markdown.
8. Verify `j2_onboarding_responses` has 10+ rows for the session.
9. Verify `onboarded=1` and `onboarding_mode=0`.
10. "Redo onboarding" → fresh interview; old session_id rows preserved.

## 14. File map

### New
- (none — additions only)

### Modified
- `api/services/journal_two/db.py` — 3 new columns on j2_accounts, 1 new table `j2_onboarding_responses`
- `api/services/journal_two/coach_chat_tools.py` — 4 new tools (1 read, 3 action)
- `api/services/journal_two/coach_chat.py` — `start_onboarding`, `skip_onboarding`, `redo_onboarding` entry-point functions; `handle_user_turn` appends Section 8 when in onboarding mode
- `api/services/journal_two/coach_prompts.py` — `COMPASS_ONBOARDING_DIRECTIVE` exported as a new module-level constant
- `api/routers/journal_two.py` — 3 new endpoints (start, skip, redo)
- `app/src/pages/journal-2-0/hooks/useJ2CoachChat.js` — expose `startOnboarding`, `skipOnboarding`, `redoOnboarding`, derive `isOnboarding` flag from status
- `app/src/pages/journal-2-0/components/CompassChat.jsx` — empty-state morph + header morph + overflow menu items + sentinel filter

## 15. Scope NOT in v1 (deferred)

- **Voice-led onboarding** — text-only interview in v1. The Voice→Compass bridge task (#122) would unlock voice onboarding later for free.
- **Multi-account onboarding wizard** — each account onboards independently. No "copy profile from account A to B" tool.
- **Profile editor UI** — trader can already edit the profile via the existing TraderProfileEditor on the Compass tab; no new dedicated editor.
- **Onboarding analytics dashboard** — no admin view of "which questions take longest", "average completion rate", etc.
- **Branching templates** — every trader gets the same 10-category framework. Specialized templates (e.g., for options traders, futures traders) deferred.
- **Auto-trigger on first visit** — manual button only. User explicitly chose this in brainstorm.

## 16. Open questions (handled by future polish)

- **Profile re-synthesis from existing data** — when a trader who's been using Compass for months runs "redo onboarding," should Compass pre-populate answers from their existing trade history? (e.g., "I see you've taken 47 Bull Flags this quarter — is that still your A+?"). Defer to v2.
- **Profile freshness decay** — should Compass periodically suggest re-onboarding ("Last interview was 6 months ago — want a refresh?"). Defer.
- **Onboarding completion as a milestone celebration** — confetti, badge, etc. Skip for v1; profile-saved farewell message is enough.
