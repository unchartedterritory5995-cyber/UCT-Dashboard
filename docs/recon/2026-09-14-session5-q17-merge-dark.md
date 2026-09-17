---
id: WISDOM-SESSION-5
title: Session 5 — Q17 into the rail, item 3 merged, production measured dark
status: complete — 7 commits, 1 merge, 0 pushes, 0 API calls, $0.00
---

# Session 5 — Q17 into the rail, merge item 3, dark check, recon hygiene

**$0.00, zero API calls.** The ledger is byte-identical to the one session 4 left.
**The Wisdom scoped suite is green for the first time: 1114 passed · 0 failed · 2 xfailed.**

`feat/wisdom-loop` `4ae9e7dac` → **`ab7c55873`**. Nothing pushed.

## Rulings — one line each

| ruling | outcome |
|---|---|
| **R16** MERGE_ITEM3: YES | ✅ merged — `0de87c7f8`, the session's one merge |
| **R17** VOTING_RULE: FLOOR, MIN_RUNS: 3 | ✅ applied — `floor.passes` now requires `stability_runs >= 3` |
| **R18** DARK_CHECK_PROD: YES | ✅ run — **27/27 → 401**, 0 LIT, 0 unreachable, exit 0 |
| **R19** FOLD_SECOND_STREAM: YES | ✅ folded — one normaliser, both tools import it |
| **R20** RECON_TRACKING: TRACK_IF_CLEAN | ✅ applied — 3 of 4 tracked, 1 moved to the gitignored tree |
| **R21** RENDER_FAILURES: BASELINE | ✅ applied — strict xfail, scoped to Wisdom runs |
| **R22** DESK_CATEGORY_WRITE: PROPOSE | ✅ proposed, **applied neither** — the route is outside Wisdom's paths |
| **R4** SAMPLE_250: NO | ⏭️ skipped, $0.00 |
| **R7** RQ_V11_001: HOLD | ⏭️ plan only, nothing built |
| **R8** FLAGS: HOLD | ⏭️ no flag touched |
| **AGENT_CAP: 3** | 1 sub-agent used, read-only |

---

## STEP 0 — What the guiding chat still lacked

**0a — RQ-v11-001, in full.** Golden v1.1 carries **44 NULL rows, all `provisional`, 0 confirmed**.
For CALL / NEGATIVE_CALL / MENTION / LEVEL the absence rests on a **mechanical screen**, so a
false positive there is a measurement. For PRINCIPLE and MARKET_SIGNAL it rests on a **lexicon
screen plus a human read** (`docs/wisdom/methodology/golden-v1.1.md:96-104`), so a false positive
is *a review item, not a verdict* — **unless the owner rules otherwise**. ⛔ The v1.1 gate **has
never been run**, so there are no NULL false-positive numbers to rule about yet; the ruling and
the run each wait on the other unless the owner breaks the tie.

**0b — item 3 as built, before this session.** `floor.passes(record_type, stability)` at
`floor.py:61-75` read **`stability` only**. `sql_clause` (`:78-93`) and `principles_clause`
(`:96-101`) likewise. ⭐ **`stability_runs` was STORED and REPORTED but never consulted by the
predicate** — its only readers were `enqueue_blocked`'s query (`:138`) and the reason text
(`:147`, `:151`). That is precisely the hole Q17 closes.

