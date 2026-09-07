# Bull Flag Corpus C -- fresh, out-of-sample validation holdout

Built AFTER the stale-pole-top fix (commit fb4538bc2) was already committed,
from a sample fully disjoint from Corpus B (different seed 20260906202 vs
Corpus B's 20260906101; different as-of offsets (0, 45, 90, 180, 270, 340); wider
universe sample 1000). The implementer must not tune the
detector after seeing this corpus's blind judgments -- its purpose is
independent validation, not another regression-fixing round.

- Universe sampled: 1000 tickers of 4293 total.
- Tickers scanned: 41. Windows evaluated: 242.
- FIRED pool found: 36 (sampled 12). NOT-FIRED pool found: 206 (sampled 14).
- Total corpus size: 26 cases.
- Repo commit at build time: fb4538bc2 (post-fix).

**GROUND_TRUTH_STATUS: PENDING** -- a blind judge with zero access to
detector source, `pipeline_trace`, or `detector_fired` must adjudicate
before any unblinding, using the already-certified two-view harness
(structure: last 90 bars; detail: last 45 bars).
