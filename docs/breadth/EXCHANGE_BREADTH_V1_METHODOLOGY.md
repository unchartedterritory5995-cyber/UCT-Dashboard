# Exchange Breadth V1 (NYSE / NASDAQ) — methodology decisions and frozen artifacts

Owner decisions recorded 2026-10-05, after the full historical validation of 2026-10-05.

## Population and venue

- **Population.** The US Breadth V2 operating-equity population (V2c2 rule), unchanged.
- **NYSE.** Means NYSE-listed (dated XNYS listing). NASDAQ means Nasdaq-listed (SIP tape UTP, or a dated
  XNAS/XNGS/XNMS/XNCM listing).
- **Never folded into NYSE.** NYSE American (XASE), NYSE Arca (ARCX), Cboe (BATS) and IEX are never folded into NYSE.
  A name the evidence cannot place is UNRESOLVED and belongs to neither exchange.
- **Venue source.** Membership by session comes from the point-in-time venue ledger `venue-ledger-v1`, content sha
  `72eef1c26c47bafa15648fc864ddd1ac8593b4312cc92444ccc7b59c0b23193d`. It is built from dated venue lists plus SIP tape.
  Tape is primary for Nasdaq-vs-not, and NYSE is only ever asserted from a dated XNYS listing.

## Canonical starts (ACCEPTED)

| exchange | canonical start | basis |
|---|---|---|
| NASDAQ | **2008-01-02** | tape-backed; no-lookahead truncation shows 0 differences |
| NYSE | **2009-06-11** | intentionally FAIL-CLOSED |

**Why NYSE starts at 2009-06-11.** From 2008-11 to 2009-06-10, securities drop out of the dated venue lists entirely.
They reappear on 2009-06-11; the XNYS list itself does not shrink. Many of them are NYSE American or Arca names.
We do not manufacture earlier NYSE history by assuming non-Nasdaq = NYSE.
The likely-NYSE share left unplaced before the start averaged 0.39% and peaked at 0.83%. The ceiling is 3.4%.

## Identity model

- **Historical V1.** `ticker|delisted_utc` is ACCEPTED for the FROZEN HISTORICAL V1 artifact only. Validation found:
  - 0 overlapping lifetimes;
  - 0 venue contamination (venue is per-session evidence);
  - ticker reuse did not corrupt the output.
- **Live leg.** The model is NOT accepted for the live leg. A later reference snapshot can add a `delisted_utc` and
  re-key an identity. On the 2026-10-02 vintage, 10 names (13,802 member sessions) were re-keyed.
  The live leg is BLOCKED until identity keys are stable across reference updates.

## Derived series (locked)

- **{X}:AD — adline-v1.** level(t) = level(t-1) + (ADV − DEC), with level 0 before the exchange's first session.
  A hole holds the level. No vendor seed.
- **{X}:MCO — ratio-adjusted McClellan.**
  - Input: R = (ADV − DEC)/(ADV + DEC) × 1000, with unchanged excluded.
  - Trends 0.10 and 0.05 from a zero seed; MCO = fast − slow. Holes advance neither trend.
  - Burn-in: the first 120 valid sessions are not published. First publish is the **121st** valid session:
    NASDAQ **2008-06-24**, NYSE **2009-12-01**. (The 2026-10-05 validation report listed the 120th sessions,
    2008-06-23 and 2009-11-30, by mistake.)
- **{X}:MCS.** Summation of MCO from a DECLARED epoch, which is the MCO first-publish session. Base 0 on the epoch,
  and the epoch's own MCO is not added. Holes hold the level. No vendor anchor (no NYSI/NASI matching).
- **Vendor names.** NYMO/NYSI/NAMO/NASI/NYAD/NAAD are search aliases only, never canonical identity.

## Frozen artifacts (runner `/data/_audit/exch_v1/final/`, mode 0444, read with `?immutable=1`)

| artifact | sha256 |
|---|---|
| `breadth_exch_v1_FINAL_v20260924f_VALIDATED_FROZEN_2026-10-05.db` (historical) | `e65b2af0779d5ff8cdce8668f866f0889e070207a260e88a64cd9d38c37462a0` |
| `breadth_exch_v1_DERIVED_ad-mco-mcs_FROM_e65b2af0_VALIDATED_FROZEN_2026-10-05.db` (derived) | `f9ed6966dfd7d6d5459761f06f8224cfc1f1807e42a9f088279bc8b164634d86` |

**Historical lineage.** Original candidate `breadth_exch_v1_v1.db` (`1ba6b1a8…92430e`, preserved). Repair `40ef82c6f`
added exactly +4 `exch_session` rows (2010-09-16, 2021-03-02, 2022-11-07, 2025-06-27) that the pump race had lost
(fixed in `exch_counts`, commit `3af6933de`). Nothing else changed.

**Status.** Neither artifact is member-authoritative or published. Registry, authority and the live leg come later.
