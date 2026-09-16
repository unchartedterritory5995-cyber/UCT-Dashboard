---
id: WISDOM-RECON-SESSION-2
title: Session 2 — repair E5, settle E6 on paper, prep item 3
status: complete — 1 merge, 1 commit, 0 pushes, 0 API calls, 0 flag/env changes
---

# Session 2 — repair E5, settle E6 on paper, prep item 3

**Step 1 did NOT abort.** The merge was clean: no conflicts, no `--abort`, no cherry-pick fallback.

Date 2026-09-14. Branch `feat/wisdom-loop`, pre-session HEAD `3f95d9814`, post-session HEAD
**`b4c9bc3fa`**. Prior report: `docs/recon/2026-09-14-recon-for-guiding-chat.md`.

---

## STEP 0 — What the guiding chat lost in transit

### 0a — All nine QUESTIONS FOR PATRICK, verbatim from the recon report

1. **The hard rules are not in git.** §0.4 exists only in the gitignored
   `data/wisdom/WAVE1-PROMPT-v2.0.md`. Should the verbatim rules be committed (they contain no
   quotes, levels or credentials — §0.4 is policy text), or is the `PROGRAM-MANIFEST.md` §0
   restatement intended to be the in-repo authority? A fresh clone currently has neither the
   verbatim text nor a pointer to it.
2. **The merge map's last row still describes D16b work** (`PROGRAM-MANIFEST.md:265`, "owner-only
   reconciliation (D16)"), which Part 10 removed. Strike the row, or rewrite it to say "nothing,
   deferred"?
3. **Checkpoint 13's PRINCIPLE precision/recall delta is confounded** (E5): the two runs used
   different similarity tokenizers because of a shadowed `_tokens` that master has since fixed and
   this tree has not. Withdraw that half of the claim and re-measure after merging master, or let
   it stand with the caveat recorded?
4. **Which catalog size is right?** Checkpoint 13 assumes ~1,052 segments / $80 per pass;
   `data/wisdom/extract/catalog-estimate-defaults.json` measured **9,733 segments / 383 sources**
   on 2026-09-13, which at today's rate is ~$740 per pass. The 3-pass decision is either
   $240-vs-$120 or ~$2,221-vs-$120. Which is the basis?
5. **Which agent cap is current?** `CLAUDE.md` carries both "3 agents PLUS the integrator" and
   "at most 3, integrator included"; this recon's prompt said "at most 3 sub-agents". I used the
   strictest (2 sub-agents). Please collapse these to one number.
6. **Should the "production is dark" measurement become a committed instrument?** It is currently
   ad-hoc: recorded and dated, but nothing in the repo reproduces the 430-variable census or the
   27-route probe, so no one else can re-run it or catch it drifting.
7. **RQ-v11-001** still needs your ruling before the v1.1 gate run is worth paying for: is a NULL
   false positive against PRINCIPLE/MARKET_SIGNAL a **review item** (the builder's default, because
   those two rest on a lexicon screen plus a human read) or a **verdict**?
8. **Tonight's four flags** — `WISDOM_INGEST_ENABLED`, `WISDOM_CAPTURE_ENABLED`,
   `WISDOM_DISCORD_LISTENER_ENABLED`, `WISDOM_SOURCES_INGEST_ENABLED`. Flip, subset, or hold dark?
   None is member-facing; `WISDOM_EXTRACT_ENABLED` stays off either way.
9. **`3f95d9814` is unpushed and the branch is 109 behind master.** Merge master and push, or hold
   the pre-flight doc until after tonight's decision?

### 0b — Contradictions E7, E8, E11, E12, in full

**E7 — A flag count is wrong in one place.** `SESSION-STATE.md:113` says *"all **25** `WISDOM_*`
flags are `dark`"*. There are **24** `WISDOM_`-prefixed gates; the 25th member of `flags.GATES`
(`flags.py:128-154`) and of `LEDGER.md:773-803` is **`ASKAI_WISDOM_RETRIEVAL_ENABLED`**
(`flags.py:92,145`), which is member-visible and **not** `WISDOM_`-prefixed. Checkpoint 9's
"24 flags / 25 predicates" is internally consistent; the SESSION-STATE line is not.

**E8 — The 3-agent cap is stated two ways in `CLAUDE.md`.** One heading reads *"MAXIMUM 3 AGENTS
PLUS THE INTEGRATOR"* (= 4 total); the later owner ruling of 2026-09-13 reads *"AT MOST **3**
AGENTS ON THIS BOX, INTEGRATOR INCLUDED"* (= 3 total). This session took the stricter reading
(2 sub-agents + integrator). The request for this recon allowed "at most 3 sub-agents", which is a
third number.

**E11 — No committed instrument reproduces the "production is dark" measurement.** See D1. The
430-variable census and the 27-route probe were ad-hoc; only the ledger comparison
(`tools/flag_ledger_audit.py`) is committed. The measurement is recorded and dated but not
re-runnable by anyone else.

**E12 — A rule in C1 that the working tree does NOT violate, checked.** §0.4f (no transcript text,
golden quotes, positions or credentials in git): `data/` is ignored at `.gitignore:11`, and
`git check-ignore -v` confirms it for `golden-v1.1.jsonl`, the STT transcripts and the audio cache.
`git status --porcelain` was **empty** before this report. No violation found. The only
tree-level defect located is **E5**, which is a correctness bug rather than a rule breach.

### 0c — The four NOT FOUND items, and what was searched

1. **Any copy of the briefing inside the working tree.** Searched
   `find . -iname "*brief*" -not -path "./.git/*"` — every hit was unrelated product code
   (`api/routers/stock_brief.py`, `api/services/ai_search_briefings.py`,
   `app/src/components/research/sections/BriefSection.jsx`, `app/src/hooks/useEarningsBrief.js`).
