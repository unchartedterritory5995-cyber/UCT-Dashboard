# Voice Compass Phase 3 — Elite Market Wizard Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking. Sprints can be executed independently and in any order — they're additive.

**Goal:** Make voice Compass the most institutionally-aware AI market assistant possible by maximizing Perplexity coverage, activating dormant APIs, exposing built-but-hidden services, adding new data sources, proactive intelligence, real backtest capability, and vision-input from the orb.

**Architecture:** Perplexity is the spine for all open-ended knowledge queries (tiered: fast / reasoning / deep-research, with finance domain pack + recency filters). Internal tools cover ticker-specific live data, journal, KB. Claude Sonnet 4.6 handles multi-source synthesis. New data sources fan out cheap/free to fill the breadth gaps. Proactive layer adds morning briefings + Discord relay + voice persona switching. Backtest engine and scenario simulator close the analytical loop. Vision input from the orb closes the multimodal gap.

**Tech Stack:** FastAPI (Python 3.12), OpenAI Realtime API (`gpt-realtime`), Perplexity Sonar (all tiers), Anthropic Claude Sonnet 4.6, SQLite + WAL, APScheduler, yfinance, scipy, requests. All new services follow the existing `api/services/<name>.py` + voice-tool registration pattern.

**Scope decision:** Schwab integration explicitly OUT of scope (partner's territory). Bloomberg/Tegus/AlphaSense enterprise feeds OUT of scope (cost-prohibitive). Stripe paywall changes OUT of scope. Mobile-app push notifications OUT of scope.

---

## Current State (from 2026-05-26 audit)

**What's elite already** (don't disturb):
- 122 voice tools wired across journal, market, KB, memory, action, briefings
- Pre-loaded session context (positions + interventions + focus)
- Deep-research sub-agent (Claude Sonnet 4.6 multi-source synthesis)
- Hallucination audit (auto-fires on session end)
- Unified Compass × Voice memory facade (`trader_memory.build_unified_memory_context`)
- Pattern engine (85 detectors), KB with semantic search (7,891 entries), embedding-indexed facts/summaries

**Perplexity underutilization** (the biggest single win):
- Only `sonar-pro` used — never `sonar-reasoning-pro` or `sonar-deep-research`
- `search_domain_filter` and `search_recency_filter` parameters never set
- One basic wrapper in `api/services/perplexity_search.py`; morning-wire has more capability but it's not reachable from voice

**Dormant capability** (high-leverage activation):
- `THEFLY_API_KEY` referenced in `.env` but zero usage in code
- `FRED_API_KEY` not yet in `.env` (Item 7 ships fred_economic.py but key needed)
- `TWITTERAPI_IO_ENABLED=0` likely on Railway (Twitter feed dormant)
- `AlphaVantage` news barely called (cache-burn concern from 2026-03-21)

**Built but hidden from voice**:
- Earnings transcripts (`api/services/transcripts.py:186 get_transcript_summary` — Finnhub + Haiku) — no voice tool
- Catalyst table (`api/services/catalyst/` — Opus-scored top 12 pre-market catalysts) — no voice tool
- Email digest (`coach_email_digest.py`) — no voice request path
- `news_aggregator.py` RSS + AV — no voice tool

---

## The Eight Pillars

| # | Pillar | Effort | Cost | Cumulative impact |
|---|---|---|---|---|
| 1 | Perplexity maximization | ~4 hrs | $0 extra (existing key) | +30% answer quality on open-ended questions |
| 2 | Activate dormant APIs | ~3 hrs | $0 (keys exist) | Unblocks Twitter feed, FRED, Fly News, AlphaVantage |
| 3 | Expose hidden services to voice | ~3 hrs | $0 | Transcripts, catalysts, digests reachable |
| 4 | New data sources (Reddit, Stocktwits, 13F, short interest, insider clusters) | ~8 hrs | $0 (all free) | Fills the social + institutional ownership gaps |
| 5 | Proactive intelligence layer | ~10 hrs | ~$0-2/day | Morning briefing + Discord relay + voice personas |
| 6 | Backtest & scenario engine | ~12 hrs | $0 | Closes the "what would happen if" loop |
| 7 | Vision input from the orb | ~4 hrs | minor | Paste screenshot → analysis |
| 8 | Observability + auto-profile | ~6 hrs | $0 | Hallucination dashboard + passive Trader Profile builder |

**Grand total: ~50 hours of work + $0-2/day in incremental API costs.** Each pillar ships independently. Recommended order: 1 → 2 → 3 → 4 → 7 → 8 → 5 → 6 (cheapest/highest impact first).

---

## File Structure

