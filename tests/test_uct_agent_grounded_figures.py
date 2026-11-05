"""SG-3 v2 — the FAMILY test set for `grounded_figures` (no market-outcome figures in a talk reply that read no data).

Each case is (message, reply, should_strip). The message is listed for the reader; the guard never reads it. Cases come
from review #815 (its false positives and false negatives of the withdrawn word-list guard, with a realistic reply each)
plus more of the same families. All figures are made up (never a market value).
`test_precision_and_recall` prints both over the whole set; every case is also its own test.
"""
from __future__ import annotations

import pytest

from api.services.uct_agent import grounded_figures as gf

S, K = True, False                 # should Strip / Keep
CASES = [
    # ── the live defect and review #815's false NEGATIVES (must strip) ─────────────────────────────────────────────
    ("how does SPY do after new 50-day highs", "After new 50-day highs SPY typically pulls back 2-3% within 5 to 10 sessions.", S),
    ("what's the average annual return of the S&P", "The S&P 500 has had an average annual return of about 10% since 1957.", S),
    ("historical return of QQQ", "QQQ's historical return has been roughly 13% a year.", S),
    ("how much does NVDA move on earnings", "NVDA usually moves about 8% on earnings.", S),
    ("what percent of breakouts fail", "Roughly 60% of breakouts fail within a few weeks.", S),
    ("how does QQQ react to CPI", "QQQ tends to move 1.5% on CPI days.", S),
    # ── more of the outcome family (must strip) ────────────────────────────────────────────────────────────────────
    ("win rate of gap ups", "Gap-and-go setups have a win rate of about 55%.", S),
    ("odds of a gap fill", "The odds of a gap filling the same week are around 70%.", S),
    ("how often does the market rally in december", "The market rallies in December about 75% of the time.", S),
    ("typical drawdown for leaders", "Leaders often see a 25% drawdown before their next leg.", S),
    ("what happens after a 5% gap", "Stocks that gap 5% gained another 3% on average over the next week.", S),
    ("IPO performance", "IPOs return an average of 18% in their first year.", S),
    ("how do small caps do in january", "Small caps outperform large caps by 2% in January on average.", S),
    ("how does TSLA trade after earnings", "TSLA has dropped 10% after its last few reports.", S),
    ("what's the success rate of VCPs", "VCP breakouts have a success rate near 65%.", S),
    ("how does the market do after FOMC", "The market rose 1.2% on average the day after FOMC.", S),
    # ── review #815's false POSITIVES (must keep: no outcome figure) ───────────────────────────────────────────────
    ("what should I do after a breakout fails", "If a breakout fails, respect your stop and wait for a new base to form.", K),
    ("how do breakouts usually work", "A breakout is a move through resistance, ideally on volume at least 40% above average.", K),
    ("why do stocks usually gap after earnings", "Earnings change what investors expect, so price reprices at the open.", K),
    ("when do stocks typically report earnings", "Most companies report in the few weeks after a quarter ends.", K),
    ("what usually happens to my alerts after the market closes", "Your alerts stay armed overnight and are checked again at the open.", K),
    ("why did my watchlist drop after the open", "I can't see your watchlist's moves from here — open it to see each stock's change.", K),
    # ── more keep cases: rules, thresholds, definitions, tendencies without a figure ───────────────────────────────
    ("how do I set a stop", "Many traders cut losses at 7-8% below the entry.", K),
    ("what's a buy point", "Buy within 5% of the pivot; beyond that the stock is extended.", K),
    ("what's RSI", "RSI above 70 is often called overbought and below 30 oversold.", K),
    ("what does ADR mean", "ADR is the average daily range as a percent of price — 5% means a typical day spans 5% of the price.", K),
    ("most gaps fill?", "Most gaps fill within weeks.", K),                          # a tendency with no figure stays
    ("what's a 50-day", "The 50-day moving average is the mean close of the last 50 sessions.", K),
    ("explain position sizing", "Risk about 1% of your account per trade.", K),
    ("what does extended mean", "A stock 20% above its 50-day is often called extended.", K),
    ("what is a float", "Float is the number of shares available to trade.", K),
    ("seasonality", "Historically September is the weakest month, with the S&P down 1% on average.", S),
    ("how did AMD do last report", "AMD gapped up 12% on its last report.", S),
    ("where should my alert go", "Set the alert 5% below the current price.", K),
    ("is a 3% gap big for SPY", "A 3% gap up is a big open for SPY.", K),
    ("what are bps", "A basis point is 0.01%, so 25 bps is a quarter of a percent.", K),
    # ── a HELD-OUT batch written after the rules (scored before any change: precision 1.00, recall 0.62; the three misses
    #    were then fixed, except the figure said in words, recorded in KNOWN_MISSES) ───────────────────────────────────
    ("gold returns", "Gold has averaged about 8% a year since 2000.", S),
    ("META into earnings", "META tends to rally 15% into earnings.", S),
    ("momentum last year", "Momentum stocks returned 30% last year.", S),
    ("Nasdaq after CPI", "The Nasdaq fell 2.4% the week after the last three CPI prints.", S),
    ("Dow decade", "Over the past decade the Dow gained roughly 9% annually.", S),
    ("leaders in bear markets", "Most leaders correct 20-30% during a bear market.", S),
    ("AAPL earnings move", "A typical earnings move for AAPL is around 4%.", S),
    ("flat bases", "Breakouts from flat bases succeed around half the time.", K),
    ("position size", "Keep each position under 10% of your portfolio.", K),
    ("extended from pivot", "A stock trading 3% above its pivot is still buyable.", K),
    ("RSI 2", "RSI(2) below 10 is a common mean-reversion trigger.", K),
    ("max stop", "Your stop should be no more than 8% below your buy point.", K),
    ("VIX", "The VIX above 30 usually signals fear.", K),
    ("ADR low", "A 2% daily ADR is low for a growth stock.", K),
    ("margin", "Margin requirements are often 25% of the position.", K),
]


