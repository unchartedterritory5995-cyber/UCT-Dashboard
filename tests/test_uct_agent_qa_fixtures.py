"""UCT Agent program, agent-qa: fake-provider DataEnvelopes for every MD-1 v1 kind and every SC-1 kind.

This file is BOTH the fixture source and its rail. Consumers (agent-md, agent-sc, agent-rs, QA's own suites)
code against these envelopes instead of an unmerged producer branch (MD-1 §8).

  Server tests:
      from tests.test_uct_agent_qa_fixtures import load_fixture, cases_for, fake_registry, KINDS, CASES
      env = load_fixture("quote", "market-closed")
      gw._reset_for_test(fake_registry())                 # every kind registered, each answering its fixture
      gw._reset_for_test(fake_registry({"quotes": "partial"}))

  Browser tests:
      import { loadFixture, KINDS, CASES } from '../__fixtures__/program'

  Regenerate the JSON (it is DERIVED from this file; a rail fails if the two disagree):
      C:\\UCT\\agent\\.venv\\Scripts\\python.exe -m tests.test_uct_agent_qa_fixtures --write

THE CASES (not every case applies to every kind; `cases_for(kind)` says which):
  live           a live-declared kind, in session, within its freshness budget
  delayed        a live-declared kind on a known feed delay (`delay_s` set)
  periodic       a periodic kind, recomputed on its schedule, within budget
  historical     a completed past period (bars.daily's own class)
  stale          older than the kind's freshness budget: `stale: true`, with a note
  market-closed  read outside the session; a live kind answers `historical`, never `live` (MD-1 §3)
  unavailable    the source could not answer; no data, a note says why
  refused        the gateway would not read (here: the turn's read budget); no data
  partial        some symbols/rows missing, and `notes` (or `coverage`) say which
  no-source-time `as_of: null` with the note MD-1 requires (news.company with an empty window)

⚠ PER-KIND `data` SHAPES ARE PROVISIONAL. MD-1 §4 does not yet document each kind's `data` fields; the shapes
here are the smallest plausible ones and will be re-cut to agent-md's documented fields when they land. The
SC-1 `data` shapes (screen.run / screen.count / screen.saved) follow SC-1 §2 exactly. Everything else, the
envelope itself, follows MD-1 §3 exactly and passes `envelope.validate_envelope`.

Fixed clock (deterministic): the session read is Fri 2026-10-30 15:59 ET (EDT, UTC-4); the closed read is
Sat 2026-10-31. No fixture contains a secret, a URL, or a raw provider payload.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Callable, Iterator, Optional, Union

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

REPO = Path(__file__).resolve().parents[1]
FIXTURE_DIR = REPO / "app" / "src" / "agent" / "__fixtures__" / "program"
ENVELOPE_DIR = FIXTURE_DIR / "envelopes"
FIXTURE_VERSION = 1

CASES = ("live", "delayed", "periodic", "historical", "stale", "market-closed", "unavailable", "refused", "partial",
         "no-source-time")

# ── the fixed clock ──────────────────────────────────────────────────────────────────────────────
FETCH_SESSION = "2026-10-30T19:59:45Z"     # Fri 15:59:45 ET
FETCH_CLOSED = "2026-10-31T14:00:00Z"      # Sat 10:00 ET
AS_OF_LIVE = "2026-10-30T19:59:40Z"
AS_OF_DELAYED = "2026-10-30T19:44:40Z"     # 15 minutes behind
DELAY_S = 900
AS_OF_PERIODIC = "2026-10-30T19:45:00Z"    # the last scheduled recompute
AS_OF_LAST_CLOSE = "2026-10-30T20:00:00Z"  # Fri close
AS_OF_PRIOR_CLOSE = "2026-10-29T20:00:00Z" # Thu close: the last COMPLETED session while Fri is open
AS_OF_STALE = "2026-10-28T20:00:00Z"       # well past every budget

#: kind -> (declared freshness, category, owner, source, provider calls on a cache miss)
KINDS: dict[str, dict] = {
    "quote":           {"freshness": "live",       "category": "market", "owner": "agent-md", "source": "massive",        "calls": 1},
    "quotes":          {"freshness": "live",       "category": "market", "owner": "agent-md", "source": "massive",        "calls": 1},
    "bars.daily":      {"freshness": "historical", "category": "market", "owner": "agent-md", "source": "massive",        "calls": 1},
    "bars.intraday":   {"freshness": "live",       "category": "market", "owner": "agent-md", "source": "massive",        "calls": 1},
    "fundamentals":    {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "fmp",            "calls": 1},
    "earnings":        {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "fmp",            "calls": 1},
    "news.company":    {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-news",       "calls": 0},
    "breadth.current": {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-breadth-v2", "calls": 0},
    "nhnl":            {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-nhnl",       "calls": 0},
    "themes":          {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-themes",     "calls": 0},
    "volume.surge":    {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-volume",     "calls": 0},
    "ratings":         {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-ratings",    "calls": 0},
    "screen.run":      {"freshness": "periodic",   "category": "scan",   "owner": "agent-sc", "source": "uct-screener",   "calls": 0},
    "screen.count":    {"freshness": "periodic",   "category": "scan",   "owner": "agent-sc", "source": "uct-screener",   "calls": 0},
    "screen.saved":    {"freshness": "periodic",   "category": "scan",   "owner": "agent-sc", "source": "uct-screener",   "calls": 0},
}

#: kinds that read many symbols or rows, and so can be honestly `partial`
_BULK = ("quotes", "news.company", "ratings", "screen.run", "screen.count")

_SPEC = {"filters": [{"key": "rs_rank", "op": ">=", "value": 90}, {"key": "adr_pct", "op": ">=", "value": 4}],
         "sort": "rs_rank", "limit": 50}


def _params(kind: str) -> dict:
    if kind in ("quotes", "ratings"):
        return {"symbols": ["NVDA", "AMD", "AVGO"]}
    if kind.startswith("screen.") and kind != "screen.saved":
        return {"spec": copy.deepcopy(_SPEC)}
    if kind == "screen.saved":
        return {}
    if kind in ("breadth.current", "nhnl", "themes", "volume.surge"):
        return {}
    return {"symbol": "NVDA"}


def _coverage(evaluated: int, answered: int, dropped: int = 0, not_computable: int = 0) -> dict:
    assert evaluated == answered + dropped + not_computable, "a fixture's coverage must close"
    return {"evaluated": evaluated, "answered": answered, "dropped": dropped, "not_computable": not_computable}


def _data(kind: str, case: str) -> Optional[dict]:
    """The kind's `data` for a readable case. Provisional for MD-1 kinds; SC-1 §2 for scan kinds."""
    partial = case == "partial"
    if kind == "quote":
        return {"symbol": "NVDA", "price": 207.04, "change": 2.61, "change_pct": 1.28, "volume": 162_480_115}
    if kind == "quotes":
        rows = [{"symbol": "NVDA", "price": 207.04, "change_pct": 1.28},
                {"symbol": "AMD", "price": 256.12, "change_pct": -0.84},
                {"symbol": "AVGO", "price": 361.50, "change_pct": 0.42}]
        return {"quotes": rows[:2] if partial else rows, "missing": ["AVGO"] if partial else []}
    if kind == "bars.daily":
        last = "2026-10-30" if case == "market-closed" else "2026-10-29"
        days = ["2026-10-27", "2026-10-28", "2026-10-29"] if last == "2026-10-29" else ["2026-10-28", "2026-10-29", "2026-10-30"]
        return {"symbol": "NVDA", "tf": "D", "bars": [
            {"t": d, "o": 200.0 + i, "h": 204.0 + i, "l": 198.5 + i, "c": 202.5 + i, "v": 150_000_000 + i * 1_000_000}
            for i, d in enumerate(days)]}
    if kind == "bars.intraday":
        end = {"delayed": "2026-10-30T19:40:00Z", "market-closed": "2026-10-30T19:55:00Z"}.get(case, "2026-10-30T19:55:00Z")
        return {"symbol": "NVDA", "tf": "5", "bars": [{"t": end, "o": 206.6, "h": 207.2, "l": 206.4, "c": 207.0, "v": 1_840_000}]}
    if kind == "fundamentals":
        return {"symbol": "NVDA", "market_cap": 5_040_000_000_000, "pe_forward": 38.2, "revenue_ttm": 165_200_000_000, "eps_ttm": 3.51}
    if kind == "earnings":
        return {"symbol": "NVDA", "next": {"date": "2026-11-18", "session": "AMC"},
                "last": {"period": "2026 Q2", "eps_actual": 1.05, "eps_estimate": 1.01, "surprise_pct": 4.0}}
    if kind == "news.company":
        if case == "no-source-time":
            return {"symbol": "NVDA", "items": []}
        items = [{"headline": "Fixture headline one", "source_name": "fixture-wire", "as_of": "2026-10-30T19:30:00Z"},
                 {"headline": "Fixture headline two", "source_name": "fixture-wire", "as_of": "2026-10-30T17:05:00Z"}]
        return {"symbol": "NVDA", "items": items[:1] if partial else items}
    if kind == "breadth.current":
        return {"pct_above_50sma": 54.2, "pct_above_200sma": 61.7, "advancing": 1840, "declining": 1210}
    if kind == "nhnl":
        return {"new_highs": 212, "new_lows": 47, "net": 165}
    if kind == "themes":
        return {"period": "1d", "leaders": [{"theme": "Semiconductors", "pct": 2.1}],
                "laggards": [{"theme": "Homebuilders", "pct": -1.4}]}
    if kind == "volume.surge":
        return {"rows": [{"symbol": "NVDA", "vol_x": 2.4}, {"symbol": "AMD", "vol_x": 1.9}]}
    if kind == "ratings":
        rows = [{"symbol": "NVDA", "rating": 92, "percentile": 97},
                {"symbol": "AMD", "rating": 81, "percentile": 88},
                {"symbol": "AVGO", "rating": 87, "percentile": 93}]
        return {"ratings": rows[:2] if partial else rows, "missing": ["AVGO"] if partial else []}
    if kind == "screen.run":
        rows = [{"symbol": "NVDA", "rs_rank": 97, "adr_pct": 4.6}, {"symbol": "AVGO", "rs_rank": 93, "adr_pct": 4.1}]
        return {"spec": copy.deepcopy(_SPEC), "rows": rows, "total_matches": len(rows)}
    if kind == "screen.count":
        return {"spec": copy.deepcopy(_SPEC), "count": 2}
    if kind == "screen.saved":
        return {"screens": [{"id": "fx_saved_1", "name": "Fixture leaders", "spec": copy.deepcopy(_SPEC)}]}
    raise KeyError(kind)


