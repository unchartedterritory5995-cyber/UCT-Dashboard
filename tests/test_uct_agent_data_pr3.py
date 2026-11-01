"""MD-1 kinds `fundamentals`, `earnings`, `news.company` (agent-md, Sprint 1 PR 3).

No network: each canonical service is stubbed at its public read function. Pins: freshness classes (never
live), as_of from the data's own time (period end / published_at / null-with-note for date-less reported
quarters), staleness rules (135 days, >= 2 quarters behind, news ingest health), provider_calls, partial
and unavailable handling, no body text in news, pre-admission refusal, and the doc stating the constants.
"""
from __future__ import annotations

import pathlib
import time
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from api.services import earnings_table, financial_statements
from api.services.news import store as news_store
from api.services.uct_agent.marketdata import earnings as ern
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import news_company as nc
from api.services.uct_agent.marketdata import statements as stm

_ROOT = pathlib.Path(__file__).resolve().parents[1]
# Fixed clock. The autouse fixture freezes the adapters' own clocks (`time.time`) to NOW_TS, so ages are
# independent of when the suite runs, including across UTC midnight (agent-qa F-8).
NOW_TS = 1793000000.0                                  # 2026-10-26T09:33:20Z
NOW_DT = datetime.fromtimestamp(NOW_TS, timezone.utc)
TODAY = NOW_DT.date()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    frozen = SimpleNamespace(time=lambda: NOW_TS)
    monkeypatch.setattr(stm, "time", frozen)
    monkeypatch.setattr(nc, "time", frozen)
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def _read(kind, params, turn="t1"):
    return gw.read(kind, params, user_id=1, turn_id=turn)


# ── fundamentals ──────────────────────────────────────────────────────────────────────────────────────

def _stmts(period_end: date, *, retrieved_at=None, drop=(), stale_flag=False):
    def rows(n=3):
        return [{"period": (period_end - timedelta(days=91 * i)).isoformat(), "values": {"revenue": 1e9 - i}}
                for i in range(n)]
    p = {"ticker": "AAPL", "meta": {"source": "Yahoo Finance", "currency": "USD", "fiscal_year_end": "09-30",
                                    "units": "reporting currency", "retrieved_at": retrieved_at or 1.0}}
    if stale_flag:
        p["meta"]["stale"] = True
    for st in stm._STATEMENTS:
        p[st] = {"annual": rows(), "quarterly": [] if st in drop else rows()}
    return p


def test_fundamentals_is_periodic_with_period_end_as_of_and_no_provider_call_when_cached(monkeypatch):
    pe = TODAY - timedelta(days=40)
    monkeypatch.setattr(financial_statements, "get_statements", lambda s: _stmts(pe))
    out = _read("fundamentals", {"symbol": "aapl", "periods": 2})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["source"] == "yahoo-finance" and out["provider_calls"] == 0
    assert out["as_of"] == f"{pe.isoformat()}T00:00:00Z"
    assert stm.NOTE_PERIODIC in out["notes"] and stm.NOTE_NO_FILING_DATE in out["notes"]
    assert len(out["data"]["statements"]["income"]) == 2
    assert set(out["data"]["statements"]["income"][0]) == set(stm.PERIOD_FIELDS)


def test_fundamentals_counts_six_calls_when_this_read_built_it(monkeypatch):
    monkeypatch.setattr(financial_statements, "get_statements",
                        lambda s: _stmts(TODAY - timedelta(days=10), retrieved_at=NOW_TS))
    assert _read("fundamentals", {"symbol": "AAPL"})["provider_calls"] == stm.BUILD_PROVIDER_CALLS


