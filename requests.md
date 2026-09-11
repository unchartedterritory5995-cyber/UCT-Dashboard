# requests.md — things one session needs from another

One entry per request. Whoever owns the territory closes it by editing the entry
in place with what was found, rather than deleting it: a closed request with its
answer is the only record that the question was ever asked.

⛔ **A REQUEST IS NOT A BUG REPORT.** It carries the exact command that
reproduces, what it prints when it passes, and what it prints when it fails. A
sentence describing a failure costs the reader the whole investigation again.

---

## ✅ ANSWERED 2026-09-11 · two escape-census rails are green ALONE and red IN COMPANY

**Raised by:** the indicator-ecosystem session (Pine ingestion engine).
**Territory:** the repo-root `conftest.py` / test-fixture scoping. Not ours.
**Blocking us:** no. We route around them and do not claim repo-green.

### The two tests

```
tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE_and_the_reconciliation_says_so
tests/test_ast_conformance.py::test_the_guarded_census_offers_each_case_to_the_DOOR_ITS_CLAIM_IS_ABOUT
```

### Repro — RED under pytest

```
cd C:/Users/Patrick/uct-dashboard/.claude/worktrees/indicator-ecosystem
python -m pytest tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE_and_the_reconciliation_says_so -q
```

prints

```
AssertionError: ['too_many_nodes']
```

from `assert res["wrong_door"] == [], res["wrong_door"]` — i.e. the escape case
`too_many_nodes` fired a guard other than the `budget:nodes` it declares.

### Repro — GREEN outside pytest, same code, same process order

```python
# run from the same directory, NOT under pytest
import sys, pathlib
ROOT = pathlib.Path(".").resolve()
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from api.services import ast_interpret        # the order the test module imports in
import ast_conformance as ac
res = ac.escape_census(unguarded=False)
print(res["wrong_door"])                      # -> []
print(res["refused"], res["parsed"])          # -> 17 18
```

`wrong_door` is empty and `too_many_nodes` does not appear in
`res["refusal_guards"]` at all. Under pytest it does, and in the wrong door.

### What we established, and what we did not

* ⛔ **NOT CAUSED BY THE PINE WORK.** Reproduced at `HEAD` with
  `api/services/ast_interpret.py` and `tests/test_ast_interpret.py` restored from
  `git show HEAD:…` — both tests still fail. Verified 2026-09-09 immediately
  before commit `cd078bbd2`.
* The only difference between the two runs is that one loads the repo-root
  `conftest.py`, which redirects a set of env pins at IMPORT time (the shared
  `C:\data` tripwire). Our best guess is that one of those pins reaches a budget
  or a path the census reads — but **that is a guess and we did not chase it**,
  because the file is yours and a second session poking at import-time env pins
  is how the pins stop being one authority.
* We did not check whether the divergence is order-dependent WITHIN pytest
  (running the two tests alone vs the whole file). Worth one run.

### What we would find most useful

Either a fix, or a one-line answer we can put in the test: if the census is
legitimately measuring something different under the sandbox pins, the tests
should say so and assert the pinned behaviour, rather than reading as a red
nobody owns.

