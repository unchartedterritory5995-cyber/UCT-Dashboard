"""Every screener scan leaves out a pending acquisition (`query.deal_gate`).

Before this the buyout exclude set reached the screener ONLY through the universe file
`screener_universe.build_and_save` writes, and nothing runs that on a schedule. A deal
announced after the last rebuild stayed in the snapshot and every screen served it: on
2026-11-14 "Tight bases near highs" listed TECH, UTZ, HZO, SLN, ARX and ADT, all six in
the app's own pending set. A stock pinned at its deal price is the tightest base there is.
"""
from __future__ import annotations

import pytest

from api.services import deal_status

ROWS = [
    {"ticker": "AAA", "price": 10.0, "snapshot_date": "2026-11-13"},
    {"ticker": "TECH", "price": 55.0, "snapshot_date": "2026-11-13"},
    {"ticker": "BRK.B", "price": 480.0, "snapshot_date": "2026-11-13"},
    {"ticker": "ZZZ", "price": 20.0, "snapshot_date": "2026-11-13"},
]
ALL = {"AAA", "TECH", "BRK.B", "ZZZ"}
CONSULTED: list = []


@pytest.fixture
def snap(tmp_path, monkeypatch):
    from api.services.screener import snapshot_db as db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    db.upsert_rows([dict(r) for r in ROWS])


@pytest.fixture(autouse=True)
def _fresh_memo(monkeypatch, tmp_path):
    """Each test starts with no cached exclude set and no saved one (DATA_DIR is the test's
    own), and a refresh runs INLINE (the background-thread behaviour has its own tests
    below, with the real `_spawn`)."""
    from api.services.screener import query as Q
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    Q._reset_deal_memo()
    monkeypatch.setattr(Q, "_spawn", lambda fn: fn())
    yield
    Q._reset_deal_memo()


@pytest.fixture
def deal(monkeypatch):
    """deal("off") | deal("on", {...}) | deal("broken")."""
    from api.services.screener import query as Q

    def set_(state, pend=frozenset()):
        Q._reset_deal_memo()
        CONSULTED.clear()
        if state == "off":
            monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)

            def _never():
                CONSULTED.append(1)
                raise AssertionError("exclude set consulted with DEAL_STATUS_ENABLED off")
            monkeypatch.setattr(deal_status, "screener_excludes", _never)
            return
        monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
        if state == "broken":
            def _boom():
                raise RuntimeError("store unreadable")
            monkeypatch.setattr(deal_status, "screener_excludes", _boom)
            monkeypatch.setattr(deal_status, "hand_list", _boom)
        else:
            monkeypatch.setattr(deal_status, "screener_excludes", lambda: frozenset(pend))
    return set_


def _tickers(spec=None):
    from api.services.screener import query as Q
    return {r["ticker"] for r in Q.run_scan(spec or {"filters": [], "page_size": 50})["rows"]}


def test_a_pending_acquisition_is_left_out_of_every_scan(snap, deal):
    deal("on", {"TECH"})
    assert _tickers() == ALL - {"TECH"}
    # ...and out of a screen with criteria, not only the bare universe
    assert _tickers({"filters": [{"key": "price", "op": "gte", "min": 15}],
                     "page_size": 50}) == {"BRK.B", "ZZZ"}


def test_the_count_and_the_coverage_receipt_agree_with_the_rows(snap, deal):
    from api.services.screener import query as Q
    deal("on", {"TECH"})
    spec = {"filters": [], "page_size": 50}
    assert Q.preview_count(spec)["count"] == len(_tickers(spec)) == 3
    c = Q.coverage_for(spec)
    assert (c["evaluated"], c["answered"]) == (3, 3)


def test_a_class_share_matches_in_either_spelling(snap, deal):
    deal("on", {"BRK-B"})          # the set's spelling; the row is stored as BRK.B
    assert _tickers() == ALL - {"BRK.B"}


def test_with_the_flag_off_nothing_is_consulted_and_nothing_is_excluded(snap, deal):
    from api.services.screener import query as Q
    deal("off")
    assert Q.deal_gate() is None
    assert _tickers() == ALL
    assert CONSULTED == []


def test_a_fault_in_the_exclude_set_excludes_nothing(snap, deal):
    from api.services.screener import query as Q
    deal("broken")
    assert Q.deal_gate() is None
    assert _tickers() == ALL


def test_an_empty_exclude_set_adds_no_clause(snap, deal):
    from api.services.screener import query as Q
    deal("on", set())
    assert Q.deal_gate() is None
    assert _tickers() == ALL


# ── a scan never waits on the exclude set's build (2026-11-14) ─────────────────

