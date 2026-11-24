"""MD-1 kinds of terminal data wave 13: `insider.market`, `market.history`, `econ.latest`, `market.liquidity`, `market.oil`,
`market.analogs` — the Agent half of INS (with INS CLUSTER), MKTH, ECON, LIQ, OIL and ANLG (MD-1 §4.22).

No network and no real store: every held answer is put where its service keeps it BY the service (the INS feed's cache
entry through `insider.get_market_insider_buys` over an invented vendor page; the cluster answer through
`insider_clusters_sec.assemble` over invented purchase records; MKTH through `market_history.build` over invented closes;
the economics serving cache through `serving.latest` over invented series bodies; ANLG through `find_analogues` over
invented breadth rows). Every number, name and date is invented. Pinned per kind: an ok read (envelope conformance, the
data's own date as `as_of`, or null with each part's own date), a missing number null and never 0, the cut stated and from
which end, `unavailable` kept apart from a healthy answer with each state in its own note, the routes' switch respected, a
malformed request refused before any read, a failing reader answered `unavailable`, and THE BUDGET RULE: no read builds,
searches, starts a thread, pages a vendor, reads the SEC, reads the econ store's files or writes the shared cache, with the
member path's own reader shown to do exactly that in the same state (so the rail can fail). For all six: registered dark,
model-isolated, dormant until armed one by one. The licensing rows the isolation cites are read from the register. And
the contract: MD-1 §4.22 quotes every note these adapters emit.
"""
from __future__ import annotations

import datetime as dt
import inspect
import re
import threading
import types
from pathlib import Path

import pytest

from api.services import breadth_analogues as BA, breadth_analogues_held, econ_held, insider as INS
from api.services import insider_clusters_sec as ICS, insider_feed_held, market_history as MH
from api.services import market_history_calc as MHC
from api.services.cache import cache
from api.services.econ import publish as EP
from api.services.econ import serving
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import analogues_read as anr
from api.services.uct_agent.marketdata import econ_read as ecr
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import insider_market_read as imr
from api.services.uct_agent.marketdata import market_history_read as mhr

REPO = Path(__file__).resolve().parents[1]
MODULES = (imr, mhr, anr)
KINDS = ("insider.market", "market.history", "econ.latest", "market.liquidity", "market.oil", "market.analogs")
#: this wave's isolation defaults (ADR-005): all six. They are the builder's defaults; a kind leaving this set is an owner
#: decision that has not been made.
ISOLATED = set(KINDS)
ACTIONS = {"stock.insiderBuying", "stock.marketHistory", "stock.economyBoard", "stock.liquidityBoard", "stock.oilReport",
           "stock.daysLikeToday"}
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
RECENT = (dt.date.today() - dt.timedelta(days=1)).isoformat()        # inside the INS feed's own 7-day window


# ── invented worlds, each held by its own service ─────────────────────────────────────────────────────────────────
def _fmp_row(sym, name, shares, price, day=RECENT, kind="P-Purchase", ad="A"):
    return {"symbol": sym, "transactionType": kind, "acquisitionOrDisposition": ad, "securitiesTransacted": shares,
            "price": price, "reportingName": name, "typeOfOwner": "director", "transactionDate": day, "filingDate": day}


FMP_PAGE = [_fmp_row("QZAA", "Made-up Person One", 1000, 12.5), _fmp_row("QZBB", "Made-up Person Two", 400, None),
            _fmp_row("QZCC", "Made-up Person Three", 5000, 3.0), _fmp_row("QZDD", "Made-up Seller", 900, 9.0, ad="D")]


def _hold_feed(mp, rows=None):
    from api.services import fmp_client
    pages = []
    mp.setattr(fmp_client, "search_insider_purchases",
               lambda page, limit=100, timeout=None: pages.append(page) or types.SimpleNamespace(value=list(FMP_PAGE if rows is None else rows), degraded=None))
    INS.get_market_insider_buys()
    assert insider_feed_held.held_market_buys()[1] == "held"
    return pages


def _person(cik, name, **roles):
    return {"cik": cik, "name": name, "roles": ICS.owner_roles({"is_officer": roles.get("officer", False),
            "is_director": roles.get("director", False), "is_ten_percent": False, "officer_title": roles.get("title")}),
            "title": roles.get("title")}


def _rec(acc, owner, shares, price, day, issuer=("0009900001", "Made-up Robotics Inc", "QZRB")):
    txns = [{"date": day, "shares": float(shares), "price": price}]
    return {"accession": acc, "filed": day, "issuer_cik": issuer[0], "ticker": issuer[2], "company": issuer[1], "txns": txns,
            "first_date": day, "date": day, "owners": [owner], **ICS._totals(txns), "url": f"https://www.sec.gov/invented/{acc}"}


