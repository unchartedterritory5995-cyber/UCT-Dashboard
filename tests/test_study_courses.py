"""Study courses (docs/study/courses/README.md, owner rulings 2026-11-08): the mechanical rail.

Two halves:
  1. every real course file under docs/study/courses passes `courses_lib.unit_problems` (shape, the support rule,
     quotes, recomputed calcs, the importer's voice + number grounding), and the bank holds only checker-passed items;
  2. the validator itself catches what it claims to catch (each rule fails a planted defect, and a clean unit passes:
     a checker that answers "no" to everything would pass half 1 trivially).
"""
from __future__ import annotations

import copy
import json
import math

import pytest

from scripts.study import courses_lib as cl


def _unit() -> dict:
    """A small clean unit: 10 questions, every format, all three levels."""
    src = [{"id": "s1", "tier": 1, "publisher": "SEC, Investor.gov", "title": "Bid price",
            "url": "https://www.investor.gov/example-bid", "accessed": "2026-11-08"},
           {"id": "s2", "tier": 2, "publisher": "Investopedia", "title": "Spread",
            "url": "https://www.investopedia.com/example-spread", "accessed": "2026-11-08"},
           {"id": "s3", "tier": 2, "publisher": "Fidelity", "title": "Spread",
            "url": "https://www.fidelity.com/example-spread", "accessed": "2026-11-08"}]
    facts = [{"id": "f1", "source": "s1", "quote": "The bid price is the highest price a buyer will pay.",
              "claim": "The bid is the most a buyer will pay right now."},
             {"id": "f2", "source": "s2", "quote": "The spread is the difference between the bid and the ask.",
              "claim": "The spread is the gap between bid and ask."},
             {"id": "f3", "source": "s3", "quote": "A wider spread means a higher cost to trade.",
              "claim": "Wide spreads cost you more."}]

    def q(key, fmt, rung, **kw):
        base = {"key": key, "skill": "basics.spread", "rung": rung, "format": fmt, "facts": ["f1"],
                "why": "That's the bid.", "lesson_line": "The bid is what a buyer pays you."}
        base.update(kw)
        return base

    mcq = dict(q="Which price is the most a buyer will pay?", choices=["The bid", "The ask", "The last", "The open"],
               answer="The bid", wrong={"The ask": "That is the seller's price.", "The last": "That already traded.",
                                        "The open": "That was this morning."})
    qs = [
        q("q01", "mcq", 1, **mcq),
        q("q02", "tf", 2, q="The bid is the most a buyer will pay right now.", answer="True"),
        q("q03", "tf", 3, q="The spread is the bid plus the ask.", answer="False", facts=["f2", "f3"],
          why="False. It is the difference.", lesson_line="Subtract, never add."),
        q("q04", "scenario", 4, story="You want out fast. The quote shows a bid and an ask.",
          q="Selling at market, which price do you get?", choices=["The bid", "The ask", "The midpoint"],
          answer="The bid", wrong={"The ask": "That is what buyers pay.", "The midpoint": "Only with a limit order."}),
        q("q05", "scenario", 5, story="Two stocks trade near the same price. One spread is wide.",
          q="Which costs more to trade?", choices=["The wide one", "The tight one", "They cost the same"],
          answer="The wide one", facts=["f2", "f3"], why="The wide one.", lesson_line="Wide spreads tax every trade.",
          wrong={"The tight one": "Tight is cheap.", "They cost the same": "The spread is part of the cost."}),
        q("q06", "numeric", 6, q="The bid is 10.00 and the ask is 10.05. What is the spread in dollars?",
          answer=0.05, calc={"fn": "spread", "args": {"bid": 10.0, "ask": 10.05}}, facts=["f2", "f3"],
          why="0.05. Ask minus bid.", lesson_line="Ask minus bid is the spread.", prefix="$"),
        q("q07", "fill", 7, q="Fill the word.", sentence="The ___ is what a buyer will pay.",
          bank=["bid", "ask", "last", "close"], answer="bid"),
        q("q08", "mcq", 8, **mcq),
        q("q09", "mcq", 9, **mcq),
        q("q10", "mcq", 1, **mcq),
    ]
    # the mcq clones need distinct keys only; give them distinct questions so nothing is a duplicate in spirit
    qs[7]["q"] = "Which number on a quote is the buyer's price?"
    qs[8]["q"] = "A buyer is willing to pay up to this price. What is it called?"
    qs[9]["q"] = "On a quote, which side belongs to buyers?"
    return {"unit": "F1.03", "track": "F1", "title": "Bid, ask and the spread", "teaches": "Bid, ask and spread.",
            "as_of": "2026-11-08", "skills": [{"id": "basics.spread", "title": "Spread"}], "sources": src,
            "facts": facts, "questions": qs,
            "walkthroughs": [{"key": "w1", "title": "The quote", "steps": ["Every quote has two sides.",
                                                                       "The bid is the buyer's side."],
                              "facts": ["f1"]}],
            "verify": {**{x["key"]: {"status": "pass", "notes": "", "by": "checker"} for x in qs},
                       "w1": {"status": "pass", "notes": "", "by": "checker"}}}


