# Voice-Driven AI Assistant — Design Spec

**Date:** 2026-05-08
**Project:** uct-dashboard
**Status:** Approved by user (brainstorm), pending implementation plan

---

## 1. Goals & Non-Goals

### Goals

Build a voice-driven AI assistant ("UCT Intelligence") inside the uct-dashboard React + FastAPI app that can:

1. **Read aloud** any long-form content in the app — earnings transcripts, morning wire write-ups, UCT20 picks, setup library entries, daily journal notes — so the user can absorb information while doing other tasks.
2. **Respond to voice queries** — wake-word activation ("Hey UCT Intelligence") plus push-to-talk fallback. Single-turn data lookups ("what's NVDA at?", "top movers", "sector strength") and multi-turn conversations.
3. **Execute actions across the app** by voice — navigate to any page, manage watchlists, create/close journal positions, set alerts, run scanners, control chart settings, look up news, and produce briefings.
4. **Confirm every write action verbally** before mutating user data, with mishear protection on numeric parameters.
5. **Persist conversation history** for audit + replay + debugging mishears.
6. **Stay cost-efficient** — route ~70% of queries through cheap one-shot mode, prompt-cache tool schemas, cache TTS audio, enforce monthly minute caps.

### Non-Goals (v1)

- **No live brokerage order routing.** The journal records trades; this assistant logs to the journal only. Voice trading against real brokerage accounts is explicitly out of scope.
- **No bulk destructive operations** by voice (delete account, clear all alerts, bulk-delete journal entries) — UI only.
- **No precise drawing-tool control** (trendlines, Fibonacci, pitchforks). Lines and screenshots only.
- **No long-form dictation** for journal paragraphs >500 words (use keyboard for novels).
- **No third-party voice cloning** or arbitrary TTS voice training.

---

## 2. High-Level Architecture

Three independent runtime modes share one backend tool registry. The browser orchestrator picks the mode automatically based on intent — the user never thinks about which mode they are in.

```
┌──────────────────────── BROWSER ────────────────────────┐
│                                                         │
│  [Wake Detector]──Porcupine WASM (on-device, always on  │
│                   when voice enabled in Settings)       │
│         │                                               │
│         ▼ "Hey UCT Intelligence" detected               │
│  [VoiceOrchestrator]                                    │
│   ├─ MODE A: Read-Aloud  ───► /api/voice/tts (OpenAI    │
│   │   (button on transcript)   tts-1, audio stream)     │
│   ├─ MODE B: One-Shot   ───► /api/voice/oneshot         │
│   │   (short query)         (Whisper + GPT-4o-mini      │
│   │                          + tts-1)                   │
│   └─ MODE C: Realtime   ───► WebRTC ↔ OpenAI Realtime   │
│       (multi-turn / writes)  (gpt-realtime, tools)      │
│                                                         │
│  [FloatingOrb] + [TranscriptBubble] + [VoiceHistoryPage]│
│                                                         │
└──────────┬─────────────────────────────────────┬────────┘
           │                                     │ (Mode C)
           ▼  (Mode A & B)                       ▼  WebRTC
┌──── FastAPI backend ────┐         ┌─── OpenAI Realtime ───┐
│ /api/voice/* router     │         │  gpt-realtime model   │
│  ├ session_token        │         │  function calling     │
│  ├ tts                  │         │  ↕                    │
│  ├ oneshot              │◄────────┤  tool calls return to │
│  ├ tool dispatcher ─────┼─────────┤  browser, browser     │
│  └ transcript storage   │         │  hits /api/voice/exec │
│                         │         │  passes result back   │
│ ToolRegistry maps voice │         └───────────────────────┘
│ intents → existing API  │
│ (journal, watchlists,   │
│  charts, screener, ...) │
└─────────────────────────┘
```

### Why three modes

| Mode | Purpose | Stack | Cost | Latency |
|------|---------|-------|------|---------|
| **A — Read-Aloud** | TTS-only ("read me the morning wire") | OpenAI tts-1, MediaSource streaming | ~$0.015/min | <500ms first chunk |
| **B — One-Shot** | Short single-turn queries ("what's NVDA at?") | Whisper STT → gpt-4o-mini → tts-1 | ~$0.003/query | 1.5–2.5s |
| **C — Realtime** | Multi-turn conversations, write actions, agentic flows | OpenAI Realtime API (`gpt-realtime`) over WebRTC | ~$0.30/min active | sub-second |

The browser **VoiceOrchestrator** classifies intent at wake/trigger time and picks the cheapest viable mode. If a Mode B classifier sees ambiguity, multi-turn need, or a write action, it auto-escalates to Mode C.

### Locked technology choices