**0c — the two owner-side opt-ins**, found by AST rather than grep (a grep returns four, because
both sites carry a comment spelling out the keyword): `brainkb.py:93` (the `_ALL_TYPES` support
lookup — a date and a locator for a principle it is not publishing) and `brainkb.py:250`
(`voice_principle_candidates`, the owner's own sourcing lane). Pinned by
`test_the_two_deliberate_opt_ins_are_the_only_ones`, which walks the AST and carries a control
proving a comment is not a call site.

**0d — the `publication_floor` step:** `chain.py:79`, last in `DAILY`, target
`("api.services.wisdom.publish.floor", "score_silently")`, **no gate** — a floor that can be
switched off is not a floor. It enqueues one review item per blocked record, idempotently.

**0e — the four session-4 defects — ALL FOUR FIXED**, which is what gated Step 4:

| defect | fix | guarding test |
|---|---|---|
| prefix-blind to a member-facing switch | `declared_gates()` reads `flags.GATES`; `env_names_read()` walks `os.environ.get`/`os.getenv` call sites | `test_the_walk_sees_a_switch_whose_name_does_not_start_with_WISDOM` |
| four phantom switches | AST over call sites, not string literals | `test_the_walk_does_not_report_identifiers_or_docstrings_as_env_vars` |
| cp1252 crash → exit 1 (LIT) | `reconfigure(encoding="utf-8", errors="replace")`, `:52` | `test_it_prints_utf8_on_a_cp1252_console` |
| doubled route walk | `path = route.path`, `:185` | `test_8c_no_route_path_is_doubled` |

⚠️ The fourth guard lived on the item-3 branch and reached `feat/wisdom-loop` only at Step 3's
merge — so the gate was satisfied at the moment Step 4 ran, not before.

**0f — Wave 1.5, after session 4.** 1 **DONE**. 2 **NOT STARTED** (the N-pass reconciler; needs
owner spend). 3 **BUILT AND MERGED THIS SESSION**. 4 schema/prompt done and measured, segmentation
deferred on purpose (moving boundaries would confound the two levers). 5 **built, never run** —
needs a paid run **and** RQ-v11-001. 6 projection printed, condition met.

**0g — ledger:** `total_usd 16.872452` · `cap_usd 40.0` · 19 entries · **headroom $23.127548**.

---

## STEP 1 — Q17 into the rail · `2cdab6efc`, `e5a918ea6`

**The rule as implemented:** a record publishes only when `stability >= golden.STABILITY_FLOOR`
**and** `stability_runs >= MIN_RUNS` (3). Never `== 1.0`; never a literal floor.

⭐ **"3/3" is the N=3 instance of that rule, not a separate rule.** At N=3 the attainable values
are 0, ⅓, ⅔, 1 and only 1.0 clears 0.8 — the two spellings select the same records. At N=5 they
diverge and **FLOOR governs**: 4/5 passes.

⛔ **What MIN_RUNS actually stops.** Before it, `stability = 1.0` computed over a **single run**
cleared the floor at all four sites. One run agreeing with itself is not agreement, and 1/1 = 1.0
is the most confident-looking number the pipeline can produce for the least evidence.

**1a — no site re-implements the predicate.** Every `stability` hit outside `floor.py` and the
tests was inspected: the four migrations (DDL), `golden.decide_stability` (the **gate's**
version-acceptance decision — a different question), `report.py`'s weekly surfacing (eval metrics,
not record scores), and three docstrings. `floor.passes` has no caller in `api/**` outside
`floor.py` itself.

**A fourth migration was required.** `core_010_principles_stability_runs` — the Brain KB lane reads
`wisdom_principles` **directly**, so the denominator has to live on that row. ⛔ Not a join to
`wisdom_records`: a principle is a cross-segment identity supported by several records, so *"which
record's run count"* has no single answer.

**1b — behavioural, at all four sites**, because session 4 proved assertion-only tests are not
guards. Cases (i) runs=2/1.0 **blocks** · (ii) runs=3/1.0 **passes** · (iii) runs=5/0.8 **passes**
· (iv) runs=5/0.6 **blocks** · (v) runs=NULL/1.0 **blocks** · plus runs=1/1.0, the motivating case.

**Six mutation proofs**, each restored byte-exact and sha256-verified:

| # | mutation | result |
|---|---|---|
| vi | `MIN_RUNS` → 0 | 9 failed, 29 passed |
| vii | floor compared to a `0.79` literal | **SEE BELOW** |
| viii | site 1 `select_records` bypassed | 2 failed, 36 passed |
| viii | site 2 `brainkb.export_payload` bypassed | 1 failed, 37 passed |
| viii | site 3 `retrieval.search` bypassed | 1 failed, 37 passed |
| viii | site 4 `clips` bypassed | 2 failed, 36 passed |