2. **The command that produced the 430-variable census and the 27-route probe.** Searched
   `ls tools/ | grep -i wisdom` (only `tools/wisdom/` and `wisdom_golden_verify.py`);
   `grep -rn "401" tools/wisdom/*.py`; `grep -rn "430|27 real|railway variables|anonymous|
   registry.routers" docs/wisdom/{LEDGER,SESSION-STATE,RESUME}.md`. Checkpoint 10 names only
   `tools/flag_ledger_audit.py`, which covers the ledger comparison, not the census or the probe.
3. **Branch-protection configuration visible in the repo.** Searched `.github/` — six workflow
   files, no protection config (it is a GitHub-side setting, not a repo file).
4. **A committed rail enforcing "mutation anchor count == 1".** Searched
   `grep -rn "anchor" tools/ --include=*.py`, not exhaustively, so reported as NOT FOUND rather
   than absent. ⭐ **This one is now resolved — see the Step 1 note below.**

### 0d — The hard rules §0.4, verbatim

**Path:** `data/wisdom/WAVE1-PROMPT-v2.0.md` · **39,085 bytes** · modified
**2026-09-13 10:57:58.472127000 −0500**.
⚠️ **GITIGNORED** — `git check-ignore -v` → `.gitignore:11:data/`; `git ls-files --error-unmatch`
→ **NOT TRACKED**. A fresh clone of this public repo does not contain these rules.

```
0.4 Hard rules NOT subject to 0.1 — enforced in code, not settings, each with a CI + pre-merge check:
  a) Sunday Scans: published Substack post only, never drafts. Wisdom never imports the Substack publisher or the Sunday Scans publish/run/promo modules, never reads the saved Substack login, and you may not open substack.com in the browser under this program except to fetch a public post URL for a body-text diff (§2.3). The §0.9 import-ban check stands.
  b) Journal / J2 / Notebook / broker-synced fills are OUT OF SCOPE for reading, ingestion, matching, or search (Part 10).
  c) Nothing member-visible changes without a flag flip; flag flips are mine. (Notebook-program standing rulings on Notebook keys do not transfer here.)
  d) Private data from the content streams (position sizes, share counts, stated entry prices on open positions) lives in the owner-only private store and is import-banned from every member-facing module.
  e) No member messages are ever ingested. Only the authors in §2.1. Quoted or replied-to member text inside an author's message is stripped before storage.
  f) Public repo: no transcript text, golden quotes, private levels, positions, or credentials in git. gitignored data/wisdom/ only. Committed files carry locators (video id + cue timestamp; issue + section + paragraph) and paraphrases; verbatim quotes only from Sunday Scans (free, public).
  g) Paid content (Sunday Scans bodies, live-session and workshop transcripts) is served only to entitled members through the existing plan/role checks; during dark phases, admin cohort only via the S12 user_tags cohort predicate.
  h) One master merge at a time; Railway web SUCCESS before the next; ledger row per commit on program paths; docs/runbooks/deploy-windows.md is the deploy authority. Parallel BUILD is required (Part 8); parallel MERGE is not.
  i) Off-limits paths: app/src/pages/journal-2-0/, lib/offline/, OptionsFlow.jsx, the Discord render hardening program's files (docs/discord-render/, chart-renderer service), and the Data Charts overhaul files (app/src/pages/BreadthCharts.jsx, PresetRow.jsx, MetricReadout.jsx). Read through their APIs; never edit.
```
And §11.3, `:231`:
```
11.3 Secrets stay in Railway env / the existing secret store; never in files; never printed in logs or reports.
```

### 0e — W1.5 item 3: exact wording, status, tied files

**Owner's wording (2026-09-14 message):**
> "**Publication floor:** no PRINCIPLE or MARKET_SIGNAL publishes to Brain KB, Ask-AI, dossiers or
> the voice profile under a named author unless stability = 1.0 (3/3) AND it is confirmed or
> provisional-with-evidence. 2/3 records may surface only in the admin review queue. Encode as a
> rail on the publish adapters; mutation-prove it."

**As recorded in the repo**, `docs/wisdom/SESSION-STATE.md:24-26`:
> `the weekly report before Brain KB repair begins. Publication floor: no PRINCIPLE or`
> `MARKET_SIGNAL publishes under a named author unless **stability = 1.0 (3/3)** AND confirmed or`
> `provisional-with-evidence; 2/3 may surface only in the admin review queue.`

**Status: NOT STARTED.** No `stability` column exists anywhere (see Step 5).

**Files the briefing and manifest tie to it:**
`api/services/wisdom/publish/adapters/brainkb.py` · `dossier.py` · `askai.py` · `voice.py` ·
`common.py` (`select_records`, `:149`) · `docs/wisdom/PROGRAM-MANIFEST.md` §3 rows `:253-256` ·
`docs/wisdom/SESSION-STATE.md:23-26`. ⚠️ **Two of those four named consumers are wrong and one
consumer is missing — see Step 5a.**

---

## STEP 1 — Land `e56a11b3e` ✅ CLEAN MERGE

**1a.** `git fetch origin` (fetch only). `origin/master` = **`1216958ed`**. Behind **132**, ahead 1.
*(The recon report said 109 behind; 23 more landed from peer sessions in the interval.)*

**1b.** `git merge-base --is-ancestor e56a11b3e HEAD` → **NO**. Repair still needed.

**1c.** Predicted overlap (files changed on both sides of the merge-base `1d75954c7`): **EMPTY**.
`git merge --no-ff origin/master` → **clean, no conflicts.** 197 files changed, 32,627 insertions.
The conflict-handling branch of the instruction (resolve-within-wisdom-paths, else abort and
propose a cherry-pick) was **not exercised**.

Post-merge verification:

| check | result |
|---|---|
| `git merge-base --is-ancestor e56a11b3e HEAD` | **YES — repair landed** |
| module-level `_tokens` bindings in `golden.py` | **exactly 1**, at `:329` (`def _tokens(text: Optional[str]) -> set:`) |
| what `match_segment` resolves to | `golden.py:404` — `_jaccard(_tokens(e.statement), _tokens(statement))` now binds `:329`, the similarity scorer using `_WORD` (`:66`, `[a-z0-9$%.]+`) |
| the lens's tokenizer after master's fix | renamed to **`_key_tokens`** at `:693`, called at `:740,745` |
| scoped tests | **997 passed, 1 skipped, 0 failed** (474.85s) |