- **Wake word:** [Picovoice Porcupine](https://picovoice.ai/platform/porcupine/) WASM, on-device. ~50KB, no audio leaves the browser until wake fires.
- **Realtime conversation:** OpenAI Realtime API, `gpt-realtime` model, WebRTC transport.
- **STT (Mode B):** OpenAI Whisper (`whisper-1`).
- **TTS (Modes A + B):** OpenAI `tts-1`, voice = `verse` by default.
- **Intent classifier (Mode B):** OpenAI `gpt-4o-mini`, prompt-cached.
- **Action execution:** Existing FastAPI routers, exposed as voice tools.

### Locked UX choices

- **Activation:** Wake word ("Hey UCT Intelligence") + floating mic orb (push-to-talk fallback). Both always available.
- **Confirmation policy:** Read-back + verbal "yes" required for **every** write action.
- **Access:** Paid plans only. Default monthly cap: 300 conversation minutes, configurable per plan tier in admin. Read-aloud is unlimited within paid tier.
- **UI footprint:** Floating orb (bottom-right) + ephemeral transcript bubble. No sidebar, no full-screen takeover.
- **History:** Full transcripts + tool calls + outcomes saved to a Voice History page in Settings. Default retention 30 days, user-configurable.
- **Voice:** OpenAI `verse` default; user can switch in Settings.
- **Wake phrase:** "Hey UCT Intelligence" (Porcupine custom keyword).
- **Auto-disconnect:** 8 seconds of silence ends a Mode C session.
- **Mobile:** Same UX (PWA already supports it). Wake word fires only while app is open and visible (iOS/Android background restrictions).
- **Hotkey:** `Cmd/Ctrl+Shift+V` toggles push-to-talk; `Cmd/Ctrl+Shift+M` mutes the assistant.

---

## 3. Tool Catalog (~91 tools)

Every voice intent maps to a "tool" the model can call. Each tool is a Python async function decorated with `@voice_tool(...)`, registered once, automatically published as JSON schema to the model. Tools call into existing routers — they do not duplicate business logic.

### 3.1 Navigation (3)

| Tool | Description |
|------|-------------|
| `navigate_to(page)` | dashboard / calendar / morning_wire / journal / watchlists / theme_tracker / screener / options_flow / setup_library / modelbook / post_market / breadth / uct20 / traders / community / support / settings / voice_history (admin gates: `admin` for admins only) |
| `open_ticker(symbol)` | Opens TickerPopup for a symbol from anywhere |
| `open_journal_tab(tab)` | overview / trade_log / daily_notes / calendar / analytics / playbooks / review_queue / journal_2_0. When `journal_2_0` is selected, optional `subtab` param routes to that sub-tab (calendar / accounts / analytics / log / etc.) |

### 3.2 Read-Aloud / Long-form (5)

| Tool | Description |
|------|-------------|
| `read_morning_wire()` | Today's wire, streamed TTS |
| `read_earnings_transcript(symbol, quarter?)` | Finnhub transcript or AI summary |
| `read_uct20_picks()` | Today's picks with rationale |
| `read_setup_template(setup_name)` | From Setup Library |
| `read_journal_entry(date)` | Daily note for a given date |

### 3.3 Live Data Q&A (8)

| Tool | Description |
|------|-------------|
| `get_quote(symbol)` | last, change, volume |
| `get_movers(direction, count?)` | gainers / losers / most active |
| `get_sector_strength()` | RS rankings by sector |
| `get_breadth()` | A/D, NHNL, market breadth snapshot |
| `get_theme_status(theme?)` | Strongest themes, or specific theme leaders |
| `get_options_flow(symbol?, type?)` | Recent unusual options |
| `get_dark_pool(symbol?)` | Recent dark pool prints |
| `get_earnings_today(market_cap_min?)` | Today's earnings $300M+ |

### 3.4 Journal Actions — write (6, all require verbal confirm)

| Tool | Description |
|------|-------------|
| `create_position(account, symbol, shares, entry, stop, target?, setup?, notes?)` | Read-back required |
| `close_position(symbol, exit, partial?, account?)` | Read-back required |
| `add_daily_note(date, text, emotion?, tags?)` | Read-back required |
| `update_position(symbol, field, value)` | Adjust stop, target, notes |
| `delete_position(symbol, account?)` | Destructive — double confirm |
| `log_mistake(symbol?, mistake_type, text)` | Read-back required |

### 3.5 Self-Q&A about your trading (5)

| Tool | Description |
|------|-------------|
| `get_my_pnl(period)` | week / month / ytd / today |
| `get_my_setup_performance(setup?)` | Best/worst setups |
| `get_my_recent_mistakes(days?)` | From journal_insights |
| `get_my_psychology(period?)` | Emotion/process trend |
| `find_my_trades(filters)` | By symbol, date range, setup, outcome |

### 3.6 Watchlist Actions — write (5)

| Tool | Description |
|------|-------------|
| `add_to_watchlist(symbol, list_name)` | |
| `remove_from_watchlist(symbol, list_name?)` | |
| `tag_ticker(symbol, color)` | green/blue/orange/red/purple/gold/teal |
| `flag_ticker(symbol, flagged?)` | Toggle Flagged list |
| `set_alert(symbol, condition, price, channels?)` | Confirms before save |

### 3.7 Discovery / Scanning (4)

| Tool | Description |
|------|-------------|
| `run_screener(criteria)` | Natural language → screener filters |
| `run_custom_scan(scan_name)` | User's saved scans |
| `find_stocks_by_theme(theme_name)` | Pulls theme tracker holdings |
| `find_stocks_by_setup(setup_name)` | UCT20 historic + brain matches |

### 3.8 Chart Control (5 + 4 drawing)

| Tool | Description |
|------|-------------|
| `set_timeframe(tf)` | 1m / 5m / 15m / 30m / 1h / D / W / M |
| `toggle_extended_hours()` | |
| `add_indicator(name)` | VWAP, MA, BB, RSI, MACD |
| `remove_indicator(name)` | |
| `change_chart_type(type)` | candle / line / area / bar / heikin |
| `draw_horizontal_line(price)` | Drops a line at named price |
| `save_chart_screenshot()` | To clipboard or download |
| `clear_drawings()` | |
| `add_chart_annotation(text)` | |

### 3.9 Portfolio & Risk (8)

| Tool | Description |
|------|-------------|
| `read_my_positions(account?)` | Speaks open positions with current P&L |
| `read_my_open_risk(account?)` | Total $ at risk across positions |
| `get_account_balance(account?)` | From journal-2-0 Accounts tab |
| `get_account_goal_progress(account?)` | Milestones |
| `switch_account(account)` | Change active journal account |
| `calculate_position_size(symbol, risk_amount, stop_distance)` | Voice position sizing |
| `calculate_risk_reward(entry, stop, target)` | |
| `check_my_risk_remaining_today()` | Daily risk budget remaining |

### 3.10 News & Research (5)

| Tool | Description |
|------|-------------|
| `get_news(symbol?, count?)` | Recent news via news router |
| `read_news_summary(symbol)` | TTS top headlines |
| `get_insider_trades(symbol?)` | Recent insider activity |
| `get_company_info(symbol)` | Sector, industry, market cap, description |
| `get_analyst_consensus(symbol)` | Price target + ratings |

### 3.11 Comparisons & Cross-symbol (3)

| Tool | Description |
|------|-------------|
| `compare_tickers([symbols])` | Multi-symbol quote table, narrated |
| `correlation(symbol_a, symbol_b)` | From correlation matrix data |
| `compare_to_benchmark(symbol, benchmark?)` | vs SPY/QQQ/sector ETF |

### 3.12 Brain / AI Intelligence (4)

| Tool | Description |
|------|-------------|
| `read_brain_output(mode?)` | premarket / open / midday / preclose / postmarket / weekly / monthly |
| `get_brain_recommendation(symbol)` | Confidence score + setup match |
| `explain_setup(setup_name)` | Pulls from Setup Library |
| `explain_indicator(indicator)` | RSI/MACD/BB/etc. educational |

### 3.13 Alert management (4)

| Tool | Description |
|------|-------------|
| `read_my_alerts()` | Pending bell alerts aloud |
| `dismiss_alert(alert_id_or_recent)` | |
| `snooze_alert(symbol, duration)` | |
| `toggle_alert_channel(channel, on?)` | bell/email/Discord/browser |

### 3.14 Multi-step agentic flows (5 — highest daily value)

| Tool | Description |
|------|-------------|
| `morning_briefing()` | Sequence: morning wire → today's earnings → my open positions → watchlist alerts → leading themes |
| `closing_briefing()` / `eod_summary()` | What I traded today, P&L, mistakes, tomorrow's setups |
| `pre_trade_check(symbol)` | Quote + chart context + brain rec + similar setups + risk calc, narrated as one briefing |
| `post_trade_review(symbol_or_recent)` | Pull execution + screenshot + journal + grade |
| `plan_my_day()` | Pulls calendar + earnings + brain + my positions, builds a verbal plan |

These are implemented backend-side (in `voice_briefings.py`) — each chains existing services and returns a single narration string. The model issues one tool call; the backend does the chaining. Saves ~5x round trips.

### 3.15 Calendar & Events (3)

| Tool | Description |
|------|-------------|
| `get_calendar_events(date_range, types?)` | earnings/FOMC/CPI/Fed speakers |
| `upcoming_earnings(symbol)` | |
| `get_economic_calendar(week?)` | |

### 3.16 Reporting (3)

| Tool | Description |
|------|-------------|
| `generate_weekly_report()` | Backed by GenerateReportModal logic |
| `generate_monthly_report()` | |
| `read_my_review_progress()` | Review queue status |

### 3.17 App control & meta (7)

| Tool | Description |
|------|-------------|
| `toggle_dark_mode()` | |
| `toggle_real_time_streaming()` | |
| `set_voice(voice_name)` | Switch assistant voice mid-conversation |
| `mute_assistant()` / `unmute_assistant()` | |
| `change_speaking_speed(rate)` | |
| `update_setting(key, value)` | Generic settings updater (allowlisted keys only) |
| `global_search(query)` | Searches watchlists, journal entries, notes, setup library |

### 3.18 Conversation control (4)

| Tool | Description |
|------|-------------|
| `repeat_that()` | Replay last response |
| `cancel_pending_action()` | Kills a confirmation in flight |
| `summarize_session()` | Recap what was done |
| `set_reminder(text, when)` | Uses existing alert/notification infra |

### Tool registry pattern

```python
# api/services/voice_tools.py

@voice_tool(
    name="create_position",
    description="Create a new position in the journal",
    write=True,
    require_confirm=True,
    auth=requires_paid_voice,
    contexts=["journal", "global"],
)
async def create_position(user, account, symbol, shares, entry, stop,
                          target=None, setup=None, notes=None):
    # PREVIEW phase — no DB mutation
    risk = (entry - stop) * shares  # for longs
    sanity_check_shares(shares)
    sanity_check_price_near_quote(symbol, entry)

    return PreviewResult(
        narration=(
            f"{symbol} {shares} shares at {entry}, stop {stop}, "
            f"risk ${risk:.0f}, {account}. Confirm?"
        ),
        action_id=mint_action_id(...),
        execute=lambda: journal_two_router.create_position(
            user_id=user.id, account=account, symbol=symbol,
            shares=shares, entry=entry, stop=stop,
            target=target, setup=setup, notes=notes,
        ),
    )
```

Adding a new tool = one decorator + one function. The decorator handles JSON schema generation, auth/plan checks, write enforcement, audit logging, and dry-run mode for tests.

### Explicitly out of v1

- Live brokerage order routing
- Bulk destructive ops (delete account, clear all alerts)
- Precise drawing tools (trendlines, Fib, pitchforks)
- Long-form dictation (>500 words)
- Voice cloning / arbitrary voice training

---

## 4. Data Flow

### 4.1 Mode A — Read-Aloud

```
User clicks "Read aloud" on EarningsModal transcript
  → fetch /api/voice/tts {text, voice, speed}
  → backend SHAs (text+voice+speed); checks disk cache
      ├─ cache hit  → stream cached MP3 directly
      └─ cache miss → call OpenAI tts-1, stream chunks,
                      tee to disk cache (7-day TTL)
  → browser pipes chunks into <audio> via MediaSource Extensions
  → playback starts in <500ms (first chunk), continues streaming
  → user can pause/scrub/stop in floating bar at bottom
  → AudioPlayerBar persists across navigation
```

**Cost:** ~$0.015/minute of audio. Cached re-listens are free.

### 4.2 Mode B — One-Shot

```
Wake word fires → orb listens up to 4 sec (with VAD endpointing)
  → audio blob (webm/opus) sent to /api/voice/oneshot
  → backend: Whisper transcribes ("what's NVDA at")
  → backend: gpt-4o-mini classifies intent + extracts params
              (single-tool? → execute; multi-turn? → return
               escalate=true so browser opens Mode C)
  → backend: calls get_quote(NVDA), gets {last: 487.20, chg: +2.1%}
  → backend: gpt-4o-mini formats response
              ("NVDA is at 487.20, up 2.1%")
  → backend: tts-1 audio stream
  → browser plays audio + shows transcript bubble
  → orb dismisses after playback (or stays if user said
    "and what about TSLA")
```

**Latency:** ~1.5–2.5s end-to-end. **Cost:** ~$0.003 per query. **Used for ~70% of queries.**

### 4.3 Mode C — Realtime (multi-turn / writes)

```
User: "Hey UCT Intelligence, log a position"
  Mode B classifier flags multi-turn → escalates
  → browser POST /api/voice/session_token
       {context: "journal", page: "/journal-2-0/log"}
  → backend mints ephemeral OpenAI Realtime token (60s TTL,
    scoped to user_id + tool subset for current page context)
  → browser opens WebRTC peer connection direct to OpenAI Realtime
  → audio streams bidirectionally, model speaks back
  → model: "Sure, what symbol?"
  → user: "NVDA, 100 shares, entry 200.20, stop 199.10, swing"
  → model issues tool_call: create_position(...) phase=preview
  → tool_call event captured by browser data channel
       → POST /api/voice/exec
         {tool: create_position, args: {...},
          phase: "preview", session_id, user_id}
  → backend validates auth, tool's preview() runs (no DB write)
  → returns: {action_id, narration: "NVDA 100 @ 200.20,
              stop 199.10, risk $110, Swing. Confirm?"}
  → browser feeds preview back to Realtime as tool result
  → model speaks the narration
  → user: "yes"
  → model issues tool_call: confirm_action(action_id)
       → /api/voice/exec phase="confirm"
  → backend validates action_id (HMAC, single-use, 60s TTL),
    runs the bound execute() against journal_two router
  → returns: {ok, summary: "Position logged"}
  → model speaks success + result
  → if 8s silence → session closes, transcript persisted
```

**Key design choices:**

- **Browser ↔ OpenAI is direct WebRTC** (not proxied through your backend) — keeps latency low and your servers out of the audio path. Backend only handles auth, tool execution, and transcripts.
- **Two-phase tool execution** (`preview()` then `confirm()`) — every write tool implements both. Preview is read-only, confirm mutates. The model never directly mutates without an explicit user "yes."
- **Ephemeral session tokens** — minted per session, scoped to current user + only the tools relevant to the current page context. Token can't be replayed, can't escalate scope.
- **Tool subset by page context** — chart tools only loaded when on a page with a chart visible; journal-write tools only when in journal context or explicitly invoked. Reduces hallucinated tool calls and trims model context cost.
- **Agentic flows** (`morning_briefing`, `pre_trade_check`) — implemented backend-side as orchestration tools that internally call multiple sub-tools and return a single narration string.

### 4.4 Mode escalation logic

A Mode B classifier triggers escalation to Mode C if any of:

- Tool registry says `write=True` for the matched tool
- Tool is an agentic flow (`morning_briefing` etc.)
- Required params are missing or ambiguous
- User uses follow-up cues ("actually", "wait", "no", "and also")
- Classifier confidence below threshold (0.7)

User never has to think about which mode they are in.

---

## 5. Frontend Components

### 5.1 New components (under `app/src/components/voice/`)

```
VoiceOrchestrator.jsx       Top-level provider — owns state machine
                            (idle / listening / thinking / speaking /
                            error / cooldown), mode selection, session
                            lifecycle, audio session manager (only one
                            mode plays at a time — barge-in arbitration)

FloatingOrb.jsx             Bottom-right always-present pulsing orb;
                            click = manual trigger; visual state reflects
                            orchestrator state; respects mute toggle;
                            keyboard-focusable

TranscriptBubble.jsx        Ephemeral popover above orb during a session;
                            shows live transcript + response text;
                            auto-fades 2s after session ends

AudioPlayerBar.jsx          Bottom-of-screen bar when read-aloud is active;
                            play / pause / stop / scrub / speed; persists
                            across navigation; collapses when audio ends

ReadAloudButton.jsx         Reusable speaker icon button; takes text or
                            text-loader callback; integrates with
                            AudioPlayerBar; tracks "playing now" state

VoiceConfirmModal.jsx       Visual confirmation fallback shown alongside
                            verbal confirm (preview text + Confirm/Cancel
                            buttons); for noisy environments + accessibility

TranscriptDrawer.jsx        Optional slide-down drawer to expand the bubble
                            into a longer scrollable view if user wants
                            to see the full session
```

### 5.2 New hooks (under `app/src/hooks/`)

```
useWakeWord.js              Porcupine WASM wrapper; init/start/stop;
                            graceful degradation if mic permission denied;
                            visibilitychange listener (pauses when tab hidden)
useVoiceSession.js          WebRTC peer-connection lifecycle for Mode C;
                            session token fetch, ICE setup, data channel
                            for tool_call events, audio track piping
useOneShot.js               Mode B audio capture + POST + playback
useReadAloud.js             Mode A streaming TTS, MediaSource integration,
                            play queue (multiple read-alouds queue up)
useVoiceTools.js            Resolves the tool subset for the current page
                            context; loads at session start
```

### 5.3 New page

```
app/src/pages/VoiceHistory.jsx
  Lists sessions chronologically; click expands to full transcript +
  tool calls + outcomes; filter by date / action type;
  "replay this session" replays audio if retention allows;
  per-session delete; bulk export
```

### 5.4 Existing files modified

- `app/src/App.jsx` — wrap in `<VoiceOrchestrator>`, mount `<FloatingOrb>` + `<AudioPlayerBar>` globally.
- `app/src/pages/Settings.jsx` — add **Voice** panel: enable toggle, voice picker (verse/ash/sage/etc. with preview), wake-phrase toggle, push-to-talk hotkey config, minutes-used progress bar, mute hotkey, default speaking speed, transcript retention setting (7 / 30 / 90 / never).
- `app/src/components/AuthGuard.jsx` — add voice access check (paid plans only).
- `app/src/components/NavBar.jsx` + `MobileNav.jsx` — add Voice History link under Settings menu.
- `app/src/pages/MorningWire.jsx` — add `<ReadAloudButton>` next to title.
- `app/src/pages/Calendar.jsx` (earnings modal) — add `<ReadAloudButton>` for transcript + AI summary.
- `app/src/pages/UCT20.jsx` — add `<ReadAloudButton>` per pick + "Read all picks" button at top.
- `app/src/pages/SetupLibrary.jsx` — add `<ReadAloudButton>` per setup.
- `app/src/pages/journal/tabs/DailyNotes.jsx` — add read-aloud + voice-dictation entry button.
- `app/src/pages/journal-2-0/components/AddPositionModal.jsx` — add **"Use voice"** button that opens the assistant pre-scoped to `create_position`.

### 5.5 State management

A single Zustand store (`useVoiceStore`) for orchestrator state, session metadata, audio queue, and minutes-used counter. No prop drilling. The store reads from existing auth store for user/plan.

### 5.6 Mobile considerations

PWA already exists. Wake word works on mobile (Porcupine supports iOS Safari + Android Chrome WASM, but iOS background is restricted — wake word only fires while app is open and visible). On mobile, push-to-talk button is more prominent; wake word is secondary.

### 5.7 Accessibility

All voice features have a visual + keyboard equivalent. Floating orb is keyboard-focusable, hotkey to trigger (default `Cmd/Ctrl+Shift+V`). Confirmations work via voice OR visual button OR keyboard. Transcript text is screen-reader-friendly.

---

## 6. Backend Additions

### 6.1 New router: `api/routers/voice.py`

```
POST /api/voice/session_token   Mint ephemeral OpenAI Realtime token
                                (60s TTL, scoped to user_id + tool subset)
POST /api/voice/oneshot         Mode B: audio blob in, audio stream out
POST /api/voice/tts             Mode A: text in, audio stream out
POST /api/voice/exec            Tool execution: {tool, args, phase}
POST /api/voice/transcript      Persist a session chunk
GET  /api/voice/transcripts     List user's session history
GET  /api/voice/transcripts/{id}
DELETE /api/voice/transcripts/{id}
GET  /api/voice/tools?context=  Return tool subset for current page context
GET  /api/voice/usage           Minutes used + remaining this month
GET  /api/voice/settings        Voice prefs
PUT  /api/voice/settings
```

All endpoints require auth; voice-feature endpoints additionally require `requires_voice_access(user)` — gates on plan tier + monthly minute cap.

### 6.2 New services (`api/services/`)

```
voice_tools.py       Single registry of all ~91 tools as decorated async
                     functions. @voice_tool() decorator handles:
                     - JSON schema generation for OpenAI tools format
                     - auth/plan checks
                     - write flag (forces two-phase preview/confirm)
                     - context tags (which pages load this tool)
                     - audit log emission for writes
                     - dry_run mode for tests

voice_dispatch.py    Two-phase executor: preview() returns
                     {action_id, narration, side_effects: false},
                     confirm(action_id) executes the bound mutation.
                     action_id is a signed token (HMAC), 60s TTL,
                     single-use, prevents replay.

voice_intent.py      Mode B vs C router. Cheap classifier
                     (gpt-4o-mini, prompt-cached) decides:
                     - single-tool read? → Mode B
                     - write / multi-turn / agentic flow? → Mode C
                     - ambiguous? → escalate to C with clarifying turn

voice_openai.py      Wraps OpenAI SDK: session_token minting,
                     tts-1 streaming, Whisper, gpt-4o-mini calls.
                     Centralizes API keys + retry/backoff.

voice_usage.py       Tracks minutes/calls per user per month.
                     Enforces cap server-side. Resets monthly.

voice_transcript.py  Append-only transcript writer; respects user's
                     retention setting; bulk delete on retention expiry
                     (APScheduler nightly task).

voice_briefings.py   The agentic flows (morning_briefing,
                     pre_trade_check, eod_summary, plan_my_day,
                     post_trade_review) — each chains existing
                     services and returns a single narration string.
```

### 6.3 Database schema (5 new tables)

```sql
CREATE TABLE voice_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  mode            TEXT NOT NULL,            -- 'A' | 'B' | 'C'
  source          TEXT NOT NULL,            -- 'wake' | 'button' | 'hotkey'
  started_at      TIMESTAMP NOT NULL,
  ended_at        TIMESTAMP,
  duration_seconds INTEGER,
  status          TEXT NOT NULL,            -- 'active' | 'closed' | 'errored'
  page_context    TEXT,                     -- e.g., '/journal-2-0/log'
  estimated_cost_usd REAL
);

CREATE TABLE voice_transcripts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,            -- 'user' | 'assistant' | 'tool'
  text            TEXT NOT NULL,
  audio_path      TEXT,                     -- nullable
  timestamp       TIMESTAMP NOT NULL
);
CREATE INDEX idx_voice_transcripts_session ON voice_transcripts(session_id);

CREATE TABLE voice_tool_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,
  args_json       TEXT NOT NULL,
  preview_text    TEXT,
  action_id       TEXT,                     -- signed HMAC token
  confirmed       BOOLEAN NOT NULL DEFAULT 0,
  executed_at     TIMESTAMP,
  result_json     TEXT,
  error_text      TEXT
);
CREATE INDEX idx_voice_tool_calls_session ON voice_tool_calls(session_id);
CREATE INDEX idx_voice_tool_calls_tool ON voice_tool_calls(tool_name);

CREATE TABLE voice_settings (
  user_id                       INTEGER PRIMARY KEY REFERENCES users(id),
  enabled                       BOOLEAN NOT NULL DEFAULT 0,
  voice                         TEXT NOT NULL DEFAULT 'verse',
  speed                         REAL NOT NULL DEFAULT 1.0,
  wake_phrase_enabled           BOOLEAN NOT NULL DEFAULT 1,
  push_to_talk_hotkey           TEXT NOT NULL DEFAULT 'CmdOrCtrl+Shift+V',
  retention_days                INTEGER NOT NULL DEFAULT 30,
  confirmation_visual_fallback  BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE voice_usage_monthly (
  user_id              INTEGER NOT NULL REFERENCES users(id),
  year_month           TEXT NOT NULL,       -- 'YYYY-MM'
  mode_a_seconds       INTEGER NOT NULL DEFAULT 0,
  mode_b_calls         INTEGER NOT NULL DEFAULT 0,
  mode_c_seconds       INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);
```

---

## 7. Cost & Cost Optimization

### Estimated unit costs (OpenAI list pricing)

| Operation | Model | Cost |
|-----------|-------|------|
| Read-aloud TTS (Mode A) | `tts-1` | ~$0.015 / minute audio |
| One-shot STT (Mode B) | `whisper-1` | ~$0.006 / minute audio in |
| One-shot reasoning (Mode B) | `gpt-4o-mini` | ~$0.0002 / typical query |
| Realtime conversation (Mode C) | `gpt-realtime` | ~$0.06/min in + $0.24/min out (~$0.30/min active) |

### Built-in cost-efficiency mechanisms

- **Prompt caching** — system prompt + tool schemas are stable per page context → cached → ~75% off input tokens after first call in a session.
- **Tool subset by context** — chart tools only loaded on chart pages, journal tools only in journal context — reduces token count + reduces hallucinated calls.
- **Mode B for short queries** — gpt-4o-mini intent classifier ($0.15/1M tokens) routes ~70% of queries away from Realtime.
- **TTS audio cache** — SHA(text+voice+speed) cached on disk 7 days. Re-listening to morning wire is free.
- **Auto-disconnect** — 8s silence ends Mode C session.
- **Per-user monthly cap** — hard cap enforced server-side (rejects new sessions when exceeded).
- **Pre-built agentic flows** — backend chains tools instead of model — saves ~5x round trips for `morning_briefing` etc.
- **Optional `gpt-realtime-mini`** — when/if released, route simple multi-turn flows to mini for ~5x cost reduction.

### Default monthly caps (configurable per plan in admin)

The plan-tier names below are placeholders — the implementation plan maps them to your existing Stripe plan IDs.

| Plan tier | Mode A (read-aloud) | Mode B (one-shot) | Mode C (Realtime) | Estimated max cost |
|-----------|---------------------|-------------------|-------------------|--------------------|
| Free | not available | not available | not available | $0 |
| Lower paid tier | unlimited | 200 calls/mo | 100 min/mo | ~$30/mo |
| Higher paid tier | unlimited | unlimited | 300 min/mo | ~$90/mo |
| Owner / admin | unlimited | unlimited | unlimited | uncapped |

These are starting points; admin panel exposes a slider per plan tier.

---

## 8. Security & Error Handling

### Security

- **Ephemeral tokens** — Realtime session tokens minted backend-side, 60s TTL, can't escalate scope, never exposed permanently to browser.
- **Tool auth** — every tool checks `user.plan in PAID_PLANS` and `voice_enabled=true`; writes additionally check ownership (you can't mutate another user's journal).
- **Two-phase execution** — preview never mutates; confirm requires signed `action_id` (HMAC, single-use, 60s TTL); model literally cannot mutate without explicit user "yes."
- **Mishear protection** — number params get a sanity check (e.g., `shares` must be 1–100,000; `entry` within ±50% of current quote; `risk_amount` must be ≤ `account.balance * 0.1`); failures trigger a re-prompt instead of silently mutating.
- **Rate limits** — 60 Mode B calls/min/user, 1 active Mode C session/user, 100 confirmation actions/day/user.
- **Audit log** — every write tool emits an entry with user/timestamp/tool/args/result; visible in Voice History + admin panel.
- **PII in transcripts** — daily notes content + position data are stored as plaintext (consistent with existing journal storage); transcripts encrypted at rest via Railway managed volume; user can wipe history any time.

### Error handling & failure modes

| Failure | Fallback |
|---------|----------|
| Wake word fails to detect | Push-to-talk button always works |
| Microphone permission denied | All voice features disabled with clear UI message |
| Whisper STT fails | Visual confirmation modal still works for typed input |
| OpenAI Realtime API down | Fall back to Mode B (Whisper + gpt-4o-mini) automatically with degraded multi-turn |
| WebRTC connection drops | Auto-reconnect once; if fails, show notification, fall back to Mode B |
| Tool execution errors | Model speaks the error; user can retry or cancel |
| Action_id replay attempt | Reject with audit log entry |
| Sanity check failure on numeric param | Model asks user to re-state the value |
| Cap exceeded mid-session | Session ends gracefully, user notified, paywall prompt |

---

## 9. Testing Strategy

### Unit tests (deterministic, no audio)

- Each tool in `voice_tools.py` tested in isolation: param validation, auth checks, preview output, confirm execution against existing routers (mocked DB), error paths. **Goal: 100% tool coverage.**
- `voice_intent.py` classifier: fixture set of ~200 transcribed utterances → expected (mode, tool, args). Catches routing regressions.
- `voice_dispatch.py`: action_id generation/validation/replay-prevention, expiry, single-use enforcement.
- Agentic flows in `voice_briefings.py`: mock sub-services, assert narration structure and order.

### Integration tests (server-side, mocked OpenAI)

- `/api/voice/exec` end-to-end: token → preview → confirm → DB mutation → audit log entry.
- Rate limit + cap enforcement: 61st Mode B call/min returns 429; minutes-cap exceeded returns 402.
- Tool subset by context: GET `/api/voice/tools?context=chart` returns chart tools, omits journal write tools.
- Transcript persistence + retention expiry job.

### Browser tests (Vitest + jsdom for hooks, Playwright for UI)

- `useVoiceSession`, `useOneShot`, `useReadAloud`, `useWakeWord` hook tests with mocked WebRTC + MediaSource.
- `FloatingOrb` state-machine tests: idle → listening → thinking → speaking → idle transitions on events.
- `VoiceConfirmModal` keyboard flow (Tab + Enter to confirm, Esc to cancel).
- `AudioPlayerBar` persistence across navigation.

### Synthetic conversation tests (the key innovation)

A fixtures directory `tests/voice/conversations/*.yaml` describing full conversations as text. A test runner replays each conversation against a real Realtime session in a CI job, asserting tool calls + DB state.

```yaml
name: log_swing_position
context: page=journal-2-0, account=swing
turns:
  - user: "Hey UCT Intelligence, log a position"
  - assistant: expects_tool_call create_position with require_clarify
  - user: "NVDA 100 shares at 200.20 stop 199.10"
  - assistant: expects_preview "NVDA 100 @ 200.20, stop 199.10, risk $110, Swing"
  - user: "yes"
  - assistant: expects_confirm
  - assert: db.positions.last == {symbol: NVDA, shares: 100, ...}
  - assert: voice_tool_calls.last.confirmed == true
```

~30 conversations cover the high-value flows. Costs ~$5 per full CI run; runs nightly + on PRs touching voice code.

### Manual QA checklist

Wake word in noisy/quiet environments, mobile Safari/Chrome, reconnection on network blip, mid-conversation tab switch, simultaneous read-aloud + Mode C (audio session manager arbitrates), barge-in (interrupting the assistant mid-sentence).

### Observability

Every tool call + cost emitted to existing logging (Railway logs); admin dashboard surfaces: monthly cost, top users, top tools, error rate per tool, session duration distribution.

---

## 10. Phasing — 7 Vertical Slices

Each slice is independently usable. We ship, dogfood, iterate, then start the next.

```
SLICE 1 — Read-Aloud only (Mode A) ......................... ~4 days
  Backend:  /api/voice/tts, OpenAI tts-1 client, audio cache
  Frontend: ReadAloudButton, AudioPlayerBar, basic Settings panel
  Surfaces: morning wire, earnings transcript, UCT20 picks
  Plan gate: paid only
  Acceptance: clicking "Read aloud" plays audio with <500ms latency,
              cached re-listens are instant, plays through navigation

SLICE 2 — One-Shot data lookup (Mode B) ..................... ~5 days
  Backend:  /api/voice/oneshot, Whisper, gpt-4o-mini, intent
            classifier, ~12 read-only tools (quote, movers, breadth,
            sector strength, news, etc.), tool registry foundation
  Frontend: FloatingOrb, TranscriptBubble, useOneShot hook,
            push-to-talk hotkey
  Acceptance: "what's NVDA at" returns spoken answer in <2.5s with
              correct quote; latency + accuracy acceptable

SLICE 3 — Wake word ........................................ ~2 days
  Frontend: Porcupine WASM integration, useWakeWord hook,
            Settings toggle, calibration screen
  Wires into existing FloatingOrb state machine
  Acceptance: "Hey UCT Intelligence" reliably wakes the orb at
              normal speaking distance with no false positives in
              5min of normal app use

SLICE 4 — Realtime + read tools (Mode C, no writes) ......... ~5 days
  Backend:  /api/voice/session_token, ephemeral tokens, WebRTC
            data channel handling, transcript persistence,
            voice_sessions/transcripts/usage tables
  Frontend: useVoiceSession, multi-turn handling, mode escalation
  Tools loaded so far: all read tools across categories
  Acceptance: multi-turn read conversations work end-to-end,
              transcripts saved, Voice History page shows them

SLICE 5 — Write tools with verbal confirm ................... ~5 days
  Backend:  voice_dispatch two-phase executor, action_id signing,
            write tools (journal create/close/update, watchlist
            add/remove/tag/alert, daily notes)
  Frontend: VoiceConfirmModal, mishear protection UI
  Acceptance: "log NVDA position" works with read-back confirm,
              all writes appear in audit log + voice history

SLICE 6 — Agentic flows + chart control ..................... ~4 days
  Backend:  voice_briefings.py (morning_briefing, pre_trade_check,
            eod_summary, plan_my_day, post_trade_review)
  Frontend: chart tool subset, drawing tools, screenshot
  Acceptance: "morning briefing" produces a coherent monologue
              chaining wire + earnings + positions + alerts;
              chart commands work on chart pages

SLICE 7 — Self-Q&A + reporting + polish ..................... ~3 days
  Backend:  self-Q&A tools (my_pnl, my_setups, my_psychology,
            my_mistakes), report generation tools
  Frontend: Voice History page polish, admin observability
  Acceptance: "how did I do this week" returns accurate P&L
              + setup performance; admin panel shows usage/cost
```

**Total: ~28 working days** spread across 4–6 calendar weeks.

After each slice ships and is used for a few days, we look for friction (wrong tool picked, mishears, latency complaints, cost surprises) and fix before starting the next slice. This keeps the design grounded in real use rather than theoretical completeness.

---

## 11. Open Questions / Future Work

Items deliberately out of v1 but worth revisiting:

- **Multilingual support** — v1 is English only. Whisper + Realtime support many languages; could add later with minimal work.
- **Voice biometric login** — confirm identity via voice for high-risk actions. Out of v1; rely on existing session auth.
- **Background mode** — wake word fires when tab not focused. Tricky on mobile; possible on desktop with Service Worker. Defer.
- **Custom wake words per user** — Porcupine supports it but adds a model-training step per user. v1 ships one phrase.
- **Voice-driven onboarding tour** — first-time users could be walked through the app by voice. Nice-to-have.
- **Slack/Discord voice bridges** — pipe the assistant into Slack or Discord voice channels. Out of v1.
- **Live brokerage integration** — explicitly excluded from v1. Future work would require: brokerage API connector, two-factor for live trades, regulatory review, MUCH stricter mishear protection.
- **`gpt-realtime-mini`** — if/when OpenAI releases a smaller Realtime model, route simple multi-turn flows to it for ~5x cost reduction.
- **Local STT fallback** — for offline / privacy mode, run Whisper locally via WASM (whisper.cpp). Adds 100MB+ download but no per-query cost.

---

## 12. Spec Status

- [x] Architecture approved
- [x] Tool catalog approved
- [x] Data flow approved
- [x] Frontend components approved
- [x] Backend additions approved
- [x] Testing + phasing approved
- [ ] User reviews written spec
- [ ] Implementation plan written via `superpowers:writing-plans`
