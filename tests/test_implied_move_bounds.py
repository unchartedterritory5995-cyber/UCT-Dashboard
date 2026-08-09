"""The at-the-money bound, and the output bound behind it.

Every case in this file is a REAL production row, read from
/data/implied_moves.db on 2026-08-08 (`source='massive-chain'`, 776 rows;
`massive-backfill`, 545 more). The percentages, spots and strikes are the
stored values, not invented ones — so this file is a regression rail against
the exact numbers that reached a member, in both directions: the four
fabrications must refuse, and the three genuine straddles must survive
bit-for-bit.
"""
import ast
import inspect
from unittest.mock import patch

import pytest

from api.services import implied_move as im


def _one_strike_chain(spot, strike, call_quote, put_quote, exp="2026-08-07"):
    """A chain listing exactly ONE strike — the shape that produced the defect.
    On a sub-dollar or micro-cap name the coarsest listed strike ($0.50,
    $2.50) is the only candidate, so "nearest strike" returns it however far
    from spot it sits."""
    cb, ca = call_quote
    pb, pa = put_quote
    return {"ticker": "TST", "expiration": exp, "spot": spot,
            "calls": [{"strike": strike, "bid": cb, "ask": ca, "iv": 1.2, "expiration": exp}],
            "puts": [{"strike": strike, "bid": pb, "ask": pa, "iv": 1.2, "expiration": exp}],
            "source": "polygon (Massive Advanced)"}


# ── 1. The four production outliers. Each must REFUSE, naming its condition. ──
#
# The straddle is back-computed from the stored (pct, spot): pct * spot / 100.
#   MAPS   2150.0% x $0.35 = $7.525    strike $0.50   moneyness 0.43
#   SGMOQ  1675.0% x $0.10 = $1.675    strike $0.50   moneyness 4.00
#   NRDY   1373.5% x $0.85 = $11.675   strike $2.50   moneyness 1.94
#   CTSO    615.4% x $0.39 = $2.400    strike $2.50   moneyness 5.41
_PRODUCTION_OUTLIERS = [
    ("MAPS", 0.35, 0.50, 3.7625, 2150.0),
    ("SGMOQ", 0.10, 0.50, 0.8375, 1675.0),
    ("NRDY", 0.85, 2.50, 5.8375, 1373.5),
    ("CTSO", 0.39, 2.50, 1.2000, 615.4),
]


@pytest.mark.parametrize(
    "sym,spot,strike,leg_mid,shipped_pct", _PRODUCTION_OUTLIERS,
    ids=[o[0] for o in _PRODUCTION_OUTLIERS])
def test_production_outlier_refuses_naming_no_atm_strike(
        sym, spot, strike, leg_mid, shipped_pct):
    """The member-visible fabrication. There was no at-the-money strike — the
    coarsest listed strike is a MULTIPLE of spot — so there is no implied
    move. The refusal must NAME the condition, not merely return nothing."""
    chain = _one_strike_chain(spot, strike, (leg_mid, leg_mid), (leg_mid, leg_mid))

    # The fixture reproduces what production actually published, so this test
    # fails loudly if the fabrication ever comes back.
    unbounded_pct = (leg_mid + leg_mid) / spot * 100
    assert abs(unbounded_pct - shipped_pct) < 0.6, \
        "fixture must reproduce the percentage production actually published"

    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=chain):
        result = im.compute_expected_move_result(sym, "2026-08-06")
        payload = im.compute_expected_move(sym, "2026-08-06")

    assert result["ok"] is False
    assert result["reason"] == im.REFUSED_NO_ATM_STRIKE, \
        f"{sym}: the refusal must name which condition fired"
    assert result["kind"] == "refused", \
        f"{sym}: 'we could not price this' is not 'we did not try'"
    assert result["evidence"]["moneyness"] > im.MAX_ATM_MONEYNESS
    assert payload is None, \
        f"{sym}: refuse — never clamp, never substitute a neighbouring strike"


# ── 2. A DIFFERENT condition: a real ATM strike, an impossible percentage. ────

