"""SC-1 v1 — `screen.run` / `screen.count` through the MD-1 gateway (owner: agent-sc).

A real screener snapshot (SCREENER_DB_PATH in tmp), the real `query.run_scan` / `preview_count` /
`coverage_for`, the real gateway. Nothing here calls a provider or a model.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway
from api.services.uct_agent.scan import screen, spec as scan_spec

_ROW = {"company": "Co", "sector": "Technology", "price": 50.0, "chg_pct_1d": 1.0, "vol_ratio": 1.0,
        "rsi14": 50, "market_cap": 5e9, "bars_asof": 20261030, "snapshot_date": "2026-10-31",
        "security_type": "Common Stock", "avg_dollar_vol_30d": 5e7}


@pytest.fixture
def snap(tmp_path, monkeypatch):
    from api.services.screener import snapshot_db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    rows = [dict(_ROW, ticker=f"T{i:02d}", price=10.0 + i, rsi14=i, vol_ratio=0.5 + i / 10) for i in range(60)]
    rows.append(dict(_ROW, ticker="NORS", rsi14=None))
    snapshot_db.upsert_rows(rows)
    return snapshot_db


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("UCT_AGENT_DATA", "1")
    monkeypatch.setenv(gateway.KINDS_ENV, ",".join(gateway.registry().names()))  # every kind on
    monkeypatch.setenv("UCT_AGENT_SCAN", "1")
    gateway._reset_for_test()
    yield
    gateway._reset_for_test()


def _read(kind, params, turn="t1"):
    return gateway.read(kind, params, user_id="admin-1", turn_id=turn, purpose="scan")


RSI_SPEC = {"filters": [{"key": "rsi14", "op": "gte", "min": 5}], "sort": {"key": "rsi14", "dir": "desc"}}


# ── registration + dark ─────────────────────────────────────────────────────────────────────────

def test_both_kinds_register_as_scan_kinds_owned_by_agent_sc(on):
    d = {k["kind"]: k for k in gateway.describe()}
    for name in ("screen.run", "screen.count"):
        assert d[name]["category"] == "scan" and d[name]["owner"] == "agent-sc"
        assert d[name]["freshness"] == "periodic"


@pytest.mark.parametrize("data,scan", [("", ""), ("1", ""), ("", "1")])
def test_refused_unless_both_flags_are_on_and_nothing_executes(monkeypatch, snap, data, scan):
    from api.services.screener import query
    ran = []
    for fn in ("run_scan", "preview_count", "coverage_for", "build_scan_sql"):
        monkeypatch.setattr(query, fn, lambda *a, _fn=fn, **k: ran.append(_fn))
    monkeypatch.setenv("UCT_AGENT_DATA", data)
    monkeypatch.setenv("UCT_AGENT_SCAN", scan)
    gateway._reset_for_test()
    for kind in ("screen.run", "screen.count"):
        out = _read(kind, {"spec": RSI_SPEC}, turn=f"off-{kind}")
        assert out["status"] == "refused" and out["data"] is None
        assert env.validate_envelope(out) == []
    assert ran == []                       # no screener function ran while dark


# ── screen.run ──────────────────────────────────────────────────────────────────────────────────

def test_run_returns_a_valid_envelope_with_coverage_as_of_and_rows(on, snap):
    out = _read("screen.run", {"spec": {**RSI_SPEC, "columns": ["ticker", "price", "rsi14"]}})
    assert env.validate_envelope(out) == []
    assert out["kind"] == "screen.run" and out["source"] == "uct-screener"
    assert out["freshness"] == "periodic" and out["provider_calls"] == 0
    # as_of is the bars session's close (16:00 ET = 20:00 UTC in EDT), never the build date
    assert out["as_of"] == "2026-10-30T20:00:00Z"
    cov = out["coverage"]
    assert set(cov) == {"evaluated", "answered", "dropped", "not_computable"}
    assert cov["evaluated"] == cov["answered"] + cov["dropped"] + cov["not_computable"]
    assert cov["evaluated"] == 61 and cov["not_computable"] == 1          # NORS has no RS rank
    assert out["status"] == "partial"
    d = out["data"]
    assert d["total_matches"] == 55 and len(d["rows"]) == 50
    assert d["rows"][0] == {"symbol": "T59", "price": 69.0, "rsi14": 59}
    assert any("not live" in n for n in out["notes"])
    assert any("Showing 50 of 55" in n for n in out["notes"])


@pytest.mark.parametrize("asked,got", [(None, 50), (10, 10), (500, 50), (0, 1), ("x", 50)])
def test_rows_are_capped_at_fifty(on, snap, asked, got):
    params = {"spec": RSI_SPEC}
    if asked is not None:
        params["limit"] = asked
    out = _read("screen.run", params)
    assert len(out["data"]["rows"]) == got
    assert out["data"]["total_matches"] == 55


def test_the_spec_echo_is_the_screeners_own_spec_and_carries_no_paging(on, snap):
    out = _read("screen.run", {"spec": {**RSI_SPEC, "page": 7, "page_size": 400}})
    assert out["data"]["spec"]["filters"] == RSI_SPEC["filters"]
    assert "page" not in out["data"]["spec"] and "page_size" not in out["data"]["spec"]
    assert len(out["data"]["rows"]) == 50


# ── screen.count ────────────────────────────────────────────────────────────────────────────────

def test_count_matches_run_and_carries_the_same_receipt(on, snap):
    c = _read("screen.count", {"spec": RSI_SPEC}, turn="tc")
    r = _read("screen.run", {"spec": RSI_SPEC}, turn="tr")
    assert env.validate_envelope(c) == []
    assert c["data"]["count"] == r["data"]["total_matches"] == 55
    assert c["coverage"] == r["coverage"]
    assert c["as_of"] == r["as_of"] and c["freshness"] == "periodic"


# ── one scan per turn ───────────────────────────────────────────────────────────────────────────

def test_a_second_scan_in_the_same_turn_is_refused_and_never_runs(on, snap, monkeypatch):
    first = _read("screen.count", {"spec": RSI_SPEC}, turn="one")
    assert first["status"] in ("ok", "partial")
    calls = []
    monkeypatch.setattr(screen, "run", lambda p, c: calls.append(p) or {})
    gateway._registry = None  # re-register with the spy
    second = _read("screen.run", {"spec": RSI_SPEC}, turn="one")
    assert second["status"] == "refused" and "1 scan" in second["notes"][0]
    assert calls == []
    assert env.validate_envelope(second) == []


def test_a_new_turn_gets_a_new_scan(on, snap):
    assert _read("screen.count", {"spec": RSI_SPEC}, turn="a")["status"] != "refused"
    assert _read("screen.count", {"spec": RSI_SPEC}, turn="b")["status"] != "refused"


# ── spec validation ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad,words", [
    ("rs > 80", "spec object"),
    ({"filters": [{"key": "not_a_field", "op": "gte", "min": 1}]}, "no field 'not_a_field'"),
    ({"filters": [{"op": "gte", "min": 1}]}, "names a screener field"),
    ({"filters": "rsi14"}, "list of screener filters"),
    ({"sort": {"key": "nope"}}, "cannot sort by 'nope'"),
    ({"view": "secret"}, "no view 'secret'"),
    ({"columns": ["ticker", "ssn"]}, "no column 'ssn'"),
    ({"filters": [], "sql": "DROP TABLE"}, "no field 'sql'"),
    ({"filters": [{"key": "price", "op": "gte", "min": 1}] * 26}, "at most 25 filters"),
])
def test_a_spec_the_catalog_does_not_know_is_refused_with_a_sentence(on, snap, bad, words):
    out = _read("screen.run", {"spec": bad})
    assert out["status"] == "refused" and out["data"] is None
    assert words in out["notes"][0]
    assert env.validate_envelope(out) == []


def test_a_spec_refused_before_admission_spends_nothing(on, snap):
    bad = _read("screen.run", {"spec": {"filters": [{"key": "nope", "op": "gte", "min": 1}]}}, turn="pre")
    assert bad["status"] == "refused" and "no field 'nope'" in bad["notes"][0]
    good = _read("screen.run", {"spec": RSI_SPEC}, turn="pre")      # same turn: the scan is still unspent
    assert good["status"] in ("ok", "partial")


def test_an_admitted_spec_the_screener_refuses_spends_the_scan(on, snap):
    first = _read("screen.run", {"spec": {"filters": [{"key": "price", "op": "between_nope", "min": 1}]}}, turn="adm")
    assert first["notes"][0].startswith("the Screener refused this spec")
    assert _read("screen.run", {"spec": RSI_SPEC}, turn="adm")["status"] == "refused"


def test_the_screeners_own_refusal_reaches_the_member_unchanged(on, snap):
    out = _read("screen.run", {"spec": {"filters": [{"key": "price", "op": "between_nope", "min": 1}]}})
    assert out["status"] == "refused"
    assert out["notes"][0].startswith("the Screener refused this spec")


def test_special_scope_keys_pass_to_the_screener():
    cat = frozenset({"price"})
    s = scan_spec.validate({"filters": [{"key": "tickers", "value": ["AAPL"]}, {"key": "price", "op": "gte", "min": 1}]},
                           catalog=cat, columns=frozenset({"ticker"}), views=frozenset({"overview"}))
    assert s["filters"][0]["key"] == "tickers"


@pytest.mark.parametrize("where", ["filters", "logic"])
def test_an_indicator_condition_is_refused_never_approximated(on, snap, monkeypatch, where):
    from api.services.screener import query
    ran = []
    monkeypatch.setattr(query, "run_scan", lambda *a, **k: ran.append(a) or {})
    leaf = {"key": "scan", "op": "in", "value": ["abc123"]}
    spec = {"filters": [leaf]} if where == "filters" else {"logic": {"all": [leaf]}}
    out = _read("screen.run", {"spec": spec})
    assert out["status"] == "refused" and "indicator-condition scans" in out["notes"][0]
    assert ran == [] and env.validate_envelope(out) == []


# ── staleness + provenance ──────────────────────────────────────────────────────────────────────

def test_a_snapshot_several_sessions_behind_is_stale_and_says_so():
    now = dt.datetime(2026, 11, 6, 22, 0, tzinfo=dt.timezone.utc)      # Fri after the close
    as_of, stale, notes = screen._provenance_fields({"snapshot_date": 20261030, "mixed": False}, now)
    assert stale is True and as_of == "2026-10-30T20:00:00Z"
    assert any("sessions behind" in n for n in notes)


def test_one_session_behind_is_not_stale():
    now = dt.datetime(2026, 11, 2, 22, 0, tzinfo=dt.timezone.utc)      # Mon after the close
    _as_of, stale, _ = screen._provenance_fields({"snapshot_date": 20261030, "mixed": False}, now)
    assert stale is False


def test_mixed_sessions_are_stale_and_no_session_is_a_null_as_of_with_a_note():
    _, stale, notes = screen._provenance_fields({"snapshot_date": 20261030, "mixed": True,
                                                 "oldest_snapshot_date": 20260901})
    assert stale is True and any("oldest 2026-09-01" in n for n in notes)
    as_of, stale, notes = screen._provenance_fields({"snapshot_date": None})
    assert as_of is None and stale is False and notes     # absent date is said, never read as old


def test_rows_the_screener_excludes_for_stopped_bars_are_dropped_in_coverage(on, snap):
    snap.upsert_rows([dict(_ROW, ticker="DEAD", rsi14=99, bars_asof=20260801)])
    out = _read("screen.run", {"spec": RSI_SPEC})
    assert out["coverage"]["dropped"] >= 1
    assert "DEAD" not in [r["symbol"] for r in out["data"]["rows"]]
    assert "DEAD" in [e["symbol"] for e in out["data"]["excluded"]]
    assert any("price history stopped" in n for n in out["notes"])


@pytest.mark.parametrize("kind", ["screen.run", "screen.count"])
def test_zero_matches_is_dated_by_the_universe_and_not_stale(on, snap, kind):
    # agent-qa F-4: a fresh snapshot with no matches must read "none as of the close", never undated/stale
    out = _read(kind, {"spec": {"filters": [{"key": "rsi14", "op": "gte", "min": 1000}]}}, turn=f"z-{kind}")
    assert env.validate_envelope(out) == []
    assert out["status"] in ("ok", "partial") and out["coverage"] is not None
    assert out["as_of"] == "2026-10-30T20:00:00Z" and out["stale"] is False
    assert any(n.startswith("No names matched") for n in out["notes"])
    assert not any("had no stocks to check" in n for n in out["notes"])       # a real universe was checked
    if kind == "screen.run":
        assert out["data"]["rows"] == [] and out["data"]["total_matches"] == 0
    else:
        assert out["data"]["count"] == 0


# ── wrap, don't fork ────────────────────────────────────────────────────────────────────────────

def test_the_adapters_never_touch_the_legacy_screener_or_alerts():
    import ast
    import inspect
    src = inspect.getsource(screen) + inspect.getsource(scan_spec)
    names = {n.attr if isinstance(n, ast.Attribute) else getattr(n, "id", None) for n in ast.walk(ast.parse(src))}
    assert not names & {"get_screener", "get_candidates", "run_alert_check", "requests", "httpx"}
    assert "/api/screener\"" not in src and "/api/candidates" not in src