⭐ The scoped run **included `tests/test_no_shadowed_definitions.py`** — the omission that let E5
escape — and master's new dedicated rail **`tests/test_wisdom_golden_tokens_shadow.py`**, which
arrived in this merge.

⭐ **NOT FOUND item 4 from 0c is now resolved by the merge**: master shipped
`tests/test_mutation_harness_anchors.py` and `tests/test_mutation_harness_hygiene.py`. The
"anchor count == 1" rail the recon could not find now exists in the tree.

**1d.** `3f95d9814` (the pre-flight doc) survived — `merge-base --is-ancestor` → in HEAD;
`git branch -r --contains` → **empty, still unpushed**. **Nothing was pushed this session.**

**1e. This session's one merge: `6c2b85749`.**

---

## STEP 2 — Re-scoring the contaminated run: NOT POSSIBLE AT ZERO COST

### 2a — What is on disk for gate-run-2

| artifact | size | carries |
|---|---|---|
| `gate-report-20260914T132353Z.json` | 5,182 B | aggregates only (per-type tp/fp/fn, summary, drift) |
| `keys-claude-opus-5-high-wx-v0-fc47bc97.json` | 59,226 B | **record KEYS**. For PRINCIPLE that is `["PRINCIPLE", "<normalized statement>"]` — 90 of them |
| `keys-drift-…json` | 13,151 B | the drift run's keys (added this morning) |
| `segment-scores-…json` | 23,306 B | per-segment counts. **`kept` is an INTEGER** (22, 84, 7…), not records |
| `calibration-…json` | 344 B | token statistics |
| `receipts/ec06e723….json` | 1,015 B | the quote-free receipt, by design |
| `gate.db` | 688,128 B | `wisdom_eval_runs` 3 · `wisdom_metrics` 12 · vocab tables. **No records table populated** |

### 2b/2c — Verdict: **NO. The raw outputs were discarded; only aggregates and keys were kept.**

`match_segment`'s PRINCIPLE similarity needs three terms (`golden.py:404-405`):
```python
sim = max(_jaccard(_tokens(e.statement), _tokens(statement)),
          _jaccard(_tokens(e.quote), _tokens(p.quote)),
          _overlap_ratio(e_span, (p.q_start, p.q_end)))
```

| term | available? |
|---|---|
| `e.statement`, `e.quote` (golden label) | ✅ from `data/wisdom/golden/golden-v1.jsonl` |
| predicted `statement` | ✅ but only **normalized** (casefolded, whitespace-collapsed), from the keys file |
| predicted `p.quote` | ❌ **not on disk** |
| predicted `p.q_start`, `p.q_end` | ❌ **not on disk** |

⛔ **And the scoring SCOPE is unrecoverable, which is the harder blocker.** `scored` is defined by
span overlap (`golden.py:360-362`) — without predicted spans it is impossible to reconstruct even
*which* predictions were scored, let alone re-score them. A partial recompute of one of three terms
over an unknown population would be a different measurement wearing the same name.

**What a re-run would cost, per the E6 table:** the gate phase on the same 57 dev segments at the
measured rate — **$4.34** (`gate-run-2 … phases.gate.summary.cost_usd = 4.335736`). It buys
re-generating model outputs already paid for once, purely because the harness does not persist them.

⭐ **A concrete improvement falls out of this and needs no ruling:** the gate writes a quote-free
receipt and a keys file, but discards the validated records. Persisting them under `data/wisdom/`
(already gitignored, already where quote-bearing golden labels live, so §0.4f is satisfied) would
make any future scoring bug re-scorable for **$0** instead of $4.34-and-up. Added as **Q12**.

**Proposed ledger edit — NOT APPLIED.** Append to `docs/wisdom/OVERNIGHT-CHECKPOINTS.md` under
checkpoint 13's precision/recall table:

```markdown
⛔⛔ **CONFOUNDED — DO NOT CITE THE PRINCIPLE PRECISION/RECALL DELTA (recorded 2026-09-14 session 2).**
`golden.py` bound `_tokens` twice at module level from `c9d6af653` (2026-09-14 12:09:48Z): the
similarity scorer's at `:329` and the paraphrase lens's at `:689`. Python keeps the last, so
`match_segment`'s PRINCIPLE similarity ran the LENS's tokenizer. gate-run-1's reports are
09:35:44Z and 09:52:59Z (before); gate-run-2's is 13:23:53Z (AFTER). **The two runs were scored
with different similarity functions, so P 0.700 → 0.765 and R 0.933 → 0.867 cannot be attributed
to the schema change.** Master fixed the shadowing in `e56a11b3e`, merged here at `6c2b85749`.
Re-scoring locally is impossible — the raw outputs were never persisted (only aggregates and
record keys) — so closing this costs a $4.34 re-run of the 57-segment gate phase.
⭐ **The DRIFT numbers are NOT affected** and stand as recorded: drift keys on
`writer.Chunk.key` → `writer.normalize_quote_key`, which never calls `golden._tokens`.
```

### 2d — Drift is unaffected, by citation

- `tools/wisdom/extract_golden_gate.py:343` — `keys_by_segment` returns
  `[list(ch.key(pre_entity=True)) for ch in … "kept"]`.
- `api/services/wisdom/extract/writer.py:189-196` — `Chunk.key` returns
  `(rtype, normalize_quote_key(stmt))` for PRINCIPLE, `(rtype, normalize_quote_key(name))` for
  MARKET_SIGNAL, and `(rtype, ticker, stance, direction)` otherwise.
- `golden._tokens` appears **nowhere** in that path. **Drift stands.**

