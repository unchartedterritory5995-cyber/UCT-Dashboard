"""Sector and theme benchmarks for the UCT RS indicators (owner, 2026-11-12:
"I want to be able to benchmark to sector, theme etc").

What is railed, each case against the real resolver with injected reads (no
database, no store):

* ``SECTOR_PICK`` resolves to the picked SPDR ETF; a value outside the eleven
  falls back to SPY with a reason; the eleven are exactly `SECTOR_ETF`'s.
* ``THEME`` (auto) uses the stock's strongest-tier theme (tie: most members,
  then the name), built as an equal-weight composite that leaves the stock out;
  no theme / too thin / an ETF fall back to the SECTOR resolution, the THEME
  reason first.
* ``THEME_PICK`` resolves a theme by its stable ID; blank, malformed and
  unknown IDs fall back with their own reasons.
* INDUSTRY now leaves the charted stock out too (one rule for both composites).
* The composite memo: one build per reader, never shared across readers.
* Saved values are unchanged: SPY / SECTOR / INDUSTRY / CUSTOM keep their keys
  and their resolution; the v4 menu keeps every old key.
* The provider names the benchmark plainly (`benchmark.name`) and says why it
  fell back (`benchmark.note`) on the RS line and on the split indicators.
* An RS alert on ``THEME`` evaluates the chart's composite exactly; the picks
  are refused at the door with a plain reason.
* The theme list route answers ``{options: [{value, label}]}``.
"""
from __future__ import annotations

import pytest

from api.services import alert_rs_series as ars
from api.services import alert_series
from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev  # noqa: F401 — registers the RS alert series
from api.services import relative_strength as rsm
from api.services import rs_benchmarks as rb
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from tests.test_rs_columns_provider import (  # noqa: F401 — fixtures are used by name
    _bars, _fetcher, _hermetic_reads, _long_daily, _no_cache, v4_row,
)

THEMES = {
    "ai_chips": {"id": "ai_chips", "name": "AI / GPU Chips", "members": ["NVDA", "AMD", "AVGO", "MRVL"]},
    "semis": {"id": "semis", "name": "Semiconductors", "members": ["NVDA", "AMD", "INTC", "QCOM", "TXN"]},
    "tiny": {"id": "tiny", "name": "Tiny Theme", "members": ["NVDA", "AMD", "ZZZZ"]},
}


@pytest.fixture(autouse=True)
def _theme_seams(monkeypatch):
    """The taxonomy through the resolver's three seams; the memo starts empty."""
    rb.composite_memo_reset()
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(rb, "_theme_info", lambda tid: (
        {"id": tid, "name": THEMES[tid]["name"]} if tid in THEMES else None))
    monkeypatch.setattr(rb, "_theme_members", lambda tid: list(THEMES.get(tid, {}).get("members", [])))
    monkeypatch.setattr(rb, "_themes_for", lambda sym: [
        {"id": "ai_chips", "name": "AI / GPU Chips", "tier": "core", "members": 4},
        {"id": "semis", "name": "Semiconductors", "tier": "relevant", "members": 5},
    ] if sym.upper() == "NVDA" else [])
    yield
    rb.composite_memo_reset()


STORE = {
    "NVDA": _bars([100, 110, 121]), "AMD": _bars([10, 11, 12]), "AVGO": _bars([50, 55, 50]),
    "MRVL": _bars([20, 20, 22]), "INTC": _bars([30, 30, 30]), "QCOM": _bars([40, 44, 40]),
    "TXN": _bars([60, 60, 66]), "XLK": _bars([200, 202, 204]), "XLV": _bars([90, 91, 92]),
    "SPY": _bars([400, 401, 402]),
}


# ── Pick a sector ────────────────────────────────────────────────────────────

def test_the_eleven_sector_picks_are_the_sector_etf_tables_eleven_with_plain_names():
    assert set(rb.SECTOR_PICKS) == set(rb.SECTOR_ETF.values()) and len(rb.SECTOR_PICKS) == 11
    assert list(rb.SECTOR_PICKS)[:3] == ["XLK", "XLV", "XLF"]
    assert rb.SECTOR_PICKS["XLY"] == "Consumer Discretionary" and rb.DEFAULT_SECTOR_PICK == "XLK"
    row = {i["key"]: i for i in rd.rs_benchmark_choice_inputs()}
    assert row["sectorBenchmark"]["options"] == list(rb.SECTOR_PICKS)