def _scan_coverage(kind: str, case: str) -> Optional[dict]:
    if KINDS[kind]["category"] != "scan":
        return None
    if kind == "screen.saved":
        return _coverage(1, 1)
    if case == "partial":
        return _coverage(3700, 3540, dropped=40, not_computable=120)
    return _coverage(3700, 3700)


def cases_for(kind: str) -> tuple[str, ...]:
    declared = KINDS[kind]["freshness"]
    out = ["stale", "market-closed", "unavailable", "refused"]
    if declared == "live":
        out[:0] = ["live", "delayed"]
    elif declared == "periodic":
        out[:0] = ["periodic"]
    elif declared == "historical":
        out[:0] = ["historical"]
    if kind in _BULK:
        out.append("partial")
    if kind == "news.company":
        out.append("no-source-time")
    return tuple(c for c in CASES if c in out)


def default_case(kind: str) -> str:
    """The case a kind answers in the ordinary in-session read: its declared class."""
    return KINDS[kind]["freshness"]


def _build(kind: str, case: str) -> dict:
    meta = KINDS[kind]
    params = _params(kind)
    source, calls, declared = meta["source"], meta["calls"], meta["freshness"]
    if case == "refused":
        e = env.refused(kind, params, f"this turn already made {gw.MAX_READS_PER_TURN} data reads")
        e["fetched_at"] = FETCH_SESSION
        return e
    if case == "unavailable":
        e = env.unavailable(kind, params, source, "the data source could not answer", provider_calls=calls)
        e["fetched_at"] = FETCH_SESSION
        return e
    kw: dict = {"status": "ok", "source": source, "data": _data(kind, case), "coverage": _scan_coverage(kind, case),
                "provider_calls": calls}
    fetched = FETCH_SESSION
    if case == "live":
        kw.update(freshness="live", as_of=AS_OF_LIVE)
    elif case == "delayed":
        kw.update(freshness="delayed", as_of=AS_OF_DELAYED, delay_s=DELAY_S,
                  notes=["delayed about 15 minutes; not live"])
    elif case == "periodic":
        kw.update(freshness="periodic", as_of=AS_OF_PERIODIC)
    elif case == "historical":
        kw.update(freshness="historical", as_of=AS_OF_PRIOR_CLOSE,
                  notes=["last completed session; today's partial bar is not included"])
    elif case == "stale":
        kw.update(freshness=declared, as_of=AS_OF_STALE, stale=True, provider_calls=0,
                  notes=["older than this kind's freshness budget; say how old"])
        if declared == "delayed":
            kw["delay_s"] = DELAY_S
    elif case == "market-closed":
        fetched = FETCH_CLOSED
        closed_class = "historical" if declared in ("live", "delayed", "historical") else declared
        kw.update(freshness=closed_class, as_of=AS_OF_LAST_CLOSE, notes=["market closed — last session's close"])
    elif case == "partial":
        kw.update(status="partial", freshness=declared, as_of=AS_OF_LIVE if declared == "live" else AS_OF_PERIODIC)
        if KINDS[kind]["category"] == "scan":
            kw["notes"] = ["40 symbols dropped and 120 not computable; see coverage"]
        elif kind == "news.company":
            kw["notes"] = ["one news feed did not answer; items may be incomplete"]
        else:
            kw["notes"] = ["no data for AVGO"]
    elif case == "no-source-time":
        kw.update(freshness=declared, as_of=None, notes=["no items in the window, so there is no source time"])
    else:
        raise ValueError(f"case {case!r} does not apply to {kind!r}")
    if kind == "news.company" and kw["data"]["items"]:
        # each item carries its own time; the envelope as_of is the newest item (MD-1 §4)
        if case == "stale":
            for i in kw["data"]["items"]:
                i["as_of"] = AS_OF_STALE
        kw["as_of"] = max(i["as_of"] for i in kw["data"]["items"])
    e = env.make_envelope(kind, params, **kw)
    e["fetched_at"] = fetched
    return e


