"""The breadth UNIVERSE registry — one place that knows what a universe IS.

⭐⭐ THE WHOLE POINT OF THIS FILE IS THAT BREADTH IS `UNIVERSE × METRIC`, NOT A
COLLECTION OF UNRELATED SERIES. `pct_above_50sma` is one calculation; running it
over the UCT universe and over Nasdaq-listed common stock produces two series and
exactly one algorithm. So a universe has to be DATA — a venue set, a floor, a
source — rather than a branch inside a metric, and this module is where that data
lives. Nothing here computes breadth.

⛔ A UNIVERSE IS NEVER INFERRED FROM A TICKER. Not from a `UCT` prefix, not from a
symbol shape, not from a namespace string. `breadth_symbols.is_breadth_symbol`
already learned that lesson for pseudo-tickers (a membership test, never a prefix
test, so a real ticker like UCTT is untouched); this is the same rule one level
up. The universe id is carried explicitly, stored explicitly, and defaults to
`uct` so every row written before universes existed keeps meaning what it meant.

⛔⛔ THE FLOORS ARE THE PRODUCT DECISION, AND THEY ARE NOT ARBITRARY. See
`HISTORY_FLOOR` below — the reason NASDAQ and NYSE stop at 2011 is a measured
defect in the reference data we can buy, not a rendering preference, and a future
reader has to be able to find that out from here rather than from a commit
message.
"""
from __future__ import annotations

from typing import Optional

# ── Venue sets (MIC codes from the provider's `primary_exchange`) ────────────
#
# ⚠️ NASDAQ IS FOUR CODES, NOT ONE. `XNAS` is the composite; `XNGS` / `XNMS` /
# `XNCM` are the Global Select / Global Market / Capital Market tiers, and the
# provider uses them interchangeably across eras. A universe that matched only
# `XNAS` would silently drop a tier's worth of listings on the days the provider
# happened to report the tier.
NASDAQ_VENUES = frozenset({"XNAS", "XNGS", "XNMS", "XNCM"})
NYSE_VENUES = frozenset({"XNYS"})

# ⚠️ `ARCX` (NYSE Arca) and `BATS` sit in US but in NEITHER exchange universe.
# They are overwhelmingly ETF venues, and an ETF is already excluded by security
# type — but a handful of common stocks list there, and they belong in "US
# common stock" while belonging to neither "NYSE" nor "NASDAQ". US is therefore a
# superset of the two exchange universes, never their union.
US_VENUES = frozenset(
    NASDAQ_VENUES | NYSE_VENUES | {"XASE", "ARCX", "BATS", "IEXG"}
)

# ── Historical floors ────────────────────────────────────────────────────────
#
# ⛔⛔ WHY NASDAQ AND NYSE STOP AT 2011-01-01, AND WHY THAT IS NOT FIXABLE BY
# TRYING HARDER. Measured 2026-09-14 against the provider's own reference data
# (Breadth Library Phase 1 evidence gate):
#
#   • `/v3/reference/tickers/{t}?date=D` returns NO primary_exchange at all for
#     names that were unambiguously Nasdaq-listed (MSFT, INTC, AAPL, CSCO, AMGN)
#     at D = 2010-01-04 and D = 2010-07-01, and returns `XNAS` for all five from
#     D = 2011-01-03 onward. A sharp cliff, 0/5 → 5/5.
#   • Delisted CS/ADRC records carry a 0.0 % Nasdaq share for every year
#     2004-2010, 0.9-2.6 % for 2011-2015, then 26.8 % (2016) and 60-80 % after.
#     There were not zero Nasdaq delistings in 2008-09.
#   • A 210-name point-in-time sample of the 2008 universe returned ZERO Nasdaq
#     attributions — including in a control cohort the modern list calls 39 %
#     Nasdaq.
#
# The consequence is not "NASDAQ is missing names" but "NYSE silently ABSORBS
# them": an unattributed Nasdaq listing falls through to `XNYS`. So a pre-2011
# NYSE series would not be NYSE. Percentage metrics survive this (measured
# ≤ 0.8 pp on % above the 50-day MA); COUNT metrics do not (≈ +22 % NASDAQ,
# ≈ −12 % NYSE at 2008), and Net New High-Low is a count.
#
# ⛔ SO WE DO NOT PUBLISH ONE. No extrapolation, no proxy, no back-filled split
# to make the four universes share a start date. `sweepable_range()` below is the
# enforcement, and it REFUSES rather than clamps — a caller that asks for 2008
# NASDAQ has a bug, and silently handing back 2011 would hide it.
HISTORY_FLOOR = {
    "us": "2008-01-02",
    "nasdaq": "2011-01-01",
    "nyse": "2011-01-01",
}

# ── The registry ─────────────────────────────────────────────────────────────
#
# `source`:
#   'collector' — the universe the 4:15pm EOD collector measures and stores. UCT
#                 alone, and its history is NOT ours to regenerate (the existing
#                 ~2008 reconstruction stays exactly as published).
#   'pit'       — built per date from the survivorship-free grouped-daily frame
#                 plus point-in-time reference metadata.
_ROWS = [
    # (id, label, venues, source, floor)
    ("uct",    "UCT",    None,           "collector", None),
    ("us",     "US",     US_VENUES,      "pit",       HISTORY_FLOOR["us"]),
    ("nasdaq", "NASDAQ", NASDAQ_VENUES,  "pit",       HISTORY_FLOOR["nasdaq"]),
    ("nyse",   "NYSE",   NYSE_VENUES,    "pit",       HISTORY_FLOOR["nyse"]),
]

