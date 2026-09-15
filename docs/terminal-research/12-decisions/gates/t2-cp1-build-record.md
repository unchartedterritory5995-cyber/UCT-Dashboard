---
id: t2-cp1-build-record
unit: T2 CP1
packet: (none — see §0)
merges-after: E CP4
status: UNSIGNED
---

# T2 CP1 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **T2 CP1 — the CI pytest job installs the requirements file.** Scope is the single
> `pip install` line in `.github/workflows/full-suite-report.yml` **as enumerated by
> `git show --stat` of `4ad1108d1`.**

## 0 · ⚠️ THIS UNIT HAS NO PARENT PACKET, AND THAT IS WORTH A RULING

⛔ **Collision proof:** no `T2` packet, file, or checkpoint id exists anywhere in `gates/`
(`packet-t-stale-test-gate.md` uses `T-CP1`). **`T2 CP1` is free**, and it was the id the
commissioning text named.

But every other build record in this programme cites a **parent packet** whose gate line
authorises it, and this one cannot: there is no T2 packet. ⭐ **Its natural home is
packet E** — this is a CI-workflow fix, E is *"the CI gap"*, and it was found by E CP4's
own instrument. It is recorded under the commissioned id rather than silently re-homed,
because renaming a unit the owner named is not a decision to take quietly.
**OPEN QUESTION: adopt this as `E CP5`, or write a T2 packet?**

---

## 1 · The defect, and it is one line

```yaml
run: python -m pip install --quiet pytest pytest-asyncio httpx numpy pillow
```

Five packages, against a backend whose tests import `api.**`.

⛔⛔ **THE BACKEND SUITE WAS NOT RED. IT NEVER RAN.** pytest reported
`2 skipped, 8 warnings, 479 errors in 82.68s` against **`collected 2`** — of **481** test
modules, **479 never imported**.

⭐ **The only thing that stopped this publishing as a pass is `ci_summarize`'s rule that
zero collected is never `ok`.** A suite reporting `0 failed` because it collected nothing
is the most flattering possible lie, and it was one guard away from being told.

## 2 · Derived, not guessed — the bucket table from `ci-results`

Run #3, diagnosed with **no local full run**. All 479 errors, 18 buckets, **every one a
`ModuleNotFoundError`**:

```
274 fastapi     63 requests    41 bcrypt      23 cryptography
 20 pydantic    20 yfinance    10 matplotlib   9 pandas
  7 orjson       3 openai       2 uvicorn      1 x7: starlette, snaptrade_client,
                                                  apscheduler, botocore, nacl,
                                                  stripe, pyotp
```

**274+63+41+23+20+20+10+9+7+3+2+7 = 479.** ⭐ The arithmetic closes exactly against the
totals line, which is what makes this a measurement rather than a sample.

## 3 · Told-vs-found

| told | found |
|---|---|
| the job needs five packages | `requirements.txt` exists at the repo root, **83 lines**, and declares every top bucket — `fastapi==0.115.6`, `requests==2.32.5`, `bcrypt`, `cryptography`, `pydantic==2.12.5`, `yfinance==1.2.0`, `pandas==3.0.1` |
| the five are test-only extras | **all five are already IN `requirements.txt`** — `pytest==8.3.4`, `pytest-asyncio==0.24.0`, `httpx==0.28.1`, `numpy`, `Pillow` |

⭐ So `-r requirements.txt` is a **strict superset** and the hand-typed list loses nothing.
⛔ **It was a derived list typed by hand — this programme's oldest defect in its smallest
possible form**, and it cost 479 of 481 test modules.

## 4 · The fix

```yaml
run: python -m pip install --quiet -r requirements.txt
```

**One root cause · one file · one line · one commit** — the condition the session's scope
set for fixing rather than filing (a single cause covering ≥100 errors, confined to one
file).

⚠️ **The expected outcome is stated BEFORE the next run, so it can be wrong.** pytest
should collect on the order of the full module count rather than 2, and the error count
should fall from 479 toward 0. **A genuine test failure count is the goal, not zero** —
this unit makes the suite *run*; it does not claim to make it *pass*, and a red that is
genuinely red is the first honest measurement of the backend this programme will have.

## 5 · ⛔ NOT FIXED HERE — F-CI-4, a different root cause in the same file

Five vitest files (**13 of 23** junit failures) fail because `actions/checkout` is
**shallow**, so `git merge-base origin/master HEAD` and `git show <sha>:<path>` cannot
resolve:

```
rule12Paths.test.js          4   "RULE 12 RAIL CANNOT RUN — no base ref resolved"
surfaceMatrixIsCurrent.test.js 4 "git show febe8ee67:… fatal: invalid object name"
readout.test.js              3   "could not read d2733adc:…StockChart.jsx via git"
enumerationSites.test.js     1   "git could not read StockChart.jsx at 084eeded"
legendFromDefinitions.test.jsx 1 same d2733adc read
```

⭐ **`rule12Paths` REFUSED rather than passing vacuously** — *"the forbidden-path check
would pass vacuously"* — which is the rail working exactly as designed, and is the single
most reassuring line in the whole run.

The fix is `fetch-depth: 0` on the checkout — same file, one line. **It is a different root
cause and the scope authorised one.** Filed, not built.

## 6 · Drafted ledger row — NOT written

| 82 | `4ad1108d1` | 2026-09-15 | CI | 1 | T2 CP1: the CI pytest job installed five packages instead of `requirements.txt`, so 479 of 481 test modules never collected and the backend suite never ran. All 479 errors bucketed to `ModuleNotFoundError`; top bucket `fastapi` at 274. One line. |

## 7 · Drafted RESUME delta — NOT applied

- The backend suite now **runs** in CI. Whatever it reports next is the first real
  measurement of it; expect a genuine red, not a green.
- **F-CI-4** (shallow checkout) is open, one line, same file.
- ⚠️ This unit has **no parent packet** — adopt as `E CP5` or write a T2 packet.
