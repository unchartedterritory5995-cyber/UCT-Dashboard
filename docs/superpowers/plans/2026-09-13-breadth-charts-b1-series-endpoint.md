# Breadth Data Charts — B1 "series endpoint (dark)" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A long breadth history can be served without encoding thousands of 96-key rows on the event loop: a projected,
columnar, pre-encoded, cached `GET /api/breadth-monitor/series`, shipped dark behind `BREADTH_SERIES_ENDPOINT_ENABLED`.

**Architecture:** A sync FastAPI handler (it runs in the threadpool) reads `svc.get_history_deep` for the requested
session span, projects at most eight keys into columns, encodes with `json.dumps` once, caches the BYTES for five minutes
under the existing `breadth_history_` prefix so every snapshot write already invalidates them, and returns
`Response(content=bytes)` — FastAPI's `jsonable_encoder` never walks the payload (D-008, D-035). The flag is a dependency
declared BEFORE `require_paid`, read per request: unset answers 404 to everyone, anonymous included, exactly as if the
route did not exist. Dates are validated by the router's existing `_require_iso_date` — one validator, as its docstring
requires.

**Tech Stack:** FastAPI 0.115.6, SQLite service layer, pytest (scoped files only), `tests/authclients.py`.

**Spec:** `docs/breadth/01-audit.md` A-11 and "Long history"; D-008, D-035.

## Global Constraints

- Dark: `BREADTH_SERIES_ENDPOINT_ENABLED` unset or anything but `1` → 404, for anonymous and paid callers alike. Registered
  in `docs/feature_flags.json` → `flags` with `status: "dark"` in the same commit as the route (CLAUDE.md flag ledger).
- ⛔ Dependency ORDER is the dark guarantee. FastAPI 0.115.6 resolves a route's dependencies in declaration order
  (`fastapi/dependencies/utils.py:592`, `for sub_dependant in dependant.dependencies`), and the first to raise ends the
  request — so the flag dependency must be declared before `_user: dict = Depends(require_paid)`. The body runs after
  every dependency, so a flag check in the body would answer 401 to an anonymous caller and reveal a paid route.
- Paid route: the router's own `require_paid`; tests install identity with `authorize(app, PAID_MEMBER | FREE_MEMBER)`,
  never the gate.
- ⛔ Do not redefine `_ISO_DATE` in `api/routers/breadth_monitor.py`: `_require_iso_date` reads that module global at call
  time, so a second assignment further down the file would silently change the validator its neighbours use. Call
  `_require_iso_date`; add a calendar check beside it for `2026-13-01`-shaped input.
- Malformed input answers 400, matching `_require_iso_date` (`session-path`, `score-components`).
- No frontend change; nothing consumes the route until V2-3.
- Backend pytest is SCOPED to named files (CLAUDE.md); never `pytest tests/`.
- Watch coverage is classified before push (`python tools/flow_worker_watch_coverage.py`); an `api/**` push restarts web,
  worker and bars-api — on a weekend any time, otherwise per `docs/runbooks/deploy-windows.md`.
- No member data in the repo: fixtures are synthetic.

---

### Task 1: the route, projection and encoding

**Files:** Modify `api/routers/breadth_monitor.py`, `docs/feature_flags.json`; Create `tests/test_breadth_series_endpoint.py`

- [ ] **Step 1: failing tests** `tests/test_breadth_series_endpoint.py`

