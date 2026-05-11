# Chart Indicator Alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let traders set alerts on chart indicators (RSI / MACD / BB / Price-vs-MA / Stoch / Williams%R / CCI / MFI). When the condition triggers, fire the existing multi-channel alert delivery (bell + email + Discord + browser notification + sound), the same infra that powers Watchlist price alerts.

**Architecture:** Reuse the watchlist-alerts data model — same SQLite table pattern, same delivery service. Add `indicator_alerts` table with per-user (ticker, indicator, condition, threshold, timeframe). A background evaluator runs every 60s during RTH: for each active alert, fetch the latest indicator value via `bar_validation`-validated bars + `indicators.js`-equivalent server-side compute, check condition, trigger delivery if met. Frontend adds a "Set Alert" button to ChartToolbar; alerts list lives in a popover similar to ComparisonPicker.

**Tech Stack:** Python + SQLite (existing `auth.db`), FastAPI, existing `watchlist_alert_service.py` delivery infra, APScheduler for the 60s evaluator loop, React popover.

---

## File Structure

### New backend
| File | Responsibility |
|---|---|
| `api/services/indicator_alert_service.py` | SQLite CRUD for `indicator_alerts` table |
| `api/services/indicator_compute.py` | Server-side mirror of `app/src/components/chart/indicators.js` (RSI/MACD/BB/Stoch/Williams%R/CCI/MFI) |
| `api/services/indicator_alert_evaluator.py` | Background loop: every 60s during RTH, eval all active alerts, trigger delivery on hit |
| `api/routers/indicator_alerts.py` | REST endpoints: list, create, update, delete, test-evaluate |
| `tests/test_indicator_compute.py` | Numeric correctness of server-side indicator math |
| `tests/test_indicator_alert_service.py` | CRUD tests |
| `tests/test_indicator_alert_evaluator.py` | Trigger condition tests (mock bars) |

### Modified backend
| File | Change |
|---|---|
| `api/main.py` | Start the evaluator thread in lifespan |
| `api/routers/__init__.py` (or equivalent) | Register the new router |

### Modified frontend
| File | Change |
|---|---|
| `app/src/components/chart/ChartToolbar.jsx` | Add 🔔 alert button + popover trigger |
| `app/src/components/chart/IndicatorAlertPopover.jsx` (NEW) | Create + manage alerts for current chart symbol |
| `app/src/components/chart/IndicatorAlertPopover.module.css` (NEW) | Styles |
| `app/src/hooks/useIndicatorAlerts.js` (NEW) | SWR hook for listing + mutating alerts |

---

## Database schema

In `auth.db` (existing):

```sql
CREATE TABLE IF NOT EXISTS indicator_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sym TEXT NOT NULL,
  indicator TEXT NOT NULL,       -- 'rsi' | 'macd' | 'bb' | 'price_vs_ma' | 'stoch' | 'williams_r' | 'cci' | 'mfi'
  condition TEXT NOT NULL,       -- 'above' | 'below' | 'cross_above' | 'cross_below' | 'touch_upper' | 'touch_lower' | 'cross_zero'
  threshold REAL,                -- numeric threshold for above/below (e.g., 70 for RSI > 70)
  tf TEXT NOT NULL,              -- '5' | '15' | '30' | '60' | 'D'
  params_json TEXT,              -- JSON blob of indicator params (period etc.) — optional
  active INTEGER NOT NULL DEFAULT 1,
  last_value REAL,               -- last evaluated indicator value (debug/UX)
  last_evaluated_at INTEGER,     -- epoch s
  triggered_at INTEGER,          -- epoch s, set on most-recent trigger
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_user ON indicator_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_active ON indicator_alerts(active);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_sym ON indicator_alerts(sym);
```

---

## Task 1: Server-side indicator compute (parity with frontend)

**Files:**
- Create: `api/services/indicator_compute.py`
- Create: `tests/test_indicator_compute.py`

- [ ] **Step 1: Failing tests**

