"""The Flow Record's daily price recording reads Massive first, Schwab as the backup.

Owner ruling 2026-11-17 (verbatim): "Move Flow Record to Massive". The job is
api.top_flow_tracker.snapshot_prices (4:30 PM ET each weekday, and the manual
POST /api/top-flow/snapshot). This file makes no ruling; it holds the code to that one.

Both vendors are faked. Nothing here can reach a network: the two fetch functions the
tracker imports are replaced, and urllib / httpx are tripwired on top of that.

  massive (default) : Massive for every pick; Schwab only for the picks Massive had no
                      usable price for, and only while Schwab is signed in.
  schwab            : the path before the ruling, held against a frozen copy of it.
"""
from __future__ import annotations

import asyncio
import copy
import datetime as _dt
import json
import pathlib
import time

import pytest

import api.massive_oi_snapshots as massive
import api.schwab_service as schwab
import api.top_flow_tracker as tracker
from api.flow_scoreboard import compute_scoreboard, pick_stats
from api.services import feature_flag_index as ffi

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


class FakeSchwab:
    """Stands in for schwab_service.get_batch_option_quotes. `quotes` maps
    (symbol, cp, strike, expDate ISO) to a quote; anything else is a no-match error."""

    def __init__(self, quotes=None, signed_in=True, raises=None, default=None):
        self.quotes = dict(quotes or {})
        self.signed_in = signed_in
        self.raises = raises
        self.default = default
        self.calls = []

    async def __call__(self, contracts):
        contracts = [dict(c) for c in contracts]
        self.calls.append(contracts)
        if self.raises is not None:
            raise self.raises
        if not self.signed_in:
            return [{"error": "Not authenticated"}] * len(contracts)
        out = []
        for c in contracts:
            q = self.quotes.get((c["symbol"], c["cp"], float(c["strike"]), c["expDate"]), self.default)
            out.append(copy.deepcopy(q) if q is not None else {"symbol": c["symbol"], "error": "No match"})
        return out

    @property
    def asked(self):
        return [c for call in self.calls for c in call]


def _mkey(pick, exp_mdy):
    return massive._contract_key(pick["sym"], pick["cp"], float(pick["strike"]), exp_mdy)


def _skey(pick, exp_iso):
    return (pick["sym"], pick["cp"], float(pick["strike"]), exp_iso)


@pytest.fixture
def rig(monkeypatch, tmp_path):
    """The tracker on a temp store, a fixed day, both vendors faked, no network, no real sleep."""
    store = tmp_path / "top_flow_picks.json"
    monkeypatch.setattr(tracker, "PICKS_FILE", str(store))
    monkeypatch.setattr(tracker, "_data", {"active": [], "archived": []})
    monkeypatch.setattr(tracker, "_snapshot_running", False)
    monkeypatch.setattr(tracker, "date", _FakeDate)
    monkeypatch.setattr(tracker, "_et_date_str", lambda: TODAY_STR)
    monkeypatch.delenv(tracker.SNAPSHOT_SOURCE_ENV, raising=False)
    monkeypatch.setattr(massive, "MASSIVE_API_KEY", "test-key-not-a-secret")

    sleeps = []

    async def _no_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(tracker.asyncio, "sleep", _no_sleep)

    def _no_network(*a, **k):
        raise AssertionError("a test reached the network")

    monkeypatch.setattr(massive.urllib.request, "urlopen", _no_network)
    monkeypatch.setattr(schwab.httpx, "AsyncClient", _no_network)

    class Rig:
        pass

    r = Rig()
    r.store, r.sleeps, r.patch = store, sleeps, monkeypatch.setattr

    def install(m=None, s=None):
        r.massive = m if m is not None else FakeMassive()
        r.schwab = s if s is not None else FakeSchwab()
        monkeypatch.setattr(massive, "_fetch_fields_all_async", r.massive)
        monkeypatch.setattr(schwab, "get_batch_option_quotes", r.schwab)
        return r

    def load(*picks):
        tracker._data["active"] = [copy.deepcopy(p) for p in picks]
        tracker._data["archived"] = []
        return tracker._data["active"]

    r.install, r.load = install, load
    r.run = lambda: asyncio.run(tracker.snapshot_prices())
    install()
    return r


