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

from dataclasses import dataclass, field, replace
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
SRC_COT = "cot"                           # a CFTC Commitments of Traders net position

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
FAM_POSITIONING = "positioning"

FAMILY_LABEL = {
    FAM_BREADTH: "Breadth",
    FAM_MCCLELLAN: "McClellan",
    FAM_SENTIMENT: "Sentiment & Positioning",
    FAM_VOLATILITY: "Volatility",
    FAM_POSITIONING: "Positioning",
}
FAMILY_ORDER = [FAM_MCCLELLAN, FAM_BREADTH, FAM_SENTIMENT, FAM_VOLATILITY, FAM_POSITIONING]

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
    #: ⭐ the ticker a member READS when it differs from `symbol` (NYMO for NYSE:MCO). Shown, never
    #: submitted — see `_exchange_row` for why the submitted symbol keeps its colon.
    display_symbol: Optional[str] = None
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
    #: ⛔⛔ THE SUMMATION'S ABSOLUTE LEVEL, PINNED AS DATA RATHER THAN DERIVED.
    #: A cumulative series' level is entirely determined by where it started. Deriving
    #: the epoch as "the first session 120 observations in" is deterministic for a
    #: FIXED dataset and NOT deterministic across one that grows backwards: a backfill
    #: that adds 2007 sessions moves the epoch and silently re-levels every historical
    #: value. Pinning it means the level survives the data changing underneath it, and
    #: means a reviewer can see what the number is relative to without running anything.
    #:
    #: ⚠️ A PINNED EPOCH THAT IS NOT IN THE DATA IS A REFUSAL, NOT A FALLBACK. Quietly
    #: re-deriving would reintroduce exactly the drift this exists to prevent.
    summation_epoch: Optional[str] = None     # 'YYYY-MM-DD' — where the level is fixed
    summation_base: Optional[float] = None    # the value it takes there
    summation_anchor_source: str = ""         # 'declared' | 'reference:<publisher>'
    #: ⛔⛔ PER-SERIES, NOT PER-FAMILY. Cboe publish VIX as DATE,OPEN,HIGH,LOW,CLOSE
    #: and VVIX/SKEW as DATE,<SYM> — one close and nothing else. Both are volatility
    #: indices; only one of them has bars that mean an auction period. A family-level
    #: capability would draw a tidy candlestick over a synthesised o=h=l=c whose body
    #: and range mean nothing, which a member cannot tell by looking.
    has_ohlc: bool = True
    #: ⛔⛔ WHICH OBSERVATION STREAM A SURVEY READS, DECLARED RATHER THAN DISPATCHED ON
    #: THE ID. `series.daily_bars` used to answer `SRC_SURVEY` by calling `naaim_store`
    #: outright, which was correct while NAAIM was the only survey and becomes a silent
    #: wrong answer the moment a second one exists: AAII would have been served NAAIM's
    #: numbers under AAII's name. Naming the stream here keeps ONE survey branch that
    #: reads what the row says, so adding a third survey is a row and not a branch.
    #:
    #: ⚠️ REQUIRED FOR `SRC_SURVEY` AND FORBIDDEN OTHERWISE — `__post_init__` enforces
    #: both, because a survey with no stream serves silence and a non-survey with one
    #: is a claim nothing reads.
    survey_key: Optional[str] = None
    #: ⛔⛔ WHICH COT MARKET AND WHICH NET-POSITION COLUMN THIS ROW READS —
    #: `"<cot symbol>:<cot_records column>"`, e.g. `"NQ:commercial_net"`. The same
    #: discipline as `survey_key`: the row names its stream, `series.py` reads exactly
    #: that from `cot_service` (the ONE COT store), and a row that names nothing serves
    #: nothing. REQUIRED for `SRC_COT`, FORBIDDEN otherwise.
    cot_stream: Optional[str] = None

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
                                    SRC_SURVEY, SRC_VOLATILITY, SRC_COT):
            raise ValueError(f"unknown source_type {self.source_type!r} for {self.id}")
        if self.status not in (ST_PUBLISHED, ST_DORMANT, ST_QUARANTINED):
            raise ValueError(f"unknown status {self.status!r} for {self.id}")
        if self.frequency not in (FREQ_DAILY, FREQ_WEEKLY):
            raise ValueError(f"unknown frequency {self.frequency!r} for {self.id}")
        # ⛔ A SURVEY WITHOUT A STREAM WOULD SERVE SILENCE, and silence reads as "the
        # market was flat" everywhere downstream. Refusing at construction makes it a
        # test failure at import rather than an empty chart in production.
        if self.source_type == SRC_SURVEY and not self.survey_key:
            raise ValueError(f"{self.id} is a survey and declares no survey_key")
        if self.source_type != SRC_SURVEY and self.survey_key:
            raise ValueError(f"{self.id} declares survey_key but is not a survey")
        if self.source_type == SRC_COT and not self.cot_stream:
            raise ValueError(f"{self.id} is a COT series and declares no cot_stream")
        if self.source_type != SRC_COT and self.cot_stream:
            raise ValueError(f"{self.id} declares cot_stream but is not a COT series")

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
            "display_symbol": self.display_symbol or self.symbol,
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
            "summation_epoch": self.summation_epoch,
            "summation_base": self.summation_base,
            "summation_anchor_source": self.summation_anchor_source,
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

#: ⭐ (2026-10-07) The Summation Index's level, stated once. Verified identity:
#: SUM = C + 19·EMA5% − 9·EMA10%; we serve C = 0, as StockCharts' $NASI/$NYSI do.
_MCS_NATURAL = (
    "Running total of the oscillator, served at its NATURAL level: Summation = 19 × the 5% trend "
    "− 9 × the 10% trend (the running total with no arbitrary starting offset), so zero is neutral "
    "breadth and the level is directly comparable in kind to StockCharts' $NASI/$NYSI. History "
    "begins at the first session with 120 real observations behind it."
)

_NOT_NYMO = (
    "⛔ NOT NYMO. Computed over UCT's US common-stock universe, which is a different "
    "census from the NYSE composite (all issues, incl. ETFs, closed-end funds, "
    "preferreds, rights and warrants) that NYMO is computed over."
)


# ── Exchange Breadth V1 rows (dormant) ───────────────────────────────────────

