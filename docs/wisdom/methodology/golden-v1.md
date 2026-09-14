---
id: WISDOM-GOLDEN-V1-METHODOLOGY
title: Wisdom Loop golden set v1 — how the labels were produced and verified
status: current (auto-verified; owner veto pending on every provisional record)
generated: 2026-09-13
stream: S-D / golden (W1 §2.4, CONTRACTS §6.4)
---

# Golden set v1 — methodology

**Quote-free by design.** This repository is public. Nothing in this file quotes a transcript, a
Discord message or a Sunday Scans body, and it names no position size or open-position entry.
Records are described by `gid` and paraphrase only. The labels themselves live in the gitignored
`data/wisdom/golden/golden-v1.jsonl`; the committed, quote-free locator file is
`docs/wisdom/golden/golden-v1.provenance.json`.

## 1. What v1 is

| | |
|---|---|
| Records | **125** (30 v0 records re-verified, the standing-rule FROG split `G-031`, 94 new) |
| Status | 117 confirmed · 8 provisional |
| Verification | 64 text-only · 53 text+bars · 8 text+bars+positions |
| Streams | 51 Sunday Scans · 43 Zoom live sessions · 27 Discord · 4 workshops |
| Review queue | 13 items (6 attribution · 4 golden · 1 contradictions · 1 authors · 1 vocabulary) |
| Split | 67 dev · 58 test |

## 2. How labels were produced

- **Labelled from source text only**, against R1–R10 (PROGRAM-MANIFEST §4.11) and the record shape in
  `docs/wisdom/contracts/extraction-output-v0.schema.json`. **No extractor prompt exists and none
  was read or written**, so the labels are independent of the extractor they will grade.
- **`expected` is a complete extraction-output-v0 record.** Every contract field is present; a field
  the text does not support stays at its empty value (null, `[]`, `false`). The scorer compares
  model output with `expected` merged with `private`.
- **Quotes are sliced, never typed.** Each quote is cut from the verifier-normalised source text
  between two anchors. It must then occur exactly once in that text, so it is verbatim by
  construction and its span is unambiguous.
- **"As worded" fields are verbatim.** These must occur in the quote: `event_at_text`,
  `ticker_as_heard`, `stop_text`, every `confidence_language` phrase and every level
  `price_as_heard`. `ticker_as_written` must occur in the quote or its segment label (for example,
  a `SNDK (Daily)` chart label).
- **Record types.** Each of the six types follows one rule:
  - **CALL:** needs an instrument, a direction, and a stated price, level or zone, a named
    observable trigger, or a position action (R1). An alert level with no stated direction is
    a MENTION.
  - **NEGATIVE_CALL:** needs an explicit ticker and an explicit pass or avoid (R3). "No thoughts
    on X" is always `MENTION / no_view`.
  - **Hindsight teaching examples** are `CALL / hindsight` with `hindsight=true` (R4, D8):
    `G-013` and `G-041`.
  - **Lists:** one list record per list, with `tickers` deduplicated in source order and the
    duplicates recorded (R2): `G-022` and `G-120`.
  - **LEVEL:** carries at least one stated price. **MARKET_SIGNAL:** carries a named signal and
    direction. **PRINCIPLE:** carries a near-verbatim statement, category and empirical-claim flag.
- **Levels are as stated (R5).** Nothing is back-filled from bars. `breakeven` is the only derived
  stop (stop = entry), and because it equals a private entry, it is private too.
- **Private split (W1 §0.4d).** These go to the `private` sub-object and never into `expected`:
  share counts, open-position entries, fills, size language and trim fractions. 15 records carry
  private data. The verifier fails a record that echoes a private number in an expected price field.
- **Relations:**
  - `reinforces` joins records with the same `principle_key` or signal key, and never mints a
    duplicate principle (R8). 6 principle pairs use it, 1 signal pair, and 1 call backs up a level.
  - `qualifies` records a later change of stance (`G-034` qualifies `G-033`).
  - `same_sentence` ties the two passes of one sentence (`G-017` and `G-031`).
