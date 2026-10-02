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

## 12. 2026-10-02 correction pass (owner decisions A–D; the first shadow's 63 order-of-magnitude blockers)

Owner decisions: (A) fix the 63, never weaken the scanner; (B) historical splits only from AUTHORITATIVE statements,
price/share discontinuities detect and corroborate but never manufacture a factor; (C) successor lineage only where a
pure reorganization is PROVEN, a boundary for mergers, hold otherwise; (D) the 15-month ceiling stays.

- **Point-in-time validation (state.py).** Every decision about an observation uses only what was public by its own
  known_from; when it needs corroboration it becomes usable only once the corroboration is public (`effective_from`).
  The old outlier rule (rejected a value because the NEXT report reverted — lookahead) and basis decisions from a
  later observation are retired. A refused count is a BLOCK: it proves the state in force is superseded, so older
  states never carry across it. Same-as-of contradictions revoke the earlier count from the moment both are public.
- **Discontinuity and scale.** A ≥3x move against the state in force (or, with none, inside its own filing) needs an
  independent observation (another channel, or another report) within 1.5x and 200 days; uncorroborated →
  SHARE_COUNT_SCALE_UNRESOLVED. An exact power-of-1,000 gap is a unit-error signature: corroboration must come from
  ANOTHER filing, and a count 1,000x away from the filings on both sides is withheld (never rescaled).
- **Suspicious counts.** A reported count below 10,000 shares needs corroboration from another channel (a repeated
  placeholder is not evidence) → SUSPICIOUS_SHARE_COUNT.