def build_fixtures() -> dict[str, str]:
    """relative path -> file text. The single authority for every file under FIXTURE_DIR it names."""
    files: dict[str, str] = {}
    index = {"version": FIXTURE_VERSION, "contracts": {"md": env.CONTRACT, "sc": "SC-1.0"}, "cases": list(CASES),
             "kinds": {}}
    for kind in KINDS:
        cases = cases_for(kind)
        meta = KINDS[kind]
        index["kinds"][kind] = {"declared_freshness": meta["freshness"], "category": meta["category"],
                                "owner": meta["owner"], "default_case": default_case(kind), "cases": list(cases),
                                "file": f"envelopes/{kind}.json"}
        body = {"kind": kind, "declared_freshness": meta["freshness"], "category": meta["category"],
                "cases": {c: _build(kind, c) for c in cases}}
        files[f"envelopes/{kind}.json"] = json.dumps(body, indent=2, ensure_ascii=False) + "\n"
    files["index.json"] = json.dumps(index, indent=2, ensure_ascii=False) + "\n"
    return files


def write_fixtures() -> list[str]:
    written = []
    for rel, text in build_fixtures().items():
        p = FIXTURE_DIR / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        written.append(rel)
    return written


# ── the loader ───────────────────────────────────────────────────────────────────────────────────
_CACHE: dict[str, dict] = {}