```python
"""GET /api/breadth-monitor/series — projected, columnar, pre-encoded, dark (B1, D-008, D-035).

The existing /api/breadth-monitor answers with ~96 keys per row and no response
model, so FastAPI walks the whole payload through `jsonable_encoder` on the event
loop — measured locally at 438 ms for 3,650 rows. A chart needs at most eight keys.
"""
import inspect
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize

ROWS_NEWEST_FIRST = [
    {"date": "2026-01-06", "breadth_score": 61.2, "vix": 17.0, "cboe_putcall": None},
    {"date": "2026-01-05", "breadth_score": 58.0, "vix": 18.5, "cboe_putcall": 0.91},
    {"date": "2025-12-31", "breadth_score": float("nan"), "vix": 19.1, "_reconstructed": True},
    {"date": "2025-12-30", "breadth_score": 55.5, "vix": 20.2, "_reconstructed": True},
]
DATES = ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-05", "2026-01-06", "2026-01-07"]


class _Cache:
    def __init__(self):
        self.store = {}

    def get(self, k):
        return self.store.get(k)

    def set(self, k, v, ttl=None):
        self.store[k] = v

    def delete_prefix(self, p):
        for k in [k for k in self.store if k.startswith(p)]:
            del self.store[k]


@pytest.fixture
def setup(monkeypatch):
    from api.routers import breadth_monitor as rt
    from api.services import breadth_monitor as svc
    import api.services.cache as cache_mod

    calls = {"deep": []}

    def deep(days, end=None, anchor="le"):
        calls["deep"].append((days, end, anchor))
        return [dict(r) for r in ROWS_NEWEST_FIRST]

    monkeypatch.setattr(svc, "get_history_deep", deep)
    monkeypatch.setattr(svc, "merged_dates", lambda: list(DATES))
    fake = _Cache()
    monkeypatch.setattr(cache_mod, "cache", fake)
    monkeypatch.setenv("BREADTH_SERIES_ENDPOINT_ENABLED", "1")

    def client_as(user=PAID_MEMBER):
        app = FastAPI()
        app.include_router(rt.router)
        if user is not None:
            authorize(app, user)
        return TestClient(app)

    return client_as, calls, fake, rt


URL = "/api/breadth-monitor/series?keys=breadth_score,vix,nope&from=2025-12-30&to=2026-01-06"


def test_dark_unless_the_flag_is_on_read_per_request(setup, monkeypatch):
    client_as, *_ = setup
    paid, anonymous = client_as(), client_as(None)
    monkeypatch.delenv("BREADTH_SERIES_ENDPOINT_ENABLED")
    assert paid.get(URL).status_code == 404
    # The flag answers before the gate, so a dark route cannot be probed as a paid one.
    assert anonymous.get(URL).status_code == 404
    monkeypatch.setenv("BREADTH_SERIES_ENDPOINT_ENABLED", "0")
    assert paid.get(URL).status_code == 404
    monkeypatch.setenv("BREADTH_SERIES_ENDPOINT_ENABLED", "1")
    assert paid.get(URL).status_code == 200


def test_the_gate_still_runs_once_the_route_is_on(setup):
    client_as, *_ = setup
    assert client_as(None).get(URL).status_code == 401
    assert client_as(FREE_MEMBER).get(URL).status_code == 402


def test_columns_oldest_first_only_the_keys_asked_for(setup):
    client_as, calls, *_ = setup
    body = client_as().get(URL).json()
    assert body["dates"] == ["2025-12-30", "2025-12-31", "2026-01-05", "2026-01-06"]
    assert body["series"] == {"breadth_score": [55.5, None, 58.0, 61.2], "vix": [20.2, 19.1, 18.5, 17.0]}
    assert body["reconstructed"] == [True, True, False, False]
    assert body["missing"] == ["nope"]
    assert body["sessions"] == 4
    # the span is counted in stored sessions and anchored on `to`
    assert calls["deep"] == [(4, "2026-01-06", "le")]


def test_non_finite_values_are_null_and_the_bytes_are_the_compact_encoding(setup):
    client_as, *_ = setup
    r = client_as().get(URL)
    assert r.headers["content-type"].startswith("application/json")
    assert "NaN" not in r.text
    assert r.content == json.dumps(r.json(), separators=(",", ":")).encode()
    assert r.headers["cache-control"] == "private, max-age=60"


def test_cached_as_bytes_under_the_history_prefix_so_snapshot_writes_clear_it(setup):
    client_as, calls, fake, _ = setup
    c = client_as()
    c.get(URL)
    c.get(URL)
    assert len(calls["deep"]) == 1
    keys = list(fake.store)
    assert len(keys) == 1 and keys[0].startswith("breadth_history_series_")
    assert isinstance(fake.store[keys[0]], bytes)
    fake.delete_prefix("breadth_history_")          # what store_snapshot / patch_field / delete do today
    c.get(URL)
    assert len(calls["deep"]) == 2


@pytest.mark.parametrize("query", [
    "keys=a,b,c,d,e,f,g,h,i&from=2025-12-30&to=2026-01-06",    # nine keys
    "keys=&from=2025-12-30&to=2026-01-06",                     # none
    "keys=vix;drop&from=2025-12-30&to=2026-01-06",             # not a key
    "keys=vix&from=2026-13-01&to=2026-01-06",                  # right shape, not a date
    "keys=vix&from=Dec 30&to=2026-01-06",                       # wrong shape
    "keys=vix&from=2026-01-06&to=2025-12-30",                  # reversed
])
def test_refuses_what_it_cannot_answer_with_the_routers_400(setup, query):
    client_as, *_ = setup
    assert client_as().get(f"/api/breadth-monitor/series?{query}").status_code == 400


# CONTROL: the neighbouring validator is untouched by the new route.
def test_the_existing_date_validator_still_refuses_a_bad_path_date(setup):
    *_, rt = setup
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        rt._require_iso_date("2026-1-6")
    assert e.value.status_code == 400
    assert rt._require_iso_date("2026-01-06") == "2026-01-06"


def test_an_empty_span_is_an_empty_answer_not_an_error(setup):
    client_as, calls, *_ = setup
    body = client_as().get("/api/breadth-monitor/series?keys=vix&from=2024-01-01&to=2024-02-01").json()
    assert body["dates"] == [] and body["series"] == {"vix": []} and body["sessions"] == 0
    assert calls["deep"] == []


def test_encodes_in_the_threadpool_not_on_the_event_loop(setup):
    *_, rt = setup
    assert not inspect.iscoroutinefunction(rt.get_breadth_series)


def test_the_flag_is_in_the_ledger_as_dark():
    ledger = json.load(open("docs/feature_flags.json", encoding="utf-8"))
    entry = ledger["flags"]["BREADTH_SERIES_ENDPOINT_ENABLED"]
    assert entry["status"] == "dark" and entry["where"] == ["web"]
```

