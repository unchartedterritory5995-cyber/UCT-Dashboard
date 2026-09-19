---
id: e-cp36-build-record
unit: E CP36
packet: packet-e-ci-gap-gate
merges-after: E CP35
status: SIGNED (E CP36, fingerprint 85bd06d20)
---

# E CP36 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  85bd06d20
SCOPE APPROVED:   CP36 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP36 — a missing dependency was aborting two whole shards (F-CI-46).**
> Scope is `requirements.txt` **as enumerated by `git show --stat` of
> `afbbd39b5`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk top out at **e-cp35**; manifest rows top out at **CP35**. **CP36 free.**

⚠️ **Renumbered from the prompt's plan**, which used CP36 for the post-merge baseline
re-anchor (itself already a renumbering off the ORIGINAL plan's CP35 — see E CP35 §
header). That re-anchor becomes **E CP37**; this row is the one built first, so it takes
the free number. Collision proof is the authority, not the plan's spelling — the same
precedent E CP35 set for E CP34.

---

## 1 · F-CI-46 — the first real master CI run silently lost two whole shards

Master's first-ever full-suite run (`35315716615`, triggered by E CP34's new push trigger,
on commit `e4b2658ec`) reported `verdict: COVERAGE_LOST` against the standing feat-branch
baseline (`35008710335`, #19): **28 NEW, 31 FIXED, 10 MISSING** — none of it matching E
CP37's own acceptance bar (`POST_MERGE_QUEUE.md` P.2: *"FIXED = {F-CI-42's entry} and
nothing else"*).

**Measured, not guessed:**

```
per-shard collected counts (results/35315716615/shards/pytest-shard-tests-*/summary.json)
  shard 01: 2789   shard 02: 1681   shard 03: 1831   shard 04: 1532
  shard 05: 2541   shard 06: 2039   shard 07: 2114   shard 08:    1  <- interrupted
  shard 09:    1  <- interrupted    shard 10: 1651   shard 11: 1591   shard 12: 1655

shard 08 pytest.log:  ERROR collecting tests/test_promotion_control.py
                       ModuleNotFoundError: No module named 'yaml'
shard 09 pytest.log:  ERROR collecting tests/test_range_scan_states.py
                       ModuleNotFoundError: No module named 'yaml'
```

A pytest collection error **interrupts the whole shard's run**, not just the offending
file — so shards 08 and 09 each collected exactly 1 item (the error) instead of the
~1,500–2,800 every other shard managed. All 10 of the run's `MISSING` entries came back
`DE-COLLECTED` under `tools/ci_inventory.py`'s own attribution (`attribute_missing`,
built E CP29): *"still exists and was neither deleted nor renamed — it stopped being
COLLECTED"* — the exact shape a shard-wide collection abort produces, not a real
behaviour change. The true scope is larger than the 10 attributable MISSING entries:
whatever else lived in shards 08/09 that was NOT in the 122-test baseline is invisible to
the diff tool entirely (neither NEW nor MISSING — just silently un-run).

`requirements.txt` never declared `yaml`/`PyYAML` anywhere (`grep -in yaml
requirements.txt` — zero matches). The main pytest job installs `-r requirements.txt`
only (`.github/workflows/full-suite-report.yml:230,347`); a separate job installs
`pyyaml` alone but runs a narrower suite unrelated to these two files
(`:416`, F-CI-30's equivalence job). `tests/test_promotion_control.py` and
`tests/test_range_scan_states.py` both `import yaml` at module scope (confirmed:
`git log --diff-filter=A` traces them to pre-existing commits `342083b76` /
`97a4af755` — **neither is part of this session's 48 merged units**; the gap is
pre-existing on master, invisible until E CP34 gave master its first CI run at all).

## 2 · The fix

One line: `PyYAML>=6.0` added to `requirements.txt`, next to the other `Py*`-prefixed
entries, with a comment naming the two files that need it.

## 3 · Controls

```
pip install pyyaml; python -c "import yaml"                                   ok, exit 0
python -m pytest tests/test_promotion_control.py tests/test_range_scan_states.py
  --collect-only -q                                                           30 collected, 0 errors
grep -in yaml requirements.txt (before)                                       0 matches
grep -in yaml requirements.txt (after)                                        1 match (the new line)
```

⛔ **Scoped collection only, per this repo's own standing rule** — never the full suite
locally. The real proof is the next master CI run's own shard summaries showing 08/09
collecting their real counts, not 1.

## 4 · Files

```
requirements.txt   +1 line: PyYAML>=6.0
```

## 5 · Validators

```
ast.parse                          N/A (not Python)
pip install -r requirements.txt    OK (no conflicts; PyYAML has no version floor
                                    conflict with any other pinned package)
scoped pytest --collect-only       0 errors on both previously-failing files
```

## 6 · Drafted ledger row — NOT written

| 121 | `afbbd39b5` | 2026-09-18 | CI | 1 | E CP36: master's first-ever full-suite run lost two whole shards silently — a missing `PyYAML` dependency interrupted collection on two test files, and a pytest collection error aborts the ENTIRE shard, not just the offending file. Traced via per-shard collected counts (2 shards read `1` against a ~1,500–2,800 norm) and confirmed against `ci_inventory.py`'s own DE-COLLECTED attribution on every one of the run's 10 MISSING entries. Pre-existing on master since the two test files were added by earlier, unrelated commits — invisible until E CP34 gave master a CI run to be invisible on. Fixed with one line in `requirements.txt`. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A pytest collection error is a SHARD-WIDE outage, not a single-file
  failure.** One missing import zeroed ~1,500–2,800 tests' worth of signal per
  affected shard — the diff tool can only see the slice that happened to also be
  in the baseline; the rest is silently unmeasured, neither NEW nor MISSING.
- ⭐ **`ci_inventory.py`'s DE-COLLECTED attribution (E CP29) did its job on the
  very first real run it was asked to judge** — it correctly distinguished "the
  file left the diff's baseline overlap because a shard aborted" from "the file
  was deleted", which is exactly the ambiguity it was built to resolve.
- ⛔ **A dependency gap can sit on master indefinitely if nothing has ever run
  CI against master.** This is the SAME root shape as F-CI-44/F-CI-45 — an
  instrument that could not measure its target until a prerequisite (E CP34)
  landed — one level down, at the level of a single missing package rather than
  a missing trigger.
