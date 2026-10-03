"""The dark switches of the options analytics surfaces: ONE per surface, read PER CALL.

⛔ Declared once, as a `*_FLAGS` table, so `api/services/feature_flag_index.py` derives every
gate from this dict (its table form) and `tests/test_feature_flag_ledger.py` demands a ledger
entry for each. The value is the code default: "" = OFF until something sets "1".
⛔ A surface is ON only for "1" / "true" / "yes" / "on". Anything else, including unset, is OFF.
"""
from __future__ import annotations

import os

OPTIONS_ANALYTICS_FLAGS = {
    "OPTIONS_MARKET_TIDE_ENABLED": "",
    "OPTIONS_GEX_HEATMAP_ENABLED": "",
    "OPTIONS_MAX_PAIN_ENABLED": "",
    "OPTIONS_NOPE_ENABLED": "",
    "OPTIONS_IMPACT_ENABLED": "",
    "OPTIONS_POSITIONING_VOCAB_ENABLED": "",
    "OPTIONS_DEALER_SHORT_ENABLED": "",
    "OPTIONS_IV_RANK_ENABLED": "",
    "OPTIONS_VOL_ENDPOINTS_ENABLED": "",
    "OPTIONS_MONITOR_ENABLED": "",
    "OPTIONS_STRADDLE_HISTORY_ENABLED": "",
    "OPTIONS_DAILY_MOVE_ENABLED": "",
    "OPTIONS_IV_CRUSH_ENABLED": "",
    "OPTIONS_PROBABILITY_ENABLED": "",
    "OPTIONS_PRICER_ENABLED": "",
    "OPTIONS_MULTI_LEG_ENABLED": "",
}

_TRUE = ("1", "true", "yes", "on")


def is_on(name: str) -> bool:
    """True when the named surface's switch is set. An unknown name is a programming error."""
    if name not in OPTIONS_ANALYTICS_FLAGS:
        raise KeyError(f"{name} is not an options analytics switch")
    return os.environ.get(name, OPTIONS_ANALYTICS_FLAGS[name]).strip().lower() in _TRUE