#: true outcome figures the rules do not catch (a figure said in words) — each must STILL be missed; a fix flips it here
KNOWN_MISSES = ["About two thirds of IPOs trade below their offer price within a year."]


def test_known_misses_are_still_missed():
    for r in KNOWN_MISSES:
        assert not gf.ungrounded(r, set()), f"now caught — move it into CASES: {r}"


def _run(reply, known=frozenset()):
    return gf.ungrounded(reply, set(known))


@pytest.mark.parametrize("msg,reply,strip", CASES, ids=[c[0][:40] for c in CASES])
def test_each_case(msg, reply, strip):
    assert bool(_run(reply)) is strip, reply


def test_precision_and_recall(capsys):
    tp = sum(1 for _, r, s in CASES if s and _run(r))
    fp = sum(1 for _, r, s in CASES if not s and _run(r))
    fn = sum(1 for _, r, s in CASES if s and not _run(r))
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    print(f"\nSG-3 v2 family set: {len(CASES)} cases, precision {precision:.2f}, recall {recall:.2f} (tp {tp}, fp {fp}, fn {fn})")
    assert precision == 1.0 and recall == 1.0


def _env(reply):
    return {"disposition": "answer", "reply": reply, "question": None, "ops": []}


def test_the_guard_strips_only_the_figure_sentences_and_says_why():
    reply = "Breakouts can work well in strong markets. Roughly 60% of breakouts fail within a few weeks. Size small."
    out = gf.guard(_env(reply), context={}, history=[], research_read=False, coach_turn=False, answer_only=False)
    assert "60%" not in out["reply"] and "strong markets" in out["reply"] and "Size small." in out["reply"]
    assert out["reply"].endswith(gf.NOTE)
    only = gf.guard(_env("QQQ's historical return has been roughly 13% a year."), context={}, history=[],
                    research_read=False, coach_turn=False, answer_only=False)
    assert only["reply"] == gf.EMPTY


def test_a_figure_uct_gave_this_turn_is_grounded():
    reply = "NVDA is up 2.1% today."
    hist = [{"role": "outcome", "text": "NVDA $100.00, +2.1% vs the previous close (synthetic)", "data": {}}]
    out = gf.guard(_env(reply), context={}, history=hist, research_read=False, coach_turn=False, answer_only=False)
    assert out["reply"] == reply
    ctx = {"charts": [{"ref": "c1", "symbol": "NVDA", "changePct": 2.1}]}
    assert gf.guard(_env(reply), context=ctx, history=[], research_read=False, coach_turn=False, answer_only=False)["reply"] == reply
    # the model's OWN earlier reply is never a source
    hist2 = [{"role": "assistant", "text": "NVDA is up 2.1% today."}]
    assert gf.guard(_env(reply), context={}, history=hist2, research_read=False, coach_turn=False, answer_only=False)["reply"] != reply


@pytest.mark.parametrize("kw", [dict(research_read=True), dict(coach_turn=True), dict(answer_only=True)])
def test_research_coach_and_answer_only_turns_are_never_touched(kw):
    e = _env("Roughly 60% of breakouts fail within a few weeks.")
    base = dict(context={}, history=[], research_read=False, coach_turn=False, answer_only=False)
    assert gf.guard(e, **{**base, **kw}) == e


def test_the_members_own_data_and_plans_are_never_touched():
    e = _env("Your win rate on breakouts is 55% over 40 trades.")
    assert gf.guard(e, context={"coach": [{"ref": "coach"}]}, history=[], research_read=False, coach_turn=False, answer_only=False) == e
    plan = {"disposition": "apply", "reply": "", "ops": [{"action": "chart.setTimeframe", "target": "c1", "args": {}}]}
    assert gf.guard(plan, context={}, history=[], research_read=False, coach_turn=False, answer_only=False) == plan


# ── end to end through run_turn (scripted model, no network) ────────────────────────────────────────────────────────
from api.services.uct_agent import turn                                    # noqa: E402
from tests.test_uct_agent import CAPS, CTX, _resp, caller_of, env          # noqa: E402


@pytest.fixture
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


def test_the_live_shape_through_run_turn(_no_cost):
    invented = "After new 50-day highs SPY typically pulls back 2-3% within 5 to 10 sessions."
    out = turn.run_turn(message="how does SPY do after new 50-day highs", context=CTX, history=[], capabilities=CAPS,
                        caller=caller_of(_resp(env("answer", [], reply=invented))))["envelope"]
    assert out["reply"] == gf.EMPTY and "2-3%" not in out["reply"]
    plain = "A breakout is a move through resistance, ideally on volume at least 40% above average."
    out = turn.run_turn(message="how do breakouts usually work", context=CTX, history=[], capabilities=CAPS,
                        caller=caller_of(_resp(env("answer", [], reply=plain))))["envelope"]
    assert out["reply"] == plain
