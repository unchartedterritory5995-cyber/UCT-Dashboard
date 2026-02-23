# UCT Data Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire UCT Intelligence KB into Claude AI analysis, then push results to the Railway dashboard so it's always live with real UCT thinking.

**Architecture:** Morning Wire engine queries UCT Intelligence KB → injects context into Claude prompts → writes wire_data.json → POSTs to Railway `/api/push` → dashboard tiles populate. Live market data (prices, movers) already works on Railway via Massive API.

**Tech Stack:** Python (morning_wire_engine.py, uct_intelligence/api.py), FastAPI (Railway push endpoint), TTLCache (api/services/cache.py)

---

## Context: Key Files & Line Numbers

- `C:\Users\Patrick\uct-intelligence\uct_intelligence\api.py` — 1,734 lines. Has `get_knowledge_context()`, `get_sector_momentum_context()`, `get_ep_tracking_context()`. No `get_brain_context()` yet.
- `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — Already imports `uct_intelligence.api as uct_brain`. Key lines:
  - Line 2695: `generate_leadership_theses(self, stocks)` — calls `uct_brain.get_ep_tracking_context()` already
  - Line 2419: `generate_rundown(self, data, ...)` — builds 7-section rundown HTML
  - Line 3268: `data["leadership"] = fetch_leadership(analyst)`
  - Line 3338: `full_rundown_html = build_rundown_html(..., narrative_html)`
  - Line 3651: wire_data.json is written here — **push call goes right after this**
- `C:\Users\Patrick\uct-dashboard\api\services\cache.py` — `TTLCache` with `get()` and `set()` only
- `C:\Users\Patrick\uct-dashboard\api\main.py` — imports all routers and includes them via `app.include_router()`

---

## Task 1: Add `get_brain_context()` to UCT Intelligence API

**Files:**
- Modify: `C:\Users\Patrick\uct-intelligence\uct_intelligence\api.py` (add at end of file)
- Test: `C:\Users\Patrick\uct-intelligence\tests\test_brain_context.py` (create)

**Step 1: Write the failing test**

Create `C:\Users\Patrick\uct-intelligence\tests\test_brain_context.py`:

```python
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import uct_intelligence.api as api

def test_get_brain_context_returns_string():
    result = api.get_brain_context()
    assert isinstance(result, str)

def test_get_brain_context_with_setup_types():
    result = api.get_brain_context(setup_types=["VCP", "EP"])
    assert isinstance(result, str)

def test_get_brain_context_not_empty_when_kb_has_data():
    # Add one KB record first so we know KB is non-empty
    api.add_knowledge(
        category="TEST",
        title="Test rule",
        content="Always cut losses at 7-8%.",
        priority=1,
        tags=["test"]
    )
    result = api.get_brain_context()
    assert len(result) > 0
```

**Step 2: Run test to verify it fails**

```bash
cd C:\Users\Patrick\uct-intelligence
python -m pytest tests/test_brain_context.py -v
```
Expected: FAIL with `AttributeError: module has no attribute 'get_brain_context'`

**Step 3: Add `get_brain_context()` to api.py**

Open `C:\Users\Patrick\uct-intelligence\uct_intelligence\api.py` and add this function at the very end of the file:

```python
def get_brain_context(
    regime: str = None,
    setup_types: list = None,
    max_chars: int = 2000,
) -> str:
    """Compose a single AI-ready context string from all UCT KB sources.

    Combines knowledge base entries, sector momentum, and EP tracking
    into one block ready for Claude system prompt injection.

    Args:
        regime: Current market regime (e.g. "GREEN", "YELLOW") for KB filtering
        setup_types: List of setup types present (e.g. ["VCP", "EP"]) for KB filtering
        max_chars: Approximate max total characters to return

    Returns:
        Formatted multi-section string, empty string if all sources empty.
    """
    parts = []
    per_section = max_chars // 3

    kb = get_knowledge_context(
        regime=regime,
        setup_types=setup_types,
        max_chars=per_section,
    )
    if kb:
        parts.append(f"=== UCT KNOWLEDGE BASE ===\n{kb}")

    sector = get_sector_momentum_context(lookback_days=10)
    if sector:
        parts.append(f"=== SECTOR MOMENTUM ===\n{sector}")

    ep = get_ep_tracking_context()
    if ep:
        parts.append(f"=== EP TRACKING ===\n{ep}")

    return "\n\n".join(parts)