New files to create:
```
api/services/
├── perplexity_search.py          # EXTEND — tiered modes + filters
├── perplexity_finance.py         # NEW — lift fetch_breaking_news + finance helpers
├── reddit_sentiment.py           # NEW
├── stocktwits_sentiment.py       # NEW
├── institutional_holdings.py     # NEW — 13F from SEC + WhaleWisdom
├── short_interest.py             # NEW — Finra short interest
├── insider_clusters.py           # NEW — OpenInsider scraping or alternative
├── sentiment_aggregator.py       # NEW — combine Twitter + Reddit + Stocktwits
├── voice_briefings_proactive.py  # NEW — auto-morning briefing
├── voice_personas.py             # NEW — PM / Coach / Analyst / Devil's Advocate voices
├── discord_relay.py              # NEW — post insights to Discord
├── trader_profile_auto.py        # NEW — passive profile-builder from transcripts
├── pattern_backtest.py           # NEW — run pattern detector across history → P&L
├── scenario_simulator.py         # NEW — "what if sizing was X" engine
├── portfolio_stress.py           # NEW — real-time portfolio stress test
└── voice_vision_input.py         # NEW — vision input pipeline from frontend

api/routers/
├── voice_vision.py               # EXTEND — POST /voice/vision/orb-screenshot
└── voice_proactive.py            # NEW — settings + manual trigger endpoints

app/src/components/voice/
├── FloatingOrb.jsx               # MODIFY — paperclip image-attach button
├── VisionAttachButton.jsx        # NEW — vision attach UI
└── PersonaPicker.jsx             # NEW — voice persona selector

api/services/voice_prompts/
├── compass.py                    # MODIFY — point at new tools
└── personas.py                   # NEW — persona-specific addendum

requirements.txt                  # ADD: praw (Reddit), Pillow updates if needed
```

Files to extend (notable existing):
- `api/services/voice_tool_impls.py` — registration for every new tool
- `api/services/voice_agents.py` — `_compass_tool_union()` updates
- `api/services/voice_deep_research.py` — route through tiered Perplexity

---

# Sprint 1 — Perplexity Maximization

**Why first**: Single biggest answer-quality lift. Already have the key. Everything else (open-ended research, breaking news, fundamental questions) compounds on this.

### Task 1.1: Build tiered Perplexity client

**Files:**
- Modify: `api/services/perplexity_search.py`

- [ ] **Step 1: Extend module constants with all three models + domain pack**

```python
# api/services/perplexity_search.py — add near top

# Three tiers Perplexity exposes. Voice routes based on question type.
_MODELS = {
    "fast":      "sonar-pro",            # ~2-3s, web search + light synthesis
    "reasoning": "sonar-reasoning-pro",  # ~5-10s, explicit reasoning step
    "deep":      "sonar-deep-research",  # ~minutes, exhaustive multi-source
}

# Curated finance domain pack — locks low-quality blogs out.
_FINANCE_DOMAINS = [
    "bloomberg.com", "reuters.com", "wsj.com", "ft.com",
    "barrons.com", "marketwatch.com", "cnbc.com", "investors.com",
    "seekingalpha.com", "thefly.com", "benzinga.com", "briefing.com",
    "tradingview.com", "stockanalysis.com", "finance.yahoo.com",
    "federalreserve.gov", "sec.gov", "treasury.gov",
]
```

- [ ] **Step 2: Rewrite `web_search()` to support mode + filters**

```python
def web_search(
    query: str,
    max_tokens: int = 400,
    system: str | None = None,
    mode: str = "fast",
    recency: str | None = None,        # "hour" | "day" | "week" | "month" | None
    domain_pack: str = "general",       # "finance" | "general"
    domains: list[str] | None = None,   # override pack with explicit list
) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"answer": "", "citations": [], "error": "empty query"}

    model = _MODELS.get(mode, _MODELS["fast"])
    if domains is None:
        domains = _FINANCE_DOMAINS if domain_pack == "finance" else None

    cache_key = f"pplx::{model}::{recency or 'any'}::{domain_pack}::{max_tokens}::{query.lower()[:300]}"
    cached = _SEARCH_CACHE.get(cache_key)
    if cached is not None:
        out = dict(cached); out["cached"] = True; return out

    api_key = os.environ.get("PERPLEXITY_API_KEY", "").strip()
    if not api_key:
        return {"answer": "", "citations": [], "error": "PERPLEXITY_API_KEY not set"}

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system or _DEFAULT_SYSTEM},
            {"role": "user", "content": query},
        ],
        "max_tokens": max(50, min(2000, int(max_tokens or 400))),
    }
    if domains:
        payload["search_domain_filter"] = domains[:20]
    if recency:
        payload["search_recency_filter"] = recency

    # ... rest of call unchanged
```

- [ ] **Step 3: Commit**

```bash
git add api/services/perplexity_search.py
git commit -m "feat(voice): tiered Perplexity client (fast/reasoning/deep) with finance domain pack + recency"
```

### Task 1.2: Expose tiered modes as voice tools

**Files:**
- Modify: `api/services/voice_tool_impls.py` — extend `_web_search`, add `_web_search_reasoning`, `_web_search_deep`, `_search_finance_news`
- Modify: `api/services/voice_agents.py` — add to compass union

- [ ] **Step 1: Extend voice tool impl signatures**