- [ ] **Step 2:** `python -m pytest tests/test_breadth_series_endpoint.py -q` → FAIL (404 everywhere / KeyError)

- [ ] **Step 3: implement** in `api/routers/breadth_monitor.py`.

Imports — the module has `hmac`, `os`, `re`, `threading` and `from fastapi import APIRouter, Depends, HTTPException, Query, Request`;
add `import json`, `import math`, `from datetime import datetime` and `from fastapi.responses import Response`.

Directly above `@router.get("/api/breadth-monitor")`:

```python
_SERIES_MAX_KEYS = 8
_SERIES_KEY = re.compile(r"[a-z0-9_]{1,64}")


def _require_series_enabled() -> None:
    """Dark until BREADTH_SERIES_ENDPOINT_ENABLED=1, read per request (no redeploy to flip).

    ⛔ A DEPENDENCY, DECLARED BEFORE `require_paid`, NOT A CHECK IN THE BODY. FastAPI
    resolves dependencies in declaration order and runs the body last, so a body check
    would let `require_paid` answer 401 to an anonymous caller — announcing a paid route
    that is meant not to exist yet. Unset answers 404 to everyone.
    """
    if os.environ.get("BREADTH_SERIES_ENDPOINT_ENABLED", "") != "1":
        raise HTTPException(status_code=404, detail="Not Found")


def _calendar_date(value: str) -> str:
    """`_require_iso_date` for the shape, then the calendar — 2026-13-01 has the shape."""
    _require_iso_date(value)
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return value


def _finite(v):
    return v if not isinstance(v, float) or math.isfinite(v) else None


@router.get("/api/breadth-monitor/series")
def get_breadth_series(_dark: None = Depends(_require_series_enabled),
                       keys: str = Query(default=""),
                       from_: str = Query(default="", alias="from"),
                       to: str = Query(default=""),
                       _user: dict = Depends(require_paid)):
    """Projected, columnar history for at most eight metrics (B1, D-008, D-035).

    ⛔ SYNC ON PURPOSE. `get_breadth_history` returns a dict of ~96-key rows with no
    response model, so FastAPI runs `jsonable_encoder` over it on the event loop —
    438 ms at 3,650 rows, measured locally. This handler runs in the threadpool,
    keeps only the requested keys as columns, encodes once, and caches the BYTES under
    the `breadth_history_` prefix, which every snapshot write already clears.
    """
    wanted = [k for k in (keys or "").split(",") if k]
    if not wanted or len(wanted) > _SERIES_MAX_KEYS or not all(_SERIES_KEY.fullmatch(k) for k in wanted):
        raise HTTPException(status_code=400, detail=f"keys must be 1 to {_SERIES_MAX_KEYS} metric keys")
    start, end = _calendar_date(from_), _calendar_date(to)
    if start > end:
        raise HTTPException(status_code=400, detail="from must not be after to")

    from api.services.cache import cache
    ck = f"breadth_history_series_{','.join(wanted)}_{start}_{end}"
    body = cache.get(ck)
    if body is None:
        span = [d for d in svc.merged_dates() if start <= d <= end]
        rows = list(reversed(svc.get_history_deep(len(span), end=end, anchor="le"))) if span else []
        rows = [r for r in rows if start <= r.get("date", "") <= end]
        present = {k for r in rows for k in r}
        payload = {
            "from": start, "to": end, "sessions": len(rows),
            "dates": [r["date"] for r in rows],
            "series": {k: [_finite(r.get(k)) for r in rows] for k in wanted if not rows or k in present},
            "reconstructed": [bool(r.get("_reconstructed")) for r in rows],
            "missing": [k for k in wanted if rows and k not in present],
        }
        body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
        cache.set(ck, body, ttl=300)
    return Response(content=body, media_type="application/json",
                    headers={"Cache-Control": "private, max-age=60"})
```

