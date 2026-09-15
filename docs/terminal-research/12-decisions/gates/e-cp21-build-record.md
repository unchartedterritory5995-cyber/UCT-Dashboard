---
id: e-cp21-build-record
unit: E CP21
packet: packet-e-ci-gap-gate
merges-after: E CP20
status: UNSIGNED
---

# E CP21 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP21 — 109 of 226 pytest failure entries were one missing install.** Scope is
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of
> `aba219779`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP20**; manifest rows are **CP2, CP4–CP20** (32 rows total).
**CP21 free.**

---

## 1 · ⭐⭐ RUN #18 CLOSED THE INSTRUMENT ARC

E CP20's prediction, every line:

| predicted | actual | |
|---|---|---|
| `shards_success` 12 of 12 | **12/12** | ✅ |
| `shards_unreadable: []` | **`[]`** | ✅ |
| basis contains `runner_verdict_unreadable=0` | **it does** | ✅ |
| counts unchanged at ~24,445 / ~185 | **24,445 / 185** | ✅ |
| VERDICT RED | **RED**, `contract_gaps: []` | ✅ |

```
all_success=True (12/12) · every_shard_has_totals=True · failed=185 · missing=0
· runner_verdict_unreadable=0
```

⭐⭐ **The suite is now RED for exactly one reason — tests fail.** That sentence has not
been true in this repository before: every earlier red carried a measurement defect inside
it. Nine checkpoints (CP12–CP20) were spent getting to a number that means what it says.

## 2 · So I read the failure text the record finally carries — and half of it is not the product

| signature | entries |
|---|---|
| `LaneUnavailable: the JS lane exited 1` | **109** |
| `node:internal/modules/cjs/loader` / `MODULE_NOT_FOUND` | 11 |
| a git ref a shallow single-branch checkout does not have | 1 |
| a `'/data/…'` path that only exists on the dev box | 1 |
| **union — carries a CI-ENVIRONMENT signature** | **119** |
| **remainder — product-shaped, needs triage** | **107** |

*(226 entries against 185 `failed`: junit `<error>` entries — setup failures — are counted
too, and they are failures a reader must see.)*

⚠️ **"Carries a CI-environment signature" is a claim about the TEXT**, not a verdict that
the test would pass elsewhere. Run #19 is what turns it into one.

## 3 · ⛔⛔ THE CAUSE — AND THE TESTS ARE RIGHT, THE ENVIRONMENT WAS WRONG

Several suites drive a **JS lane**: they run `node` against the repo's own sources to check
that the Python and JavaScript implementations agree. Those tests **deliberately refuse to
skip**:

```python
class LaneUnavailable(RuntimeError):
    """The node lane could not run. NOT a skip: a lane that cannot run has not
    agreed with anything, and three of this file's claims are only checkable
    there."""
```

⭐⭐ **That is exactly right, and it is the same principle this programme applies to
UNREADABLE everywhere else.** A lane that could not run has not agreed with anything, so it
must not report green. **The consequence is that the ENVIRONMENT has to supply the lane.**

**Read before fixing** (`tests/test_definition_concierge.py:1135`): the drivers import only
`node:` builtins themselves, then `register()` a loader hook and pull in the repo's own
sources — which import from `node_modules`. And the pytest shard job had **no
`actions/setup-node` at all**: it installed `requirements.txt` and nothing else, so
`app/node_modules` did not exist and the hook died in `MODULE_NOT_FOUND`.

⛔ **Every one of those 109 tests failed for a reason that says nothing about the code** —
and they have done so in every CI run since T2 CP1 made the backend suite run at all.

## 4 · The fix

`actions/setup-node@v4` (node 20, `cache: npm`, keyed on `app/package-lock.json` — the same
cache the vitest job already warms) plus `npm ci` in `app/`, **before** the pytest step.

⛔ **Installed for EVERY shard, not a hand-kept list of "the shards that need node."** That
list is the enumeration-beside-its-source defect waiting to happen: a test that grows a JS
lane tomorrow would fail in whichever shard it landed in, for a reason nobody would look for.

## 5 · ⚠️ WATCH ITEM, stated rather than discovered later

This adds an `npm ci` to each of twelve shards. The two longest were **888 s** and **945 s**
against a **1200 s** cap. The npm cache is warm from the vitest job, so the expected cost is
tens of seconds — but ⛔ **if a shard approaches the cap it is SPLIT, never extended**, which
is E CP6's rule and does not bend for this.

## 6 · Files

```
.github/workflows/full-suite-report.yml   (setup-node + npm ci in the pytest shard job)
```

## 7 · Validators

```
yaml.safe_load             -> OK, node installed BEFORE the Run step
check_workflow_expressions -> exit 0, 22 expressions
check_repo_hygiene         -> clean, 9,557 tracked files
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 8 · ⚠️ PREDICTION for run #19

| field | prediction |
|---|---|
| `LaneUnavailable` entries in `pytest_failures.txt` | **0** — or a handful with a *different* message, which would mean node_modules was not the whole story |
| pytest `failed` | **substantially below 185** — the arithmetic says ~185 − 109 ≈ 76, but some lane tests may now run and genuinely fail, so I predict **60–120** rather than a point value |
| `collected` | **≥ 24,445** — nothing is removed, and tests that previously errored at setup now run |
| `shards_without_totals` / `shards_unreadable` | **`[]`** both |
| VERDICT | **RED** |
| longest shard | **under 1000 s** — the watch item |

⭐ **A falling failure count here is the OPPOSITE of the last two runs' rises, and both are
the same thing: the measurement getting closer to the truth.** ⚠️ What would falsify the
diagnosis: `LaneUnavailable` still present at similar volume — which would mean node_modules
was not what the lane lacked, and the message would say what is.

## 9 · Drafted ledger row — NOT written

| 99 | `aba219779` | 2026-09-15 | CI | 1 | E CP21: run #18 closed the instrument arc (12/12 shards, 0 unreadable, 0 without totals — RED for exactly one reason). Reading the failure text it finally carries: 119 of 226 pytest entries carry a CI-ENVIRONMENT signature, 109 of them `LaneUnavailable: the JS lane exited 1`. Those suites run node against the repo's own sources and deliberately refuse to skip; the shard job installed requirements.txt and nothing else, so app/node_modules did not exist. setup-node + npm ci added to every shard. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A test that refuses to skip is telling you to fix the environment**, not to mute it.
  `LaneUnavailable` is the same principle as UNREADABLE, one layer down.
- ⛔ **Read the failure text before counting it.** 185 failures sounded like 185 problems; at
  least 119 of the 226 entries were one missing install step.
- ⛔ Install the dependency for EVERY shard — a list of "the ones that need it" is an
  enumeration beside its source.