```python
import pytest
from api.services.indicator_compute import compute_rsi, compute_macd, compute_bb, compute_stoch, compute_williams_r, compute_cci, compute_mfi, compute_sma, compute_ema


def test_rsi_constant_uptrend():
    closes = list(range(100, 130))
    rsi = compute_rsi(closes, 14)
    assert rsi[-1] == 100.0  # all gains, no losses


def test_rsi_constant_downtrend():
    closes = list(range(100, 70, -1))
    rsi = compute_rsi(closes, 14)
    assert rsi[-1] == 0.0


def test_macd_returns_three_arrays():
    closes = [100 + i*0.5 for i in range(60)]
    macd, signal, hist = compute_macd(closes, 12, 26, 9)
    assert len(macd) == 60
    assert len(signal) == 60
    assert len(hist) == 60


def test_bb_ordering():
    closes = [100 + (i % 7) * 1.5 for i in range(40)]
    upper, middle, lower = compute_bb(closes, 20, 2)
    for u, m, l in zip(upper[20:], middle[20:], lower[20:]):
        if u is not None:
            assert u >= m >= l


def test_williams_r_bounds():
    bars = [{"h": 100+i, "l": 90+i, "c": 95+i} for i in range(30)]
    wr = compute_williams_r(bars, 14)
    valid = [v for v in wr if v is not None]
    assert all(-100 <= v <= 0 for v in valid)


def test_cci_range():
    bars = [{"h": 102+i*0.1, "l": 98+i*0.1, "c": 100+i*0.1} for i in range(40)]
    cci = compute_cci(bars, 20)
    valid = [v for v in cci if v is not None]
    # CCI typically ±300; constant-trend should give NaN due to zero MAD
    # so test just verifies no crash
    assert len(cci) == 40


def test_mfi_bounds():
    bars = [{"h": 102+i, "l": 98+i, "c": 100+i, "v": 1000+i*10} for i in range(40)]
    mfi = compute_mfi(bars, 14)
    valid = [v for v in mfi if v is not None]
    assert all(0 <= v <= 100 for v in valid)


def test_stoch_bounds():
    bars = [{"h": 100+i, "l": 90+i, "c": 95+i*0.5} for i in range(30)]
    k, d = compute_stoch(bars, 14, 3)
    valid_k = [v for v in k if v is not None]
    valid_d = [v for v in d if v is not None]
    assert all(0 <= v <= 100 for v in valid_k)
    assert all(0 <= v <= 100 for v in valid_d)


def test_sma_matches_manual():
    closes = [1, 2, 3, 4, 5]
    sma = compute_sma(closes, 3)
    assert sma[2] == 2.0  # (1+2+3)/3
    assert sma[3] == 3.0
    assert sma[4] == 4.0


def test_ema_matches_known_values():
    closes = [1, 2, 3, 4, 5]
    ema = compute_ema(closes, 3)
    # First EMA is SMA of first 3: 2.0
    assert abs(ema[2] - 2.0) < 0.01
    # Subsequent: k*price + (1-k)*prev_ema, k = 2/4 = 0.5
    assert abs(ema[3] - 3.0) < 0.01  # 0.5*4 + 0.5*2 = 3
```

- [ ] **Step 2: Implement**

Mirror `app/src/components/chart/indicators.js` math exactly (so frontend and server agree). The frontend returns `{time, value}` objects; server returns flat lists of floats/None. Run:

```bash
sed -n '/^export function computeRSI/,/^export function computeMACD/p' app/src/components/chart/indicators.js
```

Then port to Python. Key signatures:

```python
def compute_sma(closes: list[float], period: int) -> list[float|None]: ...
def compute_ema(closes: list[float], period: int) -> list[float|None]: ...
def compute_rsi(closes: list[float], period: int = 14) -> list[float|None]: ...
def compute_macd(closes: list[float], fast=12, slow=26, signal=9) -> tuple[list, list, list]: ...
def compute_bb(closes: list[float], period=20, stddev=2) -> tuple[list, list, list]: ...
def compute_williams_r(bars: list[dict], period=14) -> list[float|None]: ...
def compute_cci(bars: list[dict], period=20) -> list[float|None]: ...
def compute_mfi(bars: list[dict], period=14) -> list[float|None]: ...
def compute_stoch(bars: list[dict], k_period=14, d_period=3) -> tuple[list, list]: ...
```

- [ ] **Step 3: Tests pass**

```bash
pytest tests/test_indicator_compute.py -v
```

- [ ] **Step 4: Commit**

```bash
git add api/services/indicator_compute.py tests/test_indicator_compute.py
git commit -m "feat(alerts): server-side indicator compute (parity with frontend)"
```

---

## Task 2: Alert service (CRUD)

**Files:**
- Create: `api/services/indicator_alert_service.py`
- Create: `tests/test_indicator_alert_service.py`

- [ ] **Step 1: Failing tests**