#: Evidence-backed canonical starts (venue ledger 72eef1c2…, Phase 1 gate 2026-10-03):
#: Nasdaq by SIP tape from the first V2 session; NYSE from the first session after the dated
#: XNYS coverage gap (2008-11..2009-06-10, up to 1.7% of NYSE names unplaceable).
EXCHANGE_START = {"nyse": "2009-06-11", "nasdaq": "2008-01-02"}
#: The summation's declared epoch: the first session with 120 real observations behind it.
#: Pinned from the accepted artifact (it is the DEFINITION of the level, never re-derived).
EXCHANGE_MCS_EPOCH = {"nyse": "2009-12-01", "nasdaq": "2008-06-24"}
_EXCH_ALIAS = {("nyse", "MCO"): ("NYMO", "$NYMO"), ("nyse", "MCS"): ("NYSI", "$NYSI"),
               ("nyse", "AD"): ("NYAD", "$NYAD"), ("nasdaq", "MCO"): ("NAMO", "$NAMO"),
               ("nasdaq", "MCS"): ("NASI", "$NASI"), ("nasdaq", "AD"): ("NAAD", "$NAAD")}
_EXCH_POP = ("UCT calculation using point-in-time exchange membership and the UCT operating-equity "
             "breadth universe (common stock + ADRs, as US Breadth V2). %s means %s-listed on that "
             "session (NYSE excludes NYSE American, NYSE Arca and Cboe). NOT the vendor's %s: the "
             "vendor composites count every listed issue, so values differ by design.")


def _exchange_row(universe: str, kind: str) -> "Series":
    X = "NYSE" if universe == "nyse" else "NASDAQ"
    label = "NYSE" if universe == "nyse" else "Nasdaq"
    vendor = "$" + _EXCH_ALIAS[(universe, kind)][0]
    pop = _EXCH_POP % (label, label, vendor)
    # ⭐ (owner, 2026-10-07) THE TICKER A MEMBER READS IS THE CONVENTIONAL ONE — NYMO / NYSI / NYAD /
    # NAMO / NASI / NAAD — carried as `display_symbol`. ⛔⛔ PRESENTATION ONLY; `symbol` STAYS THE
    # COLON-BEARING ID. The Cloudflare edge forwards any bare-word `/api/bars/<T>` to the bars tier
    # unless T is on its hand-deployed list, and `NASI` is a real DELISTED ticker there: making `NASI`
    # the submitted symbol served a dead company's 2010-2013 bars under "Nasdaq · McClellan Summation
    # Index" (measured on production 2026-10-07). The colon routes to web by rule, so every UI path
    # submits `NASDAQ:MCS` and shows `NASI`. The methodology still says this is UCT's point-in-time
    # operating-equity census, not the vendor's all-issues composite.
    common = dict(id=f"{X}:{kind}", display_symbol=_EXCH_ALIAS[(universe, kind)][0],
                  family=FAM_MCCLELLAN if kind != "AD" else FAM_BREADTH,
                  source_type=SRC_BREADTH_DERIVED, status=ST_DORMANT, frequency=FREQ_DAILY,
                  universe=universe, aliases=_EXCH_ALIAS[(universe, kind)],
                  observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
                  source_owner="UCT", licensing="Own data.", reproduces_reference=False,
                  history_start=EXCHANGE_START[universe],
                  blocked_on="Exchange Breadth V1 cutover: awaiting owner authorization of the member-authority "
                             "switch; published only while `breadth_exchange_authority` serves a verified "
                             "authority (BREADTH_AUTHORITY_EXCH=v1).")
    if kind == "MCO":
        return Series(**common, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
                      metric_name="McClellan Oscillator", metric_short="McClellan",
                      synonyms=(f"{label.upper()} MCCLELLAN", "MCCLELLAN", "MCCLELLAN OSCILLATOR"),
                      presentation=PRES_LINE, centerline=0.0, reference_lines=(-100.0, -50.0, 50.0, 100.0),
                      methodology=_MC_METHOD_RATIO + " Seed 0; not published inside the 120-session "
                                  "burn-in. " + pop,
                      methodology_version="mcclellan-v1/ratio_adjusted",
                      provenance=f"Derived from breadth_daily_ohlc `advancing`/`declining` for universe "
                                 f"`{universe}` (Exchange Breadth V1 artifact).")
    if kind == "MCS":
        return Series(**common, unit=UNIT_POINTS, domain=DOMAIN_SIGNED,
                      metric_name="McClellan Summation Index", metric_short="Summation",
                      synonyms=(f"{label.upper()} SUMMATION", "MCCLELLAN SUMMATION", "SUMMATION INDEX"),
                      presentation=PRES_LINE, centerline=0.0, reference_lines=(-500.0, 500.0),
                      methodology=_MC_METHOD_RATIO + " " + _MCS_NATURAL + " " + pop,
                      methodology_version="mcclellan-v1.1/ratio_adjusted/natural-level",
                      provenance=f"Cumulated from {X}:MCO in one forward pass from the pinned epoch.",
                      summation_epoch=EXCHANGE_MCS_EPOCH[universe], summation_base=0.0,
                      summation_anchor_source="natural")
    return Series(**common, unit=UNIT_COUNT, domain=DOMAIN_SIGNED,
                  metric_name="Advance/Decline Line", metric_short="A/D Line",
                  synonyms=(f"{label.upper()} ADVANCE DECLINE", "ADVANCE DECLINE", "AD LINE",
                            "ADVANCE DECLINE LINE"),
                  presentation=PRES_LINE,
                  methodology="Running cumulative total of daily net advances (advances − declines), "
                              "base 0 from the declared start; a missing session holds the level. " + pop,
                  methodology_version="adline-v1",
                  provenance=f"Cumulated from breadth_daily_ohlc `adv_decline` for universe `{universe}` "
                             f"in one forward pass, starting at 0 on {EXCHANGE_START[universe]}.")


# ── Derived breadth ratios (Breadth finishing pass, 2026-10-07) ──────────────
#
# ⭐⭐ ARITHMETIC OVER COUNTS THE AUTHORITIES ALREADY PUBLISH, AND NOTHING ELSE. Every input
# below is a stored, accepted breadth metric (`advancing`, `declining`, `unchanged`,
# `new_52w_highs`, `new_52w_lows`) read through `breadth_daily_ohlc.history()` — the same
# one-directional door US:ZBT and US:AD use. No new data, no new grind, no methodology
# beyond the textbook formula stated on each row.
#
# ⛔ A ZERO DENOMINATOR IS A HOLE, NEVER A ZERO. A session with no declining issues has no
# A/D ratio; a session with no new highs AND no new lows has no Record High Percent. The
# producer emits None and the chart draws a gap, because a 0 would read as "everything
# declined" / "no highs" — the opposite of what happened.
#
# ⚠️ US HAS NO UNCHANGED SERIES: US Breadth V2 does not store `unchanged`, and the
# directional count is not `universe_count` (some constituents have no prior close), so it
# cannot be derived either. NYSE / NASDAQ store it directly.

