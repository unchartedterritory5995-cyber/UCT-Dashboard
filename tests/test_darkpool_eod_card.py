"""Dark Pool EOD card — %ADV tier coloring + ★ record marker (layered onto the
existing market-cap sections, mirroring the intraday big-block card)."""
from api import darkpool_eod as eod


def test_adv_color_tiers():
    # ≥100% = Exceptional (red), 25–100% = Heavy (amber), <25% = neutral text.
    assert eod._adv_color(174) == eod._TIER_EXC
    assert eod._adv_color(100) == eod._TIER_EXC       # boundary is inclusive
    assert eod._adv_color(99.9) == eod._TIER_HVY
    assert eod._adv_color(25) == eod._TIER_HVY        # boundary is inclusive
    assert eod._adv_color(24.9) == eod._TXT
    assert eod._adv_color(0) == eod._TXT
    assert eod._adv_color(None) == eod._TXT           # missing %ADV never colors hot


def _row(t, n, pct, rec=False):
    return {"t": t, "n": n, "pctADV": pct, "zoneLo": 10.0, "zoneHi": 10.2,
            "last": 10.1, "perf": 1.0, "bigN": n, "bigPx": 10.1,
            "sector": "Technology", "isRecord": rec}


def test_render_card_accepts_record_and_tier_rows():
    # Smoke: a record row (★) + all three tiers render to a real PNG without error
    # (guards the star gutter / column geometry / footer legend against regressions).
    sections = [
        ("MEGA CAP  ·  ≥ $500B", [_row("NVDA", 1.2e9, 174, rec=True),
                                  _row("AAPL", 8.4e8, 31),
                                  _row("MSFT", 6.1e8, 12)]),
        ("ETFs & INDEX", [_row("VOO", 1.05e9, 19)]),
    ]
    summary = {"total_n": 3.0e9, "band_totals": {"Mega": 2.65e9, "ETF/Index": 1.05e9},
               "n_prints": 100, "n_tickers": 4}
    png = eod.render_card(sections, "August 20, 2026", summary)
    assert isinstance(png, (bytes, bytearray)) and png[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(png) > 1000
