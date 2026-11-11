"""UCT Agent program, agent-qa: independent adversarial probes of MD-1 §4.7.5 (lowercase ticker resolution, #695).

The REAL classifier (`instruments.classify`) over the REAL `ticker_search_index.search`, seeded with PRODUCTION rows:
agent-lead's read-only probe (`prod-index-probe.json`) plus agent-qa's own read-only probe of FRESH words agent-md had
not seen (`md2/prod-probe-qa.json`, incl. chat interjections). Both came from the public /api/ticker-search at limit 50;
production scans 400 and §4.7.5 is monotone (a row can only add a collision), so a "priced" here is an UPPER bound.

1. ALL rows at once: agent-md's test seeds each token's rows alone; production holds them together.
2. Each check BITES on production rows: drop it (and only it) from the verdict; the tokens that flip from the neutral
   ask to a price are exactly what that check alone protects. Pinned by name.
3. Fresh words: every lowercase word that RESOLVES is listed and judged. Bar: nothing coincidental.
   F-24 (FIXED in f0b1dee621): `nice` (NICE Ltd) used to resolve, so "nice, nvda price" priced NICE beside NVDA. L3 now
   counts an upper-case ticker in the token's OWN name as a word; the fix is proven to bite by reverting it below.
"""
from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest

from api.services.uct_agent.marketdata import instruments as ins
from tests.test_uct_agent_qa_quote_outcome import qa_index, prod_rows, PROBES

MD = {k: v for k, v in json.loads(PROBES[0].read_text(encoding="utf-8")).items() if k != "_meta"}
QA = {k: v for k, v in json.loads(PROBES[1].read_text(encoding="utf-8")).items()
      if k != "_meta" and isinstance(v, dict) and "error" not in v}
UNION = prod_rows()
MD_PRICED = "nvda tsla aapl msft amd brk.b amzn nflx pltr intc smci crwd xom".split()   # agent-md's own expectation


def _classify_all(tokens, drop=None, checks=None):
    real = ins.lowercase_checks
    base = checks or real
    drops = {drop} if isinstance(drop, str) else set(drop or ())
    ins.lowercase_checks = lambda token, own, idx: [c for c in base(token, own, idx) if c not in drops]
    try:
        with qa_index(UNION) as idx:
            return {t: ins.classify(t, "lower", idx) for t in tokens}
    finally:
        ins.lowercase_checks = real


def _priced(res):
    return sorted(t for t, r in res.items() if r["class"] == "symbol")


def _flips(drop):
    tokens = sorted(set(MD) | set(QA))
    base, mutated = _classify_all(tokens), _classify_all(tokens, drop=drop)
    assert set(_priced(base)) <= set(_priced(mutated))             # a mutation only ever ADDS prices
    return {t: mutated[t]["symbol"] for t in tokens
            if base[t]["class"] == "symbol_typed_lowercase" and mutated[t]["class"] == "symbol"}


# ── 1. all production rows at once ─────────────────────────────────────────────────────────────────────────────────
def test_non_vacuity_the_union_is_production_sized_and_holds_both_probes():
    assert len(MD) == 34 and len(QA) == 132 and len(UNION) > 1000
    assert {"NVDA", "GOLD", "BTC", "SPY", "NICE"} <= {r[0] for r in UNION}


def test_with_all_rows_at_once_agent_mds_priced_tokens_still_price_and_every_ask_still_asks():
    res = _classify_all(sorted(MD))
    assert _priced(res) == sorted(MD_PRICED)
    for t, r in res.items():
        if t not in MD_PRICED:
            assert r["class"] in ("symbol_typed_lowercase", "unknown"), (t, r)