#: kind → (metric_name, metric_short, unit, domain, presentation, centerline, reference_lines,
#:         synonyms, methodology)
_RATIO_KINDS = {
    "ADR": ("Advance/Decline Ratio", "A/D Ratio", UNIT_RATIO, DOMAIN_RATIO, PRES_LINE, None, (1.0,),
            ("ADVANCE DECLINE RATIO", "AD RATIO", "A/D RATIO", "ADVANCE DECLINE", "ADVANCES DECLINES"),
            "Advancing issues ÷ declining issues for the session. 1.0 = as many advancers as "
            "decliners. No value on a session with zero decliners (undefined, drawn as a gap)."),
    "ADP": ("Advance/Decline Percent", "A/D %", UNIT_PERCENT, DOMAIN_SIGNED, PRES_HISTOGRAM, 0.0,
            (-70.0, 70.0),
            ("ADVANCE DECLINE PERCENT", "AD PERCENT", "A/D PERCENT", "NET ADVANCES PERCENT",
             "ADVANCE DECLINE"),
            "(Advancing − Declining) ÷ (Advancing + Declining) × 100, from −100 to +100. Unchanged "
            "issues are excluded from the denominator, matching the McClellan and Zweig rows in "
            "this catalogue (StockCharts' AD Percent divides by all issues, so values differ "
            "slightly). Readings beyond ±70 are broad-participation sessions."),
    "UNCH": ("Unchanged Issues", "Unchanged", UNIT_COUNT, DOMAIN_NONNEG, PRES_LINE, None, (),
             ("UNCHANGED", "UNCHANGED ISSUES", "UNCH"),
             "Constituents whose close equalled the prior session's close. Stored by the exchange "
             "authority beside advancing and declining; advancing + declining + unchanged is the "
             "session's directional count."),
    "RHP": ("Record High Percent", "Record High %", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, None, (50.0,),
            ("RECORD HIGH PERCENT", "HIGH LOW PERCENT", "NEW HIGHS PERCENT", "HIGHS LOWS RATIO"),
            "New 52-week highs ÷ (new 52-week highs + new 52-week lows) × 100. Above 50 = highs "
            "outnumber lows. No value on a session with neither (undefined, drawn as a gap)."),
    "HLI": ("High-Low Index", "High-Low Idx", UNIT_PERCENT, DOMAIN_PCT, PRES_LINE, None, (30.0, 50.0, 70.0),
            ("HIGH LOW INDEX", "HILO", "HIGH LOW", "NEW HIGHS NEW LOWS"),
            "10-session simple moving average of Record High Percent. Needs ten consecutive defined "
            "Record High Percent sessions; above 50 = highs dominating, above 70 a strong uptrend, "
            "below 30 a strong downtrend."),
}
RATIO_KINDS = tuple(_RATIO_KINDS)
#: Which universes carry which derived kinds. ⛔ US has no UNCH (see above).
RATIO_UNIVERSES = {"us": ("ADR", "ADP", "RHP", "HLI"),
                   "nyse": ("ADR", "ADP", "UNCH", "RHP", "HLI"),
                   "nasdaq": ("ADR", "ADP", "UNCH", "RHP", "HLI")}
_RATIO_INPUTS = {"ADR": "advancing / declining", "ADP": "advancing / declining",
                 "UNCH": "unchanged", "RHP": "new_52w_highs / new_52w_lows",
                 "HLI": "new_52w_highs / new_52w_lows"}
_EXCH_POP_SHORT = ("UCT calculation over point-in-time %s-listed operating equity (Exchange Breadth V1); "
                   "not the vendor's all-issues %s composite, so values differ by design.")