def _hold_clusters(complete=True):
    owners = [_person("0001900001", "Made-up Chief", officer=True, title="Chief Executive Officer"),
              _person("0001900002", "Made-up Finance", officer=True, title="Chief Financial Officer"),
              _person("0001900003", "Made-up Director", director=True)]
    buys = {f"a{i}": _rec(f"a{i}", o, 1000 * (i + 1), (12.0 + i) if i != 1 else None, f"2031-03-1{i}") for i, o in enumerate(owners)}
    days = {"2031-03-12": {"state": "complete" if complete else "partial", "listed": 4, "read": 4 if complete else 2,
                           "unreadable": 0, "given_up": 0, "purchases": 3}}
    store = {"v": ICS.DISK_VERSION, "days": days, "buys": buys}
    held = ICS.assemble(store, today=dt.date(2031, 3, 14), read_close=lambda t: {"QZRB": (14.0, "2031-03-13")}.get(t))
    with ICS._lock:
        ICS._state.update({"held": held, "store": store, "loaded": True})
    assert ICS.held_answer()[1] == "held"
    return held


def _sessions(n, start=dt.date(2031, 1, 6)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


DAYS = _sessions(200)


def _index_closes():
    closes = []
    for i, d in enumerate(DAYS):
        if i <= 10:
            c = 90 + i
        elif i <= 30:
            c = 100 - (i - 10) * 0.75                                     # to 85 at session 30: a 15% correction
        elif i <= 60:
            c = 85 + (i - 30) * 0.55                                      # back above 100 by session 58
        elif i <= 150:
            c = 101.5 + (i - 60) * 0.1                                    # a slow rise to 110.5
        elif i <= 170:
            c = 110.5 - (i - 150) * 1.5                                   # to 80.5 at session 170: a bear market
        else:
            c = 80.5 + (i - 170) * 0.2                                    # still below its peak at the end
        closes.append((d, round(c, 2)))
    return closes


STOCKS = [f"QZ{i:03d}" for i in range(120)]


def _stock(sym):
    i = int(sym[2:])
    return {"status": "ok", "first": DAYS[0], "closes": [(d, 10.0 + i * 0.01 + k * (0.001 * (i % 7))) for k, d in enumerate(DAYS)],
            "suspect_jumps": []}


def _hold_history(mp, ndx=False):
    closes = _index_closes()
    mp.setattr(MH, "index_closes", lambda sym, now: ({"state": "ok", "closes": closes, "first": closes[0][0], "last": closes[-1][0]}
                                                     if sym == "SPX" or ndx else {"state": "not_held"}))
    mp.setattr(MH, "_universe", lambda: list(STOCKS))
    mp.setattr(MH, "_stock_closes", _stock)
    mp.setattr(MH, "_sectors", lambda: {s: ("Made-up Sector A" if int(s[2:]) % 2 else "Made-up Sector B") for s in STOCKS})
    MH.build(now=dt.datetime(2031, 10, 20, 21, 0, tzinfo=MH.ET))
    assert MH.held_answer()[1] == "held"


def _breadth_rows(n=80):
    rows = []
    for i, d in enumerate(_sessions(n)):
        w = (i % 9) / 9.0
        rows.append({"date": d, "breadth_score": 40 + 20 * w, "uct_exposure": 50 + 30 * w, "pct_above_50sma": 30 + 40 * w,
                     "pct_above_200sma": 35 + 30 * w, "pct_above_20ema": 25 + 50 * w, "ratio_5day": 0.8 + w, "ratio_10day": 0.9 + w,
                     "vix": 25 - 10 * w, "mcclellan_osc": -50 + 100 * w, "cnn_fear_greed": 20 + 60 * w, "aaii_spread": -20 + 40 * w,
                     "cboe_putcall": 0.9 - 0.3 * w, "new_52w_highs": int(20 + 200 * w), "new_52w_lows": int(150 - 120 * w),
                     "hi_ratio": w, "stage2_count": int(300 + 500 * w), "sp500_close": 5000.0 + 7 * i})
    return list(reversed(rows))                                           # newest first, as the Monitor gives them


def _hold_analogues(mp, top_n=10):
    mp.setattr(BA, "_get_all_snapshots", lambda lookback_days=500: _breadth_rows())
    got = BA.find_analogues(top_n=top_n)
    assert got["analogues"] and breadth_analogues_held.held_analogues()[2] == "held"
    return got


def _wed(n, end=dt.date(2031, 5, 21)):
    return [(end - dt.timedelta(days=7 * k)).isoformat() for k in range(n)][::-1]


def _points(days, start_v, step, t0=1938000000):
    return [[t0 + 86400 * i, round(start_v + step * i, 3), d, d, 0] for i, d in enumerate(days)]


def _bodies():
    daily = [(dt.date(2029, 1, 1) + dt.timedelta(days=k)).isoformat() for k in range(0, 900, 1)]
    weekly = _wed(140)
    cur = {"state": "current", "latest_period": "2031-05-21", "expected_period": "2031-05-21",
           "next_release": {"date": "2031-05-28", "time": "16:30", "tz": "America/New_York", "precision": "exact"}}
    out = {}
    for sym in (*ecr.ECON_SYMBOLS, *ecr.LIQ_SYMBOLS, *ecr.OIL_SYMBOLS):
        days = daily if sym in ("USRRP", "USTGA", "USSOFR", "UST10Y", "USEFFR", "USDOLLARIDX") else weekly
        out[sym] = {"symbol": sym, "points": _points(days, 100.0, 0.5), "currentness": cur}
    out["USJOLTSO"] = None                                                # the store answers with nothing: no_data
    return out


def _hold_econ(mp, skip=()):
    bodies = _bodies()
    mp.setenv("ECON_ENABLED", "1")
    mp.setattr(serving, "_read_key", lambda key: None)                    # the data bucket is never reached from a test
    mp.setattr(serving, "_from_artifacts", lambda sym, asof, start, end: bodies.get(sym))
    serving.clear_cache()
    for syms in (ecr.ECON_SYMBOLS, ecr.LIQ_SYMBOLS, ecr.OIL_SYMBOLS):
        serving.latest([s for s in syms if s not in skip])
    return bodies


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _forget():
    cache.invalidate(insider_feed_held.cache_key())
    ICS.reset_for_tests()
    MH.reset_for_tests()
    BA.invalidate_cache()
    serving.clear_cache()


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ECON_ENABLED", "1")
    monkeypatch.setattr(serving, "_read_key", lambda key: None)
    _forget()
    gw._reset_for_test(None)
    yield tmp_path
    with MH._lock:
        done = MH._state.get("inflight")
    if done is not None:
        done.wait(10)
    _forget()
    gw._reset_for_test(None)


@pytest.fixture
def work(monkeypatch):
    """Counts the work a turn must never cause: every thread started (by name)."""
    seen = {"threads": []}
    real_start = threading.Thread.start

    def start(self):
        seen["threads"].append(self.name)
        return real_start(self)
    monkeypatch.setattr(threading.Thread, "start", start)
    return seen


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, dict(params or {}), user_id=1, turn_id=f"w13-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind and out["provider_calls"] == 0          # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        assert out["as_of"] != out["fetched_at"]
        if out["as_of"] is None:
            assert "`as_of` is null" in " ".join(out["notes"])
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway
    else:
        assert out["data"] is None and out["notes"]


def _plain(v):
    """The data without the gateway's `isolated` stamp (ADR-005 L2 marks every object)."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


def _made_from(template):
    return re.compile(".+?".join(re.escape(p) for p in re.split(r"\{[\w!r]+\}", template)), re.S)


def _note(out, template):
    hits = [n for n in out["notes"] if _made_from(template).fullmatch(n)]
    assert len(hits) == 1, (template, out["notes"])
    return hits[0]


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────────
def test_the_six_kinds_are_registered_once_by_their_modules_and_all_six_are_isolated():
    r = gw.registry()
    fns = {"insider.market": imr.read_market, "market.history": mhr.read_history, "econ.latest": ecr.read_econ,
           "market.liquidity": ecr.read_liquidity, "market.oil": ecr.read_oil, "market.analogs": anr.read_analogs}
    for kind, fn in fns.items():
        k = r.get(kind)
        assert k is not None and k.owner == "terminal-data" and k.fn is fn, kind
        assert k.max_symbols == 0 and k.model_isolated is True and k.freshness == "periodic", kind
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, kind
        assert "a request" in k.description and "already holds" in k.description, kind
    assert tuple(fns) == KINDS and (imr.KIND, mhr.KIND, anr.KIND) == ("insider.market", "market.history", "market.analogs")
    assert ecr.KINDS == ("econ.latest", "market.liquidity", "market.oil")
    assert [imr.SOURCE, mhr.SOURCE, ecr.SOURCE, anr.SOURCE] == ["uct-insider-market", "uct-market-history", "uct-econ",
                                                                "uct-breadth-analogues"]
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)
    assert not ACTIONS & set(agent_turn.DATA_READ_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    monkeypatch.setattr(imr, "held_answer", lambda: ran.append(imr) or ((None, "not_held"), (None, "not_held")))
    monkeypatch.setattr(mhr, "held_answer", lambda: ran.append(mhr) or (None, "not_held"))
    monkeypatch.setattr(ecr, "held_latest", lambda s: ran.append(ecr) or {"series": []})
    monkeypatch.setattr(anr, "held_answer", lambda: ran.append(anr) or (None, None, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,earnings,analyst.actions,stock.stats,company.deals")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _hold_econ(monkeypatch)
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and out["data"] is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "econ.latest")                 # arming ONE arms one
    assert _read("econ.latest")["status"] in ("ok", "partial")
    for kind in (k for k in KINDS if k != "econ.latest"):
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                     # never for a model's research
        assert _read("econ.latest", purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(anr.KIND)["status"] == "unavailable"                        # armed: read, and nothing is held
    monkeypatch.delenv(gw.ISOLATED_ENV)                                      # the master switch turns all six off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_bounds_fields_and_words_are_the_services_own():
    assert imr.MAX_ROWS == INS._MARKET_CAP == ICS.MAX_CLUSTERS and imr.WINDOW_DAYS == INS._MARKET_WINDOW_DAYS
    for f in imr.PURCHASE_FIELDS:
        assert f == "symbol" or f'"{f}"' in inspect.getsource(INS._normalize_row), f
    for f in imr.CLUSTER_FIELDS:
        assert f'"{f}"' in inspect.getsource(ICS), f
    assert mhr.INDEXES == tuple(s for s, _n in MH.INDEXES) and mhr.LEADER_ROWS <= MHC.LEADERS_TOP
    for f in ("depth_pct", "sessions_down", "recovered", "sessions_to_recover", "ongoing", "below_peak_now_pct", "rally"):
        assert f'"{f}"' in inspect.getsource(MHC.describe_episodes), f
    assert anr.WINDOWS == ("fwd_5d", "fwd_10d", "fwd_20d", "fwd_60d")
    for w in anr.WINDOWS:
        assert f'"{w}"' in inspect.getsource(BA._compute_forward_returns), w
    for m in anr.MEASURES:
        assert f'"{m}"' in inspect.getsource(BA._build_metrics_summary), m
    from api.routers import breadth_monitor as BMR
    route = inspect.signature(BMR.get_breadth_analogues).parameters["top_n"].default
    assert (anr.DEFAULT_ROWS, anr.MAX_ROWS) == (route.default, 10)
    for syms in (ecr.ECON_SYMBOLS, ecr.LIQ_SYMBOLS, ecr.OIL_SYMBOLS):          # every series the panels ask for is served
        assert len(syms) == len(set(syms)) <= serving.LATEST_MAX_SYMBOLS
        for s in syms:
            assert EP.resolve(s) is not None, s
    assert set(ecr.LIQ_HISTORY) <= set(ecr.LIQ_SYMBOLS) and set(ecr.OIL_HISTORY) == set(ecr.OIL_SYMBOLS)
    for fn in (imr.held_answer, mhr.held_answer, ecr.held_latest, ecr.held_history, anr.held_answer,
               insider_feed_held.held_market_buys, ICS.held_answer, MH.held_answer, econ_held.held_body, econ_held.held_status,
               econ_held.held_latest, econ_held.held_history, breadth_analogues_held.held_analogues):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__


# ── insider.market (INS, INS CLUSTER) ─────────────────────────────────────────────────────────────────────────────
def test_insider_reads_both_held_parts_no_price_is_no_amount_never_0_and_each_cut_from_its_own_end(world, work, monkeypatch):
    _unavailable(_read(imr.KIND), imr.KIND, imr.NOTE_NOT_HELD)
    _hold_feed(monkeypatch)
    _hold_clusters()
    work["threads"].clear()
    out = _read(imr.KIND, {"rows": 2})
    _conforms(out, imr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["as_of"] is None
    buys = d["purchases"]
    assert buys["state"] == "held" and buys["total"] == 3 and buys["unpriced"] == 1 and buys["newest_filing"] == RECENT
    assert [b["symbol"] for b in buys["rows"]] == ["QZCC", "QZAA"]                 # the route's order: largest amount first
    assert buys["rows"][1] == {"symbol": "QZAA", "name": "Made-up Person One", "title": "director", "shares": 1000, "price": 12.5,
                               "amount": 12500.0, "date": RECENT, "filing_date": RECENT}
    full = _plain(_read(imr.KIND)["data"])["purchases"]["rows"]
    unpriced = next(b for b in full if b["symbol"] == "QZBB")
    assert unpriced["price"] is None and unpriced["amount"] is None                # the vendor's 0 is no price, never $0
    cl = d["clusters"]
    assert cl["state"] == "held" and cl["as_of"] == "2031-03-12" and cl["total"] == 1 and cl["coverage"]["complete"] is True
    (c,) = cl["rows"]
    assert (c["ticker"], c["insiders"], c["first_buy"], c["last_buy"]) == ("QZRB", 3, "2031-03-10", "2031-03-12")
    assert c["value"] == 12000.0 + 42000.0 and c["value_complete"] is False and c["unpriced_buys"] == 1
    assert "people" not in c and cl["left_out"] == ["people"]
    assert imr.NOTE_CUT.format(part="purchases", total=3, shown=2, end="SMALLEST") in out["notes"]
    _note(out, imr.NOTE_RULE)
    assert work["threads"] == []


def test_insider_one_part_not_held_an_empty_list_an_incomplete_read_and_a_failure_are_each_said(world, monkeypatch):
    _hold_feed(monkeypatch, rows=[])
    out = _read(imr.KIND)
    assert out["status"] == "ok" and _plain(out["data"])["clusters"] == {"state": "not_held"}
    assert imr.NOTE_BUYS_EMPTY in out["notes"]
    assert imr.NOTE_PART_NOT_HELD.format(part="The insider clusters", code="INS CLUSTER") in out["notes"]
    cache.invalidate(insider_feed_held.cache_key())
    _hold_clusters(complete=False)
    out = _read(imr.KIND)
    assert _plain(out["data"])["purchases"] == {"state": "not_held"}
    _note(out, imr.NOTE_COVERAGE)
    assert _read(imr.KIND, {"rows": 0})["status"] == "refused"                    # refused before any read
    monkeypatch.setattr(imr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("an invented failure")))
    _unavailable(_read(imr.KIND), imr.KIND, imr.NOTE_FAILED)


# ── market.history (MKTH) ─────────────────────────────────────────────────────────────────────────────────────────
def test_history_reads_the_held_declines_newest_first_with_rallies_leaders_and_the_survivorship_note(world, work, monkeypatch):
    _unavailable(_read(mhr.KIND), mhr.KIND, mhr.NOTE_NOT_HELD)
    _hold_history(monkeypatch)
    work["threads"].clear()
    out = _read(mhr.KIND, {"index": None, "rows": 5})
    _conforms(out, mhr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["as_of"] == f"{DAYS[-1]}T20:00:00Z"
    bear, corr = d["episodes"]
    assert bear["kind"] == "bear" and bear["ongoing"] is True and bear["recovered"] is None and bear["sessions_to_recover"] is None
    assert bear["below_peak_now_pct"] is not None and bear["leaders"]["state"] == "not_yet"
    assert corr["kind"] == "correction" and corr["depth_pct"] == -15.0 and corr["trough"]["date"] == DAYS[30]
    assert corr["leaders"]["state"] == "ok" and len(corr["leaders"]["top"]) == mhr.LEADER_ROWS
    assert corr["leaders"]["top_total"] == MHC.LEADERS_TOP and len(corr["leaders"]["sectors"]) == 2
    assert any(r["return_pct"] is None for r in bear["rally"])                     # a month the store has not reached: null
    assert d["summary"]["corrections"] == 1 and d["summary"]["bear_markets"] == 1 and d["survivorship"] == MHC.SURVIVORSHIP_NOTE
    assert mhr.NOTE_SURVIVORSHIP.format(note=MHC.SURVIVORSHIP_NOTE) in out["notes"]
    _note(out, mhr.NOTE_LEADERS_CUT)
    assert work["threads"] == []
    assert _read(mhr.KIND, {"index": "qqq", "rows": 1})["status"] == "unavailable"   # NDX not held: the service's words
    assert _read(mhr.KIND, {"index": "dow", "rows": 1})["status"] == "refused"


def test_history_cut_stale_and_a_failure_are_each_said(world, monkeypatch):
    _hold_history(monkeypatch)
    out = _read(mhr.KIND, {"index": "SPX", "rows": 1})
    assert mhr.NOTE_CUT.format(total=2, shown=1) in out["notes"]
    monkeypatch.setattr(mhr, "evening_now", lambda: "2031-10-30")
    out = _read(mhr.KIND, {"index": "SPX", "rows": 1})
    assert out["stale"] is True and out["data"]["stale_for"] == ["earlier_evening"]
    _note(out, mhr.NOTE_STALE)
    monkeypatch.setattr(mhr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("an invented failure")))
    _unavailable(_read(mhr.KIND), mhr.KIND, mhr.NOTE_FAILED)


# ── econ.latest / market.liquidity / market.oil (ECON, LIQ, OIL) ──────────────────────────────────────────────────
def test_econ_reads_the_held_rows_in_the_routes_own_shape_and_says_what_is_not_held(world, work, monkeypatch):
    _unavailable(_read("econ.latest"), "econ.latest", ecr.NOTE_NOT_HELD.format(what="The economy board", panel="ECON"))
    _hold_econ(monkeypatch, skip=("USPPIYOY",))
    work["threads"].clear()
    out = _read("econ.latest")
    _conforms(out, "econ.latest")
    d = _plain(out["data"])
    assert out["status"] == "partial" and d["not_held"] == ["USPPIYOY"]
    rows = {r["symbol"]: r for r in d["series"]}
    assert [r["symbol"] for r in d["series"]] == list(ecr.ECON_SYMBOLS)
    assert rows["USJOLTSO"]["state"] == "no_data" and rows["USPPIYOY"]["state"] == "not_held"
    assert len(rows["USCPIYOY"]["points"]) == serving.LATEST_POINTS and rows["USCPIYOY"]["meta"]["symbol"] == "USCPIYOY"
    route = {r["symbol"]: r for r in serving.latest(list(ecr.ECON_SYMBOLS))[1]["series"]}
    for s, r in rows.items():                                                       # the route's own row, where held
        if r["state"] != "not_held":
            assert {k: v for k, v in r.items() if k != "read_at"} == route[s], s
    newest = max(r["points"][-1][0] for r in d["series"] if r["state"] == "ok")
    assert out["as_of"] == env.utc_iso(dt.datetime.fromtimestamp(newest, tz=dt.timezone.utc))
    _note(out, ecr.NOTE_SOME_NOT_HELD)
    assert work["threads"] == []


def test_liquidity_and_oil_carry_the_panels_history_windows_from_the_held_series(world, monkeypatch):
    _hold_econ(monkeypatch)
    liq = _plain(_read("market.liquidity")["data"])
    assert set(liq["histories"]) == set(ecr.LIQ_HISTORY) and liq["history_days"] == ecr.LIQ_HISTORY
    fed = liq["histories"]["USFEDBAL"]["points"]
    assert fed[-1][3] == "2031-05-21" and fed[0][3] >= (dt.date(2031, 5, 21) - dt.timedelta(days=790)).isoformat()
    rrp = liq["histories"]["USTGA"]["points"]
    assert len(rrp) == 71 and [r["symbol"] for r in liq["latest"]["series"]] == list(ecr.LIQ_SYMBOLS)
    oil = _plain(_read("market.oil")["data"])
    assert set(oil["histories"]) == set(ecr.OIL_SYMBOLS) and oil["histories"]["USCRUDEINV"]["points"]
    serving.clear_cache()
    serving.latest(["USFEDBAL"])                                                    # only one series held
    out = _read("market.liquidity")
    assert out["status"] == "partial" and _plain(out["data"])["histories"]["USRRP"] is None


def test_econ_switched_off_and_a_failure_and_the_bucket_is_never_read(world, monkeypatch):
    bucket = []
    monkeypatch.setattr(serving, "_read_key", lambda key: bucket.append(key))
    for kind, what, panel in (("econ.latest", "The economy board", "ECON"), ("market.liquidity", "The liquidity figures", "LIQ"),
                              ("market.oil", "The weekly oil figures", "OIL")):
        _unavailable(_read(kind), kind, ecr.NOTE_NOT_HELD.format(what=what, panel=panel))
    assert bucket == []
    monkeypatch.setenv("ECON_ENABLED", "0")
    for kind in ecr.KINDS:
        _unavailable(_read(kind), kind, ecr.NOTE_SWITCHED_OFF)
    monkeypatch.setenv("ECON_ENABLED", "1")
    monkeypatch.setattr(ecr, "held_latest", lambda s: (_ for _ in ()).throw(RuntimeError("an invented failure")))
    _unavailable(_read("market.oil"), "market.oil", ecr.NOTE_FAILED.format(what="the weekly oil figures"))


# ── market.analogs (ANLG) ─────────────────────────────────────────────────────────────────────────────────────────
def test_analogs_read_the_held_matches_the_closest_first_with_not_yet_never_0(world, work, monkeypatch):
    _unavailable(_read(anr.KIND), anr.KIND, anr.NOTE_NOT_HELD)
    got = _hold_analogues(monkeypatch)
    work["threads"].clear()
    out = _read(anr.KIND, {"rows": 3})
    _conforms(out, anr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["stale"] is False
    assert d["reference_date"] == got["reference_date"] and out["as_of"].startswith(got["reference_date"])
    assert [m["date"] for m in d["matches"]] == [a["date"] for a in got["analogues"][:3]]
    for m, a in zip(d["matches"], got["analogues"]):
        assert m["similarity"] == a["similarity"]
        for w in anr.WINDOWS:
            assert m["forward_returns"][w] == a["forward_returns"].get(w)
            assert (w in m["not_yet"]) == (w not in a["forward_returns"])           # absent is "not yet", never 0
    assert out["notes"][0] == anr.NOTE_RECORD
    assert anr.NOTE_CUT.format(held=len(got["analogues"]), shown=3) in out["notes"]
    assert work["threads"] == []


def test_analogs_expired_is_stale_with_its_build_time_and_a_failure_is_said(world, monkeypatch):
    _hold_analogues(monkeypatch, top_n=5)
    BA._cache[5]["ts"] -= BA._CACHE_TTL + 60
    out = _read(anr.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["stale_for"] == ["expired"]
    _note(out, anr.NOTE_EXPIRED)
    assert _read(anr.KIND, {"rows": 11})["status"] == "refused"
    monkeypatch.setattr(anr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("an invented failure")))
    _unavailable(_read(anr.KIND), anr.KIND, anr.NOTE_FAILED)


# ── the budget rule: no read of this wave causes work ─────────────────────────────────────────────────────────────
def _forbidden():
    from api.services import breadth_monitor, fmp_client
    return {
        INS: ("get_market_insider_buys", "get_recent_insider_buys", "get_insider_activity"),
        fmp_client: ("search_insider_purchases",),
        ICS: ("run_nightly", "catch_up", "build", "_run", "_sec_get"),
        MH: ("get_market_history", "build", "build_indexes", "build_leaders", "_start_job", "_build_bg", "index_closes",
             "_stock_closes", "_universe"),
        serving: ("latest", "series", "status", "catalog", "_read_key", "_from_artifacts", "_from_db", "_artifact", "_open_db"),
        BA: ("find_analogues", "_get_all_snapshots"),
        breadth_monitor: ("get_history", "get_history_deep"),
    }


def _forbid(mp, reached):
    for owner, names in _forbidden().items():
        for name in names:
            label = f"{owner.__name__}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    mp.setattr(cache, "set", lambda *a, **kw: reached.append("cache.set") or (_ for _ in ()).throw(AssertionError("cache.set")))


def test_no_read_of_this_wave_builds_searches_starts_a_thread_or_makes_a_request_held_or_not(world, work, monkeypatch):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: the INS feed's
    composers and vendor page, the cluster store's night run and SEC transport, MKTH's build and readers, the econ serving
    cache's loaders and the data bucket, the analogue search and the breadth history, and the shared cache writer."""
    reached = []
    with pytest.MonkeyPatch.context() as mp:                                      # nothing held anywhere
        _forbid(mp, reached)
        for kind in KINDS:
            out = _read(kind)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, out["notes"])
        assert reached == [] and work["threads"] == []
    _hold_feed(monkeypatch)
    _hold_clusters()
    _hold_history(monkeypatch)
    _hold_econ(monkeypatch)
    _hold_analogues(monkeypatch)
    work["threads"].clear()
    with pytest.MonkeyPatch.context() as mp:                                      # everything held
        _forbid(mp, reached)
        for kind in KINDS:
            out = _read(kind)
            _conforms(out, kind)
            assert out["status"] in ("ok", "partial"), (kind, out["notes"])
        assert reached == [] and work["threads"] == []


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, monkeypatch):
    """The contrast: where the adapter answers from what is held, the reader the member path uses does the work. (The
    clusters route reads only what is held itself, `insider_clusters_sec.get_clusters`, so it has no contrast.)"""
    assert _read(imr.KIND)["status"] == "unavailable"
    pages = _hold_feed(monkeypatch)                                               # the INS route pages the vendor
    assert pages == [0]
    started = []
    real_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: started.append(self.name) or real_start(self))
    monkeypatch.setattr(MH, "index_closes", lambda sym, now: {"state": "not_held"})
    assert _read(mhr.KIND)["status"] == "unavailable" and started == []
    MH.get_market_history(wait_s=5)                                               # the MKTH route starts the build
    assert "market-history-build" in started
    bucket = []
    monkeypatch.setattr(serving, "_read_key", lambda key: bucket.append(key))
    assert _read("econ.latest")["status"] == "unavailable" and bucket == []
    serving.latest(["USCPIYOY"])                                                  # the econ route reads the bucket
    assert bucket
    snaps = []
    monkeypatch.setattr(BA, "_get_all_snapshots", lambda lookback_days=500: snaps.append(lookback_days) or _breadth_rows())
    BA.invalidate_cache()
    assert _read(anr.KIND)["status"] == "unavailable" and snaps == []
    BA.find_analogues(top_n=5)                                                    # the ANLG route searches the history
    assert snaps == [500]


