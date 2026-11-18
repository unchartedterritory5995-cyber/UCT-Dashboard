"""The Flow Record's daily price recording reads Massive, and only Massive.

Owner, 2026-11-17: "Move Flow Record to Massive", then the same day "Move it, fix the status and
remove schwab from everything". `api/top_flow_tracker.py::snapshot_prices` fills each open pick's
daily price and open interest from Massive's single-contract options snapshot. The Schwab backup
and the `TOP_FLOW_SNAPSHOT_SOURCE` switch that chose between them are gone. Past results stay as
recorded: an entry with `src: "schwab"`, or with none, is never rewritten.

What must hold: Massive answers; Massive has nothing (nothing is written, never a 0); Massive raises
or hangs (the job never raises out of its scheduler, and what was already priced is kept); the
stored shape is the one readers know.

No network: Massive's fetch is replaced by a fake, and the real transport raises if anything
reaches it. No sleeps: the pause between batches is recorded, not waited.
"""
from __future__ import annotations

import ast
import asyncio
import copy
import datetime as _dt
import json
import pathlib

import pytest

import api.massive_oi_snapshots as massive
import api.top_flow_tracker as tracker
from api.flow_scoreboard import compute_scoreboard, pick_stats

REPO = pathlib.Path(__file__).resolve().parents[1]
TODAY = _dt.date(2026, 11, 17)
TODAY_STR = "11/17/2026"


class _FakeDate(_dt.date):
    @classmethod
    def today(cls):
        return cls(TODAY.year, TODAY.month, TODAY.day)


# ── fixtures and fakes ────────────────────────────────────────────────────────

def _pick(sym="AAPL", cp="C", strike=200.0, exp="12/18/2026", saved="2026-11-10", entry=5.0, history=None):
    return {"id": f"{sym}|{cp}|{float(strike)}|{exp}", "sym": sym, "cp": cp, "strike": strike, "exp": exp,
            "entry": entry, "grade": "A", "dir": "BULL", "cap": "", "dateSaved": saved, "hits": 1, "prem": 0,
            "history": list(history or [])}


class FakeMassive:
    """Stands in for massive_oi_snapshots._fetch_fields_all_async. `fields` maps the helper's
    own contract key to a field bundle; a key that is absent comes back None (a miss)."""

    def __init__(self, fields=None, raises=None, default=None):
        self.fields = dict(fields or {})
        self.raises = raises
        self.default = default
        self.calls = []

    async def __call__(self, batch):
        batch = list(batch)
        self.calls.append(batch)
        if self.raises is not None:
            raise self.raises
        out = {}
        for sym, cp, strike, exp in batch:
            key = massive._contract_key(sym, cp, strike, exp)
            out[key] = copy.deepcopy(self.fields.get(key, self.default))
        return out

    @property
    def asked(self):
        return [entry for call in self.calls for entry in call]


def _mkey(pick, exp_mdy):
    return massive._contract_key(pick["sym"], pick["cp"], float(pick["strike"]), exp_mdy)


@pytest.fixture
def rig(monkeypatch, tmp_path):
    """The tracker on a temp store, a fixed day, Massive faked, no network, no real sleep."""
    store = tmp_path / "top_flow_picks.json"
    monkeypatch.setattr(tracker, "PICKS_FILE", str(store))
    monkeypatch.setattr(tracker, "_data", {"active": [], "archived": []})
    monkeypatch.setattr(tracker, "_snapshot_running", False)
    monkeypatch.setattr(tracker, "date", _FakeDate)
    monkeypatch.setattr(tracker, "_et_date_str", lambda: TODAY_STR)
    monkeypatch.setattr(massive, "MASSIVE_API_KEY", "test-key-not-a-secret")

    sleeps = []

    async def _no_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(tracker.asyncio, "sleep", _no_sleep)

    def _no_network(*a, **k):
        raise AssertionError("a test reached the network")

    monkeypatch.setattr(massive.urllib.request, "urlopen", _no_network)

    class Rig:
        pass

    r = Rig()
    r.store, r.sleeps, r.patch = store, sleeps, monkeypatch.setattr

    def install(m=None):
        r.massive = m if m is not None else FakeMassive()
        monkeypatch.setattr(massive, "_fetch_fields_all_async", r.massive)
        return r

    def load(*picks):
        tracker._data["active"] = [copy.deepcopy(p) for p in picks]
        tracker._data["archived"] = []
        return tracker._data["active"]

    r.install, r.load = install, load
    r.run = lambda: asyncio.run(tracker.snapshot_prices())
    install()
    return r


