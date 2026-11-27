"""routers/bars.py reads no stream module; the stream-status route lives on its own (2026-11-26).

flow-worker's import closure reached `bar_broadcaster`, `bar_stream` and `feed_client`
(tests/test_alert_taxonomy_price_level_projection.py). The minimum cut was three edges inside `api/routers/bars.py`, all
in ONE admin route (`GET /api/admin/bars-stream-status`), while six callers import that module for `serve_bars`. The
route moved verbatim to `api/routers/bars_stream_status.py`; `bar_contract` reads the feed through `live_price_source`.
"""
from __future__ import annotations

from tools import flow_worker_watch_coverage as wc

STREAM = {"api.services.bar_broadcaster", "api.services.bar_stream", "api.services.feed_client"}


def test_routers_bars_and_bar_contract_import_no_stream_module():
    root = wc.repo_root()
    for rel in ("api/routers/bars.py", "api/services/bar_contract.py"):
        own = wc._api_imports(root, rel)
        assert not (own & STREAM), f"{rel} imports {sorted(own & STREAM)}"


def test_the_stream_status_route_is_served_once_at_its_old_path_behind_the_open_read_gate():
    from api.main import app
    from api.routers import bars_stream_status
    hits = [r for r in app.routes if getattr(r, "path", None) == "/api/admin/bars-stream-status"]
    assert len(hits) == 1, f"{len(hits)} routes at /api/admin/bars-stream-status"
    assert hits[0].endpoint is bars_stream_status.bars_stream_status
    assert "GET" in hits[0].methods
    deps = [d.call for d in hits[0].dependant.dependencies]
    bars_route = next(r for r in app.routes if getattr(r, "path", None) == "/api/bars/{ticker}")
    bars_deps = [d.call for d in bars_route.dependant.dependencies]
    assert deps and all(d in bars_deps for d in deps), "the moved route lost the bars router's open-read gate"


def test_the_route_answers_disabled_without_reading_any_stream(monkeypatch):
    from api.routers import bars_stream_status
    monkeypatch.delenv("STREAM_BARS_ENABLED", raising=False)
    assert bars_stream_status.bars_stream_status() == {"enabled": False}
