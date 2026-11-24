"""Speed pass on the slowest Terminal data routes (2026-11-23).

Live, five routes waited 2-5 seconds and then said `computing` anyway, and FED spent most of its time
matching the Fed roster against the newest 3,000 wire headlines with up to three `re` calls per surname
per headline. Each fix is proved here on INVENTED inputs, with the slow dependency stood in for by one
that blocks: the request answers within a bound, the figures are the same as before, and nothing is
held for another symbol or past its validity. The seasonality board (SEASB) has its own tests in
`tests/test_seasonality_board.py`.

No test here reads a real store, the network, a vendor or an agency. Routes are mounted on a bare app
(the router alone), so this file never imports `api.main`.
"""
from __future__ import annotations

import random
import re
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import fed_watch as fw
from api.services import fed_watch_parse as P

NY = ZoneInfo("America/New_York")
PAID = {"id": "spd-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
FAST_S = 0.5            # "at once": far under any wait these routes used to make (2-3 s) and the stub's block


def _client(router):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app, raise_server_exceptions=False)


def _timed(fn):
    t0 = time.monotonic()
    out = fn()
    return out, time.monotonic() - t0


# ── FED: the Fed headline filter ─────────────────────────────────────────────────────────────

def _reference_is_fed_headline(text, surnames=()):
    """`fed_watch_parse.is_fed_headline` as it stood before the speed pass, word for word: the
    reference the new matcher must agree with on every headline."""
    s = text if isinstance(text, str) else ""
    if not s.strip():
        return False
    if P._FED_WORD.search(s) or P._FOMC.search(s) or P._FED_RESERVE.search(s):
        return True
    for name in surnames:
        n = str(name or "").strip()
        if not n or not n.isalpha():
            continue
        word = re.escape(n)
        if re.search(rf"\b{P._ROLE}\s+{word}\b", s, re.I):
            return True
        if n.lower() in P.AMBIGUOUS_SURNAMES:
            continue
        if re.match(rf"\s*{word}\s*:", s, re.I) or re.search(rf"\b{word}\s+{P._SAYS}\b", s, re.I):
            return True
    return False


#: invented rosters: lower case as the calendar's loader gives them, a name that starts another
#: (Bow / Bowman), an ambiguous one, one that is not all letters, an empty and a None entry
ROSTERS = (
    ["barkin", "barr", "bowman", "cook", "daly", "jefferson", "logan", "powell", "waller", "williams"],
    ["Bow", "Bowman", "Quillfeather", "O'Neil", "", None, "Zé"],
    [],
    ["  waller  ", "WALLER"],
)
ROLE_WORDS = ("Governor", "Gov.", "Chair", "Chairman", "Vice Chair", "Fed Chair", "President", "Fed Vice Chairwoman",
              "director", "")
VERBS = ("says", "said", "sees", "warns", "speaks", "testified", "notes", "thinks", "")
FILL = ("rates", "inflation", "balance", "sheet", "outlook", "chips", "oil", "earnings", "Fedex", "federal", "reserve",
        "barrel", "airport", "Sonoma", "phone", ":", "-", "FOMC", "Fed", "fed", "Federal Reserve")


def _corpus(names, n=4000, seed=11):
    """Invented headlines built to sit on every edge of the three roster tests."""
    rng = random.Random(seed)
    pool = [str(x).strip() for x in names if x] + ["Bowmanite", "Cooke", "Powellson", "Ow"]
    out = []
    for _ in range(n):
        name = rng.choice(pool) if pool else "Nobody"
        name = rng.choice((name, name.upper(), name.lower(), name.title()))
        words = [rng.choice(FILL) for _ in range(rng.randint(2, 9))]
        shape = rng.randrange(6)
        if shape == 0:
            head = f"{rng.choice(ROLE_WORDS)} {name} " + " ".join(words)
        elif shape == 1:
            head = f"{' ' * rng.randint(0, 2)}{name}{' ' * rng.randint(0, 2)}: " + " ".join(words)
        elif shape == 2:
            head = f"{name} {rng.choice(VERBS)} " + " ".join(words)
        elif shape == 3:
            head = " ".join(words) + f" as {name} {rng.choice(VERBS)}"
        elif shape == 4:
            head = " ".join(words[:2]) + f" {rng.choice(ROLE_WORDS)}{rng.choice(('', ' ', '  '))}{name}" + " ".join(words[2:])
        else:
            head = " ".join(words)
        out.append(head)
    return out + ["", "   ", None, 7]


@pytest.mark.parametrize("roster", ROSTERS)
def test_the_fed_headline_filter_answers_exactly_as_before_on_every_invented_headline(roster):
    heads = _corpus(roster)
    new = [P.is_fed_headline(h, roster) for h in heads]
    old = [_reference_is_fed_headline(h, roster) for h in heads]
    assert new == old
    assert any(new) and not all(new)                                  # the corpus reaches both answers


