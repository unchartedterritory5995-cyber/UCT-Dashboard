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

## Live identity continuity (exch-identity-v1, 2026-10-05)

`ticker|delisted_utc` stays the frozen ledger's key and is never rewritten. Live lookups go through a
continuity layer. Each security gets an immutable SID (`TICKER@first-session`), and everything else is a
versioned attribute: tickers, reference keys (tagged by snapshot), composite-FIGI/CIK observation counts,
and learned delisting dates (with the snapshot that taught them).

- **Assignment rules** (`tools/breadth_exch/identity/identity_model.py`; causal; evidence = run-level
  modal FIGI/CIK, so single-day provider glitches cannot move it):
  - The holder continues.
  - **S1:** a gap of more than 5 sessions needs positive evidence (FIGI, else CIK).
  - **S2:** an ended record plus a different record means a new listing, unless the FIGI matches.
  - **S3:** a FIGI or CIK swap without a gap means a new security.
  - **Reattach:** a FIGI (else CIK) match to a recently ended SID is a rename or glitch recovery.
  - A learned delisting date NEVER creates a SID.
- **Bridge:** (ticker, session) → holder SID → the accepted ledger rows of that SID's keys FOR THIS
  TICKER that cover the session. None cover → UNRESOLVED; two cover → CONFLICT (fail closed). The
  vintage's own key is never consulted.
- **CIK-only is not acceptable.** CIK is company-level; share classes and junk-shared CIKs merge.
- **Accepted limitations.** Old share-class reshuffles without FIGI (e.g. GOOG 2014) cannot be
  separated. A de-SPAC that receives a new FIGI (HVII→ONEN) is a new security.
  Neither affects breadth, because venue is per-session evidence.

## Live leg (2026-10-05) — built; first authoritative append BLOCKED on one owner decision

- **Pipeline** (`tools/breadth_exch/exch_live_leg.py`, `live_session_worker.py`, `live_core.py`):
  - **Owner vintage:** each session uses the vintage the US V2 producer published it from (its own
    `state.db` record), cross-checked against the publication provenance. The copy used is hash-verified in
    an exchange-owned archive, `/data/_audit/exch_v1/live_v1/vintage_archive`. It never falls forward.
  - **Preflight:** the unmodified V2c2 preflight runs against `pinned/breadth_exch_live_pins.json`, which is
    the V2c2 pins with exactly 3 declared overrides — the `unchanged` patch.
  - **Membership:** sessions through the frozen ledger's last session use the accepted ledger rows via
    `identity_model.Bridge`. After that, live venue evidence decides: the session's dated listings plus its
    SIP tape, through the accepted `classify()` rule table.
  - **Compute and validate:** each session is computed twice. Validation is independent of the engine, and
    the session's US rows must equal the US V2 publication.
  - **Commit:** one atomic transaction per session, completion marker last.
  - **Derived:** AD/MCO/MCS continue from the frozen boundary state.
- **Archive → compute remap.** The engine requires the manifest's grouped `dir`. A copy of the archived
  inputs is rewritten in exactly 3 declared fields. The tables the engine rebuilds must equal the archived
  ones except for their cache keys.
- **Retention.** The producer keeps 3 vintages. The live leg archives every ready vintage on each run, so
  it must run before an owner vintage is pruned. `p202609292209` (owner of 09-25 and 09-28) was pruned
  before the archive existed.
- **OPEN DECISION.** Under the first-containing rule, 09-25 and 09-28 are irreproducible, so the
  append-mode candidate refuses with `OWNER_VINTAGE_MISSING`.
  - Proposed: declare `p202609302026` (the earliest surviving vintage containing them) as the substitute
    for exactly those two sessions.
  - It reproduces the published US V2 rows byte-for-byte (35/35 on each day).
  - The exchange rows are identical under any surviving vintage.

## Declared historical owner-vintage substitution (owner-approved 2026-10-05) — the first authoritative append

- **What it is.** `tools/breadth_exch/pinned/breadth_exch_owner_vintage_exceptions.json`, with sha256 `3ddf3ac7…`
  pinned in `exch_live_leg.py`. It covers EXACTLY two sessions:
  - 2026-09-25 and 2026-09-28: true owner `p202609292209` (pruned by the producer before the archive existed;
    its publication hashes are bound); compute substitute `p202609302026` (its archived input, reference
    and SHA256SUMS hashes, and `last_session`, are bound).
- **What it is not.** It is NOT a selection rule. It is consulted only after `owner_vintage` refuses
  `OWNER_VINTAGE_MISSING`. Any other missing owner still fails closed, and nothing falls back to a later,
  earliest-surviving or latest vintage.
- **Equivalence proof.**
  - The substitute reproduces the producer's published US rows byte-for-byte (35/35 on each day).
  - Exchange membership and rows are identical under `p202609302026`, `p202610012031` and `p202610022300`.
- **Honest provenance.** `live_session.vintage` is the owner of record (`p202609292209`), `compute_vintage`
  is the substitute, and `vintage_exception` holds the full declaration. `STATUS.json` lists the declared
  exceptions used.
- **Authoritative candidate.** `/data/_audit/exch_v1/live_v1/candidate/exch_live_candidate_v1.db`, built by
  code `03a78ad30`, covers 2026-09-25..2026-10-02 (6 sessions), state CURRENT. NOT member-authoritative.

## ⛔ HARD REQUIREMENT for the scheduling / authority gate

The US V2 producer keeps only its 3 newest vintages (`KEEP_VINTAGES=3`). The exchange live leg archives every
READY producer vintage each time it runs. The schedule MUST guarantee that run happens before the producer can
prune an owner vintage. That means at least once per (KEEP_VINTAGES − 1) producer publications, and
practically after every producer publication.

This is how `p202609292209` was lost, and `p202609302026` was pruned on 2026-10-05, after it had been archived.
Member scheduling must not ship until this guarantee is enforced (and alarmed). The producer's retention is
unchanged; changing it needs separate authorization.
