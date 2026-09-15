---
id: WISDOM-SESSION-4
title: Session 4 — rulings applied, gate persistence, item 3 built
status: complete — 8 commits, 1 merge, 0 pushes, 0 API calls, $0.00
---

# Session 4 — rulings applied, gate persistence, item 3 build

**Both spend rulings read NO, so this session spent `$0.00` and made zero API calls.**
The ledger is byte-identical to the one session 3 left.

Branch `feat/wisdom-loop` `b4c9bc3fa` → **`4ae9e7dac`**; item 3 on **`feat/wisdom-item3-floor-rail`**
→ `fcda5b433`. Neither pushed.

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R1** HARD_RULES_FILE: YES | ✅ applied — `docs/wisdom/HARD-RULES.md`, §0.4 verbatim, scanned clean first |
| **R2** D16B_ROW: REWRITE | ✅ applied verbatim to `PROGRAM-MANIFEST.md:265` |
| **R3** Q3_RERUN: NO | ⏭️ **skipped, $0.00** — the PRINCIPLE row is marked CONFOUNDED and withdrawn, not re-measured |
| **R4** SAMPLE_250: NO | ⏭️ **skipped, $0.00** |
| **R6** DARK_INSTRUMENT: YES | ✅ built `scripts/wisdom_dark_check.py` · **RUN_AGAINST_PROD: NO**, so local + self-check only |
| **R9** PUSH_BRANCH: NO | ⏭️ skipped — **0 pushes**, neither branch |
| **R10** STORAGE: A · ACTION: A · CLIPS: FLOOR | ✅ built — 3 migrations, 4 check points, paired enqueue |
| **R11** FIX_CONSUMER_LIST: YES | ✅ applied — `voice.py` removed, `modelbook.py` + `clips.py` added |
| **R12** GATE_PERSISTS: YES | ✅ built — `tools/wisdom/gate_records.py`, inert until the next gate run |
| **R13** ITEM3_SCOPE: RECORD | ✅ built on its own branch, not merged, not pushed |
| **R15** NORMALISE_CATALOG: YES | ✅ applied in the reader; the artifact untouched |
| **AGENT_CAP: 3** | 1 sub-agent used, read-only |

⚠️ **Nothing in the §Spend arithmetic was needed** — both R3 and R4 are NO, so the
"$23.36 does not fit" branch never arose.

---

## STEP 1 — Sync and the one merge

**1a.** `git fetch origin` → `origin/master` advanced `1216958ed..3fa362e46`. **Behind 3, ahead 3.**
Against `origin/feat/wisdom-loop`: **0 behind, 392 ahead** (unchanged).

**1b.** Behind, so the merge ran. The three incoming commits are the Chart Data pane map — **16
files, all `app/src/components/chart/**`, zero wisdom paths, zero conftest paths** — so the
session-2 conflict policy never engaged. Clean, no conflicts.

**Merge SHA `e6d572b05`.** This session's one merge.

**Scoped gate after the merge: 1018 passed · 1 skipped · 2 failed.**

⛔ **The 2 failures are PRE-EXISTING and NOT OURS.** Both are
`test_mutation_harness_anchors[mutation_harness_flipgate.py]`. Established three ways rather than
assumed: the merge touched neither the harness nor the test (the diff is frontend-only); both
commits that introduced them (`a78adcd97`, `56e9d3aec`) are **ancestors of `b4c9bc3fa`**, our
pre-merge tip; and running the file alone at that tip reproduces both. The harness lives at
`docs/discord-render/instruments/mutation_harness_flipgate.py` — **an off-limits path under §0.4i**
("the Discord render hardening program's files … never edit"). Reported, not touched.

**0 NEW failures, all session.** The final full run is 1105 passed / 2 failed — the same two.

---

## STEP 2 — The documentation rulings · commit `79f7fd6fe`

### 2a — E4, the two wrong merge SHAs

