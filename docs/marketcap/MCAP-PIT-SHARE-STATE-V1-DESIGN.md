# Market Cap / PIT Share State V1 — design

Status: Gate A (design), 2026-09-30. Owner rulings 1–12 (2026-09-30) govern. Fundamentals V5 stays frozen and
unchanged; this is a NEW versioned dataset downstream of it. No production consumer changes in this project.

## 1. Architecture

```
SEC evidence (XBRL companyfacts, filing cover R-files, pre-XBRL filing text, IPO prospectuses)
  + reference identity (SEC submissions, dei:TradingSymbol/Security12bTitle, Massive ticker reference)
  + split ledger (Massive splits, per security, bounded to its listing interval)
      → observations (every candidate, with provenance, validated)
      → share STATE per economic security (selected, supersession chain, invalidation)
      → class structure (listed / convertible / voting-only / unresolved) + ADS ratios (time-aware)
      → CANONICAL MARKET CAP ENGINE (server) × daily split-adjusted close per listed security
      → company and security capitalization series + a reason code for every missing day
      → consumers (chart thin consumer first, others shadowed then migrated deliberately)
```
Package `api/services/marketcap/`. Dataset `MCAP_V1`, one immutable SQLite build per run + manifest.

## 2. Identity (minimum durable layer)
- `issuer_id` = `cik:<CIK>` (SEC registrant).
- `security_id` = `<issuer_id>:<class_key>`; `class_key` = the XBRL class member when the issuer reports classes
  (`us-gaap:CommonClassAMember`, `goog:CapitalClassCMember`), else `COMMON`; a depositary security is
  `<issuer_id>:ADS` linked to its underlying ordinary class.