> ### ✅ ANSWERED — it does not reproduce here, and the neighbouring defect it looks like IS real and is fixed
>
> **2026-09-11, on `feat/indicator-r0r1`.** Both rails are green ALONE and green
> IN COMPANY, so the red you saw is not reproducible from this branch:
>
> ```
> python -m pytest tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE_and_the_reconciliation_says_so -q   -> 1 passed
> python -m pytest tests/test_ast_conformance.py::test_the_guarded_census_offers_each_case_to_the_DOOR_ITS_CLAIM_IS_ABOUT -q   -> 1 passed
> python -m pytest tests/test_ast_conformance.py tests/test_ast_interpret.py -q                                              -> 162 passed, 5 skipped
> python -m pytest tests/test_ast_*.py -q                                                                                    -> 796 passed, 5 skipped, 1 xfailed
> ```
>
> ⚠️ **That is a measurement on THIS branch, not a fix of yours.** Your repro ran
> in `.claude/worktrees/indicator-ecosystem`; if it still reproduces there, the
> difference is that worktree, and the run above is the control proving the two
> rails themselves are sound.
>
> ⭐⭐ **What to check first if it does — because your symptom has a mechanism, and
> it is not the env pins.** "Green outside pytest, red under pytest, same code,
> and the case fires a DIFFERENT GUARD" is the exact signature of a **stack
> overflow laundered into a guard name**. Under pytest the interpreter is already
> many frames deep, so a walker that recurses once per node has less headroom than
> the same walker run from a bare script — and the recursion error, caught by an
> outer `except`, comes out wearing whichever guard that handler defaults to. A
> census cannot tell that apart from an ordinary refusal: it is `ok: False`, it
> has a guard name, and it is counted as refused.
>
> ⚰️ **We found exactly that defect — in the JS lane — while looking.**
> `parse.js::convert` was recursive, one frame per node, and `parseFormula` ends
> with `guard: err instanceof TableRefusal ? err.guard : 'canonicalise:node'`. A
> `RangeError` is not a `TableRefusal`, so a stack overflow reached the member as
> **`canonicalise:node`** — "I don't recognise this node shape" — for a formula
> made entirely of `+` and `1`. Measured by importing the pre-change file beside
> the new one and bisecting:
>
> ```
>   recursive convert : survives 5,468 nodes deep, dies by 5,500   (this runtime)
>   iterative convert : 200,000 deep, fine
>   OLD parseFormula(12,000 terms) -> refused: canonicalise:node
>   NEW parseFormula(12,000 terms) -> ok, and the BUDGET then refuses it
> ```
>
> `convert` is now an explicit-stack walk (guards still run at ENTER, children
> pushed in reverse so they complete left-to-right, so refusal ORDER is unchanged).
> Rail: `app/src/components/chart/engine/ast/parse.deepTree.test.js`, whose depth
> control **calibrates itself** — it bisects the ceiling of a minimal recursive
> walk on the running engine and tests past it, because the number it needs is a
> property of the engine and not of this repo.
>
> ⛔ **The corpus case did NOT prove this, and we are saying so rather than
> claiming the credit.** `escapes.json::too_many_nodes` is `gen:nest(4000)` =
> 4,001 deep, which is UNDER the measured ceiling — it passed before the change
> and passes after. It is pinned in that file because it is the declared claim;
> the regression proof is the self-calibrating control beside it.
>
> ⭐ **And the reason this could only bite the JS lane is structural, which is
> worth knowing before you look for it in Python.** `ast_interpret.interpret`
> asserts the budget BEFORE it walks, so an over-budget tree never reaches a
> per-node walker; and `ast_budget`'s `node_count` / `series_refs` /
> `max_lookback` are all iterative — verified at 8,001 nodes deep against a
> recursion limit of 1,000:
>
> ```
>   interpret(nest(4000))  -> BudgetExceeded: exceeds the node budget (measures 4001)
>   node_count(nest(8000)) -> 8001        series_refs / max_lookback -> OK
> ```
>
> The JS door cannot do that, because there the walk IS the parse: there is no
> tree to budget until `convert` has built one. So budget-after-walk is forced on
> that side, and the walk has to be the thing that cannot fall over.

---

## ✅ SUPERSEDED 2026-09-11 by `a835b0ade` — `test_definition_concierge` is red on your own tip

Measured 2026-09-09 by checking out `35ba654da` clean and running the file there:
**2 failed, 89 passed** — `test_the_tool_schema_has_no_dangling_node_reference` and
`test_every_node_type_is_either_described_or_declared_omitted`, both reporting
`['str', 'symtext', 'textop']`.

**Diagnosis, so you do not have to re-derive it.** `ae2ed68ec`'s sibling work grew
`api/services/user_definitions.py` by 42 lines, adding `str` / `symtext` / `textop`
to `_CANONICAL_KEYS`, and therefore to `NODE_TYPES`. `api/services/definition_concierge.py`
was **not touched in the same range** — `git diff 3a1d9d4a3 35ba654da -- definition_concierge.py`
is empty — so the tool schema now offers three node types it neither describes in
`$defs` nor names in `CONCIERGE_OMITS`, which is exactly what those two tests exist
to catch.

⛔ **NOT fixed in the barstate merge, deliberately.** It is not the merge's defect and
guessing which of the two remedies you want — describe them, or declare them omitted —
would put a second opinion on a decision that is yours. The merge carries it forward
unchanged and this note is the routing.

