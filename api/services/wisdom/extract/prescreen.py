"""R102 (owner ruling, 2026-09-18, session 27) — the $0 pre-extraction filter.

Most of the corpus cannot construct a floored-type record at all, and golden-v1.1 already built
the lexical screens that say so (`docs/wisdom/methodology/golden-v1.1.md` §4,
`tools/wisdom/null_screens.py`). Applying them to a segment BEFORE it reaches the model costs
nothing and, on a corpus where a large share is narration, can drop a large share of requests the
floor would otherwise have paid to extract and then discarded.

⛔⛔ NOT ENABLED. `WISDOM_EXTRACT_PRESCREEN_ENABLED` defaults OFF. R102's own ruling is
`MEASURE`, not `ENABLE` — this ships built and tested so the measured recall-loss bound (Step B3,
`docs/wisdom/COST-REDUCED-PRICING-2026-09-18.md`) can be weighed before anyone decides whether the
screen is tight enough to trust with real coverage. Flipping this on without that number in hand
is exactly the guess this whole programme has refused to make since R17.

⭐ The predicate is UNCHANGED from what golden-v1.1 already trusts to decide a NULL row's claim —
`tools.wisdom.null_screens.any_screen_fires`. A production segment where every screen comes back
empty has never been observed, in the golden set, to be the reason a floored-type record was
missed; that observation is exactly what Step B3 measures before this is trusted with real
coverage.
"""
from __future__ import annotations

import os

#: A VALUE the operator opts INTO, not a value quantity — unlike `daily_segment_limit` or
#: `daily_budget_usd`, an unset prescreen must mean OFF (every segment is a candidate), because
#: turning coverage-affecting filtering on by default the day this file lands would be the
#: opposite of "nothing arms until the table is priced."
PRESCREEN_ENV = "WISDOM_EXTRACT_PRESCREEN_ENABLED"


def prescreen_enabled() -> bool:
    return (os.environ.get(PRESCREEN_ENV) or "").strip() == "1"


def is_candidate(text: str) -> bool:
    """True unless the segment's text can be mechanically ruled out. Only meaningful to call
    when `prescreen_enabled()` — callers must still check that themselves; this function makes no
    assumption about being gated."""
    from tools.wisdom.null_screens import any_screen_fires

    return any_screen_fires(text or "")