#: The universe every pre-universe row belongs to. Storage defaults to this, every
#: existing reader keeps seeing exactly what it saw, and no migration reinterprets
#: a single stored value.
DEFAULT_UNIVERSE = "uct"

UNIVERSES = {
    uid: {"id": uid, "label": label, "venues": venues, "source": source, "floor": floor}
    for (uid, label, venues, source, floor) in _ROWS
}

#: Ordered ids, for anything that enumerates (catalog projections, sweeps, tests).
UNIVERSE_IDS = [uid for (uid, _l, _v, _s, _f) in _ROWS]

#: The ones this project builds from the PIT frame. UCT is deliberately absent.
PIT_UNIVERSE_IDS = [uid for uid in UNIVERSE_IDS if UNIVERSES[uid]["source"] == "pit"]


def published_universe_ids() -> list[str]:
    """Universes whose symbols are SERVABLE — routed by `/api/bars`, offered by
    search. Defaults to UCT alone, so the library ships DARK.

    ⭐⭐ THE CATALOGUE AND THE PUBLISHED SET ARE DIFFERENT QUESTIONS, and keeping
    them separate is what lets the whole library be built, projected and tested
    without a single member-visible change. `breadth_symbols.library_rows()`
    always describes all four universes — that is discovery metadata. THIS decides
    which of them a member can actually reach.
    ⛔ So the gate is not "is the code deployed" but "does this universe have data
    and a decision behind it". Publishing one is an env flip against a registry
    that already exists, never a code change that has to be got right under time
    pressure.

    ⚠️ AN UNKNOWN ID IN THE FLAG IS DROPPED, NOT OBEYED. A typo'd
    `BREADTH_LIBRARY_UNIVERSES=nasdac` must not silently publish nothing AND must
    not raise on a hot import path; UCT is always included so the shipped 44
    symbols can never be turned off by a bad flag.
    """
    import os
    raw = os.environ.get("BREADTH_LIBRARY_UNIVERSES", "")
    want = {DEFAULT_UNIVERSE}
    for part in raw.split(","):
        p = part.strip().lower()
        if p == "*":
            return list(UNIVERSE_IDS)
        if p in UNIVERSES:
            want.add(p)
    return [u for u in UNIVERSE_IDS if u in want]


class UnknownUniverse(ValueError):
    """An id that is not in the registry. Never guessed, never defaulted."""


class BelowHistoryFloor(ValueError):
    """A sweep was asked for dates the data cannot honestly support."""


def normalize(universe: Optional[str]) -> str:
    """`None`/'' → the default universe; otherwise a trimmed lowercase id.

    ⚠️ It does NOT validate. `get()` does. Normalising and validating in one
    function would make every read path pay for a check it does not need, and
    would tempt a caller into `normalize(x) or 'uct'` — which is exactly how an
    unknown id becomes UCT data.
    """
    if universe is None:
        return DEFAULT_UNIVERSE
    u = str(universe).strip().lower()
    return u or DEFAULT_UNIVERSE


def get(universe: Optional[str]) -> dict:
    """The registry row. Raises `UnknownUniverse` — never falls back.

    ⛔ FAILING CLOSED IS THE WHOLE CONTRACT. A typo'd universe id that quietly
    resolved to UCT would write Nasdaq numbers into UCT's series, and nothing
    downstream could tell: the rows are the same shape and the same metric keys.
    """
    u = normalize(universe)
    row = UNIVERSES.get(u)
    if row is None:
        raise UnknownUniverse(
            f"unknown breadth universe {universe!r}; known: {', '.join(UNIVERSE_IDS)}")
    return row


def exists(universe: Optional[str]) -> bool:
    return normalize(universe) in UNIVERSES


def label(universe: Optional[str]) -> str:
    return get(universe)["label"]


def venues(universe: Optional[str]) -> Optional[frozenset]:
    """The allowed `primary_exchange` codes, or None when the universe does not
    select by venue (UCT, whose membership comes from the collector)."""
    return get(universe)["venues"]


def is_pit(universe: Optional[str]) -> bool:
    return get(universe)["source"] == "pit"


def floor(universe: Optional[str]) -> Optional[str]:
    """Earliest date this universe may be computed for; None = no policy floor
    (UCT, which this project does not recompute at all)."""
    return get(universe)["floor"]


def sweepable_range(universe: Optional[str], from_date: str,
                    to_date: Optional[str] = None) -> tuple[str, Optional[str]]:
    """Validate a sweep window against the universe's floor.

    ⛔⛔ IT RAISES RATHER THAN CLAMPING, and that asymmetry is deliberate. A
    backfill loop that walks DOWNWARD through history (`backfill_tick` does
    exactly that) would, against a clamping version, quietly stop making progress
    and look like it had finished. Against this one it stops with a reason. The
    one place clamping is right is the scheduler that *chooses* the next chunk —
    it should consult `floor()` and not ask for what it cannot have.
    """
    row = get(universe)
    f = row["floor"]
    if f and from_date < f:
        raise BelowHistoryFloor(
            f"{row['label']} breadth starts at {f}; refusing {from_date}. "
            "Pre-floor exchange attribution is not present in the reference data "
            "(see HISTORY_FLOOR in api/services/breadth_universes.py).")
    return from_date, to_date