# ── half 1: the real files ───────────────────────────────────────────────────────────────────────────────────────

REAL = cl.unit_files()


@pytest.mark.parametrize("path", REAL, ids=[p.stem for p in REAL] or None)
def test_every_course_file_is_clean(path):
    doc = cl.load_unit(path)
    assert cl.unit_problems(doc, path=path) == []


def test_bank_holds_only_checker_passed_questions():
    built = {}
    for p in REAL:
        doc = cl.load_unit(p)
        for it in cl.strip_private(cl.build_items(doc, only_passed=True)):
            built[it["id"]] = it
    on_disk = {}
    for f in (cl.REPO / "docs" / "study" / "bank").glob("course.*.json"):
        for it in json.loads(f.read_text(encoding="utf-8")):
            on_disk[it["id"]] = it
    assert set(on_disk) == set(built), "run `python -m scripts.study.gen_courses` after editing a course file"
    assert all(it["review_status"] == "draft" for it in on_disk.values())


# ── half 2: the validator catches what it claims ─────────────────────────────────────────────────────────────────

def test_clean_unit_passes():
    assert cl.unit_problems(_unit()) == []


def _first(doc, key):
    return next(q for q in doc["questions"] if q["key"] == key)


@pytest.mark.parametrize("mutate,expect", [
    (lambda d: _first(d, "q01").update(answer="Nope"), "answer is not one of the choices"),
    (lambda d: _first(d, "q01").update(choices=["The bid", "The ask"]), "3 or 4 choices"),
    (lambda d: _first(d, "q01")["wrong"].pop("The ask"), "must explain every wrong choice"),
    (lambda d: _first(d, "q01")["choices"].__setitem__(3, "All of the above"), "all/none of the above"),
    (lambda d: _first(d, "q02").update(answer="Yes"), 'tf answer must be "True" or "False"'),
    (lambda d: _first(d, "q06").update(answer=0.06), "!= calc"),
    (lambda d: _first(d, "q06").pop("calc"), "numeric needs a calc"),
    (lambda d: _first(d, "q07").update(answer="spread"), "fill answer is not in the bank"),
    (lambda d: _first(d, "q04").update(story=""), "scenario needs a story"),
    (lambda d: _first(d, "q03").update(facts=["f2"]), "support rule"),
    (lambda d: _first(d, "q01").update(facts=[]), "cites no fact"),
    (lambda d: d["facts"][0].update(quote=" ".join(["word"] * 41)), "max 40"),
    (lambda d: d["sources"][0].update(url="http://insecure.example"), "url must be https"),
    (lambda d: _first(d, "q01").update(q="Is the tape strong today?"), "untaught house word"),
    (lambda d: _first(d, "q01").update(why="That's the firm's rule."), "never 'the firm'"),
    (lambda d: _first(d, "q01").update(q="In stock talk, which price is the bid?"), "banned phrase"),
    (lambda d: _first(d, "q01").update(story="A stock trades at 20.00 bid, 20.02 ask."), "a story only reaches the member on a scenario"),
    (lambda d: _first(d, "q04").update(story="Hidden ticker, bought on the breakout at 73.", q="16 with the stop at 72.24. Where is 3R?"),
     "a number is cut between the story and the question"),
    (lambda d: _first(d, "q04").update(story="WSM rests under its pivot.", chart={"sym": "WSM", "asof": "2023-09-25"}),
     "names the chart's ticker"),
    (lambda d: _first(d, "q04").update(story="Bought at 73.16, stop 72.24.",
                                       chart={"sym": "WSM", "asof": "2023-09-25", "trade": {"entry": 72.24, "stop": 73.16}}),
     "the stop must sit below the entry"),
    (lambda d: _first(d, "q04").update(story="Bought at 73.16, stop 72.24.",
                                       chart={"sym": "WSM", "asof": "2023-09-25", "trade": {"entry": 73.16, "stop": 71.5}}),
     "is not in the question's words"),
    (lambda d: _first(d, "q01").update(why="That's the bid. It is 42 cents."), "number 42 is not in a cited quote"),
    (lambda d: _first(d, "q01").update(q="It's important to know: which price is the bid?"), "importer: voice"),
    (lambda d: _first(d, "q01").update(lesson_line=" ".join(["w"] * 23)), "lesson_line is 23 words"),
    (lambda d: d["verify"]["q01"].update(status="maybe"), "status must be one of"),
    (lambda d: d["skills"][0].update(id="Spread"), "must start with basics."),
])
def test_validator_catches(mutate, expect):
    d = copy.deepcopy(_unit())
    mutate(d)
    probs = cl.unit_problems(d)
    assert any(expect in p for p in probs), probs