```

**Step 4: Run tests to verify they pass**

```bash
cd C:\Users\Patrick\uct-intelligence
python -m pytest tests/test_brain_context.py -v
```
Expected: 3 tests PASS

**Step 5: Commit**

```bash
cd C:\Users\Patrick\uct-intelligence
git add uct_intelligence/api.py tests/test_brain_context.py
git commit -m "feat: add get_brain_context() — composes KB + sector + EP context for Claude injection"
```

---

## Task 2: Inject UCT KB Context into Leadership Theses Generation

The `generate_leadership_theses()` method at line 2695 already calls `uct_brain.get_ep_tracking_context()`. We add `get_brain_context()` alongside it and inject into the system prompt.

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` (~line 2695–2755)

**Step 1: Find the exact injection point**

Open `morning_wire_engine.py`. Go to line 2695 (`generate_leadership_theses`). The method currently starts with:

```python
def generate_leadership_theses(self, stocks):
    ...
    repeat_leaders = uct_brain.get_repeat_leaders(lookback_days=10)
    repeat_set = set(repeat_leaders)
    _ep_ctx = uct_brain.get_ep_tracking_context()
```

And the system prompt starts a few lines later (around line 2716):

```python
    system = (
        "You are a master trader synthesizing the world's greatest momentum trading frameworks:\n"
        ...
    )
```

**Step 2: Add KB context fetch after `_ep_ctx` line**

Find this exact block in `generate_leadership_theses()`:

```python
    _ep_ctx = uct_brain.get_ep_tracking_context()
```

Add these two lines immediately after it:

```python
    _kb_ctx = uct_brain.get_brain_context(setup_types=None, max_chars=1500)
    _sector_ctx = uct_brain.get_sector_momentum_context(lookback_days=10)
```

**Step 3: Inject into system prompt**

Find the closing of the `system = (...)` string in `generate_leadership_theses()`. It ends with something like:

```python
        "Output: JSON array only..."
    )
```

Change the closing to append the KB context block:

```python
        "Output: JSON array only..."
        + (f"\n\n{_kb_ctx}" if _kb_ctx else "")
        + (f"\n\nSECTOR ROTATION CONTEXT:\n{_sector_ctx}" if _sector_ctx else "")
    )
```

**Step 4: Smoke test — run engine in dry mode**

```bash
cd C:\Users\Patrick\morning-wire
python -c "
import morning_wire_engine as eng
import uct_intelligence.api as uct_brain
# Verify get_brain_context is callable and returns a string
ctx = uct_brain.get_brain_context()
print('KB context chars:', len(ctx))
print('First 200 chars:', ctx[:200])
"
```
Expected: prints character count and a snippet of KB content (or 0 chars if KB is empty — that's fine)

**Step 5: Commit**

```bash
cd C:\Users\Patrick\morning-wire
git add morning_wire_engine.py
git commit -m "feat: inject UCT Intelligence KB context into leadership theses generation"
```

---

## Task 3: Inject UCT KB Context into Morning Rundown Generation

The `generate_rundown()` method at line 2419 already accepts `ep_tracking` as a parameter. We add `kb_context` the same way.

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` (~lines 2419, 2510, 3327–3338)

**Step 1: Add `kb_context` parameter to `generate_rundown()` signature**

Find line 2419:
```python
def generate_rundown(self, data, regime=None, breadth=None, risk_apt=None,
                     stockbee=None, exposure=None, futures=None,
                     perplexity_context=None, earnings_highlights=None,
                     repeat_leaders=None, ep_tracking=None):
```

Change to:
```python
def generate_rundown(self, data, regime=None, breadth=None, risk_apt=None,
                     stockbee=None, exposure=None, futures=None,
                     perplexity_context=None, earnings_highlights=None,
                     repeat_leaders=None, ep_tracking=None, kb_context=None):
```

**Step 2: Inject `kb_context` into the system prompt inside `generate_rundown()`**

Inside `generate_rundown()`, find where the `system` variable is built (around line 2510). It will look like:

```python
    system = "You are UCT's morning wire analyst..."
```
or similar. Find the end of this system string and append:

```python
    system += ("\n\n" + kb_context) if kb_context else ""
```

Add this line immediately after the `system = ...` assignment.

**Step 3: Pass `kb_context` in the `generate_rundown()` call in `run()`**

Find line ~3327 in `run()` where `analyst.generate_rundown(...)` is called. It currently ends with:

```python
                                              ep_tracking=_ep_tracking_ctx or None)
