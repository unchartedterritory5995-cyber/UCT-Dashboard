"""RS screens unit U8, item D2: the market caution state.

``api/services/screener/rs_market_state.py`` reads SPY and QQQ daily closes and names
one of three states (plan v2 section 7):

  caution   SPY closed below its 200-day average, or SPY's 504-session return is negative
  pressure  not caution, and SPY closed below its 50-day average or QQQ below its 200-day
  normal    neither (no line is shown)

Why each rail exists:
  * every boundary is "strictly below": a close exactly on its average, or a two-year
    return of exactly zero, is not a warning, and an off-by-one in the 504-session
    lookback would read some other session's close;
  * a state is a claim about every condition above it, so a condition that cannot be
    computed leaves NO state (the page then shows no line) unless one that can be
    computed already decides it;
  * the state is computed once per post-pass and kept in that pass's receipt; the
    saved-screens payload serves it as ``rs_market`` only while ``RS_SCREENS_ENABLED`` is
    on, and carries no such key otherwise;
  * the build hands the pass the SPY bars it already read: SPY is read once per build.

Hermetic: hand-built bars; a ``screener.db`` in ``tmp_path`` where a receipt is stored.
"""
from __future__ import annotations

import datetime
import math

import pytest

from api.services.screener import rs_market_state as ms
from api.services.screener import rs_post_pass as pp
from api.services.screener import snapshot_db

#: A Friday, and the Monday after it: "now" for the reads, so the settled session is END.
END = datetime.date(2026, 11, 13)
NOW = datetime.datetime(2026, 11, 16, 9, 0)

CAUTION_TEXT = ("Leadership reverses hardest in rebounds after bear markets. "
                "Treat these lists as watchlists.")
PRESSURE_TEXT = "Market under pressure. Build the watchlist; breakouts fail more often."


def bars(closes, end=END):
    """Daily bar dicts, oldest first, one per weekday, the newest dated ``end``."""
    days, d = [], end
    while len(days) < len(closes):
        if d.weekday() < 5:
            days.append(d)
        d -= datetime.timedelta(days=1)
    days.reverse()
    return [{"t": int(day.strftime("%Y%m%d")), "o": c, "h": c, "l": c, "c": c, "v": 1}
            for day, c in zip(days, closes)]


def flat(n=600, level=100.0):
    return [level] * n


def state(spy, qqq):
    got = ms.classify(bars(spy), bars(qqq) if qqq is not None else [])
    return got["state"] if got else None


# ───────────────────────── the three states, at each boundary ─────────────────────────

def test_a_market_exactly_on_every_line_is_normal():
    """Every condition is "strictly below". SPY flat for 600 sessions closes ON its
    200-day and its 50-day average and returns exactly zero over 504 sessions; QQQ flat
    closes ON its 200-day. None of the four is a warning."""
    got = ms.classify(bars(flat()), bars(flat()))
    assert got == {"state": "normal", "text": "", "asof": "2026-11-13"}


def test_caution_when_spy_closes_below_its_200_day_average():
    spy = flat()
    spy[-1] = 99.99
    got = ms.classify(bars(spy), bars(flat()))
    assert got == {"state": "caution", "text": CAUTION_TEXT, "asof": "2026-11-13"}
    # the average is the newest 200 closes, the newest one included: 199 at 100 and one at
    # 100.5 average 100.0025, and a close of 100.5 is above it
    spy[-1] = 100.5
    assert state(spy, flat()) == "normal"


def test_the_200_day_average_reads_exactly_200_closes():
    """A high close 201 sessions back is outside the window; 200 sessions back is inside."""
    spy = flat()
    spy[-201] = 5000.0
    assert state(spy, flat()) == "normal"
    spy = flat()
    spy[-200] = 5000.0                    # now the average is 124.5 and the close is under it
    assert state(spy, flat()) == "caution"


def test_caution_when_the_504_session_return_is_negative():
    """SPY is above its 200-day and its 50-day, and still under where it closed 504
    sessions ago."""
    spy = flat()
    spy[-505] = 100.01
    assert state(spy, flat()) == "caution"
    spy[-505] = 100.0                     # a return of exactly zero is not negative
    assert state(spy, flat()) == "normal"
    spy[-505] = 99.0                      # and a gain is not
    assert state(spy, flat()) == "normal"


def test_the_504_session_return_reads_the_close_504_sessions_back_and_no_other():
    for back in (504, 506):               # one session either side: not the one compared
        spy = flat()
        spy[-back] = 150.0
        assert state(spy, flat()) == "normal", back
    spy = flat()
    spy[-505] = 150.0
    assert state(spy, flat()) == "caution"