M_FIELDS = {"oi": 1500, "mid": 6.25, "last": 6.1, "underlying": 231.4, "volume": 320.0,
            "iv": 0.3, "delta": 0.5, "gamma": 0.01, "theta": -0.1}
ENTRY = {"date": TODAY_STR, "price": 6.25, "oi": 1500, "spot": 231.4, "volume": 320, "src": "massive"}


# ── the retired switch ────────────────────────────────────────────────────────

def test_the_source_switch_is_gone_from_the_code_and_retired_in_the_ledger(rig, monkeypatch):
    for name in ("snapshot_source", "SNAPSHOT_SOURCE_ENV", "SNAPSHOT_SOURCES", "TOP_FLOW_MODE_FLAGS",
                 "SCHWAB_CHUNK_TIMEOUT_S"):
        assert not hasattr(tracker, name), name
    # nothing in the tracker names the variable any more (the repo-wide half of this is the ledger's
    # own rot rail, tests/test_feature_flag_ledger.py, which fails on an entry for an unread gate)
    tree = ast.parse((REPO / "api" / "top_flow_tracker.py").read_text(encoding="utf-8"))
    assert not [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value == "TOP_FLOW_SNAPSHOT_SOURCE"]
    doc = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    assert "TOP_FLOW_SNAPSHOT_SOURCE" not in doc["flags"]
    row = doc["retired"]["TOP_FLOW_SNAPSHOT_SOURCE"]
    assert row["retired"] == "2026-11-17" and row["state"] == "always massive"
    assert "Move it, fix the status and remove schwab from everything" in row["note"]
    # a value still set anywhere is inert: the old rollback value changes nothing
    a = _pick("AAPL")
    active = rig.load(a)
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): M_FIELDS}))
    monkeypatch.setenv("TOP_FLOW_SNAPSHOT_SOURCE", "schwab")
    result = rig.run()
    assert result["source"] == "massive" and active[0]["history"] == [ENTRY]


# ── Massive answers ───────────────────────────────────────────────────────────

def test_massive_prices_every_pick_and_the_entry_has_the_stored_shape(rig):
    a, b = _pick("AAPL"), _pick("NVDA", cp="P", strike=120.0)
    active = rig.load(a, b)
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): M_FIELDS,
                             _mkey(b, "12/18/2026"): {"oi": 0, "mid": None, "last": 3.1, "underlying": None}}))
    result = rig.run()

    assert result == {"status": "ok", "date": TODAY_STR, "source": "massive", "saved": 2,
                      "by_source": {"massive": 2}, "skipped": 0, "errors": 0, "live": 2, "total": 2}
    assert active[0]["history"] == [ENTRY]
    assert list(active[0]["history"][0]) == ["date", "price", "oi", "spot", "volume", "src"]
    # last trade when there is no midpoint; a true 0 OI is kept; what Massive did not send is null
    assert active[1]["history"] == [{"date": TODAY_STR, "price": 3.1, "oi": 0, "spot": None,
                                     "volume": None, "src": "massive"}]
    assert json.loads(rig.store.read_text(encoding="utf-8"))["active"][0]["history"] == [ENTRY]


def test_a_same_day_rerun_overwrites_the_days_entry_and_adds_no_second(rig):
    a = _pick("AAPL", history=[{"date": "11/16/2026", "price": 5.9, "oi": 1200, "spot": 229.0, "volume": 10}])
    active = rig.load(a)
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): M_FIELDS}))
    rig.run()
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): {**M_FIELDS, "mid": 7.0}}))
    rig.run()
    hist = active[0]["history"]
    assert [h["date"] for h in hist] == ["11/16/2026", TODAY_STR]
    assert hist[1]["price"] == 7.0
    assert hist[0] == {"date": "11/16/2026", "price": 5.9, "oi": 1200, "spot": 229.0, "volume": 10}   # untouched


def test_the_expiry_reaches_massive_as_M_D_YYYY_including_a_year_less_one(rig):
    full = _pick("AAPL", exp="12/18/2026")
    short = _pick("NVDA", exp="1/15", saved="2026-11-10")            # January 2027
    padded = _pick("TSLA", exp="01/15/27")
    rig.load(full, short, padded)
    rig.install(FakeMassive(default=M_FIELDS))
    rig.run()
    assert sorted(rig.massive.asked) == sorted([("AAPL", "C", 200.0, "12/18/2026"),
                                                ("NVDA", "C", 200.0, "1/15/2027"),
                                                ("TSLA", "C", 200.0, "1/15/2027")])