def test_pick_a_sector_resolves_to_that_etf_whatever_the_stocks_own_sector():
    out = rb.resolve_benchmark("NVDA", "SECTOR_PICK", "D", 10, _fetcher(STORE), sector="xlv")
    assert (out["resolved"], out["label"], out["fallback"]) == ("XLV", "Health Care (XLV)", None)
    assert [b["c"] for b in out["bars"]] == [90, 91, 92]


@pytest.mark.parametrize("bad", [None, "", "XLKK", "SPY", "$SPX"])
def test_pick_a_sector_outside_the_eleven_falls_back_to_spy_and_says_so(bad):
    out = rb.resolve_benchmark("NVDA", "SECTOR_PICK", "D", 10, _fetcher(STORE), sector=bad)
    assert (out["resolved"], out["fallback"]) == ("SPY", rb.NO_SECTOR_PICK)


# ── Theme (auto): the strongest tier ─────────────────────────────────────────

def test_the_strongest_theme_is_the_best_tier_then_the_most_members_then_the_name():
    pick = rb.pick_strongest_theme
    assert pick([]) is None
    assert pick([{"id": "a", "name": "A", "tier": "relevant", "members": 40},
                 {"id": "b", "name": "B", "tier": "core", "members": 3}])["id"] == "b", "tier wins over size"
    assert pick([{"id": "a", "name": "A", "tier": "core", "members": 10},
                 {"id": "b", "name": "B", "tier": "core", "members": 25}])["id"] == "b", "a tie goes to the bigger theme"
    assert pick([{"id": "z", "name": "Zeta", "tier": "core", "members": 10},
                 {"id": "a", "name": "alpha", "tier": "core", "members": 10}])["id"] == "a", "then the name, case-blind"
    assert pick([{"id": "a", "name": "A", "tier": "mystery", "members": 99},
                 {"id": "b", "name": "B", "tier": "peripheral", "members": 1}])["id"] == "b", "an unknown tier ranks last"
    # the order the rows arrive in never decides
    rows = [{"id": "x", "name": "X", "tier": "core", "members": 7}, {"id": "y", "name": "Y", "tier": "core", "members": 7}]
    assert pick(rows)["id"] == pick(list(reversed(rows)))["id"] == "x"


def test_theme_auto_builds_the_strongest_themes_composite_without_the_stock():
    fetch = _fetcher(STORE)
    out = rb.resolve_benchmark("NVDA", "THEME", "D", 10, fetch)
    assert out["resolved"] == "THEME:ai_chips" and out["fallback"] is None
    assert out["name"] == "AI / GPU Chips" and rb.benchmark_name(out) == "AI / GPU Chips"
    assert out["label"] == "AI / GPU Chips (equal-weight, 3 names)"
    assert "NVDA" not in {s for s, _, _ in fetch.calls}, "the charted stock is never read as a member"
    expected = rb.equal_weight_composite({m: STORE[m] for m in ("AMD", "AVGO", "MRVL")})
    assert out["bars"] == expected


def test_theme_auto_with_no_theme_falls_back_to_the_sector_and_says_why():
    out = rb.resolve_benchmark("AAPL", "THEME", "D", 10, _fetcher(STORE))
    assert (out["requested"], out["resolved"], out["fallback"]) == ("THEME", "XLK", rb.NO_THEME)


def test_theme_auto_for_an_etf_falls_to_spy_with_both_reasons(monkeypatch):
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Financial", "industry": rb.ETF_INDUSTRY})
    out = rb.resolve_benchmark("SMH", "THEME", "D", 10, _fetcher(STORE))
    assert (out["resolved"], out["fallback"]) == ("SPY", "no theme; symbol is an ETF")