def test_a_cold_exclude_set_never_blocks_a_scan(snap, monkeypatch):
    """The full set's build is slow when cold (a read of it did not answer in 120 s on a
    freshly booted pod). A scan must answer from the cheap hand lists meanwhile."""
    import threading
    import time as _t
    from api.services.screener import query as Q
    monkeypatch.setattr(Q, "_spawn", lambda fn: threading.Thread(target=fn, daemon=True).start())
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    release = threading.Event()

    def _slow():
        release.wait(10)
        return frozenset({"TECH", "ZZZ"})
    monkeypatch.setattr(deal_status, "screener_excludes", _slow)
    monkeypatch.setattr(deal_status, "hand_list", lambda: frozenset({"TECH"}))
    monkeypatch.setattr(deal_status, "mirror_list", lambda: frozenset())
    t0 = _t.monotonic()
    assert _tickers() == ALL - {"TECH"}          # the hand list, at once
    assert _t.monotonic() - t0 < 5, "the scan waited for the build"
    release.set()
    for _ in range(100):                            # the background build lands
        if Q._DEAL_MEMO["syms"] is not None:
            break
        _t.sleep(0.05)
    assert _tickers() == ALL - {"TECH", "ZZZ"}      # ...and the next scan uses it


def test_a_failed_refresh_keeps_the_last_good_set(snap, deal, monkeypatch):
    from api.services.screener import query as Q
    deal("on", {"ZZZ"})
    # the fallback lists hold nothing, so only a KEPT set can still leave ZZZ out
    monkeypatch.setattr(deal_status, "hand_list", lambda: frozenset())
    monkeypatch.setattr(deal_status, "mirror_list", lambda: frozenset())
    assert _tickers() == ALL - {"ZZZ"}

    def _boom():
        raise RuntimeError("store unreadable")
    monkeypatch.setattr(deal_status, "screener_excludes", _boom)
    monkeypatch.setattr(Q, "DEAL_GATE_MAX_AGE_S", -1.0)   # every read is stale
    assert _tickers() == ALL - {"ZZZ"}
    assert Q._DEAL_MEMO["refreshing"] is False


def test_only_one_refresh_runs_at_a_time(snap, monkeypatch):
    from api.services.screener import query as Q
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    spawned = []
    monkeypatch.setattr(Q, "_spawn", lambda fn: spawned.append(fn))   # never runs
    monkeypatch.setattr(deal_status, "hand_list", lambda: frozenset({"TECH"}))
    monkeypatch.setattr(deal_status, "mirror_list", lambda: frozenset())
    for _ in range(5):
        assert _tickers() == ALL - {"TECH"}
    assert len(spawned) == 1


# ── the boot window: a saved set and a boot warm (2026-11-15) ──────────────────
# On a quiet Sunday the first scan after a deploy came an hour after boot. That scan started
# the build and answered from the hand lists alone, and its UCT 50 served ARX: a price-pin deal
# is in the full set only.

def _cold(monkeypatch, hand=frozenset()):
    """Flag on, the full build never lands during the test, fallback lists = `hand`."""
    from api.services.screener import query as Q
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(Q, "_spawn", lambda fn: None)
    monkeypatch.setattr(deal_status, "hand_list", lambda: frozenset(hand))
    monkeypatch.setattr(deal_status, "mirror_list", lambda: frozenset())


def test_a_cold_pod_scans_with_the_last_saved_full_set(snap, monkeypatch):
    from api.services.screener import query as Q
    _cold(monkeypatch, hand={"TECH"})
    Q._save_deal_last({"ZZZ"})                  # a price-pin name the hand lists lack
    assert _tickers() == ALL - {"TECH", "ZZZ"}


def test_a_saved_set_older_than_the_limit_is_not_used(snap, monkeypatch):
    import json
    import time as _t
    from api.services.screener import query as Q
    _cold(monkeypatch)
    Q._save_deal_last({"ZZZ"})
    path = Q._deal_last_path()
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    d["at"] = _t.time() - Q.DEAL_GATE_LAST_MAX_AGE_S - 60
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(d, fh)
    assert _tickers() == ALL