M_FIELDS = {"oi": 1500, "mid": 6.25, "last": 6.1, "underlying": 231.4, "iv": 0.3, "delta": 0.5, "gamma": 0.01, "theta": -0.1}
S_QUOTE = {"symbol": "AAPL", "mark": 6.3, "last": 6.2, "openInterest": 1400, "underlyingPrice": 231.5, "volume": 320}


# ── the flag ──────────────────────────────────────────────────────────────────

def test_the_default_is_massive_and_an_unknown_value_means_the_default(monkeypatch):
    assert tracker.TOP_FLOW_MODE_FLAGS == {"TOP_FLOW_SNAPSHOT_SOURCE": ("massive", ("massive", "schwab"))}
    monkeypatch.delenv("TOP_FLOW_SNAPSHOT_SOURCE", raising=False)
    assert tracker.snapshot_source() == "massive"
    for raw, want in (("schwab", "schwab"), (" Schwab ", "schwab"), ("MASSIVE", "massive"), ("", "massive"),
                      ("shadow", "massive"), ("polygon", "massive"), ("0", "massive")):
        monkeypatch.setenv("TOP_FLOW_SNAPSHOT_SOURCE", raw)
        assert tracker.snapshot_source() == want, raw


def test_the_flag_index_sees_it_and_the_ledger_states_what_the_code_does(tmp_path):
    # the index walks a tree; a copy of the one file keeps this quick (the whole-repo walk is
    # tests/test_feature_flag_ledger.py's job)
    (tmp_path / "api").mkdir()
    (tmp_path / "api" / "top_flow_tracker.py").write_bytes((REPO / "api" / "top_flow_tracker.py").read_bytes())
    found = ffi.mode_flags([tmp_path / "api"], tmp_path)
    assert found["TOP_FLOW_SNAPSHOT_SOURCE"]["default"] == "massive"
    assert found["TOP_FLOW_SNAPSHOT_SOURCE"]["allowed"] == ("massive", "schwab")
    sites = [pathlib.PurePath(s).as_posix() for s in found["TOP_FLOW_SNAPSHOT_SOURCE"]["sites"]]
    assert sites == ["api/top_flow_tracker.py"]
    # the same name is what the per-run reader looks up, so the index and the reader cannot drift
    assert tracker.SNAPSHOT_SOURCE_ENV == "TOP_FLOW_SNAPSHOT_SOURCE"
    assert "TOP_FLOW_SNAPSHOT_SOURCE" in ffi.scan([tmp_path / "api"], tmp_path)
    led = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]["TOP_FLOW_SNAPSHOT_SOURCE"]
    assert led["default"] == "massive" and led["values"] == ["massive", "schwab"]
    # not set on any service: the code default is what runs
    assert led["status"] == "dark" and led["where"] == [] and led["since"] == "2026-11-17"
    note = led["note"]
    for said in ('"Move Flow Record to Massive"', "NOT SET ON ANY SERVICE", "nothing is off",
                 "schwab = the path before the ruling", "Rollback: set TOP_FLOW_SNAPSHOT_SOURCE=schwab"):
        assert said in note, said


# ── massive mode ──────────────────────────────────────────────────────────────