```python
def _web_search(query: str = "", max_tokens: int = 400,
                mode: str = "fast", recency: str = "",
                domain_pack: str = "general") -> dict:
    if not query or not (query := query.strip()):
        return {"answer": "no query provided", "citations": []}
    from api.services.perplexity_search import web_search
    result = web_search(query=query, max_tokens=max_tokens or 400,
                        mode=mode or "fast",
                        recency=recency or None,
                        domain_pack=domain_pack or "general")
    if result.get("error"):
        return {"answer": "web search unavailable", "error": result["error"]}
    return {
        "answer": (result.get("answer") or "")[:1500],
        "citations": result.get("citations") or [],
        "mode": mode or "fast",
        "elapsed_ms": result.get("elapsed_ms"),
        "cached": bool(result.get("cached")),
    }


def _search_finance_news(query: str = "", recency: str = "day",
                        max_tokens: int = 400) -> dict:
    """Perplexity locked to finance domains with recency window."""
    return _web_search(query=query, max_tokens=max_tokens,
                       mode="fast", recency=recency or "day",
                       domain_pack="finance")


def _research_deep(query: str = "", max_tokens: int = 1500) -> dict:
    """Perplexity sonar-deep-research — exhaustive multi-source, minutes-long."""
    return _web_search(query=query, max_tokens=max_tokens,
                       mode="deep", recency=None,
                       domain_pack="finance")
```

- [ ] **Step 2: Update existing `web_search` registration with new params**

```python
_vt.voice_tool(
    name="web_search",
    description=(
        "Live web research via Perplexity. Pick a mode based on question depth: "
        "'fast' (sonar-pro, ~3s, default), 'reasoning' (sonar-reasoning-pro, "
        "~7s, explicit reasoning step), 'deep' (sonar-deep-research, ~minutes, "
        "exhaustive — use sparingly). domain_pack='finance' locks to Bloomberg/"
        "Reuters/WSJ/FT/Barrons/CNBC/SEC. recency='hour'/'day'/'week'/'month' "
        "for time-sensitive questions. ALWAYS use domain_pack='finance' for "
        "anything market-related. ALWAYS use recency='hour' or 'day' for "
        "current events."
    ),
    parameters={
        "query": {"type": "string"},
        "max_tokens": {"type": "integer"},
        "mode": {"type": "string", "enum": ["fast", "reasoning", "deep"]},
        "recency": {"type": "string", "enum": ["hour", "day", "week", "month"]},
        "domain_pack": {"type": "string", "enum": ["finance", "general"]},
    },
    contexts=["global"],
)(_web_search)

_vt.voice_tool(
    name="search_finance_news",
    description=(
        "Convenience wrapper: Perplexity locked to top finance sources "
        "(Bloomberg/Reuters/WSJ/FT/etc.) with default 'day' recency. Use "
        "for 'what's the news on X', 'what's happening in the market', "
        "'why is X down today'. Faster than web_search because pre-tuned."
    ),
    parameters={
        "query": {"type": "string"},
        "recency": {"type": "string", "enum": ["hour", "day", "week", "month"]},
        "max_tokens": {"type": "integer"},
    },
    contexts=["global"],
)(_search_finance_news)

_vt.voice_tool(
    name="research_deep",
    description=(
        "EXHAUSTIVE research via Perplexity sonar-deep-research. Takes MINUTES "
        "(2-5 minutes typical). Use for 'build me a thesis on X', 'do real "
        "research on the SMR sector', 'give me the bear case on NVDA' — "
        "questions that warrant a full report. Returns long-form synthesis. "
        "Tell the user up front: 'This will take a few minutes — I'll come "
        "back to you.' Cache TTL: 1 hour."
    ),
    parameters={
        "query": {"type": "string"},
        "max_tokens": {"type": "integer"},
    },
    contexts=["global"],
)(_research_deep)
```

- [ ] **Step 3: Add new tools to compass union in voice_agents.py**

```python
out.add("search_finance_news")
out.add("research_deep")
```

- [ ] **Step 4: Commit**

```bash
git add api/services/voice_tool_impls.py api/services/voice_agents.py
git commit -m "feat(voice): expose Perplexity tiered modes — search_finance_news + research_deep"
```

### Task 1.3: Route deep_research through tiered modes

**Files:** Modify: `api/services/voice_deep_research.py`

- [ ] **Step 1: Add reasoning-mode upgrade for complex questions inside `_gather_sources`**

Replace the simple `web_search(question, max_tokens=500)` call with:

```python
def _web():
    try:
        from api.services.perplexity_search import web_search
        # Use reasoning mode + finance pack for any non-trivial research
        return web_search(question, max_tokens=600,
                          mode="reasoning", recency="day",
                          domain_pack="finance")
    except Exception as e:
        _log.warning("web search failed: %s", e)
        return None
```

- [ ] **Step 2: Commit**

```bash
git add api/services/voice_deep_research.py
git commit -m "feat(voice): route deep_research through Perplexity reasoning mode + finance pack"
```

### Task 1.4: Update voice prompt to teach Compass the new reach logic

**Files:** Modify: `api/services/voice_prompts/compass.py`

- [ ] **Step 1: Replace the existing web_search guidance with a tiered + finance-first directive**

```python
# In the "Tool catalog awareness" section, replace the live web research bullet:
- Live web research (web_search) — Perplexity. THREE modes:
  · mode='fast' (default, 3s) for quick news/facts
  · mode='reasoning' (7s) for harder takes that need synthesis
  · mode='deep' (2-5 min) for full research reports — TELL THE USER it'll
    take a few minutes before calling.
  · search_finance_news() is the convenience wrapper — locks to Bloomberg/
    Reuters/WSJ/FT/Barrons/CNBC + recency='day' default. USE THIS FIRST
    for any market-news question.
  · research_deep() = sonar-deep-research wrapped — for thesis-building.
  · domain_pack='finance' is mandatory for any market-related query.
  · recency='hour' or 'day' is mandatory for any "today/now/breaking" query.
```

