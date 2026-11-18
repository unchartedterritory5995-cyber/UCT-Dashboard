"""MD-1 kinds of terminal data wave 5: `short.interest`, `short.list` — the Agent half of the SHINT and SHRTS terminal
panels (FINRA short interest and daily short volume, `api/services/short_data.py`).

No network: the service's two vendor readers are replaced by a stand-in that applies the filters the service sends, and
every held answer is put where the service keeps it BY the service (its own build, run against the stand-in). Once an
answer is held the stand-in is CLOSED: from then on any vendor request fails the test and is counted. Pinned per kind:
an ok read (envelope conformance, the documented fields only, every number the service's own, the settlement date as
`as_of` with the read time beside it), a missing number null and never 0, the cut stated and from which end,
`unavailable` kept apart from a healthy empty answer with each of the service's states said in its own note, a
malformed request refused before any read, a failing service answered `unavailable`, a read never fresher than its
kind declares, and THE BUDGET RULE: no read ever starts a build, a check or a thread or reaches the vendor, with the
route's own reader shown to do exactly that in the same state (so the rail can fail). For both: registered dark,
model-isolated, dormant until armed one by one. The cross-file facts (the panels' own keys, words and numbers, the
service's own constants) are read from the other file rather than retyped. And the contract: MD-1 §4.14 quotes every
note these adapters emit, verbatim.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import date, datetime
from pathlib import Path

import pytest

from api.routers import live_prices
from api.services import bars_fetch, massive, massive_adapter
from api.services import short_data as sd
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import short_interest as si
from api.services.uct_agent.marketdata import short_list as sl

REPO = Path(__file__).resolve().parents[1]
MODULES = (si, sl)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation decisions (ADR-005): both. A kind leaving this set is an owner decision.
ISOLATED = set(KINDS)
GOOD = {si.KIND: {"symbol": "AAA"}, sl.KIND: {}}
PANELS = REPO / "app/src/pages/terminal/panels"
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
D3, D2, D1 = "2026-10-30", "2026-10-15", "2026-09-30"               # settlement dates, newest first
TODAY = date(2026, 11, 17)                                          # the next report (Nov 13) is not published yet
UNI = frozenset({"AAA", "BBB", "CCC", "DDD", "EEE", "BRK-B"})
FLOATS = {"AAA": 10_000_000.0, "BBB": 2_000_000.0, "DDD": 1_000_000.0}
VOLUME_DAYS = [f"2026-11-{d:02d}" for d in range(2, 14)]            # twelve days, oldest first
#: the threads the two member routes start when they hold nothing (the service's own thread names)
BUILD_THREADS = ("short-data-stock", "short-data-market")
#: every module that holds a provider client under its own name
PROVIDER_DOORS = (massive, bars_fetch, live_prices)
#: what a turn must never reach in the service (the brief's list, and the two functions behind the build threads)
FORBIDDEN = ("get_stock", "get_market", "build_stock", "build_market", "_start_market_job", "_stock_bg", "_market_bg",
             "_newest_day", "_report", "_read")


def _si(ticker, day, short, adv=1_000_000, dtc=2.5):
    row = {"ticker": ticker, "settlement_date": day, "short_interest": short, "avg_daily_volume": adv, "days_to_cover": dtc}
    return {k: v for k, v in row.items() if v is not ...}


def _sv(ticker, day, short=400_000, total=1_000_000, ratio=40.0):
    row = {"ticker": ticker, "date": day, "short_volume": short, "total_volume": total, "short_volume_ratio": ratio,
           "exempt_volume": 1000, "nyse_short_volume": 5}
    return {k: v for k, v in row.items() if v is not ...}


def _interest_rows():
    """Three reports. AAA up 50%, BBB down 40%, CCC new this report, DDD up from a tiny base, EEE flat with no days to
    cover and no average volume, ZZZ outside the universe, BRK.B a class share."""
    return [
        _si("AAA", D3, 3_000_000, dtc=6.0), _si("AAA", D2, 2_000_000, dtc=4.0), _si("AAA", D1, 1_000_000),
        _si("BBB", D3, 600_000, dtc=1.2), _si("BBB", D2, 1_000_000, dtc=2.0),
        _si("CCC", D3, 900_000, dtc=9.0),
        _si("DDD", D3, 2_000_000, dtc=3.0), _si("DDD", D2, 100_000, dtc=0.2),
        _si("EEE", D3, 700_000, adv=..., dtc=...), _si("EEE", D2, 700_000),
        _si("ZZZ", D3, 50_000_000, dtc=99.0), _si("ZZZ", D2, 1_000_000),
        _si("BRK.B", D3, 1_500_000, dtc=0.5), _si("BRK.B", D2, 1_000_000),
    ]


def _volume_rows():
    """Twelve days for AAA (one with no total and no ratio), two for CCC and DDD."""
    rows = [_sv("AAA", d) for d in VOLUME_DAYS[:-1]] + [_sv("AAA", VOLUME_DAYS[-1], total=..., ratio=...)]
    return rows + [_sv(s, d) for s in ("CCC", "DDD") for d in VOLUME_DAYS[:2]]


class Vendor:
    """Stands where the service's two vendor readers stand: applies the filters the service sends and records every
    request. Once `closed`, a request is a failure of the test (and is still recorded)."""

    def __init__(self):
        self.rows = {sd.INTEREST: _interest_rows(), sd.VOLUME: _volume_rows()}
        self.calls: list = []
        self.fail: dict = {}
        self.closed = False

    def _enter(self, dataset, params):
        self.calls.append((dataset, dict(params)))
        if self.closed:
            raise AssertionError("the vendor was asked inside a turn")
        if dataset in self.fail:
            raise self.fail[dataset]

    def _pick(self, dataset, params):
        rows = list(self.rows[dataset])
        day_key = "settlement_date" if dataset == sd.INTEREST else "date"
        if "ticker" in params:
            rows = [r for r in rows if r.get("ticker") == params["ticker"]]
        if day_key in params:
            rows = [r for r in rows if r.get(day_key) == params[day_key]]
        if f"{day_key}.lt" in params:
            rows = [r for r in rows if str(r.get(day_key) or "") < params[f"{day_key}.lt"]]
        col, _, way = str(params.get("sort") or "ticker.asc").partition(".")
        rows.sort(key=lambda r: str(r.get(col) or ""), reverse=(way == "desc"))
        return rows

    def page(self, dataset, params, activity):
        self._enter(dataset, params)
        rows = self._pick(dataset, params)
        limit = int(params.get("limit") or 10)
        out = {"status": "OK", "count": min(len(rows), limit), "results": rows[:limit]}
        if len(rows) > limit:
            out["next_url"] = "next"
        return out

    def all(self, dataset, params, activity, max_pages):
        self._enter(dataset, params)
        return self._pick(dataset, params)


def _drain(timeout=10.0):
    """Wait for every background build the service started."""
    end = time.time() + timeout
    while time.time() < end:
        with sd._lock:
            busy = sd._market["inflight"] is not None or bool(sd._stock_inflight)
        if not busy:
            return
        time.sleep(0.01)
    raise AssertionError("a background build did not finish")


@pytest.fixture(autouse=True)
def vendor(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))                   # the market list's disk copy lives here
    v = Vendor()
    monkeypatch.setattr(sd, "_vendor_page", v.page)
    monkeypatch.setattr(sd, "_vendor_rows", v.all)
    monkeypatch.setattr(sd, "universe", lambda: UNI)
    monkeypatch.setattr(sd, "read_floats", lambda syms: (dict(FLOATS), "ok"))
    monkeypatch.setattr(sd, "MIN_UNIVERSE_ROWS", 3)
    monkeypatch.setattr(sl, "today_et", lambda: TODAY)
    gw._reset_for_test(None)
    sd.reset_for_tests()
    yield v
    v.closed = False
    _drain()                                                        # a build a test started on purpose finishes first
    sd.reset_for_tests()
    gw._reset_for_test(None)


@pytest.fixture
def work(monkeypatch):
    """Counts the work a turn must never cause: every provider client asked for, every request to the vendor adapter,
    and every thread started (by name)."""
    seen = {"provider": 0, "threads": []}
    real_start = threading.Thread.start

    def start(self):
        seen["threads"].append(self.name)
        return real_start(self)

    def client(*a, **kw):
        seen["provider"] += 1
        raise AssertionError("a provider client was asked for inside a turn")
    monkeypatch.setattr(threading.Thread, "start", start)
    for door in PROVIDER_DOORS:
        monkeypatch.setattr(door, "_get_client", client)
    for name in ("get", "get_pages"):
        monkeypatch.setattr(massive_adapter, name, client)
    return seen


def _close(vendor, work=None):
    """From here on a vendor request, a provider client or a thread is the read's own doing."""
    _drain()
    vendor.closed = True
    vendor.calls.clear()
    if work is not None:
        work["threads"].clear()


