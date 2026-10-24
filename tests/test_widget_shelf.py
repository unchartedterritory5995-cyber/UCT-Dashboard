"""Task 8.10 -- the ready-made widget examples (`shelf.json`) and `run.run_examples`.

Seeded through `auth_db.init_db` (the Task 8.5 fixtures in `tests.test_widget_sources`) on a temp
sqlite file; nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import copy
import json
from datetime import datetime, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run, shelf, sources
from api.services.journal_two.widget_engine.plan import PlanError
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_trade, add_user, conn,
)

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)   # ET day 2026-10-24

#: The spec section 8 rows wave 8 can express, in shelf order.
SECTION_8_ROWS = 23


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-widget-shelf-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    yield
    run._reset_state()


def _ids(source=None):
    return [e["id"] for e in shelf.examples() if source is None or e["plan"]["source"] == source]


def _seed(c, n=12):
    """`n` closed trades over the last few months, a flagged one and a date-only one among them.
    The flagged one is broker-imported and the rest are not, so a card that let it into its rows
    would say "mixed" where its own run says "manual"."""
    days = ["2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-16", "2026-10-09",
            "2026-09-30", "2026-09-15", "2026-08-20", "2026-07-14", "2026-06-02", "2026-04-01"]
    for i in range(n):
        d = days[i % len(days)]
        kw = {}
        if i == 3:
            kw = {"hour": None, "entry_iso": "2026-10-19", "exit_iso": d}
        add_trade(c, UID, day=d, pnl=(-1) ** i * (40 + 7 * i), fees=1.0, r=(-1) ** i * 0.5,
                  symbol=("NVDA", "AAPL", "MSFT")[i % 3], side="Short" if i % 4 == 0 else "Long",
                  setup=("Flag", "VCP")[i % 2], excluded=1 if i == 5 else 0, hold=i % 4,
                  source="broker" if i == 5 else None, **kw)


# -- the shelf file ----------------------------------------------------------------------------------

def test_every_example_validates():
    exs = shelf.examples()
    assert len(exs) == SECTION_8_ROWS
    for e in exs:
        assert wplan.validate_plan(copy.deepcopy(e["plan"]), sources.CATALOG) == e["plan"], e["id"]
        assert e["name"].strip() and e["description"].strip()
        assert e["plan"]["display"]["title"] == e["name"]          # the card is called its name
    # every source the shelf uses, and every view it uses, is one the catalog has
    assert {e["plan"]["source"] for e in exs} <= set(sources.SOURCES)


def test_ids_namespaced_and_unique():
    ids = _ids()
    assert len(ids) == len(set(ids)) == SECTION_8_ROWS
    assert all(i.startswith("shelf:") and shelf._ID_RE.fullmatch(i) for i in ids)
    raw = json.loads(shelf.SHELF_PATH.read_text(encoding="utf-8"))
    assert raw["version"] == 1 and [e["id"] for e in raw["examples"]] == ids


def test_synonyms_present():
    by_name = {e["name"]: {k.lower() for k in e["keywords"]} for e in shelf.examples()}
    want = {
        "Win rate": {"hit rate", "batting average", "win %"},
        "Profit factor": {"pf"},
        "Expectancy": {"edge", "ev", "avg r"},
        "Max drawdown": {"dd", "drawdown"},
        "Weekly scorecard": {"report card", "review"},
    }
    for name, words in want.items():
        assert words <= by_name[name], name


def test_member_copy_avoids_internal_words():
    banned = ("definition", "shelf", "built widget", "source", "plan", "scope")
    for e in shelf.examples():
        for text in (e["name"], e["description"], *e["keywords"]):
            assert not any(b in text.lower() for b in banned), (e["id"], text)


def test_a_broken_example_fails_the_load(tmp_path):
    raw = json.loads(shelf.SHELF_PATH.read_text(encoding="utf-8"))
    raw["examples"][0]["plan"]["measures"] = [{"key": "no_such_measure"}]
    bad = tmp_path / "shelf.json"
    bad.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(shelf.ShelfError, match="shelf:equity-curve"):
        shelf.load(bad)
    raw["examples"][0]["plan"]["measures"] = [{"key": "net_pnl"}]
    raw["examples"][1]["id"] = raw["examples"][0]["id"]
    bad.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(shelf.ShelfError, match="duplicate"):
        shelf.load(bad)
    raw["examples"][1]["id"] = "daily-pnl-bars"
    bad.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(shelf.ShelfError, match="shelf:<slug>"):
        shelf.load(bad)
    assert len(shelf.load()) == SECTION_8_ROWS                   # control: the real file loads


def test_example_lookup_hands_out_copies():
    e = shelf.example("shelf:win-rate")
    assert e is not None and e["id"] == "shelf:win-rate"
    e["plan"]["measures"] = []
    assert shelf.example("shelf:win-rate")["plan"]["measures"] == [{"key": "win_rate"}]
    assert shelf.example("shelf:nope") is None and shelf.example(None) is None


# -- run_examples ------------------------------------------------------------------------------------

def _spy(monkeypatch):
    calls = []
    real = wcompile.compile_scan

    def spy(source, *a, **k):
        calls.append(source.key)
        return real(source, *a, **k)

    monkeypatch.setattr(wcompile, "compile_scan", spy)
    return calls


def _with_days_example(monkeypatch) -> str:
    """The shelf this wave ships reads closed trades only; add one trading-days example so a batch
    spans two sources (the mechanism under test, not the shelf's contents)."""
    sid = "shelf:test-green-days"
    plan = wplan.validate_plan({"v": 1, "source": "trading_days", "range": {"token": "last_30d"},
                                "measures": [{"key": "avg_day_pnl"}, {"key": "green_day_pct"}]},
                               sources.CATALOG)
    by_id = dict(shelf._BY_ID)
    by_id[sid] = {"id": sid, "name": "Green days", "description": "d", "keywords": [], "plan": plan}
    monkeypatch.setattr(shelf, "_BY_ID", by_id)
    return sid


def test_examples_one_scan_per_source(conn, monkeypatch):
    _seed(conn)
    days_id = _with_days_example(monkeypatch)
    ids = _ids("closed_trades")[:7] + [days_id]
    calls = _spy(monkeypatch)
    out = run.run_examples(UID, ids, now=NOW)
    assert out["sample"] is False and list(out["cards"]) == ids
    assert sorted(calls) == ["closed_trades", "trading_days"]        # 2 scans for 8 cards
    # every card is exactly what that example run on its own would answer
    for sid in ids:
        alone = run.run_plan(UID, shelf.example(sid)["plan"], {}, lane="preview", now=NOW)
        assert out["cards"][sid] == alone, sid


def test_every_example_on_real_rows_matches_its_own_run(conn):
    """All 23, in batches of 8: the one-scan cut gives each card the payload its own run gives."""
    _seed(conn)
    ids = _ids()
    for i in range(0, len(ids), run.MAX_EXAMPLES):
        batch = ids[i:i + run.MAX_EXAMPLES]
        out = run.run_examples(UID, batch, now=NOW)
        for sid in batch:
            alone = run.run_plan(UID, shelf.example(sid)["plan"], {}, lane="preview", now=NOW)
            assert out["cards"][sid] == alone, sid


def test_examples_use_sample_under_5_trades_and_label(conn, monkeypatch):
    for d in ("2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"):
        add_trade(conn, UID, day=d, pnl=25)
    calls = _spy(monkeypatch)
    ids = _ids()
    for i in range(0, len(ids), run.MAX_EXAMPLES):
        out = run.run_examples(UID, ids[i:i + run.MAX_EXAMPLES], now=NOW)
        assert out["sample"] is True
        for sid, card in out["cards"].items():
            assert card["sample"] is True, sid
            assert card["count"] > 4 and card["empty"] is None, sid   # the book, not the 4 trades
    assert calls == []                                                 # no member scan at all
    # the same card on the book alone, through run_plan(sample=True)
    out = run.run_examples(UID, ["shelf:profit-factor"], now=NOW)
    alone = run.run_plan(UID, shelf.example("shelf:profit-factor")["plan"], {}, lane="preview",
                         now=NOW, sample=True)
    assert out["cards"]["shelf:profit-factor"] == alone


def test_examples_switch_to_real_at_5(conn):
    for d in ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"):
        add_trade(conn, UID, day=d, pnl=25)
    first = run.run_examples(UID, ["shelf:profit-factor"], now=NOW)
    assert first["sample"] is True
    add_trade(conn, UID, day="2026-10-23", pnl=-10)
    second = run.run_examples(UID, ["shelf:profit-factor"], now=NOW)     # within the cache TTL
    assert second["sample"] is False
    card = second["cards"]["shelf:profit-factor"]
    assert card["sample"] is False and card["value"]["v2"] == 5          # trades: the member's five


def test_examples_more_than_8_refused(conn):
    with pytest.raises(PlanError) as e:
        run.run_examples(UID, _ids()[:9], now=NOW)
    assert e.value.sentence == run.S_TOO_MANY_EXAMPLES
    with pytest.raises(PlanError) as e:
        run.run_examples(UID, ["shelf:no-such-example"], now=NOW)
    assert e.value.sentence == run.S_UNKNOWN_EXAMPLE
    # control: 8 distinct ids (and a repeat of one of them) are accepted
    out = run.run_examples(UID, _ids()[:8] + _ids()[:1], now=NOW)
    assert len(out["cards"]) == 8


def test_examples_cached_per_member_and_counted_as_one_preview(conn, monkeypatch):
    _seed(conn)
    other = "u-wsrc-other"
    add_user(conn, other)
    lanes = []
    real_admit = run.admit

    def counting_admit(user_id, lane):
        lanes.append((user_id, lane))
        return real_admit(user_id, lane)

    monkeypatch.setattr(run, "admit", counting_admit)
    calls = _spy(monkeypatch)
    ids = _ids()[:8]
    a = run.run_examples(UID, ids, now=NOW)
    assert lanes == [(UID, "example")]                    # ONE preview admission for 8 cards
    assert run._pending(UID) == 0                         # never a saved-widget run
    n = len(calls)
    assert run.run_examples(UID, ids, now=NOW) == a       # a cache hit: no new admission or scan
    assert lanes == [(UID, "example")] and len(calls) == n
    b = run.run_examples(other, ids, now=NOW)             # another member: own answer (the sample)
    assert b["sample"] is True and a["sample"] is False
    assert lanes == [(UID, "example"), (other, "example")]