def _file(kind: str) -> dict:
    if kind not in KINDS:
        raise KeyError(f"no fixtures for kind {kind!r}")
    if kind not in _CACHE:
        with open(ENVELOPE_DIR / f"{kind}.json", encoding="utf-8") as fh:
            _CACHE[kind] = json.load(fh)
    return _CACHE[kind]


def load_fixture(kind: str, case: Optional[str] = None) -> dict:
    """A deep copy of one fixture envelope (mutate freely). `case` defaults to the kind's declared class."""
    case = case or default_case(kind)
    cases = _file(kind)["cases"]
    if case not in cases:
        raise KeyError(f"kind {kind!r} has no {case!r} fixture; it has {sorted(cases)}")
    return copy.deepcopy(cases[case])


def all_fixtures() -> Iterator[tuple[str, str, dict]]:
    for kind in KINDS:
        for case in cases_for(kind):
            yield kind, case, load_fixture(kind, case)


Answer = Union[str, Callable[[dict, dict], dict]]


def fake_kind(kind: str, answer: Optional[Answer] = None) -> gw.Kind:
    """A gateway Kind with the contract's declared freshness/category, answering a fixture case (or a callable)."""
    meta = KINDS[kind]
    if callable(answer):
        fn = answer
    else:
        case = answer or default_case(kind)
        load_fixture(kind, case)  # fail now on a typo, not inside a read

        def fn(params, ctx, _k=kind, _c=case):  # noqa: ARG001
            return load_fixture(_k, _c)
    return gw.Kind(name=kind, fn=fn, freshness=meta["freshness"], category=meta["category"], owner=meta["owner"],
                   description=f"agent-qa fixture ({kind})")