Applied at `OVERNIGHT-CHECKPOINTS.md` (the table) and `SESSION-STATE.md:42-43`. The table now
carries **two** columns, because the old heading conflated them:

| # | merge | merge commit | deployed & verified tip |
|---|---|---|---|
| 6 | S-F1 admin | `b9b12b828` | `49fdc1fbc` |
| 7 | S-F2 publish | `27921010f` | `fedd8dea1` |

⭐ **Verified structurally, not from memory.** `49fdc1fbc` is the **first parent** of `27921010f`;
rows 2–5 each have **two** parents (real merges) while `49fdc1fbc` and `fedd8dea1` have **one**
(they are fix commits). ⭐ Rows 2–5 were always correct — for those four the merge commit *was*
the deployed tip because no fix landed in between, which is exactly why the column heading read
unambiguously right for four rows and wrong for two.

### 2b — R11, the consumer list

`SESSION-STATE.md` now carries the verified four-point map (dossiers/Model Book via
`select_records` · Brain KB via a direct `wisdom_principles` SELECT · Ask-AI via the FTS index ·
clips via untyped SQL with no flag), and records that **the review queue is not upstream of the
Brain KB, Ask-AI or dossier lanes**, so a block needs a paired enqueue.

**Before:** `not to Brain KB, not to Ask-AI, not to a dossier, not to the voice profile.`
**After:** `not to Brain KB, not to Ask-AI, not to a dossier, **not to a Model Book playbook
draft, and not into the clip export's record list**` — with the ⚰️ recording that `voice.py`
has no PRINCIPLE path (`:33-39`, `:44-79`), so the old clause forbade nothing while the two lanes
that do carry one went unnamed.

### 2c — R2, the D16b row

REWRITE, drafted diff applied verbatim at `PROGRAM-MANIFEST.md:265`.

### 2d — R1, `docs/wisdom/HARD-RULES.md`

**Scan result, run before anything was copied** (lines 15-24 + 231, 11 lines, 2,264 chars):

| check | result |
|---|---|
| double-quoted span ≥12 chars | clean |
| dollar price level | clean |
| bare decimal that could be a level | **TRIP — one hit: `11.3`** |
| share/contract count · credential-shaped literal · secret-name assignment | clean |
| email address · @handle · ticker-with-level | clean |

⭐ **The single trip is the section number of the secrets rule itself** — the line begins
`11.3 Secrets stay in Railway env…`. Proved rather than waved away: re-scanned with numbered
headings masked → **zero** price-level hits, against a control confirming the detector still sees
`247.50` mid-sentence **and on the same line as a heading**. So the block was copied verbatim, not
redacted.

The file carries the source path, its modified time (`2026-09-13 10:57:58`), its size and sha, and
states that the source is gitignored and authoritative. Written LF-only and verified byte-identical
to the source lines. `CLAUDE.md` points at it.

⛔ **The claim covers the copied block and nothing else** — the other ~37,000 bytes of the GO file
were never read, and both the new file and `CLAUDE.md` say so.

### 2e — the CONFOUNDED wording, narrowed

Applied to the PRINCIPLE row only; the other five rows stand, and the withdrawn sentence
(*"PRINCIPLE trades one miss for fewer inventions"*) is struck rather than footnoted, because it
read as the finding the whole schema change was for. R3 is NO, so nothing was re-measured.

### 2f — R15, catalog normalisation

`normalize_category()` in **`tools/wisdom/extract_catalog_batch.py`** (the reader), applied at
`:55` before the `CATEGORY_STREAM` lookup. **17 → 15 categories; 9,733 segments and 383 sources
unchanged.** The typo entry was removed from `CATEGORY_STREAM` because a typo mapped in two places
is two authorities over one value — the alias resolves to a key that map already holds, so stream
assignment is provably unchanged (tested).

⚠️ **A SECOND `CATEGORY_STREAM` carrying the typo lives at `tools/wisdom_golden_verify.py:128`.**
It belongs to the golden gate, is outside R15's scope, and changing it would move a measurement
surface. The test **says so** rather than asserting a repo-wide uniqueness that is false.