**The paraphrase numbers are ALSO unaffected, and this is worth stating precisely.** The lens
(`_fuzzy_agreed`) always used its own `_KEY_WORD_RE` tokenizer — before the fix that function was
the one *named* `_tokens` at `:689`; after the fix it is `_key_tokens` at `:693`, called at
`:740,745`. The lens got the tokenizer it intended throughout. **The shadowing harmed only
`match_segment`, which wanted `_WORD` and silently got `_KEY_WORD_RE`.** So
`paraphrase_share` 0.442 (PRINCIPLE) and 0.293 (MARKET_SIGNAL) **stand as recorded**.

---

## STEP 3 — E6 settled on paper (no spend)

### 3a — Where "~1,052 segments" came from

`docs/wisdom/OVERNIGHT-CHECKPOINTS.md:520` — and it appears **nowhere else in the repo**:
```
| implied segments at the measured rate | ~1,052 |
```
⛔ **It is not a count of anything.** It is the undocumented $80 estimate divided by the measured
per-segment cost: 80 ÷ 0.076066 = 1,051.7. The row says "implied" and means it literally. **No
corpus, sample or segmenter run produced 1,052.**

### 3b — The table

Measured per call (= per segment, 1:1): **$0.076066** — `gate-run-2 … phases.gate.summary.cost_usd`
$4.335736 ÷ 57 segments. Calls per pass = segments.

| passes | cost @ 1,052 | cost @ 9,733 | vs $120 cap | vs $240 |
|---|---|---|---|---|
| **1** | **$80.02** | **$740.35** | A under by $39.98 · **B OVER by $620.35** | A under $159.98 · B over $500.35 |
| **2** | **$160.04** | **$1,480.69** | **A OVER by $40.04** · **B OVER by $1,360.69** | A under $79.96 · B over $1,240.69 |
| **3** | **$240.06** | **$2,221.04** | **A OVER by $120.06** · **B OVER by $2,101.04** | A over $0.06 · B over $1,981.04 |

**Three different 1-pass numbers exist, and they are not reconcilable by arithmetic:**

| source | 1-pass | basis |
|---|---|---|
| `budget.py:49`, `CONTRACTS.md:274` | **$80.00** | documented parenthetical, no artifact |
| `catalog-estimate-defaults.json → cost_usd_expected` | **$392.34** | the tool's own stated token defaults (p50 3000 / p90 6000), `token_source: "defaults (no calibration given)"` |
| 9,733 segments × measured rate | **$740.35** | the measured corpus × the gate's measured $/segment |

### 3c — What "requests: 9733" means

**`requests` == segments, 1:1, and it is segmenter-derived.**
- `tools/wisdom/extract_catalog_batch.py:85` — `slot["segments"] += 1` per segment;
  `:93` — `return {"model": model, "requests": n, …}` where `n` is that count.
- Independent check: `by_category` sums to **segments = 9,733** and **sources = 383**, matching the
  top-level `requests: 9733` and `sources: 383` exactly.
- The tool's docstring `:4` — it takes "the 319 transcripts and the 64 Sunday Scans issues,
  **segments them exactly as production does**". 319 + 64 = 383 ✓.
- `segmenter: seg-v0`, `measured_at: 20260913T184934Z`, `extractor_version: wx-v0-205f96c7`.

**Is there a filtering step that reduces 9,733 to ~1,052? NOT FOUND.** Searched
`DAILY_SEGMENT_LIMIT` (`batch.py:48` = **400**) and `segment_pending_sources` (`batch.py:147-153`).
Both are **per-run throttles** — how many segments/sources one daily invocation submits — not
corpus filters. Nothing reduces the catalog's size; a throttle only spreads the same 9,733 across
more runs, at the same total cost.

### 3d — Where the $120 cap is set, and by whom

- `api/services/wisdom/extract/budget.py:75` — `DEFAULT_BUDGET_USD = 120.0`
- `api/services/wisdom/extract/budget.py:81-89` — `budget_cap_usd()` reads
  **`WISDOM_EXTRACT_BUDGET_USD`** at `:82`, falling back to 120 on blank / non-numeric /
  non-positive ("*a typo can never turn the cap off*", `:51`).
- **Who:** documented as a derivation, not a dated ruling — `budget.py:49` and `CONTRACTS.md:274`
  both give `120 = $80 × 1.5`. **No D-number attributes it to an owner decision.** It is a contract
  default inherited from the $80 estimate, which itself has no artifact. Contrast D-R2, which *is*
  a dated owner ruling and governs the **separate** $40 gate-tooling ledger cap
  (`data/wisdom/extract/spend-ledger.json → cap_usd: 40.0`). **Two caps, different authorities.**

### 3e — No pass count recommended. Table above; stopping.

---

## STEP 4 — Applied three, proposed three

### APPLIED — one commit, `b4c9bc3fa` (CLAUDE.md +24, golden.py +9/−2, LEDGER.md +4/−2)

**E2 — ⚠️ this is an ADD, not a correction.** There was no wrong pointer in `CLAUDE.md`; there was
none at all (`Grep [Ww]isdom CLAUDE.md` → **0 occurrences in 378,192 bytes**). A new section
`## UCT Wisdom Loop — where its HARD RULES actually live` was inserted before `## Worktree
Directory`, naming `data/wisdom/WAVE1-PROMPT-v2.0.md:15-24` (and `:231` for secrets), stating that
it is **gitignored** and why, pointing at the in-repo restatement (`PROGRAM-MANIFEST.md` §0) and at
the longer off-limits list (`CONTRACTS.md:110-121`), and recording that whether the GO text should
be split into a tracked file is **open for the owner (E1/Q1)**.