# ── the held readers give the routes' own answers ─────────────────────────────────────────────────────────────────
def test_each_held_reader_gives_the_routes_own_answer_once_held_and_nothing_before(world, monkeypatch):
    assert insider_feed_held.held_market_buys() == (None, "not_held")
    _hold_feed(monkeypatch)
    assert insider_feed_held.held_market_buys()[0] == INS.get_market_insider_buys()
    assert breadth_analogues_held.held_analogues() == (None, None, "not_held")
    got = _hold_analogues(monkeypatch, top_n=10)
    held, built, how = breadth_analogues_held.held_analogues()
    assert how == "held" and isinstance(built, float) and {k: v for k, v in held.items() if k != "top_n"} == got
    assert held["top_n"] == 10 and BA.find_analogues(top_n=5)["analogues"] == got["analogues"][:5]   # the same search, cut
    assert econ_held.held_body("USCPIYOY") == (None, "not_held", None)
    assert econ_held.held_body("NOT A SERIES")[1] == "not_found"
    _hold_econ(monkeypatch)
    body, how, at = econ_held.held_body("USCPIYOY")
    assert how == "held" and body["symbol"] == "USCPIYOY" and isinstance(at, float)
    assert econ_held.held_body("USJOLTSO")[1] == "no_data"
    route = serving.latest(list(ecr.OIL_SYMBOLS))[1]
    held = econ_held.held_latest(ecr.OIL_SYMBOLS)
    assert [{k: v for k, v in r.items() if k != "read_at"} for r in held["series"]] == route["series"]
    assert held["attributions"] == route["attributions"] and held["columns"] == route["columns"]


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    assert row("T-04").startswith("| T-04 | Member display — D/W/M history") and "| **R** |" in row("T-04")
    assert row("T-09").startswith("| T-09 | Storage — `bars.db`") and "| **R** |" in row("T-09")
    assert row("T-11").startswith("| T-11 | Derived analytics — intraday breadth") and "| **R** |" in row("T-11")
    assert row("T-14").startswith("| T-14 | AI processing — Massive numbers into Claude") and "| **R** |" in row("T-14")
    assert row("T-39").startswith("| T-39 | Member display — ETF holdings, index constituents; institutional ownership, insider trading")
    assert "| **R** |" in row("T-39")
    assert row("T-44").startswith("| T-44 | AI processing — FMP numbers (fundamentals, analyst, earnings)") and "No AI clause" in row("T-44")
    assert row("T-59").startswith("| T-59 | Economic indicators / commodities via AV") and "FRED" in row("T-59")
    assert row("T-60").startswith("| T-60 |") and "**RED**" in row("T-60") and "large language models" in row("T-60")
    assert row("T-71").startswith("| T-71 | Member display — intraday + daily bars **fallback**") and "| **X** |" in row("T-71")
    assert row("T-72").startswith("| T-72 | Member display — index / futures / crypto snapshots") and "| **X** |" in row("T-72")
    assert row("T-75").startswith("| T-75 | Derived analytics — the **authoritative EOD breadth row**") and "| **X** |" in row("T-75")
    assert row("T-83").startswith("| T-83 | All seven uses — SEC EDGAR filings") and "| **A** |" in row("T-83")
    assert row("T-99").startswith("| T-99 | Member display / storage — **insider cluster buys**")
    assert "Nothing else reads it yet (no AI lane, no export, no external publication)" in row("T-99")
    assert row("N-14").startswith("| N-14 | **Economic events — calendar + macro series**") and "**R / R-if-armed**" in row("N-14")
    assert row("N-25").startswith("| N-25 | **Retained derived history for years**") and "breadth analogues" in row("N-25")
    assert ("Licensed economic data comes from the primary agencies (BLS, BEA, Census, Fed Board, NY Fed, Treasury, EIA, DOL, "
            "FHFA)") in register
    rows = [ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)]
    for words in ("aaii", "naaim", "fear & greed", "/api/econ", "bureau of labor", "energy information"):
        assert not [ln for ln in rows if words in ln.lower()], words                   # no row names these
    cites = {imr: ("T-39", "T-44", "T-83", "T-99"), mhr: ("T-71", "T-72", "T-04", "T-09", "T-11", "T-14"),
             ecr: ("N-14", "T-59", "T-60"), anr: ("T-75", "T-11", "N-25", "T-14")}
    for m, cited in cites.items():                                                     # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.__name__
        assert set(re.findall(r"[TN]-\d+", doc)) == set(cited), m.__name__
        assert "for a model provider" in doc and "Shown to the member only; the capabilit" in doc, m.__name__