def test_a_theme_too_thin_once_the_stock_is_out_falls_back_to_the_sector(monkeypatch):
    monkeypatch.setattr(rb, "_themes_for", lambda sym: [{"id": "tiny", "name": "Tiny Theme", "tier": "core", "members": 3}])
    out = rb.resolve_benchmark("NVDA", "THEME", "D", 10, _fetcher(STORE))
    assert (out["resolved"], out["fallback"]) == ("XLK", rb.THEME_TOO_SMALL), "AMD alone (ZZZZ has no bars) is under the floor"


def test_the_composite_floor_and_presence_rule_are_the_industry_ones():
    # MIN_INDUSTRY_MEMBERS contributing names; the presence share is equal_weight_composite's own
    store = dict(STORE, AMD=_bars([10, 11]))           # AMD lacks the last bar: 2 of 3 present still emits it
    out = rb.resolve_benchmark("NVDA", "THEME", "D", 10, _fetcher(store))
    assert [b["t"] for b in out["bars"]] == [1000, 1001, 1002]
    assert rb.MIN_INDUSTRY_MEMBERS == 3 and rb.MIN_PRESENT_SHARE == 0.5


# ── Pick a theme: by ID ──────────────────────────────────────────────────────

def test_pick_a_theme_resolves_by_its_id_and_names_it():
    out = rb.resolve_benchmark("INTC", "THEME_PICK", "D", 10, _fetcher(STORE), theme="semis")
    assert out["resolved"] == "THEME:semis" and out["name"] == "Semiconductors" and out["fallback"] is None
    assert out["label"] == "Semiconductors (equal-weight, 4 names)", "INTC is a member, so it is left out"
    # the same theme from a stock outside it carries all five
    out = rb.resolve_benchmark("MSFT", "THEME_PICK", "D", 10, _fetcher(STORE), theme="semis")
    assert out["label"] == "Semiconductors (equal-weight, 5 names)"


@pytest.mark.parametrize("theme, reason", [(None, rb.NO_THEME_PICK), ("", rb.NO_THEME_PICK),
                                           ("AI Chips", rb.NO_THEME_PICK), ("../etc", rb.NO_THEME_PICK),
                                           ("gone_theme", rb.THEME_NOT_FOUND)])
def test_pick_a_theme_blank_malformed_or_unknown_falls_back_with_its_reason(theme, reason):
    out = rb.resolve_benchmark("NVDA", "THEME_PICK", "D", 10, _fetcher(STORE), theme=theme)
    assert (out["resolved"], out["fallback"]) == ("XLK", reason)


def test_the_picks_are_ignored_by_every_other_benchmark():
    for req in ("SPY", "SECTOR", "THEME", "CUSTOM"):
        a = rb.resolve_benchmark("NVDA", req, "D", 10, _fetcher(STORE), custom="QQQ")
        b = rb.resolve_benchmark("NVDA", req, "D", 10, _fetcher(STORE), custom="QQQ", sector="XLV", theme="semis")
        assert a == b, req


def test_benchmark_picks_blank_every_value_the_benchmark_does_not_read():
    inp = {"customBenchmark": "smh", "sectorBenchmark": "xlv", "themeBenchmark": "semis"}
    assert rb.benchmark_picks("SPY", inp) == {"customBenchmark": "", "sectorBenchmark": "", "themeBenchmark": ""}
    assert rb.benchmark_picks("CUSTOM", inp)["customBenchmark"] == "SMH"
    assert rb.benchmark_picks("SECTOR_PICK", inp)["sectorBenchmark"] == "XLV"
    assert rb.benchmark_picks("THEME_PICK", inp)["themeBenchmark"] == "semis"
    assert rb.benchmark_picks("THEME_PICK", {"themeBenchmark": "Not An Id"})["themeBenchmark"] == ""


# ── INDUSTRY: the same exclusion ─────────────────────────────────────────────

