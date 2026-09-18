---
id: e-cp29-build-record
unit: E CP29
packet: packet-e-ci-gap-gate
merges-after: E CP28
status: UNSIGNED
---

# E CP29 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  1d216521b
SCOPE APPROVED:   CP29 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP29 — a test that leaves coverage is a verdict, and a repaired suite is not one.**
> Scope is `tools/ci_inventory.py` and `.github/workflows/full-suite-report.yml` **as
> enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk top out at **e-cp28**; manifest rows top out at **CP28**. **CP29 free.**

---

## 1 · ⚰️⚰️ F-CI-41 WAS NOT COVERAGE LOSS — IT WAS A REPAIR REPORTED AS ONE

`legendFromDefinitions.test.jsx` came back **MISSING** on runs #28 and #29, consistently.
The investigation says it is nothing of the kind:

```
the file exists on disk
git log --diff-filter=DR <baseline>..<current> -- <file>   -> 0 deletions or renames
run #29's vitest junit                                     -> 62 testcases from that file
run #27's failure entry                                    -> "<file> :: <file>"
```

⭐ **The last line is the whole thing.** When vitest cannot LOAD a file it reports a
**file-level** failure, and `ci_extract` writes it as `<file> :: <file>` — so `entry_key`
yields `(vitest, <path>, <path>)`, a **synthetic key that can never appear in `ran_keys`**,
which holds real test names. The moment the load failure was fixed by `fetch-depth: 0`, the
baseline key was in neither the failing set nor the ran set, and the diff called it MISSING.

⛔ **MISSING means coverage left. This was the exact opposite** — the file loads again and
62 of its tests ran — and because MISSING is never counted as FIXED, the repair was
permanently invisible and would have turned every future run red under the new rule.

**Resolved by shape, not by a list:** a key whose classname equals its name and looks like a
path is a file-level entry; if that path appears as a **classname** among the run's
testcases, the suite loads and the entry is **FIXED**. Re-run against the real record:

```
before:  NEW 1 · FIXED 28 · MISSING 1
after :  NEW 2 · FIXED 29 · MISSING 0 · file_level_resolved 1
```

*(NEW moved 1→2 only because this diff was recomputed without the flaky set; the flaky
exclusion is unchanged.)*

## 2 · COVERAGE_LOST — and what reconciles

Every remaining MISSING entry is **attributed**, derived from the two commits the record
itself names:

```
git log --diff-filter=DR --name-status <baseline sha>..<current sha> -- <file>
```

| bucket | meaning | reconciles? |
|---|---|---|
| `DELETED` | a deletion named in the diff | **yes** — somebody's recorded decision |
| `RENAMED` | a rename named in the diff | **yes** |
| `DE-COLLECTED` | the file still exists and was neither | **no** |
| `UNATTRIBUTED` | no file, no SHAs, or git could not read the range | **no** |

⛔ **UNATTRIBUTED covers the shallow-clone case deliberately**: a range git cannot read is
not "nothing happened". ⭐ And the difference the bucket makes is the whole point — *"MISSING
1"* tells nobody whether a test was deleted on purpose or quietly stopped running, and only
the second is a verdict.

**Verdict precedence, worst first:**

```
INVALID > DID_NOT_RECONCILE > COVERAGE_LOST > NEW_FAILURES > NO_NEW_FAILURES
```

A run that cannot be read is not a run; a run whose arithmetic does not close cannot be
trusted to say anything; **a run that lost coverage is worse than one with a named new
failure, because nobody was told what stopped running.**

## 3 · Controls (17 new rows)

```
a file-level key is recognised by its shape                      ok
  ...a test-level key in the same file is NOT                    ok
  ...nor is a pytest dotted key                                  ok
a fixed suite-load failure resolves to FIXED, not MISSING        ok
  ...MISSING stays 0, file_level_resolved 1, verdict clean       ok
  ...but a file that did NOT run is still MISSING                ok   <- non-vacuity
  ...and THAT is COVERAGE_LOST                                   ok
a live file with no deletion in the diff  -> DE-COLLECTED        ok
an entry naming no file                   -> UNATTRIBUTED        ok
no SHAs in the record                     -> UNATTRIBUTED        ok
an unreadable range (shallow)             -> UNATTRIBUTED        ok
precedence: INVALID beats COVERAGE_LOST                          ok
precedence: COVERAGE_LOST beats NEW_FAILURES                     ok
VERDICTS is declared worst-first, NO_NEW_FAILURES last           ok
```

⛔ **The load-bearing control is "a file that did NOT run is still MISSING."** Without it,
"file-level entries resolve to FIXED" is satisfied by a rule that forgives every missing
test in the suite.

## 4 · Files

```
tools/ci_inventory.py    is_file_level_key · attribute_missing · the COVERAGE_LOST verdict
                         and its precedence · the new artifact fields
.github/workflows/…yml   the gate prints each MISSING entry WITH its bucket and reason
```

## 5 · Validators

```
ci_inventory --self-check   PASS, exit 0 (17 new rows)
yaml.safe_load              OK
check_workflow_expressions  exit 0
check_repo_hygiene          clean
real record re-run          MISSING 1 -> 0, FIXED 28 -> 29, file_level_resolved 1
```

## 6 · ⚠️ PREDICTION for the next run

| field | prediction |
|---|---|
| MISSING | **0** |
| `file_level_resolved` | **1** (`legendFromDefinitions`) |
| verdict | **not COVERAGE_LOST** |
| the gate's summary | names each MISSING entry with its bucket, or prints none |

## 7 · Drafted ledger row — NOT written

| 109 | *(this unit's commit — named in the session report)* | 2026-09-15 | CI | 1 | E CP29: `legendFromDefinitions` was not coverage loss — a vitest FILE-level failure is written `<file> :: <file>`, a key that can never appear in `ran`, so repairing the load failure made the baseline entry read MISSING forever while 62 of its testcases ran. Resolved by shape. Every remaining MISSING is now attributed by `git log --diff-filter=DR` between the two SHAs the record names: DELETED and RENAMED reconcile, DE-COLLECTED and UNATTRIBUTED are `COVERAGE_LOST`, which sits above NEW_FAILURES in precedence because nobody was told what stopped running. |

## 8 · Drafted RESUME delta — NOT applied

- ⛔ **A synthetic key can never satisfy a membership test built for real ones.** When two
  identifier shapes share a set, say which shape you are holding.
- ⛔ **"MISSING 1" is not a finding, it is a prompt.** Attribute it, or the gate reports a
  repair and a silent de-collection in the same word.
- ⭐ **Precedence is a claim about what is worse.** Write the order down and control it.