def test_production_outlier_pepg_refuses_as_implausible_move_not_as_no_atm_strike():
    """PEPG, 2026-08-06: spot $1.98, strike $2.00 — moneyness 1.01%, a genuine
    at-the-money strike — with a stored pct of 409.09% off an $8.10 straddle.

    This row is why the output bound is a separate concern and not just a
    stricter ATM bound: on the production data PEPG was the WORST surviving
    row at every ATM threshold from 2% to 30%. No tightening of the moneyness
    rule reaches it; only a bound on the answer does, and the record has to
    tell the two refusals apart."""
    chain = _one_strike_chain(1.98, 2.00, (4.05, 4.05), (4.05, 4.05))
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=chain):
        result = im.compute_expected_move_result("PEPG", "2026-08-06")

    assert result["ok"] is False
    assert result["reason"] == im.REFUSED_IMPLAUSIBLE_MOVE
    assert result["reason"] != im.REFUSED_NO_ATM_STRIKE, \
        "the two refusals must be tellable apart in the record"
    assert result["evidence"]["moneyness"] <= im.MAX_ATM_MONEYNESS, \
        "PEPG's strike IS at the money — no ATM bound could ever have caught it"
    assert abs(result["evidence"]["pct"] - 409.0909) < 0.01
    assert im.compute_expected_move("PEPG", "2026-08-06") is None


# ── 3. NON-VACUITY — the direction that matters more. ─────────────────────────
#
# Three genuine production rows, asserted UNCHANGED to the last bit. The
# bid/ask pairs are chosen so `_mid` reproduces the stored straddle exactly in
# IEEE-754, which makes `pct` bit-identical to the value in the database.
_GENUINE_PRODUCTION_ROWS = [
    # sym,  spot,   strike, call quote,    put quote,     stored pct
    ("TTWO", 232.94, 232.5, (8.95, 9.05), (8.20, 8.30), 7.405340431012278),
    ("PPL", 34.62, 35.0, (0.50, 0.55), (0.70, 0.80), 3.682842287694974),
    ("HE", 12.51, 12.5, (0.30, 0.325), (0.50, 0.525), 6.5947242206235),
]


@pytest.mark.parametrize(
    "sym,spot,strike,cq,pq,stored_pct", _GENUINE_PRODUCTION_ROWS,
    ids=[r[0] for r in _GENUINE_PRODUCTION_ROWS])
def test_a_genuine_atm_straddle_still_computes_unchanged(
        sym, spot, strike, cq, pq, stored_pct):
    """A bound that also silences good data is a worse defect than the one it
    fixes. These three were captured on 2026-08-06 alongside the fabrications
    and are exactly what this store is FOR, so they must survive bit-for-bit,
    not approximately."""
    chain = _one_strike_chain(spot, strike, cq, pq)
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=chain):
        payload = im.compute_expected_move(sym, "2026-08-07")

    assert payload is not None, f"{sym}: a real ATM straddle must still compute"
    assert payload["pct"] == stored_pct, (
        f"{sym}: expected the stored {stored_pct!r}, got {payload['pct']!r} — "
        "the bound must not perturb a value it accepts")
    assert im.refusal_for(payload["pct"], strike, spot) is None


def test_the_genuine_rows_clear_both_bounds_with_room_to_spare():
    """Documents the margin so a future tightening has to confront it: the
    three real rows sit at 0.08% / 1.10% / 0.08% moneyness against a 10%
    bound, and at 7.41% / 3.68% / 6.59% against a 60% output bound."""
    for sym, spot, strike, _cq, _pq, pct in _GENUINE_PRODUCTION_ROWS:
        moneyness = im.atm_moneyness(strike, spot)
        assert moneyness < im.MAX_ATM_MONEYNESS / 5, f"{sym}: moneyness {moneyness}"
        assert pct < im.MAX_MOVE_PCT / 5, f"{sym}: pct {pct}"


# ── 4. The sub-dollar decision, as a measurement rather than a taste. ─────────

def test_the_atm_bound_subsumes_a_spot_floor_rather_than_needing_one():
    """24 production rows had spot < $1. The 10% ATM bound already refuses 21
    of them. The 3 survivors are real at-the-money straddles on real
    sub-dollar names, so a separate spot floor would refuse exactly those and
    not one extra fabrication — which is why there is no second guard."""
    fabricated = [("SGMOQ", 0.10, 0.50), ("CTSO", 0.39, 2.50), ("SKYE", 0.59, 2.50),
                  ("REFR", 0.47, 2.50), ("VTGN", 0.29, 0.50), ("MERC", 0.68, 1.00)]
    for sym, spot, strike in fabricated:
        assert im.refusal_for(50.0, strike, spot) == im.REFUSED_NO_ATM_STRIKE, sym

    for sym, spot, strike, pct in [("AKBA", 0.99, 1.00, 30.30),
                                   ("ATYR", 0.52, 0.50, 28.85),
                                   ("BLNK", 0.54, 0.50, 27.78)]:
        assert im.refusal_for(pct, strike, spot) is None, \
            f"{sym} is a genuine sub-dollar ATM straddle and must survive"