### ⛔⛔ Mutation vii caught this suite out, and that is the session's best finding

Replacing `floor_value()` with the literal **`0.79`** passed **all 38 tests**. Every fixture value
— 1.0, 0.8, 0.667, 0.6, 0.0 — lands on the same side of 0.79 as of 0.8. **The suite was pinning
its fixtures, not the threshold.**

⭐ The fix is a probe placed strictly **between** the two candidates (`floor - 0.005`), so the two
spellings disagree about it, plus the same treatment on the runs axis. vii now fails by name
(1 failed, 39 passed). **The general shape: to pin a boundary you need a value that only the
correct boundary classifies correctly.**

**1c** — `HARD-RULES.md` gains a dated Q17 note **below a marked line**; the verbatim §0.4 and
§11.3 blocks above it are untouched.

**1e** — full scoped suite on the branch: **1113 passed, 2 failed** (the two render-path ids only).

---

## STEP 2 — R19, one home for the normaliser · `2144edcf5`

`tools/wisdom/category_norm.py` is now the single definition. `extract_catalog_batch` re-exports
it so its callers keep their names; `wisdom_golden_verify` imports the same function and
normalises **before** every `CATEGORY_STREAM` lookup (2 sites) and the `LIVE_SESSION_CATEGORY`
comparison (1 site). **The typo key is deleted from both maps** — normalising first is exactly
what makes deleting it safe.

⭐ **Behaviour proved unchanged by byte comparison, not by reading the diff.** The verifier's
`--self-check` was run with the **pre-fold bytes in place** and again post-fold, both from the repo
so their `REPO`-relative paths resolve identically: **79 lines, exit 0, byte-identical output**;
working tree restored byte-exact.

The test's "out of scope" note is replaced by the assertions R19 asked for — including
`cat.normalize_category is gv.normalize_category`, one object rather than two copies kept in step
by hope. **Mutation:** identity-lambda the verifier's import → 2 failed by name.

---

## STEP 3 — R16, the one merge · `0de87c7f8`

**3a.** Behind `origin/master` by **91**, ahead 9. Against `origin/feat/wisdom-loop`: 0 behind,
401 ahead. **Master was NOT merged** — deferred by ruling. Of the 91, exactly one touches a
wisdom-adjacent path (`.github/workflows/wisdom-rails.yml`, a deploy-gate change that already
exists here); **none touches `api/services/wisdom/**` or `conftest.py`.**

**3b.** `git merge --no-ff feat/wisdom-item3-floor-rail` — clean, 12 files, +1100/−13.

**3c.** Full scoped suite on the merged tree: **1114 passed, 2 failed** (the two ids). Re-asserted:
**27 GET routes** (23 admin + 3 internal + 1 owner, 0 unguarded) and **25 gates** (10
member-visible + 15 owner/internal, 0 off-registry). `app/src/**` and `docs/discord-render/**`
path-filtered diff: **empty**.

**3d — migrations.** `init_db` twice on a fresh temp DB: **24 migrations both times, no new rows,
nothing raised.** All four item-3 migrations applied in order with no "duplicate column"; all four
columns present on both tables.

**3e — inert, measured on the empty store.** `wisdom_records` = 0 rows · `select_records` floored
returns **the same list** as unfiltered · `publication_floor` step: **blocked 0, enqueued 0** ·
review queue 0 rows.

**3f.** The item-3 branch was **not deleted**.

---

## STEP 4 — R18, production measured dark · `b79b295b8`

**4a gate:** all four defects FIXED (0e). `--self-check` **PASS** (13 checks), `--local` **PASS**.

**4b — the definition is redefined, not restated:**

> **0 of the 25 registry gates set** (10 member-visible), **0 off-registry switches**, **27 of 27
> Wisdom GET routes → 401**.

⚰️ The old line — *"six services, 430 variables, zero `WISDOM_*` set anywhere"* — is **superseded
because it counted by NAME PREFIX**, and the prefix is wrong: **`ASKAI_WISDOM_RETRIEVAL_ENABLED`**
is the Ask-AI kill switch, it is **member-visible**, and it does not begin with `WISDOM_`.