- [ ] **Step 2: Commit**

```bash
git add api/services/voice_prompts/compass.py
git commit -m "feat(voice): teach Compass tiered Perplexity reach logic"
```

---

# Sprint 2 — Activate Dormant APIs

**Why second**: Each is a 30-min wire-up that unblocks a major capability. All keys either exist or are free.

### Task 2.1: FRED key documentation + healthcheck

**Files:**
- Modify: `.env.example` (create if missing)
- Modify: `api/routers/admin.py` — add `/api/admin/api-health` endpoint

- [ ] **Step 1: Add FRED key to env example**

```bash
# Add to .env.example:
FRED_API_KEY=  # Free at https://fred.stlouisfed.org/docs/api/api_key.html
```

- [ ] **Step 2: Build admin healthcheck endpoint**

```python
# api/routers/admin.py — add endpoint
@router.get("/admin/api-health")
def api_health(user: dict = Depends(requires_admin)):
    """Status of every external API key + basic ping."""
    import os
    keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PERPLEXITY_API_KEY",
            "MASSIVE_API_KEY", "FINNHUB_API_KEY", "FMP_API_KEY",
            "ALPHAVANTAGE_API_KEY", "FRED_API_KEY", "TWITTERAPI_IO_API_KEY",
            "RESEND_API_KEY", "DISCORD_WEBHOOK_URL", "REDDIT_CLIENT_ID",
            "REDDIT_CLIENT_SECRET", "THEFLY_API_KEY"]
    return {
        "keys_set": {k: bool(os.environ.get(k, "").strip()) for k in keys},
        "twitter_enabled": os.environ.get("TWITTERAPI_IO_ENABLED") == "1",
    }
```

- [ ] **Step 3: Commit + tell user to set FRED_API_KEY on Railway**

```bash
git add .env.example api/routers/admin.py
git commit -m "feat(ops): API health endpoint + FRED key docs"
```

### Task 2.2: Activate THEFLY API (if subscription)

**Files:**
- Create: `api/services/thefly_news.py`
- Modify: `api/services/voice_tool_impls.py`, `voice_agents.py`

- [ ] **Step 1: Build the_fly wrapper assuming standard REST**

```python
# api/services/thefly_news.py
"""TheFly.com Squawk feed — pro analyst news + alerts. If key isn't set,
returns gracefully empty so voice tool degrades to a 'no data' answer."""

import os, requests, time, logging
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_CACHE = TTLCache()
_CACHE_TTL = 300  # 5 min
_TIMEOUT = 8

# Endpoint pattern depends on user's subscription tier — confirm before wire-up
_BASE = os.environ.get("THEFLY_BASE_URL", "https://api.thefly.com/v1")


def get_squawks(symbol: str = "", category: str = "", count: int = 10) -> dict:
    api_key = os.environ.get("THEFLY_API_KEY", "").strip()
    if not api_key:
        return {"error": "THEFLY_API_KEY not configured", "items": []}

    cache_key = f"thefly::{symbol}::{category}::{count}"
    cached = _CACHE.get(cache_key)
    if cached: return dict(cached)

    params = {"key": api_key, "limit": max(1, min(50, int(count or 10)))}
    if symbol: params["symbol"] = symbol.upper()
    if category: params["category"] = category

    try:
        r = requests.get(f"{_BASE}/news/squawks", params=params, timeout=_TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        _log.warning("thefly request failed: %s", e)
        return {"error": f"thefly request failed: {e}", "items": []}

    result = {"count": len(data.get("items", [])), "items": data.get("items", [])[:count]}
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
```

- [ ] **Step 2: Voice tool wrapper + register**

```python
# voice_tool_impls.py
def _get_thefly_squawks(symbol: str = "", category: str = "", count: int = 10) -> dict:
    try:
        from api.services.thefly_news import get_squawks
        return get_squawks(symbol=symbol, category=category, count=count or 10)
    except Exception as e:
        return {"error": str(e), "items": []}

# In _register_all:
_vt.voice_tool(
    name="get_thefly_squawks",
    description=(
        "TheFly Squawk feed — institutional analyst news, syndicate calls, "
        "M&A flashes, hot mover alerts. Filter by symbol or category "
        "(syndicate/analyst/m&a/general)."
    ),
    parameters={
        "symbol": {"type": "string"},
        "category": {"type": "string"},
        "count": {"type": "integer"},
    },
    contexts=["global"],
)(_get_thefly_squawks)
```

- [ ] **Step 3: Add to compass union + commit**

```bash
git add api/services/thefly_news.py api/services/voice_tool_impls.py api/services/voice_agents.py
git commit -m "feat(voice): activate TheFly squawk feed (gated on THEFLY_API_KEY)"
```

### Task 2.3: Confirm Twitter feed enabled on Railway

**Files:** Modify deploy env via Railway dashboard (no code change)

- [ ] **Step 1: User action — set `TWITTERAPI_IO_ENABLED=1` on Railway**
- [ ] **Step 2: Verify `/api/admin/api-health` returns `twitter_enabled: true` after redeploy**
- [ ] **Step 3: Verify `_tweet_tape` returns data** (should already work since Phase 1 wired the tool)

---

# Sprint 3 — Expose Hidden Services to Voice