> ### ✅ SUPERSEDED — the owner ruled, and the answer was neither remedy alone
>
> **`a835b0ade` (2026-09-11), under owner RULING D.** The two remedies this note
> offered were *describe them* or *declare them omitted*. The ruling took the first
> — **Kind 4 is member-reachable**, so hiding the trio would refuse a question the
> table supports — but the schema needed a THIRD category to do it honestly:
>
> * `textop` is **described and offered**: it sits wherever a number sits.
> * `str` and `symtext` are **described but operand-only** (`_OPERAND_ONLY`): they
>   are defined in `$defs` and reachable through `textop.args`, and excluded from
>   the top-level `node` union, because `closedTable.json` says they *"may appear
>   NOWHERE except directly under a `textop`"*. ⚠️ Putting them in
>   `CONCIERGE_OMITS` instead — the remedy as literally offered — would have left
>   `textop`'s own `args` pointing at two definitions the schema had just removed:
>   the dangling `$ref` this block exists to prevent, reintroduced by the fix for it.
>
> ⚠️ The member-facing WORDING is marked *"drafted autonomously 2026-09-11, product
> review pending"* in `definition_concierge.py`. It is drafted from each type's
> evaluation semantics in `ast_bind`, not invented — but what a member reads is
> still yours to approve.
>
> ⭐ **And the diagnosis in this note was right and incomplete in the same way.** It
> named `definition_concierge` as the artifact left behind. Four others were:
> `ast_lint._CANONICAL_TYPES`, `ast_freshness._CANONICAL_TYPES`,
> `scan_definition`'s branch arms, and — the one with **no rail at all** —
> `compute_graph.CANONICAL_KEYS`. All are fixed in the same commit, and
> `tests/test_node_vocabulary_parity.py` now FINDS copies of the vocabulary by AST
> walk instead of listing them, so the next one is covered the day it lands.

⚠️ Also worth knowing: your worktree's `app/node_modules` is what
`uct-worktrees/indicator-r0r1` (and, through it, a temporary merge probe) symlinks to,
and it is **missing `pdfjs-dist`** — see the note below if present, or ask.

---

## OPEN · 2026-09-10 · both demand censuses measure 129 scripts against a floor of 150

**Raised by:** the `indicator-r0r1` session (scan-evaluator / NYSE calendar work).
**Territory:** the Pine corpus roster and the census instruments. Not ours.
**Blocking us:** no. We route around them and do not claim repo-green.

### The two tests

```
app/src/components/chart/engine/ast/capabilityDemandCensus.test.js
  > ⭐⭐⭐ capability demand — total, not just first blocker (§7)
  > reports both numbers for every family                        (line 267)

app/src/components/chart/engine/ast/historyDemandCensus.test.js
  > 2F-2 — runtime history demand across every corpus
  > reports both numbers, and they are different questions       (line 140)
```

Both fail with the SAME message:

```
AssertionError: expected 129 to be greater than 150
```

from `expect(REPORT.scripts).toBeGreaterThan(150)` and
`expect(REPORT.totals.scripts).toBeGreaterThan(150)` respectively.

### Repro — RED

```
cd C:/Users/Patrick/uct-worktrees/indicator-r0r1/app
./node_modules/.bin/vitest run \
  src/components/chart/engine/ast/capabilityDemandCensus.test.js \
  src/components/chart/engine/ast/historyDemandCensus.test.js
```

prints `Tests 2 failed | 5 passed (7)` and, above it, the census's own header line
`129 scripts, 27 executing end-to-end`. When it passes, that count is over 150 and
the two `reports both numbers…` cases go green with the other five.

### Evidence it is PRE-EXISTING and not ours

* ⛔ **NEITHER TEST FILE IS TOUCHED BY THIS WORK.** `git status --short` names
  neither, and `git log origin/master..HEAD -- <both files>` reaches no commit of
  ours — the last one to touch either is `0df2dd951`, which is the commit that
  WROTE the floor.
* ⛔ **THE FLOOR WAS RED ON THE COMMIT THAT INTRODUCED IT.** Counted at that
  commit rather than inferred, `git ls-tree -r --name-only 0df2dd951 -- <dir>`:
  `pine_oos` 30 · `pine_blind` 48 · `pine_community` 30 · `oos2_parity` **0** ·
  `pine` 21 = **129**. So `> 150` has never been satisfiable by the `CORPORA`
  list as written, and this predates `corpus/committed` existing at all.