**4c — the plan, printed before any request left:** host `https://uctintelligence.com` · 27 routes
· **GET only** · **no Authorization, no Cookie, no push secret** · 1 request per route · **250 ms
spacing** · 10 s timeout · **no retries** · status and byte-shape read, **no body stored or
printed** · UTF-8 output.

**4d — the run, 2026-09-14 23:32 ET:**

```
27 checked · 27 DARK (401) · 0 LIT · 0 unreachable · exit 0 (PASS)
latency ms: min 84 · median 113 · max 684
```

Every one of the 27 returned **401**. ⭐ **All four templated routes were genuinely probed**, with
a placeholder id substituted — a guard that fires before the lookup 401s on a nonexistent id,
which is the evidence wanted; skipping them would have left 4 of 27 unmeasured while the run still
said "checked".

⚠️ A `User-Agent` is set deliberately: Cloudflare 1010-blocks bare tool UAs, which would make every
route read UNREACHABLE and **the run read clean**.

**4e — the gate half is NOT a production measurement, and the docs say so.** Reading production's
variable state needs Railway credentials; this session did **not** attempt it. `--local` measured
**0 of 25 on this machine**, which says nothing about Railway. **Production gate state is
Patrick's to confirm from Railway** — until then, "0 of 25 in production" is *unmeasured*, not
measured.

---

## STEP 5 — R20, recon hygiene

Scanned all four prior reports against seven classes. **Reports 2, 3 and 4: CLEAN.** **Report 1
(`recon-for-guiding-chat.md`): HAS HITS** — B ×5, C ×1, E ×3, F ×1, G ×3.

⭐ **Class B (golden quote / label example) alone is disqualifying**, and it is the class §0.4f
names outright: five lines reproduce labelled extraction examples including one scorer example
carrying a cashtag with an entry condition and a stop (class C, the same line). Classes E, F and G
would not have decided it on their own — **no credential value appears anywhere**, the address is
a vendor no-reply rather than a member's, and the G-030 lines record that the ruling's own content
is *not* held in the report.

⚠️ **No class A (transcript text) and no class D (position or share count) in any of the five
reports.**

⭐ **The scan reported CANDIDATES EXAMINED per class, not just hits**, so a zero is distinguishable
from "did not look": report 1's sweep examined **350** ticker-like tokens for class C and found
exactly **one** bound to a level; a naive `$` regex would have flagged 185 dollar figures that are
all budgets and rates.

**Applied:** report 1 moved to `data/wisdom/recon/` (gitignored — confirmed with
`git check-ignore -v`: `.gitignore:11:data/`). Reports 2–5 tracked. `docs/recon/INDEX.md` lists
every report, its location, and the class it was moved for. ⛔ **No report was edited to make it
publishable** — trimming a record to fit a repo makes it a worse record.

---

## STEP 6 — R21, the expected-failure baseline · `ab7c55873`

`tests/wisdom/EXPECTED-FAILURES.md` + a nodeid-keyed list in `tests/conftest.py`. **No repo-wide
conftest xfail pattern existed** — the only prior use is decorator-based inside two discord-render
test files, which are themselves off-limits to edit — so this is the fallback the brief names.

⭐ **`strict=True`:** if either starts passing, the run **fails** and the baseline must be updated.
**Proof:** point the baseline at a green test → **1 failed, exit 1**. Restored byte-exact.

⛔ **Scoped, not global** — the marks apply only when the session also collected a `test_wisdom_*`
file. **Proof:** running `tests/test_mutation_harness_anchors.py` alone → **2 failed, unmarked**.
Silencing another programme's failures inside *their* runs would be a defect, not a courtesy.

**6c — the note to carry to the Discord render programme, two lines:**