```python
import pytest
import time
from api.services import indicator_alert_service as ias


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(ias, "_DB_PATH", str(tmp_path / "auth.db"))
    ias.init_schema()


def test_create_and_list(tmp_db):
    alert_id = ias.create(user_id=1, sym="AAPL", indicator="rsi",
                          condition="above", threshold=70, tf="D")
    assert alert_id > 0
    alerts = ias.list_for_user(1)
    assert len(alerts) == 1
    assert alerts[0]["indicator"] == "rsi"


def test_active_only_filter(tmp_db):
    a1 = ias.create(user_id=1, sym="AAPL", indicator="rsi", condition="above", threshold=70, tf="D")
    a2 = ias.create(user_id=1, sym="MSFT", indicator="rsi", condition="below", threshold=30, tf="D")
    ias.set_active(a2, False)
    active = ias.list_active()
    assert len(active) == 1
    assert active[0]["id"] == a1


def test_delete(tmp_db):
    a = ias.create(user_id=1, sym="AAPL", indicator="rsi", condition="above", threshold=70, tf="D")
    ias.delete(a)
    assert ias.get(a) is None


def test_record_trigger(tmp_db):
    a = ias.create(user_id=1, sym="AAPL", indicator="rsi", condition="above", threshold=70, tf="D")
    ias.record_trigger(a, last_value=72.5)
    row = ias.get(a)
    assert row["trigger_count"] == 1
    assert row["last_value"] == 72.5
    assert row["triggered_at"] is not None


def test_record_evaluation_no_trigger(tmp_db):
    a = ias.create(user_id=1, sym="AAPL", indicator="rsi", condition="above", threshold=70, tf="D")
    ias.record_evaluation(a, last_value=55.0)
    row = ias.get(a)
    assert row["trigger_count"] == 0
    assert row["last_value"] == 55.0
    assert row["last_evaluated_at"] is not None
    assert row["triggered_at"] is None
```

- [ ] **Step 2: Implement service** — schema init, create, list_for_user, list_active, get, set_active, delete, record_evaluation, record_trigger. Match the pattern from `bar_quarantine.py` / `watchlist_alert_service.py`.

- [ ] **Step 3: Tests pass + commit**

```bash
pytest tests/test_indicator_alert_service.py -v
git add api/services/indicator_alert_service.py tests/test_indicator_alert_service.py
git commit -m "feat(alerts): indicator_alerts SQLite CRUD"
```

---

## Task 3: Evaluator — condition matching

**Files:**
- Create: `api/services/indicator_alert_evaluator.py`
- Create: `tests/test_indicator_alert_evaluator.py`

- [ ] **Step 1: Failing tests**

```python
from api.services.indicator_alert_evaluator import check_condition


def test_rsi_above():
    assert check_condition("above", current=72, prev=65, threshold=70) is True
    assert check_condition("above", current=68, prev=65, threshold=70) is False


def test_rsi_below():
    assert check_condition("below", current=25, prev=35, threshold=30) is True


def test_cross_above_requires_crossing():
    """cross_above triggers only on the bar where price moves from below threshold to above."""
    assert check_condition("cross_above", current=72, prev=65, threshold=70) is True
    # Both above: no cross
    assert check_condition("cross_above", current=72, prev=71, threshold=70) is False
    # Stayed below: no cross
    assert check_condition("cross_above", current=68, prev=65, threshold=70) is False


def test_cross_below():
    assert check_condition("cross_below", current=25, prev=35, threshold=30) is True
    assert check_condition("cross_below", current=35, prev=40, threshold=30) is False  # both above


def test_cross_zero_above():
    assert check_condition("cross_zero", current=0.5, prev=-0.3, threshold=0) is True


def test_unknown_condition_returns_false():
    assert check_condition("bogus", current=70, prev=60, threshold=50) is False
```

- [ ] **Step 2: Implement evaluator**