def _quiet(vendor, work) -> bool:
    return vendor.calls == [] and work == {"provider": 0, "threads": []}


def _forget():
    """A server that holds nothing: the service's memory AND the market list's disk copy."""
    sd.reset_for_tests()
    path = sd._disk_path()
    if path and os.path.exists(path):
        os.remove(path)


def _hold_stock(vendor, sym="AAA"):
    """One stock's answer, held where the service's own build leaves it."""
    out = sd.get_stock(sym, wait_s=10)
    _drain()
    return out


def _hold_market(vendor):
    out = sd.get_market(wait_s=10)
    _drain()
    return out


_turn = iter(range(10_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"w5-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["freshness"] == "historical"                      # a settled report: never periodic, never live
        assert out["as_of"] is not None or out["notes"]
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway


def _plain(v):
    """A read's data without the gateway's isolation stamps."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


def _at(iso):
    """The service's read stamp as the envelope gives it."""
    return env.utc_iso(datetime.fromisoformat(iso))


# ── registration, dark by default, isolation ─────────────────────────────────────────────────────────────────────────
def test_both_kinds_are_registered_once_by_their_modules_and_both_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description and "never today" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # neither is ever declared live or delayed
    assert (r.get(si.KIND).max_symbols, r.get(sl.KIND).max_symbols) == (1, 0)
    assert KINDS == ("short.interest", "short.list") and si.SOURCE == sl.SOURCE == "uct-short-data"
    # the two capabilities that read them are local-only on the server, by name
    assert {"stock.shortInterest", "stock.shortList"} <= set(agent_turn.LOCAL_ONLY_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(monkeypatch):
    ran = []
    monkeypatch.setattr(si, "held_answer", lambda sym: ran.append("si") or (None, "not_held"))
    monkeypatch.setattr(sl, "held_answer", lambda rank, limit: ran.append("sl") or (None, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,earnings.season,group.drill,levels.darkpool")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(vendor, monkeypatch):
    _hold_market(vendor)
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and out["data"] is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, sl.KIND)                  # arming ONE arms one
    assert _read(sl.KIND)["status"] == "ok"
    assert _read(si.KIND)["status"] == "refused"
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(sl.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns both off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_ranks_words_bounds_and_fields_are_the_services_and_the_panels_own(vendor):
    assert sl.RANKS == sd.RANKS and sl.DEFAULT_RANK == sd.DEFAULT_RANK
    js = (PANELS / "shortListModel.js").read_text(encoding="utf-8")
    block = js[js.index("export const SHORT_RANKS = Object.freeze({"):js.index("export const DEFAULT_SHORT_RANK")]
    words = dict(re.findall(r"^  (\w+): Object\.freeze\(\{.*?words: '([^']+)' \}\),$", block, flags=re.M))
    assert words == sl.RANK_WORDS and tuple(words) == sl.RANKS       # the panel's own order and its own words
    assert f"export const DEFAULT_SHORT_RANK = '{sl.DEFAULT_RANK}'" in js
    assert sl.MAX_LIMIT <= sd.MARKET_LIMIT_MAX                       # a turn never asks the service for more than it gives
    one = (PANELS / "shortInterestModel.js").read_text(encoding="utf-8")
    for name, value in (("REPORTS_SHOWN", si.DEFAULT_REPORTS), ("REPORTS_MORE", si.MAX_REPORTS), ("VOLUME_DAYS_SHOWN", si.DEFAULT_DAYS)):
        assert f"export const {name} = {value}\n" in one.replace("\r\n", "\n"), name
    assert si.MAX_DAYS == sd.SV_DAYS and si.MAX_REPORTS <= sd.SI_HISTORY_LIMIT
    assert re.search(r"const SECTION_STATES = new Set\(\[([^\]]+)\]\)", one).group(1).replace("'", "").split(", ") == list(si.SECTION_STATES)
    # every field the service sends for a row, and no other
    stock = _hold_stock(vendor)
    assert tuple(stock["interest"]["reports"][0]) == si.REPORT_FIELDS and tuple(stock["volume"]["days"][0]) == si.DAY_FIELDS
    assert tuple(stock["float"]) == si.FLOAT_FIELDS
    market = _hold_market(vendor)
    assert tuple(market["rows"][0]) == sl.ROW_FIELDS and tuple(market["float"]) == sl.FLOAT_FIELDS
    assert (sd.STOCK_FRESH_S, sd.STOCK_STALE_EXTRA_S, sd.PCT_FLOAT_MAX, sd.FLOOR_SHARES) == (4 * 3600.0, 20 * 3600.0, 150.0, 500_000)


# ── the two accessors, railed against the routes' readers ────────────────────────────────────────────────────────────
def test_held_stock_is_get_stocks_own_answer_and_never_starts_the_build_get_stock_starts(vendor, work):
    """⚠️ the accessor against the route's reader: the same answer whenever `get_stock` would not build, and in the
    states where `get_stock` DOES start a build, `held_stock` starts none."""
    assert sd.held_stock("AAA") == (None, "not_held") and vendor.calls == [] and work["threads"] == []
    first = sd.get_stock("AAA", wait_s=10)                            # the route: starts ONE build and waits on it
    _drain()
    assert first["status"] == "ok" and work["threads"] == ["short-data-stock"] and len(vendor.calls) == 2
    assert sd.held_stock("AAA") == (first, "fresh") and sd.held_stock("aaa")[0] is sd.get_stock("AAA")
    with sd._lock:                                                    # past its freshness: the last good answer
        sd._stock_done["AAA"] = (time.time() - 1, first)
    held, how = sd.held_stock("AAA")
    assert how == "last_good" and held is first and "refreshing" not in held       # nothing here refreshes it
    assert work["threads"] == ["short-data-stock"] and len(vendor.calls) == 2 and not sd._stock_inflight
    again = sd.get_stock("AAA", wait_s=10)                            # the route: serves it AND starts the rebuild
    _drain()
    assert again == {**first, "refreshing": True} and work["threads"] == ["short-data-stock"] * 2 and len(vendor.calls) == 4
    # a refusal is the same one `get_stock` gives, and reads nothing
    assert sd.held_stock("I:SPX") == (sd.get_stock("I:SPX"), "refused") == ({"status": "bad_symbol", "sym": None}, "refused")
    assert work["provider"] == 0


def test_held_market_is_get_markets_own_answer_and_never_starts_the_build_or_the_check_get_market_starts(vendor, work):
    assert sd.held_market() == (None, "not_held") and vendor.calls == [] and work["threads"] == []
    first = sd.get_market("up", wait_s=10)                            # the route: starts ONE build and waits on it
    _drain()
    assert first["status"] == "ok" and work["threads"] == ["short-data-market"] and len(vendor.calls) == 4
    for rank in sd.RANKS:
        assert sd.held_market(rank, 3) == (sd.get_market(rank, 3), "held")
    assert sd.held_market("banana") == (sd.get_market("banana"), "refused")
    with sd._lock:                                                    # the look for a newer report is due
        sd._market["checked"] = time.time() - sd.CHECK_EVERY_S - 1
    assert sd.held_market("up")[0] == first and work["threads"] == ["short-data-market"] and len(vendor.calls) == 4
    with sd._lock:
        assert sd._market["inflight"] is None                         # the accessor started no check
    assert sd.get_market("up", wait_s=0) == first                     # the route: answers AND starts the check
    _drain()
    assert work["threads"] == ["short-data-market"] * 2 and len(vendor.calls) == 5
    assert work["provider"] == 0


def test_held_market_with_nothing_held_says_what_the_last_build_said_and_asks_nothing(vendor, work):
    """The accessor's one addition for this wave: with no list held it hands back the service's standing answer
    (`unavailable` / `failed`, with its reason), which is what `get_market` answers without starting another build."""
    vendor.fail[sd.INTEREST] = massive._ERR.auth_error("Massive rejected (403)", status=403)
    refused = sd.get_market(wait_s=10)
    _drain()
    assert refused == {"status": "unavailable", "reason": "refused", "http_status": 403, "source": sd.SOURCE}
    _close(vendor, work)
    assert sd.held_market("float") == (refused, "not_held") == (sd.get_market("float"), "not_held")
    assert _quiet(vendor, work)
    with sd._lock:                                                    # the answer no longer stands
        sd._market["block"] = (time.time() - 1, refused)
    assert sd.held_market() == (None, "not_held") and _quiet(vendor, work)


# ── short.interest ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_interest_reads_the_held_answer_with_every_number_the_services_own(vendor, work):
    held = _hold_stock(vendor)
    _close(vendor, work)
    out = _read(si.KIND, {"symbol": "aaa"})
    _conforms(out, si.KIND)
    assert out["status"] == "ok" and out["stale"] is False
    # the settlement date, as the start of that Eastern day: never today, never the read time
    assert out["as_of"] == "2026-10-30T04:00:00Z" and out["as_of"][:10] != out["fetched_at"][:10]
    d = out["data"]
    assert (d["sym"], d["settlement_date"], d["publication_estimate"], d["held"], d["source"]) == ("AAA", D3, "2026-11-10", "fresh", sd.SOURCE)
    assert d["read_at"] == _at(held["read_at"])
    assert _plain(d["latest"]) == {"settlement_date": D3, "short_interest": 3_000_000, "avg_daily_volume": 1_000_000,
                                   "days_to_cover": 6.0, "change_shares": 1_000_000, "change_pct": 50.0}
    assert _plain(d["interest"]["reports"]) == held["interest"]["reports"] and d["interest"]["reports"][0] == d["latest"]
    assert set(d["latest"]) - {"isolated"} == set(si.REPORT_FIELDS)   # the documented fields only
    assert (d["interest"]["state"], d["interest"]["count"], d["interest"]["shown"], d["interest"]["cut"], d["interest"]["first_date"]) == ("ok", 3, 3, False, D1)
    # a number that does not exist is null, never 0: the oldest report has nothing before it
    oldest = d["interest"]["reports"][-1]
    assert oldest["change_shares"] is None and oldest["change_pct"] is None and oldest["short_interest"] == 1_000_000
    # daily short volume: the newest ten of the twelve days held, and the newest has no total and no ratio
    assert _plain(d["volume"]["days"]) == held["volume"]["days"][:10] and [x["date"] for x in d["volume"]["days"]] == VOLUME_DAYS[::-1][:10]
    assert set(d["volume"]["days"][0]) - {"isolated"} == set(si.DAY_FIELDS)
    assert d["volume"]["days"][0]["total_volume"] is None and d["volume"]["days"][0]["short_volume_ratio"] is None
    assert (d["volume"]["state"], d["volume"]["count"], d["volume"]["shown"], d["volume"]["window_days"]) == ("ok", 12, 10, sd.SV_DAYS)
    assert _plain(d["float"]) == {"shares": 10_000_000, "pct_float": 30.0, "withheld": False, "state": "ok", "source": sd.FLOAT_SOURCE}
    for note in (si.NOTE_WHAT.format(sym="AAA"), si.NOTE_LAG.format(date=D3), si.NOTE_PUBLISHED.format(estimate="2026-11-10"),
                 si.NOTE_AS_OF.format(at=d["read_at"]), si.NOTE_VOLUME, si.NOTE_FLOAT, si.NOTE_DAYS_CUT.format(n=10, total=12)):
        assert note in out["notes"], note
    for note in (si.NOTE_REPORTS_CUT.format(n=3, total=3), si.NOTE_HISTORY_CUT.format(n=3, first=D1), si.NOTE_FLOAT_STALE):
        assert note not in out["notes"], note
    assert out["coverage"] == {"evaluated": 15, "answered": 13, "dropped": 2, "not_computable": 0}
    assert "exempt_volume" not in json.dumps(out) and "nyse_short_volume" not in json.dumps(out)       # no raw vendor row
    assert _quiet(vendor, work)


def test_interest_the_slices_are_bounded_and_each_cut_is_stated_from_the_old_end(vendor, monkeypatch):
    _hold_stock(vendor)
    out = _read(si.KIND, {"symbol": "AAA", "reports": 2, "days": 3})
    _conforms(out, si.KIND)
    d = out["data"]
    assert [r["settlement_date"] for r in d["interest"]["reports"]] == [D3, D2] and (d["interest"]["count"], d["interest"]["shown"]) == (3, 2)
    assert [x["date"] for x in d["volume"]["days"]] == VOLUME_DAYS[::-1][:3] and (d["volume"]["count"], d["volume"]["shown"]) == (12, 3)
    assert si.NOTE_REPORTS_CUT.format(n=2, total=3) in out["notes"] and si.NOTE_DAYS_CUT.format(n=3, total=12) in out["notes"]
    assert out["coverage"] == {"evaluated": 15, "answered": 5, "dropped": 10, "not_computable": 0}
    whole = _read(si.KIND, {"symbol": "AAA", "reports": si.MAX_REPORTS, "days": si.MAX_DAYS})
    assert (whole["data"]["interest"]["shown"], whole["data"]["volume"]["shown"]) == (3, 12)
    assert not [n for n in whole["notes"] if n.startswith("showing the newest")]
    # the service read only part of the history: said, with where the history stops
    _forget()
    monkeypatch.setattr(sd, "SI_HISTORY_LIMIT", 2)
    _hold_stock(vendor)
    out = _read(si.KIND)
    assert out["data"]["interest"]["cut"] is True and out["data"]["interest"]["first_date"] == D2
    assert si.NOTE_HISTORY_CUT.format(n=2, first=D2) in out["notes"]


def test_interest_a_float_that_is_missing_withheld_or_old_is_said_and_the_percent_is_null_never_zero(vendor, monkeypatch):
    _hold_stock(vendor, "CCC")                                          # no float on file
    out = _read(si.KIND, {"symbol": "CCC"})
    _conforms(out, si.KIND)
    assert _plain(out["data"]["float"]) == {"shares": None, "pct_float": None, "withheld": False, "state": "missing", "source": sd.FLOAT_SOURCE}
    assert si.NOTE_FLOAT_MISSING.format(sym="CCC") in out["notes"] and si.NOTE_FLOAT not in out["notes"]
    _hold_stock(vendor, "DDD")                                          # 2,000,000 short against a float of 1,000,000
    out = _read(si.KIND, {"symbol": "DDD"})
    assert out["data"]["float"]["pct_float"] is None and out["data"]["float"]["withheld"] is True and out["data"]["float"]["shares"] == 1_000_000
    assert si.NOTE_FLOAT_WITHHELD.format(max=150, sym="DDD") in out["notes"] and si.NOTE_FLOAT not in out["notes"]
    _forget()
    monkeypatch.setattr(sd, "read_floats", lambda syms: (dict(FLOATS), "stale"))
    _hold_stock(vendor)
    out = _read(si.KIND)
    assert out["data"]["float"]["state"] == "stale" and out["data"]["float"]["pct_float"] == 30.0
    assert si.NOTE_FLOAT in out["notes"] and si.NOTE_FLOAT_STALE in out["notes"]


def test_interest_one_dataset_refused_or_failed_is_partial_and_a_stock_the_vendor_has_nothing_for_is_healthy(vendor, work):
    vendor.fail[sd.VOLUME] = massive._ERR.auth_error("Massive rejected (403)", status=403)
    _hold_stock(vendor)
    out = _read(si.KIND)
    _conforms(out, si.KIND)
    d = out["data"]
    assert out["status"] == "partial" and d["interest"]["state"] == "ok" and d["settlement_date"] == D3
    assert _plain(d["volume"]) == {"state": "unavailable", "reason": "refused", "http_status": 403, "days": [], "count": 0, "shown": 0, "window_days": None}
    assert si.NOTE_SECTION_REFUSED.format(what="daily short volume") in out["notes"] and si.NOTE_VOLUME not in out["notes"]
    assert si.NOTE_NO_VOLUME.format(sym="AAA") not in out["notes"]      # refused is never "none"
    _forget()
    vendor.fail.clear()
    vendor.fail[sd.INTEREST] = massive._ERR.rate_limited("Massive rate-limited secret-text", status=429)
    _hold_stock(vendor)
    out = _read(si.KIND)
    _conforms(out, si.KIND)
    d = out["data"]
    assert out["status"] == "partial" and out["as_of"] is None and d["settlement_date"] is None and d["latest"] is None
    assert (d["interest"]["state"], d["interest"]["reason"], d["interest"]["http_status"], d["interest"]["reports"]) == ("failed", "rate_limited", 429, [])
    assert d["publication_estimate"] is None and d["volume"]["state"] == "ok" and d["volume"]["shown"] == 10
    assert si.NOTE_SECTION_FAILED.format(what="short interest") in out["notes"] and si.NOTE_NO_AS_OF.format(at=d["read_at"]) in out["notes"]
    assert si.NOTE_LAG.format(date=D3) not in out["notes"] and "secret-text" not in json.dumps(out)
    _forget()
    vendor.fail.clear()
    vendor.fail[sd.VOLUME] = massive._ERR.not_configured("MASSIVE_API_KEY not set")
    vendor.fail[sd.INTEREST] = massive._ERR.transient("Massive server error (502)", status=502)
    _hold_stock(vendor)                                                 # one dataset has no key, the other failed: still not "none"
    out = _read(si.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [si.NOTE_NO_KEY.format(sym="AAA")]
    _forget()
    vendor.fail.clear()
    _hold_stock(vendor, "QQQQ")                                         # the vendor answered and has no row for it
    _close(vendor, work)
    out = _read(si.KIND, {"symbol": "QQQQ"})
    _conforms(out, si.KIND)
    d = out["data"]
    assert out["status"] == "ok" and out["as_of"] is None and (d["interest"]["state"], d["volume"]["state"]) == ("none", "none")
    assert d["latest"] is None and d["interest"]["reports"] == [] and d["volume"]["days"] == [] and d["float"]["pct_float"] is None
    assert si.NOTE_NO_REPORTS.format(sym="QQQQ") in out["notes"] and si.NOTE_NO_VOLUME.format(sym="QQQQ") in out["notes"]
    assert out["coverage"] == {"evaluated": 0, "answered": 0, "dropped": 0, "not_computable": 0} and _quiet(vendor, work)


def test_interest_the_last_good_answer_is_stale_and_no_build_replaces_it(vendor, work):
    good = _hold_stock(vendor)
    with sd._lock:                                                      # its four hours have run out
        sd._stock_done["AAA"] = (time.time() - 1, good)
    _close(vendor, work)
    out = _read(si.KIND)
    _conforms(out, si.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["held"] == "last_good"
    assert si.NOTE_LAST_GOOD.format(sym="AAA", hours=4) in out["notes"]
    assert not sd._stock_inflight and _quiet(vendor, work)
    with sd._lock:                                                      # no read time: unknown is never claimed fresh
        sd._stock_done["AAA"] = (time.time() + 60, {**good, "read_at": None})
    out = _read(si.KIND)
    _conforms(out, si.KIND)
    assert out["stale"] is True and out["data"]["read_at"] is None and out["data"]["held"] == "fresh"
    assert si.NOTE_NO_READ_TIME in out["notes"] and si.NOTE_AS_OF.format(at="a time not given") in out["notes"]
    assert _quiet(vendor, work)


def test_interest_nothing_held_is_unavailable_and_no_build_is_started(vendor, work):
    """Through the REAL service state with nothing held: the member route starts its build here; this read must not.
    The build is COUNTED: the route's own reader is shown to start it in the same state, so the count can fail."""
    out = _read(si.KIND)
    _conforms(out, si.KIND)
    assert out["status"] == "unavailable" and out["data"] is None
    assert out["notes"] == [si.NOTE_NOT_HELD.format(sym="AAA", hours=4, extra=20)]
    assert not sd._stock_inflight and _quiet(vendor, work)
    assert sd.get_stock("AAA", wait_s=10)["status"] == "ok"            # the route does
    _drain()
    assert work["threads"] == ["short-data-stock"] and len(vendor.calls) == 2


def test_interest_a_refused_plan_a_missing_key_and_a_failed_read_are_each_said_and_never_no_short_interest(vendor, work, monkeypatch):
    refusal = massive._ERR.auth_error("Massive rejected (403)", status=403)
    vendor.fail = {sd.INTEREST: refusal, sd.VOLUME: refusal}
    assert _hold_stock(vendor)["status"] == "unavailable"
    _close(vendor, work)
    out = _read(si.KIND)
    _conforms(out, si.KIND)
    assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [si.NOTE_REFUSED.format(sym="AAA")]
    assert _quiet(vendor, work)                                         # the refusal is said from what is held: not asked again
    vendor.closed = False
    _forget()
    no_key = massive._ERR.not_configured("MASSIVE_API_KEY not set")
    vendor.fail = {sd.INTEREST: no_key, sd.VOLUME: no_key}
    _hold_stock(vendor)
    assert _read(si.KIND)["notes"] == [si.NOTE_NO_KEY.format(sym="AAA")]
    _forget()
    broken = massive._ERR.transient("Massive server error (502) secret-text", status=502)
    vendor.fail = {sd.INTEREST: broken, sd.VOLUME: broken}
    assert _hold_stock(vendor)["status"] == "failed"
    out = _read(si.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [si.NOTE_READ_FAILED.format(sym="AAA")] and "secret-text" not in json.dumps(out)
    # the route's own words for "a build is running" and "not a symbol", and answers that are not answers
    for held, note in (({"status": "computing", "sym": "AAA"}, si.NOTE_NOT_HELD.format(sym="AAA", hours=4, extra=20)),
                       ({"status": "failed", "sym": "AAA"}, si.NOTE_READ_FAILED.format(sym="AAA")),
                       ({"status": "weird"}, si.NOTE_FAILED.format(sym="AAA")), ("not an answer", si.NOTE_FAILED.format(sym="AAA")),
                       ({"status": "ok", "interest": {"state": "ok", "reports": [{"nope": 1}]}, "volume": None}, si.NOTE_READ_FAILED.format(sym="AAA"))):
        monkeypatch.setattr(si, "held_answer", lambda sym, h=held: (h, "fresh"))
        out = _read(si.KIND)
        _conforms(out, si.KIND)
        assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [note], held
    monkeypatch.setattr(si, "held_answer", lambda sym: ({"status": "bad_symbol", "sym": None}, "refused"))
    assert _read(si.KIND)["notes"] == [si.NOTE_BAD_SYMBOL.format(sym="AAA")]

    def boom(sym):
        raise RuntimeError("held store unreadable at /data/internal")
    monkeypatch.setattr(si, "held_answer", boom)
    out = _read(si.KIND)
    assert out["notes"] == [si.NOTE_FAILED.format(sym="AAA")] and "internal" not in json.dumps(out)


def test_interest_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(si, "held_answer", lambda sym: ran.append(sym) or (None, "not_held"))
    for bad in ({}, {"symbol": ""}, {"symbol": "I:SPX"}, {"symbol": "../etc"}, {"symbol": "TOOLONGX"}, {"symbol": 5}, {"symbol": ["AAA"]},
                {"symbol": "AAA", "reports": 0}, {"symbol": "AAA", "reports": si.MAX_REPORTS + 1}, {"symbol": "AAA", "reports": True},
                {"symbol": "AAA", "days": 0}, {"symbol": "AAA", "days": si.MAX_DAYS + 1}, {"symbol": "AAA", "days": "5"}):
        assert _read(si.KIND, bad)["status"] == "refused", bad
    assert ran == []
    assert _read(si.KIND, {"symbol": "$brk.b"})["status"] == "unavailable" and ran == ["BRK-B"]       # the house form, the service's own rule


# ── short.list ───────────────────────────────────────────────────────────────────────────────────────────────────────
def test_list_reads_the_held_report_ranked_with_every_number_the_services_own(vendor, work):
    held = _hold_market(vendor)
    _close(vendor, work)
    out = _read(sl.KIND)
    _conforms(out, sl.KIND)
    assert out["status"] == "ok" and out["stale"] is False
    assert out["as_of"] == "2026-10-30T04:00:00Z" and out["as_of"][:10] != out["fetched_at"][:10]     # the settlement date, never today
    d = out["data"]
    assert (d["rank"], d["settlement_date"], d["previous_settlement_date"], d["publication_estimate"]) == ("dtc", D3, D2, "2026-11-10")
    assert (d["newer_report_landing"], d["newer_report_due"], d["check"], d["held"], d["source"]) == (None, None, None, "held", sd.SOURCE)
    assert d["read_at"] == _at(held["read_at"])
    assert (d["count"], d["universe"], d["ranked"], d["limit"], d["shown"], d["cut"], d["floor_shares"]) == (6, 6, 5, 25, 5, False, None)
    # days to cover, highest first; EEE has none and is never ranked as 0; ZZZ is not a stock UCT follows
    assert [r["sym"] for r in d["rows"]] == ["CCC", "AAA", "DDD", "BBB", "BRK-B"]
    assert _plain(d["rows"]) == [{k: r[k] for k in sl.ROW_FIELDS} for r in held["rows"]]
    by = {r["sym"]: r for r in d["rows"]}
    assert set(by["AAA"]) - {"isolated"} == set(sl.ROW_FIELDS)        # the documented fields only
    assert _plain(by["AAA"]) == {"sym": "AAA", "short_interest": 3_000_000, "avg_daily_volume": 1_000_000, "days_to_cover": 6.0,
                                 "prev_short_interest": 2_000_000, "change_shares": 1_000_000, "change_pct": 50.0,
                                 "float_shares": 10_000_000, "pct_float": 30.0}
    # a number that does not exist is null, never 0: no previous report, no float, a withheld percent
    assert by["CCC"]["prev_short_interest"] is None and by["CCC"]["change_shares"] is None and by["CCC"]["change_pct"] is None
    assert by["CCC"]["float_shares"] is None and by["CCC"]["pct_float"] is None
    assert by["DDD"]["pct_float"] is None and by["DDD"]["float_shares"] == 1_000_000
    assert _plain(d["float"]) == {"state": "ok", "with_float": 2, "withheld": 1, "source": sd.FLOAT_SOURCE}
    for note in (sl.NOTE_WHAT.format(date=D3, count=6, universe=6, order=sl.RANK_WORDS["dtc"]), sl.NOTE_LAG.format(date=D3),
                 sl.NOTE_PUBLISHED.format(estimate="2026-11-10"), sl.NOTE_AS_OF.format(at=d["read_at"]),
                 sl.NOTE_PREVIOUS.format(date=D2), sl.NOTE_RANK_DTC):
        assert note in out["notes"], note
    assert not [n for n in out["notes"] if n.startswith("showing the first")]
    assert out["coverage"] == {"evaluated": 5, "answered": 5, "dropped": 0, "not_computable": 0}
    assert _quiet(vendor, work)


def test_list_each_rank_is_the_services_own_with_its_floor_and_a_cut_names_the_end_left_out(vendor, work):
    _hold_market(vendor)
    _close(vendor, work)
    up = _read(sl.KIND, {"rank": "up"})
    _conforms(up, sl.KIND)
    # DDD rose 1,900% from 100,000 shares: under the floor, so it does not top the list; CCC has no previous report
    assert [(r["sym"], r["change_pct"]) for r in up["data"]["rows"]] == [("AAA", 50.0), ("BRK-B", 50.0)]
    assert (up["data"]["ranked"], up["data"]["floor_shares"]) == (2, sd.FLOOR_SHARES)
    assert sl.NOTE_RANK_CHANGE.format(floor=500_000) in up["notes"] and "500,000 shares" in sl.NOTE_RANK_CHANGE.format(floor=500_000)
    down = _read(sl.KIND, {"rank": "down"})
    assert [(r["sym"], r["change_pct"]) for r in down["data"]["rows"]] == [("BBB", -40.0)] and down["data"]["floor_shares"] == 500_000
    flt = _read(sl.KIND, {"rank": "float"})
    assert [(r["sym"], r["pct_float"]) for r in flt["data"]["rows"]] == [("AAA", 30.0), ("BBB", 30.0)] and flt["data"]["floor_shares"] is None
    assert sl.NOTE_RANK_FLOAT.format(max=150, withheld=1) in flt["notes"]
    for out, rank in ((up, "up"), (down, "down"), (flt, "float")):
        assert sl.NOTE_WHAT.format(date=D3, count=6, universe=6, order=sl.RANK_WORDS[rank]) in out["notes"], rank
        assert sl.NOTE_RANK_DTC not in out["notes"], rank
    cut = _read(sl.KIND, {"rank": "dtc", "limit": 2})
    _conforms(cut, sl.KIND)
    d = cut["data"]
    assert [r["sym"] for r in d["rows"]] == ["CCC", "AAA"] and (d["ranked"], d["limit"], d["shown"], d["cut"]) == (5, 2, 2, True)
    assert sl.NOTE_CUT.format(n=2, total=5, order=sl.RANK_WORDS["dtc"]) in cut["notes"]
    assert "the lowest ranked are the ones left out" in sl.NOTE_CUT
    assert cut["coverage"] == {"evaluated": 5, "answered": 2, "dropped": 3, "not_computable": 0}
    assert _quiet(vendor, work)


def test_list_a_rank_nothing_qualifies_for_is_a_healthy_answer_and_no_float_file_is_said(vendor, monkeypatch):
    monkeypatch.setattr(sd, "read_floats", lambda syms: ({}, "missing"))
    _hold_market(vendor)
    out = _read(sl.KIND, {"rank": "float"})
    _conforms(out, sl.KIND)
    d = out["data"]
    assert out["status"] == "ok" and d["rows"] == [] and (d["ranked"], d["shown"], d["cut"]) == (0, 0, False)
    assert d["float"]["state"] == "missing" and d["float"]["with_float"] == 0
    assert sl.NOTE_FLOAT_MISSING in out["notes"] and sl.NOTE_NONE.format(order=sl.RANK_WORDS["float"]) in out["notes"]
    assert sl.NOTE_RANK_FLOAT.format(max=150, withheld=0) not in out["notes"]
    # the first report the server ever read has nothing to compare with: no change, never 0
    _forget()
    vendor.rows[sd.INTEREST] = [r for r in _interest_rows() if r["settlement_date"] == D3]
    _hold_market(vendor)
    out = _read(sl.KIND, {"rank": "up"})
    assert out["status"] == "ok" and out["data"]["rows"] == [] and out["data"]["previous_settlement_date"] is None
    assert sl.NOTE_NO_PREVIOUS in out["notes"] and sl.NOTE_NONE.format(order=sl.RANK_WORDS["up"]) in out["notes"]
    assert all(r["change_pct"] is None and r["prev_short_interest"] is None for r in _read(sl.KIND)["data"]["rows"])


def test_list_a_report_still_arriving_a_failed_look_and_a_report_that_is_due_are_each_said(vendor, work, monkeypatch):
    rows = _interest_rows()
    vendor.rows[sd.INTEREST] = [r for r in rows if not (r["settlement_date"] == D3 and r["ticker"] not in ("AAA", "BBB"))]
    _hold_market(vendor)                                                # the newest report holds too few stocks
    out = _read(sl.KIND)
    _conforms(out, sl.KIND)
    d = out["data"]
    assert (d["settlement_date"], d["previous_settlement_date"], d["newer_report_landing"], d["newer_report_due"]) == (D2, D1, D3, None)
    assert out["as_of"] == "2026-10-15T04:00:00Z" and sl.NOTE_LANDING.format(date=D3) in out["notes"] and out["stale"] is False
    # a look for a newer report that was refused: the list is the last one read, and it is stale
    _forget()
    vendor.rows[sd.INTEREST] = rows
    _hold_market(vendor)
    vendor.fail[sd.INTEREST] = massive._ERR.auth_error("Massive rejected (403)", status=403)
    with sd._lock:
        sd._market["checked"] = 0.0
    sd.get_market(wait_s=0)                                             # the route starts the look; it is refused
    _close(vendor, work)
    out = _read(sl.KIND)
    _conforms(out, sl.KIND)
    d = out["data"]
    assert out["status"] == "ok" and out["stale"] is True and d["settlement_date"] == D3 and len(d["rows"]) == 5
    assert (d["check"]["state"], d["check"]["reason"], d["check"]["http_status"]) == ("unavailable", "refused", 403) and d["check"]["at"].endswith("Z")
    assert set(d["check"]) - {"isolated"} == set(sl.CHECK_FIELDS)
    assert sl.NOTE_CHECK.format(what=sl.CHECK_WORDS["refused"]) in out["notes"] and _quiet(vendor, work)
    # FINRA's own schedule says the next report is out, and this read never looks for it
    vendor.closed = False
    _forget()
    vendor.fail.clear()
    _hold_market(vendor)
    _close(vendor, work)
    assert _read(sl.KIND)["stale"] is False                             # Nov 17: the Nov 13 report is not published yet
    monkeypatch.setattr(sl, "today_et", lambda: date(2026, 11, 27))
    out = _read(sl.KIND)
    _conforms(out, sl.KIND)
    assert out["stale"] is True and out["data"]["newer_report_due"] == "2026-11-13" and out["data"]["settlement_date"] == D3
    assert sl.NOTE_NEWER_DUE.format(date="2026-11-13") in out["notes"] and _quiet(vendor, work)
    # a list with no read time: unknown is never claimed fresh
    monkeypatch.setattr(sl, "today_et", lambda: TODAY)
    with sd._lock:
        sd._market["held"] = {**sd._market["held"], "read_at": None}
    out = _read(sl.KIND)
    _conforms(out, sl.KIND)
    assert out["stale"] is True and out["data"]["read_at"] is None
    assert sl.NOTE_NO_READ_TIME in out["notes"] and sl.NOTE_AS_OF.format(at="a time not given") in out["notes"]


def test_list_nothing_held_is_unavailable_and_neither_a_build_nor_a_check_is_started(vendor, work):
    """Through the REAL service state: with nothing held the member route starts its build, and with a list held and
    a look due it starts the look; this read starts neither. Both are COUNTED against the route's own reader."""
    out = _read(sl.KIND)
    _conforms(out, sl.KIND)
    assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [sl.NOTE_NOT_HELD]
    with sd._lock:
        assert sd._market["inflight"] is None
    assert _quiet(vendor, work)
    assert sd.get_market(wait_s=10)["status"] == "ok"                  # the route does
    _drain()
    assert work["threads"] == ["short-data-market"] and len(vendor.calls) == 4
    with sd._lock:                                                      # the look for a newer report is due
        sd._market["checked"] = time.time() - sd.CHECK_EVERY_S - 1
    vendor.calls.clear()
    work["threads"].clear()
    for rank in sl.RANKS:
        assert _read(sl.KIND, {"rank": rank})["status"] == "ok"
    with sd._lock:
        assert sd._market["inflight"] is None
    assert _quiet(vendor, work)
    sd.get_market(wait_s=0)                                             # the route does
    _drain()
    assert work["threads"] == ["short-data-market"] and len(vendor.calls) == 1


def test_list_a_list_held_only_on_disk_is_read_and_the_vendor_is_not_asked(vendor, work):
    first = _hold_market(vendor)
    sd.reset_for_tests()                                                # a restart: nothing in memory
    _close(vendor, work)
    out = _read(sl.KIND, {"rank": "float"})
    _conforms(out, sl.KIND)
    assert out["status"] == "ok" and out["data"]["settlement_date"] == D3 and out["data"]["read_at"] == _at(first["read_at"])
    assert [r["sym"] for r in out["data"]["rows"]] == ["AAA", "BBB"] and _quiet(vendor, work)


def test_list_a_refused_plan_a_missing_key_a_thin_or_unreadable_report_and_a_failed_read_are_each_said(vendor, work, monkeypatch):
    def said(note):
        _close(vendor, work)
        for rank in ("dtc", "float"):
            out = _read(sl.KIND, {"rank": rank})
            _conforms(out, sl.KIND)
            assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [note], rank
        assert _quiet(vendor, work)                                     # said from what the service holds: not asked again
        vendor.closed = False
        _forget()
        vendor.fail.clear()
        vendor.rows[sd.INTEREST] = _interest_rows()

    vendor.fail[sd.INTEREST] = massive._ERR.auth_error("Massive rejected (403)", status=403)
    assert _hold_market(vendor)["reason"] == "refused"
    said(sl.NOTE_REFUSED)
    vendor.fail[sd.INTEREST] = massive._ERR.not_configured("MASSIVE_API_KEY not set")
    assert _hold_market(vendor)["reason"] == "not_configured"
    said(sl.NOTE_NO_KEY)
    vendor.rows[sd.INTEREST] = [_si("AAA", D3, 5), _si("ZZZ", D3, 5), _si("QQQQ", D3, 7)]
    assert _hold_market(vendor)["reason"] == "thin"
    said(sl.NOTE_THIN)
    vendor.rows[sd.INTEREST] = []
    assert _hold_market(vendor)["reason"] == "shape"
    said(sl.NOTE_SHAPE)
    vendor.fail[sd.INTEREST] = massive._ERR.transient("Massive server error (502) secret-text", status=502)
    assert _hold_market(vendor)["status"] == "failed"
    said(sl.NOTE_READ_FAILED)
    # the route's own word for "a build is running", and answers that are not answers
    for held, how, note in (({"status": "computing"}, "not_held", sl.NOTE_NOT_HELD), ({"status": "weird"}, "held", sl.NOTE_FAILED),
                            ("not an answer", "held", sl.NOTE_FAILED), ({"status": "unavailable", "reason": "new"}, "not_held", sl.NOTE_FAILED),
                            ({"status": "ok", "rank": "dtc", "settlement_date": "not a day", "rows": []}, "held", sl.NOTE_FAILED),
                            ({"status": "ok", "rank": "up", "settlement_date": D3, "rows": []}, "held", sl.NOTE_FAILED),
                            ({"status": "bad_rank", "ranks": list(sd.RANKS)}, "refused", sl.NOTE_BAD_RANK.format(ranks="dtc, up, down, float"))):
        monkeypatch.setattr(sl, "held_answer", lambda rank, limit, h=held, w=how: (h, w))
        out = _read(sl.KIND)
        _conforms(out, sl.KIND)
        assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [note], held

    def boom(rank, limit):
        raise RuntimeError("held list unreadable at /data/internal")
    monkeypatch.setattr(sl, "held_answer", boom)
    out = _read(sl.KIND)
    assert out["notes"] == [sl.NOTE_FAILED] and "internal" not in json.dumps(out)


def test_list_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(sl, "held_answer", lambda rank, limit: ran.append(rank) or (None, "not_held"))
    for bad in ({"rank": "banana"}, {"rank": "UP"}, {"rank": "short"}, {"rank": 1}, {"limit": 0}, {"limit": sl.MAX_LIMIT + 1},
                {"limit": True}, {"limit": "5"}):
        assert _read(sl.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── the budget rule, across the wave ─────────────────────────────────────────────────────────────────────────────────
READS = [(si.KIND, {"symbol": "AAA"}), (si.KIND, {"symbol": "CCC", "reports": 1, "days": 60}), (si.KIND, {"symbol": "QQQQ"}),
         (sl.KIND, {}), (sl.KIND, {"rank": "up", "limit": 1}), (sl.KIND, {"rank": "down"}), (sl.KIND, {"rank": "float", "limit": 50})]


def test_no_read_of_this_wave_reaches_a_builder_the_vendor_or_a_thread_held_or_not(vendor, work):
    """Every entry point that can cause work is replaced by one that fails and counts: the two route readers, the two
    builders, the job starter, the two thread bodies, the three vendor reads and the vendor adapter itself."""
    reached = []

    def forbid(mp):
        for name in FORBIDDEN:
            assert callable(getattr(sd, name)), name                    # a rename fails here, by name
            mp.setattr(sd, name, lambda *a, _n=name, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        forbid(mp)
        _close(vendor, work)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, params)
        assert reached == [] and _quiet(vendor, work)
    vendor.closed = False
    for sym in ("AAA", "CCC", "QQQQ"):
        _hold_stock(vendor, sym)
    _hold_market(vendor)
    with sd._lock:                                                      # every stock past its freshness, and a look due
        for sym, (_exp, held) in list(sd._stock_done.items()):
            sd._stock_done[sym] = (time.time() - 1, held)
        sd._market["checked"] = 0.0
    with pytest.MonkeyPatch.context() as mp:                            # everything held, every rebuild and the look due
        forbid(mp)
        _close(vendor, work)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "ok", (kind, params, out["notes"])
        assert reached == [] and _quiet(vendor, work)
        with sd._lock:
            assert sd._market["inflight"] is None and not sd._stock_inflight


# ── the licensing record the isolation rests on ──────────────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_are_member_display_only():
    register = REGISTER.read_text(encoding="utf-8")
    for row, dataset in (("T-93", "short interest"), ("T-94", "daily short sale volume")):
        line = next(ln for ln in register.splitlines() if ln.startswith(f"| {row} |"))
        assert line.startswith(f"| {row} | Member display") and dataset in line and "**Origin: FINRA**" in line, row
        assert "| **LA** |" in line and ("Keep member-only" in line or "| As T-93 |" in line), row
        assert "model provider" not in line                             # the row clears display to members, and nothing for a model
    for m in MODULES:                                                  # each adapter says which rows, and claims no more
        assert "licensing-register.md" in m.__doc__ and "T-93" in m.__doc__ and "no row" in m.__doc__, m.KIND
        assert "for display to members" in " ".join(m.__doc__.split()), m.KIND


# ── the contract (MD-1 v1.11 §4.14) ──────────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_14_and_every_note_the_adapters_emit():
    """MD-1 §4.14 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8")
    head = "### 4.14 Terminal data wave 5: `short.interest`, `short.list` (v1.11, terminal-data)"
    assert head in doc                                    # the section, not the file's title: later bumps add
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section, m.KIND      # its table row
    for words in list(sl.CHECK_WORDS.values()) + [sl.CHECK_FAILED] + list(sl.RANK_WORDS.values()) + list(si.SECTION_WORDS.values()):
        assert words in section, words                    # the words a note is filled with
    # default OFF, the isolation switch and the never-builds rule are stated where the kinds are documented
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build, a check or a vendor request.**", "`short_data.held_stock`",
              "`short_data.held_market`", "rows T-93 and T-94", "for display to members",
              "no row of that register clears it for a model provider", "never today"):
        assert s in section, s
    # wave 4's section still ends where this one begins
    assert doc.index("### 4.13 Terminal data wave 4") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 11
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.11 addition (2026-11-18, terminal-data, data wave 5):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.14 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.10 addition (2026-11-18, terminal-data, data wave 4):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.9", "v1.10", "v1.11"))
    # nothing in the section or the entry records or implies an owner decision about these kinds
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will"):
            assert claim not in text, claim
    assert "- **`flow.summary`:** only through the existing flow proxy" in doc       # still deferred: no tape kind was added
