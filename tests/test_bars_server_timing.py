"""Server-Timing / serve-layer diagnostics for /api/bars.

The cold bars path was previously unmeasured (all prod latency samples were warm
megacaps). _get_bars_inner now tags which cache tier served the request, and the
router emits it on a Server-Timing header so cold vs warm (and cold-fetch vs
inflight-wait vs disk) is observable in prod. These tests pin the tagging.
"""
from unittest.mock import patch

import pytest

from api.services import bars_fetch, bars_sqlite


@pytest.fixture
def fresh(tmp_path, monkeypatch):
    from api.services import bars_disk_cache
    from api.services.cache import cache as _cache
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(tmp_path / "disk"))
    try:
        _cache._store.clear()
    except Exception:
        pass
    bars_fetch._inflight.clear()
    yield
    bars_sqlite.bump_db_epoch()


def test_layer_mem_on_warm_cache_hit(fresh):
    from api.services.cache import cache
    cache.set("bars_AAPL_D_200", {"ticker": "AAPL", "tf": "D", "bars": []}, ttl=60)
    bars_fetch._get_bars_inner("AAPL", "D", 200)
    assert bars_fetch.get_serve_layer() == "mem"


def test_layer_sqlite_on_fresh_stored_rows(fresh):
    import time
    today = time.strftime("%Y-%m-%d")
    rows = [{"t": today, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]
    bars_sqlite.put_bars("AAPL", "D", rows, date_tf=True)
    # bars=1 so the len>=bars*0.9 gate passes on the single fresh row.
    bars_fetch._get_bars_inner("AAPL", "D", 1)
    assert bars_fetch.get_serve_layer() == "sqlite"


def test_layer_fetch_on_cold_ticker(fresh):
    with patch.object(bars_fetch, "_fetch_daily", return_value=[
        {"t": "2026-07-01", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}
    ]):
        bars_fetch._get_bars_inner("COLDCO", "D", 200)
    assert bars_fetch.get_serve_layer() == "fetch"


def test_layer_delta_on_since_request(fresh):
    import time
    now = int(time.time())
    bars_sqlite.put_bars("AAPL", "1", [{"t": now - 60, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}], date_tf=False)
    with patch.object(bars_fetch, "_needs_fresh", return_value=False):
        bars_fetch._get_bars_since_response("AAPL", "1", 600, str(now - 120))
    assert bars_fetch.get_serve_layer() == "delta"


def test_router_emits_server_timing_header(fresh):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers.bars import router
    from api.services.cache import cache
    cache.set("bars_AAPL_D_200", {"ticker": "AAPL", "tf": "D", "bars": []}, ttl=60)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    r = client.get("/api/bars/AAPL?tf=D&bars=200")
    assert r.status_code == 200
    st = r.headers.get("Server-Timing", "")
    assert st.startswith("bars;")
    assert 'desc="mem"' in st
    assert "dur=" in st
