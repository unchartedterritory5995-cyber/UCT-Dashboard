"""Per-setup visual rubrics for the Opus vision judge + the focused setup list.

Each rubric is a structured checklist (essence + must_haves + disqualifiers) so the
judge benchmarks the chart against explicit criteria, not a vague sentence.
`rubric_for()` renders it into the prompt; `RUBRICS` stays structured for tuning.

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
    "vcp": "VCP (Volatility Contraction Pattern)", "flat_base": "Flat Base",
    "high_tight_flag": "High Tight Flag", "cup_handle_uct": "Cup with Handle",
    "bull_flag": "Bull Flag", "pullback_to_10ema": "Pullback to 10 EMA",
    "pullback_to_21ema": "Pullback to 21 EMA", "pullback_to_50sma": "Pullback to 50 SMA",
    "episodic_pivot": "Episodic Pivot", "power_earnings_gap": "Power Earnings Gap",
    "u_and_r": "Undercut & Rally", "remount": "Remount",
    "hammer": "Hammer", "bullish_engulfing": "Bullish Engulfing",
}

# essence: one-line definition. must_haves: every one should be visibly true to confirm.
# disqualifiers: any one visibly true → reject.
RUBRICS = {
    "vcp": {
        "essence": "A coil of progressively tighter pullbacks near the highs after a prior advance.",
        "must_haves": [
            "A clear prior uptrend into the base",
            "2+ pullbacks, each contraction shallower than the one before",
            "Volume drying up (declining) into the tightest contraction",
            "Price holding near the highs of the base, not the lows",
        ],
        "disqualifiers": [
            "Contractions widening instead of tightening",
            "A late deep selloff that breaks the base structure",
            "Heavy down-volume during the contractions",
            "Still in a clear downtrend (no prior advance)",
        ],
    },
    "flat_base": {
        "essence": "A shallow, roughly horizontal sideways consolidation after an advance.",
        "must_haves": [
            "A prior up-move into the base",
            "Sideways action with a roughly flat top (horizontal ceiling)",
            "Depth shallow (about 15% or less top-to-bottom)",
            "Several weeks of duration, orderly (no wild swings)",
        ],
        "disqualifiers": [
            "Deep correction (much more than ~15%)",
            "Clear downtrend within the base (lower highs AND lower lows)",
            "Only a few bars (too short to be a base)",
        ],
    },
    "high_tight_flag": {
        "essence": "A very strong fast advance, then a short shallow tight pause near the highs.",
        "must_haves": [
            "A powerful, fast prior run (roughly +80%+ in a few weeks)",
            "A short consolidation (about 3-5 weeks)",
            "Shallow pullback that stays high and tight",
            "Price holding near the run's highs",
        ],
        "disqualifiers": [
            "No explosive prior move (just a normal uptrend)",
            "Deep or sloppy pullback giving back most of the run",
            "Long, drawn-out base (not tight)",
        ],
    },
    "cup_handle_uct": {
        "essence": "A rounded U-base, then a short downward-drifting handle in the upper half.",
        "must_haves": [
            "A rounded, U-shaped base (gradual down then back up)",
            "A handle: a short drift lower AFTER the right side recovers",
            "The handle forms in the upper half of the cup",
            "Lighter volume in the handle",
        ],
        "disqualifiers": [
            "A sharp V-bottom instead of a rounded cup",
            "Handle in the lower half of the cup (too deep)",
            "No handle at all (just a cup)",
        ],
    },
    "bull_flag": {
        "essence": "A sharp pole up, then a short tight pullback that retraces only part of it.",
        "must_haves": [
            "A clear, steep pole (sharp advance)",
            "A short, orderly pullback drifting down or sideways",
            "Retraces only part of the pole (not most of it)",
            "Volume contracting during the flag",
        ],
        "disqualifiers": [
            "No identifiable pole",
            "Pullback gives back most/all of the pole",
            "Wide, choppy, high-volume pullback",
        ],
    },
    "pullback_to_10ema": {
        "essence": "An orderly pullback in an uptrend that holds the rising 10 EMA.",
        "must_haves": [
            "A clear uptrend with a rising 10 EMA",
            "Price pulls back TO the 10 EMA and holds it",
            "Orderly, low-volume pullback (not a breakdown)",
            "Starting to turn back up off the EMA",
        ],
        "disqualifiers": [
            "Price slicing well below the 10 EMA",
            "EMA flat or rolling over (no uptrend)",
            "Wide panic bars on the pullback",
        ],
    },
    "pullback_to_21ema": {
        "essence": "An orderly pullback in an uptrend that holds the rising 21 EMA.",
        "must_haves": [
            "A clear uptrend with a rising 21 EMA",
            "Price pulls back TO the 21 EMA and holds it",
            "Orderly, low-volume pullback",
            "Stabilizing / turning up off the EMA",
        ],
        "disqualifiers": [
            "Price decisively below the 21 EMA",
            "EMA flat or declining",
            "Climactic down-volume",
        ],
    },
    "pullback_to_50sma": {
        "essence": "A deeper-trend pullback that finds support at the rising 50 SMA.",
        "must_haves": [
            "An uptrend with a rising 50 SMA",
            "Price pulls back to the 50 SMA as support",
            "Stabilizing at/around the 50 SMA",
        ],
        "disqualifiers": [
            "Price closing well below the 50 SMA",
            "50 SMA flat or rolling over",
            "Accelerating breakdown through the line",
        ],
    },
    "episodic_pivot": {
        "essence": "A large gap-up out of a quiet base on a huge volume surge, starting a trend.",
        "must_haves": [
            "A quiet, sleepy base before the move",
            "A large gap-up (clear gap on the chart)",
            "A massive volume spike on the gap day",
            "Price holding the gap, not filling it",
        ],
        "disqualifiers": [
            "No real gap (just a strong up day)",
            "Volume not elevated",
            "The gap fully fills back in",
        ],
    },
    "power_earnings_gap": {
        "essence": "A strong post-earnings gap-up on huge volume that holds as support.",
        "must_haves": [
            "A clear gap-up (typically after earnings)",
            "Very high volume on the gap",
            "Price holding the gap / prior range as support afterward",
        ],
        "disqualifiers": [
            "Gap fills back into the prior range",
            "Volume unremarkable",
            "Immediate reversal back down through the gap",
        ],
    },
    "u_and_r": {
        "essence": "Price undercuts an obvious prior low (shakeout) then rallies back above it.",
        "must_haves": [
            "An obvious prior support level / swing low",
            "A brief undercut BELOW that level (the shakeout)",
            "A rally back ABOVE the level within a few bars",
        ],
        "disqualifiers": [
            "Price stays below the undercut level (no reclaim)",
            "No clear prior low to undercut",
            "A sustained breakdown, not a shakeout",
        ],
    },
    "remount": {
        "essence": "Price reclaims a key moving average / breakout level from below.",
        "must_haves": [
            "A key level or moving average that was lost",
            "Price pushing back up through and closing above it",
            "The reclaim looks decisive, not a marginal poke",
        ],
        "disqualifiers": [
            "Price still below the level (no reclaim)",
            "A weak marginal tag that fails immediately",
        ],
    },
    "hammer": {
        "essence": "A single capitulation bar with a long lower wick at a swing low.",
        "must_haves": [
            "Occurs after a decline / at a swing low",
            "A long lower wick (about 2x the body or more)",
            "A small body near the top of the bar",
            "Little or no upper wick",
        ],
        "disqualifiers": [
            "Long upper wick (not a hammer)",
            "Large body (not a small-bodied candle)",
            "Appears mid-uptrend, not after a decline",
        ],
    },
    "bullish_engulfing": {
        "essence": "A down bar followed by an up bar whose body fully engulfs it, at support.",
        "must_haves": [
            "A prior down (red) bar",
            "A following up (green) bar whose body fully engulfs the prior body",
            "Ideally at support after a pullback",
        ],
        "disqualifiers": [
            "The up bar does not fully engulf the prior body",
            "Appears extended at the top of a run (not at support)",
        ],
    },
}


def rubric_for(setup: str) -> str:
    """Render the structured rubric into prompt text the judge can grade against."""
    r = RUBRICS.get(setup)
    if not r:
        return "Judge whether this chart is a clean instance of the named setup."
    lines = [r["essence"], "", "MUST be visibly true to confirm:"]
    lines += [f"- {m}" for m in r["must_haves"]]
    lines += ["", "REJECT if any of these is visibly true:"]
    lines += [f"- {d}" for d in r["disqualifiers"]]
    return "\n".join(lines)


def criteria_for(setup: str) -> list[str]:
    """The must-have criteria the judge should check off, one by one."""
    r = RUBRICS.get(setup)
    return list(r["must_haves"]) if r else []