def test_the_fed_headline_filter_agrees_on_the_hand_written_edges():
    roster = ["Bow", "Bowman", "Cook", "Waller"]
    for text, want in (("Governor Bowman sees invented risks", True),   # the longer name after a shorter one
                       ("Governor Bowmanite sees invented risks", False),
                       ("  BOWMAN : invented remarks", True),           # a quote, spaces and all
                       ("Cook says the invented phone sold well", False),  # ambiguous: a verb is not enough
                       ("COOK: invented remarks", False),                # ambiguous: nor is a quote
                       ("Governor Cook sees invented risks", True),
                       ("Invented markets: Waller says rates hold", True),
                       ("Invented markets as Waller", False)):
        assert P.is_fed_headline(text, roster) is want, text
        assert _reference_is_fed_headline(text, roster) is want, text
    assert P.is_fed_headline("Governor Waller says", []) is False         # no roster: no roster test at all
    assert P.is_fed_headline("Governor Waller says", ["", None, "Jean-Paul"]) is False


def test_the_fed_headline_filter_is_far_cheaper_than_before_over_a_wire_pass():
    roster = ROSTERS[0]
    heads = [h for h in _corpus(roster, n=3000, seed=5) if isinstance(h, str)]
    P.is_fed_headline("warm", roster)                                 # the roster's patterns are built once
    _, new_s = _timed(lambda: [P.is_fed_headline(h, roster) for h in heads])
    _, old_s = _timed(lambda: [_reference_is_fed_headline(h, roster) for h in heads])
    assert new_s * 3 < old_s, (new_s, old_s)


def test_the_roster_patterns_are_compiled_once_per_roster():
    P._roster_patterns.cache_clear()
    for _ in range(50):
        P.is_fed_headline("Invented headline about chips", ["Waller", "Powell"])
    info = P._roster_patterns.cache_info()
    assert info.misses == 1 and info.hits == 49


# ── FED: nothing held answers at once ────────────────────────────────────────────────────────

@pytest.fixture
def fed(tmp_path, monkeypatch):
    fw.reset_for_tests()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    monkeypatch.setattr(fw, "now_et", lambda: datetime(2031, 3, 20, 11, 0, tzinfo=NY))
    monkeypatch.setattr(fw, "_pause", lambda s: None)
    monkeypatch.setattr(fw, "headlines_block", lambda: {"state": "off", "items": [], "source": fw.SOURCE_TX})
    monkeypatch.setattr(fw, "_calendar_payloads", lambda today: [])
    gate = threading.Event()

    def slow(url, accept, max_bytes):                                 # the Board's website, not answering yet
        gate.wait(10)
        return 503, "text/plain", b""

    monkeypatch.setattr(fw, "_http_get", slow)
    yield gate
    gate.set()
    end = time.time() + 10
    while time.time() < end and any(t.name == "fed-watch-build" and t.is_alive() for t in threading.enumerate()):
        time.sleep(0.02)
    fw.reset_for_tests()


def test_fed_with_nothing_held_answers_at_once_and_its_blocks_say_computing(fed):
    from api.routers import fed_watch as route
    resp, took = _timed(lambda: _client(route.router).get("/api/research/fed-watch"))
    assert resp.status_code == 200 and took < FAST_S + 0.5, took
    body = resp.json()
    assert body["statement"]["state"] == "computing" and body["speeches"]["state"] == "computing"
    assert fw.WAIT_S == 0


# ── SETH one stock: nothing held answers `computing` at once ─────────────────────────────────

@pytest.fixture
def seth(monkeypatch, tmp_path):
    from api.services import setup_history as S
    from tests import test_setup_history as T
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    S.reset_for_tests()
    monkeypatch.setattr(S, "_universe", lambda: list(T.SYMS))
    monkeypatch.setattr(S, "_market", lambda wait_s: T._market())
    monkeypatch.setattr(S, "evening_key", lambda now: T.KEY)
    monkeypatch.setattr(S, "now_et", lambda: T.SATURDAY)
    monkeypatch.setattr(S, "HISTORY_YEARS", 2)
    gate = threading.Event()
    read = T._reader()

    def slow(sym, max_bars=None):                                     # a cold price read, invented
        gate.wait(10)
        return read(sym, max_bars)

    monkeypatch.setattr(S, "_read_bars", slow)
    yield S, T, gate
    gate.set()
    S._STOCK.drain(10)
    S._STUDY.drain(10)
    S.reset_for_tests()


def test_seth_one_stock_not_held_answers_computing_at_once(seth):
    S, T, gate = seth
    out, took = _timed(lambda: S.get_stock("QZSA"))
    assert out["status"] == "computing" and out["symbol"] == "QZSA" and took < FAST_S, took


def test_seth_one_stock_through_the_route_answers_at_once(seth):
    from api.routers import setup_history as route
    resp, took = _timed(lambda: _client(route.router).get("/api/research/setup-history/QZSA"))
    assert resp.status_code == 200 and resp.json()["status"] == "computing" and took < FAST_S + 0.5, took


def test_seth_one_stock_once_built_is_the_same_answer_as_a_build_on_the_request(seth):
    S, T, gate = seth
    gate.set()
    S.get_stock("QZSA")
    S._STOCK.drain(10)
    held = S.get_stock("QZSA")
    direct = S._build_stock("QZSA", T.KEY)                            # what the work itself gives, on this thread
    assert held["status"] == "ok"
    strip = lambda a: {k: v for k, v in a.items() if k not in ("built_at", "check", "universe")}  # noqa: E731
    assert strip(held) == strip(direct)


