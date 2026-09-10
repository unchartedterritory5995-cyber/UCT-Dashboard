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