### 2f investigation — ⭐⭐ NOTHING IS WRONG, AND THAT IS THE FINDING

The 319/314 split and the 95,790-char shortfall are **both artefacts of counting the same corpus
two ways.** Neither artifact is stale.

- **The split.** The docstring partitions by INPUT FILE KIND; `by_category` partitions by the
  CATEGORY STRING. **Five `edu_videos` transcripts carry the category `"Sunday Scans"`** — Zoom
  recordings of those sessions (`desk_daily_session.py:37` routes a webinar named `sunday scan*` to
  that section; `:461` writes the section into `edu_videos.category`). `319 + 64 = 314 + 5 + 64 =
  383`. Re-derived with the script's own code path: 64 HTML + 5 transcripts = 69 sources, 535 + 52
  = 587 segments, reconciling to the artifact **exactly**.
- **The chars.** Segmenter normalisation removes **1,421,466** chars from the transcripts; the 64
  scans HTML **add 1,325,676** the sweep never counted. `1,325,676 − 1,421,466 = −95,790`. **No
  source is missing from either count.**
- **The typo is in the DATA.** `edu_videos.category` is free text — `TEXT NOT NULL DEFAULT
  'General'`, no CHECK, no enum (`education_service.py:45`), `.strip()` the only normalisation on
  write. The Desk route's fallback is `return t, t, t.upper()` on the **hand-typed Zoom webinar
  name** (`desk_daily_session.py:90`), and it collapses whitespace but **does not fold case**.

Recorded at `PROGRAM-MANIFEST.md:114` so the next reader does not re-file it as a defect. **No data
was changed.**

---

## STEP 3 — R12, the gate persists its records · commit `cbc4b5112`

**3a. Where the records died:** `tools/wisdom/extract_golden_gate.py:441` produced `results`;
`:443-444` wrote only aggregates and keys; and **`validate_into:154` did `result.pop("output")`**
— the raw extractor output was discarded on that line.

**3b.** `tools/wisdom/gate_records.py` writes per run, under the gitignored
`data/wisdom/gate-runs/<gate_run_id>/`:

| file | contents |
|---|---|
| `records.jsonl` | one row per validated record: `dataclasses.asdict(Checked)` + `record_id`, `principle_key`, `market_signal_key`, `record_key`, `pre_entity_key`, segment/source ids, `extractor_version`, `run_id`, model, effort, transport |
| `segments.jsonl` | one row per segment: outcome, cost, usage, counts, the segment **text**, the golden `expected` rows, the NULL spans, and the **raw extractor output** |
| `manifest.json` | run provenance; the eval `run_id` and gate decision folded in after scoring |

All four API phases persist (gate, drift, trial; calibration reuses the gate results). **ON by
default** — the failure it prevents is silent.

**§0.4f is satisfied by WHERE this writes, not by what it holds.** `data/wisdom/gate-runs/` is
covered by `.gitignore:11 (data/)` — verified with `git check-ignore -v` — and is already the home
of the golden labels and the gate's own `keys-*.json`. `common.out_path` still refuses any path
inside the shared data root (`C:\data`).

⭐ **A run directory is SELF-CONTAINED** — it re-scores with nothing else present, not the golden
file (which may have moved on) and not the samples tree.

**3c. Aggregates unchanged, mutation-proved.** `validate_into` MOVES the raw output to a private
key; `persist_phase` strips it once written.

⚠️ **AND M1 CORRECTED A CLAIM OF MINE.** I had written that the strip is what keeps the aggregates
byte-identical. **It is not:** deleting it leaves every aggregate identical and fails only the leak
test. The aggregates are safe because persistence only READS the results —
`summarise`/`segment_scores`/`keys_by_segment` each address named keys. The module and the test now
say that instead; the strip stays for memory and to stop a future wholesale serialiser picking up
transcript text.

