"""New today: the nightly screen-membership record and the diff the Focus list reads."""
import pytest

from api.services.screener import logic
from api.services.screener import membership as M
from api.services.screener import snapshot_db as db

SPEC = {"filters": [{"key": "price", "op": "gte", "min": 10}]}


def _row(t, d, **kw):
    return {"ticker": t, "snapshot_date": d, "price": 50.0, **kw}


@pytest.fixture
def snap(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv(logic.FLAG, "1")
    db.init_db()
    M._CURRENT.clear()
    return tmp_path


def _build(day, tickers, session):
    """One nightly build: replace the snapshot, then record SPEC against it."""
    with db.connect() as c:
        c.execute("DELETE FROM screener_rows")
    db.upsert_rows([_row(t, day) for t in tickers])
    return M.record(SPEC, snapshot_date=day, session_date=session)


def test_the_hash_ignores_key_order_sort_and_view():
    a = {"filters": [{"op": "gte", "key": "price", "min": 10}], "sort": {"key": "x"}, "view": "v"}
    b = {"view": "w", "filters": [{"key": "price", "min": 10, "op": "gte"}]}
    assert M.spec_hash(a) == M.spec_hash(b)
    assert M.spec_hash(a) != M.spec_hash({"filters": [{"key": "price", "op": "gte", "min": 11}]})


def test_a_live_volume_clause_anywhere_makes_it_a_live_screen():
    nested = {"filters": [], "logic": {"any": [{"all": [{"key": "rvol_live", "op": "gte", "min": 2}]}]}}
    assert M.reads_live_only(nested) is True
    assert M.reads_live_only(SPEC) is False
    assert M.diff(nested)["state"] == "live_screen"


def test_new_is_against_the_PREVIOUS_build_and_names_its_session(snap):
    assert _build("2026-10-15", ["AAA", "BBB"], "2026-10-14") == "ok"
    assert _build("2026-10-16", ["AAA", "CCC"], "2026-10-15") == "ok"
    out = M.diff(SPEC)
    assert out["state"] == "ok"
    assert out["entered"] == ["CCC"] and out["exited"] == ["BBB"]
    assert out["prev_session"] == "2026-10-14"
    assert out["new_since_label"] == "New since Oct 14 close"


def test_one_recorded_build_says_nothing(snap):
    _build("2026-10-16", ["AAA"], "2026-10-15")
    assert M.diff(SPEC)["state"] == "no_history"


def test_a_screen_never_recorded_is_unsaved(snap):
    assert M.diff({"filters": [{"key": "price", "op": "gte", "min": 999}]})["state"] == "unsaved"


def test_a_screen_wider_than_the_cap_stores_no_list(snap, monkeypatch):
    monkeypatch.setattr(M, "TOO_WIDE", 1)
    assert _build("2026-10-15", ["AAA", "BBB"], "2026-10-14") == "too_wide"
    assert _build("2026-10-16", ["AAA", "BBB"], "2026-10-15") == "too_wide"
    assert M.diff(SPEC)["state"] == "too_wide"
    with db.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM screen_membership WHERE tickers IS NOT NULL").fetchone()[0] == 0


def test_a_live_screen_is_not_recorded(snap):
    live = {"filters": [{"key": "rvol_live", "op": "gte", "min": 2}]}
    assert M.record(live, snapshot_date="2026-10-16", session_date="2026-10-15") == "skipped_live"
    with db.connect() as c:
        M._ensure(c)
        assert c.execute("SELECT COUNT(*) FROM screen_membership").fetchone()[0] == 0


def test_a_watchlist_filter_is_never_recorded(snap):
    spec = {"filters": [{"key": "list", "op": "in", "values": ["wl:1"]}]}
    assert M.has_list_filter(spec) is True
    assert M.record(spec, snapshot_date="2026-10-16", session_date="2026-10-15") == "skipped_list"
    assert M.diff(spec)["state"] == "unsaved"
    with db.connect() as c:
        M._ensure(c)
        assert c.execute("SELECT COUNT(*) FROM screen_membership").fetchone()[0] == 0


def test_only_the_newest_dates_are_kept(snap, monkeypatch):
    monkeypatch.setattr(M, "KEEP_DATES", 2)
    for i, d in enumerate(["2026-10-13", "2026-10-14", "2026-10-15"]):
        _build(d, ["AAA"], f"2026-10-1{i}")
    with db.connect() as c:
        dates = [r[0] for r in c.execute("SELECT snapshot_date FROM screen_membership ORDER BY 1")]
    assert dates == ["2026-10-14", "2026-10-15"]


def test_record_all_covers_starters_and_saved_screens_once_each(snap, monkeypatch):
    from api.services.screener import saved_screens as SS
    dup = {"filters": [{"key": "price", "op": "gte", "min": 10}]}
    monkeypatch.setattr(SS, "starters", lambda: [{"spec": dup}, {"spec": SPEC}])
    monkeypatch.setattr(SS, "all_specs", lambda: [SPEC, {"filters": [{"key": "list", "op": "in", "values": ["x"]}]}])
    monkeypatch.setattr(M, "_build_identity", lambda: ("2026-10-16", "2026-10-15"))
    db.upsert_rows([_row("AAA", "2026-10-16")])
    r = M.record_all()
    assert r["recorded"] == 1 and r["skipped_list"] == 1 and r["errors"] == 0


def test_all_specs_reads_every_members_saved_screen():
    from api.services.screener import saved_screens as SS
    SS.init()
    a = {"filters": [{"key": "price", "op": "gte", "min": 123.5}]}
    b = {"filters": [{"key": "price", "op": "lte", "max": 7.25}]}
    SS.create("new-today-user-a", "A", a)
    SS.create("new-today-user-b", "B", b)
    specs = SS.all_specs()
    assert a in specs and b in specs
