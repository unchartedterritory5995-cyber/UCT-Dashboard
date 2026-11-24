"""MD-1 kinds of terminal data wave 7: `market.regime`, `stock.setups`, `stock.eventsTimeline`, `uct20.list`,
`options.ivHistory`, `dilution.watch` — the Agent half of the REGM, TECH (confirmed setups), EVTS, UCT 20, IVH and
DILU surfaces.

No network and no real store: the regime cache entry, the verdict store, the earnings snapshot store and the three
event stores, the pushed wire, the options log's local mirror and the dilution answer are stand-ins or temp files,
and every held answer is put where its service keeps it BY the service (the shared cache's own `set`, the verdict
store's own `put_verdict`, the options log's own column list, the dilution watch's own `assemble` and `_remember`).
Every number, name and date is invented. Pinned per kind: an ok read (envelope conformance, every number the
service's own, the data's own date as `as_of` with the read time beside it), a missing number null and never 0, the
cut stated and from which end, `unavailable` kept apart from a healthy answer with each state said in its own note,
a malformed request refused before any read, a failing service answered `unavailable`, and THE BUDGET RULE: no read
starts a compute, a build, a download or a thread or reaches a vendor, with the member path's own reader shown to do
exactly that in the same state (so the rail can fail). For all six: registered dark, model-isolated, dormant until
armed one by one. The cross-file facts (the services' own constants, the panels' own fields and row counts) are read
from the other file rather than retyped. And the contract: MD-1 §4.16 quotes every note these adapters emit.
"""
from __future__ import annotations

import contextlib
import csv
import datetime as dt
import gzip
import inspect
import json
import os
import re
import threading
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api import flow_backup
from api.routers import bars as bars_router
from api.routers import live_prices
from api.routers import patterns as patterns_route
from api.services import bars_fetch, engine, massive, massive_adapter, session_calendar
from api.services import deal_status as ds
from api.services import dilution_watch as dw
from api.services import earnings_intel as ei
from api.services import earnings_reaction_panel as erp
from api.services import events_timeline as ev
from api.services import options_universe_log as oplog
from api.services import voice_regime_classifier as vrc
from api.services import voice_regime_held
from api.services.cache import cache
from api.services.pattern_engine.detectors import registry as pe_registry
from api.services.pattern_vision import store as pv
from api.services.research import iv_history as ivs
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import dilution_read as dr
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import events_timeline_read as etr
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import iv_history_read as ivr
from api.services.uct_agent.marketdata import regime_read as rr
from api.services.uct_agent.marketdata import sessions
from api.services.uct_agent.marketdata import setups_read as sr
from api.services.uct_agent.marketdata import uct20_read as u20
from api.services.uct_agent.marketdata.short_interest import day_as_of

REPO = Path(__file__).resolve().parents[1]
MODULES = (rr, sr, etr, u20, ivr, dr)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation defaults (ADR-005): all six. They are the builder's defaults; a kind leaving this set is an
#: owner decision that has not been made.
ISOLATED = set(KINDS)
GOOD = {rr.KIND: {}, sr.KIND: {"symbol": "AAA"}, etr.KIND: {"symbol": "AAA"}, u20.KIND: {}, ivr.KIND: {"symbol": "AAA"},
        dr.KIND: {"symbol": "AAA"}}
ACTIONS = {"stock.marketRegime", "stock.setups", "stock.eventsTimeline", "stock.uct20List", "stock.ivHistory",
           "stock.dilutionWatch"}
PANELS = REPO / "app/src/pages/terminal/panels"
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
ET = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
LAST = 20261118                                         # the newest completed session (a Wednesday)
LAST_DAY, PRIOR_DAY, TODAY = "2026-11-18", "2026-11-17", dt.date(2026, 11, 19)
NOW_ET = dt.datetime(2026, 11, 19, 10, 0, tzinfo=ET)   # Thursday morning: Wednesday is the newest completed session
#: when the chart judge last ran in these tests: 2026-11-18 17:30 ET
JUDGED = int(dt.datetime(2026, 11, 18, 22, 30, tzinfo=UTC).timestamp())
#: every module that holds a provider client under its own name
PROVIDER_DOORS = (massive, bars_fetch, live_prices)
#: what a turn must never reach, per service: every compute, builder, job starter, download and route reader
FORBIDDEN = {
    vrc: ("get_current_regime", "_fetch_signals", "_classify"),
    engine: ("get_breadth", "get_leadership"),
    massive: ("get_ticker_snapshot",),
    pv: ("init_db", "put_verdict", "may_judge", "log_cost"),
    erp: ("_cached_earnings",),
    ei: ("_schedule_refresh", "_build"),
    ds: ("consumer_pending", "pending_deal_symbols", "_sets", "_build_sets", "_spawn_sets_refresh", "_refresh_sets",
         "deal_status"),
    bars_router: ("warm_bars_async",),
    ivs.R2Store: ("_sync", "_client", "sessions"),
    ivs: ("implied_vs_realized", "_default_prints"),
    flow_backup: ("_r2_client",),
    dw: ("get_watch", "_bg", "build", "_sec_get", "_resolve_cik"),
}
READS = [(rr.KIND, {}), (sr.KIND, {"symbol": "AAA"}), (sr.KIND, {"symbol": "AAA", "rows": 1}),
         (etr.KIND, {"symbol": "AAA"}), (etr.KIND, {"symbol": "AAA", "rows": 2}), (u20.KIND, {}), (u20.KIND, {"rows": 5}),
         (ivr.KIND, {"symbol": "AAA"}), (ivr.KIND, {"symbol": "AAA", "rows": 3}), (dr.KIND, {"symbol": "AAA"}),
         (dr.KIND, {"symbol": "AAA", "rows": 2})]


# ── the regime read (market.regime) ───────────────────────────────────────────────────────────────────────────
REGIME = {
    "regime": "bull_correction", "confidence": 0.42,
    "reasons": ["55% above 50MA (decent)", "62% above 200MA (long-term healthy)", "140 new highs vs 60 lows",
                "VIX 17.5 (complacent)", "4 distribution days", "UCT exposure 82"],
    "signals": {"pct_above_50ma": 55.0, "pct_above_200ma": 62.0, "pct_above_5ma": 48.0, "new_highs": 140.0,
                "new_lows": 60.0, "breadth_score": 61.0, "distribution_days": 4.0,
                "market_phase": "Uptrend under pressure", "uct_exposure_rating": 82.0, "vix": 17.5},
    "narration": "Regime: invented (moderate confidence).", "vocabulary_version": vrc.REGIME_VOCABULARY_VERSION,
}


def _hold_regime(age_s=600, **over):
    """A classification as `get_current_regime()` stores it, computed `age_s` seconds ago."""
    held = {**REGIME, "label": vrc.label_of(over.get("regime", REGIME["regime"])), **over}
    cache.set(vrc._CACHE_KEY, held, ttl=vrc._TTL_SECONDS - age_s)
    return held


# ── the verdict store (stock.setups) ──────────────────────────────────────────────────────────────────────────
def _verdict(setup, day, *, confirmed=1, conf=82.0, level=101.5, sym="AAA", judged=JUDGED):
    return {"ticker": sym, "tf": "D", "setup": setup, "asof_date": day, "confirmed": confirmed,
            "vision_confidence": conf, "rationale": "an invented reason the judge wrote", "key_level": level,
            "raw_confidence": 70.0, "model": "test-model", "signals_hash": "h", "judged_at": judged,
            "checks": json.dumps([{"criterion": "first invented check", "passed": True},
                                  {"criterion": "second invented check", "passed": False}])}


def _hold_setups(*verdicts):
    pv.init_db()
    for v in verdicts:
        pv.put_verdict(v)


def _five_judged():
    """Five setups judged in the window: two a member sees, one internal, one rejected, one under the floor; and
    one confirm on a bar older than the window."""
    _hold_setups(_verdict("golden_cross", LAST_DAY, conf=82.0, level=101.5),
                 _verdict("death_cross", PRIOR_DAY, conf=71.0, level=None, judged=JUDGED - 86400),
                 _verdict("uct_launch_pad", LAST_DAY, conf=90.0, level=55.0),
                 _verdict("flat_base", LAST_DAY, confirmed=0, conf=20.0, level=None),
                 _verdict("bull_flag", LAST_DAY, conf=45.0, level=77.0),
                 _verdict("cup_with_handle", "2026-11-05", conf=88.0, level=33.0))


# ── the event stores (stock.eventsTimeline) ───────────────────────────────────────────────────────────────────
EARNINGS = {"quarters": [
    {"label": "Q3", "report_date": "2026-10-27", "reported": True, "eps_actual": 1.1, "eps_estimate": 1.0},
    {"label": "Q2", "report_date": "2026-07-28", "reported": True, "eps_actual": 0.9, "eps_estimate": None},
], "summary": {"next_report_date": "2027-01-26", "next_report_label": "Q4"}}
THESIS = "an invented thesis sentence the catalyst engine wrote"
FILING_URL = "https://www.sec.gov/invented/filing-page"
CATALYST = {"date": "2026-10-23", "kind": "uct_catalyst", "title": "UCT catalyst engine: Earnings (rank 3)",
            "detail": THESIS, "source": "UCT catalyst engine (catalysts.db)"}
FILING = {"date": "2026-11-03", "kind": "filing", "title": "Filed 8-K", "detail": "0001234567-26-000001",
          "url": FILING_URL, "source": "SEC EDGAR, via the filing-search index"}
SPIKE = {"date": "2026-10-29", "kind": "room_spike", "title": "Room mentions spiked: 9 (trailing 20-weekday median 2)",
         "detail": None, "source": "#main-chat mention store (buzz.db)"}


class Snap:
    """Stands where the fundamentals snapshot store stands (the earnings history's durable copy)."""

    def __init__(self):
        self.held, self.asked = {}, []

    def get(self, kind, sym):
        self.asked.append((kind, sym))
        hit = self.held.get(sym)
        return (hit, 0) if hit is not None else None

    def put(self, *a, **kw):
        raise AssertionError("a read wrote to the snapshot store")