**A bug the tests caught before it shipped.** The first version let `json.dumps(default=str)`
serialise `expected` and `nulls`. Both are **frozen dataclasses**, so they became their `repr` —
and `NullSpan.types` is a **frozenset**, which is not JSON at all. A persisted run would have
looked complete and re-scored to nothing: the exact failure R12 exists to prevent.

**3d.** `keys-*.json` is unchanged and asserted byte-identical on/off.

**ONE AUTHORITY.** `record_id` and `principle_key` were computed inline in `writer.write_output`;
they are now `writer.record_id_for` / `writer.principle_key_for` and both callers use them.

---

## STEP 4 — spend

**`R3_RERUN: NO` and `R4_SAMPLE_250: NO`, so nothing was run and nothing was spent: $0.00, zero
API calls.** (4c.)

---

## STEP 5 — R6, the dark instrument · commits `084800373` + `4ae9e7dac`

`scripts/wisdom_dark_check.py`. **Both halves DERIVED, never typed:** gates from **`flags.GATES`**
(the list the admin status page and the ledger rail already read, which carries `member_visible`);
routes from `registry.routers()`. An AST walk over `os.environ.get`/`os.getenv` inside
`api/services/wisdom/**` cross-checks for switches read **outside** the registry.

**Three exit codes:** `0` PASS · `1` LIT · `2` INCONCLUSIVE. A dry run is INCONCLUSIVE by design;
zero gates or zero routes is INCONCLUSIVE, never PASS.

**Measured — `R6_RUN_AGAINST_PROD: NO`, so production was NOT probed:**

| | |
|---|---|
| `--self-check` | **PASS**, 13 checks |
| dry run | **INCONCLUSIVE (exit 2)** |
| `--local` | **PASS (exit 0)** — 0 of 25 gates set |
| derived | **25 gates** = 10 member-visible + 15 owner/internal · **0** switches read outside the registry · **27 GET routes** = 23 `require_admin` + 3 `require_push_secret` + 1 `require_owner`, **0 unguarded** |

⭐ The route count reproduces the recorded **27** exactly, from the registry rather than a list.
⚠️ **This did NOT establish that production is dark** — the local half measures this machine, and
the 401 half needs `--host`, which the ruling withheld. The 2026-09-14 05:00 CT hand measurement
still stands for production.

### ⛔⛔ Three defects found by building and running it

1. **The first version was BLIND TO A MEMBER-FACING SWITCH.** It matched
   `^WISDOM_[A-Z0-9_]+$` string literals, so it could not see **`ASKAI_WISDOM_RETRIEVAL_ENABLED`**
   — the Ask-AI kill switch, *member-visible*, no `WISDOM_` prefix. It would have printed "0
   switches set, dark" while a member-facing lane was lit. **A name-prefix scan is not a
   measurement of what the code reads.**
2. **The same scan reported four switches that do not exist** — `WISDOM_CAP` (a Python constant
   `= 50`), `WISDOM_PKG_DIR` and `WISDOM_IMPORT_PREFIX` (module constants), and
   `WISDOM_PRIVATE_KEYS_V1` (a name appearing only inside a **docstring**).
3. **On a cp1252 console the first `⛔` raised `UnicodeEncodeError` and the script exited 1
   (LIT)** — an instrument reporting a measured failure it had never measured, which is precisely
   what the three exit codes exist to prevent. Fixed with `errors="replace"`, the same fix
   `flag_ledger_audit` needed on 2026-09-10.

**And a fourth, found later while pinning the route list (`4ae9e7dac`): the route walk was
DOUBLING every path.** `route.path` already carries the router prefix, so prefix + path produced
`/api/admin/wisdom/core/api/admin/wisdom/core/status` — ⭐ **while the COUNT stayed a correct 27
the whole time.** Only a probe would have exposed it: `--host` would have requested 27 URLs that do
not exist and reported "checked 27" with nothing lit.

---

## STEP 6 — item 3 built · `feat/wisdom-item3-floor-rail`

