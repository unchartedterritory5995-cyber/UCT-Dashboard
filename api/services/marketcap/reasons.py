"""The closed vocabularies of the dataset: reason codes, source types, validation outcomes."""
from __future__ import annotations

# Every trading day WITHOUT a market cap carries exactly one of these.
PRE_EDGAR = "PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE"
PRE_FIRST = "PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE"
TICKER_REUSE = "TICKER_REUSE_DIFFERENT_ISSUER"
IPO_UNRESOLVED = "IPO_CAPITALIZATION_UNRESOLVED"
MULTI_CLASS = "MULTI_CLASS_UNRESOLVED"
COMPLEX = "COMPLEX_CAPITAL_STRUCTURE_UNRESOLVED"
ADR_RATIO = "ADR_RATIO_UNRESOLVED"
STALE = "SHARE_STATE_STALE"
CORP_ACTION_HOLD = "CORPORATE_ACTION_HOLD"
SOURCE_CONFLICT = "SOURCE_CONFLICT"
QUARANTINED = "QUARANTINED"
WITHHELD = "WITHHELD"
NO_VALID_PRICE = "NO_VALID_PRICE"
NOT_YET_LISTED = "NOT_YET_LISTED"
DELISTED = "DELISTED"
BUG = "BUG"
OTHER_EXPLAINED = "OTHER_EXPLAINED"
# 2026-10-02 correction pass
SCALE_UNRESOLVED = "SHARE_COUNT_SCALE_UNRESOLVED"          # a >= 3x move / contradiction not (yet) independently corroborated
SUSPICIOUS_SHARE_COUNT = "SUSPICIOUS_SHARE_COUNT"          # a tiny reported count (placeholder-like) not corroborated
SPLIT_BASIS_UNRESOLVED = "SPLIT_BASIS_UNRESOLVED"          # a split between as-of and publication; basis undecidable
REVERSE_SPLIT_RECOUNT = "REVERSE_SPLIT_RECOUNT_PENDING"    # a count dated before a reverse split is not carried across it
UNLISTED_SPLIT_SUSPECTED = "CORPORATE_ACTION_UNLISTED_SPLIT_SUSPECTED"   # a split-like price step the ledger lacks
HIST_SPLIT_UNRESOLVED = "HISTORICAL_SPLIT_EVIDENCE_UNRESOLVED"           # pre-split history; no authoritative split evidence
SUCCESSOR_UNRESOLVED = "SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED"        # bars predate this issuer; lineage not proven
PREDECESSOR_DIFFERENT_ENTITY = "PREDECESSOR_DIFFERENT_ECONOMIC_ENTITY"   # merger / spin-off / new entity boundary
ISSUANCE_EXCEEDS_STATE = "REGISTERED_ISSUANCE_EXCEEDS_SHARE_STATE"      # a registration >= 3x the count in force
FOREIGN_MULTI_CLASS = "FOREIGN_MULTI_CLASS_UNRESOLVED"     # ADS over several ordinary classes, economics not established
PRE_LISTING_EVIDENCE = "PRE_LISTING_EVIDENCE_ONLY"         # only counts dated before this security began trading

REASON_CODES = (PRE_EDGAR, PRE_FIRST, TICKER_REUSE, IPO_UNRESOLVED, MULTI_CLASS, COMPLEX, ADR_RATIO, STALE,
                CORP_ACTION_HOLD, SOURCE_CONFLICT, QUARANTINED, WITHHELD, NO_VALID_PRICE, NOT_YET_LISTED,
                DELISTED, BUG, OTHER_EXPLAINED, SCALE_UNRESOLVED, SUSPICIOUS_SHARE_COUNT, SPLIT_BASIS_UNRESOLVED,
                REVERSE_SPLIT_RECOUNT, UNLISTED_SPLIT_SUSPECTED, HIST_SPLIT_UNRESOLVED, SUCCESSOR_UNRESOLVED,
                FOREIGN_MULTI_CLASS, PRE_LISTING_EVIDENCE, PREDECESSOR_DIFFERENT_ENTITY, ISSUANCE_EXCEEDS_STATE)

# Evidence source types, in selection precedence (lower rank wins a same-as-of tie).
COVER_XBRL = "COVER_XBRL"            # dei:EntityCommonStockSharesOutstanding (class-dimensional or not)
COVER_TEXT = "COVER_TEXT"            # cover-page statement parsed from filing text (pre-XBRL)
BALANCE_SHEET_XBRL = "BALANCE_SHEET_XBRL"  # us-gaap:CommonStockSharesOutstanding, non-dimensional
IPO_PROSPECTUS = "IPO_PROSPECTUS"    # "shares outstanding after this offering"
OFFERING_TEXT = "OFFERING_DOCUMENT_TEXT"   # actual count "as of <recent date>" in a 424B / S-1 / F-1 / S-3 / F-3
RANK = {COVER_XBRL: 1, COVER_TEXT: 2, BALANCE_SHEET_XBRL: 3, IPO_PROSPECTUS: 4, OFFERING_TEXT: 4}

# Observation validation outcomes.
ACCEPTED = "ACCEPTED"
ACCEPTED_RESTATED_BASIS = "ACCEPTED_RESTATED_BASIS"   # value was already on a post-split basis
REJ_NONPOSITIVE = "REJECTED_NONPOSITIVE"
REJ_BAD_SCALE = "REJECTED_BAD_SCALE"
REJ_BASIS_AMBIGUOUS = "REJECTED_SPLIT_BASIS_AMBIGUOUS"
REJ_CONFLICT = "REJECTED_SOURCE_CONFLICT"
REJ_SUPERSEDED_AMENDMENT = "SUPERSEDED_BY_AMENDMENT"
REJ_OUTLIER = "REJECTED_ISOLATED_OUTLIER"          # retired 2026-10-02 (it used the NEXT observation: lookahead)
REJ_SCALE_UNRESOLVED = "REJECTED_SCALE_UNCORROBORATED"
REJ_SUSPICIOUS = "REJECTED_SUSPICIOUS_COUNT_UNCORROBORATED"
REJ_INVALID_UNIT = "REJECTED_INVALID_UNIT"                 # not a share count ($ / shares column, ADR-member row ...)
REJ_PRE_LISTING = "REJECTED_PRE_LISTING"                   # dated before the priced security began trading
FLAG_LARGE_CHANGE = "LARGE_CHANGE"

EDGAR_COMPLETE = "1996-05-06"   # EDGAR phase-in complete: all domestic registrants file electronically
SAFETY_BOUND_DAYS = 456          # 15 months from as-of; a ceiling, never a validity period