> `tests/test_mutation_harness_anchors.py` has two parametrised cases red for
> `docs/discord-render/instruments/mutation_harness_flipgate.py` (introduced by `a78adcd97` and
> `56e9d3aec`): `anchor_check` extracts **zero controls** from that harness — a failed read, not
> an empty one — and the harness has **no recognised path from a NOT-APPLIED mutation to a
> non-zero exit**, so a mutation proof that never happened would print and the run would still
> pass. The test knows three idioms; this harness matches none.
> Not diagnosed further from a Wisdom session — `docs/discord-render/` is off-limits under §0.4i.

**6d — the scoped run now reads 1114 passed · 0 failed · 2 xfailed.**

---

## STEP 7 — R22, the category write path (PROPOSED, NOT APPLIED)

**7a.** The fallback is **`api/services/desk_daily_session.py:90`**:

```python
return t, t, t.upper()        # auto: the name IS the section + title + eyebrow
```

`t` is the **hand-typed Zoom webinar name**. It collapses whitespace but **does not fold case**,
and the section is written straight to the column at **`:461`** (`"category": section`).
**`api/services/education_service.py:45`** — `category TEXT NOT NULL DEFAULT 'General'`, **no
CHECK, no enum**.

**The five `edu_videos` rows carrying `"Sunday Scans"`** — confirmed to be published session
recordings (their titles are the public Desk/YouTube titles), **not member data**:

| id | title |
|---|---|
| 300 | Sunday Scans — July 26, 2026 |
| 317 | Sunday Scans — August 9, 2026 |
| 324 | Sunday Scans — August 16, 2026 (Part 1) |
| 325 | Sunday Scans — August 16, 2026 (Part 2) |
| 334 | A week to remember \| Sunday Scans — August 23, 2026 |

⭐ These are **not** a defect — they are Zoom recordings of Sunday Scans sessions, and they are why
`by_category` shows 69 Sunday Scans sources against the docstring's 64 (session 4, §2f).

**7b — the proposed write-path diff. APPLIED NEITHER.**

```diff
--- a/api/services/desk_daily_session.py
+++ b/api/services/desk_daily_session.py
@@ _route()
-    return t, t, t.upper()        # auto: the name IS the section + title + eyebrow
+    # ⛔ The section is written verbatim to edu_videos.category (:461), a free-text column with
+    # no CHECK — so a typo'd or differently-cased Zoom webinar name becomes a NEW one-video
+    # category forever. Measured 2026-09-14: "LIVE TRAIDNG" (1 video) and two casings of
+    # "Sharpen your trading skills" (1 each) are three shelves that should be two.
+    section = _canonical_section(t)
+    return section, section, section.upper()
+
+
+#: Typo and casing folds, keyed by casefold. Mirrors tools/wisdom/category_norm.py.
+_SECTION_ALIASES = {
+    "live traidng": "Live Trading Sessions",
+    "sharpen your trading skills": "Sharpen Your Trading Skills",
+}
+
+
+def _canonical_section(raw: str) -> str:
+    collapsed = " ".join(str(raw or "").split())
+    return _SECTION_ALIASES.get(collapsed.casefold(), collapsed)
```

**The boundary, stated because it decides the shape.** The Wisdom normaliser lives at
`tools/wisdom/category_norm.py`. `tools/__init__.py` **exists**, and there is precedent for
`api/**` importing it (`api/services/journal_two/ask_retrieval.py:677`, a function-local
`from tools.…`). But **`tools/wisdom/__init__.py` does not exist**, so `tools.wisdom.category_norm`
is not importable as a package path without adding one. ⚠️ And the deeper objection is layering:
a **production request path importing a dev tool** inverts the dependency and couples a Desk
deploy to a Wisdom tool directory. **Recommendation: duplicate the two-entry map at the write
site** (as drafted) and let the Wisdom reader keep folding on read — two small maps with a comment
pointing at each other is the lesser evil versus a runtime import across that boundary. ⛔ That is
a recommendation, not a decision: the alternative (add `tools/wisdom/__init__.py` and import) is
one line and keeps a single authority, and the Desk programme should pick.

**The data-fix statement, for the Desk programme to run — NOT run here:**