* The same five counts hold at `HEAD` today, measured the same way.

### Diagnosis, so you do not have to re-derive it

`CORPORA` is declared identically in both files and lists five directories,
resolved as `path.resolve(process.cwd(), rel)` with vitest's cwd at `app/`:

```
['oos1',      '../tests/fixtures/pine_oos']         30 .pine
['blind',     '../tests/fixtures/pine_blind']       48 .pine
['community', '../tests/fixtures/pine_community']   30 .pine
['parity',    '../tests/fixtures/oos2_parity']       0 .pine   ← contributes nothing
['curated',   '../tests/fixtures/pine']             21 .pine
                                                   ─────
                                                    129
```

* **`tests/fixtures/oos2_parity` holds no `.pine` files at all** — verified with
  `find tests/fixtures/oos2_parity -type f`, which returns exactly two paths,
  `README.md` and `.gitignore` (positive control: the same command on
  `tests/fixtures/ast` returns 12). ⭐ **AND THAT IS BY DESIGN, NOT AN ACCIDENT
  TO REPAIR** — its `.gitignore` is `*.pine`, because six of the ten members'
  recorded licences do not contemplate redistribution and a copy is still a
  redistribution, so all ten are withheld rather than six. A directory whose
  contract is "the scripts are never committed here" cannot contribute to a
  census that reads committed `.pine` files, on any machine but the one that
  re-materialised it.
* **`corpus/committed` is not in `CORPORA` at all.** It holds **266** `.pine`
  files, flat (no subdirectories), so it is directly compatible with the
  census's non-recursive `fs.readdirSync(dir).filter(x => x.endsWith('.pine'))`.
  It was added by `6bb44ea5e` ("R1 corpus: 266 commit-eligible, not 202"), after
  the floor was written. **129 + 266 = 395.**

### Both remedies, and the choice is yours

We are deliberately not picking one — the census population is a measurement
decision about YOUR instrument, and guessing it would put a second opinion on
something that is yours to rule on.

* **(A) Widen the census inputs.** Add `['committed', '../corpus/committed']` to
  `CORPORA` in both files; `REPORT.scripts` becomes 395 and both floors clear.
  ⚠️ What it costs: every family's `totalDemand` / `firstBlocker` / `byCorpus`
  number then describes a three-times-larger population, so any figure quoted
  from a previous census report is superseded rather than extended, and the
  `byCorpus` breakdown gains a member that dominates it.
* **(B) Lower or retire the floor.** The instruments' own headers say
  *"⛔ IT PINS NO NUMBER (`lesson_an_arming_condition_that_names_a_test_expires`).
  The assertions are non-vacuity and internal consistency; the report is the
  output."* — and `> 150` is the one number they do pin. A floor that has been
  red since the commit that wrote it is arguably the case that lesson names.
  ⚠️ What it costs: nothing then catches a `CORPORA` entry silently resolving to
  an empty directory, which is exactly what `oos2_parity` does today — so if you
  take (B), the non-vacuity check probably wants to move down a level and assert
  that **every** corpus in `CORPORA` contributed at least one script, naming the
  one that did not.

⛔ **We changed neither census test.** This entry is the routing.

---

## ✅ RESOLVED 2026-09-11 · a committed fixture and its blob disagree about line endings, and the alarms say "STALE"

**Raised by:** the `indicator-r0r1` session.
**Territory:** repo-wide (`.gitattributes`), so nobody's in particular.
**Blocking us:** no — the two instances that were RED are fixed. This is about the next one.

### It has now happened three times in one day

| where | what the alarm said | what it was |
|---|---|---|
| `tests/fixtures/member/*.pine` | 🔴 *"THE AUTHOR'S SCRIPT CHANGED … every 'line N' reference in this project now points at a different statement"* | 34,950 bytes on disk vs a 34,342-byte blob — exactly its 608 CRLFs |
| `…/importer/__fixtures__/obsidian_parity/*.json` | *"committed fixtures are STALE relative to the current provider pre-pass output — regenerate … and commit the result"* | all 7 byte-identical to their blobs once normalised |
| every "modified" file in `git status` with an empty `git diff` | nothing — silent | the same thing, wearing no alarm at all |

