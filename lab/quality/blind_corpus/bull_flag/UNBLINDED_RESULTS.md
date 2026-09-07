# Bull Flag — Unblinded Cross-Reference (Judge 1)

Cross-references the already-frozen `ADJUDICATION_JUDGE1.md` verdicts against
`answer_key_ingredients.json`'s `detector_candidate_fired` field. Performed
strictly AFTER the judge's verdicts were written — no verdict was revised
after unblinding.

## Confusion matrix (21 non-ambiguous cases; 3 AMBIGUOUS-INSUFFICIENT excluded)

| | detector fired | detector did not fire |
|---|---|---|
| **judge POSITIVE** | TP = 6 (0000, 0001, 0007, 0015, 0020, 0023) | FN = 2 (0004, 0016) |
| **judge NEGATIVE** | FP = 4 (0002, 0003, 0006, 0008) | TN = 9 (0005, 0009, 0010, 0011, 0013, 0014, 0018, 0021, 0022) |

**Precision = 6/10 = 0.60. Recall = 6/8 = 0.75.** n=21 (excludes 3 ambiguous:
case_0012 fired=true, case_0017 fired=false, case_0019 fired=true — none
resolved, so none counted either way).

Caveat: single-judge, n=21, one blind corpus, one point in time. Not a
statistically powered estimate — a first independent read, not a certified
accuracy number.

## False positives — diagnosis (NOT fixed)

- **case_0002** (bottoming base after a large decline, no genuine pole) —
  **CONTEXT / IDENTITY RULE**: reads as a reversal base misidentified as a
  continuation flag; the pole-verification step likely doesn't confirm the
  preceding move is a genuine sharp advance rather than the tail of a decline.
- **case_0003** (bounce off a low, no pole) — same class as 0002: **CONTEXT /
  IDENTITY RULE**.
- **case_0006** (blow-off top, >60% retracement of the pole, multi-month) —
  **THRESHOLD / GEOMETRY**: depth/duration gates too permissive for what
  should disqualify a flag (a genuine flag retraces shallowly and briefly).
- **case_0008** (18% deep, choppy, multi-week re-basing) — **THRESHOLD**:
  depth gate too loose, or no orderliness/tightness check.

Dominant read: **pole-verification and pullback-depth thresholds**, not
identity-anatomy, are the weak points among these 4.

## False negatives — diagnosis (NOT fixed)

- **case_0004** (very low ADR ~1.18%; shallow pullback proportionate to its
  own volatility) — **THRESHOLD**: likely an absolute (not volatility-scaled)
  pullback-depth or pole-size threshold excludes a low-ADR name that is
  proportionately valid.
- **case_0016** (judge's own words: "one of the cleanest, tightest
  consolidations in the set") yet the detector never fired — **OTHER /
  HISTORY WINDOW (unconfirmed)**: no candidate root cause is evidenced from
  the blind packet alone; flagged as a genuine open question rather than
  forced into a category, per the owner's no-forcing rule.

## Standing rules honored
No detector code touched in this pass. The corpus (packets + answer key +
adjudication + this cross-reference) is preserved as EVIDENCE, not tuned
against.