def test_massive_prices_everything_and_schwab_is_never_called(rig):
    a, b = _pick("AAPL"), _pick("NVDA", "P", 150.0, "1/15/2027")
    active = rig.load(a, b)
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): M_FIELDS,
                             _mkey(b, "1/15/2027"): dict(M_FIELDS, mid=None, last=3.2, oi=0, underlying=None)}))
    result = rig.run()

    assert rig.schwab.calls == []
    assert len(rig.massive.calls) == 1
    assert result["status"] == "ok" and result["source"] == "massive"
    assert result["saved"] == 2 and result["by_source"] == {"massive": 2, "schwab": 0}
    assert result["skipped"] == 0 and result["errors"] == 0
    # price = the midpoint, else the last trade; volume is null, never 0; src says who priced it
    assert active[0]["history"] == [
        {"date": TODAY_STR, "price": 6.25, "oi": 1500, "spot": 231.4, "volume": None, "src": "massive"}]
    # a real OI of 0 is kept as 0; a missing underlying is null
    assert active[1]["history"] == [
        {"date": TODAY_STR, "price": 3.2, "oi": 0, "spot": None, "volume": None, "src": "massive"}]
    # and it reached the disk
    on_disk = json.loads(rig.store.read_text(encoding="utf-8"))
    assert on_disk["active"][0]["history"][0]["volume"] is None
    assert on_disk["active"][0]["history"][0]["src"] == "massive"


def test_only_the_picks_massive_missed_go_to_schwab(rig):
    a, b, c, d = _pick("AAPL"), _pick("NVDA"), _pick("TSLA"), _pick("AMD")
    active = rig.load(a, b, c, d)
    rig.install(
        FakeMassive({_mkey(a, "12/18/2026"): M_FIELDS,
                     _mkey(b, "12/18/2026"): None,                                   # no snapshot at all
                     _mkey(c, "12/18/2026"): dict(M_FIELDS, mid=0.0, last=None),     # a snapshot with no price
                     _mkey(d, "12/18/2026"): dict(M_FIELDS, mid=2.0)}),
        FakeSchwab({_skey(b, "2026-12-18"): dict(S_QUOTE, symbol="NVDA"),
                    _skey(c, "2026-12-18"): dict(S_QUOTE, symbol="TSLA", mark=0, last=4.4, openInterest=0)}))
    result = rig.run()

    assert [(q["symbol"], q["expDate"]) for q in rig.schwab.asked] == [("NVDA", "2026-12-18"), ("TSLA", "2026-12-18")]
    assert len(rig.schwab.calls) == 1
    assert [h["history"][0]["src"] for h in active] == ["massive", "schwab", "schwab", "massive"]
    assert active[1]["history"][0] == {"date": TODAY_STR, "price": 6.3, "oi": 1400, "spot": 231.5,
                                       "volume": 320, "src": "schwab"}
    assert active[2]["history"][0]["price"] == 4.4          # Schwab: mark or last
    assert result["by_source"] == {"massive": 2, "schwab": 2} and result["saved"] == 4


def test_massive_raising_sends_the_whole_batch_to_schwab(rig):
    picks = [_pick("AAPL"), _pick("NVDA")]
    active = rig.load(*picks)
    rig.install(FakeMassive(raises=RuntimeError("massive is down")),
                FakeSchwab(default=S_QUOTE))
    result = rig.run()

    assert len(rig.massive.calls) == 1
    assert [q["symbol"] for q in rig.schwab.asked] == ["AAPL", "NVDA"]
    assert all(p["history"][0]["src"] == "schwab" for p in active)
    assert result["status"] == "ok" and result["by_source"] == {"massive": 0, "schwab": 2}


def test_a_slow_massive_times_out_and_the_batch_goes_to_schwab(rig, monkeypatch):
    async def _hangs(batch):
        await asyncio.Event().wait()

    active = rig.load(_pick("AAPL"))
    rig.install(s=FakeSchwab(default=S_QUOTE))
    monkeypatch.setattr(massive, "_fetch_fields_all_async", _hangs)
    monkeypatch.setattr(tracker, "MASSIVE_CHUNK_TIMEOUT_S", 0.05)
    result = rig.run()
    assert active[0]["history"][0]["src"] == "schwab" and result["by_source"]["schwab"] == 1