def _ratio_row(universe: str, kind: str) -> "Series":
    name, short, unit, domain, pres, centre, refs, syn, method = _RATIO_KINDS[kind]
    X = "US" if universe == "us" else ("NYSE" if universe == "nyse" else "NASDAQ")
    exch = universe in ("nyse", "nasdaq")
    label = {"us": "US", "nyse": "NYSE", "nasdaq": "Nasdaq"}[universe]
    pop = (_EXCH_POP_SHORT % (label, label)) if exch else (
        "Computed over UCT's US common-stock universe (US Breadth V2, point-in-time).")
    return Series(
        id=f"{X}:{kind}", family=FAM_BREADTH, source_type=SRC_BREADTH_DERIVED,
        # ⛔ Exchange rows follow the exchange authority exactly as NYSE:MCO does: dormant in the
        # table, published only while `breadth_exchange_authority` serves their universe.
        status=ST_DORMANT if exch else ST_PUBLISHED,
        frequency=FREQ_DAILY, unit=unit, domain=domain, universe=universe,
        metric_name=name, metric_short=short,
        synonyms=tuple(syn) + (f"{label.upper()} {name.upper()}",),
        presentation=pres, centerline=centre, reference_lines=refs,
        methodology=method + " " + pop,
        methodology_version=f"breadth-ratio-v1/{kind.lower()}",
        history_start=EXCHANGE_START[universe] if exch else "2008-01-02",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance=f"Derived from breadth_daily_ohlc `{_RATIO_INPUTS[kind]}` for universe "
                   f"`{universe}` (read-only, recomputed from full history on every build).",
        source_owner="UCT", licensing="Own data.",
        blocked_on=("Published only while `breadth_exchange_authority` serves this universe "
                    "(BREADTH_AUTHORITY_EXCH=v1).") if exch else "",
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
        methodology=_MC_METHOD_RATIO + " " + _MCS_NATURAL + " " + _NOT_NYMO,
        methodology_version="mcclellan-v1.1/ratio_adjusted/natural-level",
        history_start="2008-01-02",
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Cumulated from US:MCO in ONE forward pass over the whole history, "
                   "anchored at a PINNED epoch and base so the level survives the "
                   "source data changing underneath it.",
        source_owner="UCT", licensing="Own data.",
        reproduces_reference=False,
        # ⭐⭐ THE CANONICAL DEFINITION OF THIS SERIES' LEVEL, IN ONE PLACE:
        #
        #   "the cumulative sum of the ratio-adjusted US McClellan Oscillator since
        #    2008-06-24, taking the value 0 on that session."
        #
        # ⛔ THE EPOCH IS NOT "WHERE THE DATA STARTS". It is the first session with
        # `DEFAULT_BURN_IN` (120) real observations already behind it, given the store's
        # measured start of 2008-01-02 — read-only probe, 2026-09-20, session index 120
        # of 4,708. Before it the series is UNDEFINED and nothing is served; a warmup
        # value a member could see would be an artifact of the EMA seed wearing the
        # name of a market level.
        #
        # ⛔ AND IT IS `declared`, NOT `reference:`. Nobody publishes a McClellan
        # Summation Index over US common stock, so there is no external value to anchor
        # to; borrowing NYSI's would be calling a different calculation by a famous
        # indicator's name. The level is therefore ours BY DECLARATION and is not
        # comparable to NYSI — which the methodology field says in words.
        summation_epoch="2008-06-24",
        summation_base=0.0,
        # ⭐ (2026-10-07) the epoch fixes where the series STARTS; the LEVEL is natural (C = 0) —
        # `producers.natural_summation_shift`. The 0.0 above is the pre-shift running-total seed.
        summation_anchor_source="natural",
    ),

    # ⛔⛔ DORMANT — Exchange Breadth V1 (2026-10-03). Fully specified, NOT servable and NOT
    # discoverable: `published_rows()` excludes them and `resolve()` refuses them, so no flag, no
    # typo and no client cache can reach one before the cutover authorizes publication.
    #
    # ⭐ CANONICAL IDENTITY AND SUBMITTED SYMBOL ARE THE UCT ID (`NYSE:MCO`). Since 2026-10-07 the
    # ticker a member READS is the conventional one (NYMO/NYSI/NAMO/NASI/NYAD/NAAD, `display_symbol`,
    # owner decision); the vendor names stay resolvable aliases. The DISPLAY name
    # stays `NYSE · McClellan Oscillator` and the methodology keeps the census caveat (our population
    # is point-in-time NYSE / Nasdaq operating equity, not the vendors' all-issues composites).
    *[_exchange_row(u, kind) for u in ("nyse", "nasdaq") for kind in ("MCO", "MCS", "AD")],

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
        history_start=None,
        observation_semantics=_SAME_SESSION, knowledge_semantics=_KNOWN_AT_CLOSE,
        provenance="Would derive from the collector's `advancing`/`declining`.",
        source_owner="UCT", licensing="Own data.",
        blocked_on="⛔ THERE IS ALMOST NO UCT advancing/declining HISTORY TO DERIVE "
                   "FROM. Measured read-only against the production store 2026-09-20: "
                   "universe `uct` carries just 15 `advancing` rows and 15 `declining` "
                   "rows (2010-05-10 .. 2026-09-18) against 4,704 sessions — the "
                   "collector writes the pair into `breadth_snapshots`, not into "
                   "`breadth_daily_ohlc`. A ratio-adjusted UCT oscillator built from "
                   "that would be 15 points beside the shipped UCTMC's 18 years. "
                   "Needs a collector/backfill decision first, then a product decision "
                   "about what happens to UCTMC.",
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

    # ⭐ Derived ratios over published counts — see `_RATIO_KINDS`. 14 rows: US ×4, NYSE ×5, NASDAQ ×5.
    *[_ratio_row(u, k) for u in ("us", "nyse", "nasdaq") for k in RATIO_UNIVERSES[u]],

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
        survey_key="naaim",
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

    # ── AAII Sentiment Survey ───────────────────────────────────────────────
    #
    # ⭐⭐ THREE COMPONENT SERIES, ONE MEMBER-FACING PRODUCT. The member never sees
    # three library entries — `PRODUCTS` below groups these into "AAII Sentiment
    # Survey", which is what discovery returns and what the chart adds. They are
    # registered individually because each one IS a canonical series: it has its own
    # observations, its own bars door, its own formula address. Grouping is a
    # PRESENTATION fact and belongs in the product, not in the identity.
    #
    # ⛔⛔ AND THEY ARE READ, NEVER DERIVED. `aaii_bulls` / `aaii_bears` /
    # `aaii_neutral` are first-class keys in two canonical UCT stores and have been
    # since long before this project. The one thing that would be dishonest here —
    # recovering three components from the single Bull-Bear Spread — is arithmetically
    # impossible (one equation, three unknowns) and `aaii_store` cannot even read the
    # spread. The spread remains its own long-standing series at `UCTAAII`.
    #
    # ⚠️ THE FOURTH FIGURE IS NOT A SERIES. Bullish + Bearish + Neutral sum to 100 by
    # construction, so a fourth "total" row would be a constant wearing a name.
]


def _aaii(comp: str, name: str, short: str, *, synonyms=()) -> Series:
    """One AAII component. A FUNCTION for the same reason `_vol` is one: the three
    differ in a word and a key, and anything else differing between them would be a
    drift nobody would see on a chart where all three are drawn together."""
    return Series(
        id=f"AAII:{comp.upper()}", symbol=f"AAII:{comp.upper()}",
        family=FAM_SENTIMENT, source_type=SRC_SURVEY,
        frequency=FREQ_WEEKLY, unit=UNIT_PERCENT, domain=DOMAIN_PCT,
        display=f"AAII {name}", short=short,
        metric_name=f"AAII {name}", metric_short=short,
        aliases=(f"AAII:{comp.upper()}", f"AAII{comp.upper()}"),
        synonyms=naming.search_tokens("AAII", "SENTIMENT", "SURVEY",
                                      "INDIVIDUAL INVESTOR", synonyms),
        # ⭐ STEP, NOT LINE, AND FOR A DATA REASON. One reading stands until the next
        # survey; a sloped line between two Wednesdays would draw daily values nobody
        # measured. `step_to_daily` already serves flat carried bars — this is the
        # presentation that tells the truth about them.
        presentation=PRES_STEP,
        reference_lines=(),
        survey_key=f"aaii_{comp.lower()}",
        methodology=f"The share of AAII members reporting a {name.lower()} view of "
                    "the US stock market over the next six months, from AAII's own "
                    "weekly member survey. Bullish, Bearish and Neutral sum to 100%. "
                    "⛔ One reading per week — no OHLC, no interpolation, and the "
                    "components are READ from the survey, never recovered from the "
                    "Bull-Bear Spread.",
        methodology_version="aaii-v1",
        history_start=None,                    # answered at runtime by the store
        observation_semantics="The date is the WEDNESDAY the survey closed for.",
        knowledge_semantics="AAII publish the week's result on the Thursday. The "
                            "stored observation is dated to the survey week, not to "
                            "the day UCT read it.",
        provenance="Two canonical UCT stores, stitched on a date seam: the public "
                   "archive seed `breadth_sentiment_history` (1987-07-24 onward) and "
                   "the 4:15pm Breadth collector's `breadth_snapshots` (2026-01-02 "
                   "onward), deduplicated by `aaii_survey_date`. This project added "
                   "NO ingestion — both writers predate it.",
        source_owner="AAII (American Association of Individual Investors)",
        licensing="⚠️ POC ONLY, and the same posture as NAAIM. AAII publish the "
                  "survey history as a free spreadsheet on their own site "
                  "(aaii.com/files/surveys/sentiment.xls) with no access control; "
                  "the weekly numbers are very widely redisplayed with attribution. "
                  "Commercial redisplay should carry 'Source: AAII Sentiment Survey' "
                  "and be confirmed with AAII before this leaves POC.",
        reproduces_reference=True,
        has_ohlc=False,
    )


