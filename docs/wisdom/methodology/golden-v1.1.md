---
id: WISDOM-GOLDEN-V11-METHODOLOGY
title: Golden set v1.1 — NULL segments, and how an absence was verified
status: current (auto-verified; every NULL row is PROVISIONAL — owner veto pending on RQ-v11-001)
generated: 2026-09-14
stream: S-D / golden (W1 §2.4, CONTRACTS §6.4) · Wave 1.5 item 5
---

# Golden set v1.1 — NULL segments

**Quote-free by design.** This repository is public. Nothing here quotes a transcript, a Discord
message or a Sunday Scans body. The labels live in the gitignored
`data/wisdom/golden/golden-v1.1.jsonl`; the committed, quote-free locator file is
`docs/wisdom/golden/golden-v1.1.provenance.json`.

## 1. What v1.1 is, and the hole it closes

| | |
|---|---|
| Rows | **169** = every golden-v1 row **byte-identical** + **44 NULL segments** |
| Base | `golden-v1.jsonl`, frozen at `db3475c814eed4f8…` — **not modified**; v1.1 is a new file |
| NULL status | 44 provisional · 0 confirmed (§4 says why, and why that is the honest answer) |
| NULL split | dev 26 · test 18 |
| NULL streams | sunday_scans 16 · zoom_live 16 · discord 10 · workshop 2 |
| Types asserted absent | all six, on all 44 rows |

⛔ **The hole.** `golden.match_segment` scores a prediction only where its quote overlaps a
labelled quote. On the 2026-09-14 dev-split gate the extractor kept **882** records and **119**
were scored; the other **763** were claims about paragraphs nobody had labelled. A record
*invented* about unlabelled text could not appear as a false positive at all, so the headline
precision described about **14%** of the output.

⭐ **A positive label can only ever make a MISS visible. Only an anti-label makes an INVENTION
visible.** That is the whole reason this file exists.

## 2. The representation, and why this one

A NULL row is a **segment-scoped absence assertion**:

```
kind: "null_segment"          the ONE discriminator
null_for: [ … record types ]  the SCOPE of the assertion
expected: []                  no label
record_type: null             it is not a record of any type
quote / locator               a real span of a real sample, exactly as a positive row
```

The row contributes a **span and no expectation**. A prediction landing in that span whose
`pre_entity_type` is in `null_for` is a **false positive**; a prediction of any other type stays
**unscored**.