def test_without_a_massive_key_massive_is_never_called(rig, monkeypatch):
    monkeypatch.setattr(massive, "MASSIVE_API_KEY", "")
    active = rig.load(_pick("AAPL"))
    rig.install(FakeMassive(default=M_FIELDS), FakeSchwab(default=S_QUOTE))
    rig.run()
    assert rig.massive.calls == [] and active[0]["history"][0]["src"] == "schwab"


def test_schwab_signed_out_and_massive_missing_leaves_the_history_untouched(rig):
    before = [{"date": "11/14/2026", "price": 5.5, "oi": 900, "spot": 228.0, "volume": 40}]
    a = _pick("AAPL", history=before)
    b = _pick("NVDA")
    active = rig.load(a, b)
    rig.install(FakeMassive({_mkey(b, "12/18/2026"): M_FIELDS}), FakeSchwab(signed_in=False))
    result = rig.run()

    assert active[0]["history"] == before                   # nothing appended, nothing rewritten, no 0
    assert active[1]["history"][0]["src"] == "massive"
    assert result["saved"] == 1 and result["skipped"] == 1
    on_disk = json.loads(rig.store.read_text(encoding="utf-8"))
    assert on_disk["active"][0]["history"] == before


def test_neither_source_has_a_price_so_nothing_is_written_never_a_zero(rig):
    a = _pick("AAPL")
    active = rig.load(a)
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): dict(M_FIELDS, mid=0, last=0)}),
                FakeSchwab({_skey(a, "2026-12-18"): dict(S_QUOTE, mark=0, last=0)}))
    result = rig.run()
    assert active[0]["history"] == []
    assert result["saved"] == 0 and result["skipped"] == 1
    assert not rig.store.exists()                           # nothing priced, so the store is not rewritten


def test_once_schwab_says_it_is_signed_out_the_run_stops_asking_it(rig):
    active = rig.load(*[_pick(f"S{i:03d}", saved=f"2026-11-{1 + i % 9:02d}") for i in range(120)])
    rig.install(FakeMassive(), FakeSchwab(signed_in=False))
    result = rig.run()
    assert len(rig.massive.calls) == 3                      # 50 + 50 + 20
    assert len(rig.schwab.calls) == 1                       # the first chunk learned it; the rest did not ask
    assert all(p["history"] == [] for p in active)
    assert result["saved"] == 0 and result["skipped"] == 120


def test_a_same_day_rerun_overwrites_the_days_entry_and_adds_no_second(rig):
    earlier = {"date": "11/14/2026", "price": 5.5, "oi": 900, "spot": 228.0, "volume": 40}
    a = _pick("AAPL", history=[earlier])
    active = rig.load(a)
    rig.install(FakeMassive({_mkey(a, "12/18/2026"): M_FIELDS}))
    rig.run()
    assert [h["date"] for h in active[0]["history"]] == ["11/14/2026", TODAY_STR]

    # later the same day: Massive has nothing now, Schwab does. Still one entry for the day.
    rig.install(FakeMassive(), FakeSchwab({_skey(a, "2026-12-18"): S_QUOTE}))
    rig.run()
    hist = active[0]["history"]
    assert [h["date"] for h in hist] == ["11/14/2026", TODAY_STR]
    assert hist[0] == earlier                               # an earlier day is never rewritten, and gains no src
    assert hist[1]["src"] == "schwab" and hist[1]["price"] == 6.3


