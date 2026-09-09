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