def test_the_cap_the_chunks_and_the_pause_are_the_sweeps_own(rig):
    assert (tracker.SNAPSHOT_CAP, tracker.SNAPSHOT_CHUNK, tracker.SNAPSHOT_CHUNK_PAUSE_S) == (200, 50, 2)
    assert massive.MAX_CONCURRENCY <= 20        # no looser than the Schwab chain bound this replaced
    picks = [_pick(f"S{i:03d}", saved=f"2026-{1 + i % 11:02d}-{1 + i % 27:02d}") for i in range(230)]
    active = rig.load(*picks)
    rig.install(FakeMassive(default=M_FIELDS))
    result = rig.run()

    assert [len(c) for c in rig.massive.calls] == [50, 50, 50, 50]
    assert rig.sleeps == [2, 2, 2]                          # between chunks, not after the last
    assert result["live"] == 200 and result["total"] == 230 and result["saved"] == 200
    priced = {p["id"] for p in active if p["history"]}
    newest = {p["id"] for p in sorted(active, key=lambda p: p["dateSaved"], reverse=True)[:200]}
    assert priced == newest                                 # the 200 newest by save date


# ── Massive has nothing: nothing is written, never a 0 ────────────────────────

SCHWAB_ERA = [{"date": "11/13/2026", "price": 5.5, "oi": 900, "spot": 228.0, "volume": 40},
              {"date": "11/16/2026", "price": 5.9, "oi": 950, "spot": 229.0, "volume": 55, "src": "schwab"}]


@pytest.mark.parametrize("fields", [None, {}, {"oi": 1200, "mid": None, "last": None, "underlying": 230.0},
                                    {"oi": 1200, "mid": 0, "last": 0}, {"mid": "n/a", "last": -1}])
def test_no_usable_price_from_massive_leaves_the_history_untouched(rig, fields):
    a = _pick("AAPL", history=SCHWAB_ERA)
    b = _pick("NVDA")
    active = rig.load(a, b)
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): fields, _mkey(b, "12/18/2026"): M_FIELDS}))
    result = rig.run()

    assert active[0]["history"] == SCHWAB_ERA               # the Schwab-era entries, exactly as recorded
    assert active[1]["history"] == [ENTRY]
    assert (result["saved"], result["skipped"], result["errors"]) == (1, 1, 0)
    assert all(h.get("price") for p in active for h in p["history"])      # no 0 was ever written


def test_when_massive_prices_nothing_the_store_is_not_rewritten(rig):
    a = _pick("AAPL", history=SCHWAB_ERA)
    active = rig.load(a)
    rig.install(FakeMassive())
    result = rig.run()
    assert active[0]["history"] == SCHWAB_ERA and result["saved"] == 0 and result["skipped"] == 1
    assert not rig.store.exists()


def test_a_pick_massive_cannot_address_is_skipped_not_guessed(rig):
    bad_cp = _pick("AAPL", cp="X")
    bad_exp = _pick("NVDA", exp="bad")
    ok = _pick("TSLA")
    active = rig.load(bad_cp, bad_exp, ok)
    rig.install(FakeMassive(default=M_FIELDS))
    result = rig.run()
    assert rig.massive.asked == [("TSLA", "C", 200.0, "12/18/2026")]
    assert [p["history"] for p in active if p["sym"] != "TSLA"] == [[], []]
    assert result["saved"] == 1 and result["skipped"] == 2


def test_without_a_massive_key_nothing_is_asked_and_nothing_is_written(rig, monkeypatch):
    monkeypatch.setattr(massive, "MASSIVE_API_KEY", "")
    a = _pick("AAPL", history=SCHWAB_ERA)
    active = rig.load(a)
    assert rig.run() == {"status": "error", "reason": "MASSIVE_API_KEY not set"}
    assert rig.massive.calls == [] and active[0]["history"] == SCHWAB_ERA and not rig.store.exists()


# ── Massive raises or hangs: the job never raises out of its scheduler ────────

@pytest.mark.parametrize("boom", [RuntimeError("vendor down"), TimeoutError(), KeyError("x"), ValueError("bad")])
def test_massive_raising_writes_nothing_and_the_job_returns(rig, boom):
    picks = [_pick(f"S{i:02d}", history=SCHWAB_ERA) for i in range(60)]
    active = rig.load(*picks)
    rig.install(FakeMassive(raises=boom))
    result = rig.run()                                       # returned, not raised
    assert result["status"] == "ok" and result["saved"] == 0 and result["errors"] == 60
    assert len(rig.massive.calls) == 2                       # every chunk is still tried
    assert all(p["history"] == SCHWAB_ERA for p in active)