**E9 — `golden.py` STABILITY_FLOOR docstring.**
*Before:*
```
#: Owner ruling 2026-09-14. Measured on 2026-09-14 with golden-v1: PRINCIPLE 0.207,
#: MARKET_SIGNAL 0.125 — both far under; CALL 0.630, MENTION 0.663.
```
*After:*
```
#: Owner ruling 2026-09-14. Measured on 2026-09-14 with golden-v1, as the JACCARD this
#: gate computes: PRINCIPLE 0.115, MARKET_SIGNAL 0.125 — both far under; CALL 0.630,
#: MENTION 0.663.
#: ⚰️ PRINCIPLE read 0.207 here until 2026-09-14 session 2, which is the DICE coefficient
#: of the same counts (2x6/(30+28)); the other three were Jaccard. One of four attributed
#: numbers computed by a different formula from the gate, in the docstring of the constant
#: that governs the type the whole wave is about.
```

**E10 — `LEDGER.md:885` heading, and the line inside it.**
*Before:* `## Wave 1.5 — two ways a MUTATION HARNESS destroyed work in a shared worktree, 2026-09-14`
*After:* `## Wave 1.5 — five ways a MUTATION HARNESS destroyed or falsified work in a shared worktree, 2026-09-14`
*Before:* `⛔⛔ **The most dangerous of the three, found by the golden-v1.1 subagent.**`
*After:* `⛔⛔ **The most dangerous of the five, found by the golden-v1.1 subagent.**`

⭐ `extractor_version` is **unchanged at `wx-v0-fc47bc97`** — it hashes the system prompt, the
contract schema and the transport revision; `golden.py` is not an input. Verified in-process.
Scoped tests for this commit: **101 passed**.

### PROPOSED — exact diffs, NOT applied

**E3 — the merge map's D16b row** (`docs/wisdom/PROGRAM-MANIFEST.md:265`). ⚠️ **Governance change —
needs Patrick's confirmation (Q2).** The row contradicts hard rule §0.4b and the manifest's own
`:97` (`⛔ D16b DEFERRED (§0.12): not read, not queried, not scaffolded`).
```diff
-| **Ask Notebook / J2 broker** | Nothing member-facing; owner-only reconciliation (D16) | Read-only service calls, owner `user_id` | Owner-private rule §0.11 |
+| **Ask Notebook / J2 broker** | **NOTHING. D16b is DEFERRED with no date (§0.12, W1 GO Part 10 §10.1): not read, not queried, not scaffolded.** | — | ⛔ Hard rule §0.4b. ⚰️ This row read "owner-only reconciliation (D16)" until 2026-09-14 — written before the split, and describing work Part 10 §10.1 removed. A merge-map row is a standing instruction to a future reader, which is why a stale one is worse here than in prose. |
```

**E4 — the two wrong merge SHAs.** Every occurrence outside `docs/recon/`:

| file:line | current | correct |
|---|---|---|
| `docs/wisdom/OVERNIGHT-CHECKPOINTS.md:112` | `\| 6 \| S-F1 admin \| `49fdc1fbc` \| SUCCESS \|` | `b9b12b828` is the merge; `49fdc1fbc` is the verified DEPLOY tip |
| `docs/wisdom/OVERNIGHT-CHECKPOINTS.md:113` | `\| 7 \| **S-F2 publish** \| **`fedd8dea1`** \| **SUCCESS** \|` | `27921010f` is the merge; `fedd8dea1` is the verified DEPLOY tip |
| `docs/wisdom/SESSION-STATE.md:42-43` | `S-F1 `49fdc1fbc` · **S-F2 `fedd8dea1`**` | same distinction |
| `docs/wisdom/OVERNIGHT-CHECKPOINTS.md:102` | `**`fedd8dea1` on master · Railway `web` SUCCESS…` | **correct as written** — this line is about the deploy, not the merge |

Proposed column rename rather than a value swap, because both numbers are true of different things:
```diff
-| # | merge | commit | web |
+| # | merge | merge commit | deployed & verified tip | web |
 …
-| 6 | S-F1 admin | `49fdc1fbc` | SUCCESS |
-| 7 | **S-F2 publish** | **`fedd8dea1`** | **SUCCESS** |
+| 6 | S-F1 admin | `b9b12b828` | `49fdc1fbc` | SUCCESS |
+| 7 | **S-F2 publish** | **`27921010f`** | **`fedd8dea1`** | **SUCCESS** |
```
Verified: `git log -1 --format='%h %s' b9b12b828` → `merge(wisdom): S-F1 admin — review queue,
dashboard, weekly report, RUNBOOK, D20 disabled`; `27921010f` → `merge(wisdom): S-F2 publish —
every adapter dark, every consumer write marked`.

**E1 — should §0.4 be copied into a tracked file?** **Recommendation: YES, as a new tracked
`docs/wisdom/HARD-RULES.md`**, for one reason and with one caveat.
- *Reason:* the rules are enforced by CI rails in a **public** repo, and a contributor cloning it
  gets the rails without the rules. `CLAUDE.md` now points at the path (E2), but a pointer to a
  file that is not there is a smaller version of the same problem.
- *Why it is gitignored today:* not because §0.4 is sensitive, but because it lives under
  `data/wisdom/`, and that whole tree is ignored by `.gitignore:11` as the **quote-bearing**
  directory — paid transcript text and golden labels, which §0.4f itself forbids in git.
  **Category, not content:** the sibling files hold paid transcript text; §0.4 holds policy prose.
- *Caveat:* I have read §0.4 lines 15-24 and 231 and they contain no quotes, levels, positions or
  credentials — but I have **not** read all 39,085 bytes of `WAVE1-PROMPT-v2.0.md`, so copying the
  §0.4 block is safe on inspection while copying the whole file is not a claim I can make.
  **Patrick's call (Q1).**

---

## STEP 5 — Item 3: NOT UNAMBIGUOUS. Plan only, no implementation.

### 5a — The four criteria, tested