`docs/feature_flags.json` → `flags` gains:

```json
"BREADTH_SERIES_ENDPOINT_ENABLED": {
  "status": "dark",
  "where": ["web"],
  "note": "B1 (docs/breadth D-008, D-035): GET /api/breadth-monitor/series, projected columnar pre-encoded history for the V2 Data Charts. Unset = 404 for every caller (a dependency ahead of require_paid). Read per request; no consumer until V2-3."
}
```

- [ ] **Step 4:** `python -m pytest tests/test_breadth_series_endpoint.py tests/test_breadth_history_direct_call.py tests/test_breadth_live_router.py tests/test_breadth_score_components.py -q` → PASS (totals line)
- [ ] **Step 5:** mutation proofs (restore by bytes): `_require_series_enabled` returns without raising (dark test fails) ·
  the `_dark` parameter moved after `_user` (the anonymous-dark assertion fails with 401) · drop `_finite` (NaN test
  fails) · cache key prefix `breadth_series_` (invalidation test fails) · `async def` (threadpool test fails) ·
  `len(wanted) > 9` (nine-keys case fails) · a module-level `_ISO_DATE = re.compile(r".*")` appended below the route (the
  neighbour-validator control fails — proving the constraint is railed).
- [ ] **Step 6:** commit router, test, ledger — "Breadth: a projected, pre-encoded series endpoint, dark (B1)"

---

### Task 2: measure it, gate, merge

- [ ] Local measurement (scratchpad script, synthetic DB of 3,650 sessions × 96 keys, both handlers called through
  `TestClient`): median wall time of `/api/breadth-monitor?days=3650` vs `/series` for 3 keys, 10 runs each, recorded in
  STATUS as measured-locally numbers, never as production.
- [ ] Six-shard frontend gate (frontend unchanged — expected identical set) and the scoped backend files above.
- [ ] `python tools/flow_worker_watch_coverage.py` → classify; merge origin/master; guarded push; web, worker and bars-api
  deployments reach SUCCESS; an anonymous request with a browser UA to
  `/api/breadth-monitor/series?keys=vix&from=2026-01-02&to=2026-01-05` → 404 (dark: the flag dependency answers before
  the paid gate).
- [ ] STATUS entry:

> **What members will see.** Nothing. A faster way to load long breadth history is built and switched off; the Data Charts
> redesign will use it.
