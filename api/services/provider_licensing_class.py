"""Provider Abstraction Layer (D1) — the (vendor, data_class) -> licensing
class lookup table (spec §20). A small, static, versioned table — NOT S9
(Entitlements & Licensing Gate, not built): no audience dimension, no
route-level enforcement, no per-request evaluation. D1's job is only to
STAMP this value on every `ProviderResult` (`provider_errors.ProviderResult
.licensing_class`) so a future S9 has a field to consult.

Values below are the licensing register's own "Class in force" column
today (`docs/terminal-research/09-security-licensing-cost/
licensing-register.md`, rows T-01/T-04/T-07/T-11 for Massive, and the A3
assumption in force for FMP) — the CURRENT, conservative default under the
still-open OI-03(a)/(b) questions (Massive assumed Individual tier, no
Edge Users grant; FMP assumed no DDLA). Changing either owner input later
is a one-line change to this table's data, per spec §20's explicit
reversibility requirement — touching zero adapter code.

**One correction to the D1 technical spec's own summary, recorded per the
"evidence wins" instruction**: spec §20 states Massive "corporate-actions/
reference LA even at Individual tier." Direct re-read of the licensing
register's own row for this data class (T-07: "splits, dividends, tickers,
conditions") shows **"Class in force": R**, with LA appearing only in the
Business-tier SCENARIO column ("Ind R * Bus LA (incl. external)") — i.e.
LA is what T-07 becomes IF the Massive tier turns out to be Business, not
the class in force today. This module uses the register's own "Class in
force" value (R) rather than the spec's paraphrase, consistent with the
conservative-default principle the whole licensing framework already uses
elsewhere (when a value is tier-conditional and the tier is unconfirmed,
the current-tier assumption governs, never the more favorable scenario).
"""
from __future__ import annotations

from typing import NamedTuple


class LicensingClassEntry(NamedTuple):
    licensing_class: str  # 'A' | 'LA' | 'R' | 'U' | 'X' — licensing-register.md's own legend
    note: str
    register_row: str  # traceability back to the exact row this value came from


# (vendor, data_class) -> entry. `data_class` is a short, adapter-chosen
# string (not D2's eventual enum, which does not exist yet — spec §4.2's
# interim-contract framing applies here too).
_TABLE: dict[tuple[str, str], LicensingClassEntry] = {
    ("massive", "quotes"): LicensingClassEntry(
        "R", "Live quotes/snapshots — Individual tier, display-only, no Edge Users grant.", "T-01",
    ),
    ("massive", "bars"): LicensingClassEntry(
        "R", "Intraday/EOD aggregates — Individual tier.", "T-03/T-04",
    ),
    ("massive", "movers"): LicensingClassEntry(
        "R", "Gainers/losers snapshot — single-security live % is display data.", "T-05",
    ),
    ("massive", "news"): LicensingClassEntry(
        "R", "Massive-sourced news — Individual tier.", "T-06",
    ),
    ("massive", "reference"): LicensingClassEntry(
        "R", "Splits/dividends/tickers/conditions — Individual tier (Business scenario is LA, not current).", "T-07",
    ),
    ("massive", "derived_analytics"): LicensingClassEntry(
        "R", "Breadth/RS/correlation/sector-flow style derived analytics — Individual tier's Derived Works bar reaches this broadly.", "T-11",
    ),
    ("fmp", "fundamentals"): LicensingClassEntry(
        "R", "Key metrics / financial statements — no DDLA assumed (A3).", "A3",
    ),
    ("fmp", "estimates"): LicensingClassEntry(
        "R", "Analyst estimates / price targets — no DDLA assumed.", "A3",
    ),
    ("fmp", "earnings"): LicensingClassEntry(
        "R", "Earnings history/calendar — no DDLA assumed.", "A3",
    ),
    ("fmp", "transcripts"): LicensingClassEntry(
        "R", "Call transcripts — no DDLA assumed; also subject to R-A5-3's copyrighted-prose prompt exclusion.", "A3",
    ),
    ("fmp", "insider"): LicensingClassEntry(
        "R", "Insider trading data — no DDLA assumed.", "A3",
    ),
    ("fmp", "analyst_grades"): LicensingClassEntry(
        "R", "Analyst grades/ratings — no DDLA assumed.", "A3",
    ),
    ("fmp", "ownership"): LicensingClassEntry(
        "R", "Shares float / institutional ownership (13F) — no DDLA assumed, same A3 posture as this vendor's other data classes.", "A3",
    ),
    ("fmp", "economic"): LicensingClassEntry(
        "R", "Economic calendar releases — no DDLA assumed, same A3 posture as this vendor's other data classes.", "T-37",
    ),
    # No ("fmp", "ipo") row: the licensing register's IPO-calendar row (T-52)
    # covers Finnhub's leg, not FMP's `stable/ipos-calendar` specifically — no
    # research exists for that pair, so it is left unregistered and correctly
    # falls through to `_DEFAULT` ("U" — not researched, never inferred).
}

_DEFAULT = LicensingClassEntry(
    "U", "No licensing-register row identified for this (vendor, data_class) pair yet — Unknown, not Allowed by default.", "n/a",
)


def licensing_class_for(vendor: str, data_class: str) -> str:
    """The stamped value for `ProviderResult.licensing_class`. Never
    raises, never defaults to a permissive value for an unrecognized pair —
    an un-researched combination is 'U' (Unknown), the same conservative
    default the licensing register itself uses for anything not yet
    classified (never silently 'A')."""
    return _TABLE.get((vendor, data_class), _DEFAULT).licensing_class


def entry_for(vendor: str, data_class: str) -> LicensingClassEntry:
    """The full entry (class + note + traceability), for admin/status
    surfaces that want to show WHY a value is what it is, not just the
    letter."""
    return _TABLE.get((vendor, data_class), _DEFAULT)


def all_entries() -> dict[tuple[str, str], LicensingClassEntry]:
    """A copy of the whole table — for a future status endpoint or test
    that wants to enumerate every registered (vendor, data_class) pair."""
    return dict(_TABLE)