def test_seth_one_stock_is_held_per_symbol_never_one_symbols_answer_for_another(seth):
    S, T, gate = seth
    gate.set()
    S.get_stock("QZSA")
    S._STOCK.drain(10)
    assert S.get_stock("QZSA")["symbol"] == "QZSA"
    other = S.get_stock("QZSB")
    assert other["status"] == "computing" and other["symbol"] == "QZSB"   # never QZSA's signals
    S._STOCK.drain(10)
    assert S.get_stock("QZSB")["symbol"] == "QZSB"


# ── RATES: nothing held answers `computing` at once ──────────────────────────────────────────

def test_rates_with_nothing_held_answers_computing_at_once(monkeypatch, tmp_path):
    from api.routers import treasury_yields as route
    from api.services import treasury_yields as ty
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    ty.reset_for_tests()
    gate = threading.Event()

    def slow(*a, **k):                                                # the Treasury's website, not answering yet
        gate.wait(10)
        raise TimeoutError("invented")

    monkeypatch.setattr(ty, "_http_get", slow)
    monkeypatch.setattr(ty, "_pause", lambda s: None)
    try:
        resp, took = _timed(lambda: _client(route.router).get("/api/research/treasury-yields"))
        assert resp.status_code == 200 and resp.json() == {"status": "computing"} and took < FAST_S + 0.5, took
        assert ty.WAIT_S == 0
    finally:
        gate.set()
        end = time.time() + 10
        while time.time() < end:
            with ty._lock:
                if ty._state["inflight"] is None:
                    break
            time.sleep(0.02)
        ty.reset_for_tests()


# ── OIC: nothing held answers `computing` at once ────────────────────────────────────────────

def test_oic_with_no_pair_held_answers_computing_at_once(monkeypatch, tmp_path):
    from api.routers import options_screener as route
    from api.services.options_analytics import oi_change as oic
    from api.services.research import options_screener as osc
    gate = threading.Event()

    class SlowStore(osc.LocalStore):
        def screen_sessions(self):                                   # listing R2 and mirroring a 50 MB file
            gate.wait(10)
            return []

    monkeypatch.setattr(osc, "_store_override", SlowStore(str(tmp_path)))
    monkeypatch.setenv("OPTIONS_SCREENER_ENABLED", "1")
    oic.reset()
    try:
        resp, took = _timed(lambda: _client(route.router).get("/api/options-screener/oi-change/AAA"))
        assert resp.status_code == 200 and resp.json()["status"] == "computing" and took < FAST_S + 0.5, took
        assert oic.builds_started == 1
    finally:
        gate.set()
        end = time.time() + 10
        while time.time() < end and oic._inflight is not None:
            time.sleep(0.02)
        oic.reset()


# ── PUBR: a company not held yet answers at once, each section `computing` ───────────────────

@pytest.fixture
def pubr(monkeypatch):
    from api.services import public_records as R
    from tests import test_public_records as T
    R.reset_for_tests()
    fake = T.Agencies()
    monkeypatch.setattr(R, "_http", fake)
    monkeypatch.setattr(R, "_sleep", lambda s: None)
    monkeypatch.setattr(R, "_today", lambda: T.TODAY)
    monkeypatch.setattr(R, "_site_name", lambda sym: "Kestrel Dynamics Corporation" if sym == T.SYM else None)
    monkeypatch.setattr(R, "_resolve_cik", lambda sym: "0009990001" if sym == T.SYM else None)
    monkeypatch.setattr(R, "_sec_submissions", lambda cik: {"name": "KESTREL DYNAMICS CORP", "formerNames": []})
    fake.gate.clear()                                                 # the agencies do not answer yet
    yield R, T, fake
    fake.gate.set()
    R.drain_for_tests(10)
    R.drain_for_tests(10)
    R.reset_for_tests()


def test_pubr_a_company_not_held_answers_at_once(pubr):
    R, T, fake = pubr
    out, took = _timed(lambda: R.get_public_records(T.SYM))
    assert took < FAST_S, took
    assert out["status"] == "ok" and all(out[k]["status"] == "computing" for k in R.SECTIONS)


def test_pubr_once_held_is_the_same_answer_the_wait_used_to_give(pubr):
    R, T, fake = pubr
    fake.gate.set()
    waited = R.get_public_records(T.SYM, wait_s=10)                   # the old request path: wait for the builds
    R.drain_for_tests(10)
    R.drain_for_tests(10)
    at_once = R.get_public_records(T.SYM)
    assert at_once == R.get_public_records(T.SYM, wait_s=10)
    assert all(at_once[k]["status"] != "computing" for k in R.SECTIONS)
    assert {k: waited[k] for k in R.SECTIONS if waited[k]["status"] != "computing"} == \
        {k: at_once[k] for k in R.SECTIONS if waited[k]["status"] != "computing"}