def test_pressure_when_spy_closes_below_its_50_day_average_but_above_its_200_day():
    # 150 sessions at 100, then 49 at 110, then one close at 109: above the 200-day
    # average (102.4), below the 50-day (109.98), and up over two years
    spy = flat(400) + [100.0] * 150 + [110.0] * 49 + [109.0]
    got = ms.classify(bars(spy), bars(flat()))
    assert got == {"state": "pressure", "text": PRESSURE_TEXT, "asof": "2026-11-13"}
    # on its 50-day average exactly: not below it
    assert state(flat(400) + [100.0] * 150 + [110.0] * 50, flat()) == "normal"


def test_pressure_when_qqq_closes_below_its_200_day_average():
    qqq = flat()
    qqq[-1] = 99.99
    assert state(flat(), qqq) == "pressure"
    qqq[-1] = 100.0
    assert state(flat(), qqq) == "normal"
    # QQQ needs only its own 200 closes
    short = flat(200)
    assert state(flat(), short) == "normal"
    short[-1] = 99.0
    assert state(flat(), short) == "pressure"


def test_caution_outranks_pressure():
    spy = flat()
    spy[-1] = 90.0                        # under its 200-day AND its 50-day
    qqq = flat()
    qqq[-1] = 90.0
    assert state(spy, qqq) == "caution"


def test_the_words_are_the_plan_s_and_are_not_advice():
    assert ms.TEXT == {"caution": CAUTION_TEXT, "pressure": PRESSURE_TEXT, "normal": ""}
    assert ms.STATES == ("caution", "pressure", "normal")
    for words in (CAUTION_TEXT, PRESSURE_TEXT):
        assert words.isascii() and "  " not in words
        for banned in ("buy", "sell", "should", "must", "avoid", "RSI"):
            assert banned not in words.lower().split() and f" {banned} " not in f" {words.lower()} "


# ───────────────────────── fail closed ─────────────────────────

def test_no_spy_bars_is_no_state():
    assert ms.classify([], bars(flat())) is None
    assert ms.classify(None, None) is None


def test_too_few_spy_bars_to_rule_caution_out_is_no_state():
    assert state(flat(199), flat()) is None                 # no 200-day average
    assert state(flat(504), flat()) is None                 # no close 504 sessions back
    assert state(flat(505), flat()) == "normal"             # exactly enough


def test_a_condition_that_is_true_decides_without_the_ones_that_cannot_be_read():
    """Under its 200-day average is caution, whatever the two-year return would have said
    and whether or not QQQ could be read."""
    short = flat(250)
    short[-1] = 90.0
    assert state(short, None) == "caution"
    # SPY under its 50-day with QQQ unreadable is pressure: one true condition is enough
    spy = flat(400) + [100.0] * 150 + [110.0] * 49 + [109.0]
    assert state(spy, None) == "pressure"
    assert state(spy, flat(150)) == "pressure"


def test_without_qqq_a_calm_spy_is_no_state_not_normal():
    assert state(flat(), None) is None
    assert state(flat(), flat(199)) is None                 # QQQ too short for its average


def test_qqq_on_another_session_does_not_answer_for_spy_s():
    spy = bars(flat())
    behind = bars(flat(), end=datetime.date(2026, 11, 12))
    assert ms.classify(spy, behind) is None
    # even a QQQ that would have said "pressure" is not used a session late
    low = flat()
    low[-1] = 50.0
    assert ms.classify(spy, bars(low, end=datetime.date(2026, 11, 12))) is None
    assert ms.classify(spy, bars(low))["state"] == "pressure"


@pytest.mark.parametrize("bad", [None, 0, -5.0, float("nan"), float("inf"), "100", True])
def test_a_close_that_is_not_a_positive_number_voids_the_window_it_is_in(bad):
    spy = bars(flat())
    spy[-10]["c"] = bad                                     # inside every SPY window
    assert ms.classify(spy, bars(flat())) is None
    qqq = bars(flat())
    qqq[-10]["c"] = bad
    assert ms.classify(bars(flat()), qqq) is None
    # outside the windows it changes nothing
    old = bars(flat())
    old[0]["c"] = bad
    assert ms.classify(old, bars(flat()))["state"] == "normal"


def test_a_newest_bar_with_no_date_is_no_state():
    spy = bars(flat())
    spy[-1]["t"] = None
    assert ms.classify(spy, bars(flat())) is None
    spy[-1]["t"] = "soon"
    assert ms.classify(spy, bars(flat())) is None
    spy[-1]["t"] = "2026-11-13"                             # an ISO date reads too
    assert ms.classify(spy, bars(flat()))["asof"] == "2026-11-13"