_ROWS += [
    _aaii("BULLS", "Bullish", "Bullish", synonyms=("BULLS", "BULLISH")),
    _aaii("BEARS", "Bearish", "Bearish", synonyms=("BEARS", "BEARISH")),
    _aaii("NEUTRAL", "Neutral", "Neutral", synonyms=("NEUTRAL",)),
]


    # ── Volatility ──────────────────────────────────────────────────────────
    # Rule 1 throughout: these ARE the established indices, published by Cboe, and we
    # serve Cboe's own numbers rather than a calculation of our own. No UCT prefix.



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


# ── Positioning — CFTC Commitments of Traders ───────────────────────────────
#
# ⭐⭐ THE COT STORE ALREADY EXISTS AND THIS ADDS NOTHING TO IT. `cot_service` owns the
# CFTC ingestion, the contract-rename aliases and `cot.db`; the Breadth page's COT tab
# (`CotData.jsx`) reads it through `/api/cot/{symbol}`. These rows are the SAME
# numbers — `cot_records.commercial_net / large_spec_net / small_spec_net` — made
# chartable through the one bars door every other market indicator uses. No second
# provider, no second store, no recomputation: `series.py` reads the columns as stored.
#
# ⛔ THE MARKET LIST IS `cot_service`'s, NEVER RE-TYPED. The markets, their order and
# their member-facing names come from `SYMBOL_GROUPS` / `SYMBOL_NAMES`, so a market the
# COT tab gains (or loses) appears (or disappears) here without an edit.
#
# ⚠️ THREE COMPONENTS PER MARKET, ONE PRODUCT (see `PRODUCTS`). The order is the COT
# tab's own pane order — Commercials, Large Speculators, Small Speculators.

from api.services import cot_service as _cot   # noqa: E402 — module constants only

UNIT_CONTRACTS = "contracts"

#: `(component code, cot_records column, member-facing name)`, in pane order.
COT_COMPONENTS = (
    ("COMM", "commercial_net", "Commercials"),
    ("LARGE", "large_spec_net", "Large Speculators"),
    ("SMALL", "small_spec_net", "Small Speculators"),
)


def _cot_markets() -> list[str]:
    """Every COT market `cot_service` serves, in the COT tab's group order, once each.

    ⚠️ "MOST WATCHED" IS A PICKER SHORTCUT OVER THE SAME MARKETS, so it is skipped
    rather than letting it decide the order; the asset-class groups are the catalogue.
    """
    out: list[str] = []
    for group, syms in _cot.SYMBOL_GROUPS.items():
        if group == "MOST WATCHED":
            continue
        for s in syms:
            if s in _cot.SYMBOL_MAP and s not in out:
                out.append(s)
    # ⛔ A MAPPED MARKET NO GROUP LISTS (ET, NM, DL today) IS NOT OFFERED. The COT
    # tab does not offer it either, and "what UCT supports" is what a member can pick.
    return out


def _cot_market_name(sym: str) -> str:
    return f"{_cot.SYMBOL_NAMES.get(sym, sym)} COT"


def _cot_series(sym: str, code: str, column: str, name: str) -> Series:
    market = _cot_market_name(sym)
    return Series(
        id=f"COT:{sym}:{code}", symbol=f"COT:{sym}:{code}",
        family=FAM_POSITIONING, source_type=SRC_COT,
        frequency=FREQ_WEEKLY, unit=UNIT_CONTRACTS, domain=DOMAIN_SIGNED,
        # ⭐ THE FULL NAME CARRIES THE MARKET; THE SHORT ONE IS THE PANE LABEL. A pane
        # legend reads `Commercials`, not "Nasdaq-100 E-Mini COT Commercials" three
        # times — the market is the product's name, stated once.
        display=f"{market} · {name}", short=name,
        metric_name=name, metric_short=name,
        synonyms=naming.search_tokens("COT", "COMMITMENTS OF TRADERS", "CFTC",
                                      "POSITIONING", name.upper()),
        # ⭐ HISTOGRAM, AND FOR A DATA REASON: a net position is signed, and the thing
        # a member reads is which side of ZERO each group is on and how far.
        presentation=PRES_HISTOGRAM, centerline=0.0,
        cot_stream=f"{sym}:{column}",
        methodology=f"{name} net position (long minus short contracts) in the CFTC "
                    "Commitments of Traders legacy futures-only report, exactly as "
                    "stored by UCT's COT tab. One observation per weekly report, held "
                    "on each day until the next report (a standing position, never "
                    "interpolated).",
        methodology_version="cot-legacy-v1",
        history_start=None,                    # answered at runtime by the store
        observation_semantics="Each report describes positions at the close of its "
                              "AS-OF TUESDAY — its identity, and the date the COT tab and "
                              "/api/cot label it by.",
        knowledge_semantics="Served from its PUBLIC date, never its as-of date: CFTC "
                            "release it the following Friday 15:30 ET (next publication "
                            "day after a Wed-Fri holiday; CFTC's own schedule after a "
                            "lapse or outage) — `cot_release.available_day`. A bar dated "
                            "D carries the newest report public by D's close.",
        provenance="`cot_service` → `cot.db` `cot_records`, the store behind "
                   "`/api/cot/{symbol}` and the Breadth page's COT tab. This project "
                   "added NO ingestion.",
        source_owner="CFTC (U.S. Commodity Futures Trading Commission)",
        licensing="Public record (CFTC).",
        has_ohlc=False,
    )


COT_MARKETS = _cot_markets()

_ROWS += [
    _cot_series(sym, code, column, name)
    for sym in COT_MARKETS
    for code, column, name in COT_COMPONENTS
]


# ── THE ONE COT INDICATOR THAT FOLLOWS THE CHART (2026-09-30) ────────────────
#
# ⭐⭐ A MEMBER ADDS "COT (Commitment of Traders)" ONCE; THE CHART SYMBOL PICKS THE
# MARKET. On QQQ it draws Nasdaq-100 E-Mini positioning, on GLD Gold, on TLT the
# 30-Year T-Bond — and on a symbol with no related futures market (AAPL) it draws
# NOTHING: no pane, no legend. The stored indicator names no market at all: its three
# sources are `sym:COT:AUTO:<PART>:close`, and the chart swaps `AUTO` for the market
# this table maps the chart symbol to, at render time, never in the saved blob.
#
# ⛔ UNLEVERED FUNDS AND INDEXES ONLY (owner, 2026-09-30). A 3× or inverse fund is a
# different exposure, not a proxy; it stays unmapped and shows nothing. A market with
# no fund here (lumber, cattle, the peso…) drops out of the product — its per-market
# series stay resolvable, they are simply no longer offered.
#
# ⚠️ EVERY TARGET MUST BE A MARKET `cot_service` SERVES — checked at import, below.

COT_FOLLOW = "AUTO"
COT_FOLLOW_ID = "COT"
COT_FOLLOW_DISPLAY = "COT (Commitment of Traders)"