def fake_registry(answers: Optional[dict[str, Answer]] = None, kinds: Optional[list[str]] = None) -> gw.Registry:
    """Every fixture kind (or `kinds`) registered; `answers` overrides a kind's case or gives a callable."""
    answers = answers or {}
    r = gw.Registry()
    for k in kinds or KINDS:
        r.register(fake_kind(k, answers.get(k)))
    return r


# ── the rail ─────────────────────────────────────────────────────────────────────────────────────
_ALL = [(k, c) for k in KINDS for c in cases_for(k)]


def test_the_files_on_disk_are_exactly_what_this_module_generates():
    want = build_fixtures()
    assert want, "the generator produced nothing"           # non-vacuity
    on_disk = sorted(p.relative_to(FIXTURE_DIR).as_posix() for p in FIXTURE_DIR.rglob("*.json"))
    assert on_disk == sorted(want), "a fixture JSON exists that this module does not generate, or one is missing"
    # line endings are normalised: git stores LF, and autocrlf checks these out as CRLF on Windows
    stale = [rel for rel, text in want.items()
             if (FIXTURE_DIR / rel).read_bytes().replace(b"\r\n", b"\n") != text.encode("utf-8")]
    assert not stale, f"regenerate with `python -m tests.test_uct_agent_qa_fixtures --write`: {stale}"


def test_every_contract_kind_has_fixtures_and_the_cases_the_brief_requires():
    md_v1 = {"quote", "quotes", "bars.daily", "bars.intraday", "fundamentals", "earnings", "news.company",
             "breadth.current", "nhnl", "themes", "volume.surge", "ratings"}
    sc_1 = {"screen.run", "screen.count", "screen.saved"}
    assert set(KINDS) == md_v1 | sc_1
    covered = {c for _, c in _ALL}
    assert covered == set(CASES), f"no kind exercises {set(CASES) - covered}"
    for k in KINDS:
        assert {"stale", "market-closed", "unavailable", "refused"} <= set(cases_for(k)), k