Three commits, as 6f requires. **Not merged, not pushed.**

### 6a — migrations · `6dbbd9288`

`core_007_records_stability` · `core_008_records_stability_runs` · `core_009_principles_stability`
— **one statement each**, additive, nullable.

⛔⛔ **A COLUMN, NEVER A FIELD.** `_canonical_hash` hashes `fields | {record_type}`, so a field
would change every `record_hash` and `record_id` and defeat
`UNIQUE(segment_id, extractor_version, record_hash)` — re-extraction would **duplicate the entire
corpus**. Pinned by a test that hashes a fixture record before and after, with a control proving a
change *inside* fields does move the hash.

⚠️ **NULLABLE ON PURPOSE.** `NOT NULL DEFAULT 0.0` would be indistinguishable from a measured zero;
`DEFAULT 1.0` would silently publish every unmeasured record.

### 6b — the rail · `4141d0213`

`api/services/wisdom/publish/floor.py` owns the predicate. **One authority, four sites** — a guard
written four times cannot be mutation-proved.

| # | site | change |
|---|---|---|
| 1 | `common.select_records` | `include_unstable=False` default; a no-op for badges/desk_markers/pv_examples/level_alerts/lookalike |
| 2 | `brainkb.export_payload` | filtered at **export**, not `build_rows`, so staged rows keep reaching the owner's `--diff-out` review while never leaving; mirrors `unmarked_dropped` as `below_floor_dropped` |
| 3 | `retrieval.search` | joins `wisdom_principles` on the `pr:` doc-id prefix — **FTS5 has no `ALTER TABLE ADD COLUMN`**. An unresolvable key BLOCKS |
| 4 | `clips.clip_candidates` | **FLOOR**, per `R10_ITEM3_CLIPS` |

**Two deliberate opt-ins, both owner-side:** brainkb's `_ALL_TYPES` support lookup (blocking it
drops a *citation*, not a publication) and `voice_principle_candidates` (the owner's own sourcing
lane must still see what the floor holds back). A test asserts there are exactly two.

### 6c — action A

Block **and** enqueue. `floor.enqueue_blocked` is wired as the daily chain's `publication_floor`
step, running last and **deliberately not flag-gated**. Idempotent via `review.item_id_for` —
proved by running it twice and counting rows. Reason code names the floor, the value (or `NULL`)
and the run count.

⚠️ **It runs from the CHAIN, not the read path** — the four filter sites are member-facing reads on
a read-only connection, and writing inside one would be both a correctness bug and a per-request
cost.

### 6d — the floor value

`floor.floor_value()` returns `golden.STABILITY_FLOOR`. Never a literal.

⭐ **0.8 and "3/3" are the SAME RULE at N=3** — the attainable values are 0, ⅓, ⅔, 1, so `>= 0.8`
admits exactly 1.0. **They DIVERGE elsewhere:** at N=5, 4/5 = 0.8 would pass while not being 5/5.
Both asserted.

### 6e — tests · `6f138af70`

32 tests in the new file. All nine from §3-v, plus test 8 pinning the 27-route list byte-for-byte.

### ⛔⛔ The most important finding of Step 6 — my own test was not a guard

The first wiring test asserted each site **mentions** the floor module. Mutation proved that is
worthless:

| mutation | result |
|---|---|
| M3 `if not include_unstable:` → `if False:` | **30 passed** — nothing caught it |
| M6 the clips clause → `AND 1=1` | **30 passed** — nothing caught it |

Both left the `floor.` mention intact while the floor filtered nothing at two of its four sites.
Replaced with **behavioural** tests that run the real queries against a seeded corpus. Both now go
red by name.

**Six mutation proofs, every one restored byte-exact and sha256-verified:**

