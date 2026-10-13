# Follow-up — paid AI paths outside the two budgets (security and cost control)

**Status:** a FINDING for separate scheduling (owner, 2026-10-13). It is **not** part of the Agent project: nothing listed here was changed, and the Agent work does not rewrite these systems.

**Source:** a read-only audit of `api/` on `fdba4c997d` (2026-10-13). It was cross-checked against the door registry, `api/services/ai_doors.py` (verified 2026-09-28). Line numbers are as of that commit.

## 1. Summary
- The repository has about 90 paid AI or paid-search call sites. Only these are under one of the two daily budgets:
  - **the shared $15**: about 7 features (catalyst synthesis + curator / hunter / rule learner, sector reads, call recaps, the indicator builder `/propose` + `/converse`, indicator vision);
  - **UCT Agent's own $5.**
- About 80 other call sites each have their own cap (most are floor checks of spend so far, not reservations), only a count limit, or **no dollar limit at all**.
- **Atomic dollar caps today:** only the UCT Agent ledger and the Notebook's `daily_counters` $25.

## 2. ⚠ Unauthenticated paid paths (priority)
| Path | What it calls | Current bound |
|---|---|---|
| `api/routers/earnings.py:289` | A debug earnings "ping" that makes a model call | none: no auth, no cap |
| `api/services/transcripts.py:215` (its route) | A model call over a transcript | 10/min per IP only; no auth, no $ cap |

**Risk:** anyone who can reach the API can spend money in a loop. Per-IP limits are bypassable from many IPs.
**Suggested direction (for the owners of those features):** require authentication (or remove the debug route); then add a dollar cap.

## 3. Member-reachable paths with no dollar cap
| Area | Call sites (examples) | Current bound |
|---|---|---|
| Voice | `voice_chart_vision.py:86`, `voice_deep_research.py:241` (the Claude part), `voice_summarizer.py:51`, `trader_profile_auto.py:70`, `voice_embeddings_service.py:53`, `brain_kb_service.py:77` | per-IP / per-member monthly quotas; no $ cap |
| Company info | `company_about.py:140`, `groups.py:438` | cache only |
| Earnings analysis | `engine.py:1610,2012`, `earnings_enrichment.py:666` | 60/min per IP + cache |
| Model Book / stock brief | `routers/modelbook.py` (several), `stock_brief/service.py:224` | store-once; 300/day in-process |
| Community ask (dark) | `community_ask.py:79` | 20 s cooldown |
| Compass | `coach_chat.py` (`COMPASS_COST_CAP_DAILY` defaults to 0 = off), coach / trade review / verdict | count limits only |

## 4. Scheduled jobs with no dollar cap
| Job | Bound |
|---|---|
| `desk_creative.py:325` | flags only |
| `desk_creative.py:758` (OpenAI image generation, up to 3 tries) | flags only |
| `desk_session_insights.py`, `desk_session_recap.py`, `discord_close_note.py` | flags / once per session |

## 5. Separately capped (floor checks)
| Feature | Daily cap |
|---|---|
| AI Search synthesis | $5 |
| AI Search agent | $15 |
| AI Search deep | $10 |
| Personal AI Search | $25 (in-process) |
| Dossier | $3 (in-process) |
| Ticker explain | $10 |
| Comparison explain | $10 |
| Schwab narrative | $5 |
| Flow explain | $5 |
| Call-recap warmer | $10 |
| Theme engine | $5 |
| Pattern vision | $10 |
| Notebook | $25 (atomic) |

**Perplexity, across all callers:** 500 calls/day (a durable count) and **no dollar cap**; per-call cost is telemetry only.

## 6. Why this matters, and why it is separate
- **No true site-wide cap.** Real daily AI spend can exceed $15 + $5 by a wide margin. Neither budget may be described as site-wide (owner, 2026-10-13).
- **Not this project's to fix.** Fixing these paths means changing many systems owned by other features. Option D deliberately keeps the Agent's budget independent instead.
- **Suggested order:**
  1. the two unauthenticated paths;
  2. member-reachable uncapped paths;
  3. a single durable spend ledger with reservations that every paid path records into (the Agent's `budget.py` pattern could be generalised);
  4. then a true site-wide ceiling.