def test_fundamentals_older_than_the_budget_is_stale(monkeypatch):
    monkeypatch.setattr(financial_statements, "get_statements",
                        lambda s: _stmts(TODAY - timedelta(days=stm.STALE_AFTER_DAYS + 1)))
    out = _read("fundamentals", {"symbol": "AAPL"})
    assert out["stale"] is True and any("days ago" in n for n in out["notes"])
    monkeypatch.setattr(financial_statements, "get_statements",
                        lambda s: _stmts(TODAY - timedelta(days=stm.STALE_AFTER_DAYS)))
    assert _read("fundamentals", {"symbol": "AAPL"}, turn="t2")["stale"] is False   # boundary


@pytest.mark.parametrize("clock,stale", [
    ("23:59:59", False),    # still day 135 after the period end (UTC calendar date)
    ("00:00:00+1", True),   # one second later the UTC date rolls to day 136
])
def test_fundamentals_staleness_flips_at_utc_midnight_not_at_a_rolling_24h(monkeypatch, clock, stale):
    """statements.py ages on UTC calendar DATES: the flip is exactly UTC midnight between day 135 and 136."""
    pe = date(2026, 6, 1)
    day135 = pe + timedelta(days=stm.STALE_AFTER_DAYS)
    if clock == "23:59:59":
        t = datetime(day135.year, day135.month, day135.day, 23, 59, 59, tzinfo=timezone.utc)
    else:
        t = datetime(day135.year, day135.month, day135.day, tzinfo=timezone.utc) + timedelta(days=1)
    monkeypatch.setattr(stm, "time", SimpleNamespace(time=lambda: t.timestamp()))
    monkeypatch.setattr(financial_statements, "get_statements", lambda s: _stmts(pe))
    assert _read("fundamentals", {"symbol": "AAPL"})["stale"] is stale