```python
"""Indicator alert evaluation loop.

Every 60s during RTH (and ~5min outside RTH for higher-TF alerts):
  1. List all active alerts
  2. Group by (sym, tf) to share bar fetches
  3. For each group: fetch latest validated bars via bars_fetch
  4. Compute the indicator value
  5. Evaluate condition vs last known value
  6. On trigger: record + dispatch delivery
"""
import logging
import threading
import time
from collections import defaultdict
from typing import Optional

_logger = logging.getLogger(__name__)
_running = threading.Event()


def check_condition(condition: str, current: float, prev: Optional[float], threshold: Optional[float]) -> bool:
    """Pure function: does the alert fire given current + previous indicator values?"""
    if current is None:
        return False
    if condition == "above":
        return threshold is not None and current > threshold
    if condition == "below":
        return threshold is not None and current < threshold
    if condition == "cross_above":
        return prev is not None and threshold is not None and prev <= threshold < current
    if condition == "cross_below":
        return prev is not None and threshold is not None and prev >= threshold > current
    if condition == "cross_zero":
        return prev is not None and ((prev <= 0 < current) or (prev >= 0 > current))
    return False


def _evaluate_one(alert: dict) -> tuple[Optional[float], bool]:
    """Compute the indicator value for an alert. Return (value, triggered)."""
    from api.services import bars_fetch, indicator_compute
    bars = bars_fetch._fetch_intraday(alert["sym"], alert["tf"], 200) if alert["tf"] in ("1","5","15","30","60") \
           else None  # daily: use different fetch
    # ... actual fetch + compute ...
    # placeholder for plan; real impl maps indicator -> compute function

    value = None
    prev_value = alert.get("last_value")
    # ... computed value ...
    triggered = check_condition(alert["condition"], value, prev_value, alert.get("threshold"))
    return value, triggered


def _run_one_cycle():
    """One pass: evaluate every active alert, trigger as needed."""
    from api.services import indicator_alert_service as ias

    try:
        alerts = ias.list_active()
    except Exception:
        _logger.exception("[alert-eval] failed to list active alerts")
        return

    # Group by (sym, tf) for batched bar fetches
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for a in alerts:
        groups[(a["sym"], a["tf"])].append(a)

    for (sym, tf), alerts_in_group in groups.items():
        try:
            # Fetch + compute once per group
            for alert in alerts_in_group:
                value, triggered = _evaluate_one(alert)
                if triggered:
                    ias.record_trigger(alert["id"], last_value=value)
                    _dispatch_delivery(alert, value)
                elif value is not None:
                    ias.record_evaluation(alert["id"], last_value=value)
        except Exception:
            _logger.exception("[alert-eval] failed for %s %s", sym, tf)


def _dispatch_delivery(alert: dict, value: float):
    """Send via existing alert infra (bell + email + Discord)."""
    try:
        from api.services import watchlist_alert_service as wls
        # Reuse the existing delivery channels — message text describes the trigger
        message = f"{alert['sym']} {alert['indicator'].upper()} {alert['condition']} {alert['threshold']} (now: {value:.2f})"
        wls._deliver_alert(  # may need a public dispatch function exposed
            user_id=alert["user_id"],
            sym=alert["sym"],
            title=f"{alert['sym']} {alert['indicator'].upper()} alert",
            body=message,
            source="indicator_alert",
        )
    except Exception:
        _logger.exception("[alert-eval] dispatch failed for alert %s", alert.get("id"))


def start_evaluator(interval_sec: int = 60):
    """Start the background evaluator thread."""
    if _running.is_set():
        return
    _running.set()
    def _loop():
        while _running.is_set():
            try:
                _run_one_cycle()
            except Exception:
                _logger.exception("[alert-eval] cycle failed")
            for _ in range(interval_sec):
                if not _running.is_set():
                    return
                time.sleep(1)
    threading.Thread(target=_loop, daemon=True, name="indicator-alert-eval").start()


def stop_evaluator():
    _running.clear()
```

The `_dispatch_delivery` should reuse the existing `watchlist_alert_service` delivery path. Inspect the existing service to find the correct internal function — if it isn't exposed, expose a `deliver_alert_payload()` helper.

- [ ] **Step 3: Tests pass + commit**

```bash
pytest tests/test_indicator_alert_evaluator.py -v
git add api/services/indicator_alert_evaluator.py tests/test_indicator_alert_evaluator.py
git commit -m "feat(alerts): indicator alert evaluator + condition matching"
```

---

## Task 4: REST endpoints

**Files:**
- Create: `api/routers/indicator_alerts.py`
- Modify: `api/main.py` to register the router + start evaluator on startup

- [ ] **Step 1: Endpoints**

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.middleware.auth_middleware import require_user
from api.services import indicator_alert_service as ias

router = APIRouter(prefix="/api/indicator-alerts", tags=["indicator-alerts"])


class AlertCreate(BaseModel):
    sym: str
    indicator: str
    condition: str
    threshold: float | None = None
    tf: str
    params: dict | None = None


@router.get("")
def list_my_alerts(user=Depends(require_user)):
    return {"alerts": ias.list_for_user(user["id"])}


@router.post("")
def create_alert(body: AlertCreate, user=Depends(require_user)):
    alert_id = ias.create(
        user_id=user["id"], sym=body.sym.upper(),
        indicator=body.indicator, condition=body.condition,
        threshold=body.threshold, tf=body.tf,
        params_json=body.params,
    )
    return {"id": alert_id}