def test_our_lines_are_the_9_and_20_ema_on_live_questions_only():
    """D-021 (2026-11-12): our own trail / EMA is never the 10-day or 21-day in member text; an originator's own method,
    a measured value and a question that is not live are left alone."""
    stale = "We trail the rest under the 21-day EMA."
    d = copy.deepcopy(_unit())
    _first(d, "q01")["deeper"] = {"trap": stale}
    assert any("names our line as the 10-day / 21-day" in p for p in cl.unit_problems(d))
    for ok in ("Kell trails under the 10 EMA.", "It held the 21-day EMA at 41.20.", "We trail the rest under the 20 EMA."):
        d = copy.deepcopy(_unit())
        _first(d, "q01")["deeper"] = {"trap": ok}
        assert not any("names our line" in p for p in cl.unit_problems(d)), ok
    d = copy.deepcopy(_unit())
    _first(d, "q01")["deeper"] = {"trap": stale}
    d["verify"]["q01"]["status"] = "cut"
    assert not any("names our line" in p for p in cl.unit_problems(d))


def test_setup_track_is_registered_with_its_own_slug():
    """SET (the Method's Setup track, one unit per criteria card; pilot SET.07) validates like a Foundations track:
    its skill ids start with `setup.`, and a Foundations slug on a SET unit is refused."""
    assert cl.TRACK_SLUGS["SET"] == "setup"
    d = copy.deepcopy(_unit())
    d.update(unit="SET.07", track="SET", skills=[{"id": "setup.flat_base", "title": "Flat Base Breakout"}])
    for q in d["questions"]:
        q["skill"] = "setup.flat_base"
    assert cl.unit_problems(d) == []
    d["skills"][0]["id"] = "basics.flat_base"
    assert any("must start with setup." in p for p in cl.unit_problems(d))


def test_a_chart_question_ships_a_bars_spec_and_never_names_its_ticker():
    d = copy.deepcopy(_unit())
    _first(d, "q01")["chart"] = {"sym": "SPY", "asof": "2020-03-23", "window": 120, "forward": 30}
    assert cl.unit_problems(d) == []
    it = next(i for i in cl.build_items(d) if i["_key"] == "q01")
    # the bank asks for the window plus WARMUP_BARS of history (the averages are formed from the first visible candle);
    # the drill opens on visible_bars, and the ticker stays out of the set until the answer (hide_ticker, 2026-11-14)
    assert it["bars"] == {"sym": "SPY", "tf": "D", "asof": "2020-03-23", "window": 120 + cl.WARMUP_BARS, "forward": 30}
    assert it["sym"] == "SPY" and it["asof"] == "2020-03-23"
    assert it["prompt_json"]["chart"] == {"window_bars": 120 + cl.WARMUP_BARS, "visible_bars": 120, "tf": "D",
                                          "forward_bars": 30, "hide_ticker": True}
    _first(d, "q01").update(q="Which price is the most a buyer of SPY will pay?")
    assert any("names the chart's ticker" in p for p in cl.unit_problems(d))
    _first(d, "q01")["chart"].update(sym="spy", asof="March 2020")
    probs = cl.unit_problems(d)
    assert any("upper-case ticker" in p for p in probs) and any("YYYY-MM-DD" in p for p in probs)


def test_mix_and_rungs_are_enforced():
    d = copy.deepcopy(_unit())
    for q in d["questions"]:
        if q["format"] == "scenario":
            q.update(format="mcq", choices=q["choices"], story=None)
    assert any("scenario questions" in p for p in cl.unit_problems(d))
    d = copy.deepcopy(_unit())
    for q in d["questions"]:
        q["rung"] = 1
    assert any("rungs: only 0 questions at level 3" in p for p in cl.unit_problems(d))