def test_the_expiry_reaches_massive_as_M_D_YYYY_including_a_year_less_one(rig):
    full = _pick("AAPL", exp="12/18/2026")
    padded = _pick("NVDA", exp="01/15/27")                  # leading zero, two-digit year
    yearless_next = _pick("TSLA", exp="1/15", saved="2026-11-10")      # saved in November: next January
    yearless_this = _pick("AMD", exp="12/18", saved="11/10/2026")      # saved date in M/D/YYYY
    lower = _pick("msft", cp="c", exp="12/18/2026")
    active = rig.load(full, padded, yearless_next, yearless_this, lower)
    rig.install(FakeMassive(default=M_FIELDS))
    rig.run()

    assert sorted(rig.massive.asked) == sorted([
        ("AAPL", "C", 200.0, "12/18/2026"),
        ("NVDA", "C", 200.0, "1/15/2027"),
        ("TSLA", "C", 200.0, "1/15/2027"),
        ("AMD", "C", 200.0, "12/18/2026"),
        ("MSFT", "C", 200.0, "12/18/2026"),
    ])
    # each is a contract the helper can address, in the canonical form it indexes by
    for sym, cp, strike, exp in rig.massive.asked:
        assert massive._canon_mdy(exp) == exp
        assert massive._occ_symbol(sym, cp, strike, exp)
    assert massive._occ_symbol("TSLA", "C", 200.0, "1/15/2027") == "O:TSLA270115C00200000"
    assert all(len(p["history"]) == 1 for p in active) and rig.schwab.calls == []


def test_a_pick_massive_cannot_address_is_left_to_schwab(rig):
    odd_cp = _pick("AAPL", cp="X")
    no_exp = _pick("NVDA", exp="")
    ok = _pick("TSLA")
    rig.load(odd_cp, no_exp, ok)
    rig.install(FakeMassive(default=M_FIELDS), FakeSchwab())
    result = rig.run()
    assert rig.massive.asked == [("TSLA", "C", 200.0, "12/18/2026")]
    assert [q["symbol"] for q in rig.schwab.asked] == ["AAPL", "NVDA"]
    assert [q["expDate"] for q in rig.schwab.asked] == ["2026-12-18", ""]
    assert result["saved"] == 1 and result["skipped"] == 2


# ── pacing: no looser than the Schwab sweep ───────────────────────────────────

def test_the_cap_the_chunks_and_the_pause_are_the_schwab_sweeps_own(rig):
    assert (tracker.SNAPSHOT_CAP, tracker.SNAPSHOT_CHUNK, tracker.SNAPSHOT_CHUNK_PAUSE_S) == (200, 50, 2)
    assert massive.MAX_CONCURRENCY <= 20                    # Schwab's own chain bound (_CHAIN_SEMAPHORE)
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


# ── the job never raises ──────────────────────────────────────────────────────

def test_the_job_never_raises_whatever_the_vendors_do(rig):
    a = _pick("AAPL", history=[{"date": "11/14/2026", "price": 5.5, "oi": 900}])
    active = rig.load(a, _pick("NVDA"))
    before = copy.deepcopy(active)

    rig.install(FakeMassive(raises=ValueError("boom")), FakeSchwab(raises=RuntimeError("bang")))
    result = rig.run()
    assert result["status"] == "ok" and result["saved"] == 0 and result["errors"] == 2
    assert active == before                                 # both failed: the store is untouched

    # vendors answering in shapes nobody promised
    rig.install(FakeMassive(default="not a dict"), FakeSchwab(default="nor is this"))
    assert rig.run()["saved"] == 0 and active == before

    async def _wrong_type(batch):
        return ["a list, not a mapping"]

    async def _none(contracts):
        return None

    rig.patch(massive, "_fetch_fields_all_async", _wrong_type)
    rig.patch(schwab, "get_batch_option_quotes", _none)
    result = rig.run()
    assert result["status"] == "ok" and result["saved"] == 0 and result["skipped"] == 2 and active == before