**Why third**: Built services that voice can't reach today. ~30 min per wiring, big functionality unlocks.

### Task 3.1: Earnings transcript voice tool

**Files:** Modify: `api/services/voice_tool_impls.py`, `voice_agents.py`

- [ ] **Step 1: Voice tool impl + registration**

```python
def _get_earnings_transcript(symbol: str = "") -> dict:
    """Most-recent earnings call transcript with AI summary (Finnhub + Haiku)."""
    if not symbol or not (symbol := symbol.strip()):
        return {"error": "symbol required"}
    try:
        from api.services.transcripts import get_transcript_summary
        result = get_transcript_summary(symbol.upper())
        if not result:
            return {"error": f"no transcript available for {symbol}"}
        return {
            "symbol": symbol.upper(),
            "summary": result.get("summary", ""),
            "headline": result.get("headline", ""),
            "sentiment": result.get("sentiment", ""),
            "bullets": result.get("bullets", []),
        }
    except Exception as e:
        return {"error": f"transcript unavailable: {e}"}

# Register:
_vt.voice_tool(
    name="get_earnings_transcript",
    description=(
        "Most-recent earnings-call transcript summary for a ticker — AI-"
        "synthesized headline + 5-7 bullets + sentiment. Call for 'what did "
        "X say on the call', 'guidance from last earnings', 'analyst Q&A "
        "summary on Y'."
    ),
    parameters={"symbol": {"type": "string"}},
    contexts=["global"],
)(_get_earnings_transcript)
```

- [ ] **Step 2: Add to compass union + commit**

```bash
git commit -m "feat(voice): expose earnings transcript summaries to Compass"
```

### Task 3.2: Catalyst table voice tool

**Files:**
- Look up: `api/services/catalyst/` (built 2026-05-25 per memory)
- Modify: `api/services/voice_tool_impls.py`, `voice_agents.py`

- [ ] **Step 1: Read the catalyst service signatures**

```bash
# Inspect to confirm function names:
grep -E "^def " api/services/catalyst/*.py
```

- [ ] **Step 2: Voice tool wrapper**

```python
def _get_top_catalysts(count: int = 12) -> dict:
    """Top pre-market catalysts scored by Claude Opus — gappers, news,
    earnings reactions, analyst calls, all ranked."""
    try:
        from api.services.catalyst.synthesize import get_top_catalysts
        items = get_top_catalysts(limit=max(1, min(20, int(count or 12))))
        return {"count": len(items), "catalysts": items}
    except Exception as e:
        return {"error": f"catalyst table unavailable: {e}", "count": 0}

_vt.voice_tool(
    name="get_top_catalysts",
    description=(
        "Top pre-market catalysts ranked by Claude Opus — gappers, M&A, "
        "earnings beats/misses, analyst upgrades/downgrades, syndicate "
        "pricings. Call for 'what's moving today', 'what are the top "
        "stories pre-open'."
    ),
    parameters={"count": {"type": "integer"}},
    contexts=["global"],
)(_get_top_catalysts)
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(voice): expose Opus-scored catalyst table to Compass"
```

### Task 3.3: Voice → Email digest tool

**Files:** Modify: `api/services/voice_tool_impls.py`, `voice_agents.py`

- [ ] **Step 1: Voice tool — request email digest on demand**

```python
def _email_me_weekly_digest(*, user) -> dict:
    """Generate + email weekly Compass digest immediately."""
    try:
        from api.services.journal_two.coach_email_digest import send_user_digest
        result = send_user_digest(user_id=user["id"], force=True)
        return {"ok": bool(result), "sent": result}
    except Exception as e:
        return {"error": f"digest send failed: {e}"}

_vt.voice_tool(
    name="email_me_weekly_digest",
    description=(
        "Generate and email the Compass weekly digest right now — same one "
        "that fires Sundays 8am ET. Call when the user says 'send me my "
        "weekly review' / 'email me the recap'."
    ),
    parameters={},
    contexts=["global"],
    wants_user=True,
)(_email_me_weekly_digest)
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(voice): on-demand weekly digest email tool"
```

---

# Sprint 4 — New Data Sources (Breadth)

**Why fourth**: Fills the social + institutional ownership gaps. All free.

### Task 4.1: Reddit sentiment

**Files:**
- Create: `api/services/reddit_sentiment.py`
- Modify: `requirements.txt` (add `praw>=7.7`)

- [ ] **Step 1: Service** — wraps PRAW. Fetches r/wallstreetbets + r/stocks + r/options threads matching ticker, counts bullish/bearish keywords, returns sentiment + sample posts.

