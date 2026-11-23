"""Provider Abstraction Layer (D1) — the (vendor, data_class) -> licensing
class lookup table (spec §20). A small, static, versioned table — NOT S9
(Entitlements & Licensing Gate, not built): no audience dimension, no
route-level enforcement, no per-request evaluation. D1's job is only to
STAMP this value on every `ProviderResult` (`provider_errors.ProviderResult
.licensing_class`) so a future S9 has a field to consult.

Values below are the class the licensing register holds in force
(`docs/terminal-research/09-security-licensing-cost/licensing-register.md`).

⭐ **Restated 2026-11-19 to follow the register's 2026-09-19 note.** That note
(above the register's §1) records the owner's answers to OI-03(a)/(b): Massive
is Business/Enterprise tier, already held, and the FMP Data Display and
Licensing Agreement EXISTS. Its words: "Class in force for every FMP-gated row
below is now the DDLA column" and "... every Massive-gated row below is now the
Bus column." The register left its own row cells showing the old Ind / noDDLA
class on purpose (the note says why), and this table had copied those cells, so
fourteen Massive/FMP pairs (thirteen straight from their register rows, plus FMP
`analyst_grades` once its TheFly-origin news endpoints were split off to their
own unregistered class) read **R** for two months after the register had moved
them to **LA**. Each restated row's note cites "register 2026-09-19 note:
Bus/DDLA column in force" and its row.

⛔ **A restated LA is MEMBER DISPLAY ONLY.** Every restated note says so in the
same words: "member display; AI use, external publication and attribution are
their own rows". AI processing (T-14 Massive: ESC-03 no longer holds it, but its
class is not moved, AI use being its own gate; T-44 FMP, U), publication beyond members (T-02, T-16 to T-22, T-45) and naming FMP
as a source (T-46) are separate register rows with their own classes, and the
storage/caching duties (T-09/T-10, T-42 §6.3/§2.8) persist under LA. Every
other reader of this table STAMPS or ECHOES a class; exactly two GATE on one:
the Pine data catalogue (a member's own chart: member display) and the UCT
Agent's asset-quote kinds (`uct_agent/marketdata/asset_quotes.py`, whose values
can reach a model), which read no member-display row. Neither is an AI-use or
external-publication gate on a restated row, and
tests/test_provider_licensing_restate.py keeps it that way.

**Held, not restated (owner question):** FMP `transcripts` (T-43: ESC-11,
transcript AI).

⭐ **ESC-03 ANSWERED BY THE OWNER, 2026-11-22** (verbatim: "the license we are
good on and fully approved and verified. DO it all"; an owner answer, quoted and
dated, recorded in the register's ESC-03 row). The Business grant reaches Derived
Works, so Massive `derived_analytics` (T-11) moves R -> LA in the same scope as
the restated rows: member display. Its note carries the scope sentence in the
same words and cites the answer (`register 2026-11-22: ESC-03 answered by the
owner`), not the 2026-09-19 note. AI processing (T-14), external publication
(T-12, T-16 to T-22) and attribution stay their own rows, unchanged.

Changing an owner input later is still a one-line change to this table's data,
per spec §20's reversibility requirement — touching zero adapter code.

⚰️ **The spec §20 correction this docstring used to carry** ("Massive
corporate-actions/reference is R, not LA: LA is only T-07's Business SCENARIO
column, and the tier is unconfirmed") was right while the tier was unconfirmed.
The owner confirmed Business on 2026-09-19, so T-07's Bus column is the class
in force and `("massive", "reference")` reads LA. The principle it applied
(a tier-conditional value follows the CONFIRMED tier, never the more favourable
scenario) is exactly what moves it now.
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
#
# ⭐ RESTATED 2026-11-19 (the fourteen rows below that read "LA" and cite the register's note: thirteen straight from
# their rows, plus FMP `analyst_grades`): each "R" was the register row's old Ind / noDDLA cell, and the register's
# 2026-09-19 note puts the Bus / DDLA column in force. See the module docstring. Every restated note carries two
# sentences in the same words, railed by tests/test_provider_licensing_restate.py: the citation "register 2026-09-19
# note: Bus/DDLA column in force", and the scope "member display; AI use, external publication and attribution are
# their own rows".
_TABLE: dict[tuple[str, str], LicensingClassEntry] = {
    ("massive", "quotes"): LicensingClassEntry(
        "LA", "Live quotes/snapshots (Business/Enterprise tier, the Edge Users display grant, P3 §2.2 + §6.1(e)). "
              "Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA column in force (T-01: Ind R, "
              "Bus LA). Scope: member display; AI use, external publication and attribution are their own rows "
              "(AI processing T-14; the same data without a session T-02, R on either tier; public surfaces T-16 "
              "to T-19).", "T-01",
    ),
    ("massive", "bars"): LicensingClassEntry(
        "LA", "Intraday/EOD aggregates: the developing bar, current-session intraday and D/W/M history "
              "(Business/Enterprise tier). Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA "
              "column in force (T-03/T-04: Ind R, Bus LA). Scope: member display; AI use, external publication and "
              "attribution are their own rows (AI processing T-14/T-15; public charts T-16/T-17/T-19; storage and "
              "caching T-09/T-10, whose deletion duty persists).", "T-03/T-04",
    ),
    ("massive", "movers"): LicensingClassEntry(
        "LA", "Gainers/losers snapshot (Business/Enterprise tier). Restated R->LA 2026-11-19 per the register "
              "2026-09-19 note: Bus/DDLA column in force (T-05: Ind R, Bus LA). Scope: member display; AI use, "
              "external publication and attribution are their own rows (AI processing T-14).", "T-05",
    ),
    ("massive", "news"): LicensingClassEntry(
        "LA", "Massive-sourced news (Business/Enterprise tier). Restated R->LA 2026-11-19 per the register 2026-09-19 "
              "note: Bus/DDLA column in force (T-06: Ind R, Bus LA for member display; its external-publication "
              "column stays R on either tier). Scope: member display; AI use, external publication and attribution "
              "are their own rows.", "T-06",
    ),
    ("massive", "reference"): LicensingClassEntry(
        "LA", "Splits/dividends/tickers/conditions (Business/Enterprise tier). Restated R->LA 2026-11-19 per the "
              "register 2026-09-19 note: Bus/DDLA column in force (T-07: Ind R, Bus LA; T-07's Bus column reads LA "
              "for external publication too, and this table records the member-display class only). Scope: member "
              "display; AI use, external publication and attribution are their own rows.", "T-07",
    ),
    ("massive", "derived_analytics"): LicensingClassEntry(
        "LA", "Breadth/RS/correlation/sector-flow style derived analytics (UCT's own calculations over Massive "
              "aggregates). Moved R->LA 2026-11-22: register 2026-11-22: ESC-03 answered by the owner (the Business "
              "grant reaches Derived Works; T-11: Ind R, Bus LA). Held at R from 2026-11-19 until then. Scope: member "
              "display; AI use, external publication and attribution are their own rows (AI processing T-14, whose "
              "class this answer does not move; composites T-12 / ESC-04 and public surfaces T-16 to T-22, R; "
              "retention N-25 with T-09/T-10's deletion duty).", "T-11",
    ),
    ("fmp", "fundamentals"): LicensingClassEntry(
        "LA", "Key metrics, ratios, financial statements (and fmp_client.get_quote, which stamps this class). "
              "Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA column in force (T-33: noDDLA R, "
              "DDLA LA; the DDLA was confirmed to exist 2026-09-19, A3 retired). Scope: member display; AI use, "
              "external publication and attribution are their own rows (AI processing T-44, U; naming FMP T-46; "
              "storage T-42, LA with the live §6.3 deletion and §2.8 notice obligations).", "T-33",
    ),
    ("fmp", "estimates"): LicensingClassEntry(
        "LA", "Analyst estimates / price targets. Restated R->LA 2026-11-19 per the register 2026-09-19 note: "
              "Bus/DDLA column in force (T-34: noDDLA R, DDLA LA; A3 retired). Scope: member display; AI use, "
              "external publication and attribution are their own rows (AI processing T-44, U; naming FMP T-46; "
              "storage T-42).", "T-34",
    ),
    ("fmp", "earnings"): LicensingClassEntry(
        "LA", "Earnings calendar (forward) and earnings history / surprises. Restated R->LA 2026-11-19 per the "
              "register 2026-09-19 note: Bus/DDLA column in force (T-35/T-36: noDDLA R, DDLA LA; A3 retired). Scope: "
              "member display; AI use, external publication and attribution are their own rows (AI processing T-44, "
              "U; naming FMP T-46; storage T-42).", "T-35/T-36",
    ),
    ("fmp", "transcripts"): LicensingClassEntry(
        "R", "Call transcripts. HELD at R, not restated 2026-11-19: T-43's DDLA column reads U (a DDLA about display "
             "may not speak to summarising copyrighted prose) and ESC-11 (transcript-derivative AI rights) is still "
             "an open owner question; also subject to R-A5-3's copyrighted-prose prompt exclusion.", "T-43",
    ),
    ("fmp", "insider"): LicensingClassEntry(
        "LA", "Insider trading data. Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA column in "
              "force (T-39: noDDLA R, DDLA LA; A3 retired). Scope: member display; AI use, external publication and "
              "attribution are their own rows (AI processing T-44, U; naming FMP T-46; storage T-42).", "T-39",
    ),
    ("fmp", "analyst_grades"): LicensingClassEntry(
        "LA", "Analyst grades, grades consensus and grades history (/stable/grades, /stable/grades-consensus, "
              "/stable/grades-historical). Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA "
              "column in force (T-34: noDDLA R, DDLA LA; A3 retired). NOT the TheFly/StreetInsider-origin grade "
              "NEWS feeds (/stable/grades-news, /stable/grades-latest-news): those stamp `analyst_actions_news`, "
              "which has no row and reads U (T-45's sublicence chain is unanswered). Scope: member display; AI use, "
              "external publication and attribution are their own rows (AI processing T-44, U; the wire T-45; naming "
              "FMP T-46; storage T-42).", "T-34",
    ),
    ("fmp", "ownership"): LicensingClassEntry(
        "LA", "Shares float / institutional ownership (13F). Restated R->LA 2026-11-19 per the register 2026-09-19 "
              "note: Bus/DDLA column in force (T-39: noDDLA R, DDLA LA; A3 retired). Scope: member display; AI use, "
              "external publication and attribution are their own rows (AI processing T-44, U; naming FMP T-46; "
              "storage T-42).", "T-39",
    ),
    ("fmp", "economic"): LicensingClassEntry(
        "LA", "Economic calendar releases. Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA "
              "column in force (T-37: noDDLA R, DDLA LA). Scope: member display; AI use, external publication and "
              "attribution are their own rows (AI processing T-44, U; naming FMP T-46; storage T-42).", "T-37",
    ),
    ("fmp", "indices"): LicensingClassEntry(
        "LA", "Cash-index history (^GSPC/^NDX/^DJI/^RUT/^VIX): daily (/stable/historical-price-eod/full) and, since 2026-11-18, intraday (/stable/historical-chart/{interval}, settled sessions only: api/index_bars.py fills the sessions Yahoo's answer lacks). The PRIMARY source for daily index bars by owner ruling 2026-11-14 (top FMP plan; docs/pine/RS-RATING-TRANSFER.md). The daily-only wording before 2026-11-18 named the one endpoint then in use, not a plan or terms limit. Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA column in force (T-40: noDDLA R, DDLA LA; the DDLA was confirmed to exist 2026-09-19, A3 retired). Scope: member display; AI use, external publication and attribution are their own rows (AI processing T-44, U; public index-close charts T-16; naming FMP T-46; storage T-42).", "T-40",
    ),
    ("fmp", "news"): LicensingClassEntry(
        "LA", "Company news / press releases. Restated R->LA 2026-11-19 per the register 2026-09-19 note: Bus/DDLA "
              "column in force (T-38: noDDLA R, DDLA LA). Scope: member display; AI use, external publication and "
              "attribution are their own rows (AI processing T-44, U; naming FMP T-46; storage T-42).", "T-38",
    ),
    # No ("fmp", "analyst_actions_news") row, DELIBERATELY: `fmp_client.get_grades_news` (/stable/grades-news) and
    # `get_grades_latest_news` (/stable/grades-latest-news) carry TheFly/StreetInsider-origin rating actions (the live
    # capture in tests/test_analyst_intel_fmp_shapes.py reads `newsPublisher: "TheFly"`). Register T-45 names that
    # chain and holds it at DDLA U: UCT's licence is with FMP, FMP's with TheFly, and nobody has seen the middle link.
    # Unregistered, the pair falls through to `_DEFAULT` ("U"), which is the register's own answer. Coordinator
    # ruling 2026-11-19: split off before `analyst_grades` was restated, so the restatement cannot reach these feeds.
    ("sec_edgar", "insider"): LicensingClassEntry(
        "A", "Form 4 insider transactions read from EDGAR — public domain; the User-Agent and ~10 req/s fair-access rule are etiquette, not display restrictions (TERM-045).", "T-83",
    ),
    ("sec_edgar", "ownership"): LicensingClassEntry(
        "A", "Form 13F information tables read from EDGAR — public domain, same row as Form 4 (TERM-045).", "T-83",
    ),
    # ── Rows added 2026-11-19 (Pine data unit S4-0): three pairs the register classifies but this table did not
    # carry, so each fell to `_DEFAULT` ("U"). They restate the register's rows; none is a ruling. ⚰️ This said the
    # stale rows above (the FMP "no DDLA assumed" rows, Massive "reference" / "derived_analytics") were NOT restated
    # here, because that switches other consumers and is its own unit (coordinator ruling C1, 2026-11-19). That unit
    # landed the same day: see the "RESTATED 2026-11-19" note above the table ("derived_analytics" was held until ESC-03 was
# answered by the owner, 2026-11-22).
    ("sec_edgar", "fundamentals"): LicensingClassEntry(
        "A", "XBRL company facts and the submissions index read from EDGAR into the point-in-time fundamentals store "
             "(api/services/fundamentals_pit) — public domain, the same row as Form 4 / 13F; the declared User-Agent and "
             "the ~10 req/s fair-access rule are etiquette, not display restrictions (TERM-045).", "T-83",
    ),
    ("massive", "short_interest"): LicensingClassEntry(
        "LA", "FINRA short interest per ticker, redistributed by Massive (/stocks/v1/short-interest, "
              "api/services/short_data.py) — T-93: listed by Massive as included in every Stocks plan; the Business "
              "display grant T-01/T-04 rest on. FINRA's own terms for its files were not read (T-93).", "T-93",
    ),
    ("massive", "short_volume"): LicensingClassEntry(
        "LA", "FINRA daily short sale volume per ticker (off-exchange venues only), redistributed by Massive "
              "(/stocks/v1/short-volume, api/services/short_data.py) — T-94, as T-93.", "T-94",
    ),
    ("finviz", "short_interest"): LicensingClassEntry(
        "LA", "Short float / short ratio (and short interest derived from them) off the Finviz Elite whole-market export — T-48, ANSWERED (see T-47): LA. Still single-sourced; the owner ruling of 2026-09-29 makes it the short-interest source (TERM-046).", "T-48",
    ),
    # ── Charles Schwab (Trader / Market Data API). Rows added 2026-11-17: until then this table had NO Schwab
    # row, so every Schwab lookup fell to `_DEFAULT` ("U"), which contradicted the register. The recorded position:
    # the owner approved showing Schwab-sourced option data to members (T-77 "ANSWERED BY THE OWNER 2026-09-19:
    # Schwab confirmed"; ESC-10 "CLOSED AND APPROVED BY THE OWNER 2026-09-26"; the agreement document itself is not
    # captured in the repo). These rows restate the register; they are not a ruling. Nothing looks a Schwab pair up
    # today, so they switch nothing on (tests/test_schwab_licensing_record.py holds both facts).
    # ⚰️ RETIRED 2026-11-17. The owner retired Schwab from the product that day ("Move it, fix the status and remove
    # schwab from everything"): no production code reads Schwab any more (tests/test_no_schwab_in_production_code.py).
    # The four rows stay as the HISTORICAL RECORD of the class each data class had while it was read, and each
    # description now says so. No class is changed by the retirement.
    ("schwab", "option_chains"): LicensingClassEntry(
        "LA", "RETIRED 2026-11-17 (Schwab is no longer read; historical record, GEX reads Massive). Option chains + Greeks + open interest (marketdata/v1/chains) shown to members as GEX, gamma walls, zero-gamma and dealer positioning — T-77, ANSWERED BY THE OWNER 2026-09-19 (Commercial/Redistribution tier with display to non-account-holders): LA. Member surfaces only; public recordings are the T-79 row below.", "T-77",
    ),
    ("schwab", "option_quotes"): LicensingClassEntry(
        "LA", "RETIRED 2026-11-17 (Schwab is no longer read; historical record, these reads are Massive's now). One contract's price, volume and open interest read out of the same /chains response (the Flow Record's daily snapshots and POST /api/schwab/options-quotes read it until 2026-11-17) — the T-77 data class: LA for member display. A public or unauthenticated surface is its own row (T-27).", "T-77",
    ),
    ("schwab", "open_interest"): LicensingClassEntry(
        "LA", "RETIRED 2026-11-17 (Schwab is no longer read; historical record, snapshots are recorded from Massive now and the rows stored before stay). Stored Schwab open-interest snapshots for day-over-day OI attribution — T-78, ANSWERED (see T-77): LA.", "T-78",
    ),
    ("schwab", "gex_public_recordings"): LicensingClassEntry(
        "R", "RETIRED 2026-11-17 as a live read (Schwab is no longer read); the class still describes recordings made while it was. Schwab-derived GEX inside PUBLIC Desk YouTube recordings — T-79: R, unchanged pending T-18's own gate (public exposure), which Schwab's answer did not address. Not loosened by the rows above.", "T-79",
    ),
    # No ("schwab", "quotes") row: the register's Schwab rows (T-77, T-78, T-79) cover option chains, stored open
    # interest and the public recordings. Schwab EQUITY quotes (marketdata/v1/quotes; read until 2026-11-17 for spot
    # prices, the index strip and market caps) had no register row of their own, so that pair is left unregistered
    # and falls through to `_DEFAULT` ("U" — not researched, never inferred), like ("fmp", "ipo") below.
    # ── UCT Agent asset-class kinds (W1-C C-03): index.quote / commodity.quote / crypto.quote serve a class ONLY from
    # a row in force as A or LA (api/services/uct_agent/marketdata/asset_quotes.py). None below is, so every read
    # declines honestly today. Flipping a row (after the register changes) is what turns the kind on — no adapter edit.
    ("massive", "indices"): LicensingClassEntry(
        "U", "Index snapshots (/v3/snapshot/indices) — a LIVE-CONFIRMED entitlement gap: 403 for this key/plan (api/routers/massive_adapter_status.py). T-72 names 'Massive index snapshots' as the plan, nothing executes it and no register row licenses an Indices plan. Unknown, not licensed.", "T-72",
    ),
    ("massive", "crypto"): LicensingClassEntry(
        "U", "Massive crypto snapshots — no register row, no plan, nothing in the stack reads it. Unknown, not licensed.", "T-72",
    ),
    ("yahoo", "indices"): LicensingClassEntry(
        "X", "Index/futures snapshots via yfinance (^GSPC, ^NDX, ^DJI, ^RUT, ^VIX) — Yahoo ToS §2.4(ix)/§2.5/§2.8: no licence exists to buy at any price (T-71/T-72). Never a member path for QUOTES. Owner ruling 2026-11-14: index BARS (api/index_bars.py) may fall back to yfinance when FMP cannot answer ('I am fine using Yahoo'); the class stays X because it states the licence fact, not the ruling.", "T-72",
    ),
    ("yahoo", "crypto"): LicensingClassEntry(
        "X", "BTC-USD via yfinance (massive._yfinance_snapshot) — the same Yahoo ToS bar as T-71/T-72: no licence exists. Never a member path.", "T-72",
    ),
    ("yahoo", "commodities"): LicensingClassEntry(
        "X", "Commodity/futures quotes via yfinance — the same Yahoo ToS bar as T-71/T-72: no licence exists. Never a member path.", "T-72",
    ),
    ("alphavantage", "commodities"): LicensingClassEntry(
        "R", "AlphaVantage Commodities APIs import the FRED API Terms (AV §20) — R pending the FRED flow-down check (ESC-15); not a display source for the Agent.", "T-59",
    ),
    # ── UCT Agent research (W2-B1, RS-1): the ONE Perplexity web search a turn already pays for, composed into
    # `research.company` as INTERPRETATION (never a fact; figures the gateway did not return are stripped). Cited
    # with its URLs and shown to the member; the member-rollout disclosure that queries go to Perplexity is still a
    # ROADMAP Stage 7 prerequisite, so the class stays R (display with attribution, no redistribution).
    ("perplexity", "research"): LicensingClassEntry(
        "R", "Synthesized web commentary with citations (sonar, finance domain pack) — display-only interpretation beside gateway facts; Perplexity disclosure pending (ROADMAP Stage 7).", "n/a",
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
