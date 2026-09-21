"""THE MARKET INDICATOR REGISTRY — one catalogue, every canonical market series.

⭐⭐ WHY THIS IS A SECOND REGISTRY AND NOT ROWS IN `breadth_metrics`. The breadth
catalogue answers "what MEASUREMENT is this, over a population's constituents" and it is
consumed by the Breadth V2 combined pass: `breadth_metrics.applies_to` decides what that
pass writes. Adding rows there would change the running grind's output set, which this
project is explicitly forbidden from doing. That constraint happens to coincide with the
right boundary anyway — a breadth metric is MEASURED, a market indicator is DERIVED from
measurements or INGESTED from outside — so the two catalogues describe genuinely
different things and neither is a copy of the other.

⛔ WHAT IS *NOT* DUPLICATED: the vocabulary. Units, domains and presentation hints are
imported from `breadth_metrics` rather than redeclared, so a chart asking "how do I draw
this" gets one answer whatever catalogue the series came from.

⛔⛔ AND NOTHING HERE COMPUTES ANYTHING. This file says what a series IS. `producers.py`
says how to make it and `series.py` serves it. A registry that could also calculate is a
registry that will disagree with itself.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from api.services.breadth_metrics import (
    DOMAIN_NONNEG, DOMAIN_PCT, DOMAIN_RATIO, DOMAIN_SIGNED,
    PRES_HISTOGRAM, PRES_LINE,
    UNIT_COUNT, UNIT_INDEX, UNIT_PERCENT, UNIT_POINTS, UNIT_RATIO,
)
from api.services.market_indicators import naming

# ── Vocabulary ───────────────────────────────────────────────────────────────

#: HOW THE SERIES IS DRAWN when the source has one value per period and the value is a
#: LEVEL that stands until the next observation. Extends `breadth_metrics`' two.
PRES_STEP = "step"

#: WHERE THE NUMBERS COME FROM. The chart engine does not branch on this — there is one
#: charting architecture — but the CAPABILITY gates do: only a source type whose bars
#: are a genuine auction period may be drawn as candles.
SRC_SECURITY = "security"                 # an instrument or a published index with OHLC
SRC_BREADTH_DERIVED = "breadth_derived"   # computed from UCT's own canonical breadth
SRC_EXTERNAL = "external_indicator"       # an outside publisher's computed series
SRC_SURVEY = "survey"                     # a periodic poll: one scalar per period
SRC_VOLATILITY = "volatility"             # a Cboe volatility index, real daily OHLC

#: ⭐ THE ONLY SOURCE TYPES WHOSE BARS MEAN AN AUCTION PERIOD. An allow-list, so a
#: source type added next quarter is refused candles until somebody decides what its
#: open, high and low would MEAN. Mirrors `engine/ohlcCapability.js`'s posture exactly,
#: and the frontend reads this list rather than keeping its own copy.
OHLC_CAPABLE = frozenset({SRC_SECURITY, SRC_VOLATILITY})

#: HOW OFTEN THE SOURCE PRODUCES AN OBSERVATION. ⛔ This is NOT the display timeframe.
FREQ_DAILY = "daily"
FREQ_WEEKLY = "weekly"

#: DISCOVERY FAMILIES — the owner's four.
FAM_BREADTH = "breadth"
FAM_MCCLELLAN = "mcclellan"
FAM_SENTIMENT = "sentiment"
FAM_VOLATILITY = "volatility"

FAMILY_LABEL = {
    FAM_BREADTH: "Breadth",
    FAM_MCCLELLAN: "McClellan",
    FAM_SENTIMENT: "Sentiment & Positioning",
    FAM_VOLATILITY: "Volatility",
}
FAMILY_ORDER = [FAM_MCCLELLAN, FAM_BREADTH, FAM_SENTIMENT, FAM_VOLATILITY]

#: ⛔⛔ LIFECYCLE, AND `dormant` IS THE LOAD-BEARING ONE. A dormant row is fully
#: described — name, methodology, dependency — and is NOT servable and NOT discoverable.
#: That is how NYMO/NYSI/NAMO/NASI can be designed, reviewed and tested today and become
#: a DATA UNLOCK later rather than a second architecture project, without any chance of
#: a member reaching a series whose inputs do not exist.
ST_PUBLISHED = "published"
ST_DORMANT = "dormant"
ST_QUARANTINED = "quarantined"


@dataclass(frozen=True)
class Series:
    """One canonical market series, fully described.

    ⚠️ `display` and `short` are FUNCTIONS OF THE ROW where a rule applies (Rule 2's
    `Universe · Metric`), and literal strings only where an established name exists
    (Rule 1). `__post_init__` derives the former so a new universe cannot arrive with an
    inconsistent name.
    """
    id: str                                   # canonical internal identity
    family: str
    source_type: str
    frequency: str
    unit: str
    domain: str
    status: str = ST_PUBLISHED

    # naming
    symbol: Optional[str] = None              # what a member types; defaults to `id`
    display: Optional[str] = None             # derived from universe+metric when absent
    short: Optional[str] = None
    metric_name: Optional[str] = None         # the metric half of Rule 2
    metric_short: Optional[str] = None
    universe: Optional[str] = None            # breadth universe id, when applicable
    aliases: tuple = ()                       # extra strings that RESOLVE
    synonyms: tuple = ()                      # extra tokens that only SEARCH

    # presentation
    presentation: str = PRES_LINE
    centerline: Optional[float] = None        # the meaningful zero, if there is one
    reference_lines: tuple = ()               # guide levels worth drawing

    # provenance / semantics
    methodology: str = ""                     # human sentence
    methodology_version: str = ""
    history_start: Optional[str] = None       # earliest date this series can exist
    observation_semantics: str = ""           # what the date on a point MEANS
    knowledge_semantics: str = ""             # when that point became knowable
    provenance: str = ""                      # how it is produced, in one line
    source_owner: str = ""                    # who owns the underlying data
    licensing: str = ""                       # what we may do with it
    blocked_on: str = ""                      # why it is dormant, if it is
    reproduces_reference: bool = False        # Rule 1 precondition — an explicit claim
    #: ⛔⛔ PER-SERIES, NOT PER-FAMILY. Cboe publish VIX as DATE,OPEN,HIGH,LOW,CLOSE
    #: and VVIX/SKEW as DATE,<SYM> — one close and nothing else. Both are volatility
    #: indices; only one of them has bars that mean an auction period. A family-level
    #: capability would draw a tidy candlestick over a synthesised o=h=l=c whose body
    #: and range mean nothing, which a member cannot tell by looking.
    has_ohlc: bool = True

    def __post_init__(self):
        object.__setattr__(self, "symbol", (self.symbol or self.id).upper())
        if not self.display:
            if self.universe and self.metric_name:
                object.__setattr__(self, "display",
                                   naming.universe_metric_display(self.universe,
                                                                  self.metric_name))
            else:
                object.__setattr__(self, "display", self.metric_name or self.id)
        if not self.short:
            if self.universe and self.metric_short:
                object.__setattr__(self, "short",
                                   naming.universe_metric_short(self.universe,
                                                                self.metric_short))
            else:
                object.__setattr__(self, "short", self.metric_short or self.symbol)
        if self.family not in FAMILY_LABEL:
            raise ValueError(f"unknown family {self.family!r} for {self.id}")
        if self.source_type not in (SRC_SECURITY, SRC_BREADTH_DERIVED, SRC_EXTERNAL,
                                    SRC_SURVEY, SRC_VOLATILITY):
            raise ValueError(f"unknown source_type {self.source_type!r} for {self.id}")
        if self.status not in (ST_PUBLISHED, ST_DORMANT, ST_QUARANTINED):
            raise ValueError(f"unknown status {self.status!r} for {self.id}")
        if self.frequency not in (FREQ_DAILY, FREQ_WEEKLY):
            raise ValueError(f"unknown frequency {self.frequency!r} for {self.id}")

    @property
    def family_label(self) -> str:
        return FAMILY_LABEL[self.family]

    @property
    def ohlc_capable(self) -> bool:
        """BOTH gates: the source type's bars must mean an auction period AND this
        particular series must actually carry one."""
        return self.source_type in OHLC_CAPABLE and self.has_ohlc

    @property
    def tokens(self) -> tuple:
        """Everything a search may legitimately match."""
        return naming.search_tokens(
            self.id, self.symbol, self.display, self.short, self.metric_name,
            self.metric_short, self.aliases, self.synonyms, self.family_label,
            naming.universe_display(self.universe) if self.universe else None)

    def to_row(self) -> dict:
        return {
            "id": self.id, "symbol": self.symbol,
            "display": self.display, "short": self.short,
            "family": self.family, "family_label": self.family_label,
            "universe": self.universe,
            "universe_label": naming.universe_display(self.universe) if self.universe else None,
            "source_type": self.source_type, "frequency": self.frequency,
            "unit": self.unit, "domain": self.domain,
            "presentation": self.presentation,
            "centerline": self.centerline,
            "reference_lines": list(self.reference_lines),
            "ohlc_capable": self.ohlc_capable,
            "has_ohlc": self.has_ohlc,
            "status": self.status,
            "aliases": list(self.aliases),
            "methodology": self.methodology,
            "methodology_version": self.methodology_version,
            "history_start": self.history_start,
            "observation_semantics": self.observation_semantics,
            "knowledge_semantics": self.knowledge_semantics,
            "provenance": self.provenance,
            "source_owner": self.source_owner,
            "licensing": self.licensing,
            "blocked_on": self.blocked_on,
        }


# ── Shared prose, written once ───────────────────────────────────────────────

_MC_METHOD_RATIO = (
    "Ratio-adjusted net advances RANA = (A−D)/(A+D)×1000, excluding unchanged issues; "
    "10% Trend (EMA span 19, α=0.10) minus 5% Trend (EMA span 39, α=0.05). "
    "Verified to reproduce McClellan Financial's published series exactly (max |diff| "
    "0.000000000 over 179 sessions) when given their inputs."
)
_SAME_SESSION = "The date is the trading session the value was measured on."
_KNOWN_AT_CLOSE = "Known after that session's close; no publication lag."

_NOT_NYMO = (
    "⛔ NOT NYMO. Computed over UCT's US common-stock universe, which is a different "
    "census from the NYSE composite (all issues, incl. ETFs, closed-end funds, "
    "preferreds, rights and warrants) that NYMO is computed over."
)


# ── The catalogue ────────────────────────────────────────────────────────────

_ROWS: list[Series] = [

    # ── McClellan family ────────────────────────────────────────────────────
    Series(
        id="US:MCO", family=FAM_MCCLELLAN, source_type=SRC_BREADTH_DERIVED,
        frequency=FREQ_DAILY, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
        universe="us", metric_name="McClellan Oscillator", metric_short="McClellan",
        presentation=PRES_LINE, centerline=0.0, reference_lines=(-100.0, -50.0, 50.0, 100.0),
        synonyms=("MCCLELLAN", "MCCLELLAN OSCILLATOR", "RAMO", "OSCILLATOR",
                  "US MCCLELLAN", "BREADTH OSCILLATOR"),
        methodology=_MC_METHOD_RATIO + " " + _NOT_NYMO,
        methodology_version="mcclellan-v1/ratio_adjusted",
        history_start="2008-01-02",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Derived from breadth_daily_ohlc `advancing`/`declining` for universe "
                   "`us` (read-only). Recomputed from full history on every build.",
        source_owner="UCT", licensing="Own data.",
        reproduces_reference=False,
    ),
    Series(
        id="US:MCS", family=FAM_MCCLELLAN, source_type=SRC_BREADTH_DERIVED,
        frequency=FREQ_DAILY, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
        universe="us", metric_name="McClellan Summation Index", metric_short="Summation",
        presentation=PRES_LINE, centerline=0.0, reference_lines=(-500.0, 500.0),
        synonyms=("MCCLELLAN SUMMATION", "SUMMATION INDEX", "RASI", "SUMMATION",
                  "US SUMMATION"),
        methodology=_MC_METHOD_RATIO + " Cumulative sum of the oscillator, anchored at a "
                    "declared epoch and base (ratio-adjusted summation is neutral at "
                    "ZERO, unlike the classic +1000 convention). " + _NOT_NYMO,
        methodology_version="mcclellan-v1/ratio_adjusted",
        history_start="2008-01-02",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Cumulated from US:MCO in ONE forward pass over the whole history, "
                   "from an epoch 120 observations after the inputs begin so the level "
                   "is not an artifact of the EMA seed.",
        source_owner="UCT", licensing="Own data.",
        reproduces_reference=False,
    ),

    # ⛔⛔ DORMANT — registered so the design is reviewable and the dependency is
    # explicit, NOT servable and NOT discoverable. `published_rows()` excludes them and
    # `resolve()` refuses them, so no flag, no typo and no client cache can reach one.
    Series(
        id="NYSE:MCO", symbol="NYMO", family=FAM_MCCLELLAN,
        source_type=SRC_BREADTH_DERIVED, status=ST_DORMANT,
        frequency=FREQ_DAILY, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
        universe="nyse", display="NYSE McClellan Oscillator", short="NYMO",
        metric_name="McClellan Oscillator", metric_short="McClellan",
        aliases=("NYSE:MCO", "$NYMO"), synonyms=("NYSE MCCLELLAN", "MCCLELLAN"),
        presentation=PRES_LINE, centerline=0.0, reference_lines=(-100.0, -50.0, 50.0, 100.0),
        methodology=_MC_METHOD_RATIO,
        methodology_version="mcclellan-v1/ratio_adjusted",
        history_start="2011-01-01",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Will derive from breadth_daily_ohlc `advancing`/`declining` for "
                   "universe `nyse` once Breadth V2 populates it.",
        source_owner="UCT", licensing="Own data.",
        blocked_on="Breadth V2 has not populated the `nyse` universe (0 rows, "
                   "`not_populated`). Floor is 2011-01-01: pre-2011 exchange "
                   "attribution collapses and count metrics are unusable. Also requires "
                   "a passing golden matrix against a reference series before the "
                   "established name may be used.",
    ),
    Series(
        id="NYSE:MCS", symbol="NYSI", family=FAM_MCCLELLAN,
        source_type=SRC_BREADTH_DERIVED, status=ST_DORMANT,
        frequency=FREQ_DAILY, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
        universe="nyse", display="NYSE McClellan Summation Index", short="NYSI",
        metric_name="McClellan Summation Index", metric_short="Summation",
        aliases=("NYSE:MCS", "$NYSI"), synonyms=("NYSE SUMMATION", "MCCLELLAN SUMMATION"),
        presentation=PRES_LINE, centerline=0.0, reference_lines=(-500.0, 500.0),
        methodology=_MC_METHOD_RATIO + " Summation anchored to a published reference "
                    "value on a known date (McClellan Financial publish theirs daily), "
                    "which is what makes the LEVEL comparable rather than declared.",
        methodology_version="mcclellan-v1/ratio_adjusted",
        history_start="2011-01-01",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Cumulated from NYSE:MCO once it exists.",
        source_owner="UCT", licensing="Own data.",
        blocked_on="NYSE:MCO, plus a reference anchor decision.",
    ),
    Series(
        id="NASDAQ:MCO", symbol="NAMO", family=FAM_MCCLELLAN,
        source_type=SRC_BREADTH_DERIVED, status=ST_DORMANT,
        frequency=FREQ_DAILY, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
        universe="nasdaq", display="Nasdaq McClellan Oscillator", short="NAMO",
        metric_name="McClellan Oscillator", metric_short="McClellan",
        aliases=("NASDAQ:MCO", "$NAMO"), synonyms=("NASDAQ MCCLELLAN", "MCCLELLAN"),
        presentation=PRES_LINE, centerline=0.0, reference_lines=(-100.0, -50.0, 50.0, 100.0),
        methodology=_MC_METHOD_RATIO,
        methodology_version="mcclellan-v1/ratio_adjusted",
        history_start="2011-01-01",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Will derive from the `nasdaq` universe once Breadth V2 populates it.",
        source_owner="UCT", licensing="Own data.",
        blocked_on="Breadth V2 has not populated the `nasdaq` universe (0 rows). "
                   "Floor 2011-01-01. Requires a passing golden matrix.",
    ),
    Series(
        id="NASDAQ:MCS", symbol="NASI", family=FAM_MCCLELLAN,
        source_type=SRC_BREADTH_DERIVED, status=ST_DORMANT,
        frequency=FREQ_DAILY, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
        universe="nasdaq", display="Nasdaq McClellan Summation Index", short="NASI",
        metric_name="McClellan Summation Index", metric_short="Summation",
        aliases=("NASDAQ:MCS", "$NASI"), synonyms=("NASDAQ SUMMATION", "MCCLELLAN SUMMATION"),
        presentation=PRES_LINE, centerline=0.0, reference_lines=(-500.0, 500.0),
        methodology=_MC_METHOD_RATIO + " Anchored to a published reference value.",
        methodology_version="mcclellan-v1/ratio_adjusted",
        history_start="2011-01-01",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Cumulated from NASDAQ:MCO once it exists.",
        source_owner="UCT", licensing="Own data.",
        blocked_on="NASDAQ:MCO, plus a reference anchor decision.",
    ),
    Series(
        id="UCT:MCO", family=FAM_MCCLELLAN, source_type=SRC_BREADTH_DERIVED,
        status=ST_DORMANT,
        frequency=FREQ_DAILY, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
        universe="uct",
        # ⛔⛔ THE SUFFIX IS NOT DECORATION. `UCTMC` already ships as "UCT · McClellan
        # Oscillator" and is RAW (unadjusted) net advances; this row is the
        # ratio-adjusted one. Two different calculations under one member-facing name
        # is the exact confusion the naming rules exist to prevent, and the member
        # cannot tell them apart from the curve.
        metric_name="McClellan Oscillator (Ratio-Adjusted)",
        metric_short="McClellan RA",
        synonyms=("MCCLELLAN", "RATIO ADJUSTED", "RAMO"),
        presentation=PRES_LINE, centerline=0.0,
        methodology=_MC_METHOD_RATIO + " ⛔ NOT the same series as the shipped `UCTMC`, "
                    "which is RAW (unadjusted) net advances over the UCT universe.",
        methodology_version="mcclellan-v1/ratio_adjusted",
        history_start="2026-03-16",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Would derive from the collector's `advancing`/`declining`.",
        source_owner="UCT", licensing="Own data.",
        blocked_on="UCT `advancing`/`declining` only exist from 2026-03-16, so a "
                   "ratio-adjusted UCT oscillator would carry ~6 months of history "
                   "against the shipped UCTMC's 18 years. Shipping it needs a product "
                   "decision about what happens to UCTMC first.",
    ),

    # ── Breadth family ──────────────────────────────────────────────────────
    Series(
        id="US:AD", family=FAM_BREADTH, source_type=SRC_BREADTH_DERIVED,
        frequency=FREQ_DAILY, unit=UNIT_COUNT, domain=DOMAIN_SIGNED,
        universe="us", metric_name="Advance/Decline Line", metric_short="A/D Line",
        presentation=PRES_LINE,
        synonyms=("ADVANCE DECLINE", "AD LINE", "ADVANCE DECLINE LINE", "CUMULATIVE"),
        methodology="Running cumulative total of daily net advances (advances − "
                    "declines). The LEVEL is relative to a declared epoch: there is no "
                    "standard origin and every published A/D line differs in absolute "
                    "terms while agreeing in shape.",
        methodology_version="adline-v1",
        history_start="2008-01-02",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Cumulated from breadth_daily_ohlc `adv_decline` for universe `us` "
                   "in ONE forward pass, starting at 0 on the first session.",
        source_owner="UCT", licensing="Own data.",
    ),
    Series(
        id="US:ZBT", family=FAM_BREADTH, source_type=SRC_BREADTH_DERIVED,
        frequency=FREQ_DAILY, unit=UNIT_RATIO, domain=DOMAIN_RATIO,
        universe="us", metric_name="Zweig Breadth Thrust", metric_short="Zweig",
        presentation=PRES_LINE, reference_lines=(0.40, 0.615),
        synonyms=("ZWEIG", "BREADTH THRUST", "THRUST", "ZBT"),
        methodology="10-day EMA of advances / (advances + declines). Unchanged issues "
                    "are excluded from the denominator. The classic THRUST EVENT is a "
                    "move from below 0.40 to above 0.615 within 10 trading sessions — "
                    "that is a separate, rare signal and is NOT this series.",
        methodology_version="zweig-v1",
        history_start="2008-01-02",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Derived from breadth_daily_ohlc `advancing`/`declining` for `us`.",
        source_owner="UCT", licensing="Own data.",
    ),

    # ── Sentiment & Positioning ─────────────────────────────────────────────
    Series(
        id="SENT:NAAIM", symbol="NAAIM", family=FAM_SENTIMENT, source_type=SRC_SURVEY,
        frequency=FREQ_WEEKLY, unit=UNIT_PERCENT, domain=DOMAIN_SIGNED,
        display="NAAIM Exposure Index", short="NAAIM",
        metric_name="NAAIM Exposure Index", metric_short="NAAIM",
        aliases=("SENT:NAAIM",),
        synonyms=("NAAIM EXPOSURE", "EXPOSURE INDEX", "ACTIVE MANAGERS",
                  "MANAGER EXPOSURE", "POSITIONING"),
        presentation=PRES_STEP, centerline=0.0, reference_lines=(0.0, 100.0),
        methodology="The average US equity exposure reported weekly by NAAIM member "
                    "managers, as of each Wednesday's close. Scale runs −200 "
                    "(leveraged short) to +200 (leveraged long); 0 is cash/market "
                    "neutral and 100 is fully invested. ⛔ One scalar per week — no "
                    "OHLC, no interpolation, no manufactured daily observations.",
        methodology_version="naaim-v1",
        history_start=None,                    # answered at runtime by the store
        observation_semantics="The date is the WEDNESDAY the exposure was reported for.",
        knowledge_semantics="Published the following Thursday. `known_on` is stored "
                            "separately so a historical read can refuse to know a value "
                            "before it was public.",
        provenance="Canonical store `naaim_series.db`, appended by the Breadth "
                   "collector's accepted weekly value and seeded from NAAIM's own "
                   "public table. One series; the Breadth page and the chart read it.",
        source_owner="NAAIM (National Association of Active Investment Managers)",
        licensing="⚠️ POC ONLY. NAAIM publishes the free table 'for use in tracking "
                  "only' and requires express permission for commercial use. A "
                  "commercial UCT product needs the Program Partner tier "
                  "($1,500/yr), which grants API access and explicitly permits "
                  "incorporation and redistribution with attribution: "
                  "'Source: NAAIM Exposure Index® (National Association of Active "
                  "Investment Managers)'. The source seam is built so that swap "
                  "changes nothing above it.",
    ),

    # ── Volatility ──────────────────────────────────────────────────────────
    # Rule 1 throughout: these ARE the established indices, published by Cboe, and we
    # serve Cboe's own numbers rather than a calculation of our own. No UCT prefix.
]


def _vol(sym: str, name: str, start: str, *, synonyms=(), status=ST_PUBLISHED,
         blocked_on: str = "", has_ohlc: bool = True) -> Series:
    """One Cboe volatility index. A FUNCTION so the family cannot drift row to row."""
    return Series(
        id=f"CBOE:{sym}", symbol=sym, family=FAM_VOLATILITY,
        source_type=SRC_VOLATILITY, status=status,
        frequency=FREQ_DAILY, unit=UNIT_INDEX, domain=DOMAIN_NONNEG,
        display=name, short=sym,
        metric_name=name, metric_short=sym,
        aliases=(f"CBOE:{sym}", f"${sym}"),
        synonyms=naming.search_tokens("VOLATILITY", "CBOE", synonyms),
        presentation=PRES_LINE,
        methodology=f"Cboe's own published {sym} index level. UCT does not compute it.",
        methodology_version="cboe-eod-v1",
        history_start=start,
        observation_semantics=_SAME_SESSION,
        knowledge_semantics="End-of-day settlement value, published the same session.",
        provenance="Cboe public daily-price CSV "
                   f"(cdn.cboe.com/api/global/us_indices/daily_prices/{sym}_History.csv), "
                   "ingested into a local store by `tools/build_cboe_indices.py`. The "
                   "serve path never calls Cboe.",
        source_owner="Cboe Global Markets",
        licensing="⚠️ Published on Cboe's public site for site visitors and subject to "
                  "Cboe website terms. EOD historical values are widely redisplayed, "
                  "but commercial redisplay should be confirmed with Cboe. The "
                  "real-time Global Indices Feed is separately licensed and its "
                  "redistribution is prohibited — this path is EOD only.",
        blocked_on=blocked_on,
        reproduces_reference=True,
        has_ohlc=has_ohlc,
    )


_ROWS += [
    _vol("VIX9D", "Cboe S&P 500 9-Day Volatility Index", "2011-01-04",
         synonyms=("9 DAY", "SHORT TERM VOL", "NINE DAY")),
    # ⚠️ CLOSE-ONLY at source — Cboe publish VVIX as DATE,VVIX. Not candle-capable.
    _vol("VVIX", "Cboe VIX of VIX Index", "2006-03-06",
         synonyms=("VOL OF VOL", "VIX OF VIX"), has_ohlc=False),
    _vol("VIX3M", "Cboe S&P 500 3-Month Volatility Index", "2009-09-18",
         synonyms=("3 MONTH", "THREE MONTH", "TERM STRUCTURE")),
    _vol("VIX6M", "Cboe S&P 500 6-Month Volatility Index", "2008-01-02",
         synonyms=("6 MONTH", "SIX MONTH", "VXMT", "TERM STRUCTURE")),
    _vol("VXN", "Cboe Nasdaq-100 Volatility Index", "2009-09-14",
         synonyms=("NASDAQ VOLATILITY", "NASDAQ VIX")),
    _vol("RVX", "Cboe Russell 2000 Volatility Index", "2009-09-16",
         synonyms=("RUSSELL VOLATILITY", "SMALL CAP VIX")),
    # ⚠️ CLOSE-ONLY at source — Cboe publish SKEW as DATE,SKEW. Not candle-capable.
    _vol("SKEW", "Cboe SKEW Index", "1990-01-02",
         synonyms=("TAIL RISK", "BLACK SWAN"), has_ohlc=False),
    # ⛔ VIX ITSELF IS DORMANT IN THIS REGISTRY ON PURPOSE. `/api/bars/VIX` is a LIVE
    # path today (`api/index_bars.py`, yfinance, 5-year daily cap, unix-second `t`).
    # Registering it published would put two producers behind one symbol, which is the
    # "second authority over one value" defect this codebase keeps paying for. The swap
    # is a deliberate ramp with its own flag, not a side effect of adding a catalogue.
    _vol("VIX", "Cboe Volatility Index", "1990-01-02",
         synonyms=("FEAR INDEX", "VOLATILITY INDEX"),
         status=ST_DORMANT,
         blocked_on="`VIX` is already served by `api/index_bars.py` (yfinance, 5-year "
                    "daily cap, unix-second timestamps). Publishing it here would put a "
                    "second producer behind one symbol. The Cboe source reaches back to "
                    "1990-01-02 with real OHLC and correct ISO dates, so the swap is "
                    "worth doing — as an explicit, flagged migration of the existing "
                    "index path, not as a side effect of this catalogue."),
]


# ── Indexes ──────────────────────────────────────────────────────────────────

SERIES: dict[str, Series] = {}
_ALIAS_INDEX: dict[str, str] = {}

for _s in _ROWS:
    if _s.id.upper() in SERIES:
        raise ValueError(f"duplicate market-indicator id {_s.id}")
    SERIES[_s.id.upper()] = _s
for _s in _ROWS:
    for _k in naming.search_tokens(_s.id, _s.symbol, _s.aliases):
        prior = _ALIAS_INDEX.get(_k)
        if prior and prior != _s.id.upper():
            raise ValueError(
                f"alias collision: {_k!r} maps to both {prior} and {_s.id}")
        _ALIAS_INDEX[_k] = _s.id.upper()

SERIES_IDS = [s.id for s in _ROWS]


def get(series_id: str) -> Optional[Series]:
    """The row for a canonical id, whatever its status. Discovery must NOT use this."""
    if not series_id:
        return None
    return SERIES.get(str(series_id).strip().upper())


def resolve(token: str, include_dormant: bool = False) -> Optional[Series]:
    """THE membership authority: a symbol, id or alias → its Series, or None.

    ⛔⛔ A DICT LOOKUP OVER MINTED IDENTITIES, NEVER A SHAPE TEST. `US:MCO` is a market
    indicator because the registry contains it; `US:NOPE` and `FOO:BAR` have the
    identical shape and are not. This is the same rule `breadth_symbols` learned the
    hard way (BL-008) and it is repeated here rather than referenced because the
    failure mode — a colon promoting an arbitrary string to a chartable identity — is
    the same one.

    ⚠️ DORMANT ROWS ARE INVISIBLE BY DEFAULT. That is what keeps NYMO designed but
    unreachable: no flag, no cached client payload and no typo can serve one.
    """
    if not token:
        return None
    sid = _ALIAS_INDEX.get(str(token).strip().upper())
    if not sid:
        return None
    s = SERIES[sid]
    if s.status != ST_PUBLISHED and not include_dormant:
        return None
    return s


def is_market_indicator(token: str) -> bool:
    """True when this deploy will SERVE `token` as a market indicator."""
    return resolve(token) is not None


def published_rows() -> list[Series]:
    return [s for s in _ROWS if s.status == ST_PUBLISHED]


def dormant_rows() -> list[Series]:
    return [s for s in _ROWS if s.status == ST_DORMANT]


def rows_for_family(family: str, published_only: bool = True) -> list[Series]:
    src = published_rows() if published_only else _ROWS
    return [s for s in src if s.family == family]


def families(published_only: bool = True) -> list[dict]:
    src = published_rows() if published_only else _ROWS
    present = {s.family for s in src}
    return [{"id": f, "label": FAMILY_LABEL[f]}
            for f in FAMILY_ORDER if f in present]
