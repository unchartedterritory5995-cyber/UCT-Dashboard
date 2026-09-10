# requests.md — things one session needs from another

One entry per request. Whoever owns the territory closes it by editing the entry
in place with what was found, rather than deleting it: a closed request with its
answer is the only record that the question was ever asked.

⛔ **A REQUEST IS NOT A BUG REPORT.** It carries the exact command that
reproduces, what it prints when it passes, and what it prints when it fails. A
sentence describing a failure costs the reader the whole investigation again.

---

## OPEN · 2026-09-09 · two escape-census rails are green ALONE and red IN COMPANY

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

---

## For `worktree-indicator-ecosystem` — `test_definition_concierge` is red on your own tip

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