Each was fixed with one `text eol=lf` line, and the second of them sits **directly
beneath a rule written for the identical failure in a sibling directory** — that rule
named `server_convert/` and the fixtures live in `obsidian_parity/`.

### ⛔ Why this is worth a ruling rather than another one-line patch

**The prescribed remedy causes the real defect.** Both alarms tell you to re-record:
*"re-record `file_sha256`"*, *"regenerate … and commit the result"*. Doing that bakes
this box's CRLF into the committed artifact, and the same test then fails on every
checkout that is not this box. The louder the alarm, the more likely someone obeys it.

**And the alarm is the one you least want crying wolf.** The member-fixture rail exists
to shout when a member's script is swapped under our line-number references. Teaching
whoever meets it that it cries wolf is worse than the drift it guards.

### The measurement

**1,887 tracked fixture files** (`tests/fixtures/**` plus every `__fixtures__/**`), and
**none carries an eol attribute**. Repo-wide, 8,061 of 9,481 tracked files are CRLF on
disk against an LF blob — which is simply what `core.autocrlf=true` does here and is
harmless for source. It bites **only** where a test compares raw BYTES: a hash, a
`read_bytes()`, or a regenerate-and-diff. JSON that gets parsed does not care.

### Two candidate fixes, and the second is not obviously safe

1. **`-text` on fixture paths** — no conversion in either direction, so whatever bytes
   are committed are the bytes on disk. ⭐ Safe for a fixture that contains
   *intentional* CRLF as test data.
2. **`text eol=lf` on fixture paths** — ⛔ **this would DESTROY such a fixture**: `text`
   normalises on commit, so a fixture deliberately holding CRLF (a converter test, a
   header parser, an import round-trip) has its own subject silently rewritten. We did
   not audit 1,887 files for that, which is exactly why this is routed and not done.

**What we would find most useful:** a ruling on which of the two, and whether it applies
to all fixture roots or only the byte-compared ones. A rail asserting the chosen
attribute holds for every fixture path is then mechanical, and this stops recurring.

⭐ **The detection recipe, so the fourth instance costs a minute instead of an hour:**
compare `os.path.getsize(f)` with the blob size from
`git cat-file --batch-check`. If the difference equals the file's CRLF count, nothing
drifted — the checkout filter did. `git diff` will also be empty while `git status` says
modified, which is the same fact wearing a disguise.

> ### ✅ RESOLVED — killed at the rails, so the repo-wide question is moot
>
> **2026-09-11.** The ruling was *normalise at every hash-comparing rail*, and that
> is done: `test_member_fixtures`, `test_obsidian_parity_fixtures`, the
> saved-scripts sweep and `write_capture` all normalise line endings before they
> hash or compare. A fixture whose SUBJECT is line endings opts out with
> `"crlf_subject": true` in its manifest row.
>
> ⭐ **PROVED, NOT ASSUMED.** Each rail was re-run against a deliberately CRLF'd
> working copy — `uncharted-volume.pine` at 34,950 bytes and the obsidian fixtures
> at 556, the exact states that produced the false alarms — and both stayed green;
> every file was restored byte-exact afterwards.
>
> **The alarm text is fixed too**, which was the dangerous half. Both messages now
> say line endings are *not* the cause before they suggest anything, so the remedy
> they prescribe can no longer cause the defect they are reporting.
>
> ⚠️ **The 1,887-fixture `.gitattributes` question is now moot rather than
> answered.** It only mattered because the rails could not tell a filter from a
> change; they can now. The `*.pine` and `obsidian_parity` `eol=lf` rules stay as
> defence in depth — they keep `git status` honest — but nothing depends on them,
> and in particular nobody has to audit 1,887 files for one whose subject is CRLF.

---

## OPEN · 2026-09-11 · five standing Python reds, grouped by area, with one-line causes

**Raised by:** the `indicator-r0r1` session, from a chunked full-lane run.
**Territory:** none of these are ours — no file below was touched by this wave.
**Blocking us:** no. We route around them and do not claim repo-green.

Each is named with the assertion it actually makes, so nobody has to re-derive it.

### 1. `financial_statements.py` reaches yfinance with no binding proof

```
tests/test_yf_guard_binds.py::test_every_yfinance_module_has_a_binding_proof_or_a_named_reason
  → these modules reach yfinance and have no binding proof:
        api/services/financial_statements.py
    Add a `test_<module>_reaches_yfinance_through_the_guard` here.
```