def test_only_passed_questions_are_built():
    d = copy.deepcopy(_unit())
    d["verify"]["q02"]["status"] = "fix"
    d["verify"]["q03"]["status"] = "cut"
    keys = {it["_key"] for it in cl.build_items(d) if it["type"] != "walkthrough"}
    assert "q02" not in keys and "q03" not in keys and "q01" in keys
    assert len(keys) == 8


def test_built_items_carry_sources_and_stable_ids():
    d = _unit()
    a = {it["_key"]: it for it in cl.build_items(d)}
    q1 = a["q01"]
    assert q1["prompt_json"]["kind"] == "mcq" and q1["type"] == "recall"
    assert q1["reveal_json"]["depth"]["sources"][0]["url"].startswith("https://")
    assert q1["lesson_text"].startswith("That's the bid.")
    # rewording a question keeps its id: the owner's verdict keys on the id
    d2 = copy.deepcopy(d)
    _first(d2, "q01")["q"] = "Reworded question?"
    b = {it["_key"]: it for it in cl.build_items(d2)}
    assert b["q01"]["id"] == q1["id"]
    n6 = a["q06"]
    assert n6["prompt_json"]["kind"] == "fill_numeric" and n6["answer_json"]["answer"] == 0.05
    assert "0.05" in n6["answer_json"]["accept"]
    assert a["q04"]["type"] == "scenario" and a["q04"]["prompt_json"]["story"]


# ── the calcs ────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fn,args,want", [
    ("spread", {"bid": 10.0, "ask": 10.05}, 0.05),
    ("spread_pct", {"bid": 99.0, "ask": 101.0}, 2.0),
    ("pct_change", {"start": 50, "end": 55}, 10.0),
    ("gain_to_recover", {"loss_pct": 50}, 100.0),
    ("shares_from_risk", {"account": 100000, "risk_pct": 1, "entry": 50, "stop": 48}, 500),
    ("shares_from_risk", {"account": 25000, "risk_pct": 0.5, "entry": 33.3, "stop": 31.9}, 89),
    ("risk_dollars", {"shares": 500, "entry": 50, "stop": 48}, 1000),
    ("r_multiple", {"entry": 50, "stop": 48, "exit": 56}, 3.0),
    ("r_multiple", {"entry": 50, "stop": 52, "exit": 44, "side": "short"}, 3.0),
    ("expectancy_r", {"win_rate_pct": 40, "avg_win_r": 3, "avg_loss_r": 1}, 0.6),
    ("market_cap", {"price": 20, "shares_outstanding": 1_000_000}, 20_000_000),
    ("pe", {"price": 100, "eps": 4}, 25.0),
    ("option_payoff", {"kind": "call", "strike": 100, "premium": 3, "underlying": 110}, 700.0),
    ("option_payoff", {"kind": "put", "strike": 100, "premium": 3, "underlying": 110}, -300.0),
    ("option_payoff", {"kind": "call", "strike": 100, "premium": 3, "underlying": 90, "side": "short"}, 300.0),
    ("option_breakeven", {"kind": "put", "strike": 100, "premium": 3}, 97.0),
    ("vertical_payoff", {"kind": "call", "long_strike": 100, "short_strike": 105, "net_debit": 2,
                         "underlying": 120}, 300.0),
    ("extrinsic", {"kind": "call", "strike": 100, "underlying": 104, "premium": 6}, 2.0),
    ("drawdown_pct", {"peak": 200, "trough": 150}, 25.0),
    ("avg_price", {"fills": [[100, 10], [100, 12]]}, 11.0),
    ("short_pnl", {"entry": 50, "exit": 45, "shares": 100}, 500.0),
    ("arith", {"expr": "a * b / c", "a": 6, "b": 4, "c": 3}, 8.0),
])
def test_calcs(fn, args, want):
    assert math.isclose(cl.run_calc({"fn": fn, "args": args}), want, rel_tol=1e-9, abs_tol=1e-9)


@pytest.mark.parametrize("x,never", [(0.05, "0.1"), (2.25, "2.2"), (16.67, "16.7"), (0.125, "0.13"), (104.0, "104.1")])
def test_numeric_accept_lists_only_the_same_value(x, never):
    forms = cl.numeric_accept(x)
    assert never not in forms
    assert all(abs(float(f) - x) < 1e-12 for f in forms)
    assert cl._num_text(x) in forms