def test_a_damaged_saved_set_is_not_used_and_never_fails_a_scan(snap, monkeypatch):
    import os
    from api.services.screener import query as Q
    _cold(monkeypatch, hand={"TECH"})
    os.makedirs(os.path.dirname(Q._deal_last_path()), exist_ok=True)
    with open(Q._deal_last_path(), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    assert _tickers() == ALL - {"TECH"}


def test_a_full_build_saves_its_set_for_the_next_boot(snap, deal):
    from api.services.screener import query as Q
    deal("on", {"ZZZ", "BRK.B"})
    assert _tickers() == ALL - {"ZZZ", "BRK.B"}
    assert Q._load_deal_last() == frozenset({"ZZZ", "BRK-B"})


def _names(monkeypatch, cold, in_window=True, ruled=frozenset()):
    from api.services.screener import query as Q
    monkeypatch.setattr(deal_status, "names_cold", lambda: cold)
    monkeypatch.setattr(deal_status, "news_overrides", lambda: frozenset(ruled))
    monkeypatch.setattr(Q, "_in_cold_window", lambda: in_window)


def test_a_build_made_with_names_cold_never_drops_a_saved_name(snap, deal, monkeypatch):
    """LXFR 2026-11-15: the restart build missed a target written by name and served it."""
    from api.services.screener import query as Q
    Q._save_deal_last({"ZZZ", "TECH"})
    deal("on", {"TECH"})                         # the cold build missed ZZZ
    _names(monkeypatch, cold=True)
    assert _tickers() == ALL - {"TECH", "ZZZ"}
    assert Q._load_deal_last() == frozenset({"ZZZ", "TECH"}), "a cold build must not be saved"


def test_the_same_build_with_names_warm_replaces_the_saved_set(snap, deal, monkeypatch):
    """The control: once names are in, a name the build no longer holds DOES leave."""
    from api.services.screener import query as Q
    Q._save_deal_last({"ZZZ", "TECH"})
    deal("on", {"TECH"})
    _names(monkeypatch, cold=False)
    assert _tickers() == ALL - {"TECH"}
    assert Q._load_deal_last() == frozenset({"TECH"})


def test_names_cold_past_the_boot_window_is_an_ordinary_build(snap, deal, monkeypatch):
    """A symbol with no name anywhere keeps the pod cold for good; it must not pin an old set."""
    from api.services.screener import query as Q
    Q._save_deal_last({"ZZZ", "TECH"})
    deal("on", {"TECH"})
    _names(monkeypatch, cold=True, in_window=False)
    assert _tickers() == ALL - {"TECH"}
    assert Q._load_deal_last() == frozenset({"TECH"})


def test_an_owner_ruling_leaves_the_saved_set_at_once_even_with_names_cold(snap, deal, monkeypatch):
    from api.services.screener import query as Q
    Q._save_deal_last({"ZZZ", "BRK-B", "TECH"})
    deal("on", {"TECH"})
    _names(monkeypatch, cold=True, ruled={"BRK.B"})
    assert _tickers() == ALL - {"TECH", "ZZZ"}


def test_a_names_cold_set_is_refreshed_within_about_a_minute(snap, deal, monkeypatch):
    import time as _t
    from api.services.screener import query as Q
    deal("on", {"TECH"})
    _names(monkeypatch, cold=True)
    _tickers()
    age = _t.monotonic() - Q._DEAL_MEMO["at"]
    assert Q.DEAL_GATE_MAX_AGE_S - 61 <= age <= Q.DEAL_GATE_MAX_AGE_S
    _names(monkeypatch, cold=False)
    Q._reset_deal_memo()
    _tickers()
    assert _t.monotonic() - Q._DEAL_MEMO["at"] < 5


def test_names_cold_reads_the_snapshots_own_flag(monkeypatch):
    deal_status.reset_cache()
    assert deal_status.names_cold() is False
    monkeypatch.setitem(deal_status._STATE, "cold", True)
    assert deal_status.names_cold() is True
    deal_status.reset_cache()


def test_the_boot_warm_starts_the_build_and_only_with_the_flag_on(monkeypatch):
    from api.services.screener import query as Q
    spawned = []
    monkeypatch.setattr(Q, "_spawn", lambda fn: spawned.append(fn))
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    Q.warm_deal_gate()
    assert spawned == []
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(deal_status, "hand_list", lambda: frozenset())
    monkeypatch.setattr(deal_status, "mirror_list", lambda: frozenset())
    Q.warm_deal_gate()
    assert spawned == [Q._refresh_deal_memo]


def test_boot_schedules_the_warm_after_the_reconnect_burst():
    """main.py's own source (importing it boots the app): the warm goes through the quiet-window
    table, on a Timer, calling the query module's warm."""
    import pathlib
    import re
    main = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    table = re.search(r"_BOOT_QUIET_S = \{(.*?)\}", main, re.S).group(1)
    secs = dict(re.findall(r'"(\w+)":\s*(\d+)', table))
    assert 60 <= int(secs.get("screener_deal_gate_warm", 0)) <= 300
    call = 'threading.Timer(_BOOT_QUIET_S["screener_deal_gate_warm"], _scr_query.warm_deal_gate)'
    assert main.count(call) == 1
    site = main[main.index(call) - 400:main.index(call)]
    assert "from api.services.screener import query as _scr_query" in site
    after = main[main.index(call):main.index(call) + 200]
    assert "_dg.start()" in after, "the warm Timer is built but never started"