| # | mutation | result |
|---|---|---|
| M1 | `passes()` treats NULL as passing | 3 failed, 27 passed |
| M2 | SQL clause treats NULL as passing | 3 failed, 27 passed |
| M3 | `select_records` stops filtering | **1 failed**, 31 passed *(after the fix)* |
| M4 | daily chain drops the enqueue step | 1 failed, 29 passed |
| M5 | the brainkb owner opt-in removed | 1 failed, 29 passed |
| M6 | `clips` stops filtering | **1 failed**, 31 passed *(after the fix)* |

⚰️ **And a second instrument matched its own prose.** The "only two opt-ins" sweep grepped for the
literal `include_unstable=True` and found **four** — because both real call sites carry a comment
that spells it out while explaining why. It reads the AST now, with a control proving a comment is
not a call site.

**Three existing tests changed answer, and all three are the rail working.** Each now pins **both**
states: the DAILY order gains `publication_floor`; brainkb's `preview_count` is 1 with
`below_floor_dropped` naming the withheld principle, and 2 once stability reaches the floor; the
Model Book playbook derivation test seeds stability at the floor so it keeps testing derivation,
with a new companion pinning the `awaiting_source_material` state.

### 6g — what the rail does today, plainly

⭐ **With zero stored records, the rail changes zero rows and zero routes.** All eleven `.db` files
under `data/**` have `wisdom_records` = 0 (session 3), so there is nothing to filter and nothing to
enqueue. The 27-route list is byte-identical and every route still carries `require_admin`,
`require_owner` or `require_push_secret`.

⛔ **When records arrive, EVERY PRINCIPLE and MARKET_SIGNAL blocks**, because stability is NULL
until item 2 populates it, and NULL fails closed. **That is the intended inert-then-fail-closed
behaviour, not a regression** — and it is why the blocked records are enqueued rather than merely
dropped.

⚠️ **Two holes a record-level floor does not close**, stated in the module so nobody reads it as
more than it is: `retrieval._segment_docs` indexes the full text of every authored segment, so the
**sentence** a below-floor principle came from stays retrievable as a `segment` doc, attributed and
dated; and `voicefmt.corpus_documents` exports raw segment text regardless of record type.
`R13: RECORD` scoped those out.

---

## STEP 7 — push

**`R9_PUSH_BRANCH: NO`. Nothing was pushed.** `feat/wisdom-item3-floor-rail` was never a push
candidate under any ruling.

---

## 1. MUTATION-PROOF

**`git status --porcelain`:** `?? docs/recon/` — the untracked recon directory only, exactly as
sessions 2 and 3 left it. **No tracked file is modified, added or deleted outside a commit.**

**Commits created — 8, plus 1 merge:**

| SHA | branch | subject |
|---|---|---|
| `e6d572b05` | feat/wisdom-loop | **merge** origin/master (Chart Data pane map, frontend only) |
| `79f7fd6fe` | feat/wisdom-loop | docs(wisdom): apply session-3 rulings |
| `cbc4b5112` | feat/wisdom-loop | feat(wisdom-gate): persist validated records per run |
| `084800373` | feat/wisdom-loop | feat(wisdom): "production is dark" becomes an instrument |
| `4ae9e7dac` | feat/wisdom-loop | fix(wisdom): the dark-check route walk was doubling every path |
| `6dbbd9288` | item3-floor-rail | feat(wisdom): item 3 migrations — stability columns |
| `4141d0213` | item3-floor-rail | feat(wisdom): item 3 rail — four points, plus the enqueue |
| `6f138af70` | item3-floor-rail | test(wisdom): item 3 floor — nine checks, route pin, six mutation proofs |
| `fcda5b433` | item3-floor-rail | fix(wisdom): route walk doubling (cherry-picked to both branches) |

**Merges: 1** (the Step 1 maximum). **Pushes: 0.**

⚠️ **One self-correction worth recording: I used `git add -A` and it swept the rail and the three
untracked recon reports into the migrations commit.** That is the exact thing the worktree rule
forbids. Caught by reading `git show --stat` on my own commit, undone with `git reset --soft
HEAD~1` (no work lost, nothing pushed), and redone as the three commits 6f asks for.

