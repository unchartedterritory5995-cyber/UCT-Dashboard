"""Alpha Gold EOD summary — pure-helper + render smoke tests (2026-07-31).
The Discord post + flow.db pull need the live worker; these cover the ETF split,
the (ticker, direction) rollup, formatting, and that the Pillow card renders to
valid PNG bytes."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import alpha_gold_eod as age


def _a(**over):
    a = {"ticker": "INTC", "cp": "C", "strike": 90, "exp": "8/21/2026",
         "spot": 91.48, "alertPremium": 6_580_000, "volumeOIRatio": 1.3,
         "moneynessLabel": "ITM", "moneynessPct": 1.6, "_type": "SWEEP",
         "_direction": "Bull", "timestamp": 0, "source": "stocks"}
    a.update(over)
    return a


def test_is_etf():
    assert age._is_etf(_a(source="indexes")) is True     # SOXL/SMH/EWY etc.
    assert age._is_etf(_a(source="stocks")) is False
    assert age._is_etf(_a(source=None)) is False          # missing → treat as stock


def test_dir_from_direction_then_cp():
    assert age._dir(_a(_direction="Bull")) == "bull"
    assert age._dir(_a(_direction="bear")) == "bear"      # case-insensitive
    assert age._dir(_a(_direction=None, cp="C")) == "bull"    # fallback to cp
    assert age._dir(_a(_direction="", cp="P")) == "bear"


def test_money_and_voi():
    assert age._money(_a(moneynessLabel="ATM", moneynessPct=0.1)) == "ATM"
    assert age._money(_a(moneynessLabel="OTM", moneynessPct=-5.1)) == "5.1% OTM"
    assert age._money(_a(moneynessLabel="OTM", moneynessPct=None)) == "OTM"
    assert age._voi(_a(volumeOIRatio=1.3)) == "1.3x"
    assert age._voi(_a(volumeOIRatio=56.2)) == "56x"      # >=10 drops decimals
    assert age._voi(_a(volumeOIRatio=None)) == "—"


def test_fmt_prem():
    assert age._fmt_prem(6_580_000) == "$6.58M"
    assert age._fmt_prem(12_000_000) == "$12.0M"      # >=10M drops a decimal
    assert age._fmt_prem(1_500_000_000) == "$1.50B"
    assert age._fmt_prem(None) == "$0.00M"


def test_counts_with_premium():
    alerts = [_a(_direction="Bull", alertPremium=6_000_000),
              _a(_direction="Bear", cp="P", alertPremium=2_000_000),
              _a(_direction="Bull", alertPremium=1_000_000)]
    c = age._counts(alerts)
    assert c["n"] == 3 and c["nb"] == 2 and c["nr"] == 1
    assert round(c["total"], 2) == 9.0
    assert round(c["net"], 2) == 5.0                  # 7M bull - 2M bear


def test_rollup_dedups_and_counts():
    # COHR ×3 (all bear) → one row with _n=3; input is premium-desc so the
    # biggest (first) is the representative.
    alerts = [_a(ticker="COHR", cp="P", _direction="Bear", strike=240),
              _a(ticker="COHR", cp="P", _direction="Bear", strike=250),
              _a(ticker="COHR", cp="P", _direction="Bear", strike=260)]
    rows = age._rollup(alerts)
    assert len(rows) == 1
    assert rows[0]["_n"] == 3
    assert rows[0]["strike"] == 240          # representative = first (biggest)


def test_rollup_mixed_direction_is_two_rows():
    # LRCX bull (call) + LRCX bear (puts) → TWO rows, one per direction.
    alerts = [_a(ticker="LRCX", cp="C", _direction="Bull"),
              _a(ticker="LRCX", cp="P", _direction="Bear"),
              _a(ticker="LRCX", cp="P", _direction="Bear")]
    rows = age._rollup(alerts)
    assert len(rows) == 2
    by_dir = {age._dir(r): r["_n"] for r in rows}
    assert by_dir == {"bull": 1, "bear": 2}


def test_summary_line_has_premium_and_counts():
    line = age._summary_line([_a(source="stocks", alertPremium=6_580_000),
                              _a(source="indexes", cp="P", _direction="Bear",
                                 alertPremium=1_000_000)],
                             "July 31, 2026")
    assert "Alpha Gold" in line
    assert "2 prints" in line
    assert "$" in line                        # premium is back
    assert "1 stocks / 1 ETFs" in line


def test_render_card_returns_png():
    png = age.render_card([_a(), _a(ticker="EWY", cp="P", _direction="Bear",
                                    source="indexes", volumeOIRatio=None)],
                          "July 31, 2026", top_n=30)
    assert isinstance(png, bytes) and len(png) > 1000
    assert png[:8] == b"\x89PNG\r\n\x1a\n"    # PNG magic


def test_render_card_empty_day_ok():
    png = age.render_card([], "July 31, 2026", top_n=30)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"    # renders a valid (empty) card