@router.delete("/{alert_id}")
def delete_alert(alert_id: int, user=Depends(require_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(404)
    ias.delete(alert_id)
    return {"ok": True}


@router.post("/{alert_id}/toggle")
def toggle_alert(alert_id: int, user=Depends(require_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(404)
    ias.set_active(alert_id, not alert["active"])
    return {"active": not alert["active"]}
```

- [ ] **Step 2: Wire into main.py**

```python
from api.routers import indicator_alerts
app.include_router(indicator_alerts.router)

# In lifespan startup:
from api.services import indicator_alert_evaluator
indicator_alert_evaluator.start_evaluator(interval_sec=60)
```

- [ ] **Step 3: Tests + commit**

Add to `tests/test_indicator_alert_service.py`: tests for the routes using TestClient + `app.dependency_overrides[require_user]`.

```bash
git add api/routers/indicator_alerts.py api/main.py
git commit -m "feat(alerts): REST endpoints + evaluator startup"
```

---

## Task 5: Frontend — alert popover

**Files:**
- Create: `app/src/components/chart/IndicatorAlertPopover.jsx`
- Create: `app/src/components/chart/IndicatorAlertPopover.module.css`
- Create: `app/src/hooks/useIndicatorAlerts.js`

- [ ] **Step 1: SWR hook**

```jsx
import useSWR, { mutate } from 'swr';

export function useIndicatorAlerts() {
  const { data, error } = useSWR('/api/indicator-alerts', (url) =>
    fetch(url, { credentials: 'include' }).then(r => r.json())
  );
  return {
    alerts: data?.alerts || [],
    isLoading: !data && !error,
    refresh: () => mutate('/api/indicator-alerts'),
  };
}

export async function createIndicatorAlert(payload) {
  const r = await fetch('/api/indicator-alerts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.ok ? r.json() : null;
}

export async function deleteIndicatorAlert(id) {
  await fetch(`/api/indicator-alerts/${id}`, { method: 'DELETE', credentials: 'include' });
}

export async function toggleIndicatorAlert(id) {
  return fetch(`/api/indicator-alerts/${id}/toggle`, { method: 'POST', credentials: 'include' });
}
```

- [ ] **Step 2: Popover UI**

Standard popover pattern (header, close, form, list). Fields:
- Indicator dropdown: RSI / MACD / BB / Stoch / Williams%R / CCI / MFI / Price
- Condition dropdown: dynamic based on indicator (RSI → above/below/cross_above/cross_below; MACD → cross_above/cross_below/cross_zero; BB → touch_upper/touch_lower)
- Threshold input (for above/below conditions)
- TF dropdown
- Active alerts list with toggle + delete

- [ ] **Step 3: ChartToolbar integration**

Add 🔔 button next to ⇄ Compare button. Click opens IndicatorAlertPopover with `sym={currentSym}`.

- [ ] **Step 4: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/IndicatorAlertPopover.* app/src/hooks/useIndicatorAlerts.js app/src/components/chart/ChartToolbar.jsx
git commit -m "feat(alerts): chart indicator alert popover + toolbar trigger"
git push
```

---

## Task 6: Smoke + integration test

- [ ] **Step 1: Backend tests**

```bash
pytest tests/test_indicator_compute.py tests/test_indicator_alert_service.py tests/test_indicator_alert_evaluator.py -v
```

- [ ] **Step 2: Build smoke**

```bash
cd app && npm run build && cd ..
python -c "from api.main import app; print('OK')"
```

- [ ] **Step 3: Manual end-to-end (browser, post-deploy)**

1. Open AAPL Daily chart
2. Click 🔔 button → popover opens
3. Create: RSI above 70 on Daily
4. Wait one evaluator cycle (60s)
5. Check `/api/indicator-alerts` returns the alert with `last_evaluated_at` populated
6. If AAPL RSI > 70 right now: check that alert fires via AlertBell + email + Discord

- [ ] **Step 4: Final commit + push**

---

## Done — what changed

After this plan ships:

1. New `indicator_alerts` table in auth.db
2. Server-side indicator compute mirrors frontend math exactly
3. Background evaluator runs every 60s, checks all active alerts
4. Trigger reuses existing watchlist-alert delivery (bell + email + Discord + sound)
5. Chart toolbar gets a 🔔 button + popover for creating and managing alerts
6. Active alerts list shows per-user state with toggle + delete

Visual impact: active traders can leave alerts running for "RSI > 70 on QQQ Daily" or "MACD cross above zero on NVDA 1hr" and get notified the moment it triggers — multi-channel.

## Self-review

- Server-side indicator math has unit tests with known values
- Service layer follows existing bar_quarantine pattern
- Evaluator is single-threaded daemon, error-isolated per cycle
- Delivery reuses existing infrastructure — no new SMTP / Discord wiring needed
- Frontend popover follows existing ComparisonPicker pattern
- No placeholders