```sql
-- 1 video. Verify the count is 1 before and 0 after.
UPDATE edu_videos SET category = 'Live Trading Sessions' WHERE category = 'LIVE TRAIDNG';
-- 1 video. Case-fold the duplicate shelf onto the canonical spelling.
UPDATE edu_videos SET category = 'Sharpen Your Trading Skills'
 WHERE category = 'Sharpen your trading skills';
```

⛔ **Neither was applied.** `api/services/desk_daily_session.py` and `edu_videos` are outside
Wisdom's paths, and the write path belongs to the Desk programme.

---

## STEP 8 — R4 sample

**`R4_SAMPLE_250: NO`. Skipped, $0.00.** (Headroom was $23.13 against a $19.02 projection, so it
would have fitted; the ruling, not the budget, is why it did not run.)

---

## STEP 9 — R7, RQ-v11-001 (HOLD — plan only)

| | **(a) REVIEW_ITEM** | **(b) VERDICT** |
|---|---|---|
| what it means | a NULL false positive on PRINCIPLE/MARKET_SIGNAL is surfaced for the owner to judge | the gate rules it itself and it counts against the score |
| files | `golden.py` (carry the NULL FP per type into the report), `publish/review.py` (`enqueue` with a reason code), a chain step or the gate tool | `golden.py` only — fold `null_false_positives` into the per-type verdict |
| tests | a NULL FP enqueues exactly one idempotent item; the aggregate is unchanged by surfacing | the verdict changes when and only when a NULL FP appears; a non-NULL run is unaffected |
| member-side change | **none** — the review queue is admin-only | **none** |
| effect on the v1.1 gate | the 86%-blind figure stays a **measurement with a queue beside it**; the gate can run and be read | the figure becomes a **pass/fail input**, so the gate's verdict depends on a screen that is a lexicon plus a human read for exactly these two types |

⭐ **Neither is a precondition for running the v1.1 gate.** The run produces the numbers either
way; what the ruling decides is **how they are read afterwards**. ⚠️ But the ruling is a
precondition for the run being *worth paying for* under (b): if a NULL FP is a verdict, the gate's
own decision inherits the weakest screen in the set, and the $5.28–$7.28 buys a number whose
meaning is still open. Under (a) the run is worth paying for immediately.

**Nothing was built. No branch was created.**

---

## STEP 10 — Item 2 readiness (OPINION)

**10a — the reconciler item 2 needs.** Input: **≥3 persisted gate runs over the same segment set**
(session 4's `data/wisdom/gate-runs/<id>/records.jsonl`, which already carries `record_key`,
`pre_entity_key` and `principle_key`). Match across runs **by KEY, never by text** — that is the
E5 lesson, and `writer.Checked.key()` is the key that already survives paraphrase. Write
`stability = runs_present / N` and `stability_runs = N` onto `wisdom_records` and
`wisdom_principles`. Runs as a chain step **before** `publication_floor`, so a record scored today
is judged today. Files: a new `extract/reconcile.py`, `chain.py` (one `Step`), the two tables'
writers. **~3 commits + ~12 tests**, and the tests can be written against persisted fixtures with
no spend.

**10b — its spend dependency.** With **$23.13** headroom and the measured **$0.076066/segment**:
three passes over the 57-segment gate set = **$13.01**, which fits. Three passes over the 10 drift
segments = **$2.28**. ⭐ The gate set is the right target — it is the only segment set with golden
labels, so the reconciler's output can be checked against known answers rather than only against
itself.

**10c — the next buildable item with no ruling and no spend in front of it: the reconciler's
OFFLINE half.** Session 4's persistence plus session 3's proof that drift reproduces offline at
$0.00 means the matching, the `runs_present / N` arithmetic and the writers can all be built and
tested against **two** existing persisted runs before any third pass is bought. Everything else is
blocked: item 2's measurement on spend, item 5 on spend **and** RQ-v11-001, the live run on the
four flags (R8: HOLD), and master sync on 91 commits.

---

## 1. MUTATION-PROOF

**`git status --porcelain`:** `?? docs/recon/` — resolved by this report's own commit (Step 5c).

**Commits — 7, plus 1 merge. `git show --stat` was read on each:**