@pytest.mark.parametrize("mode", ["massive", "schwab"])
def test_a_schwab_call_that_never_returns_cannot_wedge_the_sweep(rig, monkeypatch, mode):
    """The sweep is single-flight, so a vendor call that hung would block every later one."""
    monkeypatch.setenv("TOP_FLOW_SNAPSHOT_SOURCE", mode)
    monkeypatch.setattr(tracker, "SCHWAB_CHUNK_TIMEOUT_S", 0.05)

    async def _hangs(contracts):
        await asyncio.Event().wait()

    active = rig.load(_pick("AAPL"), _pick("NVDA"))
    rig.install(FakeMassive())                              # Massive has nothing: both go to Schwab
    rig.patch(schwab, "get_batch_option_quotes", _hangs)
    began = time.monotonic()
    result = rig.run()
    assert time.monotonic() - began < 3                     # cut at the stated bound, not left to hang
    assert result["status"] == "ok" and result["saved"] == 0 and result["errors"] == 2
    assert all(p["history"] == [] for p in active)
    assert tracker.snapshot_in_flight() is False


def test_a_malformed_pick_does_not_stop_the_others(rig):
    good = _pick("AAPL")
    bad = {"id": "junk", "exp": "not/a/date", "dateSaved": None}      # no sym, no cp, no strike
    active = rig.load(bad, good)
    rig.install(FakeMassive({_mkey(good, "12/18/2026"): M_FIELDS}), FakeSchwab())
    result = rig.run()
    assert result["status"] == "ok"
    assert active[1]["history"][0]["src"] == "massive" and "history" not in active[0]


def test_a_failure_after_some_picks_were_priced_still_keeps_them(rig, monkeypatch):
    picks = [_pick(f"S{i:03d}") for i in range(60)]
    rig.load(*picks)
    rig.install(FakeMassive(default=M_FIELDS))

    async def _dies(seconds):
        raise RuntimeError("the pause between chunks failed")

    monkeypatch.setattr(tracker.asyncio, "sleep", _dies)
    result = rig.run()
    assert result == {"status": "error", "reason": "RuntimeError"}
    on_disk = json.loads(rig.store.read_text(encoding="utf-8"))
    assert sum(1 for p in on_disk["active"] if p["history"]) == 50       # the first chunk was saved


# ── schwab mode is the path before the ruling ─────────────────────────────────

async def _pre_change_snapshot(data, get_batch_option_quotes, today, today_str, sleep):
    """The snapshot loop exactly as it stood before 2026-11-17 (the body of
    top_flow_tracker.snapshot_prices at commit 9da4a1a0ca), frozen here as the reference
    `schwab` mode is held against. Two mechanical differences, neither a behaviour: the day
    string and the clock are passed in, and archive_expired() is not repeated (the caller
    runs the same one first)."""
    active = data.get("active", [])

    def _exp_to_iso(exp_str):
        parts = exp_str.split("/")
        if len(parts) < 2:
            return ""
        m, d = int(parts[0]), int(parts[1])
        if len(parts) >= 3:
            y = int(parts[2])
            if y < 100:
                y += 2000
        else:
            y = today.year
            if _dt.date(y, m, d) < today:
                y += 1
        return f"{y}-{m:02d}-{d:02d}"

    def _is_expired(exp_str):
        parts = exp_str.split("/")
        try:
            m, d = int(parts[0]), int(parts[1])
            y = int(parts[2]) + 2000 if len(parts) >= 3 and int(parts[2]) < 100 else (
                int(parts[2]) if len(parts) >= 3 else today.year
            )
            return _dt.date(y, m, d) < today
        except (ValueError, IndexError):
            return False

    live_picks = [p for p in active if not _is_expired(p.get("exp", ""))]
    live_picks.sort(key=lambda p: p.get("dateSaved", ""), reverse=True)
    live_picks = live_picks[:200]
    saved = skipped = errors = 0
    CHUNK = 50
    for ci in range(0, len(live_picks), CHUNK):
        chunk = live_picks[ci:ci + CHUNK]
        batch = [{"symbol": p["sym"], "cp": p["cp"], "strike": p["strike"], "expDate": _exp_to_iso(p["exp"])}
                 for p in chunk]
        try:
            quotes = await get_batch_option_quotes(batch)
        except Exception:
            errors += len(chunk)
            continue
        for pick, q in zip(chunk, quotes):
            if not q or q.get("error") or q.get("expired"):
                skipped += 1
                continue
            price = q.get("mark") or q.get("last") or 0
            oi = q.get("openInterest") or q.get("open_interest") or 0
            spot = q.get("underlyingPrice") or q.get("spot") or 0
            volume = q.get("volume") or 0
            history = pick.setdefault("history", [])
            entry = {"date": today_str, "price": price, "oi": oi, "spot": spot, "volume": volume}
            existing_idx = next((i for i, h in enumerate(history) if h.get("date") == today_str), None)
            if existing_idx is not None:
                history[existing_idx] = entry
            else:
                history.append(entry)
            saved += 1
        if ci + CHUNK < len(live_picks):
            await sleep(2)
    return {"saved": saved, "skipped": skipped, "errors": errors, "live": len(live_picks), "total": len(active)}