def test_the_industry_composite_leaves_the_charted_stock_out(monkeypatch):
    monkeypatch.setattr(rb, "_members_of", lambda ind: ["NVDA", "AMD", "AVGO", "MRVL"])
    fetch = _fetcher(STORE)
    out = rb.resolve_benchmark("NVDA", "INDUSTRY", "D", 10, fetch)
    assert out["label"] == "Semiconductors (equal-weight, 3 names)"
    assert "NVDA" not in {s for s, _, _ in fetch.calls}
    assert rb.benchmark_name(out) == "Semiconductors"
    # a class share is matched in either spelling
    monkeypatch.setattr(rb, "_members_of", lambda ind: ["BRK.B", "AMD", "AVGO", "MRVL"])
    fetch = _fetcher(dict(STORE, **{"BRK-B": _bars([1, 2, 3])}))
    rb.resolve_benchmark("BRK-B", "INDUSTRY", "D", 10, fetch)
    assert not {s for s, _, _ in fetch.calls} & {"BRK.B", "BRK-B"}


# ── the composite memo ───────────────────────────────────────────────────────

def test_a_composite_is_built_once_per_reader_and_never_shared_across_readers():
    fetch = _fetcher(STORE)
    a = rb.resolve_benchmark("NVDA", "THEME", "D", 10, fetch, memo=fetch)
    n = len(fetch.calls)
    b = rb.resolve_benchmark("NVDA", "THEME", "D", 10, fetch, memo=fetch)
    assert len(fetch.calls) == n and a["bars"] == b["bars"], "the second ask reads no member bars"
    other = _fetcher(dict(STORE, AMD=_bars([10, 20, 40])))
    c = rb.resolve_benchmark("NVDA", "THEME", "D", 10, other, memo=other)
    assert other.calls and c["bars"] != a["bars"], "another reader builds its own"
    # no reader, no memo
    rb.resolve_benchmark("NVDA", "THEME", "D", 10, fetch)
    assert len(fetch.calls) > n