#: COT market → the chart symbols that show it, in the order a member would name them.
COT_SYMBOLS_BY_MARKET = {
    "ES": ("SPY", "IVV", "VOO", "SPYM", "SPX", "XSP"),   # SPYM = the renamed SPLG
    "NQ": ("QQQ", "QQQM", "NDX", "XND"),
    "YM": ("DIA", "DJX"),
    "QR": ("IWM", "VTWO", "RUT"),
    "EW": ("MDY", "IJH", "IVOO"),
    "VI": ("VXX", "VIXY", "VIXM", "VIX"),
    "GC": ("GLD", "IAU", "GLDM", "SGOL", "BAR", "AAAU"),
    "SI": ("SLV", "SIVR"),
    "HG": ("CPER",),
    "PL": ("PPLT",),
    "PA": ("PALL",),
    "CL": ("USO", "USL", "DBO"),
    "BZ": ("BNO",),
    "RB": ("UGA",),
    "NG": ("UNG", "UNL"),
    "ZW": ("WEAT",),
    "ZC": ("CORN",),
    "ZS": ("SOYB",),
    "SB": ("CANE",),
    "ZB": ("TLT", "SPTL", "VGLT"),
    "UD": ("EDV", "ZROZ"),
    "ZN": ("IEF",),
    "ZF": ("IEI",),
    "ZT": ("SHY",),
    "DX": ("UUP",),
    "E6": ("FXE",),
    "J6": ("FXY",),
    "B6": ("FXB",),
    "S6": ("FXF",),
    "D6": ("FXC",),
    "A6": ("FXA",),
    "BTC": ("IBIT", "FBTC", "GBTC", "ARKB", "BITB", "BITO"),
    "ETH": ("ETHA", "FETH", "ETHE"),
}


def _cot_symbol_map() -> dict:
    out: dict = {}
    for market, syms in COT_SYMBOLS_BY_MARKET.items():
        if market not in COT_MARKETS:
            raise ValueError(f"COT follow map names {market}, which cot_service does not serve")
        for t in syms:
            if t in out:
                raise ValueError(f"{t} maps to two COT markets ({out[t]}, {market})")
            out[t] = market
    return out


#: Chart symbol → COT market. ⛔ The ONE place a symbol is related to a market.
COT_SYMBOL_MAP = _cot_symbol_map()


def cot_market_for(symbol: str) -> Optional[str]:
    """The COT market a chart symbol shows, or None (the indicator draws nothing)."""
    return COT_SYMBOL_MAP.get((symbol or "").strip().upper())


def cot_symbols_payload() -> dict:
    """What the client needs to resolve `AUTO`: symbol → {market, name}."""
    return {t: {"market": m, "name": _cot.SYMBOL_NAMES.get(m, m)}
            for t, m in COT_SYMBOL_MAP.items()}


# ── DELIBERATELY ABSENT, AND WHY ─────────────────────────────────────────────
#
# ⛔⛔ TRIN / ARMS INDEX IS NOT REGISTERED — not even dormant. A dormant row is a
# design somebody reviewed; this is a decision to not have one yet, and the reason is
# narrower than the first audit stated. Corrected by a READ-ONLY probe of the
# production store, 2026-09-20:
#
#   TRIN = (advancing / declining) / (up volume / down volume)
#        = (advancing / declining) / up_vol_ratio
#
#   universe `us`   up_vol_ratio   4,708 rows, 2008-01-02..2026-09-18, 0 nulls
#                   up_on_volume   4,708 rows, same span
#                   down_on_volume 4,708 rows, same span
#
#   ⭐ SO A US TRIN IS DERIVABLE FROM THE STORE THAT EXISTS TODAY. The earlier
#   "DATA DEPENDENCY NOT SATISFIED" was right about the V2 INTRADAY pass — 
#   `breadth_wick_recon.session_ohlc` calls `compute_metrics(levels, prices)` with no
#   volumes, so nothing it produces carries a volume metric — and it was right about
#   NYSE/NASDAQ, which have zero rows of anything. It was WRONG as a blanket claim
#   about US: production's `us` history is 100% `close_recon`, and that sweep DOES
#   pass day volumes.
#
# ⚠️ TWO REASONS IT STILL DOES NOT SHIP HERE, and neither is "we cannot":
#
#   1. PRECISION. `up_vol_ratio` is stored `round(..., 2)` — 744 distinct values
#      across 4,708 sessions. Near 1.00, where TRIN is actually read, a 2-decimal
#      denominator quantises the result to roughly ±2%. A famous indicator published
#      at a precision its inputs cannot support is the kind of thing that reads as
#      correct and is not.
#   2. IT WOULD BE US-ONLY AND PERMANENTLY SO. The exchange universes cannot follow:
#      even after Breadth V2 populates them, the intraday pass it runs produces no
#      volume metric at all. A TRIN that can never have an NYSE sibling is a
#      different product decision from the one this V1 was scoped around.
#
# ⛔ THE FIX IS NOT OURS TO MAKE HERE: an unrounded up/down volume ratio (or the raw
# sums) in the canonical store. Documented, not worked around. Breadth V2 was not
# changed to obtain it.
#
# ⛔ BULLISH PERCENT INDEX is absent for a different reason entirely — it needs a
# per-stock point-and-figure state machine over point-in-time index membership, which
# is a new subsystem rather than a derivation. No percent-above-MA substitute exists
# anywhere in this package, and none may be added under that name.
#
# ⛔ PUT/CALL is absent because the legacy `UCTPC` breadth symbol is QUARANTINED: a
# published symbol with a dead feed since 2026-08-07 and a six-year hole
# (2019-10-05 .. 2026-01-01). It is untouched, unmigrated, and must not be given
# continuity from a different semantic source.

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


#: Exchange Breadth V1 rows: DORMANT in the table, PUBLISHED exactly while the exchange authority serves
#: their universe (`breadth_exchange_authority.serves`). One predicate, read by every accessor below, so
#: the catalogue, search, `/api/bars` and the metadata route can never disagree.
EXCHANGE_SERIES_IDS = frozenset(
    [f"{x}:{k}" for x in ("NYSE", "NASDAQ") for k in ("MCO", "MCS", "AD")]
    + [f"{u.upper()}:{k}" for u in ("nyse", "nasdaq") for k in RATIO_UNIVERSES[u]])
_LIVE_ROW: dict = {}


def _effective(s: Optional[Series]) -> Optional[Series]:
    if s is None or s.id not in EXCHANGE_SERIES_IDS:
        return s
    try:
        from api.services import breadth_exchange_authority as _ea
        serving = _ea.serves(s.universe)
    except Exception:
        serving = False
    if not serving:
        return s
    hit = _LIVE_ROW.get(s.id)
    if hit is None:
        hit = _LIVE_ROW[s.id] = replace(s, status=ST_PUBLISHED, blocked_on=None)
    return hit


