"""The Watchlist column library's facts endpoint (owner 11-14): whitelisted snapshot fields
only, misses absent, and an unreadable snapshot never takes the list down."""
import api.routers.watchlists as wl


class _Body:
    def __init__(self, tickers, fields):
        self.tickers, self.fields = tickers, fields


def test_only_whitelisted_fields_reach_the_read(monkeypatch):
    seen = {}

    def fake(tickers, columns):
        seen["cols"] = columns
        return {"AAA": {c: 1 for c in columns}}
    from api.services.screener import snapshot_db
    monkeypatch.setattr(snapshot_db, "get_projected", fake)
    out = wl.column_facts(_Body(["aaa", "BBB"], ["rs_rank", "password_hash", "adr_pct; DROP TABLE x"]), user={})
    assert seen["cols"] == ["rs_rank"]
    assert out["results"] == {"AAA": {"rs_rank": 1}}
    assert out["missing"] == ["BBB"]


def test_no_fields_or_tickers_reads_nothing(monkeypatch):
    from api.services.screener import snapshot_db
    monkeypatch.setattr(snapshot_db, "get_projected", lambda *a: (_ for _ in ()).throw(AssertionError("read")))
    assert wl.column_facts(_Body([], ["rs_rank"]), user={})["results"] == {}
    assert wl.column_facts(_Body(["AAA"], ["nope"]), user={})["missing"] == ["AAA"]


def test_unreadable_snapshot_reports_everything_missing(monkeypatch):
    from api.services.screener import snapshot_db

    def boom(*a):
        raise RuntimeError("locked")
    monkeypatch.setattr(snapshot_db, "get_projected", boom)
    out = wl.column_facts(_Body(["AAA"], ["rs_rank"]), user={})
    assert out == {"results": {}, "missing": ["AAA"]}