def _schwab_mode_picks():
    picks = []
    for i in range(130):
        exp = ("12/18/2026", "1/15/27", "03/19/2027", "6/17/2028")[i % 4]
        hist = [{"date": "11/14/2026", "price": 1.0 + i, "oi": 10 * i, "spot": 100.0, "volume": i}] if i % 3 == 0 else []
        if i % 10 == 0:                                      # one already recorded today: overwritten
            hist = hist + [{"date": TODAY_STR, "price": 9.99, "oi": 1, "spot": 1.0, "volume": 1}]
        picks.append(_pick(f"S{i:03d}", "P" if i % 2 else "C", 50.0 + i, exp,
                           saved=f"2026-{1 + i % 11:02d}-{1 + i % 27:02d}", history=hist))
    return picks


def _schwab_mode_quotes(picks):
    iso = {"12/18/2026": "2026-12-18", "1/15/27": "2027-01-15", "03/19/2027": "2027-03-19", "6/17/2028": "2028-06-17"}
    quotes = {}
    for i, p in enumerate(picks):
        key = _skey(p, iso[p["exp"]])
        kind = i % 7
        if kind == 0:
            continue                                         # no match
        if kind == 1:
            quotes[key] = {"symbol": p["sym"], "error": "Expired (x)", "expired": True}
        elif kind == 2:
            quotes[key] = {"symbol": p["sym"], "mark": 0, "last": 0, "openInterest": 5}      # the old path writes this 0
        elif kind == 3:
            quotes[key] = {"symbol": p["sym"], "mark": None, "last": 2.5 + i, "open_interest": 77, "spot": 12.5}
        else:
            quotes[key] = {"symbol": p["sym"], "mark": 3.0 + i, "last": 1.0, "openInterest": 100 + i,
                           "underlyingPrice": 200.0 + i, "volume": 1000 + i}
    return quotes


def _without_src(store):
    out = copy.deepcopy(store)
    for p in out["active"] + out["archived"]:
        for h in p.get("history", []):
            h.pop("src", None)
    return out