# ── 2. each check bites on PRODUCTION rows ─────────────────────────────────────────────────────────────────────────
# check -> the production tokens that check ALONE keeps from being priced. QA judgement: none is what a member typing
# the lowercase word means (gold, dow, coin, cool, well…), or it is a ticker the owner accepted as a safe miss.
EXPECTED_BITES = {
    "fund": {},                                                    # never alone on production: see the backstop test
    "not_an_abbreviation": {"avgo": "AVGO", "fang": "FANG", "fizz": "FIZZ", "googl": "GOOGL", "grow": "GROW"},
    "name_word": {"asml": "ASML", "mara": "MARA", "nice": "NICE", "baba": "BABA", "beam": "BEAM", "bill": "BILL", "cake": "CAKE", "chef": "CHEF", "coin": "COIN",
                  "cost": "COST", "dow": "DOW", "gold": "GOLD", "hon": "HON", "hood": "HOOD", "intu": "INTU",
                  "jack": "JACK", "jpm": "JPM", "love": "LOVE", "lulu": "LULU", "now": "NOW", "open": "OPEN",
                  "path": "PATH", "plug": "PLUG", "rare": "RARE", "real": "REAL", "riot": "RIOT", "roku": "ROKU",
                  "safe": "SAFE", "snow": "SNOW", "sofi": "SOFI", "uber": "UBER", "well": "WELL", "wing": "WING"},
    "symbol_root": {"ba": "BA", "bch": "BCH", "cl": "CL", "gm": "GM", "hd": "HD", "ibm": "IBM", "si": "SI",
                    "tsm": "TSM", "ups": "UPS"},             # bch: Bitcoin Cash; cl/si: crude/silver futures
    # (ltc left this list with F-24's fix: "LTC Properties" now also fails L3 on its own name)
}


@pytest.mark.parametrize("check", sorted(EXPECTED_BITES))
def test_each_check_bites_on_production_rows(check):
    assert _flips(check) == EXPECTED_BITES[check]


def test_L1_is_the_backstop_for_funds_when_no_root_is_shared():
    # on production rows every probed fund also shares a root (BTCO, GLDM…), so L1 never decides ALONE; drop L4 too
    # and L1 is what keeps lowercase btc / gld from pricing the fund
    assert set(_flips(("fund", "symbol_root"))) - set(EXPECTED_BITES["symbol_root"]) == {"btc", "gld"}


def test_L5_bites_when_the_scan_fills_its_limit(monkeypatch):
    monkeypatch.setattr(ins, "SCAN_LIMIT", 3)
    res = _classify_all(MD_PRICED)
    with qa_index(UNION) as idx:
        complete = {t for t in MD_PRICED if len(idx.search(t, limit=3)) < 3}
    assert set(_priced(res)) == complete == {"brk.b"}              # only a scan that did NOT fill its limit prices
    assert all("scan_incomplete" in res[t]["basis"] for t in MD_PRICED if t not in complete)
    assert set(_priced(_classify_all(MD_PRICED, drop="scan_incomplete"))) > complete   # drop L5: they re-open


# ── 3. fresh words agent-md had not seen ───────────────────────────────────────────────────────────────────────────
# Fresh words that RESOLVE on production rows. QA judgement: each is the security a member means. `eat` (Brinker) is an
# English word too, but "eat price" has no other reading in a price sentence: recorded, not a finding.
FRESH_PRICED = {"adbe": "ADBE", "anet": "ANET", "eat": "EAT", "nke": "NKE", "orcl": "ORCL", "panw": "PANW", "pins": "PINS",
                "qcom": "QCOM", "wmt": "WMT"}


def test_fresh_words_that_resolve_are_pinned():
    res = _classify_all(sorted(QA))
    assert {t: res[t]["symbol"] for t in _priced(res)} == FRESH_PRICED


def test_no_other_interjection_resolves():
    words = ("wow cool great sweet yes lol omg sure thanks yo bro man fine good bad wild huge big sick dope lit fire solid "
             "fair same agree well um nope yep yeah lmao dang gee alright neat super nuts").split()
    assert set(words) <= set(QA)
    assert _priced(_classify_all(words)) == []


def test_BAR_no_english_interjection_resolves():
    assert _classify_all(["nice"])["nice"]["class"] == "symbol_typed_lowercase"           # F-24 fixed
    assert _classify_all(["nvda"])["nvda"]["class"] == "symbol"                           # control


def test_the_F24_fix_bites_reverting_it_reopens_nice_asml_and_mara():
    """F-24's fix proven as a mutation: put back the old L3 line (the ticker-reference skip on the token's OWN row too)
    and exactly nice, asml and mara price again; nothing else moves."""
    src = inspect.getsource(ins.lowercase_checks)
    fixed = "            if not is_own and _ticker_ref(w, name, own_t):\n                continue"
    assert src.count(fixed) == 1, "the L3 loop changed shape: re-derive this mutation"
    ns: dict = {}
    exec(compile(src.replace(fixed, fixed.replace("if not is_own and _ticker_ref", "if _ticker_ref")), "l3_revert", "exec"),
         vars(ins), ns)
    tokens = sorted(set(MD) | set(QA))
    now = set(_priced(_classify_all(tokens)))
    reverted = set(_priced(_classify_all(tokens, checks=ns["lowercase_checks"])))
    assert reverted - now == {"asml", "mara", "nice"} and now <= reverted