class Stores:
    """Stands where the three event stores stand: each answers its list, or raises what it is given."""

    def __init__(self):
        self.by = {"uct_catalyst": [], "filing": [], "room_spike": []}
        self.asked = []

    def reader(self, name):
        def read(sym):
            self.asked.append((name, sym))
            hit = self.by[name]
            if isinstance(hit, BaseException):
                raise hit
            return [dict(e) for e in hit]
        return read


def _hold_events(world, earnings=EARNINGS):
    if earnings is not None:
        world.snap.held["AAA"] = earnings
    world.stores.by.update(uct_catalyst=[CATALYST], filing=[FILING], room_spike=[SPIKE])


# ── the pushed wire (uct20.list) ──────────────────────────────────────────────────────────────────────────────
NAMES = ["AAA", "AAB", "AAC", "AAD", "AAE", "AAF", "AAG", "AAH", "AAI", "AAJ", "AAK", "AAL", "AAM", "AAN", "AAO", "AAP",
         "AAQ", "AAR", "AAS", "AAT", "AAU", "AAV"]
#: values of the fields the read leaves out, chosen so that none can be mistaken for a figure it carries
OUT_VALUES = {"entry": 777.77, "stop": 666.66, "target_1": 888.88, "target_2": 999.99, "price": 555.55, "change": 4.44,
              "thesis": "AN INVENTED THESIS", "company_desc": "AN INVENTED DESCRIPTION"}


def _wire_row(i, sym):
    return {"ticker": sym, "rs": 99.0 - i, "score": 90.0 - i, "ret_1m": 10.0 + i, "ret_3m": 30.0 + i,
            "earnings_date": "2026-12-10", **OUT_VALUES}


def _hold_wire(rows=None, date=LAST_DAY, meta=None):
    wire = {"leadership": rows if rows is not None else [_wire_row(i, s) for i, s in enumerate(NAMES)]}
    if date:
        wire["date"] = date
    if meta is not None:
        wire["leadership_meta"] = meta
    cache.invalidate("leadership")
    cache.set("wire_data", wire, ttl=600)
    return wire["leadership"]


def _hold_pending(*syms, day=None):
    """Today's pending-acquisition set, where `deal_status` keeps the one it built."""
    with ds._LOCK:
        ds._SETS["v"] = {"pending": frozenset(syms), "completed": frozenset(), "day": day or ds._today(),
                         "at": time.time(), "ttl": 3600.0}


# ── the options log's local mirror (options.ivHistory) ────────────────────────────────────────────────────────
def _sessions_ending(last: str, n: int) -> list:
    d, out = dt.date.fromisoformat(last), []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d -= dt.timedelta(days=1)
    return out[::-1]


def _iv_row(sym, iv, *, px=100.0, dte=30, exp="2026-12-18"):
    return {"underlying": sym, "contracts": 10, "call_oi": 1, "put_oi": 1, "underlying_price": px, "atm_iv": iv,
            "atm_expiration": exp, "atm_strike": px, "atm_dte": dte, "front_expiration": None, "front_dte": None,
            "front_strike": None, "front_straddle": None}


class Mirror:
    """The local mirror of the options log, written with the logger's own column list."""

    def __init__(self, root):
        self.root = str(root)

    def day(self, session, rows, *, complete=True):
        ydir = os.path.join(self.root, "options_log", session[:4])
        os.makedirs(ydir, exist_ok=True)
        with gzip.open(os.path.join(ydir, f"{session}.underlyings.csv.gz"), "wt", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=oplog.UNDERLYING_FIELDS, extrasaction="ignore")
            w.writeheader()
            for r in sorted(rows, key=lambda r: r["underlying"]):
                w.writerow(r)
        with open(os.path.join(ydir, f"{session}.manifest.json"), "w", encoding="utf-8") as fh:
            json.dump({"session": session, "complete": complete, "reason": None if complete else "invented"}, fh)
        ivs._ROW_CACHE.clear()

    def service(self, sym="AAA"):
        """The service's own answer over the same files, read through a plain local store."""
        return ivs.iv_history(sym, store=ivs.LocalStore(self.root))


def _hold_iv(world, n=25, last=LAST_DAY, sym="AAA"):
    days = _sessions_ending(last, n)
    for i, d in enumerate(days):
        world.mirror.day(d, [_iv_row(sym, round(0.30 + 0.004 * i, 4), dte=30 - (i % 5)), _iv_row("ZZZ", 0.2)])
    return days


# ── the dilution answer (dilution.watch) ──────────────────────────────────────────────────────────────────────
CIK = "0001234567"
SHELF_FILE, OLD_SHELF_FILE = "333-270001", "333-250001"
COLUMNS = ("accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "act", "form", "fileNumber", "filmNumber",
           "items", "core_type", "size", "isXBRL", "isInlineXBRL", "isXBRLNumeric", "primaryDocument", "primaryDocDescription")
READ_AT = "2026-11-18T16:00:00+00:00"
_n = [0]


def _filing(form, day, file_no="", items=""):
    _n[0] += 1
    return {"accessionNumber": f"{CIK}-{day[2:4]}-{_n[0]:06d}", "filingDate": day, "reportDate": "",
            "acceptanceDateTime": f"{day}T16:{_n[0] % 60:02d}:00.000Z", "act": "33", "form": form, "fileNumber": file_no,
            "filmNumber": "1", "items": items, "core_type": form, "size": 1000, "isXBRL": 0, "isInlineXBRL": 0,
            "isXBRLNumeric": 0, "primaryDocument": "doc.htm", "primaryDocDescription": form}


def _shelf_rows():
    """A company with a shelf in force and offering documents under it (the dilution watch's own test company)."""
    return [_filing("10-Q", "2026-11-05"), _filing("424B5", "2026-10-02", SHELF_FILE), _filing("FWP", "2026-10-01", SHELF_FILE),
            _filing("8-K", "2026-09-30", "001-30001", "1.01,3.02,9.01"), _filing("8-K", "2026-08-01", "001-30001", "1.01,9.01"),
            _filing("424B5", "2026-05-20", SHELF_FILE), _filing("424B5", "2026-01-15", SHELF_FILE),
            _filing("424B5", "2025-12-01", SHELF_FILE), _filing("424B5", "2025-06-02", SHELF_FILE),
            _filing("EFFECT", "2025-03-12", SHELF_FILE), _filing("S-3/A", "2025-03-10", SHELF_FILE),
            _filing("S-3", "2025-03-04", SHELF_FILE), _filing("424B2", "2024-03-03", OLD_SHELF_FILE),
            _filing("S-8", "2024-02-01", "333-260009"), _filing("4", "2023-12-01"),
            _filing("S-3ASR", "2023-01-10", OLD_SHELF_FILE)]


def _dilution_answer(rows=None, covered_from=None, entity="operating"):
    """One company's answer, made by the service's own `assemble` from an index in the SEC's shape."""
    rows = sorted(rows if rows is not None else _shelf_rows(), key=lambda r: (r["filingDate"], r["acceptanceDateTime"]),
                  reverse=True)
    doc = {"cik": CIK, "entityType": entity, "name": "Acme Example Corp", "tickers": ["AAA"],
           "filings": {"recent": {c: [r.get(c) for r in rows] for c in COLUMNS}, "files": []}}
    filings, _dropped = dw.read_columns(doc["filings"]["recent"])
    return dw.assemble("AAA", CIK, doc, filings, today=dt.date(2026, 11, 18), covered_from=covered_from, read_at=READ_AT)


def _hold_dilution(answer=None, sym="AAA"):
    answer = answer if answer is not None else _dilution_answer()
    dw._remember(sym, answer, dw.FRESH_S)
    return answer


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
class World:
    pass


def _forget():
    for key in (vrc._CACHE_KEY, "wire_data", "leadership", f"{ei._KIND}::AAA", f"{ei._KIND}::BBB"):
        cache.invalidate(key)
    ds.reset_cache()
    dw.reset_for_tests()
    ivs._ROW_CACHE.clear()


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    w = World()
    # the calendar: Wednesday 2026-11-18 is the newest completed session, read on Thursday morning
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: LAST)
    # the verdict store: a temp file, and the store's own window counted from the read day of these tests
    w.pv_path = str(tmp_path / "pattern_vision.db")
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", w.pv_path)
    real_floor = pv.confirmed_window_floor
    monkeypatch.setattr(pv, "confirmed_window_floor", lambda today=None: real_floor(today or TODAY.isoformat()))
    # the events timeline: its switch on, the earnings snapshot store and the three event stores as stand-ins
    monkeypatch.setenv(ev.ENABLED_ENV, "1")
    w.snap, w.stores = Snap(), Stores()
    monkeypatch.setattr(ei, "snap_store", w.snap)
    for name in ("uct_catalyst", "filing", "room_spike"):
        monkeypatch.setitem(ev.SOURCES, name, w.stores.reader(name))
    monkeypatch.setattr(etr, "today_et", lambda: TODAY.isoformat())
    # the pushed wire: no file on disk, the trading calendar's expected run is Wednesday's
    monkeypatch.setattr(engine, "PERSISTENT_WIRE_DATA_FILE", str(tmp_path / "no_wire_a.json"))
    monkeypatch.setattr(engine, "WIRE_DATA_FILE", str(tmp_path / "no_wire_b.json"))
    monkeypatch.setattr(engine, "_load_state", lambda: {})
    monkeypatch.setattr(engine, "expected_wire_date", lambda: dt.date(2026, 11, 18))
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    # the options log: its switch on, the PRODUCTION store over a temp mirror (nothing overrides it)
    monkeypatch.setenv(ivs.FLAG, "1")
    w.mirror = Mirror(tmp_path / "iv_mirror")
    monkeypatch.setattr(ivs, "_store_override", None)
    monkeypatch.setattr(ivs, "_default_store", ivs.R2Store(w.mirror.root))
    monkeypatch.setattr(ivs, "_now_et", lambda now=None: NOW_ET)
    _forget()
    gw._reset_for_test(None)
    yield w
    _forget()
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