- **Authorship (R6, D4, D14).** Each record carries an `evidence.attribution.method`:

  | Method | Records | Mechanical? |
  |---|---|---|
  | `speaker_label` (Zoom cue label → authors.json alias) | 43 | yes |
  | `signed_section` (Bracco's / TSDR's signed Sunday Scans section) | 32 | yes |
  | `discord_author_id` (message author id → authors.json) | 27 | yes |
  | `D4 ruling` (unsigned Sunday Scans section → TSDR) | 19 | yes |
  | `guest_speaker_label` (guest's own cue label, `is_guest=true`) | 2 | yes |
  | `self_identification`, `alias_pending` | 2 | no — must be provisional |

## 3. How labels were verified (`verified_by = "auto"`)

1. **Text.** `tools/wisdom_golden_verify.py` checks every record:
   - the quote occurs once after normalisation;
   - the locator agrees with the source (cue time and speaker label, section path and paragraph,
     or channel and message id);
   - the author agrees with that source;
   - `expected` validates against the contract schema and the type rules above;
   - the private split holds;
   - `setup_vocab` is a Setup Vocabulary v0 name;
   - relations resolve;
   - the split parity is correct;
   - every provisional record has a review-queue item.
2. **Positions.** A record gets `+positions` only when the *Current Positions* section of a Sunday
   Scans issue lists the ticker. Where an entry is printed, it must also match the stated entry,
   within 0.5 for a blended table row and 0.2 for a fill. This is the content stream's own
   positions table: no Journal, J2, Notebook or broker data was read (W1 Part 10).
3. **Bars.** A record gets `+bars` only when a stated level, outcome or observable chart claim was
   checked against `C:\data\bars.db`. That database was opened read-only
   (`file:...?mode=ro`, daily `ohlcv`), and nothing under `api.*` was imported. The check kinds are:
   - a price inside a session's range, or inside a window of sessions;
   - a price near a close, a low, or the lowest low of a window;
   - an inside day;
   - an oops (open under the prior low, then trading back above it), and its negation;
   - the highest-volume close;
   - a close above a prior high;
   - a gap of a given size;
   - a close relative to a moving average (and its slope), or a low touching a rising EMA;
   - a level inside the full traded history;
   - a thin 20-session average volume;
   - list entities resolving in the database.

   Checks on private values report "private value inside the range" and never print the number.
4. **Vocabulary.** Every `setup_vocab` is an exact Setup Vocabulary v0 name, and every
   `vocabulary_links` entry was checked against the same list.
5. **Status rule.**
   - A record whose checks all pass is **confirmed**.
   - A record whose v0 label was **contradicted** is **fixed**, marked **provisional**, and gets a
     review item holding the old label, new label and evidence.
   - A record whose author or entity rests on a non-mechanical inference (self-identification,
     adjacency, a pending alias, or a shared Zoom label with no corroboration from a TSDR-owned
     source) is **provisional**, with a review item.
   - A record with nothing checkable beyond its text is **confirmed** as `text-only`.

### 3.1 The 30 v0 records

| gid | Result | What changed |
|---|---|---|
| G-001, G-003, G-004, G-010–G-013, G-015, G-019 | confirmed · text+bars | none |
| G-005, G-006, G-007, G-008, G-009, G-014 | confirmed · text+bars+positions | standing rule applied: open entries, fills and share count moved to `private`; G-006 exit price held in evidence (see gaps) |
| G-016, G-024 | confirmed | author resolved to TSDR by the D4 ruling (v0 had "unattributed"); attribution items filed |
| G-017 | confirmed · text+bars | standing rule applied: the sentence yields a second pass, `G-031` (FROG) |
| G-020, G-021, G-023, G-025, G-027, G-029 | confirmed · text-only | none |
| G-022 | confirmed · text+bars | none (41 unique tickers all resolve; the duplicate dedupes) |
| G-026 | confirmed · text-only | relation `reinforces G-025` (no duplicate principle) |
| G-030 | confirmed · text-only | non-canonical; contradictions item vs the 2026-09-06 50SMA/20EMA line |
| **G-002** | **provisional** · text+bars | stop wording corrected: the stop was the entry day's low, hit the next day (bars plus a live-session cross-check) |
| **G-018** | **provisional** · text+bars | ticker corrected from LITE to NOW: LITE opened above its prior low, so no oops was possible; NOW is the only watched name that printed one at that open |
| **G-028** | **provisional** · text-only | quote span extended by two cues; the v0 statement's "clusters by period" half sat outside the v0 span |

## 4. Stratification (W1 §2.4) — achieved

| Type | tsdr | bracco | chartmaster | manrav | ravi | guests | Total | Minimum |
|---|---|---|---|---|---|---|---|---|
| CALL | 22 | 10 | 3 | 5 | – | – | **40** | 30 |
| NEGATIVE_CALL | 14 | 3 | – | – | – | – | **17** | 12 |
| MENTION | 8 | 5 | 3 | 5 | 1 | – | **22** | 20 |
| PRINCIPLE | 17 | 3 | 4 | 1 | – | 2 | **27** | 20 |
| LEVEL | 9 | 2 | – | – | – | – | **11** | 8 |
| MARKET_SIGNAL | 6 | 2 | – | – | – | – | **8** | 5 |
| **Total** | **76** (61%, majority) | **25** (min 10) | **10** (min 8) | **11** (min 8) | 1 | 2 | **125** | 100 |

Status by type (provisional in parentheses): CALL 36 (4) · NEGATIVE_CALL 15 (2) · MENTION 22 (0) ·
PRINCIPLE 25 (2) · LEVEL 11 (0) · MARKET_SIGNAL 8 (0).

Sources:
- **28 distinct Live Trading Sessions transcripts** (minimum 20).
- **15 distinct Sunday Scans issues** (minimum 15), 2026-05-24 → 2026-09-06.
- **Discord:** all four author channels. Records per channel: manrav 11, chartmaster 9, tsdr 4,
  bracco 3.
- **Workshops:** edu_videos 277 and 356; guest workshops 294 and 298.

The full type × author × status × verification matrix is printed by `--require-strata`.

## 5. Split rule

`split = "dev"` if `int(sha256(gid)[:8], 16)` is even, else `"test"`. The gid is UTF-8 and the hash
is hex. The rule is fixed by gid, so a record never changes split when labels change.

⚠️ CONTRACTS §6.4 words this as "`sha24(gid)` parity". `sha24` is the first 24 hex characters, and
its parity is read from character 24, not character 8. The two differ. The W1 build instruction
names `int(sha256(gid)[:8], 16)`, and that is what the verifier enforces.

## 6. Provenance file

`docs/wisdom/golden/golden-v1.provenance.json` holds, per gid:

- `record_type`, `author_id`, `stream`;
- the quote-free `locator` (`edu_videos:<id>` plus cue second and speaker label;
  `substack:/p/<slug>` plus section path and paragraph; or `discord:<channel>:<message>`);
- `quote_sha256` (sha256 of the NFC, whitespace-collapsed quote);
- `span` (`char_start`, `char_end`, and `text_sha256` of the normalised source text);
- `status`, `verification`, `split`.

The verifier asserts the file is quote-free before writing: no quote under 24 characters, and no
24-character window of a longer quote, may appear in it. On a later run it FAILS on any drift
unless `--write-provenance` is passed.

## 7. Known gaps

- **Quote-free committed artifacts:** every committed description is a paraphrase. Verifying a label
  needs the gitignored samples (`data/wisdom/samples/`); without them the verifier exits 2
  (INCONCLUSIVE), never 0.
- **No intraday bars on this box for the names checked** (LITE, NOW, MRNA). Hourly and first-minute
  claims were verified on daily bars only. Examples: G-013's hourly go signal, and G-018's oops at
  the open, which was checked from the daily open against the prior low.
- **Bars missing for some instruments:** GGLL (`G-077`), NBIL (bars stop 2026-07-22, `G-085`) and
  ETHU (`G-020`). Those claims are text-only.
- **Breadth-based MARKET_SIGNALs are text-only:** no breadth database was read.
- **Sunday Scans chart images were not used** (D13 is a later wave).
- **Schema gap:** extraction-output-v0 has no exit-price field. G-006's stated exit is held in
  `evidence.stated_exit_price`. A future contract revision should add `exit`.
- **The "Uncharted Territory" Zoom label is shared.** It carries Bracco's voice in edu_videos 348
  (`G-057`) while TSDR speaks under his own label in the same session. Records under that label
  are confirmed only with TSDR-owned corroboration (G-034, G-044, G-045, G-051); the others are
  provisional (G-035, G-052). The authors-tab item recommends dropping the alias
  (`authors.json` is integrator-owned).
- **Pending alias:** the ChartMaster workshop speaker label is not a chartmaster alias yet, so
  `G-065` is provisional (attribution item).
- **Inferred session date:** edu_videos 333's title carries no date. 2026-08-21 was inferred from
  bars, as the only session containing both stated fills.
- **Split skew at small n:** the test split holds only 1 LEVEL and 5 of 8 MARKET_SIGNALs. Per-type
  test metrics for those two types are not meaningful until the set grows.
- **The Discord sample is the latest 400 messages per channel** (fetched 2026-09-13), so its date
  range is recent-heavy: tsdr from 2026-08-24, manrav from 2026-08-14, chartmaster from 2026-09-01,
  bracco from 2026-02-05.
- **Guest coverage is thin:** 2 guest principles, from workshops whose guests carry their own cue
  labels. Interview transcripts have no speaker labels, so guest-versus-host attribution there is
  not mechanical and none were used.
- **Single labeller:** every label is auto-verified, not owner-confirmed. The owner's veto (W1 §0.3)
  applies to all 125 records, and in particular to the 8 provisional ones and their 13 queue items.

## 8. Reproduce

```sh
python tools/wisdom_golden_verify.py --self-check
python tools/wisdom_golden_verify.py                                   # v0, unchanged
python tools/wisdom_golden_verify.py --golden <data root>/golden/golden-v1.jsonl \
    --provenance docs/wisdom/golden/golden-v1.provenance.json --require-strata
railway run --service web python tools/wisdom/golden_discord_sample.py --out <data root>/samples/discord --limit 400
```