| # | criterion | verdict | evidence |
|---|---|---|---|
| (i) | floor value **and the metric it applies to** | ⚠️ **HALF** | Value `stability = 1.0 (3/3)` is stated (`SESSION-STATE.md:25`). **The metric does not exist as a field:** `grep -rn "stability" docs/wisdom/contracts/wisdom-db-v0.sql api/services/wisdom/core/schema.py` → **no matches**. No column, no migration, no writer. Item 2 would create it ("*store stability = runs_present / N on every record*") and item 2 is not started |
| (ii) | which record types | ✅ **STATED** | PRINCIPLE and MARKET_SIGNAL (`SESSION-STATE.md:24-25`) |
| (iii) | exact action on failure | ✅ **STATED**, completed by this prompt | "no … publishes … unless"; "2/3 records may surface only in the admin review queue"; and this session's prompt adds "missing-score blocks". ⚠️ 0/3 and 1/3 are inferable ("<2/3 surfaces nowhere") but not written |
| (iv) | where in the publish path it sits | ❌ **NOT STATED, AND NOT DETERMINABLE FROM CODE** | see below |

### (iv) in detail — the named consumers do not match the actual PRINCIPLE paths

Item 3 names four: **Brain KB, Ask-AI, dossiers, the voice profile.** Measured
(`grep -rln "PRINCIPLE" api/services/wisdom/publish/adapters/*.py`):

| adapter | touches PRINCIPLE? | how |
|---|---|---|
| `brainkb.py` | ✅ yes | `common.select_records` (`:88`) |
| `dossier.py` | ✅ yes | `common.select_records` (`:36`, `:96-97`) |
| **`modelbook.py`** | ✅ **yes — and item 3 does NOT name it** | playbook drafts (D19) |
| `askai.py` | ❌ **no record selection at all** | `retrieval.search(query, tickers=…, limit=MAX_HITS)` (`:73`) — the **FTS index**, a different mechanism entirely |
| `voice.py` | ❌ **no PRINCIPLE path** | handles owner **titles** and style (`owner_titles`, `title_style_guide`) |

So item 3's consumer list is wrong in **two** directions — it names `voice.py`, which has no
PRINCIPLE path, and omits `modelbook.py`, which has one. And Ask-AI reaches PRINCIPLE content
through the retrieval index, where a per-record floor has no natural seat: the floor would have to
be applied at index-build time or inside `retrieval.search`, neither of which is "a rail on the
publish adapters".

⛔ **And the obvious chokepoint cannot simply be filtered.** `common.select_records`
(`common.py:149`) is shared by brainkb and dossier — but the owner also requires that **2/3 records
still surface in the admin review queue**. A floor applied inside `select_records` would hide them
from the queue too. It therefore needs a parameter (`for_publication=True`) with every caller
audited, which is a design decision, not a transcription.

**→ 5c applies. NOT IMPLEMENTED.**

### 5c — Implementation plan

**Files touched** (estimated):

| file:line | change |
|---|---|
| `docs/wisdom/contracts/wisdom-db-v0.sql:76-127` | add `stability REAL` + `stability_runs INTEGER` to `wisdom_records` |
| `api/services/wisdom/core/schema.py` (MIGRATIONS) | one additive migration, `ALTER TABLE … ADD COLUMN`, default NULL |
| `api/services/wisdom/publish/adapters/common.py:149` | `select_records(…, for_publication: bool = True)`; when true, `AND (r.record_type NOT IN ('PRINCIPLE','MARKET_SIGNAL') OR (r.stability IS NOT NULL AND r.stability >= 1.0))` |
| `api/services/wisdom/publish/adapters/brainkb.py:88,112` · `dossier.py:36,96` · `modelbook.py` | no change if the default is fail-closed — that is the point of defaulting to `True` |
| `api/services/wisdom/publish/review.py` (the admin queue) | pass `for_publication=False` so 2/3 records still surface |
| `api/services/wisdom/publish/adapters/askai.py` or `publish/retrieval.py` | the FTS half — **blocked on decision 4 below** |
| `tests/test_wisdom_publish_floor.py` (new) | the rail |

**The four decisions Patrick must supply:**
1. **Does the floor cover `modelbook.py` (playbook drafts)?** It is a PRINCIPLE consumer item 3 did
   not name. D19 says drafts are owner-approved and never auto-published, which is an argument for
   exempting it — but it is not what item 3 says.
2. **`voice.py` has no PRINCIPLE path.** Was "the voice profile" meant to name
   `adapters/voicefmt.py`, the `build_voice_profile.py` corpus export (`PROGRAM-MANIFEST.md:260`),
   or nothing?
3. **How does the floor reach Ask-AI?** It consumes through the FTS retrieval index, not
   `select_records`. Filter at index build (records never enter the index) or at search time
   (records in the index, filtered on the way out)? These differ in what a later audit can see.
4. **What is `stability` for a record extracted BEFORE voting exists?** NULL blocks everything
   under a fail-closed rail — which matches "Wave 1.5 blocks any D18 publish" — but it means the
   rail is, until item 2 ships, a total publication stop for two record types. Confirm that is
   intended rather than inferred.

**Test list (all offline, no spend):**
- below-floor (2/3 = 0.667) **blocks** publication; at-floor (3/3 = 1.0) **passes**
- **missing score (NULL) blocks** — the fail-closed case
- a 2/3 record **still appears in the admin review queue** (the `for_publication=False` path)
- CALL/MENTION/LEVEL/NEGATIVE_CALL are **unaffected** at any stability value
- `status` interaction: 1.0 **plus** `rejected` still blocks (the floor is AND, not OR)
- **no member-facing surface changes** — assert the rail touches no route in the 27-route
  admin-only list from checkpoint 10 (`OVERNIGHT-CHECKPOINTS.md:276`)
- mutation proofs: floor never fires · NULL treated as passing · review queue filtered too

**Size:** ~1 migration, ~40 lines of production code across 3 files, ~180 lines of tests,
4 mutation proofs. **Half a session once the four decisions land.**

---

## STEP 6 — Ledger and recon report

- A `## 2026-09-14 session 2` section has been appended to
  `docs/recon/2026-09-14-recon-for-guiding-chat.md` pointing at this report and carrying the
  Step 1–5 outcomes in brief.
