# VCP Review Rubric — v2 (Phase 3B Lane A)

**Frozen before labeling begins.** Do not modify after any reviewer sees a case.
If a later phase needs a change, create `rubric_v3.md` and record why — never
edit this file in place once cases are being labeled against it.

## Provenance

- **v1** was Phase 2C's rubric (not persisted to disk at the time; recovered
  2026-09-03 from the session's own prior tool-output transcript, since no
  prior phase ever wrote it to `docs/`). v1 used a 3-state Pattern Identity
  (YES / BORDERLINE / NO) and did not separately require citing which specific
  numeric criterion drove a violation.
- **v2** (this file) is authorized by the Phase 3B directive, which explicitly
  requires:
  - a 4th Pattern Identity state, INSUFFICIENT_DATA (v1 had none — a reviewer
    forced to pick YES/BORDERLINE/NO on a chart with too little visible
    history had no honest option);
  - Pattern Identity, Pattern Quality, and Pattern Lifecycle to be visibly
    separate questions (v1 already did this in spirit; v2 makes the structure
    explicit in the schema itself, not just the reviewer's prose).
- Underlying primary-source evidence is unchanged from Phase 2B/2C's Minervini
  research (recovered verbatim from the session's own prior research artifact,
  `03-minervini-vcp-powerplay.md` equivalent — every `[TTLAC]`-tagged figure
  below is a direct quote from *Think & Trade Like a Champion*, 2017).
- Also cross-checked against the CURRENT `api/services/screener/base_catalog.py`
  VCP `Criterion` block (System D's own primary-source citations), which
  independently cites the same Minervini figures with its own `quote`/
  `source_id`/`confidence` fields. Where the two match, that is corroboration,
  not a new source. **This rubric is not owned by either engine** — it was
  built from the primary source directly, the same way Phase 2C did it.

## Evidence tiers on every reference figure below

- **PRIMARY_VERBATIM** — direct Minervini quote, `[TTLAC]`.
- **DERIVED** — computed from his worked examples, not a quote (e.g. the
  0.38–0.75 tightening-ratio band observed across his 5 published footprint
  examples — he never states a number).
- **OURS** — an implementer's choice where the primary source publishes none,
  explicitly marked as such. Never presented to a reviewer as "Minervini says."

## Question 1 — PATTERN IDENTITY

*Is this structurally a VCP at all?* Independent of quality or lifecycle.

- **YES** — the chart shows a genuine prior advance followed by a real
  sequence of contractions that get tighter left to right.
- **BORDERLINE** — some VCP-consistent structure is present but a material
  element is ambiguous, missing, or contradicts the definition (e.g. only one
  clean contraction so far; the "prior advance" is really an isolated spike
  rather than a sustained move; the ratio between the last two contractions
  falls outside a defensible band but not egregiously).
- **NO** — the dominant chart structure is not a VCP (e.g. no genuine prior
  advance to continue; contractions are not tightening; the base is a
  bottoming/repair attempt off a large decline, not a continuation of an
  uptrend).
- **INSUFFICIENT_DATA** *(new in v2)* — the chart/context provided does not
  give enough visible history or resolution to judge Identity at all (e.g.
  the visible window starts mid-formation, or price action is too compressed
  at the chart's scale to read contraction boundaries). Use this rather than
  guessing BORDERLINE when the honest answer is "I can't tell from what I was
  given," not "what I can see is ambiguous."

**Reference criteria (apply as guidance, not mechanical gates — real charts are
messy; use judgment per Phase 2C's proven approach):**

| Criterion | Value | Tier |
|---|---|---|
| Number of contractions | 2–6 (typically 2–4) | PRIMARY_VERBATIM |
| Contraction tightening | each roughly half the prior, "plus or minus a reasonable amount" | PRIMARY_VERBATIM (rule) / OURS (numeric band ≈0.35–0.75, matches System D's own cited band) |
| Base depth (normal) | 10–35%, up to 40% | PRIMARY_VERBATIM |
| Hard depth disqualifier | ≥60% is "off my radar" | PRIMARY_VERBATIM |
| Prior advance required | "already moved up 30, 40, 50 percent or even much more" — a continuation pattern, not a base sitting on a decline | PRIMARY_VERBATIM |
| Volume direction | volume recedes through the contractions ("successively lower... as supply diminishes") | PRIMARY_VERBATIM (direction only — no ratio published) |
| Minimum base duration | **not published** for VCP generally (only for the unrelated 3-C pattern, 3 weeks) | none — do not import a floor from a different pattern |

## Question 2 — PATTERN QUALITY (0–100)

**Only scored if Identity is YES or BORDERLINE.** A separate question from
Identity — a real VCP can still be a low-quality, marginal one.

Consider (per Phase 2C's proven approach, not a formula):
- How cleanly the contraction sequence tightens (closer to the observed
  0.35–0.75 ratio band = higher quality; a jump or a deeper-not-shallower
  final leg = lower quality).
- Trend Template context (price above rising 150/200-day SMA with 150 above
  200, per the two conditions Phase 3A's production fix now enforces on
  System A — `[TTLAC]`: "Stock price is above both the 150-day... and the
  200-day moving average"; "The 150-day moving average is above the 200-day
  moving average"). This is Minervini's own precondition, not a house rule.
- Volume behavior at the pivot (below the 50-day average with an unusually
  quiet day or two — `[TTLAC]`: "volume that is below the 50-day average,
  with one or two days when volume is extremely low").
- Proximity to the pivot / how "actionable" the current position in the base
  is (freshly tight and unbroken vs. already extended past the pivot).
- How clean or noisy the visible price action is generally (one violent
  single-leg drop reads as an event, not a graceful contraction).

## Question 3 — PATTERN LIFECYCLE

Independent of both Identity and Quality — where is the structure right now?

`EMERGING` · `DEVELOPING` · `MATURE` · `TRIGGERING` · `CONFIRMED` · `EXTENDED`
· `FAILED` · `INVALIDATED` · `NOT_APPLICABLE` (use when Identity is NO or
INSUFFICIENT_DATA).

## Question 4 — CONFIDENCE (0–100)

Reviewer's own confidence in their Identity classification specifically (not
Quality, not Lifecycle).

## Question 5 — REASONING

Short, evidence-based. Must cite specific visible chart features (contraction
depths/ratios as read off the chart, trend-template facts from the supplied
numeric context, volume behavior) — not vibes.

Also required per case, matching Phase 2C's proven structure:
- `critical_features` — the 3–5 facts that most drove the Identity call.
- `violations_or_concerns` — anything cutting against the call, even when the
  overall verdict is confident (a real YES can still have a noted weakness).

## Blinding rules (unchanged from Phase 2C, restated for v2)

Reviewers are told: the chart is real, current, unannotated (no detector
markers), and they must judge it as if seeing it cold. They are explicitly
told they will NOT be informed which detector(s) fired, whether either fired,
which engine is "more mature," or any future price action. Do not convert
model consensus into human ground truth — these are independent expert-review
proxies, not human raters (per the Phase 2C epistemic rule, still governing).

## Reviewer perspectives used this phase (4, not 5 — see Phase 3B report §3)

1. **Minervini/VCP-native growth trader** — reads the chart the way a SEPA-style
   scanner would, trend-template first.
2. **Systematic/classical technical analyst** — Edwards & Magee lineage,
   structure-first, no VCP-specific jargon.
3. **Quantitative/rubric-literalist reviewer** — applies the numeric reference
   bands as literally as a static chart allows.
4. **Adversarial false-positive hunter** — actively looks for reasons a
   superficially-bullish chart is NOT a valid VCP.

*(Phase 2C's 5th lens, "generalist momentum trader," is dropped for this
larger-N phase — reasoning in the Phase 3B report: independence across
genuinely distinct methodologies matters more than raw reviewer count, and
this lens overlapped heavily with #1 and #2 in Phase 2C's own transcript.)*