| SHA | branch | subject | stat |
|---|---|---|---|
| `2cdab6efc` | item3-floor-rail | feat(wisdom-floor): apply Q17 — FLOOR, min runs 3 | 4 files, +346/−41 |
| `e5a918ea6` | item3-floor-rail | test(wisdom): the brainkb floor test needs Q17's run count | 1 file |
| `2144edcf5` | wisdom-loop | refactor(wisdom): R19 — one home for the normaliser | 4 files, +101/−46 |
| `0de87c7f8` | wisdom-loop | **merge**(wisdom): item 3 publication floor — Q10, Q13, Q17 | 12 files, +1100/−13 |
| `b79b295b8` | wisdom-loop | feat(wisdom): R18 — production measured dark, 27/27 → 401 | 2 files, +111/−12 |
| `ab7c55873` | wisdom-loop | test(wisdom): R21 — baseline the two render failures | 2 files, +100 |
| *(this report)* | wisdom-loop | docs(wisdom): session-5 report + recon INDEX (R20) | — |

**Merges: 1** (`0de87c7f8`, the session maximum). **Pushes: 0**, neither branch —
`origin/feat/wisdom-loop` is still at `ef0393790`, untouched.

⚠️ **`git log 4ae9e7dac..feat/wisdom-loop` counts ELEVEN, and seven of those are this session's.**
The other four (`6dbbd9288`, `4141d0213`, `6f138af70`, `fcda5b433`) are **session 4's** item-3
commits, which became reachable from this branch only when Step 3 merged them. Stated because a
reader running that command sees 11 and would otherwise read four of session 4's commits as mine.

**`git diff --stat 4ae9e7dac..HEAD`** on `feat/wisdom-loop`: **20 files, +1412/−71**.
**`fcda5b433..HEAD`** on the item-3 branch: 2 commits (`2cdab6efc`, `e5a918ea6`).

⭐ **No `git add -A`, `git add .` or `git commit -a` was used.** Every commit staged by explicit
path — the session-4 incident is not repeated.

**Spend ledger — byte-identical:**
```
BEFORE  sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
AFTER   sha256 e284a42bb1356aac115ca0e97f11ecd762745fa0770df46436aca15e58c69520
        total_usd 16.872452 | cap_usd 40.0 | entries 19
```

**Zero flag / env / config / cap changes** — name-filtered diff returns NONE;
`DEFAULT_BUDGET_USD = 120.0` untouched. **No Railway call.** No `.env` opened.

**`app/src/**` and `docs/discord-render/**`: path-filtered diff EMPTY.**

**Member data: NONE.** The only production contact was 27 unauthenticated GETs, every one
answered 401; no body was stored or printed. **D16b / Journal / J2: not read**, by me or the
sub-agent.

**Sub-agents: 1**, read-only — the recon sensitivity scan, which by instruction reported line
numbers and class labels and never the matching content.

**Commands run, by group:** ledger before/after · `git fetch` + behind/ahead × 3 · the one merge ·
`checkout` × 3, `add` by path × 7, `commit` × 7 · scoped pytest × 9 (3 full) · per-file pytest × 8
· mutation harnesses × 3 runs covering 9 mutations, each sha256-verified on restore ·
`wisdom_dark_check` `--self-check` × 2, `--local` × 3, `--host` × 1 ·
`check_repo_hygiene` × 4 (clean each time) · `git check-ignore -v` · migration idempotency probe ·
inert-on-empty probe · the verifier byte-swap comparison · AST/grep reads across `floor.py`,
`schema.py`, `chain.py`, `brainkb.py`, `retrieval.py`, `clips.py`, `common.py`, `golden.py`,
`desk_daily_session.py`, `education_service.py`, `wisdom_golden_verify.py`, `conftest.py`.

---

## 2. TOTALS

```
SESSION-5 TOTALS: ~42 files read, ~88 commands run, 1 sub-agent,
                  tests 1117 run / 1114 passed / 0 failed / 2 xfailed / 1 skipped,
                  7 commits, 1 merge, 0 pushes,
                  0 API calls ($0.00), 1 item NOT FOUND, 5 decisions deferred
```

