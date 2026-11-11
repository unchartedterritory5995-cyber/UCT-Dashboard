"""UCT RS Phase 4, unit 4-08: the Study RS drill drafts (docs/study/bank/rs.drills.json, scripts/study/bank_v2/gen_rs.py).

What the owner's review sitting depends on, checked offline against the committed bank:
  * every item passes the importer's own check (study_import.check_item: number grounding, voice, near-duplicate) and
    the generators' validator, and is a DRAFT;
  * the precomputed RS pane (prompt_json.chart.rs / rs_pair, reveal_json.rs / rs_pair) is exactly what
    relative_strength.compute_phase1_columns gives from the bars and closes the item carries;
  * no ticker the chart hides appears in any member-facing prompt string, and a tap or red-day item's prompt carries
    no dot (the real ones are in reveal_json.rs), nor does either line of a leader item (reveal_json.rs_pair);
  * the key is what the indicator says (the first new-high dot, the rising line, green on red);
  * the import route takes the whole segment as drafts with no flags and no bars misses, and the hub places read.rs on
    its unit (an unknown skill_id would not fail the import either: it lands under `unplaced`).

Run: python -m pytest -q -p no:cacheprovider tests/study/test_gen_rs.py
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import require_admin
from api.services import relative_strength as RS
from api.services import study_import
from api.services import study_store as ss
from api.services.indicator_compute import _round_series
from scripts.study import _common
from scripts.study.bank_v2 import gen_rs

REPO = pathlib.Path(__file__).resolve().parents[2]
BANK = REPO / "docs" / "study" / "bank" / "rs.drills.json"
RS_KEYS = ("rsLine", "rsMa", "dotNH", "dotNHbeforePx")
#: keys a member payload must never carry (tests/test_study_no_sym_leak.py), minus `subject`, which the store strips
FORBIDDEN_PROMPT_KEYS = {"sym", "forward", "forward_json", "forward_bars", "answer_json", "answer", "reveal_json",
                         "lesson_text", "source_ref", "sha256"}


@pytest.fixture(scope="module")
def items() -> list:
    return json.loads(BANK.read_text(encoding="utf-8"))


def _family(it) -> str:
    return gen_rs.family(it)


def _closes(s: str) -> list:
    return [{"t": t, "c": c} for t, c in json.loads(s)]


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def _keys(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from _keys(v)
    elif isinstance(node, list):
        for v in node:
            yield from _keys(v)


def _hidden_tickers(it) -> set:
    ex = (it.get("reveal_json") or {}).get("example") or {}
    out = {it.get("sym")} | set((ex.get("names") or {}).values())
    return {t for t in out if t}


# ── the segment ──────────────────────────────────────────────────────────────

def test_about_forty_drafts_in_the_four_families(items):
    fam = {}
    for it in items:
        fam[_family(it)] = fam.get(_family(it), 0) + 1
    assert fam == {"tap": 12, "leader": 10, "redday": 10, "rsi": 8}
    assert len({it["id"] for it in items}) == len(items) == 40


def test_every_item_is_a_generator_draft_on_read_rs_naming_its_card(items):
    for it in items:
        assert it["review_status"] == "draft" and "reviewed" not in it, it["id"]
        assert it["skill_id"] == "read.rs" and it["module"] == "F2", it["id"]
        assert it["source_kind"] == "generator" and it["source_ref"], it["id"]
        assert it["lesson_origin"] == "session", it["id"]
        teaches = it["reveal_json"]["teaches"]
        assert teaches["card"] and teaches["title"] and teaches["source"], it["id"]
    assert {it["type"] for it in items} == {"tap", "spot", "recall"}


def test_every_item_passes_the_importer_check_and_the_generator_validator(items):
    assert _common.validate(items, allow_embed_kinds=("fixture", "generator")) == []
    bank: list = []
    for it in items:
        chk = study_import.check_item(it, bank)
        assert chk["flags"] == [], (it["id"], chk["flags"])
        assert chk["lane"] == "manual", it["id"]                   # the owner reads every one
        bank.append(it)


def test_choices_are_short_and_hold_the_key(items):
    for it in items:
        p = it["prompt_json"]
        if it["type"] == "tap":
            assert set(it["answer_json"]) == {"bar_index", "bar_tol"} and it["answer_json"]["bar_tol"] == 1
            continue
        assert it["answer_json"]["answer"].lower() in [c.lower() for c in p["choices"]], it["id"]
        assert all(len(c) <= 40 for c in p["choices"]), it["id"]


# ── no ticker before scoring ─────────────────────────────────────────────────

def test_no_hidden_ticker_appears_in_any_prompt_string(items):
    for it in items:
        texts = list(_strings(it["prompt_json"]))
        for sym in _hidden_tickers(it):
            rx = re.compile(rf"(?<![A-Za-z0-9]){re.escape(sym)}(?![A-Za-z0-9])")
            hit = [t for t in texts if rx.search(t)]
            assert not hit, (it["id"], sym, hit[:3])


def test_no_member_payload_key_leaks_the_key_or_the_forward_bars(items):
    for it in items:
        assert not (set(_keys(it["prompt_json"])) & FORBIDDEN_PROMPT_KEYS), it["id"]


def test_a_tap_prompt_carries_no_dot_because_the_dot_is_the_answer(items):
    for it in (i for i in items if i["type"] == "tap"):
        cols = it["prompt_json"]["chart"]["rs"]["columns"]
        assert all(v is None for v in cols["dotNH"]) and all(v is None for v in cols["dotNHbeforePx"]), it["id"]
        assert any(v is not None for v in it["reveal_json"]["rs"]["columns"]["dotNH"]), it["id"]


def test_a_red_day_prompt_carries_no_dot_because_a_new_high_on_the_marked_day_is_the_answer(items):
    """A new-high dot on the marked red session says the stock was strong that day: the question. 4-09 review."""
    red = [i for i in items if _family(i) == "redday"]
    assert len(red) == 10
    with_dots = 0
    for it in red:
        prompt = it["prompt_json"]["chart"]["rs"]
        for k in prompt["columns"]:
            if k.startswith("dot"):
                assert all(v is None for v in prompt["columns"][k]), (it["id"], k)
        assert all(v is not None for v in prompt["columns"]["rsLine"]), it["id"]
        reveal = it["reveal_json"]["rs"]
        assert reveal["times"] == prompt["times"] and reveal["inputs"] == prompt["inputs"], it["id"]
        for k in ("rsLine", "rsMa"):
            assert reveal["columns"][k] == prompt["columns"][k], (it["id"], k)
        with_dots += any(v is not None for v in reveal["columns"]["dotNH"])
    assert with_dots >= 1                                   # the reveal really carries the dots the prompt hid


def test_a_leader_prompt_carries_no_dot_on_either_line_because_only_the_leader_can_have_one(items):
    """Only the leader can make a new 52-week RS high, so a dot on Line A or Line B names the answer (4-11 check)."""
    lead = [i for i in items if _family(i) == "leader"]
    assert len(lead) == 10
    for it in lead:
        prompt = it["prompt_json"]["chart"]["rs_pair"]
        reveal = it["reveal_json"]["rs_pair"]
        assert set(prompt) == set(reveal) == {"A", "B"}, it["id"]
        for name in ("A", "B"):
            cols = prompt[name]["columns"]
            for k in cols:
                if k.startswith("dot"):
                    assert all(v is None for v in cols[k]), (it["id"], name, k)
            assert all(v is not None for v in cols["rsLine"]), (it["id"], name)
            assert reveal[name]["times"] == prompt[name]["times"] and reveal[name]["inputs"] == prompt[name]["inputs"]
            for k in ("rsLine", "rsMa"):
                assert reveal[name]["columns"][k] == cols[k], (it["id"], name, k)
        key = it["answer_json"]["answer"][-1]
        assert any(v is not None for v in reveal[key]["columns"]["dotNH"]), it["id"]   # the reveal has the leader's dots


# ── the RS pane is reproducible from what the item carries ───────────────────

def _expected(stock: list, bench: list, inputs: dict) -> dict:
    cols = RS.compute_phase1_columns(stock, bench, inputs)
    return {k: _round_series(cols[k][-gen_rs.WINDOW:], 6) for k in RS_KEYS} | {"gor": cols["gor"][-gen_rs.WINDOW:]}


def _single_name_series(it) -> tuple:
    vis = it["bars_embed"]["bars"]
    stock = _closes(it["rs_source"]["stock_warmup"]) + [{"t": b["t"], "c": b["c"]} for b in vis]
    return stock, _closes(it["rs_source"]["bench"])


def test_the_rs_columns_are_reproducible_from_the_embedded_bars(items):
    checked = 0
    for it in items:
        if it["type"] == "recall":
            assert "bars_embed" not in it and "chart" not in it["prompt_json"]
            continue
        emb = it["bars_embed"]
        assert len(emb["bars"]) == gen_rs.WINDOW and 0 < len(emb["forward"]) <= gen_rs.FORWARD, it["id"]
        assert emb["sha256"] == ss.bars_sha256(emb["bars"]), it["id"]
        assert emb["asof"] == it["asof"] and emb["sym"] == it["sym"], it["id"]
        times = [b["t"] for b in emb["bars"]]
        chart = it["prompt_json"]["chart"]
        if _family(it) == "leader":
            bench = _closes(it["rs_source"]["bench"])
            assert [b["t"] for b in bench][-gen_rs.WINDOW:] == times and [b["c"] for b in bench][-gen_rs.WINDOW:] == [
                b["c"] for b in emb["bars"]], it["id"]                     # the chart IS the benchmark
            assert set(chart["rs_pair"]) == {"A", "B"} and "rs" not in chart
            for label, block in chart["rs_pair"].items():
                assert block["inputs"] == gen_rs.INPUTS and block["times"] == times
                exp = _expected(_closes(it["rs_source"]["names"][label]), bench, block["inputs"])
                shown = it["reveal_json"]["rs_pair"][label]
                assert shown["times"] == times
                for k in RS_KEYS:
                    assert shown["columns"][k] == exp[k], (it["id"], label, k)
                for k in ("rsLine", "rsMa"):
                    assert block["columns"][k] == exp[k], (it["id"], label, k)
                checked += 1
            continue
        stock, bench = _single_name_series(it)
        assert len(stock) == gen_rs.SLICE and [b["t"] for b in stock] == [b["t"] for b in bench], it["id"]
        block = chart["rs"]
        assert block["inputs"] == gen_rs.INPUTS == RS.resolve_phase1_inputs({}) and block["times"] == times
        exp = _expected(stock, bench, block["inputs"])
        shown = it["reveal_json"]["rs"] if _family(it) in ("tap", "redday") else block
        assert shown["times"] == times
        for k in RS_KEYS:
            assert shown["columns"][k] == exp[k], (it["id"], k)
        for k in ("rsLine", "rsMa"):
            assert block["columns"][k] == exp[k], (it["id"], k)
        assert all(v is not None for v in block["columns"]["rsLine"]), it["id"]
        checked += 1
    assert checked == 12 + 10 * 2 + 10


# ── the key is what the indicator says ───────────────────────────────────────

def test_a_tap_key_is_the_first_new_high_dot_and_breaks_a_high_on_the_chart(items):
    for it in (i for i in items if i["type"] == "tap"):
        dots = it["reveal_json"]["rs"]["columns"]["dotNH"]
        first = next(j for j, v in enumerate(dots) if v is not None)
        i = it["answer_json"]["bar_index"]
        assert i == first == it["reveal_json"]["facts"]["rs_high_bar_index"], it["id"]
        rs = it["prompt_json"]["chart"]["rs"]["columns"]["rsLine"]
        peak = it["reveal_json"]["facts"]["prior_rs_high_bar_index"]
        assert 0 <= peak < i - 1 and max(rs[:i]) == rs[peak] and rs[i] > rs[peak], it["id"]
        gold = it["reveal_json"]["rs"]["columns"]["dotNHbeforePx"][i] is not None
        assert gold == it["reveal_json"]["facts"]["before_price"], it["id"]
        assert ("before price" in it["prompt_json"]["q"]) == gold, it["id"]


def test_a_leader_key_is_the_rising_line_and_the_other_line_fell(items):
    for it in (i for i in items if _family(i) == "leader"):
        key = it["answer_json"]["answer"][-1]
        other = "B" if key == "A" else "A"
        pair = it["reveal_json"]["rs_pair"]
        lead, lag = pair[key]["columns"]["rsLine"], pair[other]["columns"]["rsLine"]
        assert lead[-1] > lead[0] * 1.14 and lag[-1] < lag[0] * 0.91, it["id"]
        assert any(v is not None for v in pair[key]["columns"]["dotNH"][-20:]), it["id"]
        assert all(v is None for v in pair[other]["columns"]["dotNH"]), it["id"]
    rose = [i for i in items if _family(i) == "leader" and i["reveal_json"]["facts"]["laggard_price_rose"]]
    assert len(rose) >= 5                                   # "a stock can go up and still lose the race", half of them


def test_a_red_day_key_is_the_indicators_own_green_on_red(items):
    keys = []
    for it in (i for i in items if _family(i) == "redday"):
        stock, bench = _single_name_series(it)
        gor = _expected(stock, bench, gen_rs.INPUTS)["gor"][-1]
        key = it["answer_json"]["answer"]
        assert (key == "yes") == (gor == 1.0), it["id"]
        f = it["reveal_json"]["facts"]
        assert f["spy_day_pct"] <= gen_rs.RED_DAY_PCT, it["id"]
        assert (f["stock_day_pct"] > 0) if key == "yes" else (f["stock_day_pct"] < f["spy_day_pct"]), it["id"]
        mark = it["prompt_json"]["chart"]["mark"]
        assert mark["bar_index"] == gen_rs.WINDOW - 1 and mark["time"] == it["bars_embed"]["bars"][-1]["t"]
        keys.append(key)
    assert keys.count("yes") == keys.count("no") == 5


def test_the_rsi_items_quote_the_research_and_name_unit_4_02_as_their_future_source(items):
    rsi = [i for i in items if _family(i) == "rsi"]
    assert len(rsi) == 8
    for it in rsi:
        r = it["reveal_json"]
        assert r["quote"] and r["quote_source"] and "04-how-rs-is-taught.md" in r["source"]
        assert "MISCONCEPTIONS[0]" in r["teaches"]["source"] and r["teaches"]["card"] == "misconception-1"
        assert len(it["prompt_json"]["choices"]) == 4


# ── the indicator is named as it ships (UCT RS split, U8) ────────────────────

def test_the_bank_names_the_indicator_as_the_generator_does(items):
    """RS split U8 (2026-11-09): the chart indicator ships as "UCT RS Line" (the slim definition's meta.name); the
    Classic preset and the other views are gone. The committed bank's reveal `system` strings and the one recall
    item that names the indicator must be the generator's own words, read from its source, so the bank and the
    generator cannot drift apart again (the bank was renamed through gen_rs.write, not regenerated: the sandbox
    bars.db reproduces 38 of the 40 drafts and would swap two, and no draft may be dropped)."""
    src = pathlib.Path(gen_rs.__file__).read_text(encoding="utf-8")
    systems = set(re.findall(r'"system": "([^"]+)"', src))
    assert len(systems) == 3 and all(s.startswith("UCT RS Line") for s in systems)
    seen = set()
    for it in items:
        system = it["reveal_json"].get("system")
        if _family(it) == "rsi":
            assert system is None, it["id"]
            continue
        assert system in systems, (it["id"], system)
        seen.add(system)
    assert seen == systems
    search = next(r for r in gen_rs.RSI_ITEMS if r[0] == "rs-vs-rsi search")
    it = next(i for i in items if i["prompt_json"].get("subject") == "rs-vs-rsi search")
    assert search[2] == "UCT RS Line" and it["answer_json"]["answer"] == search[2]
    assert search[2] in it["prompt_json"]["choices"] and it["lesson_text"] == search[6]
    # nothing a member reads names a view the indicator no longer offers, or the old name as a control
    gone = re.compile(r"Mansfield|Rotation|Clenow|Volatility.adjusted|Agreement|Regime|UCT fast|Classic|preset", re.I)
    for it in items:
        for text in _strings(it["prompt_json"]):
            assert not gone.search(text), (it["id"], text)
        assert not gone.search(it["lesson_text"] or ""), it["id"]
        assert "UCT Relative Strength" not in json.dumps(it["reveal_json"]) + it["lesson_text"], it["id"]


# ── the import route and the hub, offline ────────────────────────────────────

@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    return ss


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(study_router.router)
    return app


@pytest.fixture()
def push_client(store, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "test-secret-123")
    c = TestClient(_app())
    c.headers.update({"Authorization": "Bearer test-secret-123"})
    return c


def test_the_import_route_takes_the_whole_segment_as_drafts_with_no_flags(push_client, store, items):
    r = push_client.post("/api/study/import", json={"items": items})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] == 40 and body["flagged"] == [] and body["misses"] == [] and body["rejected"] == []
    for it in items:
        row = ss.get_item_full(it["id"])
        assert row["review_status"] == "draft" and row["skill_id"] == "read.rs"
        if it["type"] != "recall":
            assert row["bars_ref"] and row["sym"] == it["sym"]
            vis = ss.get_visible_bars(it["id"], approved_only=False)
            assert vis["bars"] == it["bars_embed"]["bars"]
        prompt = ss.get_item_prompt(it["id"], approved_only=False)
        dump = json.dumps(prompt)
        for sym in _hidden_tickers(it):
            assert not re.search(rf'(?<![A-Za-z0-9]){re.escape(sym)}(?![A-Za-z0-9])', dump), (it["id"], sym)


def test_read_rs_sits_on_its_unit_and_an_unknown_skill_would_not_fail_the_import(push_client, store, items):
    unit = [u for cur in study_router._skill_map()["curricula"] for t in cur["tracks"] for u in t["units"]
            if "read.rs" in u["skills"]]
    assert [u["title"] for u in unit] == ["Reading relative strength"]
    stray = dict(items[-1], id="si_000000000001", skill_id="read.not-on-the-map")
    r = push_client.post("/api/study/import", json={"items": items + [stray]})
    assert r.status_code == 200 and r.json()["flagged"] == []
    app = _app()
    app.dependency_overrides[require_admin] = lambda: {"id": "a1", "role": "admin", "plan": "pro"}
    hub = TestClient(app).get("/api/study/admin/hub").json()
    placed = {s for cur in hub["tree"] for t in cur["tracks"] for u in t["units"] for s in u["skills"]}
    assert "read.rs" in placed
    assert [s["skill_id"] for s in hub["unplaced"]] == ["read.not-on-the-map"]
