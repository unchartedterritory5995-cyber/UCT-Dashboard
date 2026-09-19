# Licensing policy — Pine corpus and prior art

Owner ruling, 2026-09-09. This page is the policy; the **enforcement** is
`tests/test_corpus_licence_rail.py`, and the **predicate** it and the ingest both use is
`tools/pine_survey/corpus_licence.py`. If the two ever disagree, the code is right and
this page is stale — change the predicate once, in that module.

---

## 1. Which scripts may be committed

**Commit-eligible: an explicit `MPL-2.0`, `MIT` or `Apache-2.0` licence header in the
script's own source.** Nothing else.

Everything else is **reference-only**:

| Case | Verdict |
|---|---|
| Explicit MPL-2.0 / MIT / Apache-2.0 header | **commit** |
| No licence line at all | reference-only |
| GPL, AGPL, LGPL | reference-only |
| Any CC variant (BY, BY-SA, BY-NC, BY-NC-SA, BY-NC-ND) | reference-only |

**"No licence line" is not permissive.** TradingView's Terms §22 make a published
open-source script MPL-2.0 by default, and an earlier corpus leaned on that to commit 19
files. This ruling deliberately does not: *a default we infer is not a grant the author
wrote*, and the file in git would carry no evidence of one. It costs us nothing — the
survey never needed the source in git, only on disk at test time.

## 2. How reference-only scripts exist

As **metadata**, under `corpus/reference/`: URL, author, licence, Pine version, category,
feature inventory, and `our_status`. That is enough to measure against.

The **source** is fetched into `tools/pine_survey/cache/` at test time. That path is
gitignored and holds ~4,900 fetched scripts plus chart snapshots (~237 MB). It is
re-creatable at any time with `python tools/pine_survey/tvfetch.py fetch`.

> ⚠️ The cache lives inside a git worktree. `git clean -xdf` or removing the worktree
> deletes it. It is a cache, not an archive — nothing depends on it surviving, and
> anything that would is a bug.

## 2b. ⭐ The worked example of why the gate does not widen

**One script is excluded on a typo, and it stays excluded.**

`Fourier Extrapolator of Price w/ Projection Forecast [Loxx]` declares, on line 1:

```
// This source code is subject to the terms of the Mozilla Public License 2. at https://mozilla.org/MPL/2./
```

The trailing zero is missing in **both** places. There is no "Mozilla Public License 2" —
only 1.0, 1.1 and 2.0 — so the author's intent is not really in doubt.

⚠️ **It was checked for fetch damage before any judgement was made.** All 4,898 cached
sources are valid UTF-8; **1,936** spell it "2.0"; **exactly one** has the truncated form.
So this is the author's own typo, faithfully fetched, and not something our pipeline did.

⛔ **It is still reference-only, and that is the point of having a rule.** The ruling requires
an EXPLICIT permitted header. Widening a licence predicate to absorb a typo is the one
direction a licence gate must never loosen: the next widening is always as reasonable as this
one, and the gate ends up matching intent rather than text. The cost of holding the line is a
single script out of 266 — it lives in `corpus/reference/` with its source in the cache, which
is everything the survey needs.

## 3. Legacy fixtures are exempt

`tests/fixtures/pine`, `pine_community`, `pine_blind` and `pine_screener` predate this
ruling and are **out of scope for the rail**, which is rooted at `corpus/` and cannot
reach them. This is deliberate and load-bearing: 126 of those 137 files would fail the
gate, and they are the screener regression suite. A rail widened to cover them would
delete the regression net. (The one file that genuinely could not stay — a CC BY-NC-ND
Ichimoku — was removed and replaced clean-room in `ac34ab36a`.)

## 4. Prior art we may read, and what we may not

Runtime and parser prior art was surveyed in `docs/pine/prior-art.md` (34 projects).

**May read, learn from, and — licence permitting — vendor with attribution:**
PyneCore (Apache-2.0) · pineforge-engine (Apache-2.0) · pine-transpiler (MIT) ·
lightweight-charts and its plugin examples (Apache-2.0).

**⛔ Must NOT be read, vendored, or linked:** every AGPL project — PineTS, piner, pyne,
pinescription, vela-pinets. AGPL's network-service clause is incompatible with shipping
this as a hosted product, and "we only looked at it" is not a defence anyone wants to
mount. The commercial licence for the leading AGPL option ($1,199/dev/yr) was **declined**.

**Every borrowed semantic is still vendor-measured before it is trusted.** A permissive
licence tells you what you may copy; it tells you nothing about whether the behaviour
matches TradingView.

Anything vendored is attributed in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)
at the repo root.

## 5. The Pine Script® mark

**Pine Script® is TradingView's trademark.** Product copy uses it descriptively only —
"supports Pine Script® indicators". Nothing we ship is *named* Pine, and no product name,
component name, or marketing line implies endorsement by or affiliation with TradingView.

## 6. What this policy is not

It is not a general licence-compliance programme, and there is no further licence work
beyond keeping non-permitted scripts out of the committed corpus. The rail is scoped to
`corpus/committed/`; that is the whole of it.