**The 1 NOT FOUND:** whether the owner-ruling quotes reproduced in report 1 originate as **Discord
messages**. If they do, they reclassify from policy text to class A (transcript text). The medium
is never stated in any of the four reports — they are attributed only as *"the owner's message
of &lt;date&gt;"*. Searched: `Discord message`, `said`, `message of`, `owner's words`, `transcript`,
`recorded`, `session`. ⚠️ It does not change this session's outcome — report 1 is gitignored
either way on class B — but it would change the class if the other three ever gained such a quote.

---

## 3. QUESTIONS FOR PATRICK

| # | question | status |
|---|---|---|
| 1–3, 5, 6, 9–15 | *(sessions 1–4)* | **APPLIED / ANSWERED** — see the session-4 report |
| **4** ⭐⭐ | **The extraction budget.** Unchanged: 9,733 segments; **$740–930** for one pass at the measured rate; $750 buys the corpus once, 25 days at the 400/day throttle. R4 was NO this session, so **the $19.02 sample that would collapse that range to a number has still never been bought.** | **OPEN** |
| **7** ⭐ | **RQ-v11-001.** Plan written (Step 9). Neither option is a precondition for *running* the v1.1 gate; under **VERDICT** the ruling is a precondition for the run being **worth paying for**. | **OPEN — plan ready** |
| **8** ⭐⭐ | **The four flags.** R8: HOLD, nothing flipped. **Next daily-chain window: TUESDAY 2026-09-15, 18:47 ET.** ⚰️ This said *Monday* — 2026-09-15 is a Tuesday, corrected in session 6. Preconditions for a flip, all four now measurable: `WISDOM_INGEST_ENABLED` is the master switch (`registry.py:201-202`) and nothing runs without it; the other three are `WISDOM_CAPTURE_ENABLED`, `WISDOM_SOURCES_INGEST_ENABLED`, `WISDOM_EXTRACT_ENABLED`. ⭐ Production is now **measured** dark on the route half (27/27 → 401), so a flip has a real before-picture for the first time. | **OPEN** |
| **16** | Merge item 3 | ✅ **APPLIED** — `0de87c7f8` |
| **17** | FLOOR vs UNANIMOUS | ✅ **APPLIED** — FLOOR, min runs 3 |
| **18** | Dark check against production | ✅ **APPLIED** — 27/27 → 401 |
| **19** | Fold the second stream | ✅ **APPLIED** |
| **20** | Recon tracking | ✅ **APPLIED** — 4 tracked, 1 gitignored |
| **21** | Render failures | ✅ **APPLIED** — strict, scoped |
| **22** ⭐ | **The Desk category write path.** Diff and data-fix drafted, **applied neither**. **Apply from the Desk programme?** And which shape — duplicate the two-entry map at the write site (recommended), or add `tools/wisdom/__init__.py` and import the single authority across the boundary? | **OPEN — needs the Desk programme** |
| **23** ⭐⭐ | **NEW — master sync is 91 commits deferred.** None touches `api/services/wisdom/**` or `conftest.py`; one touches `.github/workflows/wisdom-rails.yml`. The gap grows every hour and the eventual merge is the riskiest single act left in this programme. **Merge master next session, before more is built on top?** | **OPEN — load-bearing** |
| **24** ⭐ | **NEW — the production GATE state has never been measured.** The route half is now measured; the switch half is `--local` only, because reading Railway needs credentials this programme does not use. **Confirm `0 of 25` from Railway yourself**, or authorise a session to run `railway variables --service web --kv` read-only? | **OPEN** |
| **25** | **NEW — `MIN_RUNS = 3` is now a second threshold beside `STABILITY_FLOOR`.** If item 2 ever votes at N≠3, FLOOR semantics mean 4/5 publishes. Recorded in `HARD-RULES.md`; **confirm that is intended before item 2 picks its N.** | **OPEN** |

⭐⭐ = blocks other work. ⭐ = load-bearing for one item.
