# UCT Dashboard Data Pipeline Design

**Date:** 2026-02-22

## Goal

Make the UCT Dashboard fully live and intelligent — real-time market data ticking in the browser, and AI-generated analysis (Leadership 20, Market Rundown) powered by the full UCT Intelligence knowledge base.

## Architecture

```
UCT Intelligence KB (3,711 records)
        ↓  context injection
Morning Wire Engine  →  Claude AI  →  wire_data.json
                                           ↓  POST /api/push
                              Railway Dashboard  ←  Massive API (live prices)
                                           ↓
                                      Browser
```

## Three Layers

### Layer 1 — UCT Intelligence → Morning Wire Engine

**Problem:** Morning wire engine calls Claude with basic market data only. The full UCT methodology, trader profiles, and setup library sit unused in the KB.

**Fix:** Before each Claude AI call, the engine queries UCT Intelligence:
- `search_knowledge(query)` — relevant setup + methodology entries per ticker
- `get_sector_momentum_context()` — sector rotation + breadth state
- `get_brain_context(query)` — full UCT methodology context

This context is injected into Claude prompts before generating leadership theses and the morning rundown. Claude thinks like UCT.

**Files touched:**
- `C:\Users\Patrick\morning-wire\morning_wire_engine.py`
- `C:\Users\Patrick\uct-intelligence\api.py` (add `get_brain_context()` if not present)

### Layer 2 — Morning Wire → Railway Push

**Problem:** wire_data.json is written locally after each engine run. Railway never sees it.

**Fix:**
- Add `POST /api/push` endpoint to Railway backend, secured with `PUSH_SECRET` env var
- After engine writes wire_data.json, it POSTs the full payload to `https://web-production-05cb6.up.railway.app/api/push`
- Railway stores each section in its cache (themes, leadership, breadth, rundown, earnings)
- All dashboard tiles populate immediately

**Files touched:**
- `C:\Users\Patrick\uct-dashboard\api\routers\push.py` (new)
- `C:\Users\Patrick\uct-dashboard\api\main.py` (register router)
- `C:\Users\Patrick\morning-wire\morning_wire_engine.py` (add push call at end of run())

### Layer 3 — Live Market Data on Railway

Railway fetches this independently — no engine needed, always live:

| Data | Source | Refresh |
|------|--------|---------|
| Prices / futures / ETFs | Massive API | Every 15s (already works) |
| Top movers | Massive API | Every 30s (already works) |
| News feed | Finnhub | Every 5 min |
| Earnings calendar | FMP | Daily |

## Security

- `PUSH_SECRET` env var set on Railway
- Engine sends `Authorization: Bearer <PUSH_SECRET>` header
- Railway rejects any push without valid secret

## Data Flow After Engine Run

1. Engine runs (7:35 AM ET weekdays, or manually triggered)
2. Engine fetches market data (Massive, Finnhub, FMP)
3. Engine queries UCT Intelligence KB for context
4. Engine calls Claude with enriched context → generates theses + rundown
5. Engine writes wire_data.json locally
6. Engine POSTs wire_data.json to Railway `/api/push`
7. Railway caches all sections (TTL 23 hours)
8. Dashboard tiles populate: Leadership 20, Theme Tracker, Breadth, Rundown, Earnings

## What "Live" Means Per Tile

| Tile | Update Frequency | Source |
|------|-----------------|--------|
| Market Snapshot | 15 seconds | Massive (Railway) |
| Top Movers | 30 seconds | Massive (Railway) |
| News | 5 minutes | Finnhub (Railway) |
| Theme Tracker | Daily (engine push) | wire_data.json |
| Breadth | Daily (engine push) | wire_data.json |
| UCT Leadership 20 | Daily (engine push) | wire_data.json + UCT KB |
| Morning Rundown | Daily (engine push) | wire_data.json + UCT KB |
| Earnings | Daily (engine push) | wire_data.json |