The rail wants one test per yfinance-reaching module proving it goes through the
bounded guard. ⚠️ Worth doing rather than exempting: the guard is what stops an
unbounded provider call pinning a thread in the single shared anyio pool, which is the
524-outage surface.

### 2. A `vcp/engine` threshold moved without its agreement table

```
tests/test_two_engines_do_not_agree.py::test_the_shipped_thresholds_have_not_moved
  → these thresholds changed since the agreement table was measured:
        vcp/engine: [('_TREND_TEMPLATE_SMA_LONG', 200), ('_TREND_TEMPLATE_SMA_SHORT', 150)]
    RE-MEASURE. Update both the docstring table and MEASURED_AGAINST — never one without the other.
```

⭐ The rail is explicit that the two must move together, so this is a re-measure, not a
number edit. We did not touch the detector and cannot know whether 200/150 is the new
intent or a slip.

### 3. An unquarantined URL literal in the FMP news adapter

```
tests/test_fmp_guard_census.py::test_real_repo_has_zero_unquarantined_violations
  → unquarantined URL-literal hits:
        api/services/news/adapters/fmp_news.py:37  BASE = "https://financialmodelingprep.com"
```

One literal, one line. Either route it through the same guard every other FMP caller
uses, or quarantine it with the reason.

### 4. An import-time `sys.modules` bind in a test module

```
tests/test_shared_state_landmines.py::test_no_test_module_binds_into_sys_modules_at_import_time
  → import-time sys.modules bind(s) — install AND remove it in a fixture, or delete the
    stub if the reason for it has expired:
        tests/test_mobile_audit_route_validity.py:30   sys.modules[...] =
```

⛔ This is the shape that makes a suite order-dependent: a stub installed at import
outlives its own file and is still there for everything collected after it. ⚠️ We hit
four order-dependent reds in this same run (see below), so this one is not cosmetic.

### 5. Six feature gates that are off, and nothing says whether that is deliberate

```
tests/test_feature_flag_ledger.py::test_every_off_by_default_gate_is_declared
  → COMPANY_NEWS_INGEST_ENABLED (default='', api/main.py)
    FLOW_BOOTSTRAP_ENABLED (default='0', api/services/flow_aggregate.py)
    FLOW_PREPARE_ENABLED (default='0', api/flow_router.py)
    OPTIONSFLOW_ETF_REPLICA_PUSH_ENABLED (default='0', api/services/optionsflow_etf_push.py)
    OPTIONSFLOW_ETF_REPLICA_RECEIVE_ENABLED (default='0', api/services/optionsflow_etf_replica.py)
    PANEL_PREWARM_ENABLED (default='', api/main.py)
    Add an entry: armed / dark (with a reason) / pending (reason + since).
```

The ledger exists because *off-and-unset is indistinguishable from off-on-purpose*.
Each needs one line in `docs/feature_flags.json` from whoever owns the flag.

### And a sixth thing, which is not a red — it is a warning about reading reds

⚠️ **FOUR failures in the same run were LOAD-SENSITIVE, not real.** Under memory
pressure — 3.7 GB free with eleven test processes from several sessions — these failed:

```
api/services/bars_fetch_test.py::TestHotIntradaySet::test_recent_first_and_bounded
tests/test_desk_session_recap.py::test_post_recap_posts_chunks
tests/test_earnings_analysis.py::TestGenerateEarningsPreview::test_preview_graceful_finnhub_failure
tests/test_exposed_routes_gated.py::test_the_gate_ladder_MEASURES_who_each_gate_admits
```

Re-run together on an idle box: **229 passed**. ⛔ So a failure list from a loaded
machine is not a defect list, and the difference is not visible in the log — a
load-sensitive red and a real one read identically. Anyone triaging this suite should
re-run a candidate alone before filing it.

---

## ✅ CLOSED 2026-09-11 · the 1-arg `ta.highest`/`ta.lowest` default needs an ARITY layer, not a tree rewrite

**Raised by:** the `indicator-r0r1` session, which wrote the fix, shipped it, and reverted it the same night.
**Territory:** `pine.js` ↔ `pineRuntimeFrontend.js` — the boundary is the point.
**Blocking us:** yes, softly. 97 one-argument call sites across 33 tracked `.pine` files do not translate.