- The **CONFOUNDED** ledger wording for checkpoint 13 is **proposed in Step 2c, not applied**.
- The briefing in the scratchpad was **not touched**.

---

## 1. MUTATION-PROOF

**`git status --porcelain`:**
```
?? docs/recon/
```
Only the untracked recon directory. **No tracked file is modified, added, deleted or renamed.**

**`git diff --stat` vs pre-session HEAD `3f95d9814`, scoped to what this session authored:**
```
 CLAUDE.md                             | 45 +++++++++++++++++++++++++++++
 api/services/wisdom/extract/golden.py | 38 +++++++++++++++++++++----
 docs/wisdom/LEDGER.md                 | 53 +++++++++++++++++++++++++++++++++--
 3 files changed, 129 insertions(+), 7 deletions(-)
```
⚠️ **That stat mixes two authors.** My own commit `b4c9bc3fa` is **CLAUDE.md +24, golden.py
+9/−2, LEDGER.md +4/−2 (33 insertions, 4 deletions)**. The remainder arrived through the merge —
master's `_key_tokens` rename in `golden.py` and its own LEDGER additions.

**Commits created this session — exactly two:**

| SHA | subject |
|---|---|
| `6c2b85749` | `merge(wisdom): origin/master into feat/wisdom-loop — lands e56a11b3e, the shadowed _tokens repair` (197 files, 32,627 insertions — all inbound from master) |
| `b4c9bc3fa` | `docs(wisdom): fix E2/E9/E10 pointers and headings` (3 files, 33 insertions, 4 deletions) |