def test_a_massive_call_that_never_returns_cannot_wedge_the_sweep(rig, monkeypatch):
    monkeypatch.setattr(tracker, "MASSIVE_CHUNK_TIMEOUT_S", 0.05)
    release = asyncio.Event

    async def _hang(batch):
        await release().wait()                               # never set

    a = _pick("AAPL", history=SCHWAB_ERA)
    active = rig.load(a)
    rig.patch(massive, "_fetch_fields_all_async", _hang)
    result = rig.run()
    assert result["status"] == "ok" and result["errors"] == 1 and active[0]["history"] == SCHWAB_ERA
    assert tracker.snapshot_in_flight() is False


def test_a_failure_after_some_picks_were_priced_still_keeps_them(rig):
    picks = [_pick(f"S{i:03d}", saved=f"2026-11-{10 + i // 50:02d}") for i in range(100)]
    active = rig.load(*picks)
    calls = {"n": 0}

    async def _second_chunk_fails(batch):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("vendor down")
        return {massive._contract_key(*e): M_FIELDS for e in batch}

    rig.patch(massive, "_fetch_fields_all_async", _second_chunk_fails)
    result = rig.run()
    assert (result["saved"], result["errors"]) == (50, 50)
    assert sum(1 for p in active if p["history"]) == 50
    assert sum(1 for p in json.loads(rig.store.read_text(encoding="utf-8"))["active"] if p["history"]) == 50


def test_one_sweep_at_a_time(rig):
    a = _pick("AAPL")
    rig.load(a)
    seen = {}

    async def _slow_massive(batch):
        seen["second"] = await tracker.snapshot_prices()    # a second sweep asked for mid-run
        seen["in_flight"] = tracker.snapshot_in_flight()
        return {massive._contract_key(*batch[0]): M_FIELDS}

    rig.patch(massive, "_fetch_fields_all_async", _slow_massive)
    first = rig.run()
    assert seen["second"] == {"status": "skipped", "reason": "a snapshot is already running"}
    assert seen["in_flight"] is True
    assert first["status"] == "ok" and first["saved"] == 1
    assert tracker.snapshot_in_flight() is False            # released, also after a failure:

    def _boom():
        raise RuntimeError("the sweep itself blew up")

    rig.patch(tracker, "archive_expired", _boom)
    assert rig.run() == {"status": "error", "reason": "RuntimeError"}
    assert tracker.snapshot_in_flight() is False


def test_no_picks_and_all_expired_are_skips(rig):
    assert rig.run() == {"status": "skipped", "reason": "no active picks"}
    rig.load(_pick("AAPL", exp="11/14/2026"))
    assert rig.run() == {"status": "skipped", "reason": "all picks expired"}
    assert rig.massive.calls == []


# ── a year-less expiry takes its year from the day the pick was saved ─────────

@pytest.mark.parametrize("exp,saved,want", [
    ("1/15", _dt.date(2026, 11, 17), _dt.date(2027, 1, 15)),       # the defect: was read as 2026-01-15
    ("12/18", _dt.date(2026, 11, 17), _dt.date(2026, 12, 18)),
    ("11/17", _dt.date(2026, 11, 17), _dt.date(2026, 11, 17)),      # expiring the day it was saved
    ("11/16", _dt.date(2026, 11, 17), _dt.date(2027, 11, 16)),
    ("2/29", _dt.date(2026, 11, 17), _dt.date(2028, 2, 29)),
    ("6/20/2026", _dt.date(2026, 11, 17), _dt.date(2026, 6, 20)),    # a stated year is never second-guessed
    ("6/20/26", None, _dt.date(2026, 6, 20)),
    ("06/05/2027", None, _dt.date(2027, 6, 5)),
])
def test_resolve_expiry(exp, saved, want):
    assert tracker.resolve_expiry(exp, saved, TODAY) == want


def test_resolve_expiry_without_a_save_date_keeps_the_old_reading_and_rejects_junk():
    assert tracker.resolve_expiry("1/15", None, TODAY) == _dt.date(2026, 1, 15)
    for junk in ("", None, "6", "a/b", "13/45", "2/30/2026", "6/20/x", 620):
        assert tracker.resolve_expiry(junk, _dt.date(2026, 11, 17), TODAY) is None, junk