def test_leveraged_decay_in_chop():
    # +10% then -10% on the index: the index ends at 99, a 3x fund (no fees) ends at 91
    assert math.isclose(cl.run_calc({"fn": "leveraged_path", "args": {"daily_pcts": [10, -10]}}), 99.0)
    assert math.isclose(cl.run_calc({"fn": "leveraged_path", "args": {"daily_pcts": [10, -10], "leverage": 3}}), 91.0)


def test_arith_refuses_anything_but_arithmetic():
    for bad in ("__import__('os')", "open('x')", "a.__class__", "len(a)"):
        with pytest.raises(ValueError):
            cl.run_calc({"fn": "arith", "args": {"expr": bad, "a": 1}})


def test_unknown_calc_fails():
    with pytest.raises(ValueError):
        cl.run_calc({"fn": "nope"})


def test_an_authored_unit_keeps_its_planned_lesson_door():
    """A Method unit's `uct-method:` lesson key in skill_map.json survives being authored (gen_courses carries it)."""
    import json
    m = json.loads((cl.REPO / "docs" / "study" / "skill_map.json").read_text(encoding="utf-8"))
    curricula = m["curricula"] if isinstance(m["curricula"], list) else list(m["curricula"].values())
    units = [u for c in curricula for t in c.get("tracks") or [] for u in t.get("units") or [] if u.get("id") == "SET.07"]
    assert units and units[0].get("supply") == "authored"
    assert any(k.startswith("uct-method:") for k in units[0].get("lessons") or [])


# ── the order a member sees the choices in ────────────────────────────────────────────────────────────────────────
def _choice_unit(n=40, k=4):
    return {"unit": "T.01", "questions": [
        {"key": f"q{i:02d}", "format": "mcq", "choices": ["right", "w1", "w2", "w3"][:k], "answer": "right"} for i in range(1, n + 1)]}


def test_the_right_answer_is_dealt_evenly_across_the_slots():
    orders = cl.choice_orders(_choice_unit(40))
    slots = [o.index("right") for o in orders.values()]
    assert sorted(set(slots)) == [0, 1, 2, 3]
    assert all(slots.count(s) == 10 for s in range(4))         # 40 questions, four slots: exactly ten each
    # a streak of one slot is never longer than a block of four can make it
    longest = max(len(list(g)) for _, g in __import__("itertools").groupby(slots))
    assert longest <= 2


def test_the_order_is_stable_when_questions_are_added_or_cut():
    base = _choice_unit(12)
    first = cl.choice_orders(base)
    longer = _choice_unit(20)
    again = cl.choice_orders(longer)
    assert all(again[k] == v for k, v in first.items())        # appending never moves an earlier question
    assert cl.choice_orders(base) == first                     # and a rebuild is identical


def test_a_fixed_or_numeric_question_keeps_its_meaningful_order():
    doc = {"unit": "T.02", "questions": [
        {"key": "q01", "format": "mcq", "choices": ["Learn", "Practise", "Prove"], "answer": "Learn", "order": "fixed"},
        {"key": "q02", "format": "mcq", "choices": ["3R", "0.5R", "2R", "1R"], "answer": "2R"},
        {"key": "q03", "format": "mcq", "choices": ["$5", "2%", "10%"], "answer": "2%"},
    ]}
    o = cl.choice_orders(doc)
    assert o["q01"] == ["Learn", "Practise", "Prove"]
    assert o["q02"] == ["0.5R", "1R", "2R", "3R"]
    assert sorted(o["q03"]) == sorted(["$5", "2%", "10%"])     # mixed kinds of number have no natural order: dealt like words


def test_the_built_bank_never_keeps_the_answer_first():
    items = [i for p in cl.unit_files() for i in cl.build_items(cl.load_unit(p))]
    choice = [i for i in items if (i.get("prompt_json") or {}).get("kind") == "mcq" and len(i["prompt_json"]["choices"]) == 4
              and i["answer_json"].get("answer") in i["prompt_json"]["choices"]]
    first = sum(1 for i in choice if i["prompt_json"]["choices"][0] == i["answer_json"]["answer"])
    assert len(choice) > 500 and first / len(choice) < 0.40