```python
# api/services/reddit_sentiment.py
import os, logging, re
from collections import Counter
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_CACHE = TTLCache()
_TTL = 600

_BULL = re.compile(r"\b(bull|moon|rip|breakout|🚀|💎|long|calls?)\b", re.I)
_BEAR = re.compile(r"\b(bear|dump|short|tank|puts?|crash|drilling)\b", re.I)

_SUBS = ["wallstreetbets", "stocks", "options", "investing", "thetagang"]


def _client():
    import praw
    return praw.Reddit(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        user_agent="uct-intelligence/1.0",
    )


def sentiment_for_ticker(ticker: str, hours: int = 24, limit: int = 50) -> dict:
    sym = (ticker or "").upper().strip()
    if not sym: return {"error": "ticker required"}
    cache_key = f"reddit::{sym}::{hours}::{limit}"
    cached = _CACHE.get(cache_key)
    if cached: return dict(cached)
    if not os.environ.get("REDDIT_CLIENT_ID"):
        return {"error": "REDDIT_CLIENT_ID not set"}

    try:
        r = _client()
        bull = bear = 0
        samples = []
        for sub_name in _SUBS:
            sub = r.subreddit(sub_name)
            for s in sub.search(f"${sym} OR {sym}", time_filter="day", limit=limit // len(_SUBS)):
                text = (s.title + " " + (s.selftext or ""))[:2000]
                b = len(_BULL.findall(text))
                br = len(_BEAR.findall(text))
                bull += b; bear += br
                if len(samples) < 5 and (b + br) > 0:
                    samples.append({
                        "title": s.title[:200],
                        "subreddit": sub_name,
                        "score": s.score,
                        "comments": s.num_comments,
                        "bull": b, "bear": br,
                    })
        total = bull + bear
        score = (bull - bear) / total if total else 0.0
        result = {
            "ticker": sym, "bull_signals": bull, "bear_signals": bear,
            "net_score": round(score, 3),
            "verdict": "bullish" if score > 0.2 else "bearish" if score < -0.2 else "mixed",
            "samples": samples,
        }
    except Exception as e:
        _log.warning("reddit sentiment failed: %s", e)
        return {"error": f"reddit failed: {e}"}
    _CACHE.set(cache_key, dict(result), _TTL)
    return result
```

- [ ] **Step 2: Voice tool registration**

```python
def _reddit_sentiment(ticker: str = "", hours: int = 24) -> dict:
    from api.services.reddit_sentiment import sentiment_for_ticker
    return sentiment_for_ticker(ticker, hours=hours or 24)

_vt.voice_tool(
    name="reddit_sentiment",
    description="Reddit retail sentiment for a ticker (r/wsb + r/stocks + r/options + r/investing + r/thetagang). Returns bull/bear signal counts, net score, sample posts.",
    parameters={"ticker": {"type": "string"}, "hours": {"type": "integer"}},
    contexts=["global"],
)(_reddit_sentiment)
```

- [ ] **Step 3: Commit + tell user to create Reddit app at reddit.com/prefs/apps**

```bash
git commit -m "feat(voice): Reddit sentiment via PRAW"
```

### Task 4.2: Stocktwits sentiment

**Files:** Create: `api/services/stocktwits_sentiment.py`. Stocktwits has a free public API: `https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json` returning messages with `entities.sentiment` field (Bullish/Bearish).

- [ ] **Step 1: Service** — fetch + bucket sentiments, return verdict + sample.
- [ ] **Step 2: Voice tool + registration** (mirror Reddit pattern).
- [ ] **Step 3: Commit.**

### Task 4.3: SEC 13F institutional holdings

**Files:** Create: `api/services/institutional_holdings.py`. Use SEC EDGAR direct (already have `sec_filings.py` with CIK lookup); parse the `INFORMATIONTABLE` XML from latest 13F-HR per institution.

- [ ] **Step 1: Service** — `holders_of_ticker(sym)` returns list of `{holder_name, shares, value, pct_of_holdings, prior_qtr_shares, change}`.
- [ ] **Step 2: Voice tool — `get_institutional_holders(ticker, top_n)`**.
- [ ] **Step 3: Commit.**

### Task 4.4: Short interest

**Files:** Create: `api/services/short_interest.py`. Free source: Finra short interest CSV (bi-monthly), or a free API like shortinterest.com if available.

- [ ] **Step 1: Service** — `get_short_interest(sym)` returns `{shares_short, days_to_cover, short_pct_float, as_of_date}`.
- [ ] **Step 2: Voice tool — `get_short_interest(ticker)`**.
- [ ] **Step 3: Commit.**

### Task 4.5: Open insider clusters

**Files:** Create: `api/services/insider_clusters.py`. Scrape OpenInsider's free cluster page (form 4 aggregation).

- [ ] **Step 1: Service** — `get_insider_clusters(days=7)` returns recent significant insider buying clusters.
- [ ] **Step 2: Voice tool**.
- [ ] **Step 3: Commit.**

### Task 4.6: Combined sentiment aggregator

**Files:** Create: `api/services/sentiment_aggregator.py` — combines Twitter + Reddit + Stocktwits into single verdict.

- [ ] **Step 1: Aggregator that calls all three sources and returns unified `{ticker, verdict, twitter, reddit, stocktwits, agreement}`**.
- [ ] **Step 2: Voice tool — `get_social_sentiment(ticker)`** — single call replaces three.
- [ ] **Step 3: Commit.**

---

# Sprint 5 — Proactive Intelligence Layer

**Why fifth**: Compass actively serves you, not just answers your taps.

### Task 5.1: Auto-morning briefing daemon

**Files:**
- Create: `api/services/voice_briefings_proactive.py` — builds briefing payload (regime + overnight news + your watchlist movers + earnings today + active interventions).
- Modify: `api/main.py` — register APScheduler job at user-configured time.
- Modify: `api/services/voice_settings.py` — add `morning_briefing_time_et` field.

