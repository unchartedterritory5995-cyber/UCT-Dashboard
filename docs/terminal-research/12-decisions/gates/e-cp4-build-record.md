---
id: e-cp4-build-record
unit: E CP4
packet: packet-e-ci-gap-gate
merges-after: E CP2
status: UNSIGNED
---

# E CP4 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP4 — the error TEXT, bucketed, published beside the counts.** Scope is
> `.github/workflows/full-suite-report.yml` and `tools/ci_extract.py` **as enumerated by
> `git show --stat` of `b70a874ed`.**

⛔ **Collision proof.** Packet E's table declares `CP1`, `CP2`, `CP3`. **CP4 free.**

---

## 1 · Why

CP2 made a result readable. It published that pytest saw **479 errors** and vitest **21
failures** — and neither number says why. ⛔ **A count nobody can act on decays into a
status badge.** Worse: 479 errors against **2 collected** means the backend suite *never
ran*, and only the text distinguishes a collection failure from a test failure.

## 2 · What it publishes

Per run, onto `ci-results` under `results/<run_id>/`:

| artifact | what |
|---|---|
| `pytest_error_buckets.txt` | `bucket \| count \| example node id`, keyed on the **final** exception line, paths normalised |
| `pytest_collect_errors.txt` | every `ERROR collecting` section, first 40 lines, by node id |
| `vitest_failures.txt` | file · test name · first assertion line |
| `pytest-junit.xml` · `vitest-junit.xml` | the structured reports |

`latest.json` gains a `detail` block of pointers **relative to the branch root**, so a
reader needs no knowledge of this workflow.

⭐ **The bucket key is the LAST exception line, not the first.** An `ImportError` raised
while handling another error reports the **proximate** cause last, and that is what a fix
targets.

⛔ **ZERO is written down, never left blank.** A missing file and a clean run are the same
observation to whoever reads the branch next.

## 3 · Controls

**12 fixtures pass** (`python tools/ci_extract.py --self-check`), plus **three real scoped
runs**, because a fixture proves the parser and a real run proves the wiring:

- a deliberate `ImportError` in a throwaway dir **outside the repo** (so the repo-root
  conftest tripwire is not involved) → non-empty `collect_errors`, correctly bucketed;
- the known-red `reachable.test.js` with `--reporter=junit` → **exactly one** entry with
  file, name, first assertion line;
- an empty run → the files exist and say **ZERO**.

⚰️ **The scoped control found a defect in the tool, which review had not.** `_write`
returns a **line** count and it was being reported as a **section** count — printing
*"27 sections"* for a single collection error. **A summary line that contradicts the
artifact beside it is precisely the class this tool exists to expose.** Fixed; it reads 1.

## 4 · ⭐ It proved its own necessity on the first run

Run #3 (`b70a874ed`) published `detail: true` and the bucket table resolved **479 errors
into 18 buckets, every one a `ModuleNotFoundError`**, top bucket `fastapi` at **274**. That
turned *"the backend is red"* into *"one workflow line installs five packages"* — **T2
CP1** — in a single read, with no local full run.

⛔ **And the access question is now settled in both directions.** Run **metadata** answers
anonymously; the **log** endpoint returns **HTTP 403** unauthenticated even on a public
repo. So F-CI-2's retraction stands (the previous UNREADABLE verdict on run *status* was
wrong) **and** publishing into `ci-results` is genuinely the only no-account path to the
error **text**. CP2 and CP4 are justified on durability *and* on access — not on the claim
that evaporated.

## 5 · Files

```
.github/workflows/full-suite-report.yml   (junit reporters, artifact uploads, extract step, detail block)
tools/ci_extract.py                       (new)
```

Top-level `permissions: contents: read` unchanged; only `publish` raises `contents: write`.
The orphan checkout wipes the tree, so the extract directory is copied to `/tmp` first and
back after — stated because it is the kind of step that silently publishes nothing.

## 6 · Drafted ledger row — NOT written

| 81 | `b70a874ed` | 2026-09-15 | CI | 1 | E CP4: per-run error text on `ci-results` — bucketed pytest collection errors, per-test vitest failures, both junit reports, pointers in `latest.json`. First run resolved 479 errors into 18 ModuleNotFoundError buckets and produced T2 CP1. |

## 7 · Drafted RESUME delta — NOT applied

- CI is diagnosable from the repo: `git show origin/ci-results:results/<run>/pytest_error_buckets.txt`.
- ⛔ **Job logs are 403 unauthenticated.** Metadata is anonymous; text is not.
- **F-CI-3** (`oom_or_timeout` matches the word, not the event) is still open and still
  unrepaired on purpose.