def test_fundamentals_missing_statement_is_partial_and_refreshing_copy_is_noted(monkeypatch):
    monkeypatch.setattr(financial_statements, "get_statements",
                        lambda s: _stmts(TODAY - timedelta(days=30), drop=("cashflow",), stale_flag=True))
    out = _read("fundamentals", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == [] and out["status"] == "partial"
    assert "no statement data for: cashflow" in out["notes"] and stm.NOTE_REFRESHING in out["notes"]


@pytest.mark.parametrize("payload", [{"error": "no statements available", "security_type": "ETF"},
                                     {"error": "yfinance failed"}, {"ticker": "X", "meta": {}}])
def test_fundamentals_unavailable(monkeypatch, payload):
    monkeypatch.setattr(financial_statements, "get_statements", lambda s: payload)
    out = _read("fundamentals", {"symbol": "SPY"})
    assert env.validate_envelope(out) == [] and out["status"] == "unavailable"


# ── earnings ──────────────────────────────────────────────────────────────────────────────────────────

def _table(behind=0, forward_date="2026-11-20", reported=True):
    q = []
    if reported:
        q += [{"label": "2026 Q1", "reported": True, "eps_actual": 1.0, "eps_estimate": 0.9},
              {"label": "2026 Q2", "reported": True, "eps_actual": 1.2, "eps_estimate": 1.1,
               "rev_actual": 5e9, "rev_estimate": 4.9e9}]
    q.append({"label": "2026 Q3", "reported": False, "report_date": forward_date, "eps_estimate": 1.3})
    return {"ticker": "AAPL", "quarterly": q, "reported_through": "2026 Q2" if reported else None,
            "stale_quarters": behind}


def test_earnings_is_periodic_with_null_as_of_and_a_note(monkeypatch):
    monkeypatch.setattr(earnings_table, "get_earnings_table", lambda s: _table())
    out = _read("earnings", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] is None and ern.NOTE_NO_DATE.format(label="2026 Q2") in out["notes"]
    assert out["provider_calls"] == 1
    assert [r["quarter"] for r in out["data"]["reported"]] == ["2026 Q1", "2026 Q2"]
    assert set(out["data"]["reported"][0]) == set(ern.ROW_FIELDS)


def test_next_report_is_a_scheduled_event_never_as_of(monkeypatch):
    monkeypatch.setattr(earnings_table, "get_earnings_table", lambda s: _table())
    out = _read("earnings", {"symbol": "AAPL"})
    nr = out["data"]["next_report"]
    assert nr["report_date"] == "2026-11-20" and nr["kind"] == "scheduled" and set(nr) == set(ern.NEXT_REPORT_FIELDS)
    assert out["as_of"] is None and ern.NOTE_EVENT in out["notes"]


def test_no_next_report_is_noted(monkeypatch):
    monkeypatch.setattr(earnings_table, "get_earnings_table", lambda s: _table(forward_date=None))
    out = _read("earnings", {"symbol": "AAPL"})
    assert out["data"]["next_report"] is None and ern.NOTE_NO_NEXT in out["notes"]


@pytest.mark.parametrize("behind,stale", [(0, False), (1, False), (2, True), (3, True)])
def test_earnings_staleness_reuses_stale_quarters(monkeypatch, behind, stale):
    monkeypatch.setattr(earnings_table, "get_earnings_table", lambda s: _table(behind=behind))
    out = _read("earnings", {"symbol": "AAPL"})
    assert out["stale"] is stale and out["data"]["quarters_behind"] == behind
    assert (ern.NOTE_BEHIND.format(n=behind) in out["notes"]) is stale


@pytest.mark.parametrize("payload", [_table(reported=False), {"ticker": "X"}, None])
def test_earnings_without_reported_quarters_is_unavailable(monkeypatch, payload):
    monkeypatch.setattr(earnings_table, "get_earnings_table", lambda s: payload)
    out = _read("earnings", {"symbol": "XYZ"})
    assert env.validate_envelope(out) == [] and out["status"] == "unavailable"


# ── news.company ──────────────────────────────────────────────────────────────────────────────────────

def _news(monkeypatch, items, last_ok_age=60, boom=False):
    def feed(sym, limit=25):
        if boom:
            raise RuntimeError("db locked")
        return {"items": items[:limit], "has_more": len(items) > limit}
    last_ok = (NOW_DT - timedelta(seconds=last_ok_age)).isoformat() if last_ok_age else ""
    monkeypatch.setattr(news_store, "feed", feed)
    monkeypatch.setattr(news_store, "health_snapshot",
                        lambda days=3: {"sources": [{"source": "fmp", "last_ok": last_ok},
                                                    {"source": "rss", "last_ok": ""}]})


def _item(hours_ago, **kw):
    pub = (NOW_DT - timedelta(hours=hours_ago)).isoformat()
    it = {"headline": f"h{hours_ago}", "url": "https://x", "source_display": "Reuters", "source_class": "wire",
          "category": "earnings", "sentiment": "bullish", "published_at": pub,
          "description": "FULL BODY TEXT", "raw_ref": "secret-ref"}
    it.update(kw)
    return it


def test_news_items_carry_published_time_and_no_body_text(monkeypatch):
    _news(monkeypatch, [_item(1), _item(5)])
    out = _read("news.company", {"symbol": "AAPL", "limit": 5})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["provider_calls"] == 0 and out["source"] == "uct-news"
    items = out["data"]["items"]
    assert all(set(i) == set(nc.ITEM_FIELDS) for i in items)
    assert "FULL BODY TEXT" not in repr(out) and "secret-ref" not in repr(out)
    assert out["as_of"] == items[0]["as_of"] == max(i["as_of"] for i in items)
    assert nc.NOTE_PUBLISHED in out["notes"]


def test_a_quiet_company_with_healthy_ingest_is_ok_empty_and_not_stale(monkeypatch):
    _news(monkeypatch, [])
    out = _read("news.company", {"symbol": "QUIET"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["data"]["items"] == [] and out["stale"] is False
    assert out["as_of"] is None and nc.NOTE_NO_ITEMS.format(sym="QUIET") in out["notes"]


def test_old_company_news_with_healthy_ingest_is_not_stale(monkeypatch):
    _news(monkeypatch, [_item(24 * 30)])
    assert _read("news.company", {"symbol": "AAPL"})["stale"] is False


def test_stale_ingest_marks_the_read_stale(monkeypatch):
    _news(monkeypatch, [_item(1)], last_ok_age=nc.STALE_AFTER_S + 60)
    out = _read("news.company", {"symbol": "AAPL"})
    assert out["stale"] is True and nc.NOTE_INGEST_STALE in out["notes"]


@pytest.mark.parametrize("age,stale", [(nc.STALE_AFTER_S, False), (nc.STALE_AFTER_S + 1, True)])
def test_news_ingest_boundary_is_exclusive(monkeypatch, age, stale):
    """`stale` means OLDER than STALE_AFTER_S: exactly the budget is still fresh, one second over is stale."""
    _news(monkeypatch, [_item(1)], last_ok_age=age)
    assert _read("news.company", {"symbol": "AAPL"})["stale"] is stale


def test_unknown_ingest_health_is_stale_with_its_own_note(monkeypatch):
    _news(monkeypatch, [_item(1)], last_ok_age=None)
    out = _read("news.company", {"symbol": "AAPL"})
    assert out["stale"] is True and nc.NOTE_INGEST_UNKNOWN in out["notes"]


def test_a_store_error_is_unavailable(monkeypatch):
    _news(monkeypatch, [], boom=True)
    out = _read("news.company", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == [] and out["status"] == "unavailable"


def test_news_limit_is_capped(monkeypatch):
    seen = {}
    _news(monkeypatch, [_item(i) for i in range(40)])
    orig = news_store.feed
    monkeypatch.setattr(news_store, "feed", lambda s, limit=25: seen.setdefault("limit", limit) and orig(s, limit))
    _read("news.company", {"symbol": "AAPL", "limit": 500})
    assert seen["limit"] == nc.MAX_LIMIT


# ── shared ────────────────────────────────────────────────────────────────────────────────────────────

def test_the_adapter_clocks_are_frozen():
    """Control on the fixture: both adapters that read a clock see NOW_TS."""
    assert stm.time.time() == NOW_TS and nc.time.time() == NOW_TS


def test_all_three_register_as_periodic_never_live():
    d = {x["kind"]: x for x in gw.describe()}
    for k in ("fundamentals", "earnings", "news.company"):
        assert d[k]["freshness"] == "periodic" and d[k]["max_symbols"] == 1 and d[k]["owner"] == "agent-md"


@pytest.mark.parametrize("kind,params", [("fundamentals", {"symbol": "!!"}), ("fundamentals", {"symbol": "A", "period": "ttm"}),
                                         ("fundamentals", {"symbol": "A", "periods": 0}), ("earnings", {}),
                                         ("news.company", {"symbol": "A", "limit": True})])
def test_bad_params_are_refused_before_admission(monkeypatch, kind, params):
    called = []
    monkeypatch.setattr(financial_statements, "get_statements", lambda s: called.append(s))
    monkeypatch.setattr(earnings_table, "get_earnings_table", lambda s: called.append(s))
    monkeypatch.setattr(news_store, "feed", lambda *a, **k: called.append(a))
    out = _read(kind, params)
    assert out["status"] == "refused" and called == []


def test_the_contract_doc_states_the_budgets_and_notes():
    doc = (_ROOT / "docs/agent/program/contracts/MD-1-market-data.md").read_text(encoding="utf-8")
    assert "(v1.2)" in doc.splitlines()[0]
    for s in (f"{stm.STALE_AFTER_DAYS} days", f"`stale_quarters` ≥ {ern.STALE_QUARTERS}", "financial_statements",
              "earnings_table", stm.NOTE_PERIODIC, ern.NOTE_EVENT, nc.NOTE_INGEST_STALE):
        assert s in doc, s
