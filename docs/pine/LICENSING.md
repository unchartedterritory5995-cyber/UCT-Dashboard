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

## 2c. Licence-held VERDICTS still count: the evidence ledger (2026-11-13)

The gate keeps a licence-held script's CAPTURE out of git: no licence line, GPL or another
non-permitted licence, or a builtin. It does not throw away the VERDICT. Such a capture is
`LEDGER_ONLY`, and its verdict is filed in `docs/pine/vendor-harness/evidence-ledger.jsonl`. One
authority owns the row and its freshness rule: `tools/vendor_harness/evidence_ledger.py`.

A row carries:
- the source sha256, never the source text;
- the script key and title, symbol and timeframe;
- the capture receipt and file sha256;
- the verdict in both lanes (production, runtime-on);
- `SCRIPT_ENGINE_VERSION` and the grader version at grade time, and the date.

A row never carries source text, provenance or an account. `row_problems` refuses a row that does.

**It counts only while fresh.** The coverage map (PROVEN-exact) and capability admission read a
row only when it was graded at today's engine (or a newer regrade supersedes it) and its source
sha256 is the sample's. Otherwise:
- a stale row is `unproven (stale)`;
- a sha mismatch is not counted;
- a DIVERGE stays a DIVERGE.

**Procedure:**
- A new capture: `evidence_engine.py packet`, then `promote --packet-sha`. A held capture's verdict
  is filed; the capture stays in the run directory.
- After every `SCRIPT_ENGINE_VERSION` bump: `python tools/vendor_harness/evidence_engine.py regrade`
  re-grades the out-of-git capture store in both lanes, under the heavy lock, and appends fresh
  rows. The store is `$UCT_VENDOR_CAPTURE_STORE`, default
  `%LOCALAPPDATA%/uct-vendor-batch/runs/*/captures`.
- Every run directory in the store is read, so a new capture session needs no configuration.
  `--exclude-run <dir>` leaves out a session that is still capturing.
- Legacy v1 rows (written by the old promote, with no engine version) are never evidence. `regrade`
  retires each one once a v2 row files the same capture; the file is otherwise append-only.
- Commit the ledger diff. Never commit a held capture.

## 2d. The second door: source embedded in a fixture (2026-11-15)

The corpus rail walks `corpus/`. A third-party script also reaches git **inside a fixture**: the
`source.text` of a vendor capture, or a `.pine` copied next to a tool. Two did:

- `tests/fixtures/vendor/harness/supertrend-kivancozbilgic-rddt-1d-2026-10-02.json` (`cce0701fe`)
  carried the full source of a script with **no licence line**. It was admitted because its sha256
  matched a `tests/fixtures/pine_oos` record, and that record says `storage: "local-only"`.
- 22 `.pine` files in `tools/c0_oos_fixtures`, `tools/c0_parity_fixtures` and
  `tools/c3a_parity_fixtures` (`e855f62cd`) were byte copies of 13 local-only OOS members (no licence
  line, or CC BY-NC-SA), committed in the same change that gitignored them under `pine_oos`.

All 23 were removed on 2026-11-15. **Git history still contains those commits**: nothing was
rewritten, and a force-push is not an option. What left, by path and hash only, is
`docs/pine/vendor-harness/licence-held.json`. The bytes are in the local capture store
(`$UCT_VENDOR_CAPTURE_STORE`, default `%LOCALAPPDATA%/uct-vendor-batch/runs`, under
`licence-moved-2026-11-15/`), where `regrade` grades the capture and files its ledger row. A rail that
read one of them now runs when the file is on the machine (checked against its recorded hash) and
skips **by name, with the ledger verdict** when it is not: `licenceHeld.js` (JS) and
`tools/vendor_harness/licence_held.py` (Python).

**The guard** is `tests/test_corpus_licence_rail.py::TestEmbeddedSources`, over
`tools/pine_survey/fixture_licence.py`. It reads every committed vendor capture (anywhere), every file
under `tests/fixtures/vendor/`, and every `.pine` under `tools/`, and fails by file and JSON path on any
embedded source that is not a committed probe, a `UCTPROBE_` probe, a `corpus/committed/` file, an
explicit permitted header, or a source written here and listed **by hash** in `IN_HOUSE`.

**A translation is a derivative too.** `tests/fixtures/graph_wire/u_c2d900000005.json` held no Pine
text: it was the save door's translated document of the CC BY-NC-SA `coppock-curve-multi-filter`
member. It left the tree on 2026-11-15 the same way (registry kind `derived`, gitignored so the
emitter's local re-write can never be committed). `TestDerivedDocuments` flags any committed
definition document (`compute` + `meta.name`) named after a held script: a local-only or unpublished
`pine_oos` member, or a `corpus/reference/` script whose verdict is not `commit`.

**Quoting is copying.** A comment or test does not reproduce a recognisable line of a held script; it
describes the shape in our own words. Shared Pine idioms and lines of MPL-licensed derivatives are
not quotes of the held script.

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
beyond keeping non-permitted scripts out of what we commit. The rails are scoped to `corpus/`
(§1) and to the fixtures §2d names; that is the whole of it.