### The measurement is settled

`ta.highest(n)` defaults its source to `high`; `ta.lowest(n)` to `low` — an
asymmetry, and not `close` for either. 397 of 397 usable bars agree, zero agree with
any rival. Capture: `tests/fixtures/vendor/groupb-hilo-default-spy-1d-2026-09-10.json`.
Site count re-measured by balanced-paren scan over all 510 tracked `.pine` files:
**97 one-argument sites in 33 files** (the doc's older 81 is stale and understated).

### What we tried, and exactly why it was wrong

Adding `'ta.highest'` / `'ta.lowest'` to `PINE_NAMESPACED_TREE` supplies the default in
three lines and translates the 1-arg form correctly. It also **reclassifies the names**:

```js
// pineRuntimeFrontend.js — windowTarget AND carriedTarget both open with:
if (tree[name]) return null      // a name rewritten here is NOT carried/windowed
```

So the runtime lane began refusing
`runtime:call-windowed-state: a WINDOWED builtin fed by a mutable variable — this one
needs the series bridge` for the **two-argument** form, which had always worked. Four
`finiteWindow.test.js` tests and one `executionShapeCensus.test.js` script went red.

⭐ **The guard predicted this in writing.** `carriedTarget`'s comment calls that line
*"UNFALSIFIABLE AGAINST THE SHIPPED TABLES … deleting this line changes no answer and a
mutation run would report it surviving. It is kept because `ta.highestbars` proved what
a dropped namespaced transform costs."* This change is the first thing that ever
falsified it, and it fired correctly.

### The distinction that matters

`ta.highestbars` and `ta.pivothigh` belong in `PINE_NAMESPACED_TREE` because they need a
**transform** — a negation, a confirmation shift. `ta.highest` needs only a **default
argument**. Supplying a default by rewriting the tree drags the name across a
classification boundary it has no business crossing.

**What we would find most useful:** somewhere to declare *"this Pine spelling may be
called with n−1 arguments; here is the node that fills slot 0"*, consulted where arity
is resolved and invisible to `PINE_NAMESPACED_TREE`. `ta.pivothigh`'s 2-arg form and
`ta.highestbars`' 1-arg form already hand-roll the same idea inside their transforms, so
there would be at least three callers on day one.

⛔ **Do not close this by editing `finiteWindow.test.js`.** Those four tests are the
runtime differential and they were right.

> ### ✅ CLOSED — the layer existed already
>
> `PINE_SHORT_FORM` (2026-09-11). The facility this note asked for — *"somewhere to
> declare: this Pine spelling may be called with n−1 arguments; here is the node that
> fills slot 0"* — turned out to be **half-built already**: the `{series: …}` plan
> entry that turns `ta.atr(14)` into `atr(high, low, close, 14)` is exactly that node,
> and all that was missing was a way to reach it when the member's arity is short.
> Consulted where arity is resolved, invisible to `PINE_NAMESPACED_TREE`, so the
> runtime classifiers are untouched. The four `finiteWindow` tests and
> `executionShapeCensus` pass and are kept as the control.
>
> ⛔ **Named calls are deliberately NOT eligible.** `ta.highest(length = 20)` names a
> slot nobody measured — `PINE_ARG_NAMES` carries no evidenced parameter names for
> these, the v5 migration guide lists them with empty parentheses — so it still meets
> the refusal it met before rather than being handed a source it did not ask for.
>
> ⚠️ **`ta.vwap` IS STILL OPEN and is a different problem.** It is the MIRROR image:
> Pine passes a source (`ta.vwap(hlc3)`) that our zero-argument `vwap` does not take,
> so the fix is a DROP rather than a fill. The identity is measured — `ta.vwap(hlc3)`
> minus bare `ta.vwap` was 0 across 40 bars while `ta.vwap(close)` ranged
> −4.29..+2.91 — but the one-argument spelling is refused UPSTREAM, in the
> value-namespace path, before any arity layer is reached. `PINE_CALL_SHAPES` already
> carries a comment saying exactly why it is not there: *"a shape carries ONE
> `pineArity`, and bare `ta.vwap` is a zero-argument VARIABLE that reaches the table
> and works today"*. A drop mechanism was written, measured to be inert at that
> position, and REMOVED rather than left as dead code.