**`git diff --stat b4c9bc3fa..HEAD`:** 40 files, 3,566 insertions, 173 deletions — of which 16
files and ~1,200 lines are the merged Chart Data commits, not this session's writing.

**Spend ledger — BEFORE and AFTER, byte-identical:**
```
BEFORE  sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
AFTER   sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
```

**Zero flag / env / config / cap changes.** `git diff --name-only b4c9bc3fa HEAD` matching
`feature_flags|.env|railway|config` → **NONE**. `DEFAULT_BUDGET_USD = 120.0` and
`--max-usd default=40.0` are untouched. No `railway` invocation, no `.env` opened.

**Zero API calls, $0.00.** Both spend rulings read NO, so no model client was constructed and
`ANTHROPIC_API_KEY` was never loaded. No new `gate-report-*.json`, receipt or batch id exists, and
`data/wisdom/gate-runs/` is **empty** — the persistence is inert until a real run, as intended.

**Member data: NONE.** No member rows opened or printed. **D16b / Journal / J2 / Notebook / broker:
not read** by me or by the sub-agent (explicitly forbidden in its brief and confirmed in its
report).

**Sub-agents: 1**, read-only, the catalog source-split investigation.

**Every command run (integrator), by group:**
```
spend ledger before/after (sha256 + fields)                    x2
git fetch origin; rev-list behind/ahead x3; log/diff of the 3 incoming commits
git merge --no-ff origin/master; rev-parse; status
git log/merge-base --is-ancestor on a78adcd97, 56e9d3aec (pre-existing failure provenance)
pytest: scoped wisdom suite x3 (post-merge, mid-build, final) + per-file runs x9
sed/grep reads of: OVERNIGHT-CHECKPOINTS, SESSION-STATE, PROGRAM-MANIFEST, CLAUDE.md,
  WAVE1-PROMPT-v2.0.md (lines 15-24, 231 only), extract_catalog_batch.py, golden.py,
  writer.py, extract_golden_gate.py, common.py, brainkb.py, retrieval.py, clips.py,
  chain.py, review.py, schema.py, flags.py, registry.py, wisdom-db-v0.sql
python heredocs: the §0.4 scan + 2 refinements with controls; HARD-RULES.md writer with a
  verbatim check; catalog fixture extraction; N=3/N=5 floor equivalence
git check-ignore -v data/wisdom/gate-runs/.probe
python tools/check_repo_hygiene.py                              x4  (clean each time)
python scripts/wisdom_dark_check.py --self-check | (dry) | --local
mutation harnesses: 2 runs x (2 + 4 + 2) mutations, each sha256-verified on restore
git add (named paths) / commit x8 / reset --soft HEAD~1 / checkout -b / cherry-pick -x
git status --porcelain, log, diff --stat (provenance for this report)
```

---

## 2. TOTALS

```
SESSION-4 TOTALS: ~48 files read, ~95 commands run, 1 sub-agent,
                  tests 1108 run / 1105 passed / 2 failed (both pre-existing,
                    off-limits path) / 1 skipped,
                  8 commits, 1 merge, 0 pushes,
                  0 API calls ($0.00), 2 items NOT FOUND, 6 decisions deferred
```

**The 2 NOT FOUND:**
1. **The script that wrote `data/wisdom/samples/transcripts/*.json` and `_index.json`.** Search
   terms: `git grep "_index.json"`, `grep -rn "samples/transcripts"`, `"sunday_scans_html"`,
   `grep -rn "edu_videos" tools/ scripts/`. The only tracked producer reading the same columns is
   `tools/desk_taxonomy_dump.py`, which writes elsewhere. The *content* of `category` traces to
   `edu_videos.category` by field name and value set.
2. **A `member_visible` classification for the two floored record types in any tracked artifact.**
   `flags.GATES` carries it per gate, not per record type; nothing states whether a MARKET_SIGNAL
   in the clip export is member-visible. That is why Q14 needed an owner ruling and got one.