def _quiet(world, work) -> bool:
    return work == {"provider": 0, "threads": []}


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"w7-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["freshness"] == ("periodic" if kind == rr.KIND else "historical")
        if out["as_of"] is None:
            assert "`as_of` is null" in " ".join(out["notes"]) or "as_of` is null" in " ".join(out["notes"])
        elif kind != rr.KIND:
            assert not out["as_of"].startswith(TODAY.isoformat())       # the data's own date, never the read day
        assert out["as_of"] != out["fetched_at"]
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway
    else:
        assert out["data"] is None and out["notes"]


def _plain(v):
    """A read's data without the gateway's isolation stamps."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


def _made_from(template):
    """A pattern for the notes a template makes: its fixed text, with anything where a placeholder stands."""
    return re.compile(".+?".join(re.escape(p) for p in re.split(r"\{\w+\}", template)), re.S)


def _note(out, template):
    """The one note of `out` made from `template`."""
    hits = [n for n in out["notes"] if _made_from(template).fullmatch(n)]
    assert len(hits) == 1, (template, out["notes"])
    return hits[0]


def _lacks(out, template):
    return not [n for n in out["notes"] if _made_from(template).fullmatch(n)]


def _zeros(v, path=""):
    """Every place in `v` holding a number equal to 0 (not a bool)."""
    if isinstance(v, dict):
        return [p for k, x in v.items() for p in _zeros(x, f"{path}.{k}")]
    if isinstance(v, list):
        return [p for i, x in enumerate(v) for p in _zeros(x, f"{path}[{i}]")]
    return [path] if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0 else []


def _numbers(v):
    """Every number anywhere in `v`."""
    if isinstance(v, dict):
        return [n for x in v.values() for n in _numbers(x)]
    if isinstance(v, list):
        return [n for x in v for n in _numbers(x)]
    return [v] if isinstance(v, (int, float)) and not isinstance(v, bool) else []


def _keys(v):
    """Every dict key anywhere in `v`."""
    if isinstance(v, dict):
        return set(v) | {k for x in v.values() for k in _keys(x)}
    return {k for x in v for k in _keys(x)} if isinstance(v, list) else set()


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────
def test_all_six_kinds_are_registered_once_by_their_modules_and_all_six_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert [r.get(k).max_symbols for k in KINDS] == [0, 1, 1, 0, 1, 1]
    assert KINDS == ("market.regime", "stock.setups", "stock.eventsTimeline", "uct20.list", "options.ivHistory",
                     "dilution.watch")
    assert [m.SOURCE for m in MODULES] == ["uct-regime-classifier", "uct-setup-verdicts", "uct-events-stores",
                                           "uct-morning-wire", "uct-options-log", "sec-edgar-filing-index"]
    assert [fn.__name__ for fn in (r.get(k).fn for k in KINDS)] == ["read_regime", "read_setups", "read_events",
                                                                    "read_uct20", "read_iv_history", "read_dilution"]
    # the six capabilities that read them are local-only on the server, by name
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    monkeypatch.setattr(rr, "held_answer", lambda: ran.append("rr"))
    monkeypatch.setattr(sr, "held_answer", lambda sym: ran.append("sr"))
    monkeypatch.setattr(etr, "held_answer", lambda sym: ran.append("etr") or (None, "off"))
    monkeypatch.setattr(u20, "held_answer", lambda: ran.append("u20") or (None, "not_held"))
    monkeypatch.setattr(ivr, "held_answer", lambda sym: ran.append("ivr") or (None, "off"))
    monkeypatch.setattr(dr, "held_answer", lambda sym: ran.append("dr") or (None, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,seasonality.stock,rates.treasury")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _hold_regime()
    _hold_dilution()
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and _plain(out["data"]) is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, dr.KIND)                  # arming ONE arms one
    assert _read(dr.KIND)["status"] == "ok"
    for kind in KINDS[:-1]:
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(dr.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(rr.KIND)["status"] == "ok"
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns all six off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_words_bounds_and_fields_are_the_services_and_the_panels_own():
    # the regime: the classifier's own inputs, and the REGM panel's own fields
    panel = (PANELS / "RegimePanel.jsx").read_text(encoding="utf-8")
    for name in rr.SIGNALS + rr.LEFT_OUT:
        assert f"s.{name}" in panel, name                               # the panel shows it
    assert "s.market_phase" in panel
    assert set(rr.SIGNALS) | set(rr.LEFT_OUT) <= set(rr.INPUTS) and not set(rr.SIGNALS) & set(rr.LEFT_OUT)
    source = inspect.getsource(vrc._fetch_signals)
    for name in rr.INPUTS:
        assert f'signals["{name}"]' in source, name                     # each is a signal the classifier reads
    assert rr.MAX_REASONS == 6 and "reasons[:6]" in inspect.getsource(vrc._classify)
    assert rr.vocabulary() == (tuple(vrc.REGIMES), vrc.label_of, vrc.band_of, vrc.REGIME_VOCABULARY_VERSION)
    # the setups: the route's own confidence floor and timeframe, and the store's own window
    sig = inspect.signature(patterns_route.get_detections).parameters
    assert sig["min_conf"].default.default == sr.MIN_CONFIDENCE and sig["tf"].default.default == sr.TF
    assert sig["confirmed_only"].default.default is True
    # the timeline: the service's own ceiling on prints and its own four sources
    assert etr.MAX_PRINTS == ev.MAX_PRINTS
    assert set(etr.SOURCE_NAMES) == {"earnings"} | set(ev.SOURCES) == set(etr.SOURCE_WORDS)
    assert etr.NO_DETAIL_KINDS == ("uct_catalyst",)
    # the UCT 20: the page's own slice, and the route's own states
    page = (REPO / "app/src/pages/UCT20.jsx").read_text(encoding="utf-8")
    assert int(re.search(r"const stocks = rawStocks\.slice\(0, (\d+)\)", page).group(1)) == u20.MAX_ROWS == u20.DEFAULT_ROWS
    assert set(u20.STALE_WORDS) == {"stale", "held", "degraded"}
    assert not set(u20.FIELDS) & set(u20.LEFT_OUT)
    # the IV history: the rank's own keys
    assert set(ivr.RANK_KEYS) | {"window_sessions"} == set(ivs.rank_of([0.2, 0.3, 0.25]))
    # the dilution watch: the panel's own shelf count, and the service's own reasons
    model = (PANELS / "dilutionModel.js").read_text(encoding="utf-8")
    assert int(re.search(r"export const SHELVES_SHOWN = (\d+)", model).group(1)) == dr.MAX_SHELVES
    assert set(dr.NONE_WORDS) == {"no_cik", "no_filings"}
    assert set(dr.FAILED_WORDS) == {"refused", "shape", "rate_limited", "timeout", "source", "error"}
    assert set(dr.HORIZONS) <= set(_dilution_answer()["summary"])
    # each accessor this wave reads through says, in its own words, that it never builds
    for fn in (voice_regime_held.held_regime, erp.held_earnings, dw.held_watch, sr.held_answer, u20.held_answer,
               u20.held_pending, ivr.held_answer, etr.held_answer):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__
    assert "READ ONLY" in ev.timeline.__doc__


# ── market.regime ─────────────────────────────────────────────────────────────────────────────────────────────
def test_regime_reads_the_held_classification_with_every_figure_the_classifiers_own(world, work):
    held = _hold_regime(age_s=600)
    out = _read(rr.KIND)
    _conforms(out, rr.KIND)
    assert out["status"] == "ok" and out["source"] == rr.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    assert (d["regime"], d["confidence"]) == (held["regime"], held["confidence"])
    assert d["label"] == vrc.label_of(held["regime"]) and d["band"] == vrc.band_of(held["regime"]) == "YELLOW"
    assert d["signals"] == {**{k: held["signals"][k] for k in rr.SIGNALS}, "market_phase": "Uptrend under pressure"}
    assert d["vocabulary_version"] == vrc.REGIME_VOCABULARY_VERSION
    # the Exposure Rating and the VIX level are left out, with the reason lines that state them
    assert d["left_out"] == list(rr.LEFT_OUT) and d["reasons_left_out"] == 2
    assert d["reasons"] == [r for r in held["reasons"] if not r.startswith(("UCT exposure ", "VIX "))]
    assert not _keys(d) & set(rr.LEFT_OUT) and "breadth_score" not in _keys(d)
    assert 82.0 not in _numbers(d) and 17.5 not in _numbers(d) and 61.0 not in _numbers(d)
    assert "82" not in " ".join(d["reasons"]) and "17.5" not in " ".join(d["reasons"])
    # as_of is when the classifier stored it (ten minutes before this read), with the read time beside it
    assert out["as_of"] == d["computed_at"]
    as_of = dt.datetime.fromisoformat(out["as_of"].replace("Z", "+00:00"))
    read = dt.datetime.fromisoformat(out["fetched_at"].replace("Z", "+00:00"))
    assert abs((read - as_of).total_seconds() - 600) <= 5
    assert out["notes"] == [rr.NOTE_WHAT, rr.NOTE_AS_OF.format(at=out["as_of"]), rr.NOTE_LEFT_OUT.format(n=2)]
    assert out["coverage"] == {"evaluated": 5, "answered": 5, "dropped": 0, "not_computable": 0}
    assert "advice" in rr.NOTE_WHAT and "not advice" in rr.NOTE_WHAT
    assert _quiet(world, work)


def test_regime_a_figure_the_classifier_did_not_have_is_null_never_zero(world, work):
    signals = {**REGIME["signals"], "new_lows": None, "distribution_days": "n/a", "market_phase": "  "}
    _hold_regime(signals=signals)
    out = _read(rr.KIND)
    _conforms(out, rr.KIND)
    d = _plain(out["data"])
    assert d["signals"]["new_lows"] is None and d["signals"]["distribution_days"] is None
    assert d["signals"]["market_phase"] is None and _zeros(d) == []
    assert _note(out, rr.NOTE_MISSING) == rr.NOTE_MISSING.format(n=2, list="new lows, distribution days")
    assert out["coverage"] == {"evaluated": 5, "answered": 3, "dropped": 0, "not_computable": 2}


def test_regime_nothing_held_is_unavailable_and_nothing_is_computed(world, work):
    _unavailable(_read(rr.KIND), rr.KIND, rr.NOTE_NOT_HELD)
    assert cache.get(vrc._CACHE_KEY) is None and _quiet(world, work)    # and the read stored nothing
    assert "never computes one" in rr.NOTE_NOT_HELD and "not the same as no regime" in rr.NOTE_NOT_HELD


@pytest.mark.parametrize("over", [
    {"signals": {k: None for k in REGIME["signals"]}},                  # the classifier named a regime with no input
    {"regime": "sideways"},                                             # not in the classifier's vocabulary
    {"regime": None}, {"confidence": None}, {"confidence": "high"}, {"error": "breadth read failed"},
    {"signals": None},
])
def test_regime_a_held_read_with_nothing_behind_it_names_no_regime(world, over):
    _hold_regime(**over)
    _unavailable(_read(rr.KIND), rr.KIND, rr.NOTE_UNKNOWN)


def test_regime_a_failing_reader_is_unavailable_and_the_request_takes_no_argument(world, monkeypatch):
    _hold_regime()
    out = _read(rr.KIND, {"symbol": "AAA"})                             # the kind takes no symbol: the gateway's own rule
    assert out["status"] == "refused" and out["notes"] == ["at most 0 symbols per read"]
    assert _read(rr.KIND, {"rows": 3})["status"] == "ok"                # any other argument changes nothing
    assert rr.validate("x") == "the request must be an object"
    monkeypatch.setattr(rr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(rr.KIND), rr.KIND, rr.NOTE_FAILED)
    monkeypatch.setattr(rr, "held_answer", lambda: ("not a classification", time.time()))
    _unavailable(_read(rr.KIND), rr.KIND, rr.NOTE_FAILED)
    monkeypatch.setattr(rr, "held_answer", lambda: (dict(REGIME), "not a time"))
    _unavailable(_read(rr.KIND), rr.KIND, rr.NOTE_FAILED)


# ── stock.setups ──────────────────────────────────────────────────────────────────────────────────────────────
def test_setups_reads_the_stored_verdicts_a_member_sees_with_every_figure_the_stores_own(world, work):
    _five_judged()
    out = _read(sr.KIND)
    _conforms(out, sr.KIND)
    assert out["status"] == "ok" and out["source"] == sr.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    names = patterns_route._PATTERN_METADATA
    assert d["rows"] == [
        {"setup": "golden_cross", "name": names["golden_cross"]["name"], "asof_date": LAST_DAY, "confidence": 82.0,
         "key_level": 101.5, "checks_passed": 1, "checks_made": 2},
        {"setup": "death_cross", "name": names["death_cross"]["name"], "asof_date": PRIOR_DAY, "confidence": 71.0,
         "key_level": None, "checks_passed": 1, "checks_made": 2},
    ]
    # the member's rules: the internal setup, the one under the route's floor, the rejected one and the confirm on a
    # bar older than the store's window are not served; all five judged in the window are counted
    assert "uct_launch_pad" in pe_registry.INTERNAL_PATTERN_IDS
    assert (d["count"], d["confirmed_total"], d["cut"], d["evaluated"]) == (2, 2, False, 5)
    assert d["window_days"] == pv.CONFIRMED_MAX_AGE_DAYS and d["min_confidence"] == sr.MIN_CONFIDENCE and d["tf"] == "D"
    # the written reasons and the check list are left out
    assert d["left_out"] == ["rationale", "checks"] and not _keys(d) & {"rationale", "checks", "criterion"}
    assert "invented" not in json.dumps(d)
    # as_of is the newest bar judged; when the judge ran rides beside it
    assert out["as_of"] == day_as_of(LAST_DAY) and d["as_of"] == LAST_DAY
    assert d["judged_at"] == "2026-11-18T22:30:00Z" and d["expected_session"] == LAST_DAY
    assert _note(out, sr.NOTE_AS_OF) == sr.NOTE_AS_OF.format(day=LAST_DAY, at="2026-11-18T22:30:00Z")
    assert _note(out, sr.NOTE_WINDOW) == sr.NOTE_WINDOW.format(days=pv.CONFIRMED_MAX_AGE_DAYS, evaluated=5)
    assert _note(out, sr.NOTE_MISSING) == sr.NOTE_MISSING.format(n=1) and _zeros(d["rows"]) == []
    assert out["notes"][0] == sr.NOTE_WHAT.format(symbol="AAA") and sr.NOTE_LEFT_OUT in out["notes"]
    assert _lacks(out, sr.NOTE_CUT) and _lacks(out, sr.NOTE_STALE)
    assert out["coverage"] == {"evaluated": 5, "answered": 2, "dropped": 0, "not_computable": 1}
    assert _quiet(world, work)


def test_setups_a_long_list_is_cut_from_the_old_end_and_says_so(world):
    _five_judged()
    out = _read(sr.KIND, {"symbol": "aaa", "rows": 1})
    _conforms(out, sr.KIND)
    d = _plain(out["data"])
    assert [r["setup"] for r in d["rows"]] == ["golden_cross"]          # the newest bar is kept
    assert (d["count"], d["confirmed_total"], d["cut"]) == (1, 2, True)
    note = _note(out, sr.NOTE_CUT)
    assert note == sr.NOTE_CUT.format(total=2, shown=1) and "cut from the OLD end" in note
    assert out["coverage"]["dropped"] == 1


def test_setups_not_judged_is_unavailable_and_judged_with_none_confirmed_is_a_healthy_answer(world):
    _hold_setups(_verdict("flat_base", LAST_DAY, confirmed=0, conf=20.0, level=None, sym="BBB"))
    # AAA: nothing was looked at
    _unavailable(_read(sr.KIND), sr.KIND, sr.NOTE_NOT_JUDGED.format(symbol="AAA", days=pv.CONFIRMED_MAX_AGE_DAYS))
    assert "not the same as no setup" in sr.NOTE_NOT_JUDGED
    # BBB: one setup judged, none confirmed
    out = _read(sr.KIND, {"symbol": "BBB"})
    _conforms(out, sr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and d["rows"] == [] and (d["count"], d["confirmed_total"], d["evaluated"]) == (0, 0, 1)
    assert out["as_of"] == day_as_of(LAST_DAY)                          # the Eastern day the judge last ran
    assert _note(out, sr.NOTE_NONE_CONFIRMED) == sr.NOTE_NONE_CONFIRMED.format(
        evaluated=1, symbol="BBB", day=LAST_DAY, at="2026-11-18T22:30:00Z")
    assert _lacks(out, sr.NOTE_AS_OF) and sr.NOTE_LEFT_OUT not in out["notes"] and out["stale"] is False


def test_setups_a_store_that_does_not_exist_is_unavailable_and_is_not_created_the_route_creates_it(world, work, monkeypatch):
    assert not os.path.exists(world.pv_path)
    _unavailable(_read(sr.KIND), sr.KIND, sr.NOTE_NOT_HELD)
    assert not os.path.exists(world.pv_path) and _quiet(world, work)    # the read created nothing
    pv.init_db()                                                        # the route's own first step does
    assert os.path.exists(world.pv_path)
    assert "pv_store.init_db()" in inspect.getsource(patterns_route.get_detections)
    # a file that is there with no verdict table is nothing stored either
    empty = world.pv_path.replace("pattern_vision.db", "empty.db")
    open(empty, "wb").close()
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", empty)
    _unavailable(_read(sr.KIND), sr.KIND, sr.NOTE_NOT_HELD)


def test_setups_an_old_newest_bar_is_stale_and_a_setup_with_no_name_keeps_its_id(world):
    _hold_setups(_verdict("zzz_invented_setup", PRIOR_DAY, conf=66.0, level=12.5))
    out = _read(sr.KIND)
    _conforms(out, sr.KIND)
    d = _plain(out["data"])
    assert out["stale"] is True and out["as_of"] == day_as_of(PRIOR_DAY)
    assert _note(out, sr.NOTE_STALE) == sr.NOTE_STALE.format(day=PRIOR_DAY, expected=LAST_DAY)
    assert d["rows"][0]["setup"] == "zzz_invented_setup" and d["rows"][0]["name"] is None


def test_setups_bad_requests_are_refused_before_any_read_and_a_failing_store_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(sr, "held_answer", lambda sym: ran.append(sym) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "A B"}, {"symbol": 7}, {"symbol": "AAA", "rows": 0}, {"symbol": "AAA", "rows": sr.MAX_ROWS + 1},
                {"symbol": "AAA", "rows": 2.5}, {"symbol": "AAA", "rows": True}):
        out = _read(sr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(sr.KIND), sr.KIND, sr.NOTE_FAILED)
    assert ran == ["AAA"]


# ── stock.eventsTimeline ──────────────────────────────────────────────────────────────────────────────────────
def test_events_reads_the_stores_with_every_event_the_services_own(world, work):
    _hold_events(world)
    svc = ev.timeline("AAA", held_only=True)
    out = _read(etr.KIND)
    _conforms(out, etr.KIND)
    assert out["status"] == "ok" and out["source"] == etr.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    assert [(r["date"], r["kind"]) for r in d["rows"]] == [
        ("2027-01-26", "earnings"), ("2026-11-03", "filing"), ("2026-10-29", "room_spike"), ("2026-10-27", "earnings"),
        ("2026-10-23", "uct_catalyst"), ("2026-07-28", "earnings")]     # newest first
    by = {(e["date"], e["kind"]): e for e in svc["events"]}
    for r in d["rows"]:                                                 # every field is the service's own
        e = by[(r["date"], r["kind"])]
        assert (r["title"], r["source"]) == (e["title"], e["source"])
        assert (r["print_date"], r["print_label"], r["print_state"], r["offset"], r["stage"]) == (
            e["print_date"], e["print_label"], e["print_state"], e["offset"], e["stage"])
    rows = {(r["date"], r["kind"]): r for r in d["rows"]}
    assert rows[("2026-10-27", "earnings")]["detail"] == "EPS 1.1 vs 1.0 estimate" and rows[("2026-10-27", "earnings")]["stage"] == "T"
    assert rows[("2026-07-28", "earnings")]["detail"] == "EPS 0.9"      # an estimate that was not published is omitted
    assert rows[("2026-11-03", "filing")]["detail"] == FILING["detail"]
    # the written thesis and the filing's link are left out
    assert rows[("2026-10-23", "uct_catalyst")]["detail"] is None and d["left_out"] == ["thesis", "url"]
    assert "url" not in _keys(d) and THESIS not in json.dumps(d) and FILING_URL not in json.dumps(d)
    assert d["prints"] == [{"date": p["date"], "label": p["label"], "state": p["state"]} for p in svc["prints"]]
    assert d["staged"] is True and d["offset_unit"] == ev.OFFSET_UNIT and d["reason"] is None
    assert d["sources"] == {n: "ok" for n in etr.SOURCE_NAMES}
    assert (d["count"], d["total"], d["cut"]) == (6, 6, False)
    # as_of is the newest event that is not in the future: the scheduled report is listed and is not the as-of
    assert out["as_of"] == day_as_of("2026-11-03") and d["as_of"] == "2026-11-03"
    assert out["notes"] == [etr.NOTE_WHAT.format(symbol="AAA"), etr.NOTE_AS_OF.format(day="2026-11-03"),
                            etr.NOTE_OFFSET.format(unit=ev.OFFSET_UNIT), etr.NOTE_LEFT_OUT]
    assert out["coverage"] == {"evaluated": 4, "answered": 4, "dropped": 0, "not_computable": 0}
    assert _quiet(world, work)


def test_events_a_long_list_is_cut_from_the_old_end_and_says_so(world):
    _hold_events(world)
    out = _read(etr.KIND, {"symbol": "$aaa", "rows": 2})
    _conforms(out, etr.KIND)
    d = _plain(out["data"])
    assert [(r["date"], r["kind"]) for r in d["rows"]] == [("2027-01-26", "earnings"), ("2026-11-03", "filing")]
    assert (d["count"], d["total"], d["cut"]) == (2, 6, True) and out["coverage"]["dropped"] == 4
    note = _note(out, etr.NOTE_CUT)
    assert note == etr.NOTE_CUT.format(total=6, shown=2) and "cut from the OLD end" in note


def test_events_the_switch_is_the_routes_off_is_unavailable_never_an_empty_timeline(world, work, monkeypatch):
    _hold_events(world)
    for off in ("", "0", "true"):                                       # the route's own rule: only "1" is on
        monkeypatch.setenv(ev.ENABLED_ENV, off)
        assert ev.is_enabled() is False
        _unavailable(_read(etr.KIND), etr.KIND, etr.NOTE_OFF)
    monkeypatch.delenv(ev.ENABLED_ENV)
    _unavailable(_read(etr.KIND), etr.KIND, etr.NOTE_OFF)
    assert world.snap.asked == [] and world.stores.asked == []          # nothing was read while it was off
    assert "not the same as no event" in etr.NOTE_OFF and _quiet(world, work)


def test_events_an_earnings_history_that_is_not_held_is_said_and_nothing_is_scheduled(world, work, monkeypatch):
    scheduled = []
    monkeypatch.setattr(ei, "_schedule_refresh", lambda sym: scheduled.append(sym))
    _hold_events(world, earnings=None)
    out = _read(etr.KIND)
    _conforms(out, etr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "partial" and scheduled == []
    assert d["sources"] == {"earnings": "not_held", "uct_catalyst": "ok", "filing": "ok", "room_spike": "ok"}
    assert d["staged"] is False and d["reason"] == ev.NOT_HELD_REASON and d["prints"] == []
    assert [r["kind"] for r in d["rows"]] == ["filing", "room_spike", "uct_catalyst"]
    assert all(r["offset"] is None and r["stage"] is None and r["print_date"] is None for r in d["rows"])
    assert _zeros(d["rows"]) == []                                      # not staged: null, never 0
    assert _note(out, etr.NOTE_SOURCES) == etr.NOTE_SOURCES.format(
        n=1, list="the earnings history (not held on this server)")
    assert _note(out, etr.NOTE_UNSTAGED) == etr.NOTE_UNSTAGED.format(reason=ev.NOT_HELD_REASON)
    assert _lacks(out, etr.NOTE_OFFSET)
    assert out["coverage"] == {"evaluated": 4, "answered": 3, "dropped": 0, "not_computable": 1}
    # the default call, same state, schedules the rebuild
    ev.timeline("AAA")
    assert scheduled == ["AAA"] and _quiet(world, work)


def test_events_a_source_that_failed_is_named_and_no_source_answering_is_unavailable(world):
    _hold_events(world)
    world.stores.by["filing"] = RuntimeError("the filing index could not be read")
    out = _read(etr.KIND)
    _conforms(out, etr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "partial" and d["sources"]["filing"] == "error" and d["total"] == 5
    assert _note(out, etr.NOTE_SOURCES) == etr.NOTE_SOURCES.format(n=1, list="the SEC filing index (the read failed)")
    # none of the four answered: nothing is stated
    world.snap.held.clear()
    for name in world.stores.by:
        world.stores.by[name] = RuntimeError("x")
    _unavailable(_read(etr.KIND), etr.KIND, etr.NOTE_NOT_HELD.format(symbol="AAA"))


def test_events_a_stock_with_no_event_is_a_healthy_answer_and_only_future_events_have_no_as_of(world):
    world.snap.held["AAA"] = {"quarters": [{"reported": False}]}        # a history with no print on file
    out = _read(etr.KIND)
    _conforms(out, etr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and d["rows"] == [] and d["total"] == 0
    assert d["sources"] == {n: "empty" for n in etr.SOURCE_NAMES}
    assert out["as_of"] is None and d["as_of"] is None
    assert etr.NOTE_NO_PAST in out["notes"] and _note(out, etr.NOTE_EMPTY) == etr.NOTE_EMPTY.format(symbol="AAA")
    assert etr.NOTE_LEFT_OUT not in out["notes"]
    # only a scheduled report: listed, and not the as-of
    world.snap.held["AAA"] = {"quarters": [{"reported": False}],
                              "summary": {"next_report_date": "2027-01-26", "next_report_label": "Q4"}}
    out = _read(etr.KIND)
    _conforms(out, etr.KIND)
    assert [r["date"] for r in out["data"]["rows"]] == ["2027-01-26"] and out["as_of"] is None
    assert etr.NOTE_NO_PAST in out["notes"] and _lacks(out, etr.NOTE_AS_OF)


def test_events_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(etr, "held_answer", lambda sym: ran.append(sym) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "A B"}, {"symbol": "AAA", "rows": 0}, {"symbol": "AAA", "rows": etr.MAX_ROWS + 1},
                {"symbol": "AAA", "rows": "3"}):
        out = _read(etr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(etr.KIND), etr.KIND, etr.NOTE_FAILED)
    monkeypatch.setattr(etr, "held_answer", lambda sym: ({"events": "not a list", "sources": {}}, "held"))
    _unavailable(_read(etr.KIND), etr.KIND, etr.NOTE_FAILED)


# ── uct20.list ────────────────────────────────────────────────────────────────────────────────────────────────
def test_uct20_reads_the_pushed_list_with_every_figure_the_wires_own(world, work):
    pushed = _hold_wire()
    out = _read(u20.KIND)
    _conforms(out, u20.KIND)
    assert out["status"] == "ok" and out["source"] == u20.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    assert d["rows"] == [{"rank": i + 1, "symbol": r["ticker"], "rs": r["rs"], "score": r["score"], "ret_1m": r["ret_1m"],
                          "ret_3m": r["ret_3m"], "earnings_date": "2026-12-10"} for i, r in enumerate(pushed[:20])]
    assert (d["count"], d["total"], d["cut"], d["status"], d["pending_removed"]) == (20, 20, False, "fresh", 0)
    # what the register's row T-12 restricts, and the rest that is left out, is not carried
    assert d["left_out"] == list(u20.LEFT_OUT) and not _keys(d) & (set(u20.LEFT_OUT) - {"left_out"})
    assert not set(_numbers(d)) & {v for v in OUT_VALUES.values() if isinstance(v, float)}
    assert "INVENTED" not in json.dumps(d)
    assert out["as_of"] == day_as_of(LAST_DAY) and d["as_of"] == LAST_DAY
    assert out["notes"] == [u20.NOTE_WHAT, u20.NOTE_AS_OF.format(day=LAST_DAY), u20.NOTE_LEFT_OUT]
    assert "NAV" in u20.NOTE_LEFT_OUT and "entry, stop and targets" in u20.NOTE_LEFT_OUT
    assert out["coverage"] == {"evaluated": 20, "answered": 20, "dropped": 0, "not_computable": 0}
    assert _quiet(world, work)


def test_uct20_a_shorter_read_is_cut_from_the_bottom_of_the_ranking_and_says_so(world):
    _hold_wire()
    out = _read(u20.KIND, {"rows": 5})
    _conforms(out, u20.KIND)
    d = _plain(out["data"])
    assert [(r["rank"], r["symbol"]) for r in d["rows"]] == list(zip(range(1, 6), NAMES[:5]))
    assert (d["count"], d["total"], d["cut"]) == (5, 20, True) and out["coverage"]["dropped"] == 15
    note = _note(out, u20.NOTE_CUT)
    assert note == u20.NOTE_CUT.format(total=20, shown=5) and "cut from the BOTTOM" in note


def test_uct20_a_figure_the_wire_did_not_carry_is_null_never_zero(world):
    rows = [_wire_row(i, s) for i, s in enumerate(NAMES[:3])]
    rows[1].update(rs=None, ret_3m="n/a", earnings_date="TBD")
    del rows[2]["score"]
    _hold_wire(rows)
    out = _read(u20.KIND)
    _conforms(out, u20.KIND)
    d = _plain(out["data"])
    assert (d["rows"][1]["rs"], d["rows"][1]["ret_3m"], d["rows"][1]["earnings_date"]) == (None, None, None)
    assert d["rows"][2]["score"] is None and _zeros(d["rows"]) == []
    assert _note(out, u20.NOTE_MISSING) == u20.NOTE_MISSING.format(n=2)
    assert out["coverage"] == {"evaluated": 3, "answered": 3, "dropped": 0, "not_computable": 2}


def test_uct20_no_list_held_is_unavailable_never_an_empty_list(world, work):
    _unavailable(_read(u20.KIND), u20.KIND, u20.NOTE_NOT_HELD)
    _hold_wire([])
    _unavailable(_read(u20.KIND), u20.KIND, u20.NOTE_NOT_HELD)
    _hold_wire([{"ticker": "not a symbol"}, "junk"])                    # rows, none of them a name
    _unavailable(_read(u20.KIND), u20.KIND, u20.NOTE_NOT_HELD)
    assert "not the same as an empty list" in u20.NOTE_NOT_HELD and _quiet(world, work)


def test_uct20_the_pending_acquisition_rule_is_applied_only_from_a_set_already_built(world, work, monkeypatch):
    _hold_wire()
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    # the rule is on and today's set is not built: the list members see cannot be stated without a build
    _unavailable(_read(u20.KIND), u20.KIND, u20.NOTE_DEALS_NOT_HELD)
    _hold_pending("AAB", day=ds._today() - dt.timedelta(days=1))        # yesterday's set is not today's
    _unavailable(_read(u20.KIND), u20.KIND, u20.NOTE_DEALS_NOT_HELD)
    # today's set is built: the name is left off, as on the page, and the ranks are the list's own places
    _hold_pending("AAB", "ZZZ")
    out = _read(u20.KIND)
    _conforms(out, u20.KIND)
    d = _plain(out["data"])
    assert [r["symbol"] for r in d["rows"][:3]] == ["AAA", "AAC", "AAD"] and [r["rank"] for r in d["rows"][:3]] == [1, 2, 3]
    assert d["pending_removed"] == 1 and d["count"] == 20 and d["rows"][-1]["symbol"] == "AAU"
    assert _note(out, u20.NOTE_PENDING) == u20.NOTE_PENDING.format(n=1)
    assert _quiet(world, work)


def test_uct20_a_missed_run_a_held_run_and_a_list_with_no_date_are_stale_and_say_why(world, monkeypatch):
    _hold_wire(date=PRIOR_DAY)                                          # the run expected on the 18th did not land
    out = _read(u20.KIND)
    _conforms(out, u20.KIND)
    assert out["stale"] is True and out["data"]["status"] == "stale" and out["as_of"] == day_as_of(PRIOR_DAY)
    assert _note(out, u20.NOTE_STALE).startswith("A trading-day wire run was missed")
    for status in ("held", "degraded"):                                 # the wire's own publish check
        _hold_wire(meta={"status": status, "held_since": PRIOR_DAY})
        out = _read(u20.KIND)
        _conforms(out, u20.KIND)
        assert out["stale"] is True and out["data"]["status"] == status and out["data"]["held_since"] == PRIOR_DAY
        why = u20.STALE_WORDS[status]
        assert _note(out, u20.NOTE_STALE) == u20.NOTE_STALE.format(why=why[0].upper() + why[1:])
    _hold_wire(date=None)
    out = _read(u20.KIND)
    _conforms(out, u20.KIND)
    assert out["as_of"] is None and out["stale"] is True and u20.NOTE_NO_DATE in out["notes"]
    assert _lacks(out, u20.NOTE_AS_OF)


def test_uct20_bad_requests_are_refused_before_any_read_and_a_failing_reader_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(u20, "held_answer", lambda: ran.append(1) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({"rows": 0}, {"rows": u20.MAX_ROWS + 1}, {"rows": 2.5}, {"rows": "5"}, {"rows": True}):
        out = _read(u20.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(u20.KIND), u20.KIND, u20.NOTE_FAILED)
    monkeypatch.setattr(u20, "held_answer", lambda: ({"stocks": "not a list"}, "held"))
    _unavailable(_read(u20.KIND), u20.KIND, u20.NOTE_FAILED)


# ── options.ivHistory ─────────────────────────────────────────────────────────────────────────────────────────
def test_iv_reads_the_mirrored_sessions_with_every_figure_the_services_own(world, work):
    days = _hold_iv(world, n=25)
    svc = world.mirror.service()
    assert svc["status"] == "ok" and svc["rank"] is not None
    out = _read(ivr.KIND)
    _conforms(out, ivr.KIND)
    assert out["status"] == "ok" and out["source"] == ivr.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    newest_first = svc["points"][::-1]
    assert d["rows"] == [{"date": p["date"], "atm_iv": p["atm_iv"], "atm_dte": p["atm_dte"],
                          "atm_expiration": p["atm_expiration"], "rule": p["rule"], "complete": p["complete"]}
                         for p in newest_first[:ivr.DEFAULT_ROWS]]
    assert d["rows"][0]["date"] == LAST_DAY == days[-1]
    # the log's first date and the count of sessions behind the rank, and the rank itself, are the service's own
    assert (d["logging_began"], d["covers_from"], d["covers_to"]) == (days[0], days[0], LAST_DAY)
    assert (d["sessions_logged"], d["sessions_with_iv"], d["missing_sessions"]) == (25, 25, 0)
    assert d["rank"] == svc["rank"] and d["rank"]["window_sessions"] == 25 and d["rank_note"] is None
    assert d["rank_min_sessions"] == ivs.RANK_MIN_SESSIONS == 20 and d["partial"] is False
    # 25 sessions held, 20 returned: cut from the old end, and said
    assert (d["count"], d["total"], d["cut"]) == (20, 25, True)
    note = _note(out, ivr.NOTE_CUT)
    assert note == ivr.NOTE_CUT.format(total=25, symbol="AAA", shown=20) and "cut from the OLD end" in note
    assert out["as_of"] == day_as_of(LAST_DAY) and d["as_of"] == LAST_DAY and d["expected_session"] == LAST_DAY
    assert out["notes"] == [ivr.NOTE_WHAT.format(symbol="AAA"),
                            ivr.NOTE_AS_OF.format(symbol="AAA", day=LAST_DAY, began=days[0], sessions=25), note]
    assert out["coverage"] == {"evaluated": 25, "answered": 20, "dropped": 5, "not_computable": 0}
    assert _quiet(world, work)


def test_iv_under_the_services_minimum_of_sessions_the_rank_is_null_with_the_services_reason(world):
    _hold_iv(world, n=5)
    svc = world.mirror.service()
    assert svc["rank"] is None and svc["rank_note"] == f"5 sessions logged, rank needs {ivs.RANK_MIN_SESSIONS}."
    out = _read(ivr.KIND, {"symbol": "aaa", "rows": 3})
    _conforms(out, ivr.KIND)
    d = _plain(out["data"])
    assert d["rank"] is None and d["rank_note"] == svc["rank_note"] and d["sessions_with_iv"] == 5
    assert _note(out, ivr.NOTE_NO_RANK) == ivr.NOTE_NO_RANK.format(why=svc["rank_note"])
    assert "never 0" in ivr.NOTE_NO_RANK and (d["count"], d["total"], d["cut"]) == (3, 5, True)
    # one more session than the minimum less one: still null; at the minimum the service ranks, and so does the read
    _hold_iv(world, n=ivs.RANK_MIN_SESSIONS)
    out = _read(ivr.KIND)
    assert out["data"]["rank"] is not None and _lacks(out, ivr.NOTE_NO_RANK)


def test_iv_a_session_with_no_figure_is_null_never_zero_and_the_services_partial_reasons_are_carried(world):
    days = _hold_iv(world, n=6)
    world.mirror.day(days[-2], [_iv_row("AAA", None), _iv_row("ZZZ", 0.2)])     # a row with no ATM IV
    world.mirror.day(days[1], [_iv_row("AAA", 0.31)], complete=False)           # a session the log marked incomplete
    svc = world.mirror.service()
    out = _read(ivr.KIND)
    _conforms(out, ivr.KIND)
    d = _plain(out["data"])
    by = {r["date"]: r for r in d["rows"]}
    assert by[days[-2]]["atm_iv"] is None and _zeros(d["rows"]) == []
    assert by[days[1]]["complete"] is False and by[days[0]]["complete"] is True
    assert _note(out, ivr.NOTE_MISSING) == ivr.NOTE_MISSING.format(n=1, symbol="AAA")
    assert d["partial"] is True and d["partial_reasons"] == svc["partial_reasons"] and len(svc["partial_reasons"]) == 2
    assert _note(out, ivr.NOTE_PARTIAL) == ivr.NOTE_PARTIAL.format(reasons=" ".join(svc["partial_reasons"]))
    assert (d["sessions_logged"], d["sessions_with_iv"]) == (6, 5)
    assert out["coverage"] == {"evaluated": 6, "answered": 5, "dropped": 0, "not_computable": 1}


def test_iv_the_switch_is_the_routes_and_no_session_on_disk_or_no_figure_for_the_stock_is_unavailable(world, work, monkeypatch):
    # no session on this server's disk
    _unavailable(_read(ivr.KIND), ivr.KIND, ivr.NOTE_NOT_HELD)
    assert "never downloads one" in ivr.NOTE_NOT_HELD
    # sessions held, none with a figure for this stock
    days = _sessions_ending(LAST_DAY, 3)
    for d in days:
        world.mirror.day(d, [_iv_row("ZZZ", 0.2)])
    _unavailable(_read(ivr.KIND), ivr.KIND, ivr.NOTE_NOT_IN_LOG.format(sessions=3, symbol="AAA"))
    assert _read(ivr.KIND, {"symbol": "ZZZ"})["status"] == "ok"
    # the route's own switch off: nothing is read
    read = []
    monkeypatch.setattr(ivs, "iv_history", lambda *a, **kw: read.append(a) or {})
    for off in ("", "0", "off"):
        monkeypatch.setenv(ivs.FLAG, off)
        assert ivs.is_enabled() is False
        _unavailable(_read(ivr.KIND, {"symbol": "ZZZ"}), ivr.KIND, ivr.NOTE_OFF)
    assert read == [] and _quiet(world, work)


def test_iv_an_old_newest_session_is_stale_and_no_newer_one_is_downloaded(world, work):
    _hold_iv(world, n=4, last=PRIOR_DAY)
    out = _read(ivr.KIND)
    _conforms(out, ivr.KIND)
    d = _plain(out["data"])
    assert out["stale"] is True and out["as_of"] == day_as_of(PRIOR_DAY) and d["expected_session"] == LAST_DAY
    assert _note(out, ivr.NOTE_STALE) == ivr.NOTE_STALE.format(symbol="AAA", day=PRIOR_DAY, expected=LAST_DAY)
    assert d["missing_sessions"] == 1 and LAST_DAY in _note(out, ivr.NOTE_PARTIAL)
    assert _quiet(world, work)


def test_iv_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(ivr, "held_answer", lambda sym: ran.append(sym) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "A B"}, {"symbol": "AAA", "rows": 0}, {"symbol": "AAA", "rows": ivr.MAX_ROWS + 1},
                {"symbol": "AAA", "rows": 2.5}):
        out = _read(ivr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(ivr.KIND), ivr.KIND, ivr.NOTE_FAILED)
    monkeypatch.setattr(ivr, "held_answer", lambda sym: ({"status": "ok", "points": "not a list"}, "held"))
    _unavailable(_read(ivr.KIND), ivr.KIND, ivr.NOTE_FAILED)


# ── dilution.watch ────────────────────────────────────────────────────────────────────────────────────────────
def test_dilution_reads_the_held_answer_with_every_row_and_count_the_services_own(world, work):
    ans = _hold_dilution()
    assert ans["status"] == "ok" and ans["rows_total"] > 3 and ans["summary"]["live_shelves"] == 1
    out = _read(dr.KIND, {"symbol": "aaa", "rows": dr.MAX_ROWS})
    _conforms(out, dr.KIND)
    assert out["status"] == "ok" and out["source"] == dr.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    assert [(r["date"], r["form"], r["kind"], r["what"]) for r in d["rows"]] == [
        (r["date"], r["form"], r["kind"], r["what"]) for r in ans["rows"]]          # newest first, each date and form
    assert d["rows"][0]["date"] >= d["rows"][-1]["date"]
    under = [r for r in ans["rows"] if r.get("under")][0]
    assert [r for r in d["rows"] if r["under"]][0]["under"] == {
        "form": under["under"]["form"], "filed": under["under"]["filed"], "shelf": under["under"]["shelf"]}
    assert (d["count"], d["total"], d["cut"]) == (ans["rows_total"], ans["rows_total"], False)
    s = ans["summary"]
    assert d["summary"] == {"live_shelves": s["live_shelves"], "pending_shelves": s["pending_shelves"],
                            **{k: {"m12": s[k]["m12"], "y3": s[k]["y3"], "latest": s[k]["latest"]} for k in dr.HORIZONS}}
    assert d["shelves"] == [{"form": x["form"], "filed": x["filed"], "effective": x["effective"],
                             "expires_estimate": x["expires_estimate"], "state": x["state"], "offerings": x["offerings"],
                             "latest_offering": x["latest_offering"]} for x in ans["shelves"][:dr.MAX_SHELVES]]
    assert d["company"] == "Acme Example Corp" and d["fund_like"] is False and d["state"] == "ok"
    assert d["window"] == {k: ans["window"][k] for k in ("years", "from", "to", "recent_months", "recent_from")}
    assert d["coverage"] == {"complete": True, "from": ans["coverage"]["from"], "pages_unread": 0}
    # the filing's link, accession and file numbers are not carried
    assert not _keys(d) & {"url", "accession", "file_number", "cik", "items"} and "sec.gov" not in json.dumps(d)
    # as_of is the newest filing in the index; when UCT read the index rides beside it
    assert ans["newest_filing"] == "2026-11-05"
    assert out["as_of"] == day_as_of("2026-11-05") and d["as_of"] == d["newest_filing"] == "2026-11-05"
    assert d["read_at"] == "2026-11-18T16:00:00Z" and d["last_good"] is False
    assert out["notes"] == [dr.NOTE_WHAT.format(symbol="AAA", years=dw.WINDOW_YEARS),
                            dr.NOTE_AS_OF.format(symbol="AAA", day="2026-11-05", at=READ_AT, to="2026-11-18")]
    assert "no filing document was read" in dr.NOTE_WHAT
    assert out["coverage"] == {"evaluated": ans["rows_total"], "answered": ans["rows_total"], "dropped": 0,
                               "not_computable": 0}
    assert _quiet(world, work)


def test_dilution_a_long_list_is_cut_from_the_old_end_and_the_counts_still_cover_the_window(world):
    ans = _hold_dilution()
    out = _read(dr.KIND, {"symbol": "AAA", "rows": 2})
    _conforms(out, dr.KIND)
    d = _plain(out["data"])
    assert [r["date"] for r in d["rows"]] == [r["date"] for r in ans["rows"][:2]]   # the two newest are kept
    assert (d["count"], d["total"], d["cut"]) == (2, ans["rows_total"], True)
    note = _note(out, dr.NOTE_CUT)
    assert note == dr.NOTE_CUT.format(total=ans["rows_total"], shown=2) and "cut from the OLD end" in note
    assert d["summary"]["offerings"]["y3"] == ans["summary"]["offerings"]["y3"] > 2
    assert out["coverage"]["dropped"] == ans["rows_total"] - 2
    assert _read(dr.KIND)["data"]["count"] == min(dr.DEFAULT_ROWS, ans["rows_total"])


def test_dilution_a_count_the_read_did_not_reach_back_for_is_null_never_zero_or_smaller(world):
    ans = _hold_dilution(_dilution_answer(covered_from="2026-06-01"))
    assert ans["coverage"]["complete"] is False and ans["summary"]["offerings"] == {
        "m12": None, "y3": None, "latest": "2026-10-02"}
    out = _read(dr.KIND)
    _conforms(out, dr.KIND)
    d = _plain(out["data"])
    for k in dr.HORIZONS:
        assert d["summary"][k]["m12"] is None and d["summary"][k]["y3"] is None, k
    assert _zeros(d["summary"]) == [".live_shelves", ".pending_shelves"] or all("shelves" in z for z in _zeros(d["summary"]))
    assert d["coverage"]["complete"] is False and d["coverage"]["from"] == "2026-06-01"
    assert _note(out, dr.NOTE_COVERAGE) == dr.NOTE_COVERAGE.format(day="2026-06-01")
    assert out["coverage"]["not_computable"] == 6


def test_dilution_the_services_own_none_is_a_healthy_answer_and_a_fund_is_marked(world):
    for reason, words in dr.NONE_WORDS.items():
        _hold_dilution({"status": "none", "sym": "AAA", "reason": reason, "http_status": 404 if reason == "no_filings" else None,
                        "source": dw.SOURCE})
        out = _read(dr.KIND)
        _conforms(out, dr.KIND)
        d = _plain(out["data"])
        assert out["status"] == "ok" and out["as_of"] is None and out["stale"] is False
        assert (d["state"], d["none_reason"], d["rows"], d["count"], d["total"]) == ("none", reason, [], 0, 0)
        assert out["notes"] == [dr.NOTE_NONE.format(symbol="AAA", why=words)]
    _hold_dilution({"status": "none", "sym": "AAA", "reason": "something else", "source": dw.SOURCE})
    _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_FAILED)
    # a fund: said, because the rows do not mean what they mean for a company
    _hold_dilution(_dilution_answer(entity="investment"))
    out = _read(dr.KIND)
    assert out["data"]["fund_like"] is True and _note(out, dr.NOTE_FUND) == dr.NOTE_FUND.format(symbol="AAA")
    # an index that names no filing day: as_of is null and says so
    _hold_dilution({**_dilution_answer(), "newest_filing": None})
    out = _read(dr.KIND)
    _conforms(out, dr.KIND)
    assert out["as_of"] is None and _note(out, dr.NOTE_NO_DATE) == dr.NOTE_NO_DATE.format(
        symbol="AAA", at=READ_AT, to="2026-11-18")


def test_dilution_nothing_held_and_a_read_that_went_badly_are_unavailable_never_no_filings(world, work):
    _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_NOT_HELD.format(symbol="AAA"))
    assert "not the same as no filings" in dr.NOTE_NOT_HELD
    with dw._lock:
        assert not dw._inflight                                          # no build was started
    for reason, words in dr.FAILED_WORDS.items():
        status = "unavailable" if reason in ("refused", "shape") else "failed"
        _hold_dilution({"status": status, "sym": "AAA", "reason": reason, "http_status": None, "source": dw.SOURCE})
        _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_SOURCE_FAILED.format(symbol="AAA", why=words))
    _hold_dilution({"status": "failed", "sym": "AAA", "reason": "an unknown reason", "source": dw.SOURCE})
    _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_SOURCE_FAILED.format(symbol="AAA", why=dr.FAILED_DEFAULT))
    _hold_dilution({"status": "computing", "sym": "AAA"})
    _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_NOT_HELD.format(symbol="AAA"))
    assert _quiet(world, work)


def test_dilution_the_last_good_answer_is_stale_and_no_refresh_is_started(world, work):
    good = _hold_dilution()
    with dw._lock:
        dw._done["AAA"] = (time.time() - 1, good)                       # its freshness has run out
    assert dw.held_watch("AAA")[1] == "last_good"
    out = _read(dr.KIND)
    _conforms(out, dr.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["last_good"] is True
    assert _note(out, dr.NOTE_STALE) == dr.NOTE_STALE.format(symbol="AAA")
    assert "refreshing" not in _keys(out["data"])
    with dw._lock:
        assert not dw._inflight
    assert _quiet(world, work)


def test_dilution_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(dr, "held_answer", lambda sym: ran.append(sym) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "A B"}, {"symbol": "AAA", "rows": 0}, {"symbol": "AAA", "rows": dr.MAX_ROWS + 1},
                {"symbol": "AAA", "rows": 2.5}):
        out = _read(dr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_FAILED)
    monkeypatch.setattr(dr, "held_answer", lambda sym: ({"status": "ok", "window": {"to": "2026-11-18"}, "rows": "x"}, "fresh"))
    _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_FAILED)
    monkeypatch.setattr(dr, "held_answer", lambda sym: ({"status": "bad_symbol", "sym": None}, "refused"))
    _unavailable(_read(dr.KIND), dr.KIND, dr.NOTE_FAILED)


# ── THE BUDGET RULE ───────────────────────────────────────────────────────────────────────────────────────────
def _forbid(mp, reached):
    for owner, names in FORBIDDEN.items():
        for name in names:
            assert callable(getattr(owner, name)), (owner.__name__, name)           # a rename fails here, by name
            mp.setattr(owner, name, lambda *a, _n=f"{owner.__name__}.{name}", **kw:
                       reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))


def _hold_everything(world):
    _hold_regime()
    _five_judged()
    _hold_events(world)
    _hold_wire()
    _hold_iv(world, n=25)
    _hold_dilution()


def test_no_read_of_this_wave_reaches_a_compute_a_build_a_download_or_a_thread_held_or_not(world, work, monkeypatch):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: the regime
    classifier and its breadth and vendor reads, the verdict store's writers, the earnings rebuild, the leadership
    route's reader with the pending-acquisition build and the bar warm, the options log's remote store, and the
    dilution watch's route reader, its build and its two SEC readers."""
    reached = []
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")                      # the rule that can build is ON
    expected_cold = {rr.KIND: "unavailable", sr.KIND: "unavailable", etr.KIND: "partial", u20.KIND: "unavailable",
                     ivr.KIND: "unavailable", dr.KIND: "unavailable"}
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        _forbid(mp, reached)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == expected_cold[kind], (kind, params, out["notes"])
        assert reached == [] and _quiet(world, work)
        assert not os.path.exists(world.pv_path)
    _hold_everything(world)
    _hold_pending("ZZZ")
    with dw._lock:
        dw._done["AAA"] = (time.time() - 1, dw._done["AAA"][1])         # the dilution answer is due a rebuild
    with ds._LOCK:
        ds._SETS["v"]["at"] = time.time() - 10 * 3600                   # the pending set is due a refresh
    with pytest.MonkeyPatch.context() as mp:                            # everything held, every rebuild due
        _forbid(mp, reached)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "ok", (kind, params, out["notes"])
        assert reached == [] and _quiet(world, work)
        with dw._lock:
            assert not dw._inflight
        with ds._LOCK:
            assert ds._SETS["busy"] is False


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, monkeypatch):
    """The contrast: where the adapter answers from what is held, the reader the member path uses starts the work."""
    hits = []
    # the regime: a cold cache is recomputed (breadth, then the vendor)
    monkeypatch.setattr(engine, "get_breadth", lambda *a, **kw: hits.append("breadth") or {})
    monkeypatch.setattr(massive, "get_ticker_snapshot", lambda *a, **kw: hits.append("vendor") or {})
    assert _read(rr.KIND)["status"] == "unavailable" and hits == []
    vrc.get_current_regime()
    assert hits == ["breadth", "vendor"]
    # the timeline: an earnings history that is not held is scheduled for a rebuild
    monkeypatch.setattr(ei, "_schedule_refresh", lambda sym: hits.append(f"rebuild {sym}"))
    assert _read(etr.KIND)["status"] == "partial" and hits[2:] == []
    ev.timeline("AAA")
    assert hits[2:] == ["rebuild AAA"]
    # the UCT 20: with the pending-acquisition rule on, the route's reader builds the day's set
    _hold_wire()
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(ds, "_build_sets", lambda: hits.append("deal sets") or {
        "pending": frozenset(), "completed": frozenset(), "day": ds._today(), "at": time.time(), "ttl": 3600.0})
    assert _read(u20.KIND)["notes"] == [u20.NOTE_DEALS_NOT_HELD] and hits[3:] == []
    engine.get_leadership()
    assert hits[3:] == ["deal sets"]
    # the IV history: the production store lists remote storage before it reads
    monkeypatch.setattr(ivs.R2Store, "_sync", lambda self: hits.append("remote listing"))
    _hold_iv(world, n=3)
    assert _read(ivr.KIND)["status"] == "ok" and hits[4:] == []
    assert ivs.iv_history("AAA")["status"] == "ok"
    ivs._default_store.drain(10)        # speed pass 2: the route's listing runs on the store's one background refresh
    assert hits[4:] == ["remote listing"]
    # the dilution watch: nothing held starts a background build
    def bg(sym, done):
        hits.append(f"build {sym}")
        with dw._lock:
            dw._inflight.pop(sym, None)
        done.set()
    monkeypatch.setattr(dw, "_bg", bg)
    assert _read(dr.KIND)["status"] == "unavailable" and hits[5:] == []
    assert dw.get_watch("AAA", wait_s=5)["status"] == "computing"
    assert hits[5:] == ["build AAA"]


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    t11 = row("T-11")
    assert t11.startswith("| T-11 | Derived analytics — intraday breadth (~40 metrics) + lenses, RS rank/line")
    assert "pattern engine (50 detectors)" in t11 and "| **R** |" in t11
    t12 = row("T-12")
    assert t12.startswith("| T-12 | Derived analytics — the composites: UCT20 portfolio **NAV**")
    assert "the Exposure Rating (0–150, an indicative value)" in t12
    assert "published entry/stop/target on named tickers" in t12 and "| **R** (either tier) |" in t12
    assert "do not add new composite publications until answered" in t12
    assert row("T-14").startswith("| T-14 | AI processing — Massive numbers into Claude") and "| **R** |" in row("T-14")
    assert row("T-28").startswith("| T-28 | Member display — options chain + Greeks + IV") and "| **R** |" in row("T-28")
    t44 = row("T-44")
    assert t44.startswith("| T-44 | AI processing — FMP numbers (fundamentals, analyst, earnings)")
    assert "| **U** |" in t44 and "No AI clause" in t44
    assert row("T-83").startswith("| T-83 | All seven uses — SEC EDGAR filings") and "| **A** |" in row("T-83")
    t96 = row("T-96")
    assert t96.startswith("| T-96 | Member display — **share-issuance filings** of one company")
    assert "**no filing document is downloaded**" in t96
    assert "Nothing else reads it (no AI lane, no export, no external publication)" in t96
    # no row names what four of these kinds serve, so none can be read as clearing it
    table = "\n".join(ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)).lower()
    for words in ("regime", "events timeline", "iv history", "iv rank", "options log", "verdict", "chart judge",
                  "leadership"):
        assert words not in table, words
    cites = {rr: ("T-11", "T-12", "T-14"), sr: ("T-11", "T-14"), etr: ("T-44",), u20: ("T-11", "T-12", "T-14"),
             ivr: ("T-28", "T-14"), dr: ("T-96",)}
    for m, rows in cites.items():                                      # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.KIND
        assert all(r in doc for r in rows), m.KIND
        assert set(re.findall(r"T-\d+", doc)) == set(rows), m.KIND
        assert "for a model provider" in doc and "Shown to the member only; the capability is local-only." in doc, m.KIND
        assert "No row clears" in doc or "no other row does" in doc, m.KIND
    # what T-12 restricts is quoted where it is left out
    for m in (rr, u20):
        assert "do not add new composite publications until answered" in " ".join(m.__doc__.split()), m.KIND
    assert set(u20.LEFT_OUT) >= {"entry", "stop", "target_1", "target_2", "portfolio", "nav"}
    assert rr.LEFT_OUT == ("uct_exposure_rating", "vix")