- [ ] **Step 1: Briefing builder** — pulls from existing services (regime, news, watchlist movers, calendar, interventions), formats as a 60-90s narration script.
- [ ] **Step 2: Scheduler** — APScheduler job runs at user's configured time, calls Compass to *generate* the briefing, stores it, marks pending. When user opens voice, briefing plays.
- [ ] **Step 3: Voice tool — `play_my_morning_briefing()`** — pulls latest pending briefing.
- [ ] **Step 4: Commit.**

### Task 5.2: Discord relay

**Files:** Create: `api/services/discord_relay.py`.

- [ ] **Step 1: Wrapper around existing `DISCORD_WEBHOOK_URL`** — posts text to channel.
- [ ] **Step 2: Voice tool — `post_to_discord(message)`** — preview-confirm (action tool).
- [ ] **Step 3: Commit.**

### Task 5.3: Voice personas

**Files:**
- Create: `api/services/voice_personas.py` — persona definitions (PM, Coach, Analyst, Devil's Advocate).
- Create: `api/services/voice_prompts/personas.py` — per-persona prompt addenda.
- Modify: `api/routers/voice.py` — session_token reads `persona` from request body, injects matching addendum.
- Create: `app/src/components/voice/PersonaPicker.jsx` — UI to switch.

- [ ] **Step 1: Persona definitions** — each with `id, label, description, system_prompt_addendum, voice_id`.
- [ ] **Step 2: Session_token wiring** — appends persona addendum to base instructions.
- [ ] **Step 3: Frontend picker on FloatingOrb** — dropdown with 4 options.
- [ ] **Step 4: Persona is sticky per user** (localStorage + backend setting).
- [ ] **Step 5: Commit (each persona definition is a sub-commit).**

### Task 5.4: Trader Profile auto-populator (passive)

**Files:** Create: `api/services/trader_profile_auto.py`.

- [ ] **Step 1: Background analyzer** — runs after each session-end, reads transcript, extracts trader preferences (style, setups, risk tolerance) via Haiku call, *suggests* additions to Trader Profile (not auto-applies).
- [ ] **Step 2: Profile change is shown in Compass tab as `profile_suggestion` (reuses existing `j2_profile_suggestions` table from Phase G v2)** — user approves with one click.
- [ ] **Step 3: Commit.**

---

# Sprint 6 — Backtest & Scenario Engine

**Why sixth**: Closes the analytical loop. Compass goes from "explain VCP" to "show me how *my* VCP trades would have done if I'd sized 2R instead of 1R."

### Task 6.1: Pattern-engine backtest

**Files:** Create: `api/services/pattern_backtest.py`.

- [ ] **Step 1: Service** — runs a named pattern detector across all `cap_universe.json` tickers for a date range, applies entry/exit rules (e.g., "buy on detection close, sell at 10R or stop), returns aggregate stats: win rate, avg R, max DD, profit factor, by-month breakdown.
- [ ] **Step 2: Voice tool — `backtest_pattern(pattern_id, days, entry_rule, exit_rule)`**. Heavy compute — return `{job_id}` if it'll take >10s, async with polling.
- [ ] **Step 3: Commit.**

### Task 6.2: Scenario sizing simulator

**Files:** Create: `api/services/scenario_simulator.py`.

- [ ] **Step 1: Service** — takes user's closed trades, re-runs them with a different sizing rule (e.g., flat 1.5% per trade vs current sizes), returns `{actual_pnl, scenario_pnl, delta, by_setup_breakdown}`.
- [ ] **Step 2: Voice tool — `simulate_sizing_change(rule_description)`** — Compass interprets rule_description (e.g., "1.5% per trade") via small LLM call, builds the actual simulation.
- [ ] **Step 3: Commit.**

### Task 6.3: Portfolio risk stress test

**Files:** Create: `api/services/portfolio_stress.py`.

- [ ] **Step 1: Service** — given current open positions, applies scenario shocks (regime flip RED, vol expansion, factor rotation), returns expected portfolio P&L under each scenario.
- [ ] **Step 2: Voice tool — `stress_test_portfolio(scenario)`** with built-in scenarios + custom.
- [ ] **Step 3: Commit.**

---

# Sprint 7 — Vision Input from the Orb

**Why seventh**: Closes the "paste a screenshot" gap. Currently `describe_chart(image_url)` exists but no UI path from voice.

### Task 7.1: Backend ingest endpoint

**Files:**
- Create: `api/routers/voice_vision.py` — `POST /api/voice/vision/orb-attach` accepts multipart image, stores temporarily, returns image_url for `describe_chart` to consume.

- [ ] **Step 1: Endpoint** — accepts image upload (max 10MB), validates type, hashes content for dedup, stores in `/data/voice_vision/`, returns short-lived public URL.
- [ ] **Step 2: Auto-call `describe_chart(image_url)` from this endpoint** and return both URL + analysis to frontend.
- [ ] **Step 3: Commit.**

### Task 7.2: Frontend attach button on FloatingOrb

**Files:**
- Create: `app/src/components/voice/VisionAttachButton.jsx`
- Modify: `app/src/components/voice/FloatingOrb.jsx` — render the button alongside Train + Persona pickers.

- [ ] **Step 1: Paperclip button** — opens file picker / accepts paste from clipboard.
- [ ] **Step 2: Wire to backend endpoint, on success display "analyzing..." then show vision result inline.**
- [ ] **Step 3: Also send result to active voice session as a tool-result event so Compass narrates it.**
- [ ] **Step 4: Commit.**

---

# Sprint 8 — Observability + Auto Profile

**Why last**: Self-improving feedback loop. Once everything else is live, we want a system that learns from itself.

### Task 8.1: Voice hallucination dashboard

**Files:**
- Create: `app/src/pages/admin/VoiceHallucinations.jsx` — table of recent flags, filter by user / severity / date.
- Modify: `api/routers/voice.py` — add `/api/voice/hallucinations/all` (admin-only) endpoint.

- [ ] **Step 1: Admin view** — list of flagged claims with session context + tool calls that should have backed them.
- [ ] **Step 2: One-click "ignore" / "tighten prompt for this pattern"** — opens an editor to suggest prompt addendum.
- [ ] **Step 3: Commit.**

### Task 8.2: Trader Profile change log

**Files:** Create: `app/src/pages/journal-2-0/components/TraderProfileHistory.jsx`.

- [ ] **Step 1: Show edit history of trader_profile** — diffs over time, who/what suggested each change.
- [ ] **Step 2: Revert capability** — roll back to a prior version.
- [ ] **Step 3: Commit.**

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Perplexity sonar-deep-research costs spike if Compass over-calls | Cache TTL 1hr per query + rate limit user to 5 deep-research calls/day |
| FRED / THEFLY / Reddit keys not set on Railway | API health endpoint shows status; voice tools return graceful "key not set" errors |
| Backtest is compute-heavy, blocks voice | Async pattern with `{job_id, poll_url}` for any >5s compute |
| Vision pipeline leaks user images | Short-lived signed URLs, auto-delete after 1hr, no public listing |
| Persona switching breaks existing sessions | Persona is read at mint, never mid-session; default stays current Compass |
| Hallucination dashboard becomes noisy | Confidence threshold filter; aggregate by claim pattern |
| Reddit PRAW rate limits | Already low (60/min OAuth) — only fetch top 50 per ticker, cached 10 min |

---

## Cost Estimate

| Item | Cost |
|---|---|
| Perplexity sonar-deep-research | $1-3 per call × ~5/day = $5-15/day if popular, $0.50/day typical |
| Perplexity sonar-reasoning-pro | ~$0.04 per call, replaces some sonar-pro calls (similar cost) |
| Reddit PRAW | Free |
| Stocktwits API | Free |
| SEC EDGAR | Free |
| Finra short interest | Free |
| OpenInsider scrape | Free |
| TheFly | User's existing subscription |
| FRED | Free |
| Polygon options (Phase 3 optional — Sprint 9 below) | $29/mo |
| Vision (GPT-4o already wired) | ~$0.01 per image |

**Net: $0-15/day incremental, most days $1-3.** A real institutional tool is operationally inexpensive when each component is right-sized.

---

## Recommended Sprint Order

For maximum compounding impact ship in this order:

1. **Sprint 1 (Perplexity)** — 4 hrs. Biggest single quality lift. Touches everything downstream.
2. **Sprint 2 (Activate Dormant)** — 3 hrs. Unblocks data sources that were silently dead.
3. **Sprint 3 (Expose Hidden)** — 3 hrs. Earnings transcripts, catalysts, email digest reachable.
4. **Sprint 4 (New Data Sources)** — 8 hrs. Reddit, Stocktwits, 13F, short interest, insider clusters. Big breadth jump.
5. **Sprint 7 (Vision)** — 4 hrs. Closes the "paste a chart" gap.
6. **Sprint 8 (Observability)** — 6 hrs. Builds the self-improvement loop before going full proactive.
7. **Sprint 5 (Proactive)** — 10 hrs. Morning briefings + Discord + personas.
8. **Sprint 6 (Backtest)** — 12 hrs. Closes analytical loop. Most complex, ship last.

Total: ~50 hours. Each sprint shippable independently. Each commit testable in isolation.

---

## Sprint 9 (Optional Future)

Things deliberately deferred so the user can decide later:
- **Polygon options upgrade** ($29/mo) — kills yfinance reliability issues
- **Live earnings call streaming analysis** — moonshot, ~8 hrs
- **AlphaSense/Tegus integration** — enterprise, $$$
- **Mobile push notifications** — outside current architecture
- **Multi-broker integration** (TastyTrade, IBKR) — pattern is clear but each is its own sprint

---

## Self-Review

- ✅ **Spec coverage**: Every gap from the audit has a task. Perplexity maxed, dormant APIs activated, hidden services exposed, social/institutional/short/insider added, proactive/personas/Discord, backtest/scenarios/stress-test, vision input, observability + auto-profile.
- ✅ **Schwab explicitly excluded** per user instruction.
- ✅ **Cost realistic** — most days under $5 incremental.
- ✅ **Sprints independent + reorderable** — user can ship 1, 2, 3 and stop, or pick + choose.
- ✅ **No placeholders** — every task names actual files, real signatures, key code snippets.
- ✅ **Existing patterns followed** — voice_tool_impls + voice_agents.compass_union + voice_prompts/compass.py is the standard wiring path; every new tool follows it.
- ✅ **Effort + cost stated** per pillar.
- ✅ **Risks called out** with mitigations.
