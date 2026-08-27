"""Top Flow card must not label a two-sided / presumption-driven by-contract
accumulation as a clean BULL/BEAR.

Regression for the SMR $11P 10/16/26 false-bear (2026-08-25). Its REAL by-contract
record (pulled live): sides {A:1, B:3, BB:1, none:7} → 5 clean of 12 prints (42%);
bull=$0.01M, bear=$0.73M → consistency 0.98. So a consistency-only gate would KEEP it
as a "clean bear" — only the clean-side-coverage gate catches that its direction is
the blank-sweep→ask presumption, not a read. _card_direction tags it "Neutral"; by
default it's dropped from the card (ALPHA_GOLD_EOD_SHOW_NEUTRAL=1 keeps it as a dim
"◆ 2-SIDED" row)."""
from api import alpha_gold_eod as age


def _c(ticker, cp, bull, bear, sides, score=5.0, prem=1_000_000):
    return {
        "ticker": ticker, "cp": cp, "strike": 11.0, "exp": "10/16/2026", "dte": 52,
        "spot": 9.8, "source": "stocks", "total_volume": 10_000, "total_premium": prem,
        "bull_premium": bull, "bear_premium": bear, "sides": sides,
        "accumulation_score": score, "moneynessLabel": "ITM", "moneynessPct": 11.0,
    }


# SMR's real live record (rounded): consistency ~0.98 but only 42% clean-sided.
_SMR = _c("SMR", "P", bull=10_000, bear=730_000,
          sides={"A": 1, "AA": 0, "B": 3, "BB": 1, "none": 7}, prem=1_770_000)


def _patch(monkeypatch, contracts):
    import api.live_massive_router as lmr
    monkeypatch.setattr(lmr, "_build_by_contract", lambda *a, **k: {"contracts": contracts})


def test_card_direction_smr_is_neutral_despite_high_consistency():
    # consistency 0.98 would pass a consistency-only gate; clean-frac 0.42 tags Neutral.
    assert age._card_direction(_SMR) == "Neutral"


def test_smr_dropped_by_default(monkeypatch):
    monkeypatch.setattr(age, "_SHOW_NEUTRAL", False)
    _patch(monkeypatch, [_SMR])
    assert age._get_bcontract_accumulations("8/25/2026") == []


def test_smr_kept_as_neutral_when_show_neutral(monkeypatch):
    monkeypatch.setattr(age, "_SHOW_NEUTRAL", True)
    _patch(monkeypatch, [_SMR])
    out = age._get_bcontract_accumulations("8/25/2026")
    assert len(out) == 1
    assert out[0]["_direction"] == "Neutral"
    assert age._dir(out[0]) == "neutral"       # renders "◆ 2-SIDED", never CP-fallback bear


def test_balanced_premium_is_neutral(monkeypatch):
    # good side coverage but ~50/50 sided premium → not directional.
    x = _c("XYZ", "P", bull=520_000, bear=480_000,
           sides={"A": 4, "AA": 0, "B": 5, "BB": 0, "none": 1})
    assert age._card_direction(x) == "Neutral"
    monkeypatch.setattr(age, "_SHOW_NEUTRAL", False)
    _patch(monkeypatch, [x])
    assert age._get_bcontract_accumulations("8/25/2026") == []


def test_mixed_but_dominant_labeled_by_side_not_cp(monkeypatch):
    # a PUT whose sided premium is 85% BULL (puts SOLD) → kept, labeled Bull —
    # NOT the CP fallback (put → bear).
    x = _c("XYZ", "P", bull=850_000, bear=150_000,
           sides={"A": 1, "AA": 0, "B": 8, "BB": 0, "none": 1})
    _patch(monkeypatch, [x])
    out = age._get_bcontract_accumulations("8/25/2026")
    assert len(out) == 1
    assert out[0]["_direction"] == "Bull"
    assert age._dir(out[0]) == "bull"


def test_clean_one_sided_bear_kept(monkeypatch):
    # clean ask-side put buy → Bear, kept (the legitimate directional case).
    x = _c("ABC", "P", bull=0, bear=900_000,
           sides={"A": 6, "AA": 0, "B": 0, "BB": 0, "none": 1})
    _patch(monkeypatch, [x])
    out = age._get_bcontract_accumulations("8/25/2026")
    assert len(out) == 1 and out[0]["_direction"] == "Bear"