@pytest.mark.parametrize("kind,case", _ALL)
def test_every_fixture_passes_validate_envelope(kind, case):
    e = load_fixture(kind, case)
    assert env.validate_envelope(e) == []
    assert e["kind"] == kind


@pytest.mark.parametrize("kind,case", _ALL)
def test_no_fixture_claims_a_fresher_class_than_its_kind_declares(kind, case):
    e = load_fixture(kind, case)
    if e["status"] in ("ok", "partial"):
        assert env.FRESHNESS.index(e["freshness"]) >= env.FRESHNESS.index(KINDS[kind]["freshness"])


def test_case_semantics():
    for kind, case in _ALL:
        e = load_fixture(kind, case)
        if case == "delayed":
            assert e["freshness"] == "delayed" and e["delay_s"] == DELAY_S
        if case == "stale":
            assert e["stale"] is True and e["notes"]
        if case == "market-closed":
            assert e["freshness"] != "live" and any("market closed" in n for n in e["notes"])
            assert e["fetched_at"] == FETCH_CLOSED
        if case in ("unavailable", "refused"):
            assert e["status"] == case and e["data"] is None and e["freshness"] == "unavailable"
        if case == "partial":
            assert e["status"] == "partial" and (e["notes"] or e["coverage"])
        if case == "no-source-time":
            assert e["as_of"] is None and e["notes"]
        if e["status"] in ("ok", "partial") and case != "stale":
            assert e["stale"] is False


def test_scan_fixtures_carry_closing_coverage_and_sc1_data():
    for kind in ("screen.run", "screen.count", "screen.saved"):
        for case in cases_for(kind):
            e = load_fixture(kind, case)
            if e["status"] not in ("ok", "partial"):
                continue
            c = e["coverage"]
            assert set(c) == {"evaluated", "answered", "dropped", "not_computable"}, (kind, case)
            assert c["evaluated"] == c["answered"] + c["dropped"] + c["not_computable"], (kind, case)
    run = load_fixture("screen.run")["data"]
    assert set(run) == {"spec", "rows", "total_matches"} and len(run["rows"]) <= 50
    assert set(load_fixture("screen.count")["data"]) == {"spec", "count"}
    assert set(load_fixture("screen.saved")["data"]["screens"][0]) == {"id", "name", "spec"}


def test_a_fixture_never_carries_a_secret_a_url_or_a_raw_payload():
    text = "".join(build_fixtures().values()).lower()
    for needle in ("apikey", "api_key", "secret", "token", "bearer", "password", "http://", "https://", "raw"):
        assert needle not in text, needle


def test_load_fixture_returns_a_copy():
    a = load_fixture("quote")
    a["data"]["price"] = -1
    assert load_fixture("quote")["data"]["price"] == 207.04


def test_the_fake_registry_round_trips_through_the_real_gateway(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    try:
        gw._reset_for_test(fake_registry())
        assert gw.registry().names() == sorted(KINDS)
        for kind in KINDS:
            out = gw.read(kind, _params(kind), user_id=1, turn_id=f"qa-{kind}")
            want = load_fixture(kind)
            assert out == want, kind   # the gateway passed it through unchanged: it conforms
        gw._reset_for_test(fake_registry({"quote": "market-closed"}, kinds=["quote"]))
        out = gw.read("quote", {"symbol": "NVDA"}, user_id=1, turn_id="qa-closed")
        assert out["freshness"] == "historical" and out["status"] == "ok"
    finally:
        gw._reset_for_test(None)


def test_fake_kind_rejects_an_unknown_case():
    with pytest.raises(KeyError):
        fake_kind("quote", "periodic")     # a live kind has no periodic fixture


if __name__ == "__main__":
    if "--write" in sys.argv:
        for rel in write_fixtures():
            print(rel)
    else:
        print("usage: python -m tests.test_uct_agent_qa_fixtures --write")