- **Why `kind`, not the shape of `expected`.** Shape-sniffing ("`expected` is a list, so this must
  be an anti-label") would make a row that *lost* its `expected` key read as a deliberate
  assertion of absence — and an accidental NULL row turns every correct extraction inside it into
  a false positive. That is the worst direction to be wrong in, so the discriminator is declared.
- **Why `null_for` is a scope and not a boolean.** "There is nothing here" is not a claim anyone
  can verify. "There is no CALL here, and here is the check" is. A prediction of an undeclared
  type is left alone: the labeller did not answer that question, and answering it for them is how
  an instrument manufactures a finding.
- **Why no author.** An absence is a property of the TEXT, not of a speaker. Naming one adds
  nothing the locator does not already carry — and three of the selected zoom segments sit under
  the shared **"Uncharted Territory"** Zoom label, which §8a.2 declares *an alias of nobody*. A
  NULL row therefore carries `author_id: null` and `attribution.method: "not_applicable"`, while
  the speaker label and section path stay in the locator.
- **Why the whole segment is the quote.** `place()` puts a row in the tightest segment containing
  its quote; making the quote the entire segment text means "a prediction inside this NULL
  segment" is exactly "a prediction anywhere in it", with no interior gap the extractor can aim at.

## 3. How the 44 were sourced

Every NULL row quotes **real text from a real sample with a real locator**, derived — never typed
— from the verifier's own `load_source` machinery. Candidates came from segmenting the entire
sample corpus with the production segmenter (`golden.segments_for_sample`), keeping only segments
whose text occurs **exactly once** in the normalised source, then screening (§4) and reading each
survivor.

What they are: weekly earnings-calendar lines, "on vacation / away from the desk" notices, a
TC2000 outage apology, section headers with links and no data, community-promo boilerplate, Zoom
housekeeping ("I'm gonna hop off", "refilling my coffee", "go touch some grass"), family and
sports banter, a workshop's opening thank-yous, and Discord link-drops and shout-outs.

⚠️ **Deliberately homogeneous in one place.** Nine of the sixteen Sunday Scans rows are
earnings-calendar sections, because that is what administrative Sunday Scans text mostly *is*.
Read a per-type null FP rate with that in mind.

## 4. How an absence was verified — and the two types where it could not be

⛔ **AN ABSENCE IS NOT MECHANICALLY DECIDABLE IN GENERAL**, and v1.1 does not pretend otherwise.
What is mechanical is a set of screens, each of which must come back empty
(`tools/wisdom_golden_verify.py::null_screens`):

| Screen | Settles | Mechanical? |
|---|---|---|
| no cashtag, no ticker-shaped token, no company name, no sector word | CALL · NEGATIVE_CALL · MENTION | ✅ each needs an instrument (R1, R3) |
| the above **plus** no price token | LEVEL | ✅ a LEVEL needs a stated price |
| principle / market-signal vocabulary absent | PRINCIPLE · MARKET_SIGNAL | ❌ **a screen, not a proof** |

**A generalisable teaching statement has no lexical signature**, so absence of vocabulary is not
absence of meaning. PRINCIPLE and MARKET_SIGNAL therefore rest on a screen *plus a read*, which is
a judgement — so **every row that declares them is `provisional`**, and:

> ⛔ **A false positive scored against PRINCIPLE or MARKET_SIGNAL in a NULL segment is a REVIEW
> ITEM, not a verdict.** The four instrument-bearing types are the ones whose null false-positive
> counts can be read as measurements.

All 44 rows declare all six types, so all 44 are provisional. `check_null` still implements the
confirmed branch, and the self-check exercises it on a synthetic row declaring only the four
mechanical types — a rule with no reachable failure path is not a rule.

⛔ **The instrument screen is NOT `segmenter.detect_mentions`.** That function is
**universe-gated**: an uppercase token counts only when `cap_universe.json` knows it. The first
pass of this selection used it and passed messages naming **SOXL, CBRS, ETHU, NBIL, SNDU and
KORU** as "no instrument here". *Absence of knowledge is not absence of a ticker*
(`lesson_a_symbol_universe_does_not_settle_a_ticker_match`). The screen now rejects on the
**shape** of a token and adds company names and sector words, because the extractor resolves
"Micron" and "semis" to instruments no uppercase regex will ever see. It rejected
`EARNINGSHUB.COM` during the build, on "COM".

### Review queue — one class, one ruling

v1 requires a review item per provisional record. Forty-four rows provisional for the *same*
reason would file forty-four copies of one ruling, and a ruling repeated is a ruling unproved
(`lesson_a_guard_repeated_is_a_guard_unproved`). Each provisional NULL row instead names the
class-level ruling **`RQ-v11-001`** in `evidence.review_item`, and `check_null` fails if rows
resting on the same non-mechanical methods name *different* rulings — so nobody can quietly mint a
second, softer ruling for a row they wanted to keep.

## 5. What the verifier checks (`check_null`)

Everything `check_v1` checks about a locator and a quote — the quote occurs exactly once, the
`external_ref`, cue time and speaker label, section path and paragraph, or channel and message id
all agree with the source, the stream agrees with the category, the split matches
`int(sha256(gid)[:8],16)` parity — and then:

- `record_type` is null, `expected` is `[]`, `private` is `{}`, `relations` is `[]`, `is_guest` is
  false, `author_id` is null, `attribution.method` is `"not_applicable"`;
- `null_for` is a non-empty, non-repeating subset of the six types;
- **`evidence.null_checks` is RE-DERIVED from the text and compared** — a row claiming a
  mechanical method its own text does not support fails rather than being believed;
- `status` is derived, not read: `confirmed` only when every declared type is mechanical **and**
  every screen it rests on came back empty;
- the provenance entry is asserted quote-free before it is written.

⚠️ **`section_path` is hashed in a NULL row's provenance.** A Sunday Scans *section* segment begins
with its own heading line, so a NULL row's quote literally starts with `section_path`; committing
it would put ~40 characters of quote text in a public file. `quote_leaks` caught exactly that and
refused the write. Five candidate rows were **swapped out** rather than weaken the guard, because
their headings are already published in `golden-v1.provenance.json` and would have tripped it
regardless.

## 6. Scoring (`golden.match_segment` / `golden.score`)

- A prediction already inside the **label** scope is scored by the label and never re-counted by a
  NULL row — the label is the stronger evidence and the prediction may still be a true positive.
- `unscored_predictions` excludes null false positives: one prediction, one verdict.
- A NULL span that cannot be located in the segment text contributes **nothing** and is reported in
  `null_spans_not_found`. A span we cannot locate is a span we cannot say anything about.
- The denominator is **segments, not rows**: two NULL rows landing in one segment assert absence
  over one piece of text the extractor saw once.
- `per_type` gains `fp_null`, `null_segments`, `null_segments_with_fp` and `null_fp_rate`, and a
  type is kept in the table when it has NULL segments even with tp=fp=fn=0 — *"zero false
  positives, n=26"* is the most useful thing this set can say, and dropping it would make it
  indistinguishable from a type nobody asked about.

`golden.GOLDEN_FILES` now prefers `golden-v1.1.jsonl`; `--golden-file golden-v1.jsonl` pins the
older set so the two can be compared on one extractor. The gate keys its regression check on
`golden_sha256`, so the first v1.1 run is an honest new **baseline**, never a comparison against
v1's numbers.

## 7. Measured placement and projected cost

`--dry-run`, 2026-09-14, `wx-v0-fc47bc97`:

| Split | Records | of which NULL | Segments | Unplaced | Missing samples |
|---|---|---|---|---|---|
| dev | 93 | 26 | **83** (v1: 57) | none | none |
| test | 76 | 18 | **73** | none | none |

Projected marginal cost of the 26 NULL dev segments, priced from gate-run-1's own calibration
(system 5824 tok, 2.1111 chars/body-token, batch transport, cache ignored = upper bound), against
the measured `$4.8007` for the 57 v1 segments:

| Output-token assumption | NULL segments | v1.1 dev total |
|---|---|---|
| measured p50, 6436 tok (pessimistic — a NULL segment should produce almost nothing) | $2.48 | **$7.28** |
| ¼ of p50, 1609 tok | $0.91 | **$5.71** |
| a near-empty records array, ~300 tok | $0.48 | **$5.28** |

⚠️ Naive per-segment scaling (83/57 × $4.8007 = **$6.99**) **overstates** it: the NULL segments
average **262** characters against **1,648** for the v1 segments, 6.3× shorter.
⚠️ And `$0.0054/record` is the wrong unit here — a NULL segment is expected to yield *no* records,
so cost-per-segment is the only honest denominator.

## 8. Known gaps

- **All 44 rows are provisional**, by construction (§4). Nothing in this set is confirmed.
- **The PRINCIPLE / MARKET_SIGNAL half is a judgement.** If the extractor finds a principle in one
  of these segments it may be right and the label wrong; that is a review item.
- **Sunday Scans skews to earnings-calendar sections** (§3).
- **Only 2 workshop rows.** Workshop transcripts are dense teaching content; the candidate pass
  found very little administrative text that survived the screens, and rows from `transcripts/30`
  and `transcripts/121` were rejected for carrying a forming principle and a stated % move.
- **The screens are regexes.** They are conservative by direction (a doubtful token rejects the
  candidate) but they are not a parser, and `_NULL_UPPER_OK` is a hand-maintained list.
