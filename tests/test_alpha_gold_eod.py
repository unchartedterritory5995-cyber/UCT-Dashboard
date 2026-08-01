"""Alpha Gold EOD summary — pure-helper + render smoke tests (2026-07-31).
The Discord post + flow.db pull need the live worker; these cover the formatting,
totals, and that the Pillow card renders to valid PNG bytes."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import alpha_gold_eod as age


def _a(**over):
    a = {"ticker": "INTC", "cp": "C", "strike": 90, "exp": "8/21/2026",
         "spot": 91.48, "alertPremium": 6_580_000, "volumeOIRatio": 1.3,
         "moneynessLabel": "ITM", "moneynessPct": 1.6, "_type": "SWEEP",
         "_direction": "Bull", "timestamp": 0}
    a.update(over)
    return a


def test_fmt_prem():
    assert age._fmt_prem(6_580_000) == "$6.58M"
    assert age._fmt_prem(1_050_000) == "$1.05M"
    assert age._fmt_prem(12_000_000) == "$12.0M"      # >=10M drops a decimal
    assert age._fmt_prem(1_500_000_000) == "$1.50B"
    assert age._fmt_prem(None) == "$0.00M"


def test_dir_from_direction_then_cp():
    assert age._dir(_a(_direction="Bull")) == "bull"
    assert age._dir(_a(_direction="bear")) == "bear"     # case-insensitive
    assert age._dir(_a(_direction=None, cp="C")) == "bull"   # fallback to cp
    assert age._dir(_a(_direction="", cp="P")) == "bear"


def test_money_label():
    assert age._money(_a(moneynessLabel="ATM", moneynessPct=0.1)) == "ATM"
    assert age._money(_a(moneynessLabel="OTM", moneynessPct=-5.1)) == "5.1% OTM"
    assert age._money(_a(moneynessLabel="ITM", moneynessPct=1.6)) == "1.6% ITM"
    assert age._money(_a(moneynessLabel="OTM", moneynessPct=None)) == "OTM"


def test_voi():
    assert age._voi(_a(volumeOIRatio=1.3)) == "1.3x"
    assert age._voi(_a(volumeOIRatio=56.2)) == "56x"     # >=10 drops decimals
    assert age._voi(_a(volumeOIRatio=None)) == "—"


def test_totals_and_net():
    alerts = [_a(_direction="Bull", alertPremium=6_000_000),
              _a(_direction="Bear", alertPremium=2_000_000, cp="P"),
              _a(_direction="Bull", alertPremium=1_000_000)]
    t = age._totals(alerts)
    assert t["n"] == 3
    assert t["nb"] == 2 and t["nr"] == 1
    assert round(t["total"], 2) == 9.0
    assert round(t["net"], 2) == 5.0            # 7M bull - 2M bear


def test_summary_line_has_key_facts():
    line = age._summary_line([_a(alertPremium=6_580_000)], "July 31, 2026")
    assert "Alpha Gold" in line
    assert "1 alerts" in line
    assert "INTC" in line                        # top name


def test_render_card_returns_png():
    png = age.render_card([_a(), _a(ticker="MU", cp="P", _direction="Bear",
                                    alertPremium=1_050_000, volumeOIRatio=None)],
                          "July 31, 2026", top_n=30)
    assert isinstance(png, bytes) and len(png) > 1000
    assert png[:8] == b"\x89PNG\r\n\x1a\n"       # PNG magic


def test_render_card_empty_day_ok():
    png = age.render_card([], "July 31, 2026", top_n=30)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"       # renders a valid (empty) card
