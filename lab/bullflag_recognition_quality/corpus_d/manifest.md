# Bull Flag Corpus D -- final, small, bounded, fresh out-of-sample holdout

Built for the FINAL Bull Flag recognition-correctness closure pass. The
detector is UNCHANGED since Corpus C (fix commit fb4538bc2; verified via
`git diff fb4538bc2 -- bull_flag.py` = empty) -- neither of the two
owner-authorized "hard semantic defects" (breakout-bar volume pollution;
already-broken-down flag eligibility) was implemented as code, because both
require a "pre-move reference range" primitive (a way to identify the
established range BEFORE a tail-end breakout/breakdown move) that does not
exist anywhere in bull_flag.py or its primitives -- inventing one was
explicitly out of scope per the owner's own STOP-and-report instruction.

This corpus's role is therefore the FINAL general check: surface any
remaining MAJOR, hard, objectively-provable correctness defect, or confirm
the family is ready to close with residual limitations honestly documented.
Deliberately bounded (small n) per explicit instruction -- disjoint sample:
different seed 20260907303 (vs Corpus B's 20260906101, Corpus C's 20260906202);
different as-of offsets (15, 100, 220, 300); smaller universe sample
700.

- Universe sampled: 700 tickers of 4293 total.
- Tickers scanned: 40. Windows evaluated: 156.
- FIRED pool found: 18 (sampled 6). NOT-FIRED pool found: 138 (sampled 8).
- Total corpus size: 14 cases.
- Repo commit at build time: 8990aa3e2.

**GROUND_TRUTH_STATUS: PENDING** -- a blind judge with zero access to
detector source, `pipeline_trace`, or `detector_fired` must adjudicate
before any unblinding, using the already-certified two-view harness
(structure: last 90 bars; detail: last 45 bars).
No detector tuning is authorized after Corpus D's judgments land, per
standing instruction.