def test_a_january_contract_saved_in_november_is_not_archived(rig):
    jan = _pick("AAPL", exp="1/15", saved="2026-11-10")              # January 2027
    old = _pick("NVDA", exp="6/20", saved="2026-05-01")              # June 2026: over
    dec = _pick("TSLA", exp="12/18", saved="2025-12-01",             # December 2025: over, though 12/18 is ahead
                history=[{"date": "12/17/2025", "price": 2.0, "oi": 5}])
    stated = _pick("AMD", exp="1/15/2026", saved="2025-12-01")       # a stated past year: over
    undated = _pick("MSFT", exp="bad")
    rig.load(jan, old, dec, stated, undated)

    assert tracker.archive_expired() == 3
    assert [p["sym"] for p in tracker._data["active"]] == ["AAPL", "MSFT"]
    archived = {p["sym"]: p for p in tracker._data["archived"]}
    assert set(archived) == {"NVDA", "TSLA", "AMD"}
    assert archived["TSLA"]["finalPrice"] == 2.0 and archived["TSLA"]["finalPnl"] == -60.0

    # and the sweep prices the January contract as January 2027
    rig.install(FakeMassive())
    rig.run()
    assert ("AAPL", "C", 200.0, "1/15/2027") in rig.massive.asked


# ── the scoreboard reads a Schwab-era history and a Massive one the same way ──

@pytest.mark.parametrize("ois", [(1000, 1050, 1300), (None, 1050, 1300), (1000, None, 900)])
def test_equal_prices_score_the_same_whichever_vendor_recorded_them(rig, monkeypatch, ois):
    prices = (5.5, 4.0, 7.75)
    days = ("11/13/2026", "11/16/2026", "11/17/2026")
    pick = _pick("AAPL", entry=5.0)
    active = rig.load(pick)
    for day, price, oi in zip(days, prices, ois):
        monkeypatch.setattr(tracker, "_et_date_str", lambda day=day: day)
        rig.install(FakeMassive({_mkey(pick, "12/18/2026"): {"oi": oi, "mid": price, "last": None,
                                                              "underlying": 230.0}}))
        rig.run()
    from_massive = copy.deepcopy(active[0])
    # the same three days as the Schwab job stored them before 2026-11-17 (0 for a missing OI, no src)
    from_schwab = _pick("AAPL", entry=5.0, history=[
        {"date": d, "price": p, "oi": o or 0, "spot": 230.0, "volume": 555} for d, p, o in zip(days, prices, ois)])

    assert {h["src"] for h in from_massive["history"]} == {"massive"}
    assert [h["volume"] for h in from_massive["history"]] == [None, None, None]      # null, never 0
    a, b = pick_stats(from_massive), pick_stats(from_schwab)
    assert a is not None and a == b
    assert a["max_gain_pct"] == 55.0 and a["current_gain_pct"] == 55.0
    board_a = compute_scoreboard([from_massive], today=TODAY)
    board_b = compute_scoreboard([from_schwab], today=TODAY)
    for key in ("picks_tracked", "too_new", "overall", "by_grade", "recent_winners", "recent_picks", "window"):
        assert board_a[key] == board_b[key], key


def test_every_reader_of_history_takes_a_null_volume_spot_and_oi(rig):
    """The readers: flow_scoreboard.pick_stats (price, oi), the tracker's own
    _find_closest_price (price) and archive_expired / purge-old (the last price)."""
    hist = [{"date": "11/13/2026", "price": 5.5, "oi": None, "spot": None, "volume": None, "src": "massive"},
            {"date": "11/16/2026", "price": 6.5, "oi": None, "spot": None, "volume": None, "src": "massive"}]
    pick = _pick("AAPL", exp="11/14/2026", entry=5.0, history=hist)
    stats = pick_stats(pick)
    assert stats["max_gain_pct"] == 30.0 and stats["oi_evaluable"] is False and stats["oi_confirmed"] is False
    assert tracker._find_closest_price(hist, _dt.date(2026, 11, 13)) == (5.5, "11/13/2026")
    rig.load(pick)
    assert tracker.archive_expired() == 1
    assert tracker._data["archived"][0]["finalPrice"] == 6.5 and tracker._data["archived"][0]["finalPnl"] == 30.0


def test_the_scheduler_still_calls_this_job_and_only_web_starts_the_scheduler():
    """The 4:30 PM ET loop is daily_tracker._snapshot_loop; api/main.py's lifespan is the only
    place that starts it, and flow-worker mounts neither the tracker's routes nor that loop."""
    loop_src = (REPO / "api" / "daily_tracker.py").read_text(encoding="utf-8")
    assert "from api.top_flow_tracker import snapshot_prices as _tf_snapshot" in loop_src
    starters = [p.name for p in (REPO / "api").glob("*.py")
                if "start_snapshot_scheduler()" in p.read_text(encoding="utf-8", errors="replace")
                and p.name != "daily_tracker.py"]
    assert starters == ["main.py"]
    mount_src = (REPO / "api" / "flow_router_mount.py").read_text(encoding="utf-8")
    assert "api.top_flow_router" not in mount_src and "api.flow_scoreboard" not in mount_src