def test_the_memo_expires(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(rb, "_now", lambda: clock[0])
    fetch = _fetcher(STORE)
    rb.resolve_benchmark("NVDA", "THEME", "D", 10, fetch, memo=fetch)
    n = len(fetch.calls)
    clock[0] += rb.COMPOSITE_MEMO_TTL_S + 1
    rb.resolve_benchmark("NVDA", "THEME", "D", 10, fetch, memo=fetch)
    assert len(fetch.calls) > n


# ── saved charts keep their meaning ──────────────────────────────────────────

def test_every_old_key_is_still_on_the_v4_menu_and_resolves_as_before(v4_row):
    for key in ("SPY", "RSP", "SECTOR", "QQQ", "IWM", "INDUSTRY", "CUSTOM"):
        assert key in rd.RS_LINE_BENCHMARKS_V4, key
    assert rd.RS_LINE_BENCHMARKS == ("SPY", "RSP", "SECTOR", "QQQ", "IWM", "INDUSTRY")
    assert rb.resolve_benchmark("NVDA", "QQQ", "D", 10, _fetcher(STORE))["resolved"] == "QQQ"
    assert rb.resolve_benchmark("NVDA", "SECTOR", "D", 10, _fetcher(STORE))["resolved"] == "XLK"
    assert rb.resolve_benchmark("NVDA", "CUSTOM", "D", 10, _fetcher(STORE), custom="amd")["resolved"] == "AMD"
    # a row resolves an old saved instance exactly as stored
    for key in ("SECTOR", "INDUSTRY", "CUSTOM", "SPY"):
        assert rd.resolve_inputs("rsLine", {"benchmark": key})["benchmark"] == key


# ── the provider names it ────────────────────────────────────────────────────

def _theme_store():
    store = _long_daily()
    base = store["NVDA"]
    for k, m in (("AMD", 0.9), ("AVGO", 1.1), ("MRVL", 1.05)):
        store[k] = [dict(b, c=b["c"] * m) for b in base]
    return store


def test_the_rs_line_names_a_theme_benchmark_plainly(v4_row):
    store = _theme_store()
    env = rsp.rs_line_envelope("NVDA", "D", {"benchmark": "THEME"}, fetch_bars=lambda s, tf, c: store.get(s.upper(), [])[-c:],
                               cache_key=lambda kind, s: f"k:{kind}:{s}")
    b = env["payload"]["benchmark"]
    assert b["resolved"] == "THEME:ai_chips" and b["name"] == "AI / GPU Chips" and b["note"] is None
    assert b["label"].startswith("AI / GPU Chips (equal-weight")
    assert env["payload"]["inputs"]["themeBenchmark"] == "" and env["payload"]["inputs"]["sectorBenchmark"] == ""
    assert any(v is not None for v in env["columns"]["rsLine"])


def test_a_theme_chart_reads_each_member_once_however_many_blocks_read_the_benchmark(v4_row):
    """The time budget: the regime block reads the composite in hand instead of
    building it again deeper (one bar read per member, measured at 30-60 s cold
    on the sandbox store), and a second RS indicator on the chart reuses it."""
    store = _theme_store()
    calls = []

    def fetch(s, tf, c):
        calls.append(s.upper())
        return store.get(s.upper(), [])[-c:]

    rsp.rs_line_envelope("NVDA", "D", {"benchmark": "THEME"}, fetch_bars=fetch, cache_key=lambda kind, s: f"k:{kind}:{s}")
    for m in ("AMD", "AVGO", "MRVL"):
        assert calls.count(m) == 1, (m, calls)
    rsp.rs_core_reset()
    rsp.rs_phases_envelope("NVDA", "D", {"benchmark": "THEME"}, fetch_bars=fetch, cache_key=lambda kind, s: f"p:{kind}:{s}")
    rsp.rs_core_reset()
    for m in ("AMD", "AVGO", "MRVL"):
        assert calls.count(m) == 1, f"{m}: the second indicator rebuilt the composite"


def test_the_rs_line_says_why_a_theme_fell_back(v4_row):
    store = _long_daily()
    store["AAPL"] = store["NVDA"]
    env = rsp.rs_line_envelope("AAPL", "D", {"benchmark": "THEME"}, fetch_bars=lambda s, tf, c: store.get(s.upper(), [])[-c:],
                               cache_key=lambda kind, s: f"k:{kind}:{s}")
    b = env["payload"]["benchmark"]
    assert (b["resolved"], b["name"], b["fallback"]) == ("XLK", "XLK", rb.NO_THEME)
    assert b["note"] == "No UCT theme for this stock; using XLK"


@pytest.mark.parametrize("reason, sentence", [
    (rb.NO_SECTOR_PICK, "No sector picked; using SPY"),
    (rb.NO_THEME_PICK, "No theme picked; using SPY"),
    (rb.THEME_NOT_FOUND, "That theme no longer exists; using SPY"),
    (rb.THEME_TOO_SMALL, "Theme too small to average; using SPY"),
    ("no theme; symbol is an ETF", "No UCT theme for this stock; using SPY"),
])
def test_every_new_fallback_reason_has_a_plain_sentence(reason, sentence):
    bench = {"requested": "THEME", "resolved": "SPY", "fallback": reason}
    assert rsp._rs_benchmark_note(bench, {"index": 0}, [1], intraday=False) == sentence


def test_a_split_indicator_on_a_picked_theme_carries_the_same_composite(monkeypatch):
    store = _theme_store()
    rsp.rs_core_reset()
    monkeypatch.setattr(rsp.cache, "get", lambda k: None)
    monkeypatch.setattr(rsp.cache, "set", lambda k, v, ttl: None)
    fetch = lambda s, tf, c: store.get(s.upper(), [])[-c:]  # noqa: E731
    env = rsp.rs_vs_ema_envelope("NVDA", "D", {"benchmark": "THEME_PICK", "themeBenchmark": "ai_chips",
                                               "customBenchmark": "SMH"},
                                 fetch_bars=fetch, cache_key=lambda kind, s: f"k:{kind}:{s}")
    b = env["payload"]["benchmark"]
    assert (b["resolved"], b["name"]) == ("THEME:ai_chips", "AI / GPU Chips")
    assert env["payload"]["inputs"]["customBenchmark"] == "", "a box the benchmark does not read is blank"
    assert env["payload"]["inputs"]["themeBenchmark"] == "ai_chips"
    rsp.rs_core_reset()


# ── alerts ───────────────────────────────────────────────────────────────────

def test_theme_is_offered_to_alerts_and_the_picks_are_refused_in_plain_words():
    assert ars.RS_ALERT_BENCHMARKS[-1] == "THEME"
    assert ars.rs_refusal("rs_line.value", {"benchmark": "THEME"}) is None
    for b in ("SECTOR_PICK", "THEME_PICK"):
        msg = ars.rs_refusal("rs_line.crossUp", {"benchmark": b})
        assert msg and "chart-only" in msg and "THEME" in msg, msg


def test_an_alert_on_theme_evaluates_the_charts_composite_exactly():
    store = _theme_store()
    bars = store["NVDA"][-300:]

    def reader(sym, tf, want):
        return store.get(sym.upper(), [])[-want:]

    fn = alert_series.SERIES_FUNCS["rs_line.value"]
    with ars.rs_pass(fetch_bars=reader):
        got = aus.call_series(fn, bars, {"benchmark": "THEME"}, tf="D", sym="NVDA")
    bench = rb.resolve_benchmark("NVDA", "THEME", "D", len(bars), reader)
    assert bench["resolved"] == "THEME:ai_chips"
    want = rsm.compute_phase1_columns(bars, [b for b in bench["bars"] if b["t"] in {x["t"] for x in bars}],
                                      rsm.resolve_phase1_inputs({}))["rsLine"]
    assert len(got) == len(bars) and any(v is not None for v in got)
    for g, w in zip(got, want):
        assert (g is None and w is None) or g == pytest.approx(w, rel=1e-6)


def test_the_alert_pass_memoises_the_composite_under_its_reader():
    store = _theme_store()
    calls = []

    def reader(sym, tf, want):
        calls.append(sym)
        return store.get(sym.upper(), [])[-want:]

    bars = store["NVDA"][-300:]
    fn = alert_series.SERIES_FUNCS["rs_line.value"]
    with ars.rs_pass(fetch_bars=reader):
        aus.call_series(fn, bars, {"benchmark": "THEME"}, tf="D", sym="NVDA")
    first = len(calls)
    with ars.rs_pass(fetch_bars=reader):           # the next cycle: a new pass, the same reader
        aus.call_series(fn, bars, {"benchmark": "THEME"}, tf="D", sym="NVDA")
    assert first and len(calls) == first, "the second cycle rebuilt nothing"


# ── the theme list route ─────────────────────────────────────────────────────

def test_the_theme_list_route_answers_value_and_label(monkeypatch):
    from api.routers import signature as sig
    monkeypatch.setattr(rb, "theme_choices", lambda: [{"id": "ai_chips", "name": "AI / GPU Chips"},
                                                      {"id": "semis", "name": "Semiconductors"}])
    assert sig.rs_benchmark_themes(_user={}) == {"options": [
        {"value": "ai_chips", "label": "AI / GPU Chips"}, {"value": "semis", "label": "Semiconductors"}]}


def test_theme_choices_drop_an_id_the_picker_could_not_store(monkeypatch):
    from api.services import theme_db
    monkeypatch.setattr(theme_db, "get_theme_names", lambda: [
        {"id": "ai_chips", "name": "AI"}, {"id": "Bad Id", "name": "Bad"}, {"id": "", "name": "Empty"}])
    assert rb.theme_choices() == [{"id": "ai_chips", "name": "AI"}]


def test_the_row_patterns_are_the_resolvers_own():
    row = {i["key"]: i for i in rd.rs_benchmark_choice_inputs()}
    assert row["themeBenchmark"]["pattern"] == rb.THEME_ID_RE.pattern and row["themeBenchmark"]["maxLength"] == 64
    assert row["customBenchmark"]["pattern"] == rb.CUSTOM_SYMBOL_RE.pattern
    for def_id in ("rsPhases", "rsVsEma", "rsExit"):
        keys = [i["key"] for i in next(d for d in rd.RS_SPLIT_DEFS if d["id"] == def_id)["inputs"]]
        assert keys[:4] == ["benchmark", "customBenchmark", "sectorBenchmark", "themeBenchmark"], def_id