```

Change to:

```python
                                              ep_tracking=_ep_tracking_ctx or None,
                                              kb_context=uct_brain.get_brain_context(max_chars=2000) or None)
```

**Step 4: Smoke test**

```bash
cd C:\Users\Patrick\morning-wire
python -c "
from morning_wire_engine import AIAnalyst
import os
from pathlib import Path

# Load env
config = {}
for line in Path('.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        config[k.strip()] = v.strip()

analyst = AIAnalyst(config.get('ANTHROPIC_API_KEY', ''))
print('AIAnalyst created OK')
print('generate_rundown signature:', analyst.generate_rundown.__code__.co_varnames[:15])
"
```
Expected: prints signature showing `kb_context` in the variable names

**Step 5: Commit**

```bash
cd C:\Users\Patrick\morning-wire
git add morning_wire_engine.py
git commit -m "feat: inject UCT Intelligence KB context into morning rundown generation"
```

---

## Task 4: Add Railway Push Endpoint

**Files:**
- Create: `C:\Users\Patrick\uct-dashboard\api\routers\push.py`
- Modify: `C:\Users\Patrick\uct-dashboard\api\services\cache.py` (add `invalidate()`)
- Modify: `C:\Users\Patrick\uct-dashboard\api\main.py` (register router)
- Create: `C:\Users\Patrick\uct-dashboard\tests\test_push.py`

**Step 1: Add `invalidate()` to TTLCache**

Open `C:\Users\Patrick\uct-dashboard\api\services\cache.py`. After the `set()` method, add:

```python
    def invalidate(self, key: str) -> None:
        """Remove a key from the cache immediately."""
        self._store.pop(key, None)
```

**Step 2: Write the failing test**

Create `C:\Users\Patrick\uct-dashboard\tests\test_push.py`:

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
import os

os.environ["PUSH_SECRET"] = "test-secret-123"

from api.main import app

client = TestClient(app)

SAMPLE_PAYLOAD = {
    "date": "2026-02-22",
    "rundown_html": "<p>Test rundown</p>",
    "leadership": [{"sym": "NVDA", "thesis": "AI leader"}],
    "themes": {"XLK": {"name": "Tech", "ticker": "XLK", "1W": 2.5, "1M": 5.0, "3M": 12.0}},
    "earnings": {"bmo": [], "amc": []},
}

def test_push_valid_secret_returns_ok():
    resp = client.post(
        "/api/push",
        json=SAMPLE_PAYLOAD,
        headers={"Authorization": "Bearer test-secret-123"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

def test_push_invalid_secret_returns_401():
    resp = client.post(
        "/api/push",
        json=SAMPLE_PAYLOAD,
        headers={"Authorization": "Bearer wrong-secret"},
    )
    assert resp.status_code == 401

def test_push_no_secret_returns_401():
    resp = client.post("/api/push", json=SAMPLE_PAYLOAD)
    assert resp.status_code == 401

def test_push_data_accessible_via_leadership_endpoint():
    # Push data
    client.post(
        "/api/push",
        json=SAMPLE_PAYLOAD,
        headers={"Authorization": "Bearer test-secret-123"},
    )
    # Now leadership endpoint should return the pushed data
    resp = client.get("/api/leadership")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
```

**Step 3: Run tests to verify they fail**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_push.py -v
```
Expected: FAIL with `404 Not Found` (router doesn't exist yet)

**Step 4: Create the push router**

Create `C:\Users\Patrick\uct-dashboard\api\routers\push.py`:

```python
# api/routers/push.py
import os
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from api.services.cache import cache

router = APIRouter()

PUSH_KEYS = ["wire_data", "breadth", "themes_1W", "themes_1M", "themes_3M",
             "leadership", "rundown", "earnings", "screener"]


@router.post("/api/push")
def push_wire_data(
    payload: dict,
    authorization: Optional[str] = Header(None),
):
    """Receive wire_data.json from the local morning wire engine.

    Secured with PUSH_SECRET env var. Stores payload in cache so all
    engine_data endpoints serve the fresh data immediately.
    """
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Invalidate all derived caches so they recompute from new wire_data
    for key in PUSH_KEYS:
        cache.invalidate(key)

    # Store the full payload as wire_data (TTL 23 hours — refreshed daily by engine)
    cache.set("wire_data", payload, ttl=82800)

    return {"ok": True, "date": payload.get("date", "")}
```

**Step 5: Register the router in main.py**

Open `C:\Users\Patrick\uct-dashboard\api\main.py`. Find:

```python
from api.routers import snapshot, movers, engine_data, earnings, news, screener, trades, traders
```

Change to:

```python
from api.routers import snapshot, movers, engine_data, earnings, news, screener, trades, traders, push
```

Then find the block of `app.include_router(...)` calls and add:

```python
app.include_router(push.router)
```

**Step 6: Run tests to verify they pass**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_push.py -v
```
Expected: 4 tests PASS

**Step 7: Run full backend test suite**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/ -v
```
Expected: all existing tests + 4 new push tests PASS

**Step 8: Commit and push to Railway**

```bash
cd C:\Users\Patrick\uct-dashboard
git add api/routers/push.py api/services/cache.py api/main.py tests/test_push.py
git commit -m "feat: add POST /api/push endpoint — receives wire_data from local engine"
git push origin master
```

**Step 9: Add PUSH_SECRET to Railway env vars**

1. Go to Railway dashboard → your service → Variables
2. Add: `PUSH_SECRET` = any strong secret string (e.g. `uct-push-2026-secure`)
3. Railway will redeploy automatically

---

## Task 5: Add Push Call to Morning Wire Engine

After wire_data.json is written (line ~3651 in `run()`), POST it to Railway.

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` (~line 3651)
- Modify: `C:\Users\Patrick\morning-wire\.env` (add PUSH_SECRET)

**Step 1: Add PUSH_SECRET to the morning wire .env**

Open `C:\Users\Patrick\morning-wire\.env` and add:

```
PUSH_SECRET=uct-push-2026-secure
```

(Use the same value you set on Railway in Task 4 Step 9.)

**Step 2: Find the wire_data.json write block**

In `morning_wire_engine.py`, find the block that ends with:

```python
    with open(os.path.join(_data_dir, "wire_data.json"), "w", encoding="utf-8") as _f:
        _json.dump(_wire_data, _f, indent=2)
    print("[API] Wire data saved to data/wire_data.json")
```

**Step 3: Add the push call immediately after that print statement**

```python
    # Push wire_data to Railway dashboard
    _push_url = config.get("DASHBOARD_URL", "").rstrip("/")
    _push_secret = config.get("PUSH_SECRET", "")
    if _push_url and _push_secret:
        try:
            _push_resp = requests.post(
                f"{_push_url}/api/push",
                json=_wire_data,
                headers={"Authorization": f"Bearer {_push_secret}"},
                timeout=15,
            )
            print(f"[API] Dashboard push: {_push_resp.status_code} — {_push_url}")
        except Exception as _push_err:
            print(f"[API] Dashboard push failed (non-fatal): {_push_err}")
    else:
        print("[API] Dashboard push skipped — DASHBOARD_URL or PUSH_SECRET not set")
```

**Step 4: Smoke test the push manually**

With Railway deployed (from Task 4), test the push from your machine:

```bash
cd C:\Users\Patrick\morning-wire
python -c "
import requests, json

# Load env
config = {}
for line in open('.env').read().splitlines():
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        config[k.strip()] = v.strip()

import json as _j
sample = _j.load(open('data/wire_data.json'))
url = config.get('DASHBOARD_URL', '').rstrip('/')
secret = config.get('PUSH_SECRET', '')
print(f'Pushing to {url}/api/push ...')
r = requests.post(
    f'{url}/api/push',
    json=sample,
    headers={'Authorization': f'Bearer {secret}'},
    timeout=15
)
print(f'Response: {r.status_code} — {r.json()}')
"
```
Expected: `Response: 200 — {'ok': True, 'date': '2026-02-22'}`

Then open the dashboard in your browser and check that Leadership 20, Theme Tracker, and Morning Rundown all show data.

**Step 5: Commit**

```bash
cd C:\Users\Patrick\morning-wire
git add morning_wire_engine.py
git commit -m "feat: auto-push wire_data to Railway dashboard after engine run"
```

---

## Verification: End-to-End Test

After all 5 tasks are done:

1. Run the morning wire engine:
   ```bash
   cd C:\Users\Patrick\morning-wire
   python morning_wire_engine.py
   ```

2. Watch the output — you should see:
   ```
   AI: Generating Leadership 20 theses...
   AI: Generating The Rundown...
   [API] Wire data saved to data/wire_data.json
   [API] Dashboard push: 200 — https://web-production-05cb6.up.railway.app
   ```

3. Open `https://web-production-05cb6.up.railway.app` — Leadership 20, Theme Tracker, Breadth, and Morning Rundown should all show today's data powered by the full UCT Intelligence KB.