---

## 3. QUESTIONS FOR PATRICK

| # | question | status |
|---|---|---|
| **1** | Copy §0.4 into a tracked file | ✅ **APPLIED** — `docs/wisdom/HARD-RULES.md`, scan clean |
| **2** | The D16b merge-map row | ✅ **APPLIED** — REWRITE, verbatim |
| **3** | The CONFOUNDED PRINCIPLE delta | ✅ **APPLIED** — withdrawn, narrowed to the PRINCIPLE row only; `Q3_RERUN: NO`, $0.00 |
| **4** | The extraction budget | **OPEN** — unchanged by this session; the Step 2 table in session 3 stands |
| **5** | Which agent cap is current | ✅ **ANSWERED** — `AGENT_CAP: 3`; 1 used |
| **6** | "Production is dark" as an instrument | ✅ **APPLIED** — built; **but see Q16**, production was not probed |
| **7** | RQ-v11-001 — NULL false positive | **OPEN** — untouched this session |
| **8** | Tonight's four flags | **OPEN** — no flag was flipped; the daily chain's 18:47 ET slot passed during the session |
| **9** | Push the branch | ✅ **ANSWERED** — NO; 0 pushes |
| **10** | Item 3's decisions | ✅ **APPLIED** — storage A, action A, clips FLOOR, scope RECORD |
| **11** | The consumer list | ✅ **APPLIED** |
| **12** | Should the gate persist its records | ✅ **APPLIED** — inert until the next gate run |
| **13** | Record-level vs claim-level scope | ✅ **ANSWERED** — RECORD. ⚠️ The two holes remain open by that choice and are documented in `floor.py` |
| **14** | Does a metadata-only clip export count as publishing | ✅ **ANSWERED** — FLOOR |
| **15** | Normalise the catalog | ✅ **APPLIED** in the reader — and the investigation found **nothing wrong** with the 319/314 split or the 95,790 chars |
| **16** ⭐⭐ | **NEW — merge `feat/wisdom-item3-floor-rail` into `feat/wisdom-loop`?** 3 commits, 32 new tests, 0 NEW failures in the full scoped suite, nothing member-visible, inert with zero stored records. Per 6f it was not merged and not pushed. | **OPEN — load-bearing; this is the only open item-3 question** |
| **17** ⭐⭐ | **NEW — `STABILITY_FLOOR` (0.8) and "stability = 1.0 (3/3)" are the same rule ONLY at N=3.** At N=5, 4/5 = 0.8 passes the floor while not being 5/5. The build reads `STABILITY_FLOOR` as ruled. **If voting ever runs at anything but 3 passes, which governs?** | **OPEN — load-bearing** |
| **18** ⭐ | **NEW — the dark instrument has never been run against production.** `R6_RUN_AGAINST_PROD: NO` was correct for a first run, but the 2026-09-14 05:00 CT "27 of 27 return 401" is still a hand measurement. Run `--host https://uctintelligence.com` (unauthenticated GETs only)? | **OPEN** |
| **19** | **NEW — `tools/wisdom_golden_verify.py:128` holds a second `CATEGORY_STREAM` carrying the `LIVE TRAIDNG` typo.** Out of R15's scope; folding it in would move a golden-gate measurement surface. Fold it, or leave it and keep the test's note? | **OPEN** |
| **20** | **NEW — `docs/recon/` is still untracked**, now four reports (sessions 1–4). They exist only on this box. Track them, or keep them local deliberately? | **OPEN** |
| **21** | **NEW — two pre-existing failures sit in an off-limits path.** `test_mutation_harness_anchors[mutation_harness_flipgate.py]` has been red since before this branch; the harness is in `docs/discord-render/`, which §0.4i forbids editing. Every Wisdom gate run will carry them. Tell the Discord render programme, or add a documented expected-failure baseline? | **OPEN** |

⭐⭐ = blocks other work. ⭐ = load-bearing for one item.
