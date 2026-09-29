"""Economic data -- the shared vocabulary every econ module speaks.

One file on purpose: the registry, the adapters, the store, the scheduler, the
serving layer and the tests all import their enums and record types from here,
so a state that exists in one place exists in all of them.

TWO TIMES, NEVER ONE (the core semantic of the whole package):

  OBSERVATION PERIOD   what the number DESCRIBES   (period_start .. period_end,
                       ISO dates, e.g. 2026-08-01 .. 2026-08-31 for August CPI)
  AVAILABLE AT         when the number became KNOWABLE (unix seconds UTC,
                       e.g. 2026-09-10T12:30Z for August CPI)

Charts place values by AVAILABLE AT by default (owner ruling 2026-09-28); the
observation period is preserved on every row so a period-aligned view is a
presentation choice, never a different dataset.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

NAMESPACE = "ECON"          # canonical id = "ECON:<SYMBOL>"; member display = "<SYMBOL>"
SOURCE_PREFIX = "econ"      # Universal Data source grammar: "econ:<SYMBOL>"


def canonical_id(symbol: str) -> str:
    return f"{NAMESPACE}:{symbol}"


def parse_canonical(value: str) -> Optional[str]:
    """'ECON:USCPI' | 'econ:USCPI' -> 'USCPI'; anything else -> None.

    Exactly one colon; the symbol must be the registry's shape. This is the ONE
    parser -- routing, serving and tests use it rather than re-splitting strings.
    """
    if not isinstance(value, str) or value.count(":") != 1:
        return None
    ns, sym = value.split(":", 1)
    if ns.upper() != NAMESPACE:
        return None
    sym = sym.strip().upper()
    return sym if SYMBOL_RE_MATCH(sym) else None


def SYMBOL_RE_MATCH(sym: str) -> bool:  # noqa: N802 -- kept beside parse_canonical
    import re
    return bool(re.fullmatch(r"US[A-Z0-9]{2,12}", sym))


class Frequency(str, Enum):
    DAILY = "D"          # business-day observations
    WEEKLY = "W"         # anchor carried separately (Frequency + week_anchor)
    MONTHLY = "M"
    QUARTERLY = "Q"
    ANNUAL = "A"
    IRREGULAR = "IRREG"  # e.g. policy target changes


class WeekAnchor(str, Enum):
    NONE = ""
    SAT = "SAT"          # week ending Saturday (DOL claims)
    FRI = "FRI"          # week ending Friday (EIA stocks)
    WED = "WED"          # Wednesday level (H.4.1)
    MON = "MON"          # Monday survey (EIA retail gasoline)


class Presentation(str, Enum):
    LINE = "line"
    STEP = "step"
    HISTOGRAM = "histogram"   # "bar" in owner language
    AREA = "area"


class SeriesStatus(str, Enum):
    ENABLED = "enabled"          # production-eligible (rails enforce licensing + verification)
    DISABLED = "disabled"        # known-good definition, intentionally off
    UNVERIFIED = "unverified"    # provider identity not confirmed against the agency
    EXCLUDED = "excluded"        # RED / not cleared -- may never be enabled without a licensing change


class Role(str, Enum):
    MEMBER = "member"            # discoverable/chartable
    SUPPORT = "support"          # ingested only as an input to a derived member series


class LicenseClass(str, Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"


class Clearance(str, Enum):
    CLEARED = "cleared"                  # published terms permit UCT's use
    PERMISSION_PENDING = "permission_pending"
    PERMISSION_GRANTED = "permission_granted"   # YELLOW + explicit written approval (needs approval_ref)
    BLOCKED = "blocked"


class PitClass(str, Enum):
    """Can this observation be used as known-at-time data?  (owner ruling #6)

    TRUE_VINTAGE        value AND available_at were observed as published: UCT
                        captured it live, or it came from an authoritative vintage
                        archive with a historical release timestamp.
    UNREVISED_HISTORY   backfilled, but the series is declared non-revising, so the
                        value IS what was known; available_at comes from a
                        conservative, documented release rule. PIT-usable.
    LATEST_BACKFILL     backfilled latest-known value; later revisions may be baked
                        in; available_at is a rule estimate. Chartable, NOT PIT-safe.
    UNKNOWN             provenance insufficient. Never PIT-safe.
    """
    TRUE_VINTAGE = "V"
    UNREVISED_HISTORY = "U"
    LATEST_BACKFILL = "L"
    UNKNOWN = "X"


PIT_SAFE = frozenset({PitClass.TRUE_VINTAGE, PitClass.UNREVISED_HISTORY})

# Weakest-link ordering for derived values: a derived observation is only as
# PIT-safe as its weakest input.
PIT_STRENGTH = {PitClass.TRUE_VINTAGE: 3, PitClass.UNREVISED_HISTORY: 2,
                PitClass.LATEST_BACKFILL: 1, PitClass.UNKNOWN: 0}


def weakest(classes) -> PitClass:
    return min(classes, key=lambda c: PIT_STRENGTH[PitClass(c)]) if classes else PitClass.UNKNOWN


class AvailableAtMethod(str, Enum):
    SOURCE_TIMESTAMP = "source_timestamp"   # provider-stated publication time (header/field)
    SCHEDULED = "scheduled"                 # official calendar time, value seen in its window
    DETECTED = "detected"                   # first time UCT saw it (no trustworthy schedule)
    RULE = "rule"                           # backfill: documented conservative lag rule
    DERIVED = "derived"                     # max(available_at of inputs)


class Currentness(str, Enum):
    """Economic currentness. HTTP 200 NEVER implies CURRENT.

    CURRENT             the latest EXPECTED period is stored and validated.
    CHECKING            inside a release window, expected period not yet seen.
    DELAYED             past the window + grace, expected period still absent.
    SOURCE_UNAVAILABLE  provider erroring/throttling beyond retry budget.
    VALIDATION_FAILED   provider returned data that failed validation; last good kept.
    NO_EXPECTATION      UCT cannot establish what should exist -> may show data,
                        may NEVER claim CURRENT.
    UNINITIALIZED       no validated data yet.
    NOT_PRODUCTION      series not enabled.
    """
    CURRENT = "CURRENT"
    CHECKING = "CHECKING"
    DELAYED = "DELAYED"
    SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    NO_EXPECTATION = "NO_EXPECTATION"
    UNINITIALIZED = "UNINITIALIZED"
    NOT_PRODUCTION = "NOT_PRODUCTION"


class SchedulePrecision(str, Enum):
    EXACT = "exact"            # date + time known from an authoritative calendar
    DATE_ONLY = "date_only"    # date known, time not stated -> never invent 08:30
    RULE = "rule"              # derived from a published rule (e.g. "next business day ~08:00")
    UNKNOWN = "unknown"


class ScheduleSource(str, Enum):
    AUTHORITATIVE_FEED = "authoritative_feed"   # machine-readable agency calendar (BEA JSON)
    AUTHORITATIVE_PAGE = "authoritative_page"   # agency-published table parsed (Census list view)
    CONFIGURED = "configured"                   # operator-entered from an official publication, with citation
    RULE = "rule"                               # agency-published cadence rule
    INFERRED = "inferred"                       # UCT inference from history -- lowest trust


@dataclass(frozen=True)
class RawObs:
    """What an adapter returns after normalization (before validation)."""
    series_id: str                 # registry symbol, e.g. "USCPI"
    period_start: str              # ISO date
    period_end: str                # ISO date
    value: Optional[float]         # None = provider-stated missing (NA), never 0
    flag: str = ""                 # provider flag: "p" preliminary, "r" revised, ...
    source_published_at: Optional[int] = None   # per-row publication time if the provider states one


@dataclass
class FetchResult:
    adapter: str
    request_key: str               # REDACTED canonical request identity (no secrets, ever)
    observations: list[RawObs] = field(default_factory=list)
    source_published_at: Optional[int] = None   # payload-level publication time, if stated
    http_status: Optional[int] = None
    payload_sha256: Optional[str] = None
    payload_bytes: int = 0
    not_modified: bool = False     # conditional GET said nothing changed
    warnings: list[str] = field(default_factory=list)
    raw_payload: Optional[bytes] = None   # kept only for archive; never logged


class EconError(Exception):
    """Base error. Messages MUST be secret-free (http.py guarantees for its own)."""


class SourceUnavailable(EconError):
    """Transport/provider failure after the retry budget (5xx, timeout, 429 exhausted)."""


class MalformedPayload(EconError):
    """The provider answered, but not with something we can trust."""


class ValidationFailed(EconError):
    def __init__(self, series_id: str, reasons: list[str]):
        self.series_id = series_id
        self.reasons = reasons
        super().__init__(f"{series_id}: " + "; ".join(reasons))