- **Units / members.** "$ / shares" columns, ADR/ADS members and depositary members are not share counts
  (REJECTED_INVALID_UNIT). A dimensional generic common member beside other class members is a class ("CS"), never the
  total; only generic members map to COMMON (UHAL's "NonvotingCommonStockMember" was being discarded).
- **Split semantics.** The ledger applied to a ticker's shares holds only splits on/before its last bar (KUST). A split
  between as-of and publication is decided by filing-text evidence or a decisive state in force, otherwise refused.
  A count dated before a reverse split is not carried across it when equity issuance was registered between the count
  and the split (REVERSE_SPLIT_RECOUNT_PENDING). A split-like price step is an event only when the counts on both
  sides confirm it (MEASURED: 1,445 of 1,904 price-only steps were glitches).
- **Historical split evidence (splitev.py).** Detected split-ledger gaps (per class, and company-level where a new
  class first appears — Google's 2014 class C dividend) are lifted only by the issuer's own XBRL
  StockholdersEquityNoteStockSplitConversionRatio(1) or filing-text statements with the same factor dated inside the
  transition; a dated statement of another factor marks the candidate CONTRADICTED. Everything else stays
  HISTORICAL_SPLIT_EVIDENCE_UNRESOLVED.
- **ADR / ADS.** The listed security is an ADS only while the filings' 12(b) titles say so (RCEL, CD, MOB stopped being
  ADSs); a ratio statement must belong to this listing (≤120 days before it), never crosses an ADS ledger event, a
  trading break (> 90 days without bars: LATAM 2020→2025), or a ≥3x move in the ordinary count (DXF subdivision); a
  later statement speaks back at most 400 days; a title UNCHANGED across ADS events without the ordinary count moving
  by that factor is stale (SQNS) and dropped; inverse statements ("twenty ADSs representing one share") parse as 1/20.
  An ADS over several ordinary classes → FOREIGN_MULTI_CLASS_UNRESOLVED.
- **Class economics.** A conversion ratio is a per-share term ("each share … convertible into one"), never a
  transaction narrative (VTIX "1,000,000 shares … converted into 1,000,000 shares" was read as ×1,000,000), and a
  compound consideration (JBS: one share AND one Conversion Share) is not a ratio. Lower-case 2009–2012 entity trading
  symbols tagged under every class are not class listings (anomaly G); the latest filing's mapping wins; two listed
  classes priced by one ticker → MULTI_CLASS_UNRESOLVED.
- **Offering documents (prospectus.py).** 424B1/4/5/7, S-1, F-1, S-3, F-3: ACTUAL counts at a stated date ≤ 60 days
  before the filing, or "outstanding prior to this offering" (as of the document date); never pro-forma "after this
  offering" figures, ADS counts or stale dilution-table counts. Source OFFERING_DOCUMENT_TEXT.
- **Pre-listing.** A count dated before the priced security began trading is not used (only the IPO prospectus speaks
  for the listing day): ELVR carried Sayona's pre-merger 11.5B shares onto the post-consolidation ADS.
- **Successor lineage (lineage.py).** 8-K12B/8-K12G3: PURE_REORGANIZATION requires a reorganization marker, a 1:1
  (class-for-class) conversion statement, an explicit same-assets / same-proportional-ownership statement, no merger
  / acquisition / cash / exchange-ratio markers, and ONE predecessor registrant identified by its Exchange Act file
  number in the SEC registry (never name, never ticker). Its evidence is carried up to the effective date.
  MERGER/SPINOFF/NEW_ENTITY → PREDECESSOR_DIFFERENT_ECONOMIC_ENTITY for earlier days; anything else →
  SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED. A successor whose own registrant record already has periodic filings
  before the effective date (the holdco kept the CIK) needs no lineage.
- **Scanners.** magnitude_scan.py (hard gate B: ≥10x vs Massive as a DETECTOR, classified V1-introduced / production-
  same / shares-agree-price-basis / old last value; history-wide ≥10x vs production), report3.py (BEFORE → FIRST →
  CORRECTED), stale15.py (information only).

### 12.1 Rules added by the corrected shadow's own validation (found by the scanners, fixed systemically)

- **Unit-error LEVEL.** Two levels an exact power of 1,000 apart (±15%): the weaker — min(distinct filings, distinct
  channels) agreeing within 200 days — is withheld, and validation re-runs without it (AMTX / SSYS / HNRG balance
  sheets in thousands; BNTX / CLBK covers ×1000). An exact cover-vs-balance-sheet ×1000 disagreement for the same date
  keeps the cover. Channel identity = source + concept (a rendered member suffix or a text rule's byte offset is not
  another channel: EIG, PENN).
- **Corroboration strength.** A ≥10x move needs another CHANNEL; a ×1000 move another channel AND another filing; a
  reported count below 10,000 another filing AND another channel (pre-closing shells: FTI "1", RBBN / MLCI "1,000").
- **Successor shells.** When lineage applies, the successor's own counts dated before the effective date are dropped
  (ICE 2013 "5 shares"); own registrant history means periodic filings at least a year before it (ETN).
- **ADS.** A Massive-ADR ticker never mixes unconverted ordinary counts (BSAC); a statement filed ≤120 days before an
  ADS event that already states the post-event ratio speaks from the event (Rio Tinto 2010); the stale-title test uses
  RAW ordinary counts (SONY 2024 pass-through 5:1).
- **Ledger splits.** A ledger split is not applied when the last count dated and published before it and the first
  count dated after it agree within 1.5x although the factor is ≥2x — unless the issuer restated a pre-split date by
  exactly that factor after the split (INVA 2013 / VATE 2020 dropped; CTNT 2026 kept). Never for an ADS.
- **Split-like gaps.** Clean factor within 5%; any adjacent share DROP ≥10x with continuous price (ATLX /183, GPUS
  /300, BESS /140); company level where a new class first appears (Alphabet 2014, confirmed by Google's own XBRL ratio
  2.0); price continuity searched up to 60 sessions past defective bars (IVT).
- **Price basis.** A ≥3x share step and a ≥3x price step in the SAME direction on one transition → the days are
  withheld until the price steps back (PRICE_BASIS_INCONSISTENT_WITH_CORPORATE_ACTION).
- **Classes.** A common-only report between multi-class regimes is not a single class (ZDGE); listing-exchange-axis
  and debt / preferred rows are never classes (TAK).
- **Registered issuance.** A 424B / S-1 / F-1 / S-3 / F-3 cover registering ≥3x the share state in force withholds
  that state (ZBAO 2026); never an estimate.