def test_the_helpers_answer_none_rather_than_guess():
    assert ms.below_average(bars(flat(49)), 50) is None
    assert ms.negative_return(bars(flat(10)), 10) is None
    assert ms.negative_return(bars(flat(11)), 10) is False
    assert ms.closes(bars(flat(5)), 0) is None
    assert math.isclose(sum(ms.closes(bars(flat(5)), 3)), 300.0)


# ───────────────────────── the read ─────────────────────────

@pytest.fixture
def reader(monkeypatch):
    """The build's benchmark reader, stubbed: ``store[symbol]`` is what the bars store
    holds, ``asked`` is every symbol read."""
    from api.services.screener import snapshot_builder
    store, asked = {}, []

    def read(symbol):
        asked.append(symbol)
        got = store.get(symbol, [])
        if isinstance(got, Exception):
            raise got
        return list(got)
    monkeypatch.setattr(snapshot_builder, "_read_benchmark_bars", read)
    return store, asked


def test_compute_reads_both_series_through_the_build_s_reader(reader):
    store, asked = reader
    store.update(SPY=bars(flat()), QQQ=bars(flat()))
    assert ms.compute(now=NOW) == {"state": "normal", "text": "", "asof": "2026-11-13"}
    assert asked == ["SPY", "QQQ"]


def test_compute_uses_the_spy_bars_it_is_handed_and_reads_only_qqq(reader):
    store, asked = reader
    low = flat()
    low[-1] = 90.0
    store.update(SPY=bars(flat()), QQQ=bars(flat()))        # the store's SPY says normal
    assert ms.compute(spy_bars=bars(low), now=NOW)["state"] == "caution"
    assert asked == ["QQQ"], "SPY is read once per build, by the build"
    # an EMPTY read handed in is a read that found nothing, not a reason to read again
    asked.clear()
    assert ms.compute(spy_bars=[], now=NOW) is None
    assert "SPY" not in asked


def test_a_bar_the_market_is_still_trading_is_never_called_a_close(reader):
    """Monday 11:00 ET: the store already holds a partial Monday bar far below the
    averages. The settled session is Friday, so the state is Friday's."""
    store, _ = reader
    today = datetime.date(2026, 11, 16)
    live = flat(601)
    live[-1] = 50.0
    store.update(SPY=bars(live, end=today), QQQ=bars(live, end=today))
    got = ms.compute(now=datetime.datetime(2026, 11, 16, 11, 0))
    assert got == {"state": "normal", "text": "", "asof": "2026-11-13"}


def test_a_bars_store_that_stopped_claims_no_state(reader):
    store, _ = reader
    # one session behind across the weekend is still described ...
    thursday = datetime.date(2026, 11, 12)
    store.update(SPY=bars(flat(), end=thursday), QQQ=bars(flat(), end=thursday))
    assert ms.compute(now=NOW)["asof"] == "2026-11-12"
    # ... a week behind is not
    old = datetime.date(2026, 11, 6)
    store.update(SPY=bars(flat(), end=old), QQQ=bars(flat(), end=old))
    assert (END - old).days > ms.MAX_AGE_DAYS
    assert ms.compute(now=NOW) is None


def test_compute_never_raises(reader, monkeypatch):
    store, _ = reader
    store.update(SPY=bars(flat()), QQQ=OSError("bars store gone"))
    assert ms.compute(now=NOW) is None
    store.update(SPY=OSError("bars store gone"), QQQ=bars(flat()))
    assert ms.compute(now=NOW) is None
    from api.services.screener import snapshot_builder
    store.update(SPY=bars(flat()), QQQ=bars(flat()))
    monkeypatch.setattr(snapshot_builder, "settled_session", lambda now=None: None)
    assert ms.compute(now=NOW) is None, "no settled session, so no close to describe"


# ───────────────────────── the receipt and the served copy ─────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()


def test_every_pass_keeps_the_state_in_its_receipt_and_it_is_served_from_there(db, reader, monkeypatch):
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    store, asked = reader
    low = flat()
    low[-1] = 99.0
    store.update(SPY=bars(flat()), QQQ=bars(low))
    r = pp.run(source="rating", now=NOW)
    assert r["market"] == {"state": "pressure", "text": PRESSURE_TEXT, "asof": "2026-11-13"}
    assert pp.last_run()["market"] == r["market"]
    assert snapshot_db.status()["rs_post_pass"]["market"]["state"] == "pressure"
    assert ms.served() == {"state": "pressure", "text": PRESSURE_TEXT, "asof": "2026-11-13"}
    # the build's own SPY read is handed on: a pass given it reads QQQ only
    asked.clear()
    assert pp.run(source="build", now=NOW, spy_bars=bars(flat()))["market"]["state"] == "pressure"
    assert asked == ["QQQ"]