def get(series_id: str) -> Optional[Series]:
    """The row for a canonical id, whatever its status. Discovery must NOT use this."""
    if not series_id:
        return None
    return _effective(SERIES.get(str(series_id).strip().upper()))


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
    s = _effective(SERIES[sid])
    if s.status != ST_PUBLISHED and not include_dormant:
        return None
    return s


def is_market_indicator(token: str) -> bool:
    """True when this deploy will SERVE `token` as a market indicator.

    ⭐⭐ A PRODUCT ANSWERS YES, AND IT HAS TO. `resolve()` is the SERIES authority and
    correctly refuses a product — but `/api/bars/AAII:SURVEY` is a real request once a
    product is a primary-chart identity, and this is the oracle every routing decision
    in `api/routers/bars.py` consults. Answering no here would send the product down
    the ordinary bars path, which has no rows for it, and a member would get the
    cacheable `200 + bars: []` that blanked every market-indicator chart in V1.

    ⚠️ IT DOES NOT MAKE A PRODUCT A SERIES. `series.build_bars` serves the product's
    PRIMARY COMPONENT under the product's own ticker; nothing here invents bars.
    """
    if resolve(token) is not None:
        return True
    # ⚠️ Defined below this function at import time; the call is at request time.
    return resolve_product(token) is not None


# ── PRODUCTS — one member-facing thing made of several canonical series ──────
#
# ⭐⭐ A PRODUCT IS A DISCOVERY FACT, NOT AN IDENTITY. Each component below is a
# real canonical series with its own id, its own bars door and its own formula
# address; a product says only that a member who asks for one wants all of them,
# together, in one pane. Keeping the grouping OUT of `Series` is what stops the
# chart engine ever having to learn the concept — it adds three ordinary series
# and places them, exactly as a member could by hand.
#
# ⛔ THE COMPONENTS ARE HIDDEN FROM THE CATALOGUE LIST, NOT FROM RESOLUTION. A
# search for "AAII" must return ONE row, and `/api/bars/AAII:BULLS` must still
# serve — those are different questions and conflating them is how a product
# becomes a wall a member cannot address through.
#
# ⚠️ ORDER IS THE DRAW ORDER AND THE LEGEND ORDER, and it is a product decision:
# Bullish, Bearish, Neutral is how AAII themselves publish the three.


@dataclass(frozen=True)
class Product:
    """Several canonical series a member adds, and reads, as one thing."""
    id: str
    display: str
    short: str
    family: str
    components: tuple                  # ordered canonical series ids
    description: str = ""
    synonyms: tuple = ()
    #: Extra spellings that RESOLVE to this product — the member-facing shorthand.
    #: ⛔ A product resolves so it can be a PRIMARY CHART identity; it still serves
    #: no bars of its own (`primary_component` below names the series that does).
    aliases: tuple = ()
    #: ⭐ WHETHER THE COMPONENTS STAY ONE LOGICAL INDICATOR ON THE CHART — removed and
    #: hidden together, and their shared pane titled by `group_title`. Stamped by the
    #: client at creation; AAII predates it and keeps its independent components.
    grouped: bool = False
    #: The shared pane's title and its quiet qualifier (a grouped product only):
    #: `Nasdaq-100 E-Mini · COT` / `Net Contracts`. Empty means the product's display.
    group_title: str = ""
    group_note: str = ""
    #: Colour TOKENS, one per component, resolved by the client's palette — never a raw
    #: hex here. Empty means "the client's default product palette".
    palette: tuple = ()
    #: ⭐ WHETHER A MEMBER CAN FIND IT. An unlisted product still RESOLVES (a saved
    #: chart, `COT:NQ` typed as a primary symbol) — it is only absent from the
    #: browsable catalogue and search. The per-market COT products are unlisted: the
    #: one follow-the-chart COT indicator replaced them (2026-09-30).
    listed: bool = True

    @property
    def family_label(self) -> str:
        return FAMILY_LABEL[self.family]

    @property
    def tokens(self) -> tuple:
        # ⭐ THE COMPONENTS' OWN WORDS MATCH THE PRODUCT. A member who types "bullish"
        # is looking for the survey that HAS a bullish reading, and the component row
        # that carries the word is deliberately not in the browsable list — so without
        # this the one query most specific to the product returns nothing at all.
        comp = []
        for cid in self.components:
            c = SERIES.get(cid)
            if c is not None:
                comp.extend([c.display, c.short, c.metric_name])
        return naming.search_tokens(self.id, self.display, self.short, self.aliases,
                                    self.synonyms, self.family_label, comp)

    @property
    def primary_component(self) -> str:
        """The component a PRIMARY chart binds its own series to.

        ⭐⭐ THE FIRST ONE, AND THAT IS A DECLARED ORDER RATHER THAN AN ARBITRARY
        PICK. `components` is already the draw and legend order — the order AAII
        themselves publish — so "the first" is the same answer every other surface
        gives. The other components are added ALONGSIDE it as ordinary overlays, so
        the chart shows the whole product; this only decides which series the chart's
        own price slot holds.

        ⛔ AND IT IS NOT "the product's bars". A product has none. This names a real
        canonical series that does.
        """
        return self.components[0]

    def to_row(self) -> dict:
        return {
            "id": self.id, "kind": "product",
            "primary_component": self.primary_component,
            "symbol": self.id, "display": self.display, "short": self.short,
            "family": self.family, "family_label": self.family_label,
            "description": self.description,
            "components": list(self.components),
            # ⭐⭐ THE COMPONENTS' MEMBER-FACING NAMES TRAVEL WITH THE PRODUCT, and
            # they have to: the client creates three series from these ids, and
            # without a name each one falls back to a label DERIVED FROM ITS SOURCE
            # — so a pane legend would read `AAII:BULLS / AAII:BEARS /
            # AAII:NEUTRAL`, three internal addresses in the one place the member
            # actually reads. Naming lives on the server (`naming.py`) for every
            # other series and it stays there for these.
            #
            # ⚠️ THE SHORT NAME IS THE ONE THE LEGEND USES, so it is the bare word —
            # `Bullish`, not `AAII Bullish`. The pane already says which survey
            # these are; repeating "AAII" three times inside it is furniture.
            "component_rows": [
                {"id": c.id, "display": c.display, "short": c.short,
                 # ⭐ PER COMPONENT, so a product whose outputs draw in different
                 # panes can say how each one draws.
                 "presentation": c.presentation, "domain": c.domain,
                 **({"palette": self.palette[i]} if i < len(self.palette) else {})}
                for i, c in enumerate(SERIES.get(cid) for cid in self.components)
                if c is not None
            ],
            "grouped": self.grouped,
            "group_title": self.group_title or self.display,
            "group_note": self.group_note,
            # The client's matcher has no server tokens; these are the words it may use.
            "tags": list(self.synonyms),
            "aliases": list(self.aliases), "status": ST_PUBLISHED,
            # ⛔ A PRODUCT IS NEVER CANDLE-CAPABLE, and not because of its own
            # nature: it has no bars of its own at all. Saying so explicitly keeps
            # the fail-closed reader from having to interpret an absence.
            "ohlc_capable": False, "has_ohlc": False,
        }