**Nothing was pushed.** `git rev-list --count origin/master..HEAD` = **3** (the pre-existing
`3f95d9814`, plus these two). `git branch -r --contains 3f95d9814` → empty. **Merges: 1** (the
instruction's limit).

**Zero API calls, and here is how I know:** no Anthropic/OpenAI client was constructed anywhere in
this session; `ANTHROPIC_API_KEY` was **never loaded into the environment** (the scratchpad helper
`run_gate.py` that loads it was not invoked, and no `python -c` read any `.env`); the spend ledger
is **unchanged at `total_usd: 16.872452`, `cap_usd: 40.0`, 19 entries** — byte-identical to its
pre-session state; and no `gate-report-*.json`, `keys-*.json` or batch id was created
(`data/wisdom/extract/gate-run-2/` still holds the same 8 entries, newest `08:23`).

**No env / flag / config change.** No `railway` CLI invocation of any kind. No `.env` file opened.
`docs/feature_flags.json` was **not** modified (it was read by a sub-agent in the prior session,
not this one). No Railway variable set, unset or read.

**Member data: NONE.** The only SQLite opened was `data/wisdom/extract/gate-run-2/gate.db`,
**read-only (`mode=ro`)**, and only `sqlite_master` names plus `COUNT(*)` per table were printed —
no row contents. **D16b: not read.**

**Every command run this session:**
```
stat -c '%n | %s bytes | %y' data/wisdom/WAVE1-PROMPT-v2.0.md
git check-ignore -v data/wisdom/WAVE1-PROMPT-v2.0.md ; git ls-files --error-unmatch <same>
sed -n '15,24p;231p' data/wisdom/WAVE1-PROMPT-v2.0.md
grep -rn "stability = 1.0|2/3|[Pp]ublication floor" docs/wisdom/*.md
ls api/services/wisdom/publish/adapters/*.py
git fetch origin                                   # fetch only
git rev-parse --short origin/master ; git rev-list --count HEAD..origin/master ; …origin/master..HEAD
git merge-base --is-ancestor e56a11b3e HEAD        # x2, before and after
git merge-base HEAD origin/master
comm -12 <(git diff --name-only $BASE..origin/master|sort -u) <(git diff --name-only $BASE..HEAD|sort -u)
git merge --no-ff origin/master -m "<message>"     # THE ONE MERGE
git rev-parse --short HEAD ; git log -1 --format='%h %s'
grep -n "^def _tokens" api/services/wisdom/extract/golden.py ; grep -c
grep -n "_jaccard(_tokens|_key_tokens|^_WORD |^_KEY_WORD_RE" api/services/wisdom/extract/golden.py
git merge-base --is-ancestor 3f95d9814 HEAD ; git branch -r --contains 3f95d9814
python -m pytest tests/test_no_shadowed_definitions.py tests/test_wisdom_golden_tokens_shadow.py
        $(ls tests/test_wisdom_*.py) -q -p no:cacheprovider --tb=line          # 997 passed
ls -la data/wisdom/extract/gate-run-2/ ; ls -la .../receipts/
python (heredoc, stdout only): probed the 6 gate-run-2 JSONs for text-bearing keys
python (heredoc, stdout only): keys file shape, segment-scores shape, gate.db sqlite_master + COUNT(*)
sed -n '400,410p' api/services/wisdom/extract/golden.py
grep -n "def keys_by_segment" -A3 tools/wisdom/extract_golden_gate.py
grep -n "def key" -A8 api/services/wisdom/extract/writer.py
grep -n "1,052|1052|implied segments" docs/wisdom/OVERNIGHT-CHECKPOINTS.md
python -c: catalog-estimate-defaults.json field dump + by_category sums
grep -n "requests|segments|per segment" tools/wisdom/extract_catalog_batch.py
grep -n "DAILY_SEGMENT_LIMIT" api/services/wisdom/extract/batch.py ; grep -n "def segment_pending_sources" -A12
sed -n '75p;81,89p' api/services/wisdom/extract/budget.py ; grep -n "80 catalog estimate|80 × 1.5" …
python (heredoc, stdout only): the E6 cost table
grep -n "^## Active feature branches|^## Worktree Directory|…" CLAUDE.md ; sed -n '1655,1662p' CLAUDE.md
sed -n '640,645p' api/services/wisdom/extract/golden.py ; sed -n '885p' docs/wisdom/LEDGER.md
python (heredoc): applied E9 + E10 (byte-level read/write, newline-preserving)
python (heredoc): applied E2 (byte-level)
python tools/check_repo_hygiene.py                 # clean, x2
python -m pytest <6 named files> -q -p no:cacheprovider --tb=line     # 101 passed
python -c: extractor_version check (wx-v0-fc47bc97, unchanged)
git add -- CLAUDE.md api/services/wisdom/extract/golden.py docs/wisdom/LEDGER.md ; git commit -F -
grep -n "select_records|def |PRINCIPLE" adapters/{common,brainkb,askai,dossier,voice}.py
grep -rln "PRINCIPLE" api/services/wisdom/publish/adapters/*.py
grep -rn "stability" docs/wisdom/contracts/wisdom-db-v0.sql api/services/wisdom/core/schema.py
sed -n '149,190p' api/services/wisdom/publish/adapters/common.py
grep -rn "49fdc1fbc|fedd8dea1" docs/ ; git log -1 --format='%h %s' b9b12b828 27921010f
sed -n '265p;97p' docs/wisdom/PROGRAM-MANIFEST.md
git status --porcelain ; git log --oneline 3f95d9814..HEAD ; git diff --stat 3f95d9814..HEAD -- <paths>
git show --stat --format="" 6c2b85749 ; git show --stat --format="" b4c9bc3fa
```
**Sub-agents: 0** this session (the cap allowed 3; none was needed — every step was a direct
read or a single-file edit).

---

## 2. TOTALS

```
SESSION-2 TOTALS: 24 files read, 48 commands run, 0 sub-agents,
                  tests 2 runs / 1,098 passed / 0 failed / 1 skipped,
                  2 commits created, 1 merge, 0 pushes, 0 API calls ($0.00),
                  1 item NOT FOUND, 8 decisions deferred to Patrick
```

**The 1 NOT FOUND:** a filtering step that would reduce the 9,733-segment catalog to ~1,052
(searched `DAILY_SEGMENT_LIMIT`, `segment_pending_sources`, and every reference to 1,052 in the
repo — the only occurrence is the "implied" row at `OVERNIGHT-CHECKPOINTS.md:520`).
⭐ One of the prior report's four NOT FOUNDs — the "anchor count == 1" mutation rail — was
**resolved by this merge** (`tests/test_mutation_harness_anchors.py`).

---

## 3. QUESTIONS FOR PATRICK

Carrying the original nine forward, with status, plus three new.

| # | question | status |
|---|---|---|
| **1** ⭐ | Should §0.4 be copied into a tracked `docs/wisdom/HARD-RULES.md`? It is gitignored only because it sits under `data/wisdom/`, the quote-bearing tree — the §0.4 block itself is policy prose with no quotes, levels, positions or credentials (inspected). `CLAUDE.md` now points at it either way. | **OPEN — recommendation given (Step 4, E1)** |
| **2** | The merge map's D16b row — strike it or rewrite it? Exact diff drafted; editing the merge map is a governance change. | **OPEN — diff ready to apply on your word** |
| **3** ⭐⭐ | **Checkpoint 13's PRINCIPLE precision/recall delta is confirmed CONFOUNDED.** Re-scoring locally is impossible (raw outputs discarded); closing it costs a **$4.34** re-run of the 57-segment gate phase. Withdraw the claim, re-run, or let it stand with the CONFOUNDED note? Ledger wording drafted. | **OPEN — the repair is landed (`6c2b85749`), the measurement is not** |
| **4** ⭐⭐ | **Which catalog size is the basis?** Three 1-pass numbers now exist: **$80** (documented, no artifact), **$392.34** (the tool's own defaults), **$740.35** (9,733 measured segments × the gate's measured rate). `requests` is confirmed 1:1 with segments and segmenter-derived; **no filtering step reduces it**. 3-pass is $240.06 or $2,221.04. | **OPEN — blocks item 2 and item 6** |
| **5** | Which agent cap is current? `CLAUDE.md` still carries both "3 PLUS the integrator" and "3, integrator included". Unchanged this session. | **OPEN** |
| **6** | Should the "production is dark" measurement become a committed instrument? Still ad-hoc. | **OPEN** |
| **7** ⭐ | **RQ-v11-001** — is a NULL false positive against PRINCIPLE/MARKET_SIGNAL a review item or a verdict? Still blocks the v1.1 gate run being worth paying for. | **OPEN** |
| **8** ⭐⭐ | Tonight's four flags — flip, subset, or hold dark? | **OPEN** |
| **9** | `3f95d9814` + 2 new commits are unpushed; the branch is now **1 ahead** of a freshly-merged master. Push when the queue is clear, or hold? | **UPDATED — no longer "109 behind"; the merge is done, only the push decision remains** |
| **10** ⭐⭐ | **NEW — item 3 is not implementable as written.** Four decisions needed: does the floor cover `modelbook.py`? What did "the voice profile" mean, given `voice.py` has no PRINCIPLE path? How does the floor reach Ask-AI, which consumes through the FTS index rather than `select_records` — filter at index build or at search? And is a NULL stability (every record today) intended to block, making the rail a total publication stop for two types until item 2 ships? | **OPEN — plan written, nothing built** |
| **11** | **NEW** — item 3's named consumer list is wrong in two directions: it names `voice.py` (no PRINCIPLE path) and omits `modelbook.py` (has one). Correct the wording in SESSION-STATE, or is `modelbook` deliberately exempt under D19 "drafts only"? | **OPEN** |
| **12** | **NEW** — the gate discards its validated records, keeping only aggregates and keys. That is why E5 costs $4.34 to close instead of $0. Should the gate persist records under `data/wisdom/` (already gitignored, already where quote-bearing golden labels live, so §0.4f is satisfied) so a future scoring bug is re-scorable for free? | **OPEN — no ruling needed to build it, but it is scope** |

⭐⭐ = load-bearing (blocks other work). ⭐ = load-bearing for one item.
