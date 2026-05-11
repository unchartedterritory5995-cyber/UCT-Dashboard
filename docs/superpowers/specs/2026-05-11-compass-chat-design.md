# Compass Chat — Design Spec

**Date:** 2026-05-11
**Author:** UCT
**Status:** Approved by user, pending plan
**Predecessor:** `2026-05-10-j2-phase-g-coach-core-weekly-review-design.md` (G1 Weekly), `2026-05-11-j2-phase-g-v2-eod-recap-design.md` (G2 EOD)

## 1. Goal

Turn Compass from a one-way narrator into a **conversational coaching partner**. The trader can ask Compass anything about their journal, request analysis on demand, and authorize Compass to take actions (tag trades, set this week's focus, mute setups, adjust discipline guardrails).

After this build, every existing Compass surface (Weekly Review, EOD Recap, Trader Profile) continues to work. Chat is additive — a fourth surface that complements the three.

## 2. Why now

Elite human coaches don't write a recap and disappear. They have ongoing dialogue with the trader. Today's UCT product asks the trader to come to Compass on Compass's schedule (4:30 PM ET EOD, Sunday Weekly). Chat flips that: Compass is available whenever the trader wants.

This is the single biggest unlock for the "$100k/month coach" perception:
- Replaces 80% of the "I have a question" → ChatGPT → answer-with-no-context flow.
- Enables the trader to **interrogate their own data conversationally** ("why did I tank in March?", "compare my Bull Flags and Pullbacks").
- Provides a new action surface where Compass can **commit changes on the user's behalf** with explicit confirmation — closes the loop between observation and action.

## 3. High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Compass Tab (existing) → new "Talk to Compass" panel        │
│       │                                                       │
│       ▼ POST /coach/chat/stream  (SSE)                        │
│  api/routers/journal_two.py                                  │
│       │                                                       │
│       ▼                                                       │
│  api/services/journal_two/coach_chat.py  (NEW)                │
│       │                                                       │
│       ├──► coach_prompts.COMPASS_SYSTEM_PROMPT                │
│       │      + Section 7 (chat-specific guidance)             │
│       ├──► coach_chat_tools.py  (NEW — tool dispatcher)       │
│       │      ├── read tools  (synchronous, no confirm)        │
│       │      ├── analysis tools  (synchronous, no confirm)    │
│       │      └── action tools  (preview → confirm → execute)  │
│       ├──► coach_data_assembler  (reused for read tools)      │
│       └──► Anthropic Sonnet 4.6 messages.stream(...)          │
│              with tool_use + tool_result loop                 │
└──────────────────────────────────────────────────────────────┘
            ▲                                  │
            │ SSE chunks                       │
            │                                  ▼
┌──────────────────────────────────────────────────────────────┐
│   j2_chat_messages  (NEW table — user / assistant / tool)    │
│   j2_accounts.muted_setups (NEW column — for mute_setup)     │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Module boundaries

- `coach_chat.py` — orchestrator. Owns the chat loop, history retrieval + summarization, Anthropic streaming, audit trail writes. No tool logic.
- `coach_chat_tools.py` — flat catalog of tool functions + JSON schemas. Each tool is `(name, schema, executor)` where executor runs the tool against the j2 services. Action tools have separate `preview` and `execute` halves.
- `coach.py` — unchanged. Continues to handle Weekly + EOD generation.
- `coach_data_assembler.py` — unchanged. Several read tools wrap its existing functions (`assemble_week`, `assemble_day`, `_trades_in_range`).

### 3.2 Single persistent conversation per account

There is **one** ongoing conversation per `(user_id, account_id)`. All messages live in `j2_chat_messages`, ordered by `created_at`. No sessions, no threads. This matches the design decision in the brainstorm.

Older messages get auto-summarized when context grows large (§4.4).

## 4. Data model

### 4.1 New table: `j2_chat_messages`

```sql
CREATE TABLE j2_chat_messages (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  role            TEXT NOT NULL CHECK(role IN ('user','assistant','tool','summary')),
  content         TEXT,                   -- visible text (NULL for tool calls that only have args)
  tool_calls      TEXT,                   -- JSON: [{id, name, args}]  (assistant turn only)
  tool_results    TEXT,                   -- JSON: [{tool_call_id, result}]  (tool turn only)
  parent_id       TEXT,                   -- groups a single turn (assistant + its tool messages share parent_id)
  metadata        TEXT,                   -- JSON: streaming complete?, validation, etc.
  created_at      TEXT NOT NULL,
  forgotten       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_j2_chat_account
  ON j2_chat_messages(user_id, account_id, created_at);
CREATE INDEX idx_j2_chat_parent
  ON j2_chat_messages(parent_id);
```

**Role semantics:**
- `user` — text typed by the trader. `content` non-null, `tool_calls`/`tool_results` null.
- `assistant` — Compass's response text + optional tool calls. `content` is the visible narrative; `tool_calls` is the JSON list of any tool invocations.
- `tool` — record of a tool execution. `tool_results` carries the result(s). One row per tool turn (may contain multiple results if Compass batched calls).
- `summary` — auto-generated summarization of older messages (see §4.4). Replaces the messages it summarized when context is reconstructed.

**Why not reuse `j2_coach_outputs`?**
1. `j2_coach_outputs.output_type` is one of `{weekly_review, eod_recap, pre_trade_verdict, chat_turn, profile_update}` (the CHECK already enumerates `chat_turn`).
2. But chat needs both `user` and `assistant` roles AND tool calls AND tool results — the existing schema's `body`/`summary` columns can't carry that structure cleanly.
3. Separate table = clean indexes, clean queries, clean audit trail.

The original `chat_turn` CHECK value can stay reserved but unused; we won't write to `j2_coach_outputs` for chat.

### 4.2 New column: `j2_accounts.muted_setups`

For the `mute_setup` action tool. JSON array of `{setup_name, until_date}` objects.

```sql
ALTER TABLE j2_accounts ADD COLUMN muted_setups TEXT NOT NULL DEFAULT '[]';
```

Currently unused by anything else; Pre-Trade Verdict (future build) will read this and reject entries on muted setups.

### 4.3 Active conversation reconstruction

When servicing a new user turn, the orchestrator runs:

```python
messages = list_conversation(
    user_id, account_id,
    include_summaries=True,
    exclude_forgotten=True,
    limit=200,                # absolute hard cap
)
```

Returns rows in chronological order. The orchestrator translates each row into the Anthropic messages API shape:

- `role='user'` row → `{role: 'user', content: text}`
- `role='assistant'` row → `{role: 'assistant', content: [text_block, tool_use_block, ...]}`
- `role='tool'` row → `{role: 'user', content: [tool_result_block, ...]}` (Anthropic convention)
- `role='summary'` row → `{role: 'user', content: f"[Earlier in this conversation, summarized: {text}]"}`

### 4.4 Sliding-window summarization

When the assembled history exceeds **80,000 input tokens** (estimated via `len(json) / 3.5`), the orchestrator:

1. Selects the oldest **30%** of non-summary messages.
2. Calls Anthropic with a tiny summarization prompt: *"Summarize this conversation segment in ≤500 tokens, preserving any user-stated focus, behavioral commitments, or Compass observations of trader patterns. Drop tool-call mechanics, keep only insight."*
3. Inserts a new `role='summary'` row.
4. Sets `forgotten=1` on the messages summarized (so they're excluded from future reconstructions).

This runs **before** the model is called, lazily. Cost: one small auxiliary call per ~50-100 user turns.

## 5. Endpoints

All under `/api/j2/accounts/{account_id}/coach/chat/...`, scoped by `Depends(get_current_user)`, gated by `compassEnabled`.

### 5.1 `POST .../chat/stream`

Request body: `{message: string}` (user's text)

Behavior:
1. Validate `compassEnabled`. 403 if disabled.
2. Append `role='user'` row to `j2_chat_messages`.
3. Run summarization if needed.
4. Reconstruct conversation.
5. Open Anthropic `messages.stream(...)` with system prompt + tool definitions + history.
6. As tokens stream in:
   - Forward each chunk as an SSE event (`data: {"type":"token","text":"..."}\n\n`).
   - When the model emits `tool_use`, the orchestrator checks the tool category:
     - **Read / analyze tools** → execute immediately, emit `tool_result` back into the stream, model continues. Emit SSE event `{"type":"tool_call","name":"...","args":{...}}`.
     - **Action tools** → DO NOT execute. Emit `{"type":"tool_call_pending","tool_call_id":"...","name":"...","args":{...},"preview":"..."}`. The model continues its response WITHOUT receiving a tool_result for this call (it ends the turn). User must call `/chat/confirm` separately.
7. When model finishes, write `role='assistant'` row with `content` + `tool_calls` JSON, and (if any tools ran inline) `role='tool'` row(s) with results.
8. Close SSE with `{"type":"complete","message_id":"..."}`.
9. (Async) Spawn hallucination-audit task on the assistant message (§9.4).

Response: `text/event-stream`.

### 5.2 `GET .../chat/messages`

Paginated history. Query params: `limit=50`, `before_id?`.

Response: `{messages: [{id, role, content, tool_calls?, tool_results?, created_at, forgotten}], has_more: bool}`.

### 5.3 `POST .../chat/confirm`

Request: `{message_id: str, tool_call_id: str}` — confirm execution of a pending action tool.

Behavior:
1. Look up the assistant message, find the matching pending tool_call (must be of an action-tool name).
2. Execute via the tool's `execute` function. Synchronous, returns a result dict.
3. Write a new `role='tool'` row with `tool_results` containing `{tool_call_id, result}`.
4. Stamp the assistant message's `tool_calls` JSON to mark this call's `status='confirmed'`.
5. Re-invoke the model with the new tool_result appended to history (so Compass can acknowledge: "Done. Set Pullback to muted until 2026-05-25."). This second call is streamed back via SSE on a new endpoint:

Returns SSE stream (same shape as 5.1) of Compass's acknowledgement turn.

### 5.4 `POST .../chat/cancel`

Request: `{message_id: str, tool_call_id: str}` — user clicked Cancel on a pending action.

Behavior:
1. Mark the call's `status='cancelled'` in the assistant message's `tool_calls`.
2. Append a small system note as a `role='tool'` row: `{result: {cancelled: true, reason: 'user_cancelled'}}`.
3. Re-invoke the model briefly (single short turn) so Compass acknowledges ("Got it, didn't mute."). Streamed via SSE.

### 5.5 `POST .../chat/forget`

Request: `{message_id?: str, all?: bool}`.

Behavior:
- If `message_id`: set `forgotten=1` on that one message.
- If `all=true`: set `forgotten=1` on every non-summary message in the conversation. The conversation effectively resets but summaries remain — Compass keeps a faint memory of past insights but no specific message history.

### 5.6 `GET .../chat/status`

Returns `{enabled: bool, rate_limit_remaining: int, conversation_message_count: int}`.

Used by the frontend to detect rate-limit exhaustion before submitting, and to gate UI when `COMPASS_CHAT_ENABLED=false`.

## 6. Tool catalog

Defined in `coach_chat_tools.py` as a dict `TOOLS = {name: {schema, executor, requires_confirm}}`. The orchestrator builds Anthropic's `tools` parameter from this dict.

### 6.1 Read tools (no confirm)

#### `list_recent_trades`
```json
{
  "name": "list_recent_trades",
  "description": "Fetch closed trades from the journal, optionally filtered.",
  "input_schema": {
    "type": "object",
    "properties": {
      "days": {"type": "integer", "default": 30, "minimum": 1, "maximum": 365},
      "symbol": {"type": "string"},
      "setup": {"type": "string"},
      "result": {"type": "string", "enum": ["Win", "Loss", "BE"]},
      "regime": {"type": "string", "enum": ["GREEN", "AMBER", "ORANGE", "RED"]},
      "limit": {"type": "integer", "default": 100, "maximum": 500}
    }
  }
}
```
Returns: `{trades: [...], count: N, range: "...to..."}`. Each trade dict is the same shape `_trades_in_range` returns from `coach_data_assembler.py`.

#### `get_aggregates`
```json
{
  "name": "get_aggregates",
  "description": "Compute aggregate stats for a period, with optional breakdown by dimension.",
  "input_schema": {
    "type": "object",
    "properties": {
      "period": {"type": "string", "enum": ["today", "week", "month", "ytd", "all"], "default": "week"},
      "breakdown_by": {"type": "string", "enum": ["setup", "day_of_week", "hour", "emotion", "mistake", "regime", "symbol"]}
    }
  }
}
```
Returns: aggregate dict + (if breakdown_by) per-bucket aggregate list.

#### `get_open_positions`
Returns: `{positions: [...], count: N}`. Same shape as `_open_positions` in the data assembler.

#### `get_trader_profile`
Returns: `{profile_markdown: "...", updated_at: "..."}`.

#### `get_recent_recaps`
Args: `kind` (`eod`|`weekly`|`all`, default `all`), `limit` (default 10).
Returns: list of `{day_or_week, summary, body}` objects.

#### `get_account_settings`
Returns: full settings dict (caps, lockouts, A+ setups, muted_setups, sizing).

#### `get_setup_stats`
Args: `setup?`.
Returns: per-setup stats from `j2_setup_stats` (trade_count, win_rate, avg_r, expectancy).

#### `find_arcs`
Args: `lookback_days` (default 10).
Returns: `{arcs: [str, str, ...]}` from `_detect_recent_arcs`.

### 6.2 Analysis tools (no confirm)

These compute on the fly. Each accepts a `days` lookback (default 180) plus filters.

#### `analyze_time_of_day`
Args: `setup?`, `symbol?`, `days=180`.
Returns: `{hour: {trade_count, win_rate, avg_r}}` for hours 9-16 ET. Server uses `entry_date` parsed as ET local time.

#### `analyze_day_of_week`
Args: `setup?`, `days=180`.
Returns: `{Mon: {...}, Tue: {...}, ...}` similar shape.

#### `analyze_hold_duration`
Args: `setup?`, `days=180`.
Returns:
```json
{
  "winners": {"avg_days": 3.2, "median_days": 2.5, "count": 18},
  "losers": {"avg_days": 0.6, "median_days": 0.5, "count": 22},
  "hint": "cutting_winners_short" | "holding_losers" | "balanced"
}
```
Heuristic: if `losers.avg_days < winners.avg_days * 0.4`, hint = `cutting_winners_short`. Inverse for `holding_losers`. Else `balanced`.

#### `analyze_sequence`
Args: `prior_outcome` (Win|Loss), `n=3`, `days=180`.
Returns: aggregate stats for the N trades immediately following each Win (or Loss). Reveals revenge trading / overconfidence-after-win patterns.

#### `analyze_sizing_curve`
Args: `days=180`.
Returns: bucketed P&L by position-size %, with implied optimal bucket and current avg.

#### `analyze_correlation`
Args: none.
Returns: `{open_positions_overlap: {sector: count, theme: count}, max_concentration: "..."}`. Sector/theme mapping from theme_taxonomy. Skip if data unavailable; return empty dict.

#### `compare_setups`
Args: `setup_a`, `setup_b`, `days=180`.
Returns: side-by-side win-rate, avg R, expectancy, trade_count, conclusion text generated client-side ("Setup A has 2.3x higher expectancy").

### 6.3 Action tools (require confirmation)

Each action tool has TWO halves: `preview(args)` returns a dict with `{narration, contextual_warnings: [...]}`; `execute(args)` performs the mutation and returns `{ok, summary}`.

#### `tag_trade`
```json
{
  "input_schema": {
    "properties": {
      "trade_id": {"type": "string"},
      "mistake_tags": {"type": "array", "items": {"type": "string"}},
      "emotion_tags": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["trade_id"]
  }
}
```
- `preview`: looks up trade by id (scoped to user); narrates `"Add {mistake_tags} and {emotion_tags} to your {symbol} trade from {exit_date}."`. No warnings.
- `execute`: appends (not replaces) tags to `j2_trades.mistake_tags` / `emotion_tags`. Returns `{ok: true, summary: "Tagged."}`.

#### `set_weekly_focus`
Args: `text` (max 500 chars).
- `preview`: narrates `"Set this week's focus to: '{text}'. The next Weekly Review will read this back."`.
- `execute`: writes `metadata.this_weeks_focus = text` on the most recent weekly_review row for this `(user, account, current week)`. If none exists, creates a stub row with `output_type='weekly_review'`, empty body, this metadata. Returns `{ok: true, summary: "Focus set."}`.

#### `mute_setup`
Args: `setup_name`, `until_date?` (ISO date, defaults 14 days from now).
- `preview`: narrates `"Mute {setup_name} until {until_date}. Pre-trade verdict will reject entries on this setup until then."`. Warning if user has any open positions on the setup.
- `execute`: appends `{setup_name, until_date}` to `j2_accounts.muted_setups` JSON array. Deduplicates by setup_name (last write wins). Returns `{ok: true, summary: "Muted."}`.

#### `unmute_setup`
Args: `setup_name`.
- Removes from `muted_setups`.

#### `set_a_plus_setups`
Args: `add: [str]?`, `remove: [str]?`.
- `preview`: shows resulting A+ list. Warning if removing a setup that's been the user's best performer in the last 90 days.
- `execute`: updates `j2_accounts.aPlusSetups` JSON.

#### `update_discipline_setting`
Args: `field` (one of `maxRiskPerTradePct`, `dailyLossLimitPct`, `coolingOffMinutesAfterLoss`, `aPlusRiskMultiplier`), `value` (number).

Preview is **ELEVATED**:
1. Fetch current value.
2. Determine direction (tightening vs loosening).
3. If loosening: look up historical breaches/exhaustions of this guardrail in the last 30 days. Include them.
4. If tightening: routine warning ("This will reject {N} of your recent trades. Continue?").
5. Confirm button text: **"Yes, raise the cap"** / **"Yes, lower the limit"** (verb-level). Cancel text: "Keep it where it is."

Example preview JSON:
```json
{
  "narration": "Raise maxRiskPerTradePct from 1.5% to 2.5%.",
  "contextual_warnings": [
    "You've breached the existing 1.5% cap 4 times in the last 30 days (set on 2026-04-02 as a tightening).",
    "Your last 3 trades at >2% risk averaged -1.7R vs +0.4R at ≤1.5%."
  ],
  "confirm_label": "Yes, raise the cap",
  "elevated": true
}
```
- `execute`: writes the new value to `j2_accounts` settings.

#### `schedule_paper_only_day`
Args: `date` (ISO).
- `preview`: narrates intent.
- `execute`: appends `{date, reason: 'compass_chat'}` to `j2_accounts.paper_only_days` (NEW small column, JSON array). Pre-Trade Verdict reads this list when shipped.

### 6.4 Tool execution flow (read/analyze)

```
Model emits tool_use → orchestrator invokes executor → result returned
to model in same stream → model continues. Single SSE stream, no
user interaction.
```

### 6.5 Tool execution flow (action — preview/confirm)

```
Model emits tool_use → orchestrator calls preview(args) → DOES NOT
return tool_result to the model → emits SSE "tool_call_pending"
event with preview narration + warnings + button labels → ends turn
→ user clicks Confirm → POST /chat/confirm → executor runs → new
SSE stream starts with Compass acknowledging → assistant message
with acknowledgement persists.
```

The model **does not** receive the tool result in the current turn for an action tool — its turn ends after emitting the tool_use. This matches the voice_write_tools pattern.

## 7. System prompt extension

Append a new **Section 7** to `COMPASS_SYSTEM_PROMPT` in `coach_prompts.py`. Inserted before the closing `You are Compass. Begin when asked.` line.

```
## 7. Chat mode

You are now in chat mode. The trader is talking with you in real time.

### Voice principles, applied to chat

Section 2's five principles still apply. In chat specifically:
1. **Lead with the answer.** No "let me think about this..." preambles. State your conclusion in the first sentence; substantiate it in the next 1-3.
2. **Tools are not narration.** When you call a tool, the user sees a chip
   showing what you queried. You don't have to say "let me check..." —
   just call the tool and use its result.
3. **Short turns over long monologues.** Default to 50-150 words. Longer
   only when the question genuinely requires it (e.g., a 3-month review).
4. **Citations stay tight.** "You're 4-12 on Bull Flags this quarter"
   rather than "Looking at your trades from this quarter, specifically
   the Bull Flag setup, the data shows..."

### When to use tools

You have read tools (instant data fetch), analysis tools (compute
patterns), and action tools (write back to the journal with the
trader's explicit confirmation).

- **Default to a tool over a guess.** Never invent a number. If the
  user asks "how many Bull Flags this month?" — call `get_aggregates`.
- **Batch when the model permits.** If you need recent trades AND
  hold-duration analysis to answer, call both in one turn.
- **Action tools require the user's confirmation.** When you call one,
  end your turn immediately after — don't continue narrating, the user
  needs to see the pending action and click Confirm.

### When you call an action tool

The system will emit a confirmation UI to the user. You do not need to
restate "are you sure?" — the UI handles that. Just call the tool and
end your turn.

If the user asked you to do something destructive or surprising,
inline a sentence BEFORE the tool call explaining your reasoning:
"Given the 4 breaches this month and the -1.7R average on >2% risk
trades, I'd argue you should tighten the cap to 1%, not raise it. But
if you're sure, I'll set it." Then call the tool.

### Refusing requests

If the trader asks you to predict markets, name specific tickers as
buys, or weaken discipline guardrails when the data clearly says
they're already too loose — name the tradeoff and let the user
decide, but don't preach. One sentence of "the data suggests X" is
enough. Then call the tool they asked for, if they insist.

You don't moralize. You don't refuse. You inform, calibrate, and
respect the trader's autonomy.
```

## 8. UI

### 8.1 Compass tab layout (revised)

Vertical order:
1. **🧭 Compass header** (existing — title + disabled state)
2. **Talk to Compass panel** (NEW — this build)
3. **Daily Recaps** section (existing — Phase G v2)
4. **Weekly Reviews** list (existing — Phase G v1)
5. **Trader Profile** editor (existing)

### 8.2 Talk to Compass panel structure

- **Header bar**: "Talk to Compass" title (gold), overflow menu (⋯) with `Clear conversation`, `Forget last message`.
- **Scrollback area**: flex 1, scroll, newest at bottom. Auto-scroll on new message unless user has scrolled up (sticky-bottom pattern).
- **Composer**: textarea + Send button. Cmd/Ctrl+Enter sends. Plain text input (markdown not parsed in user messages).

### 8.3 Message types

**User message (right-aligned):**
```
                                        ┌───────────────────┐
                                        │ Why did I lose    │
                                        │ in March?         │
                                        └───────────────────┘
                                                       11:42 AM
```

**Assistant message (left-aligned, parchment-gold accent):**
```
┌─────────────────────────────────────┐
│ 🧭 Compass                          │
│                                     │
│ March was -$1,840. Two patterns     │
│ stand out: 4 consecutive Pullback   │
│ losses in week 2, and a -2.1R       │
│ revenge trade on NVDA on the 12th.  │
│                                     │
│ [🔍 list_recent_trades  •  4 wins  │
│              16 losses  •  Mar     │
│              2026]                  │
│ [📊 get_aggregates  •  March      │
│              monthly                │
└─────────────────────────────────────┘
 11:42 AM
```

Tool call chips render inline at the bottom of the message. Click to expand → modal/popover shows full args + result JSON.

**Tool turn (collapsed by default, expandable):**

A `role='tool'` row renders as a small dim chip ABOVE the assistant turn that consumed it, OR — more typically — folded into the assistant message's tool-call chip. The user sees it as part of the assistant's flow.

**Pending action message (yellow accent):**
```
┌─────────────────────────────────────┐
│ ⏸ Compass wants to:                │
│                                     │
│ Raise maxRiskPerTradePct from 1.5%  │
│ to 2.5%.                            │
│                                     │
│ ⚠ Heads up:                         │
│   • You've breached the existing    │
│     1.5% cap 4 times in the last    │
│     30 days.                        │
│   • Your last 3 trades at >2% risk  │
│     averaged -1.7R vs +0.4R at      │
│     ≤1.5%.                          │
│                                     │
│ [Yes, raise the cap] [Keep it]      │
└─────────────────────────────────────┘
```

Elevated actions use the red-accent warning sub-block. Standard actions skip the warning sub-block.

**Summary message** (rendered if user scrolls to very top):
```
┌─ Compass's memory of earlier ──────┐
│ Three weeks ago you committed to    │
│ skipping Pullbacks for the          │
│ remainder of Q2. You held that      │
│ commitment for 10 trading days...   │
└─────────────────────────────────────┘
```

### 8.4 Empty state

Centered:
```
🧭

Compass is here.
Ask me anything about your trading.

[How am I doing this week?]
[Why did I lose on my worst day?]
[Compare Bull Flag and Pullback]
[Biggest pattern in my recent losses]
```

The 4 chips are predefined prompts. Clicking one populates the composer with the text and immediately submits.

### 8.5 Streaming

Assistant tokens stream in as they arrive (typewriter). Tool-call chips appear as the model emits them (so the user sees Compass "thinking" — "Searching trades..." before the conclusion arrives). When the SSE `complete` event fires, the typewriter cursor disappears.

### 8.6 Rate-limit handling

If `chat/status` reports `rate_limit_remaining: 0`, composer is disabled with note: "Daily limit reached. Resets at midnight ET."

### 8.7 Kill switch handling

If `chat/status` reports `enabled: false`, the entire Talk to Compass panel is hidden. The other Compass surfaces (Daily Recaps, Weekly Reviews, Profile) continue to render.

### 8.8 Mobile

- Same vertical order.
- Composer pinned to bottom of viewport. Tab bar becomes a fixed footer.
- Tool call chips stack rather than wrap.
- Empty state suggested prompts arrange 2×2 instead of 1×4.

## 9. Safety

### 9.1 Action confirmation

Every action tool follows the preview/confirm pattern (§6.5). The model never directly mutates state; the orchestrator's `/chat/confirm` endpoint is the only path to mutation.

### 9.2 Elevated warnings

`update_discipline_setting` always builds a contextual warning at confirm-time using fresh queries (not the values stored when the tool was first emitted). This prevents "Compass approved this 30 minutes ago but the breach count has since spiked."

### 9.3 Rate limit

- 200 chat turns per user per calendar day ET.
- Tracked via SQL count where `role='user'` AND `created_at` in the day's window.
- 429 response when exceeded, with header `X-RateLimit-Reset: <ISO timestamp>`.

### 9.4 Hallucination audit (async, non-blocking)

After each assistant turn completes:
1. Background task pulls the just-written assistant message.
2. Constructs an `eod-like data dict` from the tools that ran in that turn.
3. Runs `coach_validation.validate_eod_output(body, data)` — relaxed (skip the "exactly one question" check and the "no headers" check; keep numeric + symbol grounding).
4. If `passed=false`: writes `metadata.audit_flags` to the message row. UI renders a small `⚠` icon next to the message — does NOT block the response or rewrite it.

This is a learning signal, not a gate. Gives the team data on where Compass slips so we can tighten prompts later. Also makes hallucinations visible to the trader.

### 9.5 Audit trail

Every executed action writes a `role='tool'` row with full args + result. Lineage: assistant turn (with tool_use JSON) → tool turn (with execution result) → next assistant turn (acknowledging). Full reconstruction of "who decided what when."

### 9.6 Model lock

Hard-coded `claude-sonnet-4-6`. No env override. Persona consistency matters more than minor cost savings.

### 9.7 Conversation forget

Users can soft-delete any message or the entire conversation. Forgotten messages don't surface in next-turn context. Summaries are preserved (so wholesale clearing leaves a faint imprint, not a clean slate — this is a feature, mirrors the Weekly Review's trader-profile continuity).

### 9.8 Kill switch

Environment variable `COMPASS_CHAT_ENABLED` (default `true`). When `false`:
- `/chat/stream`, `/chat/confirm`, `/chat/cancel` return 503.
- `/chat/status` returns `enabled: false`.
- UI hides the panel.

## 10. Cost

| Component | Estimate |
|---|---|
| System prompt (~14k tokens after Section 7) | Cached after turn 1 |
| Tool definitions JSON | Cached after turn 1 |
| Conversation history (avg 5-20k tokens) | Cached delta on each turn |
| New user turn + tool call args | ~200-1k tokens fresh per turn |
| Assistant output | ~200-1k tokens per turn |
| Summarization aux call | ~1k tokens, fires every ~50 user turns |

**Per-turn**: ~$0.02-0.10 with caching.
**Per-active-day**:
- Light user (10 turns): $0.20-0.40
- Heavy user (50 turns): $1-3
- Pathological (200 turns, the cap): ~$10-15

**Per-MAU** (monthly active):
- 50% engagement, 15 turns/day average: ~$3-9/user/month
- Light engagement, 5 turns/day: ~$1-3/user/month

These are within an order of magnitude of the EOD recap costs ($2-4/user/month) so the operational picture stays manageable.

Hard kill switch (§9.8) limits blast radius if costs spike.

## 11. Test plan

### 11.1 Backend unit tests (`test_coach_chat.py`, `test_coach_chat_tools.py`)

For each tool:
- `test_<tool>_returns_expected_shape_for_seeded_data` — fixture inserts trades/positions, calls executor directly, asserts return shape.
- For action tools: `test_<tool>_preview_returns_narration_and_warnings`, `test_<tool>_execute_writes_mutation`.

For the orchestrator:
- `test_chat_appends_user_and_assistant_rows` — calls `handle_user_turn` with a FakeAnthropicClient that scripts an assistant response with no tools.
- `test_chat_executes_read_tool_inline` — FakeClient scripts a tool_use → orchestrator executes → fake's next response continues. Assert tool row + assistant row both written.
- `test_chat_pending_action_tool_does_not_execute` — assert no mutation; assert SSE event `tool_call_pending` emitted; assert assistant turn ends.
- `test_confirm_executes_pending_action` — POST confirm, assert tool row written, assert mutation visible in target table.
- `test_cancel_marks_pending_action_cancelled` — POST cancel, assert no mutation, assert status updated.
- `test_summarization_fires_at_80k_tokens` — seed conversation > threshold, assert summary row written + oldest 30% marked forgotten.
- `test_rate_limit_returns_429_at_200_user_turns` — seed 200 rows, 201st request 429s.
- `test_forget_excludes_message_from_next_context` — forget a turn, next stream assembled history doesn't include it.
- `test_kill_switch_returns_503` — env var off → 503 on stream, 200 with `enabled:false` on status.

### 11.2 Frontend tests (`CompassChat.test.jsx`)

- `renders empty state when no messages`
- `populates composer when suggested-prompt chip clicked`
- `streams assistant tokens to the rendered message`
- `renders tool-call chip when assistant emits one`
- `renders pending-action card with Confirm and Cancel buttons`
- `clicking Confirm calls /chat/confirm and renders acknowledgement turn`
- `clicking Cancel calls /chat/cancel`
- `disables composer when rate-limit hit`
- `hides panel entirely when status.enabled=false`

### 11.3 Smoke (manual, post-deploy)

1. Open Compass tab on a fresh account → empty state with 4 chips.
2. Click "How am I doing this week?" → Compass streams a response. Verify tool chip appears.
3. Ask follow-up: "what's my worst setup right now?" → Compass should remember prior context.
4. Trigger an action: "this week, skip Pullbacks" → pending-action card with Confirm. Click Confirm → setup mutes; next Weekly Review reads back the focus.
5. Try an elevated action: "raise my daily loss limit to 5%" → pending-action with red warning sub-block + verb-level Confirm. Click Cancel → Compass acknowledges.
6. Open in 2 tabs simultaneously → both stay in sync via SWR revalidation on focus.
7. Toggle `COMPASS_CHAT_ENABLED=false` in Railway env → panel disappears within ~30s.

## 12. File map

### New
- `api/services/journal_two/coach_chat.py` — orchestrator
- `api/services/journal_two/coach_chat_tools.py` — tool catalog + executors
- `api/services/journal_two/test_coach_chat.py`
- `api/services/journal_two/test_coach_chat_tools.py`
- `app/src/pages/journal-2-0/components/CompassChat.jsx`
- `app/src/pages/journal-2-0/components/CompassChat.test.jsx`
- `app/src/pages/journal-2-0/components/ChatMessage.jsx`
- `app/src/pages/journal-2-0/components/ChatActionCard.jsx`
- `app/src/pages/journal-2-0/components/ChatToolChip.jsx`
- `app/src/pages/journal-2-0/hooks/useJ2CoachChat.js`

### Modified
- `api/services/journal_two/db.py` — add `j2_chat_messages` table + `j2_accounts.muted_setups` column + `j2_accounts.paper_only_days` column
- `api/services/journal_two/coach_prompts.py` — append Section 7 to `COMPASS_SYSTEM_PROMPT`
- `api/routers/journal_two.py` — 6 new chat endpoints (§5.1-5.6)
- `app/src/pages/journal-2-0/tabs/CompassTab.jsx` — mount `<CompassChat />` at top of the tab

## 13. Scope NOT in v1 (deferred)

- **Pre-Trade Verdict integration**: `muted_setups` and `paper_only_days` columns are written in v1 but not yet consumed. Consumption lands when Pre-Trade Verdict ships.
- **Cross-account chat**: scoped to one account. No "compare account A vs B" tools.
- **Voice/chat unified brain**: voice keeps its own OpenAI Realtime stack. Bridge deferred.
- **Chat-driven trade entry**: `create_position` / `close_position` not exposed via chat. Voice + manual UI continue to own those.
- **Multimedia in chat**: no charts, no screenshots, no chart annotations in v1.
- **Multi-thread / topic threading**: single linear conversation per account.
- **Auto-scheduled coaching nudges**: Compass doesn't initiate chat ("hey, you have a -2R day, want to talk?"). That's a future build (Real-Time Intervention).
- **Tool: undo last action**: not v1; users can manually unmute, retag, etc. via the regular action tools.
- **Export conversation**: deferred. The data is in `j2_chat_messages`; export tooling can come later.

## 14. Open questions / future polish

- **Tool result truncation**: if `list_recent_trades` returns 100 trades, the tool result JSON could be 50k tokens. Investigate compression / summarization at the tool layer before passing back to the model.
- **Hallucination audit cadence**: synchronous-but-fast vs background async. Async-only in v1; revisit if false-negative rate is high.
- **Suggested prompts personalization**: v1 has 4 static chips. Future: rotate based on recent activity ("Compass thinks: ask about your -3R day yesterday").
- **Chat history search**: no search/filter in v1. If conversation grows to 1000+ messages, users may want it.
- **Multi-model fallback**: if Sonnet 4.6 is unavailable, fail gracefully. v1 returns 503 with retry-after. Future: queue + retry.