PRODUCTS: list[Product] = [
    Product(
        id="AAII:SURVEY",
        display="AAII Sentiment Survey",
        short="AAII Survey",
        family=FAM_SENTIMENT,
        components=("AAII:BULLS", "AAII:BEARS", "AAII:NEUTRAL"),
        description="The weekly AAII member survey in full — the share of individual "
                    "investors reporting a bullish, bearish or neutral six-month view, "
                    "drawn together on one percentage scale. The three sum to 100%.",
        # ⭐⭐ `AAII` IS AN ALIAS, NOT MERELY A SYNONYM, AND THE DIFFERENCE IS THE BUG
        # THIS SHIPPED WITH. A synonym only makes a row SEARCHABLE; an alias makes it
        # RESOLVE — and `discovery.search` scores an alias match as tier 0, which is
        # what `ticker_search` reads as `symbol_hit` to rank a row at the FRONT. With
        # only synonyms the product scored ≥2, landed behind every general match, and
        # depended on nothing truncating the list. It is also what lets a member type
        # `AAII` into the SYMBOL box and get the survey rather than nothing.
        aliases=("AAII", "AAII:SURVEY", "AAIISURVEY", "AAII SENTIMENT",
                 "AAII SENTIMENT SURVEY"),
        synonyms=("SENTIMENT SURVEY", "INDIVIDUAL INVESTOR SENTIMENT",
                  "BULLS BEARS NEUTRAL", "AAII SURVEY"),
    ),
]


def _cot_asset_class(sym: str) -> str:
    for group, syms in _cot.SYMBOL_GROUPS.items():
        if group != "MOST WATCHED" and sym in syms:
            return group.title()
    return ""


def _cot_product(sym: str) -> Product:
    """ONE COT dataset as a member adds it: three net-position panes, one indicator."""
    market = _cot.SYMBOL_NAMES.get(sym, sym)
    asset = _cot_asset_class(sym)
    return Product(
        id=f"COT:{sym}",
        display=_cot_market_name(sym),
        short=f"{sym} COT",
        family=FAM_POSITIONING,
        components=tuple(f"COT:{sym}:{code}" for code, _col, _n in COT_COMPONENTS),
        description=f"CFTC Commitments of Traders for {market} futures — the weekly net "
                    "position (long minus short contracts) of Commercials, Large "
                    "Speculators and Small Speculators, drawn together in one pane.",
        # ⚠️ NO BARE CONTRACT CODE AS AN ALIAS. `NQ`, `ES` and `GC` are things a
        # member types into the symbol box meaning the FUTURE; resolving them to a
        # positioning report would hijack that. Only COT-qualified spellings resolve.
        aliases=(f"COT:{sym}", f"COT {sym}", f"{sym} COT", f"COT{sym}"),
        synonyms=tuple(t for t in ("COT", "COMMITMENTS OF TRADERS", "CFTC",
                                   "POSITIONING", "FUTURES POSITIONING", market.upper(),
                                   asset.upper()) if t),
        grouped=True,
        group_title=f"{market} · COT",
        group_note="Net Contracts",
        palette=("cot.commercials", "cot.largeSpecs", "cot.smallSpecs"),
        listed=False,
    )


PRODUCTS += [_cot_product(sym) for sym in COT_MARKETS]

_PRODUCT_BY_ID = {p.id: p for p in PRODUCTS}

#: Every series id that belongs to some product. ⚠️ DERIVED, never typed twice —
#: a component list and a "hide these" list that can disagree is a component that
#: appears twice in discovery on the day somebody edits one of them.
PRODUCT_COMPONENT_IDS = frozenset(
    cid for p in PRODUCTS for cid in p.components)


def products() -> list[Product]:
    return list(PRODUCTS)


def listed_products() -> list[Product]:
    return [p for p in PRODUCTS if p.listed]


def get_product(pid: str) -> Optional[Product]:
    return _PRODUCT_BY_ID.get((pid or "").strip().upper())


#: Every spelling that resolves to a product. ⛔ BUILT FROM THE PRODUCTS, never typed
#: twice — an alias list that can disagree with the rows it names is an alias that
#: resolves to nothing on the day somebody edits one of them.
_PRODUCT_ALIAS_INDEX = {
    str(k).strip().upper(): p.id
    for p in PRODUCTS
    for k in (p.id, p.short, p.display, *p.aliases)
    if k
}


def resolve_product(token: str) -> Optional[Product]:
    """A member-facing spelling → its Product, or None.

    ⭐⭐ THIS IS WHAT MAKES A PRODUCT A PRIMARY-CHART IDENTITY. `resolve()` answers for
    SERIES and must keep answering None here — a product has no bars of its own, and a
    caller that wanted a series must not silently receive something that cannot serve
    one. This is the second, explicit question: "is this token a product?"

    ⚠️ CASE- AND SPACE-INSENSITIVE ON THE MEMBER'S SIDE ONLY. `AAII`, `aaii`,
    `AAII Sentiment Survey` and `AAII:SURVEY` are all the same request; nothing here
    infers a product from a shape.
    """
    if not token:
        return None
    key = " ".join(str(token).strip().upper().split())
    pid = _PRODUCT_ALIAS_INDEX.get(key)
    return _PRODUCT_BY_ID.get(pid) if pid else None


def product_of(series_id: str) -> Optional[Product]:
    """The product a component belongs to, if any."""
    sid = (series_id or "").strip().upper()
    for p in PRODUCTS:
        if sid in p.components:
            return p
    return None


def all_rows() -> list[Series]:
    """Every row with its EFFECTIVE status (the exchange rows follow their authority)."""
    return [_effective(s) for s in _ROWS]


def published_rows() -> list[Series]:
    return [s for s in all_rows() if s.status == ST_PUBLISHED]


def dormant_rows() -> list[Series]:
    return [s for s in all_rows() if s.status == ST_DORMANT]


def rows_for_family(family: str, published_only: bool = True) -> list[Series]:
    src = published_rows() if published_only else all_rows()
    return [s for s in src if s.family == family]


def families(published_only: bool = True) -> list[dict]:
    src = published_rows() if published_only else all_rows()
    present = {s.family for s in src}
    return [{"id": f, "label": FAMILY_LABEL[f]}
            for f in FAMILY_ORDER if f in present]