# ── the contract (MD-1 v1.19 §4.22) ───────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_22_and_every_note_the_adapters_emit():
    """MD-1 §4.22 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8").replace("\r\n", "\n")
    head = ("### 4.22 Terminal data wave 13: `insider.market`, `market.history`, `econ.latest`, `market.liquidity`, "
            "`market.oil`, `market.analogs` (v1.19, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in (*MODULES, ecr):
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.__name__
        for name, text in notes.items():
            assert text in section, f"{m.__name__} {name}"
    for kind in KINDS:
        assert f"| `{kind}` |" in section, kind
    for src in (imr.SOURCE, mhr.SOURCE, ecr.SOURCE, anr.SOURCE):
        assert f"`{src}`" in section, src
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or a request.**", "`insider_feed_held.held_market_buys`",
              "`insider_clusters_sec.held_answer`", "`market_history.held_answer`", "`econ_held.held_latest`",
              "`econ_held.held_history`", "`breadth_analogues_held.held_analogues`", "ECON_ENABLED", "row T-39", "row T-44",
              "row T-83", "row T-99", "row T-04", "row T-09", "row T-11", "row T-14", "row T-71", "row T-72", "row T-75",
              "row N-14", "row N-25", "rows T-59 and T-60", "for a model provider", "never the time of the read",
              "the builder's default", "`marketMacro`", "55th", "SENT", "IDAY", "NEWS", "TIDE", "`/api/analogs`",
              "not a forecast"):
        assert s in prose, s
    assert doc.index("### 4.21 Terminal data wave 12") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 19
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.19 addition (2026-11-24, terminal-data, data wave 13):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.22 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.18 addition (2026-11-24, terminal-data, data wave 12):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.17", "v1.18", "v1.19"))
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will",
                      "owner wants", "owner ruled"):
            assert claim not in text, claim