# ── 5. "Could not price it" vs "did not get to try". ─────────────────────────

def test_a_refusal_is_distinguishable_from_a_missing_fetch():
    far = _one_strike_chain(0.35, 0.50, (3.7625, 3.7625), (3.7625, 3.7625))
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=far):
        refused = im.compute_expected_move_result("MAPS", "2026-08-06")
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain",
                      return_value={"error": "no chain data"}):
        unavailable = im.compute_expected_move_result("MAPS", "2026-08-06")
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": []}):
        no_expiry = im.compute_expected_move_result("MAPS", "2026-08-06")

    assert refused["kind"] == "refused" and refused["reason"] == im.REFUSED_NO_ATM_STRIKE
    assert unavailable["kind"] == "unavailable"
    assert unavailable["reason"] == im.UNAVAILABLE_NO_CHAIN
    assert no_expiry["kind"] == "unavailable"
    assert no_expiry["reason"] == im.UNAVAILABLE_NO_EXPIRY
    assert refused["kind"] != unavailable["kind"], \
        "a bound that fired and a provider that never answered are different facts"
    assert im.outcome_kind(None) == "ok"
    assert im.outcome_kind("something_nobody_declared") == "unavailable", \
        "an unnameable outcome must never be reported as a REFUSAL"


def test_get_expected_move_surfaces_the_refusal_reason_through_the_cache():
    """The out-dict idiom (the same one breadth's drill `members` uses): the
    reason comes from the SAME build that withheld the payload, never from a
    second evaluation that could disagree with it."""
    key = "expmove::MAPS::2026-08-06"
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget(key)
    chain = _one_strike_chain(0.35, 0.50, (3.7625, 3.7625), (3.7625, 3.7625))
    outcome = {}
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=chain):
        payload = im.get_expected_move("MAPS", "2026-08-06", outcome=outcome)
    assert payload is None
    assert outcome["reason"] == im.REFUSED_NO_ATM_STRIKE
    assert outcome["kind"] == "refused"

    key2 = "expmove::TTWO::2026-08-07"
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget(key2)
    good = _one_strike_chain(232.94, 232.5, (8.95, 9.05), (8.20, 8.30))
    ok_outcome = {}
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=good):
        payload = im.get_expected_move("TTWO", "2026-08-07", outcome=ok_outcome)
    assert payload is not None and ok_outcome == {"ok": True}
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget(key2)


# ── 6. Structure: one bound, one place — checked with an AST, not a grep. ────

def test_each_bound_is_read_in_exactly_one_place():
    """`refusal_for` is the single decision point the live path, the
    historical backfill and the stored-row purge all route through. A second
    read of either constant is a second copy of the rule, and the day one of
    them moves the two disagree silently — precisely the failure mode that let
    a 2150% number reach a member."""
    tree = ast.parse(inspect.getsource(im))
    owner = {}
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        for node in ast.walk(fn):
            if (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
                    and node.id in ("MAX_ATM_MONEYNESS", "MAX_MOVE_PCT")):
                owner.setdefault(node.id, []).append(fn.name)
    assert owner.get("MAX_ATM_MONEYNESS") == ["refusal_for"], owner
    assert owner.get("MAX_MOVE_PCT") == ["refusal_for"], owner


def test_the_backfill_inherits_the_bound_through_straddle_from_rows():
    """implied_backfill imports `straddle_from_rows`, so the bound has to live
    beneath it — otherwise a backfilled quarter and a live capture fork, and
    the RICH/CHEAP verdict compares them to each other, so a fork reads as
    edge rather than as an obvious bug."""
    src = ast.parse(inspect.getsource(im.straddle_from_rows))
    called = {n.func.id for n in ast.walk(src)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "evaluate_straddle" in called, \
        "straddle_from_rows must go through the one evaluator, not its own copy"
    calls = [{"strike": 0.50, "bid": 3.7625, "ask": 3.7625}]
    puts = [{"strike": 0.50, "bid": 3.7625, "ask": 3.7625}]
    assert im.straddle_from_rows(calls, puts, 0.35) is None, \
        "the backfill's entry point must refuse the same rows the live path does"