# ── the contract (MD-1 v1.13 §4.16) ───────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_16_and_every_note_the_adapters_emit():
    """MD-1 §4.16 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8")
    head = ("### 4.16 Terminal data wave 7: `market.regime`, `stock.setups`, `stock.eventsTimeline`, `uct20.list`, "
            "`options.ivHistory`, `dilution.watch` (v1.13, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section, m.KIND                    # its table row
    for words in (list(rr.SIGNAL_WORDS.values()) + list(etr.SOURCE_WORDS.values()) + list(u20.STALE_WORDS.values())
                  + list(dr.NONE_WORDS.values()) + list(dr.FAILED_WORDS.values()) + [dr.FAILED_DEFAULT]):
        assert words in section, words                                 # the words a note is filled with
    # default OFF, the isolation switch and the never-builds rule are stated where the kinds are documented (the
    # section's prose is wrapped, so a phrase is looked for with the line breaks folded)
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a compute, a build, a download or a vendor request.**",
              "`voice_regime_held.held_regime`", "`earnings_reaction_panel.held_earnings`", "`timeline(sym, held_only=True)`",
              "`dilution_watch.held_watch`", "`engine._leadership_as_pushed`", "`LocalStore(get_store().root)`",
              "`get_confirmed`", "row T-11", "row T-12", "row T-14", "row T-28", "row T-44", "row T-96",
              "do not add new composite publications until answered",
              "Nothing else reads it (no AI lane, no export, no external publication)", "No AI clause",
              "for a model provider", "never the time of the read", "EVENTS_TIMELINE_ENABLED", "IV_HISTORY_ENABLED",
              "the builder's default"):
        assert s in prose, s
    # wave 6's section still ends where this one begins
    assert doc.index("### 4.15 Terminal data wave 6") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 13
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.13 addition (2026-11-20, terminal-data, data wave 7):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.16 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.12 addition (2026-11-20, terminal-data, data wave 6):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.9", "v1.10", "v1.11", "v1.12", "v1.13"))
    # nothing in the section or the entry records or implies an owner decision about these kinds
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will"):
            assert claim not in text, claim