# ── the overbuild fields (docs/study/OVERBUILD_PLAN.md): simple, deeper, tier, batch, risk, depends_on ──────────────
# Each rule is proven able to fail on a planted defect, and a clean upgraded question passes (a checker that answers
# "no" to everything would pass the first half trivially).

def _upgraded() -> dict:
    d = copy.deepcopy(_unit())
    q = _first(d, "q01")
    q.update(simple="The bid is the most a buyer will pay right now.", tier="core", batch="pilot-1",
             risk={"score": 2, "reasons": ["one stable definition"]}, depends_on=["D-029"],
             deeper={"example": "A quote shows a bid and an ask side by side.", "trap": "Mixing up the bid and the ask."})
    return d


def test_a_clean_upgraded_question_passes():
    assert cl.unit_problems(_upgraded()) == []


@pytest.mark.parametrize("mutate,expect", [
    (lambda q: q.update(simple=" ".join(["plain"] * 30)), "simple is 30 words"),
    (lambda q: q.update(simple="The bid."), "simple is 2 words"),
    (lambda q: q.update(simple=""), "simple is empty"),
    (lambda q: q.update(simple="The bid is the most a buyer pays; the ask is the least a seller takes."), "semicolon"),
    (lambda q: q.update(simple="The bid is what a buyer pays (right now)."), "semicolon, bracket or slash"),
    (lambda q: q.update(simple="The bid is 42 cents."), "numbers that are nowhere else"),
    (lambda q: q.update(simple="Counterparty intermediation notwithstanding, quotations facilitate settlement."), "plainer"),
    (lambda q: q.update(simple="That's the bid."), "simple repeats why word for word"),
    (lambda q: q.update(simple="The firm's bid is what a buyer will pay."), "never 'the firm'"),
    (lambda q: q.update(simple="Buyers pay the bid. Sellers take the ask. Nothing else. Really."), "more than 2 sentences"),
    (lambda q: q.update(tier="beginner"), "tier must be one of"),
    (lambda q: q.update(batch="  "), "batch must be a non-empty string"),
    (lambda q: q.update(risk={"score": 11, "reasons": []}), "risk must be"),
    (lambda q: q.update(depends_on=["D-29"]), "depends_on must be"),
    (lambda q: q.update(depends_on=[]), "depends_on must be"),
    (lambda q: q.update(deeper={"story": "x"}), "deeper must be an object"),
    (lambda q: q.update(deeper={"example": "x" * 601}), "at most 600 characters"),
    (lambda q: q.update(choices=["The bid", "The ask", "The last"], wrong={"The ask": "That is the seller's price.",
                                                                            "The last": "That already traded."}),
     "exactly 4 choices"),
])
def test_validator_catches_overbuild_defects(mutate, expect):
    d = _upgraded()
    mutate(_first(d, "q01"))
    probs = cl.unit_problems(d)
    assert any(expect in p for p in probs), probs


def test_a_three_choice_question_without_simple_is_still_allowed():
    """The 4th answer is required only of an upgraded question; the rest of the library stays valid while it is upgraded."""
    d = copy.deepcopy(_unit())
    assert len(_first(d, "q04")["choices"]) == 3 and cl.unit_problems(d) == []


def test_simple_deeper_and_tier_reach_the_member_but_the_owner_only_fields_do_not():
    d = _upgraded()
    it = next(i for i in cl.build_items(d) if i["_key"] == "q01")
    r = it["reveal_json"]
    assert r["simple"] == "The bid is the most a buyer will pay right now." and r["tier"] == "core"
    assert r["deeper"]["trap"] == "Mixing up the bid and the ask."
    blob = json.dumps(it)
    assert "risk" not in it and "depends_on" not in it and "pilot-1" not in blob and "D-029" not in blob


def test_the_simple_answer_is_grounded_like_every_other_prose_field():
    d = _upgraded()
    it = next(i for i in cl.build_items(d) if i["_key"] == "q01")
    it["reveal_json"]["simple"] = "The bid is the most a buyer will pay, 99 cents."
    assert any(p.startswith("simple: number 99") for p in cl.strict_grounding(it))


def test_a_number_made_up_in_a_go_deeper_example_is_refused():
    d = _upgraded()
    _first(d, "q01")["deeper"]["example"] = "A stock quoted 10.00 bid and 10.05 ask."
    assert any("deeper.example: number 10.00" in p for p in cl.unit_problems(d))


def test_the_importer_checks_simple_for_voice():
    from api.services import study_import
    assert "simple" in study_import.REVEAL_PROSE_KEYS
