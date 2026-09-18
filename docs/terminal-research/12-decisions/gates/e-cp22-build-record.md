---
id: e-cp22-build-record
unit: E CP22
packet: packet-e-ci-gap-gate
merges-after: E CP21
status: UNSIGNED
---

# E CP22 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  ac382d2b2
SCOPE APPROVED:   CP22 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP22 — the inventory is DERIVED, and the axis that matters is not the count.** Scope is
> `tools/ci_inventory.py` **as enumerated by `git show --stat` of `03ebbd7f7`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP21**; manifest rows are **CP2, CP4–CP21** (33 rows total).
**CP22 free.**

---

## 1 · The workflow header asks for this, and asks for it the wrong way

> *"**The first CI run is therefore the first complete measurement this repository has ever
> had**, and its output is the inventory. Copy it into this header, with a finding id per
> row, before anyone argues about promotion."*

⛔ **"Copy it into this header" is the defect this repository records over and over** — the
writer-index `FOUR`, the COT router's *"4 routes"* beside five, the setup catalog's *"24"*
beside twenty-six. A hand-typed table next to the artifact it describes goes stale in
whichever one moves first, and here the artifact moves **every run**.

⭐ So the inventory is **derived by a tool**, and the header will point at the tool.

## 2 · ⭐⭐ AND THE AXIS THAT MATTERS IS NOT THE COUNT

Against run #18's published record:

```
249 entries — 123 environment-shaped, 126 product-shaped
```

⛔ **"206 failures" is a true number and a misleading one.** *"126 product-shaped, 123
environment-shaped"* is the sentence somebody can act on — and it is the difference between
a repository that looks broken and one with a CI job missing an install step.

| n | kind | bucket |
|---|---|---|
| 48 | **ENV** | `AdmissionRefused: u_<id>: the lanes could not be compared (LaneUnavailable…` |
| 18 | **ENV** | `ast_conformance.LaneUnavailable: the JS lane exited 1:` |
| 15 | **ENV** | `failed on setup with "…LaneUnavailable: the JS lane exited 1:` |
| 13 | PRODUCT | `failed on setup with "AssertionError: could not read the base blob…` |
| 8 | **ENV** | `census failed: node:internal/modules/cjs/loader:<n>` |
| 8 | PRODUCT | `KeyError: 'text_origin'` |
| 8 | PRODUCT | `TypeError: 'NoneType' object is not subscriptable` |

## 3 · ⚠️ WHAT THIS TOOL CLAIMS, EXACTLY

**`ENV` means the bucket's TEXT names a condition of the CI environment.** It is **never** a
verdict that the test would pass elsewhere — only a run with that condition removed can say
so, which is precisely what E CP21 and run #19 are for.

⭐ **Every ENV row carries the MATCHED SIGNATURE**, so a reader can check the call instead of
trusting it. A label without its evidence is an instrument asking to be believed.

⛔ **UNMATCHED IS `PRODUCT`, ALWAYS.** The classifier fails toward *"a human must look at
this"*, never toward *"probably just the environment"*. **A misfiled ENV row is a real
failure nobody triages; a misfiled PRODUCT row costs somebody five minutes.** The asymmetry
is the whole design.

## 4 · ⚰️ ITS FIRST RUN AGAINST THE REAL RECORD OVER-COUNTED

**272 entries where the files held 249.**

`ci_extract` writes **two shapes**: pytest as one line, `file | test | message`; vitest as
**two**, `file :: test` followed by an indented message. A per-line parser counted every
vitest failure **twice** and filed its message in a bucket of its own with `where` unknown.

⭐ **Caught by running it against the published record rather than the fixture it was written
from.** A fixture written by the same hand reproduces the same assumption — the fixture had
the vitest entry on one line because that is how I imagined it.

**The cross-check now closes exactly:**

```
226 pytest lines + 23 vitest ` :: ` headers = 249 entries
```

## 5 · Controls

```
every entry is counted                                     -> 6      ok
ENV and PRODUCT partition the entries                      -> 6      ok
the two AdmissionRefused lines collapse to ONE bucket      -> 2      ok
...because the user id is normalised away                  -> True   ok
the JS-lane bucket is ENV                                  -> ENV    ok
...and NAMES the signature it matched                      -> …      ok
a TypeError is PRODUCT, not ENV                            -> True   ok
a KeyError is PRODUCT, not ENV                             -> True   ok
...and PRODUCT rows carry NO signature                     -> True   ok
both classes occur in the fixture (non-vacuity)            -> (T, T) ok
no entries at all is UNREADABLE, not clean                 -> UNREADABLE ok
UNREADABLE and READ are distinguishable                    -> READ   ok
a two-line vitest failure counts ONCE                      -> 1      ok
...and its `where` is the TEST, not unknown                -> True   ok
both file shapes are parsed                                -> (6, T) ok
```

⛔ The **false-positive** controls are the load-bearing ones, and the **non-vacuity** line is
what keeps them honest: *"no product failure is misfiled as ENV"* is satisfied perfectly by a
classifier that calls **everything** PRODUCT.

⛔ And **ZERO entries is `UNREADABLE`, never "nothing is broken"** — the same refusal
`ci_latest` makes about ZERO-RECORDS, and the reason the tool also ignores a file whose
content is the literal word `ZERO`.

## 6 · Files

```
tools/ci_inventory.py   (new — buckets, ENV/PRODUCT with evidence, 15 controls)
```

## 7 · Validators

```
ci_inventory --self-check -> exit 0
run against the REAL record, count cross-checked against the raw files -> 249 = 226 + 23
check_repo_hygiene        -> clean, 9,557 tracked files
```

## 8 · ⚠️ PREDICTION — this unit makes no claim about a run

⛔ **CP22 is an instrument and must not be scored as a repair.** It changes nothing about
what CI does. Its only prediction is about itself:

| field | prediction |
|---|---|
| run #19's inventory `entries` | **fewer than 249**, because E CP21 removes the condition behind the largest ENV buckets |
| its `environment-shaped` count | **far below 123** — ideally near the 4 non-JS-lane signatures |
| its `product-shaped` count | **roughly unchanged at ~126**, possibly higher as lane tests that now RUN report real failures |

⭐ **If `product-shaped` rises while `entries` falls, that is the measurement working**: the
same tests, finally able to say something about the code.

## 9 · Drafted ledger row — NOT written

| 100 | `03ebbd7f7` | 2026-09-15 | CI | 1 | E CP22: the workflow header asks for the failure inventory to be "copied into this header", which is the hand-typed-table-beside-its-source defect; it is derived instead. Against run #18's record: 249 entries, 123 environment-shaped, 126 product-shaped — and the split, not the total, is the actionable sentence. ENV is a claim about the TEXT and carries its matched signature; unmatched is always PRODUCT. Its own first run over-counted (272 vs 249) by parsing vitest's two-line entries per line. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔ **A count without its axis is a misleading true number.** 206 failures, of which half
  were one missing `npm ci`.
- ⛔ **Run a new instrument against the REAL artifact before believing it.** Its fixture was
  written by the same hand that wrote the parser, and reproduced the same assumption.
- ⛔ A classifier's failure direction is a design decision: unmatched must mean *look at
  this*, never *probably nothing*.