def test_a_pass_that_can_claim_no_state_serves_none(db, reader, monkeypatch):
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    store, _ = reader
    store.update(SPY=bars(flat()), QQQ=bars(flat()))
    assert pp.run(source="rating", now=NOW)["market"]["state"] == "normal"
    assert ms.served() == {"state": "normal", "text": "", "asof": "2026-11-13"}
    # the next pass cannot read QQQ: the earlier state is not carried forward
    store["QQQ"] = []
    assert pp.run(source="rating", now=NOW)["market"] is None
    assert ms.served() is None


def test_the_served_words_are_the_module_s_never_a_stored_receipt_s(db, monkeypatch):
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    receipts = []
    monkeypatch.setattr(pp, "last_run", lambda: receipts[-1] if receipts else None)
    assert ms.served() is None                               # no pass has run
    receipts.append({"market": {"state": "caution", "text": "Sell everything", "asof": "2026-11-13"}})
    assert ms.served() == {"state": "caution", "text": CAUTION_TEXT, "asof": "2026-11-13"}
    for bad in ({"state": "panic", "asof": "2026-11-13"}, {"state": "caution"},
                {"state": "caution", "asof": "soon"}, "caution", None, 7):
        receipts.append({"market": bad})
        assert ms.served() is None, bad
    receipts.append({"ok": True})                            # a receipt from before this unit
    assert ms.served() is None


def test_flag_off_nothing_is_read_stored_or_served(db, reader, monkeypatch):
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    store, asked = reader
    store.update(SPY=bars(flat()), QQQ=bars(flat()))
    r = pp.run(source="rating", now=NOW)
    assert r["reason"] == "disabled" and "market" not in r
    assert asked == [], "a dark pass read the bars store"
    assert pp.last_run() is None
    # and a receipt left by an earlier armed pass is not served once the flag is off
    monkeypatch.setattr(pp, "last_run", lambda: {"market": {"state": "caution", "asof": "2026-11-13"}})
    assert ms.served() is None


def test_a_failed_market_read_never_costs_the_pass(db, monkeypatch):
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")

    def boom(**_k):
        raise RuntimeError("market exploded")
    monkeypatch.setattr(ms, "compute", boom)
    r = pp.run(source="rating", now=NOW)
    assert r["market"] is None and "error" not in r
    assert r["reason"] == "no_rows", "the rating half ran as it always does"


# ───────────────────────── the build hands its SPY read on ─────────────────────────

def test_the_build_hands_the_pass_the_spy_bars_it_read(monkeypatch):
    from api.services.screener import snapshot_builder as b
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    seen = {}

    def run(**kw):
        seen.update(kw)
        return {"ok": True, "populated": {}}
    monkeypatch.setattr(pp, "run", run)
    spy = bars(flat(5))
    assert b._rs_post_pass({}, spy_bars=spy) == {"ok": True, "populated": {}}
    assert seen == {"source": "build", "spy_bars": spy}
    # and the build's one call site passes the series it read
    import inspect
    assert "_rs_post_pass(populated, spy_bars=spy_bars)" in inspect.getsource(b._run_build_locked)


# ───────────────────────── the payload ─────────────────────────

def _client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    monkeypatch.setattr(screener_mod.scr_saved, "list_for", lambda uid: [])
    paid = {"id": "u1", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(paid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
    return TestClient(app)


def test_the_saved_screens_payload_carries_rs_market_while_the_screens_are_on(db, reader, monkeypatch):
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    client = _client(monkeypatch)
    # on, and no pass has run yet: the key is there and says nothing
    body = client.get("/api/screener/saved-screens").json()
    assert set(body) == {"saved", "starters", "rs_market"} and body["rs_market"] is None
    store, _ = reader
    low = flat()
    low[-1] = 90.0
    store.update(SPY=bars(low), QQQ=bars(flat()))
    pp.run(source="rating", now=NOW)
    body = client.get("/api/screener/saved-screens").json()
    assert body["rs_market"] == {"state": "caution", "text": CAUTION_TEXT, "asof": "2026-11-13"}


def test_the_saved_screens_payload_has_no_such_key_while_they_are_off(db, monkeypatch):
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    body = _client(monkeypatch).get("/api/screener/saved-screens").json()
    assert set(body) == {"saved", "starters"}
