"""Per-setup visual rubrics for the Opus vision judge + the focused setup list.

FOCUSED_SETUPS are the exact pattern_engine detector ids we judge (the user's
swing playbook). The long tail of 88 detectors is intentionally out of scope.
"""
FOCUSED_SETUPS = [
    "vcp", "flat_base", "high_tight_flag", "cup_handle_uct", "bull_flag",
    "pullback_to_10ema", "pullback_to_21ema", "pullback_to_50sma",
    "episodic_pivot", "power_earnings_gap", "u_and_r", "remount",
    "hammer", "bullish_engulfing",
]

SETUP_LABEL = {
    "vcp": "VCP", "flat_base": "Flat Base", "high_tight_flag": "High Tight Flag",
    "cup_handle_uct": "Cup with Handle", "bull_flag": "Bull Flag",
    "pullback_to_10ema": "Pullback to 10 EMA", "pullback_to_21ema": "Pullback to 21 EMA",
    "pullback_to_50sma": "Pullback to 50 SMA", "episodic_pivot": "Episodic Pivot",
    "power_earnings_gap": "Power Earnings Gap", "u_and_r": "Undercut & Rally",
    "remount": "Remount", "hammer": "Hammer", "bullish_engulfing": "Bullish Engulfing",
}

RUBRICS = {
    "vcp": "A VCP shows a prior uptrend, then a series of progressively tighter pullbacks "
           "(each contraction shallower than the last) on declining volume, coiling near the highs.",
    "flat_base": "A flat base is a shallow (<~15%) sideways consolidation lasting several weeks "
                 "after a prior advance, with the highs forming a roughly horizontal ceiling.",
    "high_tight_flag": "A high tight flag is a very strong, fast prior advance (often ~80%+ in weeks) "
                       "followed by a short, shallow, tight consolidation near the highs.",
    "cup_handle_uct": "A cup-with-handle shows a rounded U-shaped base, then a short downward-drifting "
                      "handle in the upper half of the cup on lighter volume.",
    "bull_flag": "A bull flag is a sharp upward pole, then a short tight parallel consolidation drifting "
                 "down/sideways (retracing only part of the pole) on contracting volume.",
    "pullback_to_10ema": "An orderly pullback in an uptrend where price pulls back to and holds the rising "
                         "10 EMA, then begins to turn up.",
    "pullback_to_21ema": "An orderly pullback in an uptrend where price pulls back to and holds the rising "
                         "21 EMA, then begins to turn up.",
    "pullback_to_50sma": "A pullback in an uptrend where price pulls back to the rising 50 SMA as support "
                         "and stabilizes there.",
    "episodic_pivot": "An episodic pivot is a large gap-up out of a quiet base on a huge volume surge, "
                      "starting a new trend.",
    "power_earnings_gap": "A power earnings gap is a strong gap-up after earnings on very high volume, "
                          "holding the gap and the prior range as support.",
    "u_and_r": "An undercut-and-rally undercuts a prior obvious support/low (shaking out holders) then "
               "rallies back above it within a few bars.",
    "remount": "A remount reclaims a key moving average or breakout level from below after briefly losing it.",
    "hammer": "A hammer is a single bar at a swing low / after a decline with a long lower wick (>=2x the body), "
              "a small body near the top, and little upper wick.",
    "bullish_engulfing": "A bullish engulfing is a down bar followed by an up bar whose body fully engulfs the "
                         "prior bar's body, ideally at support after a pullback.",
}


def rubric_for(setup: str) -> str:
    return RUBRICS.get(setup, "Judge whether this chart is a clean instance of the named setup.")