- `ticker_map(ticker, security_id, start, end, evidence)`: a TIME-BOUNDED mapping. `start` = the current security's
  listing boundary: Massive `list_date` **only when the Massive record's CIK equals the issuer's CIK**, corroborated by
  SEC evidence (earliest `dei:TradingSymbol`, 8-A/424B/IPO filings, first filing). Bars before `start` are refused:
  `TICKER_REUSE_DIFFERENT_ISSUER` (a prior issuer's history under the same ticker) or `NOT_YET_LISTED`.
- Bars are never rewritten; the engine simply refuses bars outside the security's listing interval.

## 3. Evidence and precedence
Every observation keeps: issuer, security, class, as-of date, public/knowledge timestamp, raw value, normalized value,
unit, split basis, ADS ratio (if any), source type, accession, form, tag/fact or text location, validation status,
confidence, selection reason.

| Rank | source type | concept | notes |
|---|---|---|---|
| 1 | `COVER_XBRL` | dei:EntityCommonStockSharesOutstanding (class-dimensional or single) | exact actual outstanding at cover date |
| 2 | `COVER_TEXT` | cover-page statement parsed from pre-XBRL filing text | exact; refused when ambiguous |
| 3 | `BALANCE_SHEET_XBRL` | us-gaap:CommonStockSharesOutstanding (non-dimensional) | period-end actual outstanding; may be rounded (6-K millions) |
| 4 | `IPO_PROSPECTUS` | "shares to be outstanding after this offering" (S-1/F-1/424B) | post-offering capitalization, excludes the unexercised option |

Never evidence: weighted-average shares (EPS denominators), shares ISSUED (includes treasury), shares authorized,
provider historical share fields (Massive `weighted_shares_outstanding` is today's value — proven non-PIT).

Selection at knowledge time T: among validated observations public by T, the one with the LATEST as-of date; ties by
rank. Two observations for the same as-of that disagree beyond the coarser one's rounding → `SOURCE_CONFLICT`
recorded; rank decides; a conflict > 10% quarantines that as-of.

## 4. Validation (bad XBRL)
- positive, finite, share unit; issued/authorized/weighted concepts excluded by construction;
- scaling: a jump by ≈10^±3 or 10^±6 (±1%) versus the previous accepted state, not explained by the split ledger →
  rejected (`BAD_SCALE`);
- split-restated values: a balance-sheet value published after a split whose ex-date falls between its as-of and its
  publication may already be on the post-split basis; both hypotheses are evaluated and the one consistent with the
  previous accepted state is used; unresolvable → rejected (false negative over false positive);
- amended filings supersede the original for the same as-of (later public time, same rank);
- a change > 3× (after splits) is kept but flagged `LARGE_CHANGE` for review.

## 5. PIT and state validity
- An observation is KNOWN from its filing's public time (V5 rule: `max(acceptance, filing date 06:00 ET)`); a daily
  bar D uses states known by D 16:00 ET. As-of date and knowledge time are separate fields; a March 31 count published
  May 10 is invisible before May 10.
- The last defensible state stays authoritative until SUPERSEDED (a newer known observation), or INVALIDATED (the
  security's listing interval ends; identity change), or it exceeds the SAFETY BOUND: 456 days (15 months) after its
  as-of date → `SHARE_STATE_STALE`. The bound is a ceiling against pathological carry, not a validity period.
- Splits never invalidate: shares and prices are both normalized to today's basis (below).

## 6. Price / share basis
UCT daily bars are split-adjusted to TODAY's basis (verified: AAPL 2020-08-28 = 124.81; NVDA 2024-06-07 = 120.89;
no dividend adjustment). Every share observation is converted to today's basis with the security's split ledger
(splits with ex-date after the as-of date and within the listing interval). A mechanical split therefore moves neither
side: golden NVDA 2024 (10:1), reverse-split cohort.

## 7. Structures
- **Single class**: security = COMMON; market cap = close × state.
- **Multiple listed classes** (GOOGL/GOOG, BRK.A/BRK.B): Σ(class state × that class's own close).
- **Unlisted class convertible 1:1 (or 1:N) into a listed class**: valued at that listed class's close × ratio, ONLY
  with authoritative filing text stating the conversion (provenance kept; the structure is taken as valid between the
  earliest and latest filings that state it).
- **Voting/founder-only classes** (text: no economic/dividend rights): excluded — no double counting.
- **Variable conversion, Up-C / exchangeable / partnership units, tracking stock, non-equivalent classes**:
  `COMPLEX_CAPITAL_STRUCTURE_UNRESOLVED` (represented, measured, returned for owner rulings).
- **ADR / ADS**: ADS-equivalent shares = ordinary shares / (ordinary per ADS), time-aware from `dei:Security12bTitle`
  or 20-F cover text; curated registry entries only with full provenance; unknown ratio → `ADR_RATIO_UNRESOLVED`.
- Company vs security: `company_market_cap` (the product "Market Cap", identical under GOOG and GOOGL) and
  `security_market_cap` (class × own price) are distinct outputs.

## 8. IPO / inception and old history
- IPO: the last S-1/F-1(/A) or 424B public by first trading day giving the post-offering count establishes inception
  capitalization; the 424B supersedes on publication; the first periodic report supersedes both.
- Pre-XBRL (≈1996–2010): EDGAR full-text submissions (first 80 KB), a deterministic cover-page statement parser with
  class, scale and date extraction; validated against the XBRL overlap (2009–2012 filings that carry both).
- Before any authoritative evidence: `PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE` (listing before EDGAR coverage) or
  `PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE`.

## 9. Coverage and reason codes
Every missing trading day carries one code: PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE, PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE,
TICKER_REUSE_DIFFERENT_ISSUER, IPO_CAPITALIZATION_UNRESOLVED, MULTI_CLASS_UNRESOLVED, COMPLEX_CAPITAL_STRUCTURE_UNRESOLVED,
ADR_RATIO_UNRESOLVED, SHARE_STATE_STALE, CORPORATE_ACTION_HOLD, SOURCE_CONFLICT, QUARANTINED, WITHHELD, NO_VALID_PRICE,
NOT_YET_LISTED, DELISTED, BUG, OTHER_EXPLAINED. Coverage is reported two ways: absolute (first legitimate issuer trading
day → present) and authoritative-evidence (first defensible state → present). Target: zero unexplained internal gaps.

## 10. Versioning
Build = `MCAP_V1-<utc>`; SQLite with tables `security`, `ticker_map`, `observation`, `state`, `class_structure`,
`ads_ratio`, `coverage`, `manifest`; deterministic ordering; manifest records code commit, input file sha256s
(companyfacts bulk, submissions, fetched filings cache, reference pull, split ledger, bars export) and the output sha256.
Rollback = previous build. V5 hash checked before and after every build.

## 11. 2026-10-01 amendments (found by the universe audit; the owner rulings are unchanged)

- **Acceptance authority (no lookahead).** data.sec.gov submissions `acceptanceDateTime` can be EDGAR Eastern time labelled "Z" (the Fundamentals V5 acceptance audit). At the 16:00 ET close that is a one-day lookahead. `inputs.db` had 5,906 such filings, 3,712 of them with share facts. Evidence public times now come from `acceptance.py`, in this order:
  1. the corrected V5 filing table;
  2. the EDGAR acceptance record (header, else the index "Accepted" field; America/New_York → UTC);
  3. the later of the two readings of the submissions value.

  The build refuses to run without `acceptance.db`.
- **Combined filings.** A cover is a sequence of entity blocks (`dei:EntityCentralIndexKey`), and only the filer's block counts. `dei:LegalEntityAxis` / `srt:ConsolidatedEntities` members are other registrants, never share classes. Several different values from one filing for one as-of date are all refused; the old code picked the smallest (AEP 2011–2015 took a subsidiary's 1,400,000; UAL 2010 took 205).
- **Instrument kind.** A ticker is a common-equity component only if its Massive type is equity AND its name does not describe a preferred, warrant, right, unit or debt instrument. GOOGN, a depositary share of Series B Mandatory Convertible Preferred, had been priced as Alphabet's class B.
- **Split-ledger-gap hold (fail closed).** The adjusted bars include splits that Massive's split ledger lacks, mostly before 2003. When consecutive states move by a clean factor k or 1/k while the adjusted price is continuous and the cap jumps, every earlier day is withheld as `CORPORATE_ACTION_HOLD`. No factor is inferred. Restoring that history requires authoritative split evidence (owner decision).
- **Evidence extraction.**
  - Text covers: new "N million" table and statement shapes. The text harvest now covers all 118,908 pre-XBRL periodic filings; it had stopped at 82,051.
  - IPO prospectuses: new summary-table shapes. A count stated assuming the option is exercised is refused. The builder considers the last three registration statements, because a final amendment is often exhibits-only.
  - ADR ratios: also read from the depositary's F-6 / F-6EF, including the "five (5)" form.
- **Audit and baseline.** `baseline.py` reproduces production Market Cap exactly. `universe_audit.py` measures BEFORE vs V1 on identity-safe intervals, with anomaly classes A–P and S and sub-reasons for internal stale gaps. `session_report.py` gives a session-level before/after for one security.