def test_schwab_mode_is_the_old_path_byte_for_byte_and_never_calls_massive(rig, monkeypatch):
    monkeypatch.setenv("TOP_FLOW_SNAPSHOT_SOURCE", "schwab")
    picks = _schwab_mode_picks()
    quotes = _schwab_mode_quotes(picks)

    # the reference: the frozen pre-change loop over its own copy of the same store
    ref_store = {"active": copy.deepcopy(picks), "archived": []}
    ref_schwab, ref_sleeps = FakeSchwab(quotes), []

    async def _ref_sleep(seconds):
        ref_sleeps.append(seconds)

    ref = asyncio.run(_pre_change_snapshot(ref_store, ref_schwab, TODAY, TODAY_STR, _ref_sleep))

    rig.load(*picks)
    rig.install(FakeMassive(default=M_FIELDS), FakeSchwab(quotes))
    result = rig.run()

    assert rig.massive.calls == []                           # Massive is never called
    assert rig.schwab.calls == ref_schwab.calls              # the same batches, in the same order
    assert rig.sleeps == ref_sleeps == [2, 2]
    # the store, minus the new `src` field, is the old store byte for byte
    new_bytes = json.dumps(_without_src(tracker._data), separators=(",", ":"))
    old_bytes = json.dumps(ref_store, separators=(",", ":"))
    assert new_bytes == old_bytes
    assert {k: result[k] for k in ref} == ref
    assert result["source"] == "schwab" and result["by_source"]["massive"] == 0
    # every entry written today says schwab; entries from earlier days gained nothing
    todays = [h for p in tracker._data["active"] for h in p["history"] if h["date"] == TODAY_STR]
    earlier = [h for p in tracker._data["active"] for h in p["history"] if h["date"] != TODAY_STR]
    written = [h for h in todays if "src" in h]
    assert written and all(h["src"] == "schwab" for h in written)
    assert earlier and all("src" not in h for h in earlier)
    # the old path can record a 0 price (a matched contract with no mark and no last): kept, as the rollback
    assert any(h["price"] == 0 for h in written)


def test_schwab_mode_with_schwab_signed_out_is_the_old_silence(rig, monkeypatch):
    monkeypatch.setenv("TOP_FLOW_SNAPSHOT_SOURCE", "schwab")
    active = rig.load(*[_pick(f"S{i:03d}") for i in range(60)])
    rig.install(FakeMassive(default=M_FIELDS), FakeSchwab(signed_in=False))
    result = rig.run()
    assert rig.massive.calls == [] and len(rig.schwab.calls) == 2        # every chunk still asks, as before
    assert all(p["history"] == [] for p in active) and result["skipped"] == 60


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

    # and the sweep prices the January contract as January 2027, from either source
    rig.install(FakeMassive(), FakeSchwab())
    rig.run()
    assert ("AAPL", "C", 200.0, "1/15/2027") in rig.massive.asked
    assert ("AAPL", "2027-01-15") in [(q["symbol"], q["expDate"]) for q in rig.schwab.asked]


# ── the scoreboard does not care which source priced a pick ───────────────────

def _three_days(rig, monkeypatch, mode, prices, ois):
    monkeypatch.setenv("TOP_FLOW_SNAPSHOT_SOURCE", mode)
    pick = _pick("AAPL", entry=5.0)
    active = rig.load(pick)
    for day, price, oi in zip(("11/13/2026", "11/16/2026", "11/17/2026"), prices, ois):
        monkeypatch.setattr(tracker, "_et_date_str", lambda day=day: day)
        rig.install(
            FakeMassive({_mkey(pick, "12/18/2026"): {"oi": oi, "mid": price, "last": None, "underlying": 230.0}}),
            FakeSchwab({_skey(pick, "2026-12-18"): {"mark": price, "last": 0, "openInterest": oi or 0,
                                                    "underlyingPrice": 230.0, "volume": 555}}))
        rig.run()
    return copy.deepcopy(active[0])


@pytest.mark.parametrize("ois", [(1000, 1050, 1300), (None, 1050, 1300), (1000, None, 900)])
def test_equal_prices_score_the_same_from_either_source(rig, monkeypatch, ois):
    prices = (5.5, 4.0, 7.75)
    from_massive = _three_days(rig, monkeypatch, "massive", prices, ois)
    from_schwab = _three_days(rig, monkeypatch, "schwab", prices, ois)

    assert {h["src"] for h in from_massive["history"]} == {"massive"}
    assert {h["src"] for h in from_schwab["history"]} == {"schwab"}
    assert [h["volume"] for h in from_massive["history"]] == [None, None, None]      # null, never 0
    assert [h["volume"] for h in from_schwab["history"]] == [555, 555, 555]
    assert [h["price"] for h in from_massive["history"]] == [h["price"] for h in from_schwab["history"]]

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
