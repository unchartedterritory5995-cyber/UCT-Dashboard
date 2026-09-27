---
id: F-01
title: Anti-Pattern Library — the things a terminal must not do, each with its incident, its cost, and the detector that can catch it
role: >
  The Anti-Pattern Library. MASTER_CHECKLIST item 11, gate item 13. Written 2026-09-25/26.
  Its purpose is that Terminal-Next's design can be checked against a list of known ways to get
  it wrong, and that a future engineer reads "we decided against this, here is why" instead of
  rediscovering it at a member's expense.
wave: 4
group: F
category: product-strategy
inputs: >
  `_merge-master:CLAUDE.md` (5,823 lines, the repo's own record of its own failures — the primary
  evidence base and by a wide margin the richest) · the eleven accepted leaf dossiers plus
  `bloomberg/*` and `desk-tools/*` in `03-competitive-research/` (directory listed, not taken from
  a roster) · C5-03 `06-ux-and-information-architecture/fixed-modular-hybrid.md` · C5-01
  `06-ux-and-information-architecture/workspace-systems-survey.md` §7 · D-05
  `07-technical-architecture/current-performance-and-realtime.md` · C7-01
  `07-technical-architecture/domain-streaming-caching.md` · ARCH-07
  `07-technical-architecture/realtime-performance-architecture.md` (gate item 24, three hours old
  at time of writing) · ARCH-06 `09-security-licensing-cost/security-entitlement-architecture.md`
  (gate item 23) · ARCH-05 `08-ai/ai-architecture.md` (gate item 22) · R-17/R-18/R-19 in
  `00-program-control/RISK_REGISTER.md` · `00-program-control/MASTER_CHECKLIST.md` ·
  `11-risks-and-open-questions/` (empty but for `.gitkeep` — see GAPS).
scope: >
  Read-only. No git command was run (SHA not pinned — no git by instruction), no network request
  made, no test or script executed, no production surface called, no Railway command issued.
  Source in the sibling worktree `C:\Users\Patrick\uct-worktrees\_merge-master` was read only as
  `CLAUDE.md`; no `api/**` or `app/**` file was opened by this document.
confidence: >
  🟢 high that every entry below names a recorded instance in a cited artifact. 🟢 high on the
  mechanism and the "why it survives review" analysis, which is the load-bearing part and is
  reasoned from the artifacts' own accounts of why each defect lasted. 🟡 on the cost figures,
  every one of which is carried from another document's measurement rather than re-measured here.
  🔴 on anything about the running service: nothing was probed.
evidence_ceiling: >
  ⛔ THE CEILING THAT MATTERS: **not one `file:line` in this document was opened by this
  document.** Every code citation is carried from a programme artifact or from CLAUDE.md, each of
  which measured it at a date or a SHA that artifact names. ARCH-05 §1.6 measured seven of nine
  `file:line` citations in a two-day-old spec having moved; this document inherits that decay at
  one further remove. ⭐ Treat every `file:line` here as *the address at which the cited document
  found the thing*, never as a current address — and re-derive before depending on one.
  ⛔ SECOND CEILING, specific to §2.8: **no dossier file was opened by this document.** All fifteen
  were read by a delegated agent, which returned section names, line numbers and verbatim quotes;
  §2.8 is written from that report. Every §2.8 citation is therefore at three removes from the
  vendor (vendor page → dossier → agent → here), and the dossier line numbers are as that agent
  read them on 2026-09-25. No competitor product was used, no trial taken, no screenshot read.
  `11-risks-and-open-questions/` is empty, so nothing was inherited from it.
status: draft
date: 2026-09-26
---

# Anti-Pattern Library (F-01)

## 0. Headline — the three Terminal-Next is most likely to commit

This programme has an unusually good evidence base for this document and **the richest half is not
the competitors**. It is the owner's own repository, which has spent months recording its own
failures in detail severe enough to name the reviewer who missed each one. **Sixty-five entries are
carried below** — fifty-five from the repo and ten from the competitive corpus — each with an
incident, a cost where one was measured, and a detector verdict.

⭐ **A library built from only one of the two halves would have been weaker in a specific way.** The
repo knows almost everything about *instruments, guards and process* and almost nothing about
*commercial and trust* anti-patterns, because it has had 26 production members and no pricing page.
The dossiers are the inverse. Where both halves independently reach the same finding — a hit rate
without its base rate (PROD-C5), two metrics that must never be blended (PROD-C6), collapsing "no
match" into "cannot compute" (PROD-4) — that convergence is the strongest evidence in the document.

**Ranked by my estimate of the probability Terminal-Next commits it, given what its own accepted
design documents already say.** This is a judgement, stated as one.

1. ⛔⛔ **A hand-typed count, roster or `file:line` beside the artifact that owns it** (DOC-1).
   The repo records **at least nine** instances and the programme has already committed it twice
   in its own control documents — `MASTER_CHECKLIST.md` row 3 says so in its own text ("*this line
   previously said 211 … the same defect class this program repeatedly flags elsewhere*"), and row
   20 **is committing it right now**, still asserting "*there are currently zero per-widget error
   boundaries*" nineteen hours after C5-03 §6 corrected that against shipped code
   (`424bf3355`, an ancestor of `origin/production`). Terminal-Next is a **panel registry plus a
   panel contract**, which is to say it is a product made almost entirely of rosters. This one is
   near-certain unless every roster it ships is generated.
2. ⛔⛔ **An instrument pointed at a proxy for the thing it names** (INST-2, INST-3, INST-4).
   Terminal-Next's own accepted architecture already contains three: a warm-ratio gate that scores
   a 104 ms cache hit as "the user waited" (ARCH-07 §2.1), a boot auth auditor that cannot see a
   GET (ARCH-06 §0(2)), and drop counters nobody reads on a schedule (ARCH-07 Q10). The programme
   is about to specify observability (gate item 25) and entitlement (item 23) on top of them.
3. ⛔ **A workspace document that is not a document** (STATE-1, STATE-2, STATE-3). C5-01 §7
   measured **six of seven** workspace failure modes as persistence failures, and C5-03 §5 is a
   provisional lock whose commitment 2 is precisely this. But the same §5 also records that
   `user_preferences` is the store today, that **0 of 17 live boards carry a version field**, and
   that a "layout" is conceptually one thing and **physically eight writes with no transaction**.
   The risk here is not that the programme does not know — it is that commitment 2 is *sequenced*,
   and the bridge (stamp a version in place) is the half that gets shipped alone.

⚠️ **And one this document itself tripped over while being written, which is the cleanest possible
demonstration that DOC-1 is not a solved problem in this programme:** the worktree these
research documents live in carries **its own, older copy of `CLAUDE.md`**, and it disagrees with
`_merge-master`'s on at least eight recorded facts. An agent told to "read CLAUDE.md" from this
working directory gets the stale one. See DOC-5.

---

## 1. How to read this

**Entry shape.** Every entry carries seven fields, in this order, and an entry missing the last
three is not an anti-pattern — it is advice, and belongs in §6.

| field | what it must contain |
|---|---|
| **Pattern** | the thing not to do, in one sentence |
| **Mechanism** | why it is a trap rather than a mistake — what makes it produce a wrong answer |
| **Why it survives review** | ⭐ **the load-bearing field.** Every entry below passed a review. If you cannot say what made a competent reader nod at it, you have not understood it and will re-commit it |
| **Recorded instance** | a dated, cited incident. No incident ⇒ the entry is cut or moved to §6 |
| **Cost when it fired** | what it actually took, measured where a measurement exists |
| **Structural fix** | the change that makes the class impossible, not the instance |
| **Detector** | ⭐ **an anti-pattern is not a rule until something can detect it.** Each entry ends with a named detector, or with an honest "no detector exists" |

⭐ **On "no detector exists".** Roughly a third of these entries end that way and that is the
single most useful output of this document. A named gap is a work item; an unnamed one is a
recurrence. Where a detector exists but is *opt-in*, *unrunnable*, or *structurally blind*, the
entry says so rather than calling it covered — `_merge-master:CLAUDE.md` records three separate
cases of a detector that read as coverage and was not one (the ledger auditor that died on a
cp1252 decode, the SSE dampers that are opt-in, and the boot auth auditor that iterates mutating
methods only).

**Detector tally, counted from the entries below** — this is the document's most actionable output:

| verdict | count | meaning |
|---|---|---|
| ✅ **YES** | **31** | a named rail, generator or check exists in a cited artifact |
| 🟡 **PARTIAL** | **14** | a detector exists for one instance, or is opt-in, unrunnable, or covers half the class |
| ⛔ **NO** | **20** | nothing detects this. **These twenty are the work items** |

⚠️ **A "YES" is a claim that a named rail exists in a cited artifact, never that it currently
passes.** No detector was run by this document.

**Index.** At this length nobody reads front to back. Jump by family:

| § | family | entries | ✅ / 🟡 / ⛔ | the one to read first |
|---|---|---|---|---|
| 2.1 | Documentation and counts | DOC-1…5 | 1 / 2 / 2 | **DOC-1** — nine recorded instances, and the programme is committing it now |
| 2.2 | Instruments and measurement | INST-1…9 | 6 / 3 / 0 | **INST-1** — three hours old, and its misreading pointed at a data leak |
| 2.3 | Guards and gates | GATE-1…8 | 6 / 1 / 1 | **GATE-7** — the sharpest "no detector" in the library |
| 2.4 | Reachability and dead code | REACH-1…5 | 2 / 0 / 3 | **REACH-1** — why a green test file is the worst wrong precedent |
| 2.5 | State and persistence | STATE-1…7 | 0 / 3 / 4 | **STATE-1** — six of seven workspace failures are in this family |
| 2.6 | Performance and scale | PERF-1…6 | 1 / 2 / 3 | **PERF-4** — 4.5 hours of frozen navigation behind a green gate |
| 2.7 | Product and UX (repo) | PROD-1…6 | 5 / 1 / 0 | **PROD-4** — "No recent news" against NVDA over 15 KB of headlines |
| 2.8 | Product, commercial, trust (competitors) | PROD-C1…C10 | 2 / 4 / 4 | **PROD-C1** — the corpus's most-corroborated finding, and UCT's shape today |
| 2.9 | Process and concurrency | PROC-1…9 | 9 / 0 / 0 | **PROC-9** — a day of "flakiness" that was a default argument |

**On citations.** `file:line` for code, section names for repo docs, dossier + section for
competitors. ⛔ **`_merge-master:CLAUDE.md` is cited by section heading, not by line number, and
that is deliberate:** it is a 5,823-line living document whose own thesis is that a hand-typed
positional reference beside a moving artifact is the defect this library's first entry describes.
A line number into it would go stale before this document was reviewed.

⚠️ **Two traps specific to reading CLAUDE.md as evidence, both of which this document had to
navigate.** First, it marks its own corrected claims with ⚰️ — **a corrected claim must never be
cited as live**, and where the correction is itself the interesting thing, the correction is what
is cited. Second, the repo has multiple CLAUDE.md copies at different ages; only `_merge-master`'s
is cited here.

---

## 2. The library

**Sixty-five entries in nine families.** Family order is roughly "cheapest to commit" first; the
competitor-evidenced family is §2.8, and everything before it is repo-evidenced.

---

### 2.1 Documentation and counts

The largest family by instance count, and the one whose instances are individually cheapest and
collectively most expensive.

#### DOC-1 — A hand-typed count or roster beside the artifact that owns it

**Pattern.** Writing a number, a list, or a positional reference in prose next to the code,
config or data that already determines it.

**Mechanism.** The prose is a second authority over a value it does not compute. The artifact
moves; the prose does not; and because the *list* beside the count is usually correct, the section
keeps reading as true. Worse, the count is what an engineer *audits against* — so the artifact
being right and the record being wrong produces an engineer who "verifies" the wrong thing.

**Why it survives review.** A count reads as a **summary**, not as a claim. A reviewer checks
whether it is plausible — four widget types, twenty-four setups, six services — never whether it
is derived. And the instinct that produces it is a good one: putting the number where the reader
will look is helpful, right up until it is wrong.

**Recorded instances** — `_merge-master:CLAUDE.md`, nine of them, each with its own ⚰️ correction:

| the artifact | the prose said | reality |
|---|---|---|
| `NAV_ITEMS` in `NavBar.jsx:19` | listed **Patterns**, and an array called `NAV` | no `/patterns` route existed; the identifier is `NAV_ITEMS`; the label is **UCT Terminal**, not Calendar |
| `api/routers/cot.py` | "4 routes" beside a list of **five** | the list was right, the count was not (corrected 2026-08-07) |
| `setupCatalog.js` | "24 swing setups grouped into 4 families" — **and the same wrong count in the file's own header** | 26 entries across 5 families, one of which is Intraday, so "swing" is wrong too; only **15 of 32/26 names appear in both setup lists** |
| `WidgetHost.jsx` dispatch | enumerated **four** widget types | thirteen were dispatched — nine widgets shipped into a doc saying they did not exist |
| `StockChart.jsx` developing-bar writers | "**FOUR** writer sites", pointing at an in-file comment listing A–D | six (A–F), and the comment's line numbers had drifted **2,300–4,700 lines in an 11,700-line file** |
| `themes_taxonomy.json`, labelled "source of truth" | 111 themes / 2,049 holdings / v4.16.0 | 112 / 2,029 / v4.22.0 — **three of four numbers stale across six minor versions** |
| `theme_performance._MAX_WORKERS` | documented as `2` | `6` — a 3× undercount of theme-compute threads, in the same file that budgets the single web pod's one shared anyio threadpool |
| Railway service roster | "SIX services", and before that "single service" | **seven**; `breadth-v2-runner` was live and undocumented until 2026-09-23 |
| `docs/terminal-research/01-existing-system/capability-ledger.md` | 211 rows | 178, corrected by this programme's own Phase 2 pass (`MASTER_CHECKLIST.md` row 3, which names the defect class in its own text) |

**Cost when it fired.** The only one with a clean measurement is the worst-shaped: the phantom
**Patterns** entry propagated out of the doc into `tools/mobile_audit.py`'s hand-typed route list,
where **it made the mobile harness audit the 404 page while five real member-facing routes were
never audited at all** — a harness reporting green over a hole it created. The rest cost
engineer-hours and one near-miss: an engineer auditing the single-writer invariant against a
four-item comment would have declared a six-writer file compliant.

**Structural fix.** Generate the artifact, or point at it and refuse to restate it. Both patterns
ship: `node tools/nav_manifest.mjs` regenerates the nav table from an **acorn AST** over
`NAV_ITEMS` and `--self-check` proves it can fail; `singleWriterIndex.test.js` derives the writer
set from `StockChart.jsx`'s AST (every `.update()` on `candleSeriesRef.current`, alias-resolved
with shadowing respected) and **fails by name** on a seventh; `registry.test.js` pins
`WIDGET_REGISTRY` against `WORKSPACE_WIDGETS` so the two cannot drift. Where generation is
disproportionate, the doc says "⭐ measure it, don't quote it" **and gives the command**.

**Detector.** ✅ **YES, four of them, and they are the template.** `tools/nav_manifest.mjs
--self-check` · `singleWriterIndex.test.js` · `registry.test.js` ·
`hub/surfaceMatrixIsCurrent.test.js`, which **byte-compares** two generated docs against a
regeneration and fails otherwise. ⛔ Note what the last one implies: the generator was
**regex-based twice and wrong twice** before it became an acorn parse (D-42, D-44). A generator is
not automatically a detector.

#### DOC-2 — A second authority over one value

**Pattern.** Two places stating one fact, with nothing deriving either from the other.

**Mechanism.** Divergence is silent and bidirectional: whichever copy a reader happens to open is
the one they believe. `_merge-master:CLAUDE.md` states the cost flatly — correcting the pointer
instead of the owning table "*creates the second-authority-over-one-value defect that has caused
three separate outages*."

**Why it survives review.** Restating a value beside the thing it governs is the most natural
documentation act there is, and at the moment of writing both copies are correct. The defect is
created entirely in the future.

**Recorded instance.** Six price authorities over one model's token price
(ARCH-05 §3.1, re-measured at `3b4140d46`): `narrative_cost_guard._PRICES:64-68`,
`catalyst/cost_guard._PRICING:38`, `flow_explain._PRICING:86-91`,
`pattern_vision/orchestrator._PRICE:20`, `voice_cost_service:5,:27`,
`compass_cost_guard:17-18`. ⭐⭐ **Only table 1 has a rail, and it is the only one that never
drifted.** Table 2 was fixed in a dated packet; tables 3–6 were not. Table 3 still has no
`claude-sonnet-5` entry and falls back to `(15.0, 75.0)`, so it trips at a third of its intended
spend the day the model id moves to a 5-series name. Table 5's realtime-voice rate is **three
orders of magnitude** from the vendor's published page.

**Cost when it fired.** Three outages (unattributed individually in the record). Plus a
measurable near-miss: `catalyst/cost_guard`'s mis-pricing made a $8 soft / $15 hard cap "*fire
early*" — a cost guard refusing work it had budget for.

**Structural fix.** One module, one pinning test. ⭐ And where two files genuinely must both hold
the fact, the test **parses one and compares** rather than restating it: `SAVEABLE_VIEW_TYPES`
(Python) ⇄ `SAVEABLE_VIEW_MODES` (JS) are pinned by
`tests/test_journal_two_properties_router.py`, which reads the client list, because "*a copy in
the test would be a third authority*."

**Detector.** 🟡 **PARTIAL.** A pinning test detects one pair. Nothing detects the *class* — there
is no sweep for "one value stated twice." The available proxy is
`tests/test_no_shadowed_definitions.py`, an AST sweep for a top-level name bound twice repo-wide,
which catches the code form and not the prose form.

#### DOC-3 — Two copies of one false sentence reading as corroboration

**Pattern.** The same wrong claim in two places.

**Mechanism.** Independence is assumed from location. Two files saying the same thing is the
strongest everyday signal of truth available to a reader, and it survives being false.

**Why it survives review.** ⭐ It does not merely survive review — **it passes review harder than
one copy would.** A reviewer who checks a claim and finds it restated elsewhere stops.

**Recorded instance.** `scan_evaluator.enabled()`'s docstring **and** the comment above the
sweep's `add_job` in `api/main.py` both asserted *"E-4 has not wired a surface to these results."*
The surface was wired the whole time: `/screener` → `Screener.jsx` → `ScannerShell.jsx` →
`ScreensManager.jsx` → `ScanResults.jsx` → `CoverageLine`, reading `GET
/api/scans/definition-results`, with two standing rails on it
(`_merge-master:CLAUDE.md`, "DOCUMENTED BUT UNREACHABLE" and "Phase E"). The file records the
reason it lasted in one clause: "*each looked like corroboration of the other*."

**Cost when it fired.** A false claim about a live, member-facing, rail-tested surface survived in
two places, and the correction could not be made where the claim lives — both copies are in
`api/**`, which the doc's owner cannot edit — so the correction had to be recorded in a **third**
file, creating one more authority over the same value.

**Structural fix.** Derive the claim from the thing it describes, or delete one copy. In this case
the derivation exists: `Screener.scanmount.test.jsx` mocks **nothing on the path under test**, so
it goes red when the wire is cut. That test is the sentence, executable.

**Detector.** ⛔ **NO.** Nothing in the repo detects duplicated prose claims, and the one that
would have — a rail asserting the surface is wired — was written *after* the false comment and
never linked to it.

#### DOC-4 — A record that was true when written, standing in for a live obligation

**Pattern.** Treating a dated, accurate record as a current fact.

**Mechanism.** `_merge-master:CLAUDE.md` classifies this as instrument-failure **kind 3b** and
explains why it is the nastiest: the record is **right, and read, and still the reason the thing
does not get done.** Kind 3a is the same shape for a *fix*: a true docstring, read by the person
who then spent four hypotheses rediscovering it.

**Why it survives review.** ⛔ **Neither face is catchable by testing harder.** 3a passes every
test because the statement is true. 3b passes every test it was written against, because it is
asserting the world of the day it was written.

**Recorded instances.** A ratified 33× headline that had drifted to **15×** on unchanged code.
`test_the_policy_constants_are_what_the_owner_authorised` asserting `MIN_UPTIME_S == 600` after
the owner authorised **300** — ⭐ *the rail that exists to make policy drift deliberate had itself
drifted, and was failing on the authorised value.* And the flag ledger:
`RESEARCH_TECHNICAL_TAB_ENABLED` was flipped ON by owner ruling at **2026-09-09 23:22:30 ET** and
verified in-process, while its `docs/feature_flags.json` entry kept the merge-time `dark` state
for a full day.

**Cost when it fired.** Two independent readers disagreed about whether a live member surface
existed, and **a session reading the ledger reported the live flag as a "discovery" — in a file
that recorded the flip, with its timestamp, 488 lines higher up.**

**Structural fix.** ⭐ One question, asked of records you already trust: **"when was this last
true, and what would tell me if it stopped being true?"** If the answer to the second half is
"nothing", the documentation is the whole mechanism. Structurally: the ledger records *intent* and
cannot see Railway; the checkpoint records *what happened*; **when they disagree about a live
flag, the checkpoint wins.**

**Detector.** 🟡 **PARTIAL, and its history is the warning.**
`tools/flag_ledger_audit.py` is the only thing that compares the ledger to Railway — and on
Windows `subprocess.run(..., text=True)` decoded the Railway CLI's UTF-8 with the locale codec
(cp1252), killed a reader thread, and reported *"could not enumerate the project's services"*,
**which reads as an auth or project problem rather than an encoding bug.** That is why it went
unfixed rather than unnoticed. Fixed 2026-09-10 (`encoding="utf-8", errors="replace"`).

#### DOC-5 — A stale copy of the onboarding document in the worktree an agent is dispatched into

**Pattern.** Letting the canonical engineering record exist per-worktree.

**Mechanism.** `CLAUDE.md` is auto-loaded from the **working directory**. A worktree that has not
merged master for months hands every agent dispatched into it a months-old account of the system,
including ⚰️ corrections that have since been re-corrected in the other direction.

**Why it survives review.** Nobody reviews it. It is not a change; it is the *absence* of one, in
a file that is never the subject of the branch's diff. And it reads entirely plausibly, because it
was true.

**Recorded instance — new, measured by this document, 2026-09-26.**
`C:\Users\Patrick\uct-worktrees\terminal-research\CLAUDE.md` versus
`C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md`, both read this session. Eight
divergences where the research worktree's copy asserts something the merge-master copy records as
corrected:

| claim | terminal-research copy | `_merge-master` copy |
|---|---|---|
| Railway topology | "Railway (**single service**)" | **seven** services, and "*'single service' was true once and is not now*" |
| `BrokerEquityCurve.jsx` | "🗑️ **DELETED**" | "✅ **CORRECTED 2026-09-22** — is NOT orphaned", live on two tabs |
| `useTapeFeed.js` | "🗑️ **DELETED**" | restored by `06d3a6318`, "**IN-FLIGHT, not orphaned**", and "**do not touch this file**" |
| the screener door | `SavedScreensPanel.jsx` | `ScreensManager.jsx` — `SavedScreensPanel` deleted 2026-08-22 |
| chat/voice tool parity | "Known-by-design parity gap R1-06/R1-07" | "✅ **CLOSED**, corrected 2026-09-22" (`bff6022cf`) |
| `realtime_stream.py` vendor | "Massive/Polygon WebSocket" | **Finnhub** — "*this said Massive/Polygon … wrong vendor*", pinned by a rail |
| `DESK_PUBLIC_SHOWS` | "defaults to UNLISTED … only `sunday scans` uploads public" | `*` — **every show uploads public** by owner decision |
| `auth.db` busy_timeout | "still 10s — a KNOWN remaining risk" | **3s** (`auth_db.py:506`), and the ⚰️ note that a fresh audit had to re-derive the correction because nobody moved the item off the backlog |

**Cost when it fired.** Not yet measured in this programme, and the exposure is precise: an agent
dispatched into this worktree that acts on the `useTapeFeed.js` row **deletes a file another
session explicitly reverted and marked do-not-touch**, and one that acts on the
`DESK_PUBLIC_SHOWS` row re-runs the 2026-09-13 escalation in which 27 videos were set unlisted and
then restored. ⚠️ The near-miss is real: this document's brief instructed it to read
`_merge-master:CLAUDE.md` specifically, and the harness auto-loaded the stale one anyway.

**Structural fix.** One canonical location, or a staleness stamp the reader cannot miss. The
cheapest honest version: every worktree's `CLAUDE.md` opens with the merge-base date against
master and a one-line instruction to read `_merge-master`'s copy for anything load-bearing.

**Detector.** ⛔ **NO.** Nothing compares worktree copies of `CLAUDE.md`. It would be a five-line
check.

---

### 2.2 Instruments and measurement

Nine entries. This family produced the most expensive *wrong beliefs* in the record, as distinct
from the most expensive outages.

#### INST-1 — An unauthenticated probe of a gated route measures the gate

**Pattern.** Measuring a payload's behaviour with a request that never reaches the payload.

**Mechanism.** A 401 is a complete, well-formed HTTP response with headers. Every header-level
question — cache status, content type, timing — gets an answer, and the answer is about the
refusal.

**Why it survives review.** ⭐ **Because the numbers are internally consistent and the conclusion
is actionable.** Three requests, three identical `cf-cache-status: BYPASS`, a clean
`content-type`, a plausible mechanism ("no `Cache-Control` from origin ⇒ Cloudflare defaults to
BYPASS ⇒ the fix is a response header"), and a named next step. It reads like good work. The only
tell was a status code nobody cross-checked against what the route serves.

**Recorded instance — ARCH-07 §1, dated 2026-09-26, three hours old when this was written.**
Protocol D recorded `200` + `application/json` + `BYPASS` on `/api/flow/data` and concluded the
documented Cloudflare cache rule "*is not in effect and never has been*". But
`api/flow_router.py:1729` declares the route, `:1732` takes
`_auth: dict = Depends(require_flow_user)`, and `_serve_csv` returns `media_type="text/csv"`
(`:468`ff) — **a route that answers CSV cannot have produced the JSON that was recorded**, and an
unauthenticated caller gets 401. Re-measured twice: both **401**, `application/json`, `BYPASS`, no
`Cache-Control` — an exact match for the recorded row except the status. And
`_FLOW_CACHE_HEADERS` (`:131-134`), the header the follow-up probe said was absent, **exists** and
is merged into every successful response at `:466`.

**Cost when it fired.** The conclusion travelled into **four artifacts** — the CP-05 cell, the
protocol results file, `docs/perf-baseline-2026-09-26.md`, and CARD 19 (stated as an answered
question *with a control*). ⛔⛔ And the recommended action it produced was to apply a Cloudflare
cache rule to `/api/flow/*` — a **paid, gated options tape** whose own router docstring
(`:17-20`) calls its previous ungated state "*3.07 MB of the firm's options-flow tape … the single
largest raw-data leak in the product*". Cloudflare's default cache key is the URL, not the
session, and the shipped header says `public`. **Acting on the finding could have re-opened the
product's largest historical data leak through a different door.** CARD 19 is withdrawn, not
amended; its mechanism is false at the first step.

**Structural fix.** Authenticate before measuring a gated surface, or declare that you did not.
⭐ And the half that survives is a better instrument than the original: **run gated controls.**
Three unrelated gated routes (`/api/watchlists`, `/api/j2/accounts`, `/api/auth/me`) all answer
401 with `DYNAMIC`; only the flow path answers `BYPASS`; an ungated JSON control (`/api/health`)
is `DYNAMIC`; a static asset is `MISS`. That kills "BYPASS is just what Cloudflare says about a
401" and establishes that **something is configured on `/api/flow/*` specifically** — a stronger
finding than the withdrawn one.

**Detector.** ✅ **YES, and it is reusable: the control set.** A probe of one route measures one
route; a probe of one route plus three siblings that differ in exactly the property under test
measures the property. ⛔ The re-run needs authentication, was written, and was **refused by the
permission classifier** — attempted once and handed to the owner rather than re-attempted in a
different wrapper.

#### INST-2 — An instrument pointed at a proxy for the thing it names

**Pattern.** Measuring something correlated with the question instead of the question.

**Mechanism.** `_merge-master:CLAUDE.md` enumerates three instrument-failure kinds and calls this
kind 2: "*a PROXY for the thing it named*". ⛔⛔ **It fails silently in whichever direction it
happens to lean, so the error has no characteristic sign** — which is what separates it from an
ordinary bug.

**Why it survives review.** The instrument's *name* is the claim, and the name is right. Nobody
re-reads the implementation of a tool whose output looks reasonable. The file gives the test:
"*read the instrument's own stated rule, then ask what it actually keys on. If those are two
different sentences, it is a proxy.*"

**Recorded instances.** `%an` (git author) standing in for "which session" — and it is **both**
kinds at once, since it also moved (every commit now carries one name).
`/api/health uptime_seconds` standing in for "did **my** deploy ship": when a deploy is superseded
mid-flight, uptime resolves to the *superseding* pod's boot, and **a published 15-minute blip
check read a clean monotonic uptime and named it as proof of its own deploy while measuring
another session's pod.** And `breadth_pool_report.py` grouping populations by commit SHA while its
docstring defined the rule as "*the same deployed code*".

**Cost when it fired.** The SHA-grouping one produced **an understatement and an overstatement
from a single cause in one run** — a p95 read as unreachable, and "four independent replications"
where there was one. The uptime one leaned toward corroboration and "*would have produced a
permanently green verification*". Neither is visible from the output.

**Structural fix.** Verify a deploy **by its own record's status** in the deploy list (`SUCCESS`
vs `REMOVED`) and prove code is live by **ancestry** against `origin/production` — never by an
uptime you did not tie to a named deploy.

**Detector.** 🟡 **PARTIAL.** The two-sentence test is a discipline, not a check. What exists is
per-instance: the deploy-status read replaces the uptime proxy in the runbook.

#### INST-3 — A health check that reads a proxy that resets on redeploy

**Pattern.** Alerting on an in-memory counter in a process that restarts often.

**Mechanism.** `desk_session_insights._FAIL_STREAKS` is an in-memory dict that alerts on the
**4th consecutive** failure. That needs an uninterrupted hour of 15-minute passes. The pod
redeploys several times a day (median pod life **26 minutes**, ARCH-07 §2.5), so **the streak
resets before it can fire** — and a proxy that resets on redeploy "*reports healthy straight
through a total failure*".

**Why it survives review.** The counter is correct code implementing a sensible policy ("don't
page on one flake"). Its defeat comes from a property of the *deployment*, which is in a different
document and owned by a different person.

**Recorded instance.** The whole Desk session-insights pipeline: five subsystems on three
schedules, every one failing quietly by design so a hiccup can never block publishing. ⚰️ A
failing pass was **invisible in the DB** — per-video exceptions only printed into a log flood and
stamped nothing, so "never ran" and "always fails" looked identical.

**Cost when it fired.** The insights pass was "*written, documented as scheduled, wired into no
scheduler*" **for weeks** — and was triple-broken when finally examined (a missing Zoom scope, no
scheduler wire, and a shared-client `timeout=60` against a 600k-char transcript), with each layer
masking the next. Deferred Zoom deletes had no collector, so recordings accumulated against a
storage cap.

**Structural fix.** **Re-read the artifact, never a counter.** `desk_session_audit.py` re-reads
the `edu_videos` row plus the announce ledger and names what is missing, **by name and not by
count**. ⛔ And the explicit instruction against the tempting near-miss: "*do not 'improve' this by
persisting the streak counter instead — that rebuilds the proxy.*"

**Detector.** ✅ **YES, and it is the best-railed one in the repo.** `desk_session_audit.py` +
`GET /api/desk/session-audit` + a 09:00 ET job, with wiring pinned two ways
(`tests/test_desk_session_audit.py`: an **AST over `api/main.py`** proving the `add_job` id
exists, and a route-presence check off `router.routes`) — each with a **non-vacuity control**
asserting the probe can see a sibling it is not looking for. Mutation-checked four ways. ⛔ Its
own stated hazard: "*an audit nobody runs is worse than none: it reads as coverage*."

#### INST-4 — A definition of done that a healthy system fails

**Pattern.** Setting a gate whose threshold a correctly-functioning system does not meet.

**Mechanism.** The gate gets waived once, then waived by default, and then nothing is gated at
all. ARCH-07 §2.1 states it exactly: "*a definition of done that a healthy system fails is a
definition that gets waived, and then nothing is gated at all.*"

**Why it survives review.** The threshold is defensible in the abstract ("≥99% of chart reads
should be served warm"), and it is written before the measurement exists. Nothing in review can
see that the bucket definition makes it unreachable.

**Recorded instance.** D-05 §8's warm-ratio gate buckets `stale-swr` under "the user waited", so
daily chart reads score **0/40 = 0% warm at p50 104 ms** while intraday scores 39/40 = 98% at
65 ms. Both numbers are true simultaneously; daily has been 100% `stale-swr` since 2026-08-19 and
that is the documented steady state, not a regression.

**Cost when it fired.** No outage — the cost is that the programme's only performance gate was
**unusable on its first execution** and had to be replaced mid-gate by CARD 16 (a p95 ≤ 250 ms
latency gate). ⚠️ And the replacement is currently **specified and not yet measurable**: no p95 is
computed for any surface (ARCH-07 GAPS).

**Structural fix.** Gate on the quantity the member experiences (latency), not on an internal
layer label. ⭐ **And gate on a ratio to the system's own baseline where absolute numbers measure
the environment:** a Galaxy S24 measuring 29.9 fps would have failed an absolute ≥45 fps hub gate
— while the same unit renders **30.1 fps with no fan open at all**, and a Pixel 8 on the identical
build sits at 60.3. "*An absolute threshold measures the device; a ratio measures the feature.*"

**Detector.** ⛔ **NO general detector.** The nearest thing is a review question: *run the gate
against a known-healthy system before adopting it.* Its cousin has one shipped mitigation worth
copying — `DESK_SESSION_AUDIT_GRACE_SECS` (3h), because insights land 2 min–3 h after publish and
"*without it this fires on every healthy session and gets muted inside a week*."

#### INST-5 — A rail with no control, over an empty result

**Pattern.** Asserting over the output of a command that may have returned nothing.

**Mechanism.** An empty set satisfies almost every check anyone writes. `expect(violations).toBe(0)`
passes identically for "no violations" and "the command failed."

**Why it survives review.** The assertion is the right assertion. The invocation is the broken
part, and the invocation is boring — a cwd, a pathspec, an executable resolution.

**Recorded instances.** Three in two days, **each caught only by the mutation proof, never by
review**: `rule12Paths.test.js` v1 sliced `git status --porcelain` at a fixed offset, eating the
first character of every MODIFIED path (`pp/src/pages/...`), so the forbidden-prefix filter matched
nothing; v2 ran `git diff` from vitest's cwd (`app/`) so the pathspec resolved to `app/app/src/...`
and compared `0 === 0`; `scripts/deploy_watch.py` v1 could not resolve a `.cmd` shim without
`shutil.which`, producing **forty consecutive `FileNotFoundError`s, then exit 0**.

**Cost when it fired.** None of the three ever caught a violation while broken — they were pure
false assurance. The class's cousins cost more: `-k` filtering does **not** scope a pytest run (the
filter selects execution, not collection, and `--collect-only` alone reached **6.6 GB**, which is
how three concurrent gates swept a worktree's `node_modules` to zero entries and destroyed its
`.git` file); `vitest -t` is a **regex**, so a filter matching nothing exits 0 as a false PASS;
and ⚰️ `grep -c $'\r'` through this box's Git Bash **always answers 0** — a blob holding **195 CR
bytes** answers `0`, while `grep -c 'a'` on the same blob answers 96 and `od -c` finds all 195. So
every line-ending check written that way measured the tool.

**Structural fix.** Rule 14: any rail that shells out carries a **non-vacuity control** proving
the command returned something, and its mutation proof is run **before the rail is called done**.
⚠️ The control must be able to fail — prefer naming an expected member
(`expect(files).toContain('HubRoot.jsx')`) over a count.

**Detector.** ✅ **YES.** The control itself, plus the mutation discipline. Generalisations that
shipped: pin the working directory (`git -C $(git rev-parse --show-toplevel)`), resolve
executables with `shutil.which`, and prefer commands whose output needs no offset arithmetic.

#### INST-6 — Sampling where a waiter was available

**Pattern.** A point-in-time check inside a sleep loop, instead of the library's own wait.

**Mechanism.** Everything between the samples is invisible. An editor mounting at t=8 s went
unseen until t=12 s; one mounting at t=34 s was never seen at all, and the cell died on "*the
editor never mounted*" while the product had been ready for seconds.

**Why it survives review.** `query_selector` + `wait_for_timeout` is a correct, readable,
idiomatic-looking loop with a bounded budget. Nothing about it looks like a sampling artefact.

**Recorded instance.** Measured 2026-09-18 with a clean before/after on the **same** cell:

| the same cell | GREEN | INCONCLUSIVE | seconds |
|---|---|---|---|
| sampling (`query_selector` + sleep) | 3 | 3 | 748 |
| **waiting (`wait_for_selector`)** | **6** | **0** | **211** |

**Cost when it fired.** Three of six cells lost, and **3.5× the wall-clock**, from how it waited
rather than what it measured. ⛔ And the near-miss is the instructive half: those INCONCLUSIVEs sat
next to a known deploy-churn problem and the obvious reading was "another session swapped
production again" — **the swap detector recorded zero swap-waits for that window.** An independent
signal is what separated the instrument's failure from the environment's.

**Structural fix.** If the library has a waiter, use the waiter. Keep the ceiling identical so
nothing that used to pass can start failing.

**Detector.** ✅ **YES, and it is a grep:** `wait_for_timeout(` beside a `query_selector`. The same
class was found three times in one session — two blind 9-second waits plus this one.

#### INST-7 — Reading agreement between independent instruments as corroboration

**Pattern.** When two independent tools agree on something surprising, blaming both.

**Mechanism.** ⭐ **Agreement between independent instruments is the strongest available signal
that their common input moved.** Reading it as corroboration of a shared defect inverts the one
thing independence buys.

**Why it survives review.** "Two different languages, no shared code, same wrong answer" is a
genuinely strong argument — for the wrong conclusion.

**Recorded instance.** A vitest spy reported a call site at `useDurableNote.js:957` and an
independent acorn parse reported `:952`, in a **563-line file**. I concluded both were reading a
transformed module, labelled the spy's output "not a source line", and **wrote that into CLAUDE.md
as a correction.** Both instruments were right: a patch script had read the file preserving CRLF
and written it back through a writer that translated newlines again, so 556 line endings became
**CR-CR-LF**, and a bare CR *is* a line terminator in ECMAScript — both tools counted ~1.7× the
lines, correctly.

**Cost when it fired.** A false correction published into the repo's own onboarding document, plus
a corrupted 563-line source file. ⭐ **The tell was free and walked past:** `wc -l` said 563 the
whole time. ⚰️ And it is not hypothetical elsewhere —
`docs/plans/joystick/deferred.md` measured **CR 195 / CRLF 112 / CRCRLF 82** on 2026-09-22:
eighty-two of that ledger's line endings are CR-CR-LF right now, unnoticed because every check
anyone ran on it returned 0.

**Structural fix.** When a derived number disagrees with the artifact itself, suspect the
artifact. Normalise to `\n` in memory before writing, or write with `newline=''`.

**Detector.** ✅ **YES, four numbers at once:**
`git cat-file blob HEAD:<path> | python -c "…count(b'\r'), count(b'\r\n'), count(b'\n'), count(b'\r\r\n')"`.
`CR == CRLF == LF` is uniformly CRLF; `CR 0` is LF; anything else is MIXED; a non-zero **CRCRLF**
is this corruption. ⚠️ `tools/check_repo_hygiene.py` **cannot** catch this shape by design — it
reports a path only when endings are the *only* difference.

#### INST-8 — A global count is not a measurement of your run

**Pattern.** Counting processes, rows or files matching a substring across a shared machine and
attributing the number to the thing you launched.

**Mechanism.** On a box with concurrent sessions and a leak, the number is about the machine.

**Why it survives review.** ~15 vitest-matching processes during a gate launched with
`--maxWorkers=1` is a vivid, specific, quantitative observation. It was **published twice** — in a
commit message and in a report — before anyone checked it.

**Recorded instance.** The claim: "*`--maxWorkers=1` does not bound vitest here; the repo's config
(`maxWorkers: '50%'`) overrides it*". A controlled measurement — baseline `node.exe`, launch,
sample the delta, plus a control asserting a totals line appeared:

| `--maxWorkers` | 1 | 2 | 6 | 12 |
|---|---|---|---|---|
| peak node delta | 5 | 7 | 9 | 15 |

Monotonic, ≈ bound + 3–4 fixed overhead. **The CLI bound is honoured and always was.**

**Cost when it fired.** ⛔⛔ **A code change to the gate's shard command was authorised on the
strength of it.** The command was already correct. "*Changing working code to satisfy a
mismeasurement is the defect, not the remedy*" — nothing was changed, and the measurement is
railed instead
(`test_the_cli_maxWorkers_bound_is_HONOURED_over_the_config`). ⚠️ The first two attempts at the
counter returned **0**, which is INST-5 arriving in a new costume.

**Structural fix.** Baseline, launch, measure the **delta**, and carry a control proving your run
happened at all.

**Detector.** ✅ **YES** — the opt-in rail above, plus the discipline that a zero from a process
query is a broken query until a control says otherwise.

#### INST-9 — A measurement longer than the interval between disturbances

**Pattern.** Starting a long measurement on a system that is perturbed more often than the
measurement takes.

**Mechanism.** It is arithmetic, not luck. Retrying does not change it; each retry just moves the
hole.

**Why it survives review.** ⛔ **The tell is a retry that looks reasonable.** Each individual
re-run is defensible. The third is where you should notice you are in a loop whose exit condition
is outside your control.

**Recorded instances.** Two in one night, in two different systems:

| measurement | takes | disturbed every | outcome |
|---|---|---|---|
| six-shard gate | 46–92 min | master moved **56 commits in 92 min** | carry-over failed; re-gate; superseded again |
| one 2.8b rig cell | 12–22 min | production deployed every **~13 min** | **22 of 23 cells INCONCLUSIVE** on `/api/auth/me` 502 |

**Cost when it fired.** A night of gate runs, and 22 lost measurement cells. ⭐ **Both instruments
were right** — the rig refused to measure through a deploy swap rather than inventing a verdict;
the carry-over tool refused to carry a gate it could not justify. Reading either as a product fact
would have been the error. ARCH-07 §2.5 makes it a standing programme finding: fourteen deploys in
six and a half hours, median pod life 26 minutes, and a valid Protocol A window took ~17 minutes
of waiting.

**Structural fix.** Name the disturbance interval, compare it to the runtime, and if the run
cannot fit, **say so and stop**. ARCH-07: "*any capacity or memory measurement needs a declared
quiet window, and the programme must stop treating that as a scheduling detail.*"

**Detector.** 🟡 **PARTIAL.** Nothing automates the comparison. The related sharp rule that *is*
detectable: a 1800 s run whose `raw.txt` contained the two words "TIMED OUT" — because
`except subprocess.TimeoutExpired:` discarded `e.stdout` **and** the child was block-buffering —
is now covered by R-RAW, which makes a run with no raw artifact INCONCLUSIVE regardless of what
the console showed.

---

### 2.3 Guards and gates

#### GATE-1 — A guard nobody has seen fire

**Pattern.** Shipping a protection without a test that watches it actually fire.

**Mechanism.** A guard that cannot fire and a guard that never needed to fire produce the same
output: silence.

**Why it survives review.** The guard is present, named, and reads correctly. A reviewer confirms
it *exists*.

**Recorded instance.** The repo-root `conftest.py` tripwire on `C:\data`. Its rails
(`tests/test_shared_data_root_guard.py`) include probes that watch the guard **fire**, against a
throwaway directory, never `C:\data`. ⭐ **And the design detail that makes it work is
counter-intuitive: the record is the guard, not the raise.** A daemon thread's exception goes to
`threading.excepthook` and the test that spawned it passes green — **four of the five leaks it
found were on a background thread.**

**Cost when it fired.** The class it guards has a measured cost: `C:\data\auth.db` grew to ~1 GB /
20,640 users through test runs, and one daemon thread wrote ticker `A` into `C:\data\screener.db`
and **made the member-facing screener label 3,583 month-old rows "today"** (`e86ad6d5`).

**Structural fix.** Modes (`enforce` / `report` / `off`) so "nothing reaches the shared root"
is a **measurement** rather than an assumption; a redirect *beside* a tripwire rather than instead
of one, because "*a redirect alone hides the next offender*"; and every fix an env override whose
default is the literal that was already there, so production resolves byte-identically with
nothing set.

**Detector.** ✅ **YES** — the firing probes, and `--self-check` on the tooling of the same shape.
⚠️ Its own stated limit: writes into `C:\data` from **outside** pytest still hit the live files.
The guard is a test-suite rail only.

#### GATE-2 — Three copies of one guard

**Pattern.** Repeating an invariant in every writer that needs it.

**Mechanism.** ⭐ **Three cannot be mutation-proved.** Killing one copy leaves the other two
green, so no test can demonstrate that any single copy is load-bearing — and one copy having a
hole is invisible **because the others read as coverage for both.**

**Why it survives review.** Defence in depth is a real principle, and a reviewer reading copy 2
sees the invariant enforced.

**Recorded instance.** `putNoteWithIntent`'s "a null intent is not permission to delete unsent
work" guard lived in `settleLandedSave` and **not** in `persist`. One implementation therefore had
one hole, in the path that deletes a member's queued words.

**Cost when it fired.** A member's unsent Notebook text deletable on one of two write paths, with
the invariant documented, mutation-proved at its own layer, and every rail green.

**Structural fix.** **One exported predicate both writers ask** — `discardsUnsentWork`. ⭐ The
proof that the extraction is real is that killing the shared predicate **reds both fixes' rails at
once**.

**Detector.** ✅ **YES** — the shared-predicate mutation proof. And the standing rule: "*delete
every copy but one*."

#### GATE-3 — A guard on the incoming record cannot protect the outgoing one

**Pattern.** Keying a guard on the value a function is *handed* when the value at risk is the one
already in the store.

**Mechanism.** If a writer can change the field the guard reads, in the same write, the guard is
not on that path.

**Why it survives review.** The guard is correct, its comment states its purpose accurately, and
it is mutation-proved **at its own layer**. There is nothing to notice.

**Recorded instance.** `putNoteWithIntent`'s class guard was written `else if (noteRecord.dirty)`
— reading the record being written. A writer flipping `dirty: 1 → 0` in the same transaction
satisfies the `else` and takes the cursor-delete branch. "*The guard was correct, documented,
mutation-proved at its own layer, and structurally unable to see the case it was written for.*"

**Cost when it fired.** Deletion of a member's queued, unsent words.

**Structural fix.** A companion guard that reads **the record already in the store**, because that
is the only place the unsent work still exists at that moment. Both stay; neither is redundant.

**Detector.** 🟡 **PARTIAL** — a rail per guard, with a fixture that flips the guarded field in
the same write. No sweep exists for the class.

#### GATE-4 — A guard that verifies itself instead of the property

**Pattern.** Testing that your guard behaves as written, and concluding the property holds.

**Mechanism.** ⭐ "*Verifying the guard you wrote is not the same as verifying the property you
want.*"

**Why it survives review.** The guard was real, was verified against **five spellings**, and
worked exactly as specified. The review question "is this guard correct?" has the answer yes.

**Recorded instance.** `scripts/hub-sandbox.ps1` refused `-DataDir C:\data`. But there are **72
environment variables naming paths inside the shared root, and they resolve independently of
`DATA_DIR`** — `api/services/auth_db.py:10` is the whole class in one line:
`_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")`. The sandbox path was correct and
**71 of the 72 vars ignored it.**

**Cost when it fired.** A sandbox boot on 2026-09-08 wrote to live `C:\data\auth.db` (1.01 GB,
~20,640 real members), `desk.db`, `flow.db-shm`/`-wal` and `buzz.db-shm` — **while printing a
clean startup and serving a healthy `/api/health`.** No member data was altered
(`quick_check = ok` on all four; the writes were idempotent schema-init and WAL churn) and the
record says the quiet part: "*it could just as easily not have been.*" ⚰️ And setting `DATA_DIR`
is **not** the remedy: a later bare probe set `DATA_DIR` to a scratchpad, looked sandboxed, and
wrote `C:\data\fundamentals_estimates.db` and `C:\data\fundamentals_tables.db` anyway, because
both resolve through their own vars.

**Structural fix.** Apply the **census**, never a hand-picked var:
`conftest.shared_data_root_census()` derives the pins by **AST over `api/**`, `scripts/`,
`tools/`**, `unpinnable` is currently 0, and order is load-bearing — paths are captured at module
import, so a pin set after the import reaches nothing.

**Detector.** ✅ **YES, two rails that fail for different reasons.** The **census rail**
(`tests/test_hub_sandbox_launcher.py`) proves the derivation is applied, that no typed `/data/...`
literal has crept back, and that every kill-list flag name resolves to a real read site —
mutation-proved both ways. The **snapshot rail** (`scripts/data_root_snapshot.py`)
content-hashes every main `.db` before boot, at +15 s, at +120 s and at shutdown, and aborts the
run on any change. ⚠️ Hash the main `.db` and **exclude `-wal`/`-shm`** — opening a WAL database
read-only still rewrites its `-shm`, so an mtime check cries wolf on its own diagnostics.

#### GATE-5 — An invented kill-switch name

**Pattern.** Writing an env flag into a kill list without grepping it to a read site.

**Mechanism.** ⭐ "*An env var nobody reads is indistinguishable from a working kill switch — both
produce silence.*"

**Why it survives review.** The name is plausible, follows the codebase's conventions, and appears
in a list of other names that do work.

**Recorded instance.** `BARS_PREWARM_DISABLED=1` matches nothing in the codebase. The bars seeder
is gated only by `USE_REMOTE_BARS`.

**Cost when it fired.** It ran — **3,160 jobs, 4 workers** — against live data, while the operator
believed it was off. It is root cause 2 of the same sandbox incident as GATE-4.

**Structural fix.** ⛔ "*Never invent an env flag. Every kill-switch name must be grepped to an
actual read site before use.*"

**Detector.** ✅ **YES** — the census rail's flag-name check, mutation-proved by re-adding
`BARS_PREWARM_DISABLED` and watching it go red. ⭐ This is the only entry in the library whose
detector was built by the same incident that named the pattern.

#### GATE-6 — A rule stated in a document that no check enforces

**Pattern.** Recording a policy in prose and relying on the prose.

**Mechanism.** The document and the running configuration diverge, and **nothing can tell**,
because the flag's shape excludes it from the one auditor that looks. ⭐
`_merge-master:CLAUDE.md`: "*A doc that states a rule no check enforces is a rule that lasts until
somebody changes a variable.*"

**Why it survives review.** The doc is emphatic, well-reasoned, and cites the mechanism correctly.
It reads as a control.

**Recorded instance.** `DESK_PUBLIC_SHOWS`. CLAUDE.md asserted for **25 days** that only
`sunday scans` uploads public and that "*Live Trading Sessions above all, which are paywalled,
stay unlisted*". The live value was `*` — every show public, by owner decision, since 2026-08-19.
Nothing could tell: the flag carries no `ENABLED`/`DISABLE` marker, so `is_gate()` is false for it
and **the flag-ledger rail never asked about it at all.**

**Cost when it fired.** An agent found the live wildcard, read the doc, and correctly escalated a
paid-content leak; **27 videos were set unlisted and then restored** when the owner confirmed the
decision was his. ⭐ **Nothing was wrong with the escalation** — the doc asserted a rule, the world
disagreed, and no record anywhere said which was intended.

**Structural fix.** Two checks, because the class needs both halves.
`tests/test_visibility_flag_ledger.py` (offline): every visibility flag declared with
`exposure`/`default`/`values`, a wildcard **refused unless the entry carries a dated
`owner_decision`**, declared values must name sections `_RULES`/`_HOST_AWARE` can actually
produce, and the declared default must equal `_PUBLIC_SHOWS_DEFAULT`.
`tools/flag_ledger_audit.py --visibility` (live): the same authorised-wildcard rule against the
running value. ⭐ **And the only half that could ever have seen this class is the live one — the
wildcard was never in the repo.**

**Detector.** ✅ **YES, both halves.** ⭐ The design principle is worth carrying into
Terminal-Next verbatim: "*the rail records intent; it does not veto it. A wildcard costs one dated
sentence.*"

#### GATE-7 — An auditor whose aperture excludes the failure class it exists for

**Pattern.** Building the one instrument that inspects a security surface, and having it inspect a
subset.

**Mechanism.** `api/auth_surface_check.py:79` sets `MUTATING = {"POST","PUT","PATCH","DELETE"}`
and `:248` iterates only those. **So the boot auditor cannot see a GET** — and the entire risk it
exists for is unauthenticated GETs of vendor market data.

**Why it survives review.** "Audit the routes that change state" is a completely reasonable
threat model, stated in the constant's own name. The word `MUTATING` is doing the reviewer's
thinking for them.

**Recorded instance.** R-17, CONFIRMED 2026-09-02 08:05 UTC by unauthenticated read-only GETs
with a browser user agent: `/api/live-prices?tickers=SPY` (200, live Massive quote),
`/api/snapshot/SPY` (200, extended-hours snapshot), `/api/movers` (200, with reasons) all answered
without any session; `/api/gex/data` reached its handler (422, not 401). ARCH-06 §0 re-measured
master's source: those routes now declare dependencies — **and six route families still do not**
(`/api/stream/prices` real-time equity ticks, `/api/gex/compare` *four lines below the gex route
that was fixed*, three `/api/dealer-positioning/*` diagnostics, `/api/flow-scoreboard`, and `/r/*`).
⛔ "*The remediation was per-route. The class was not addressed.*"

**Cost when it fired.** "*Vendor real-time data is redistributable to anyone who finds the URL,
independent of membership*" (R-17, H/H, compounds R-14). Paired with the flow router's own history
— 3.07 MB of the firm's options tape to an anonymous caller before 2026-08-09 — this is the
highest-severity class in the record.

**Structural fix.** ⭐ **Widen the aperture.** ARCH-06 names it as the highest-leverage
engineering change identified: it is additive and fails closed. And the design rule for
Terminal-Next follows from it — every data route enforces server-side; S9 is what the route
consults, not what enforces.

**Detector.** ⛔ **NO — and this is the sharpest "no detector" in the library.** The one
instrument that looks is structurally blind to the class. ⚠️ Compounding it: ARCH-06's route sweep
was done by **reading named files, not by importing `api.main:app` and walking `app.routes`**, so
its own completeness is 🟡, and it deliberately does **not** report R-17 closed — the finding was
established by probe and can only be retired by probe, and `web` deploys from `production` while
the read was of a `master` worktree.

#### GATE-8 — A global override reached for because it exists

**Pattern.** Shipping a broad escape hatch beside the narrow one.

**Mechanism.** Under pressure, people take the lever that is in reach. A global skip waives every
clause, including the ones the operator had no intention of waiving.

**Why it survives review.** The global override was **reviewable by design** — it wrote to
`logs/pre-push-guard-bypass.log`. Every word of its justification was true. ⭐ "*and it is how the
wrong lever got pulled.*"

**Recorded instance.** 2026-09-17: a session needing to pass the **burst** clause alone reached
for `UCT_SKIP_PREPUSH_GUARD=1`, which waived the **in-flight** clause too, and the push landed
inside another workstream's deploy swap. ⭐ The guard had had the right lever since D-10 — R19's
scoped attestation (`UCT_BURST_ATTESTED_BY` + `UCT_BURST_ATTESTED_AT`, ISO, ≤15 min), which exits
the burst clause and **provably cannot satisfy recency or in-flight**. "*Nobody reached for it
because a global one existed.*"

**Cost when it fired.** A push inside another session's swap — the same shape that produced the
only 502 on record (a request in flight died with a 500 after 93 s; `/api/health` served 502 for
~45 s).

**Structural fix.** ⭐⭐ **"The fix is fewer levers, not more care."** `tools/pre_push_guard.py`
now refuses the global skip unless HEAD is a real revert of the commit the deploy record says
production is serving, with `UCT_ROLLBACK_REASON` set.

**Detector.** ✅ **YES** — the refusal is the detector, and `tests/test_no_market_hours_window.py`
is the template for the adjacent lesson: a **retired** rule that still prints its own name on
every push "*is not retired, it is advertised*", so the test fails the master gate if the name
returns and asserts the guard is **time-of-day invariant**.

---

### 2.4 Reachability and dead code

#### REACH-1 — Documented-but-unreachable code

**Pattern.** Describing as live a component, route or page nothing reaches.

**Mechanism.** ⭐⭐ **"Unreachable code documented as live teaches the next engineer the wrong
idiom"** — and the record is explicit about the worst form: "*a green test file standing in for a
door that does not exist is the most convincing wrong precedent in the repo.*"

**Why it survives review.** It was true. Deletion of the consumer does not touch the doc, and the
doc's claim is about behaviour a reviewer cannot falsify without walking the import graph.

**Recorded instance.** `_merge-master:CLAUDE.md`'s "⚰️ DOCUMENTED BUT UNREACHABLE" table sits at
the **top of the file instead of in a footnote**, and it says why: "*an agent this week read
`CustomScan.chartmount.test.jsx` as the precedent for its own task before noticing the page it
tests reaches no route.*" Ten rows; nine now name paths that do not exist.

**Cost when it fired.** An agent's task built on a dead idiom (caught). And a four-month-long one:
`GET /api/voice/risk-dashboard` + `voice_position_sizing.get_risk_dashboard()` **ran real
per-member risk math on every hit with zero frontend caller for four months**, because its UI panel
was deleted 2026-08-09 by inheritance from a free-tier narrowing and the backend was never cleaned
up. ⛔ Worse, its heat math had **no placeholder-stop detection**, so a broker-imported position
with no real stop contributed zero to its risk total — the exact under-reporting bug
`portfolio_heat.py` was later built to close.

**Structural fix.** One table that is the **single owner** of these claims, with pointers
elsewhere ("*correct this table, not the pointer*"), plus a derived rail.

**Detector.** ✅ **YES.** `app/src/components/screener/reachable.test.js` walks the real import
graph from `App.jsx` with an **AST**, following `lazy(() => import(…))`, `await import()`,
`require()`, `import.meta.glob`, `new Worker(new URL(…))` and alias forms, sweeps all of
`app/src`, and **fails by name** on the next orphan — with a **control** proving the dynamic edge
is load-bearing so it cannot pass for the wrong reason. ⛔ The reason an AST and not a grep: a grep
here once "*found 5 call sites, all five of them prose*". ⚠️ And the reason the rail exists at all
is that the previous hand census reported "*48 modules unreachable*" including `components/ui/*` —
where `UIcon` has **222 import statements**. Acting on it "*would have stripped the icon system
off every screen*."

#### REACH-2 — A feature built, tested, green, and connected to nothing

**Pattern.** Shipping a component with passing tests and no mount.

**Mechanism.** ⭐ **Component tests are structurally blind to a severed wire.** Every assertion is
about the component in isolation, which is exactly the state a disconnected component is in.

**Why it survives review.** The PR is complete by every visible measure: code, tests, green.

**Recorded instance.** The 2026-08-08 audit found **eight**. Individually named elsewhere in the
record: `CompassTodayTile.jsx` (built-but-unmounted, later revived as the "Compass noticed" feed);
`MarketStatusBar.jsx` (built, never mounted, deleted 2026-08-22 with its helpers extracted);
`app/src/pages/optionsFlow/FlowExplainButton.jsx` + `FlowExplainModal` — a complete, **9/9
tested** "explain this print" UI for a live `POST /api/flow-explain` backend, deliberately not
imported (`PACKET-AA CP1`), with mounting gated on owner+partner coordination.

**Cost when it fired.** Eight features' development cost carried with zero member value, and the
reachability sweep + deletion pass it forced (`d26cee0c` · `ed53f9b6` · `24ee463b`). ⚠️ Note the
distinction the record insists on: `FlowExplainButton` is **unmounted by design and tracked in a
decision gate**, which is not this anti-pattern. The anti-pattern is unmounted *and unrecorded*.

**Structural fix.** A wire test that mocks **nothing on the path under test**
(`Screener.scanmount.test.jsx`), so it goes red when the wire is cut while every component stays
correct. ⭐ "*That is the shape the 2026-08-08 audit said was missing.*"

**Detector.** ✅ **YES** — `reachable.test.js` for the module, a scanmount-shaped test for the
wire. ⭐ And a third state the rail models explicitly: `AWAITING_A_DECISION`, so "built, unmounted,
on purpose" is distinguishable from "built, unmounted, forgotten."

#### REACH-3 — A route whose own docstring asks to be mounted

**Pattern.** Leaving mount instructions in a superseded module.

**Mechanism.** The instruction is an imperative in the voice of the code. A reader following it
creates a second authority — and **FastAPI answers on first match**, so the shadowing is silent.

**Why it survives review.** It is not in any diff. It is a docstring in a file nobody opens until
someone greps for "earnings".

**Recorded instance.** `api/earnings_router.py` — its own docstring says *"Mount in main.py:
`app.include_router(earnings_router, prefix="/api/schwab")`"*. 🔴 Still present, still unmounted,
the only live row in the unreachable table. It is superseded: `api/schwab_router.py`'s
Yahoo-backed `_fetch_earnings_yf` + `POST /api/schwab/earnings` serves **at the very prefix the
docstring asks for.**

**Cost when it fired.** Not fired. The recorded cost is the standing warning: mounting the
Finviz-scraping predecessor "*would put a second authority on earnings dates and silently shadow
one of the two*", and the instruction sits in a file the doc's owner cannot edit.

**Structural fix.** Delete the superseded module, or make the docstring say what replaced it.

**Detector.** ⛔ **NO.** `reachable.test.js` sweeps `app/src`, not `api/**`. The backend
equivalent exists as a one-off technique — the 2026-08-09 audit enumerated routes by **importing
`api.main:app` and walking its 986 routes** rather than grepping `include_router` — but it is not a
standing rail.

#### REACH-4 — The name survived the move and the wiring did not

**Pattern.** Relocating a feature and keeping its label.

**Mechanism.** ⭐ The documentation's claim is *visually* confirmed. "ON THE TAPE" is on screen,
so nobody checks which hook draws it.

**Why it survives review.** It is the one anti-pattern in this library that **passes a manual
smoke test.** A human looking at the product sees the thing the doc describes.

**Recorded instance.** "ON THE TAPE" was removed from `MoversSidebar.jsx` (`3dc5036a`); the string
appears nowhere in that file. The tape shipped on the Dashboard as `components/tiles/TapeFeed.jsx`
— reading **`/api/tweets/feed` via `useTweetFeed.js`**, not `/api/tweets/tape` via
`useTapeFeed.js`. The doc described the old wiring for months.

**Cost when it fired.** Two of the three surfaces the Twitter-ingestion section claimed did not
exist, and the third was on a different endpoint. `GET /api/tweets/tape` remains mounted with zero
frontend callers. ⭐ **And the repo drew the right general conclusion from it** — when
`youtube_client.upload_unlisted` gained the ability to publish publicly it was **renamed rather
than given a `privacy` kwarg**, "*because a method called `_unlisted` that can publish publicly is
exactly the stale-name defect this file keeps paying for (cf. 'ON THE TAPE')*", and it rejects a
`privacyStatus` outside `_PRIVACY_STATUSES` rather than letting YouTube coerce a typo.

**Structural fix.** Rename on behaviour change. A name that can lie is a name that will.

**Detector.** ⛔ **NO.** Nothing links a documented surface to the hook that draws it.

#### REACH-5 — Reading "unreadable" as "empty"

**Pattern.** A helper that returns a falsy value for both "absent" and "could not be read."

**Mechanism.** ⭐ **A layer that could not be READ is not a layer that is EMPTY.**
`_doc_text(None) == ''` scores an unreadable close as absent.

**Why it survives review.** The coercion is idiomatic, defensive, and looks like good hygiene —
it prevents a crash.

**Recorded instance.** Wave Q1: the instrument manufactured a finding by scoring an **unreadable**
editor close as "absent". It is the second time in the same programme that the instrument
manufactured a finding — the first was counting pre-existing conflicted copies.

**Cost when it fired.** A published finding about member data loss that was an artefact of the
measuring code.

**Structural fix.** Three outcomes stay three at every layer (see PROD-4). An unreadable input is
INCONCLUSIVE, never a value.

**Detector.** ⛔ **NO.** The nearest shipped discipline is the rule that an undrivable real door is
"INCONCLUSIVE, never a silent fallback."

---

### 2.5 State and persistence

C5-01 §7 measured **six of seven** workspace failure modes as persistence failures. ⭐ Its
one-sentence conclusion is the most important input to Terminal-Next's shell design: "**the hard
part of a workspace is not the grid, it is the document.**"

#### STATE-1 — An unversioned workspace document

**Pattern.** Persisting a structured layout with no schema version, and migrating by sniffing its
shape.

**Mechanism.** Every future migration has to *infer* which schema it is looking at, and an
inference over shape misfires on a legitimate future shape.

**Why it survives review.** ⭐ **It is the category default, not a local oversight.** C5-01 §8
checked seven layout libraries' own persistence documentation — dockview, FlexLayout, rc-dock,
golden-layout, react-mosaic, Lumino — and **none documents a schema-version field or a migration
story.** Every one hands the application an opaque serialized object. Versioning is the
application's job in every case, and nothing in the ecosystem prompts you to do it.

**Recorded instance.** `charts_workspace_layout` carries no version field; its two migrations are
shape-sniffed (`cols !== 24`; `maxBottom <= FIXED_ROWS/2`). C5-03 §3 measured it on production,
read-only, counts only: **17 of 29 accounts hold a board, 0 of 17 carry a `version` field, 0 are
unparseable, median blob 476 B / max 8,752 B.** ⚠️ The cohort is admins, staff and testers under
`COMING_SOON_MODE`, several of whom built the board — quote the counts, not the percentage.

**Cost when it fired.** Not yet fired: 0 of 17 unparseable. The stated forward cost is that the
height heuristic "*will misfire on any legitimate future layout whose widgets all sit in the top
half of the board*."

**Structural fix.** C5-03 §5's sequenced ruling: **now**, stamp a version on
`charts_workspace_layout` and retire the `maxBottom` heuristic in the same commit; **for
Terminal-Next**, its own store. ⭐ And the pattern already ships, for exactly one key:
`chart_settings` carries `settingsVersion: 2`, a read-time idempotent fold, a hard allow-list,
tombstone deletes and union-by-`instanceId` merge — "*the only place a version number lives in the
data*". D-11's closing line is the sentence to carry: "*Every piece already ships. **None of them
is currently applied to the layout.***"

**Detector.** ⛔ **NO.** A test asserting every persisted blob carries a version would be one, and
does not exist. ⛔⛔ **And the failure mode of the sequenced fix is specific and likely:** "*anyone
who ships step 1 and stops has left the board on a store whose own repo documents why it is wrong
for this.*"

#### STATE-2 — A parse failure that renders as a new user, then autosaves over the original

**Pattern.** Catching a deserialization error, returning a default, and letting the default
persist.

**Mechanism.** The empty state is indistinguishable from a genuinely new user — no error, no
toast, no flag. And because the board autosaves, **the empty state overwrites the
corrupt-but-possibly-recoverable original within 500 ms of the first grid event.**

**Why it survives review.** `try { return JSON.parse(x) } catch { return null }` is the most
reviewed-and-approved idiom in front-end code. The *autosave* is in a different function, written
by a different concern.

**Recorded instance.** UCT's `parseLayout` [C5-01 §7 failure 1, citing D-11 §2.2]. Bloomberg's
`MNRS` is the **productised response to the same class** — a restore-my-screens function, which
tells you the class is universal enough to have a Bloomberg command. Benzinga Pro's layouts live
in browser cache: **clear the cache, lose the desk** [C5-01 §7, citing B-BZ §G].

**Cost when it fired.** 0 of 17 in this corpus — it answers D-11's own 🟡 on whether the path has
ever fired. ⭐ **It remains a live path; it is not a live incident.** C5-03 §7 lists "a measured
incident on the corrupt-blob path" as a signal that would raise commitment 2 from "sequenced" to
"urgent."

**Structural fix.** Distinguish the three states (new / corrupt / empty-by-choice), refuse to
autosave over a blob you could not parse, and keep the original.

**Detector.** ⛔ **NO.** This is REACH-5 in the persistence layer, and neither has one.

#### STATE-3 — One conceptual write that is physically eight, with no transaction

**Pattern.** Saving a composite object as a sequence of independent writes.

**Mechanism.** A failure partway leaves a coherent-looking hybrid. D-11 §2.3: applying or saving a
named layout is "*six-to-seven independent writes with no transaction … A 'layout' is conceptually
one thing and physically **eight***", plus one device-local localStorage key. "*A failed POST
partway through `applyTemplate` leaves a board whose arrangement is the new template and whose
look is the old one, with nothing detecting it.*"

**Why it survives review.** Each write is correct, each has error handling, and the sequence reads
as a procedure. Atomicity is a property of the *set*, which no single reviewer's attention is on.

**Recorded instance.** `applyTemplate` writing `charts_workspace_layout`, `watchlist_settings`,
`theme_tracker_settings`, `fundamentals_settings`, `breadth_widget_settings`, conditionally
`chart_settings` and `charts_vol_pane_pct`, plus `charts_active_template` — **and**
`uct.watchlist.cols`. ⭐ The localStorage key was dragged into the bundle **by a real bug**, and
the in-code comment names it: "*added columns vanished after switching layouts and back.*"

**Cost when it fired.** One shipped member-visible bug (the vanishing columns). The rest is
latent. ⚠️ Note the inputs disagree on the count — D-06 says fourteen keys, D-11 says eight — and
C5-03 §5.3 rules that **eight is the number that decides the design**, because the number that
matters is "*the set that must commit or roll back together.*" Both are correct at their own
scope; conflating them is DOC-1 in a new costume.

**Structural fix.** One document, one write. D-11's gap table is blunt: "*Atomic workspace write |
🔴 **none***."

**Detector.** ⛔ **NO.**

#### STATE-4 — A hydration race that persists the pre-hydration default

**Pattern.** Letting a layout library's mount-time change event reach the save path.

**Mechanism.** react-grid-layout fires `onLayoutChange` on first mount — with the **default**
layout, before hydration — which would persist an empty board over the member's real one.

**Why it survives review.** It is not visible in any single file. The library's event is correct;
the save handler is correct; the bug is in their composition at t=0.

**Recorded instance.** UCT's `hydratedRef` gate "*exists solely to prevent this, is checked on
every save path, and is **reproduced identically** in `useMultiChartState.js`, where the comment
names it 'the V1 hydration-clobber race'*" [C5-01 §7 failure 3, citing D-11 §2.2].

**Cost when it fired.** Once, enough to produce a named guard and then a second copy of it.
⚠️ Note the second copy is GATE-2 waiting to happen — two copies of one invariant, in two files.

**Structural fix.** A hydration gate on day one, in **one** place. ⭐ "*It is a property of every
library in §8 that emits a change event on mount*" — so it is a property of the *choice to use a
layout library*, not of RGL.

**Detector.** 🟡 **PARTIAL** — per-instance tests exist; nothing asserts the gate is on every save
path.

#### STATE-5 — A breakpoint ladder that overwrites the only saved layout

**Pattern.** Letting a responsive grid reflow and persist the reflow.

**Mechanism.** RGL re-maps `x`/`w` to the narrower grid, fires `onLayoutChange` with the squeezed
coordinates, and the single persisted layout is overwritten **irreversibly**.

**Why it survives review.** Responsive breakpoints are the feature. Persisting layout changes is
the feature. Nobody is reviewing their product.

**Recorded instance.** `/charts` uses **24 columns at every breakpoint on purpose**, and the
in-file comment records why [C5-01 §7 failure 4, citing D-06 §1.2 and D-11 §2.1]. "*This is the
generic form of the bug: any layout library that reflows on resize will try to persist the
reflow.*"

**Cost when it fired.** Irreversible loss of members' saved layouts, pre-fix.

**Structural fix.** One column count, or one persisted layout **per breakpoint**. Not one of each.

**Detector.** ⛔ **NO.**

#### STATE-6 — `user_preferences` as a workspace store

**Pattern.** Putting a growing, structured, per-member document in the scalar-settings table.

**Mechanism.** D-11 §1.1: it is "*an unversioned, uncapped, undeletable key→TEXT table*". There is
**no DELETE route** — `delete_user_preference` exists and is imported **with no caller** — so dead
keys accumulate permanently. And prefs are inlined into `/me`, so "*a large workspace blob is paid
for on every page load by every surface.*"

**Why it survives review.** It is the store that exists, it works, and the first blob is 476 B.
⭐ **And the repo already argued this against itself**: `user_definitions.py` opens with "*WHY NOT
`user_preferences` — ALSO MEASURED: `user_preferences` has NO SIZE LIMIT and NO DELETE ROUTE… This
store names its caps and ships a delete.*" The argument was written, accepted, and then not
applied to the layout.

**Recorded instance.** 49 distinct preference keys in use app-wide (C5-03 §3), including every
`/charts` key.

**Cost when it fired.** Latent at 476 B median. ⚠️ **One live footgun with a shipped instance:**
`POST /api/auth/preferences` is `{key: str, value: str}` and **REPLACES the whole value**
(`set_user_preference` writes one TEXT column). A recovery snippet in
`46-preview-production-check.md` posted `{joystick_hub: {...}}`, **called itself "a JSON-patch
merge", and was neither** — it would have silently wiped `handedness` and `coachMarkSeen`.

**Structural fix.** Its own store, modelled on `charts_layout_service.py` / `user_definitions.py`
— own SQLite file, WAL, `_WRITE_LOCK`, explicit caps, an explicit delete (C5-03 §5.2).

**Detector.** 🟡 **PARTIAL.** Nothing detects a growing blob in the scalar store. A size cap would
be the detector, and there is not one.

#### STATE-7 — A single-process correctness guard read as a cache

**Pattern.** Bounding a contractual or billed quantity in module-level state.

**Mechanism.** ⭐ **These are correctness guards, not caches, so a second instance silently
doubles the thing each one bounds** rather than degrading gracefully. A cache that misses is slow;
a lock that is per-process is absent.

**Why it survives review.** They are all correct today, and the web pod is one uvicorn process.
The comment "*correct today, first thing to break on scale-out*" is doing the review's job for it
— and only in one of the two places it is needed.

**Recorded instance.** Enumerated twice. The broker section names `sync._locks` (the idempotency
guard against concurrent syncs of one account), `recent_orders._last_poll` (SnapTrade's
**contractual** ≤1 poll/5min/account), `manual_refresh._last_trigger` (**billed** refresh calls),
`notifications._failure_pinged` + `_spike_pinged`, `partner_health._cache`. ARCH-07 Q8 adds SSE
state, the Finnhub per-minute budget and the live-price cache.

**Cost when it fired.** Not fired — the pod is single-process and is **deliberately not
multi-workered** because SSE state is in-process. ⭐ Durable equivalents exist where a repeat is
genuinely costly (`j2_broker_member_stale_notify`, `j2_broker_digest_dedup`); the instruction is
to extend that pattern rather than add new module dicts.

**Structural fix.** ARCH-07 Q8's binary trigger, written **beside the state it protects**: "*does
more than one process need to fan out the same stream, or enforce the same budget?*"

**Detector.** ⛔ **NO** — "*the trigger condition belongs in a comment next to each one, which is
already the pattern the broker section uses.*" A comment is not a detector, and this entry says so.

---

### 2.6 Performance and scale

#### PERF-1 — An unthrottled per-request DB write on the universal auth path

**Pattern.** Writing to the database on every authenticated request.

**Mechanism.** One uvicorn process = one event loop + one anyio threadpool (64) shared by all
users. A SQLite write on the path *every* request takes turns threadpool exhaustion into a
correlated failure.

**Why it survives review.** `last_login` is one small `UPDATE`, on a table with an index, on a
request that already touches the database to validate the session. It is invisible in review and
invisible in local testing.

**Recorded instance.** The 2026-07-01 **524 outage**: anyio-threadpool exhaustion plus SQLite
write contention on the single loop. Fixed by `auth_service._should_write_last_login` (300 s
throttle) plus offloading cold work.

**Cost when it fired.** ⭐ The measurement that makes it unforgettable: **a bare 401 took 24
seconds.** Site-wide.

**Structural fix.** The keystone rule as stated: "*never do an unthrottled per-request DB write on
the universal auth path.*" And its sibling: "*any NEW blocking external call on the request path
MUST have a timeout*" — Anthropic client `timeout=60`, `massive._bounded_yf`,
`yf_util.bounded_call`.

**Detector.** 🟡 **PARTIAL.** `tools/llm_timeout_census.py` rails the timeout half. Nothing
detects a new write on the auth path. ⚠️ A timeout census is also how the *next* trap was found:
the shared `timeout=60` made every Desk `generate_insights` call time out against a 600k-char
transcript, and the fix was a per-call `with_options(timeout=…)` — **a global bound applied to a
lane it was not sized for.**

#### PERF-2 — A cache bound that is size-blind, applied to a cache that exists to escape it

**Pattern.** A module-wide LRU cap read inside `set()`.

**Mechanism.** The cap silently applied to the **dedicated** `live_prices.cache` — the instance
that exists specifically to escape LRU pressure.

**Why it survives review.** A default LRU cap is prudent, and the constant is one place. The
coupling to a purpose-built second cache is invisible at the constant's definition.

**Recorded instance.** Above ~970 distinct tickers that cache thrashed **permanently**:
**31.7 % miss / ~3.1 k upstream fetches per 2-second poll round at 200 users × 50 tickers**, and
**68.7 % / ~34 k at 200 × 250** — which funnels into `live_prices._MASSIVE_SEM` "*and reproduces
the launch-day 524 from a different direction*" (`api/services/cache.py:1-24`, D-05).

**Cost when it fired.** A second route to the site-wide outage of PERF-1.

**Structural fix.** Derive the bound from the domain instead of inheriting one:
`CACHE_MAX_SIZE = _universe_size() * 2 + 1000`, reading `cap_universe.json`, **floored at 4000 so
a truncated file cannot silently shrink the cache back into the thrash regime**
(`api/routers/live_prices.py:33-107`). ⭐ And the reasoning worth stealing: two whole-market close
maps are held as **module state, not cache entries**, because "*two LRU slots holding ~24 k rows
would be a size-blind bound pretending to be a memory bound.*"

**Detector.** ⛔ **NO.** The miss-rate numbers exist because someone investigated an outage, not
because anything watches them.

#### PERF-3 — An aggregation endpoint that serialises a client-side transform verbatim

**Pattern.** Moving a browser-side data shaping step to the server and returning its output.

**Mechanism.** The client transform was written for a structure held in memory. Serialising it
sends every intermediate. ⭐ **And an aggregation endpoint inherits the slowest panel** — its
latency is the max of its constituents, and its failure mode is all-or-nothing.

**Why it survives review.** "Do it once on the server instead of N times in the browser" is the
correct instinct for almost every other case.

**Recorded instance.** `/api/flow/aggregate` serialises `processFlowData` verbatim at **23.83 MB**
(ARCH-07 §4 D5). Beside it: a per-symbol flow dump measured **3,651 KB gzipped / 20,252 KB decoded
/ 4,232 ms for one ticker**, and the 2026-07-25 cold Options Flow shell measured **12.7 MB /
2,583 ms + 486 ms parse (96,178 rows) + 1,420 ms process, then an identical delta, for
sidebar-click → data-ready of 9,505 ms** (D-05, citing `flowLoadPolicy.js:18-35`).

**Cost when it fired.** A 9.5-second cold load on a member-facing page, twice over.

**Structural fix.** ARCH-07's D5 ruling: **keep per-panel access; do not build a board-level
aggregation endpoint yet.** The aggregate shape is already measured as a hazard.

**Detector.** ⛔ **NO.** A payload-size budget in CI would be one. ⚠️ Related shipped hazard with
no detector either: `serve_csv()` at `api/main.py:9200` **carries no route decorator — it is dead
code**, while `/Darkpool-data.csv` and `/Indexes-data.csv` remain routed and **read the whole file
into memory per request** (D-05).

#### PERF-4 — A render loop that starves the router's transition commit

**Pattern.** A passive-effect update cycle that never throws.

**Mechanism.** ⛔ **React never raises "Maximum update depth" for a passive-effect loop.** It just
runs, at thousands of renders per second, starving React Router's transition commit — so the URL
changes and the screen does not. And the member is held on the exact page that is looping, which
is why it reads as app-wide.

**Why it survives review.** ⭐⭐ **Because everything that looks was green.** The six-shard gate:
1,261 files, 18,708 tests, 0 NEW failures. `/api/health`: 200 throughout. The first-hour watch:
**five clean samples while the defect was live**, because it polled the server and the server was
never unwell. "*A green suite, a 200 and a rising uptime are all compatible with a browser that
cannot change pages.*"

**Recorded instance.** 2026-09-10, after the 19:45 ET deploy of `80a520cb3`. Measured: Dashboard
rendered **0/sec**, the hub-owning `CatalystTable` **~4,500/sec**. The chain: `useHubCursor`
returned a fresh object every render → `catalystsSection`'s config memo was keyed on it →
`useHubMode` re-registered → `setPageModeConfig` changed the hub context value → the tile, a
context consumer *through* `useHubMode`, re-rendered. A second leg: `data?.rows || []`
manufactured a new array per render, so the loop began on first mount, **before the API had
answered at all.**

**Cost when it fired.** ⛔⛔ **Navigation frozen app-wide for ~4.5 hours, found by a member**, and
fixed by a different session. ⚰️ It was first filed as "*only when the catalysts API returns no
data*" — measured under the real provider, the tile never settled with a healthy payload, a 401, a
network error **or** a still-pending request. And `useHubMode`'s own docstring asserted that a
fresh config per render "*costs one setState … and correctness never depends on it.*" **It was the
loop.**

**Structural fix.** Four fixes, each mutation-proved by reverting exactly that fix. The
architectural one: **`useHubMode` reads a separate, never-changing registrar context, so
registering cannot re-render the registrant** — a per-render config is now wasteful, not fatal.

**Detector.** ✅ **YES NOW, and it did not exist then.**
`CatalystTable.renderLoop.test.jsx` renders the **real** tile under the **real** provider across
all four API states and asserts the render count stays bounded — "*the section's unit tests stub
the cursor and the Dashboard tests mock the tile, so neither could see it.*" Plus
`tools/hub_nav_smoke.py`, the client smoke that did not exist. ⭐ And **ESLint had already named
the second leg at HEAD** — "*the `allRows` logical expression could make the dependencies of
useMemo change on every render*" — in a file whose pre-existing `rules-of-hooks` errors made one
more red line invisible. "*A lint finding on a file you touch is a report, not noise.*"

#### PERF-5 — A leak masked by the deploy cadence

**Pattern.** Measuring memory over a window shorter than the leak's signal.

**Mechanism.** ⛔ A separate 5-sample read on a 5-minute-old pod was **flat-to-declining**
(1,980 → 1,905 MB). **A five-minute window cannot see this.**

**Why it survives review.** The short measurement is *correct*; it is just not a measurement of
the question. And the prerequisite the code itself names — distinguishing a leak from a large-but-
stable working set — reads like a research task rather than a blocker.

**Recorded instance.** ARCH-07 §2.2, Protocol F, **76 `[mem]` samples across 104 minutes**:
quartile medians 2,429 → 2,746 → 2,956 → 3,028 MB. **+599 MB over ~76 minutes = +7.9 MB/min,
monotonic across quartiles.** That **refutes D-05 §4.3's 2.2 MB/s by roughly seventeen times** and
**corroborates its 11,665 MB long-lived observation almost exactly** (7.9 × 1,440 ≈ 11.4 GB).

**Cost when it fired.** ⭐⭐ **The finding inverts an architectural argument.** Every prior document
scores deploy cadence as pure cost. Against +7.9 MB/min, a 26-minute median pod life is *also*
what keeps RSS near 2.4 GB instead of near 11 GB. So the leak must be fixed **before** anyone
argues for longer-lived pods — and ARCH-07 §5.1 blocks the "should Terminal-Next have its own
process" decision on it, because "*give the terminal its own long-lived process*" and "*the
long-lived process is the problem*" are the same sentence.

**Structural fix.** One held window with per-subsystem attribution, before a topology decision.
`/api/health/memory` exists (`?deep=1` for a GC type histogram and per-cache byte estimates;
`?trim=1` runs `malloc_trim(0)` and reports RSS either side — "*the one call that separates
'allocator is hoarding freed pages' from 'a C extension is genuinely holding this'*").

**Detector.** 🟡 **PARTIAL.** `_web_memwatch` logs `[mem] rss_mb=… threads=…` every 60 s.
**Nothing reads them on a schedule.** `n = 1` deployment, after the close, unattributed.

#### PERF-6 — A drop counter nobody reads

**Pattern.** Instrumenting loss and not watching the instrument.

**Mechanism.** ⭐ "*A quiet drop is worse than a crash*" [C7-01, citing NATS]. A crash is
reported; a drop is a smaller number.

**Why it survives review.** The counters exist, are correct, and are exposed on an admin endpoint.
Adding the counter *is* the observability work, in the reviewer's mental model.

**Recorded instance.** `bars_dropped_total`, `fh_budget_denied_total` and
`/api/admin/bars-stream-status` all exist. ⛔ "*Nothing reads them on a schedule*" (ARCH-07 Q10).
⚠️ And C7-01 §12 records the adjacent shape: the SSE dampers "*are opt-in*", so a
skipped-without-env rail reads as verified.

**Cost when it fired.** Not measured. The comparable cost is INST-3's: five subsystems failing
quietly by design, for weeks, invisible in the database.

**Structural fix.** Copy `desk_session_audit`: re-read the **artifact** on a schedule and name
what is missing — deliberately refusing to read an in-memory streak counter a redeploy resets.

**Detector.** ⛔ **NO.** Gate item 25 owns the design; ARCH-07's contribution is that the counters
exist and are currently unread.

---

### 2.7 Product and UX (repo-evidenced)

The competitor dossiers and the repo agree on this family more than on any other: **the defects
that reach a member are almost never the defects the tests are about.** §2.8 carries the
competitor-evidenced half.

#### PROD-1 — A dismissable control with no recovery path

**Pattern.** Shipping the off switch before the on switch.

**Mechanism.** The member takes an action that looks reversible and is not. ⭐⭐ **"A recorded
workaround is not a recovery path — it is a record of one being missing."**

**Why it survives review.** ⚰️ **The gap was known and written down, and that is what made it
survive.** `45-phase2.5-plan.md` carried a ⚠️ block instructing that both workarounds "*must be
documented for support*". **Writing the workaround down made the hole feel handled.**

**Recorded instance.** "Hide joystick" shipped writing `joystick_hub.enabled = false` while the
Settings toggle that turns it back on was scheduled for Phase 4. The two documented routes back
were *an admin editing `user_preferences`* and *the member pasting a `fetch()` into a devtools
console.*

**Cost when it fired.** **The owner hit it on the live admin preview, on production, as an
admin.** The toast read "Hidden. Re-enable in Settings soon" — "*honest, friendly, and describing
a screen that did not exist.*"

**Structural fix.** Three parts, and a persistent hide is only allowed to exist because part 2
sits beside it: (1) hiding from the sheet is **session-only and writes nothing**, so the
load-bearing test asserts **no write**, not that the hub vanished; (2) Settings → Joystick, pulled
forward from Phase 4, is the one control that writes a persistent hide — **and it must
`clearSessionOverride()` before writing**, or a member who session-hid then switched it ON sees
nothing happen; (3) a 12×36 px edge tab restores it for either kind of hide. ⭐ And the kill
switch removes the tab too, because "*a way back that outlives the kill switch is a live door into
a feature that is supposed to be gone.*"

**Detector.** ✅ **YES** — `hubHideRestore.test.jsx`, which asserts **no write** for the
session-only path and carries a **copy contract** section asserting rendered text (see PROD-2).

#### PROD-2 — Asserting user-facing feedback by state instead of by rendered text

**Pattern.** Testing that the message was set.

**Mechanism.** A test asserting `setToastMsg` was called "*proves nothing about whether a human
ever saw the sentence.*"

**Why it survives review.** The state transition is the thing the developer wrote, so it is the
thing they assert. And it is correct.

**Recorded instance.** Two toast defects in the joystick hub, **every structural assertion green**:
(1) the toast was passed `message` where `JournalToast` reads `msg`, so the component rendered `''`;
(2) both toasts were owned by the element their own action **unmounts** — "Hide joystick" lives in
the Actions sheet inside `HubShell`, and firing it unmounts `HubShell`; tapping the restore tab
unmounts the hidden branch. **Each message was destroyed in the same commit that set it and
rendered for zero frames.**

**Cost when it fired.** "*In both cases the state transition was correct, the control worked, and
the only broken part was the half that talks to the member.*"

**Structural fix.** Assert rendered DOM text after the triggering action settles. ⭐ And the
**structural corollary**, which is the reusable part: **a toast/banner/confirmation host must
OUTLIVE the control that fires it.** `HubRoot.jsx::HubToastHost` is the pattern — one element
above the visible/hidden branch, written to by both sides, with one fixed anchor so the message
lands in the same place either way.

**Detector.** ✅ **YES** — the copy-contract test shape, owner-ruled 2026-09-09.

#### PROD-3 — PRESENT is not SHOWING

**Pattern.** Checking that an element is in the DOM and calling it visible.

**Mechanism.** A `querySelector` presence check answers "did React render the container", never
"can the member see it."

**Why it survives review.** The selector is right, the element is right, and the check is the one
every test harness makes.

**Recorded instance.** `HubRoot.jsx` keeps `<div data-testid="hub-root">` in the DOM and sets the
HTML `hidden` attribute. ⚠️ And the obvious repair is also wrong: `offsetParent === null` is not
the signal either, because the hub is `position: fixed` — "*that is null while it is plainly on
screen.*"

**Cost when it fired.** ⛔ **The touch smoke pass published a product defect that did not exist** —
it reported a break in the chart shell's landscape-immersive mode, on the strength of a presence
check.

**Structural fix.** Measure the `hidden` attribute, the computed `display`, **and** a non-zero box
— "*and keep a fixture that must read SHOWING or the checker passes by answering 'no' to
everything.*"

**Detector.** ✅ **YES** — the three-way measurement plus the must-read-SHOWING fixture. ⭐ Its
generalisation is a standing lesson in its own right: **"did it render" needs the product's own
answer** — a canvas pixel count can only say yes.

#### PROD-4 — Collapsing three outcomes into two

**Pattern.** Rendering "we failed to retrieve" as "there is nothing."

**Mechanism.** Three outcomes are distinct facts to a trader: *we retrieved and it says X*, *we
retrieved and there is genuinely nothing*, *we failed to retrieve*. ⭐ **Collapsing the third into
the second is a lie a member will act on.**

**Why it survives review.** `.catch(() => null)` is the single most-approved line in front-end
code. It prevents a crash, it is one token, and the resulting UI reads as a calm empty state.

**Recorded instance.** ⚰️ **The idiom rendered "No recent news for this ticker." against NVDA
while the endpoint returned 15 KB of headlines** [ARCH-05 §4.3, citing D-12 §6]. ⛔
`sectionFetch.js` is the fix **and D-12 names six sibling call sites that never migrated.**

**Cost when it fired.** A member told there was no news about the most-traded stock on the tape.
The generalised cost is measured elsewhere on the real universe: the naive coverage formula returns
`answered = 0, not_computable = 2615` because `rs_rank` is NULL in every screener row on that box,
and **rendering that as "0 matches" is a lie a member would act on** — "*a screen that silently
loses symbols returns fewer hits and looks like a quiet market.*"

**Structural fix.** `CoverageLine`'s **four** counts — evaluated · answered · dropped · not
computable — with `withheld` **beside** them, never inside. ⛔ Do not collapse them to make the
line shorter. And when `answered === 0` with anything not-computable, it says "*that is a gap in
what we hold, not a quiet market*" **in those words, above the counts.** ⭐ The component also
**refuses to present a receipt whose arithmetic does not close**, mirroring
`scan_evaluator._assert_coverage_closes`, which refuses to write one.

**Detector.** 🟡 **PARTIAL.** `CoverageLine`'s arithmetic refusal and
`_assert_coverage_closes` detect an inconsistent receipt. ⛔ **Nothing detects the six un-migrated
`.catch(() => null)` sites**, which is a named, open, member-facing exposure.

#### PROD-5 — A refusal that overwrites a specific reason with a generic one

**Pattern.** Deriving a refusal message unconditionally.

**Mechanism.** The derivation is correct for the case it was written for and wrong for every other
case, and it runs last.

**Why it survives review.** "Never let a model author its own refusal reason" is a *correct and
important* rule. Applying it unconditionally is the bug, and the bug looks like rigour.

**Recorded instance.** `derive_refusal_reason`'s first version overwrote every refusal, so **a
cost-budget refusal ("usage limit") became "nothing was retrieved" — "*telling a member there's no
data when the truth is the service stopped spending*"** [ARCH-05 §4.3, citing I1-SPEC Part 3].

**Cost when it fired.** A member shown a data-availability claim that was a billing state. The
same defect class as PROD-4, one layer up.

**Structural fix.** ⛔ **Enrich a refusal that says nothing; never overwrite one that already says
something specific.** `_result` (`ticker_explain.py:2121`) calls the derivation **as a fallback
only**. And the positive half is worth carrying whole: five coerced response states defined once
(`_RESPONSE_STATES:1186`), a closed member-facing vocabulary (`_DOMAIN_LABEL:2074`), a **blocking**
grounding gate over the **union of every model-authored free-text field**
(`_full_answer_text:1973` → `_grounding_flags:1988`) — because "*a fabricated number hidden in
`caveat`/`clarification_question`/`refusal_reason` must be caught exactly like one in `summary`.*"

**Detector.** ✅ **YES** — the recorded regression plus the fallback-only call site, and an
AST-based boundary rail (`i1S8Boundary.test.js`). ⭐ That rail's own header is the best sentence in
this library: "*The fix was a paragraph in an architecture document. **A paragraph cannot fail, so
it is not a boundary.***"

#### PROD-6 — A contract carried in prose, and a spec's `file:line` decaying in two days

**Pattern.** Writing the invariant down instead of deriving it.

**Mechanism.** Prose cannot fail. A rail can.

**Why it survives review.** The prose is *excellent* — precise, cited, and correct on the day it
is written. ARCH-05 is explicit: "*nothing is wrong with the spec.*"

**Recorded instance.** The I1 spec was written 2026-09-23 against the `s7-price-level` worktree.
By 2026-09-25, **seven of its nine cited line numbers had moved**: `_build_evidence` `:1017 →
:1031`, `_RESPONSE_STATES` `:1172 → :1186`, `_decisive_language_flags` `:1567 → :1581`,
`_full_answer_text` `:1959 → :1973`, `_grounding_flags` `:1974 → :1988`, `_DOMAIN_LABEL` `:2060 →
:2074`, `derive_refusal_reason` `:2076 → :2090`. Two held.

**Cost when it fired.** Not yet — the drift was caught by the next reader. ⚠️ **This document
inherits the decay at one further remove**, which is why its evidence ceiling says so.

**Structural fix.** ⛔ **The contract is RAILED, not DOCUMENTED.** `i1S8Boundary.test.js` parses
an **AST**, never a grep, and **derives its forbidden vocabulary from S8's own component names**,
so a fifth provenance primitive is guarded the day it lands. ⭐ "*Extend that rail's roots; do not
write this section again.*"

**Detector.** ✅ **YES** — the AST rail. ⛔ And the *general* detector does not exist: nothing
sweeps the programme's documents for `file:line` citations that no longer resolve. That would be a
high-value, low-cost tool for this programme specifically.

---

### 2.8 Product, commercial and trust — from the competitor corpus

⭐ **The dossiers turn out to carry this material pre-written.** Twelve of the fifteen files have an
explicit `## N. Bad ideas for UCT (avoid, and why)` section, and `bloomberg/dossier.md` §N is a
**13-row table (N1–N13)**. The corpus's own most-corroborated finding is PROD-C1. ⚠️ **Every entry
in this family reached this document through a delegated read, not by opening the dossier** — see
the evidence ceiling.

#### PROD-C1 — A hard cap with no meter

**Pattern.** Enforcing a consumption limit the member cannot see.

**Mechanism.** A cap the user cannot read converts a cost control into a mystery outage. The only
feedback is a broken cell, so the user cannot distinguish *"I hit a limit"* from *"your product is
broken"* from *"the market is quiet."* ⭐ `bloomberg/07-collaboration-export-api.md` § *Topic 6 —
Download limits: the meter, and the deliberate absence of a gauge* states the rule literally in its
own RECOMMENDATION: **"Never ship a hard cap without a meter."** Carried as **M5** in
`bloomberg/dossier.md` §M, described there as *"the corpus's strongest, most-corroborated
anti-pattern-as-lesson"*, and as *"a hard cap with no gauge"* in §J.2.

**Why it survives review.** The cap is a *cost* decision made by a commercial function, and the
gauge is a *product* decision nobody is assigned. And the enforcement works perfectly.

**Recorded instance.** Bloomberg's data-download limits attach to **the terminal, not the
account**, "cannot be reset", and are *"strictly enforced by Bloomberg, and its staff will not
reset the limit under any circumstances"*. *"There is no way of knowing whether the monthly data
limit has been reached until it has been exceeded."* It surfaces as a **cell value** — `#N/A Limit`
/ `#N/A Dly Lmt` / `#N/A Mth Lmt`; the API equivalent is a typed `ResponseError` category `LIMIT`
with `DAILY_LIMIT_REACHED`, `MONTHLY_LIMIT_REACHED`, `MANUALLY_DISABLED`,
`FREE_TRIAL_TERM_LIMIT_REACHED`.

**Cost when it fired.** ⛔ **The numbers are unpublished by design, and the circulating figures
contradict each other** — 2,500 vs 5,000–7,000 unique identifiers/month vs 500,000 hits/day; the
only corroborated figure in the corpus is **3,500 concurrent real-time security subscriptions per
terminal**. Blast radius, recorded: **one student can exhaust a department's month.** ⭐ And the
second-order cost is the more instructive one: **the workaround becomes the documented best
practice.** Bloomberg's own ecosystem advice is *"Use the Worksheet (`W<GO>`)… this is like a
spreadsheet but without download limits"*, and `02-monitors-workspaces.md` §10 records the
consequence in five words — ***"a picture is free, a number is metered"***, because screenshots are
untracked against the quota. *"That is a policy expressed as a UI."*

**Structural fix.** Two shipped shapes, both in the corpus. **Publish the cap** —
`spotgamma/dossier.md` §G's RECOMMENDATION is exactly that, and the product states *"HIRO, Tape,
and TRACE are limited to two instances per Workspace."* Or **meter with a forecast** —
`alphasense/dossier.md` §L and §M's M8: AI consumption in **credits**, with an admin **Credit Usage
Dashboard** carrying consumption %, count, pacing against remaining contract time, **a forecast
line for early exhaustion**, per-user consumption, and a **Credit Usage API**. Credits reset at
contract renewal, not monthly.

**Detector.** 🟡 **PARTIAL, and the gap is ours.** The detector is that a member can read their own
consumption — a product feature, not a test. ⛔⛔ **Terminal-Next is directly exposed:** ARCH-05
§0(3) measures the per-user AI caps already in code summing to **~$610–650/member/month** against a
$200 list price, and R-18 records that *"Compass chat has no population-level cap"*. **None of
those caps is member-visible.** ARCH-05's constraint 15 names the missing half: *"a refusal names
who spent the money"* — distinguish "you reached your allowance" from "the desk's budget is spent
today". The mechanism exists (`may_member_spend`); the gauge does not.

#### PROD-C2 — Capping to zero at a tier without saying why, in the same place

**Pattern.** Rendering a disabled capability as the number `0`.

**Mechanism.** "Watchlist alerts: 0" is indistinguishable from a broken feature. The user cannot
tell a business decision from a bug — and will file it as a bug.

**Why it survives review.** A tier matrix with a zero in it is internally consistent and legible to
the person who built it.

**Recorded instance.** `tradingview/dossier.md` §N item 6, evidenced in §L: watchlist alerts are
**0 on Essential ($12.95), 0 on Plus ($29.95), 2 on Premium ($59.95), 15 on Ultimate ($199.95)**.

**Cost when it fired.** Not measured directly. ⛔ The compounding cost in the same product *is*
measured: per-exchange real-time add-ons at **NASDAQ $3.00 non-pro / $27.00 pro**, **NYSE $3.00 /
$48.00**, NYSE Arca $3.00/$25.00, OTC Markets $3.00/$50.00, a **US bundle at $9.95 that is
unavailable to professionals**, and a full range of **$0–$548/month** — so *"a user on a $199.95
plan can still not see a real-time print"*, and entitlement must be resolved **before** a price is
visible (§N item 3).

**Structural fix.** A stated reason beside every zero, in the same surface as the zero. Never a
licensing quiz in front of a chart.

**Detector.** ⛔ **NO.** A rail asserting every `0` in a capability matrix carries a non-empty
reason string would be one, and is cheap.

#### PROD-C3 — Two persistence contracts in one product

**Pattern.** Auto-saving some of a member's work and requiring an explicit save for the rest.

**Mechanism.** The member cannot hold one mental model of when their work is safe.
`koyfin/dossier.md` §J's weaknesses list calls it ***"a trust bug wearing a convenience
costume"***, and once a member has lost work once, the auto-saving half stops being trusted too.

**Why it survives review.** Each half is correct and each was shipped by a different feature team
at a different time. Nobody owns "the persistence contract" as an artifact.

**Recorded instance.** Koyfin watchlist columns *"automatically save"*, while Financial Analysis
templates emphatically do not — *"make sure you **save** it since it isn't saved automatically"*
(§J weaknesses, repeated as §N item 2). And the harder version:
`benzinga-pro/dossier.md` §N item 1 (⛔-prefixed), evidenced in §G — *"Layouts persist to **browser
cache**, with **manual** save-to-server as the cross-device path"*, with the dossier's own verdict
that *"its persistence layer is the weakest part of the product."*

**Cost when it fired.** Different computer or cleared storage = lost desk. C5-01 §7 failure 1
carries the same finding independently: *"clear the cache, lose the desk."*

**Structural fix.** One contract, stated. ⭐ If two are unavoidable, **publish which is which** —
`lseg-workspace/dossier.md` §M item 3's idea generalises: ship a **per-surface capability matrix as
a product artefact.**

**Detector.** ⛔ **NO.** ⚠️ **And UCT already has this defect in the shape D-11 describes:**
drawings and `uct.watchlist.cols` are **device-local** while `tracings_doc` **syncs**, and D-11 §4.1
records that boundary as *"an accident of implementation order, not a decision."* C5-03 §8
explicitly declines to rule on it.

#### PROD-C4 — An unrecoverable close beside a fully-restored sibling

**Pattern.** Restoring one kind of state across sessions and discarding another, with no undo.

**Mechanism.** ⭐ Asymmetric recovery ***"teaches users to fear the close button"*** — and a
member who fears the close button stops composing, which is the whole value of a composable board.

**Why it survives review.** The restored half is a *feature*, shipped and celebrated. The
unrestored half is an absence.

**Recorded instance.** `bloomberg/01-search-navigation.md` §1: window layout survives logout, but
*"**You cannot restore a tab after you close it**."* Carried into `bloomberg/dossier.md` §J.2 as
*"Unrecoverable closes."*

**Cost when it fired.** ⭐⭐ **The strongest available indirect evidence that members destroy their
own work is that Bloomberg productised the recovery.** `MNRS <GO>` keeps **up to ten previous
versions** of a monitor, and Bloomberg's own guide names both triggers: *"If you **delete a monitor
accidentally** or **make a change to a monitor that you would like to undo**."* Three separate
recovery affordances exist around that one feature (a default-view setting, a recent-views list,
and `MNRS`). `02-monitors-workspaces.md` §6/§9 draws the conclusion: ***"Products do not ship undo
for things that never go wrong."***

**Structural fix.** A version history on the workspace document, not a confirm dialog. ⭐⭐ **This
is PROD-1 and STATE-2 arriving from the competitive side, and it is the single best external
argument for C5-03's commitment 2** — a versioned document is what makes an undo possible at all.

**Detector.** ⛔ **NO general detector.** The productised answer *is* the detector: if a member can
restore version N−1, the class is closed.

#### PROD-C5 — A published number with no derivation, and a hit rate with no base rate

**Pattern.** Shipping a score, a rank or a success rate without the method, the window or the
null model.

**Mechanism.** A derived score with no published derivation is DOC-2 pointed at a member: a second
authority over a value **nobody can audit**. And a hit rate without its base rate is not weak
evidence — it is **no evidence**, because the comparison that would make it mean something is the
one omitted.

**Why it survives review.** The number is real, computed correctly, and impressive. Review asks
"is 83% right?" and not "83% of what, against what?"

**Recorded instance.** `spotgamma/dossier.md` §J weaknesses and §N item 1: *"The Call Wall has held
in **83%** of daily trading sessions"*; *"The Put Wall has held in **89%**."* ⛔ **No sample
window, no definition of "held", no comparison to an arbitrary nearby strike.** The dossier's
reading is the decisive one: *"Any strike near the money 'holds' on a large fraction of days;
without the base rate… those figures describe the market's daily range distribution as much as the
level's predictive power."* And `benzinga-pro/dossier.md` §F + §N item 5: `sentiment` and
`aggressor_ind` ship in the options-activity payload with **no documented methodology**, and a
"0-100 Proprietary Ranking System" is described only by its five input **names**. Bloomberg's own
version, §11 of `05-fundamentals-valuation.md`, is worse because it is trusted: Damodaran — *"stay
away from the computational data provided by Bloomberg… the WACC and Dividend discount model
valuations that they provide are not very useful"* — and a Bloomberg-distributed paper whose
authors *"do our own calculation for WACC instead of using the default settings."*

**Cost when it fired.** ⚰️ The measured cost is a trader acting on an untraceable number. A
20-year Bloomberg practitioner, verified: *"I had to reverse engineer the 1980s style ASW screen
and replicate it, bugs and all… a buggy LIBOR interpolation rule that persisted until ASW got
replaced around 2010. **Yet traders would take ASW as gospel.** I spent many evenings hand-marking
dozens of Bloomberg screen prints to satisfy Accounting that my calculations were right."*
⭐ **A trusted surface with an untraceable number becomes consensus.**

**Structural fix.** Three mitigations the Bloomberg section identifies as what makes a computed
number survivable: **(a)** overridable **in place**, **(b)** inputs visible, **(c)** the tool does
not claim the output is the answer. Plus `bloomberg/04-earnings-estimates.md` §5's *"near-free
provenance upgrade"* (**M8**): publish **an N and a contributor** beside a consensus figure.

**Detector.** 🟡 **PARTIAL and buildable.** A rail asserting that every member-facing score
carries a non-null method link, sample window and base rate is cheap and does not exist. ⛔⛔
**Terminal-Next exposure is broad and specific:** UCT ships a **0–150 UCT Exposure Rating** (with
bonus tiers +10/+25/+50 to a ceiling of 150), a **0–110 seven-criteria candle score**, a **0–100
process score** across five 0–20 dimensions, and `grade_ticker`'s **A–F grade** driving a
GO/HOLD/SKIP verdict. ⭐ The repo already holds the matching lesson independently
(`lesson_a_hit_rate_is_meaningless_without_its_base_rate`), which is the strongest possible signal
that this entry is real.

#### PROD-C6 — Summing signals that answer different questions into one score

**Pattern.** Blending distinct measurements into a single composite, then ranking on it.

**Mechanism.** ⭐ The corpus's framing is precise: a composite score *"operates on the **output**,
whereas Bloomberg's operates on the **surfaces**."* Once blended, a member cannot ask which input
moved, and neither can you.

**Why it survives review.** One number is easier to sort, easier to display and easier to explain
than three. The blend is the *product decision*, so review is about the weights, not about whether
to blend.

**Recorded instance.** `bloomberg/03-news-alerts.md` §7: Bloomberg keeps **editorial rank, tag
relevancy score and read-attention as three separate surfaces** and deliberately does not blend
them.

**Cost when it fired.** ⛔⛔ **The dossier flags the contrast against a shipped UCT design, and the
criticism lands.** The catalyst engine composites
`gap_pct + log(vol_x)*15 + tweets*5 + rss*8 + earnings_reported*20 + scanner_setup*12 +
sector_momentum*5 − penny_penalty` and then applies a **forced 10/5/3/2 category quota** — a blend
plus an output-side correction. ⭐ And the repo independently holds the counter-principle, in the
safety-critical place: `portfolio_heat.py` keeps risk-heat and notional exposure as **two metrics
NEVER blended**, because blending them would hide a placeholder-stop under-report.

**Structural fix.** Separate surfaces; blend only where a decision genuinely needs one number, and
say which inputs moved. `ai_search`/`CoverageLine`'s four-count idiom is the same instinct applied
to a receipt.

**Detector.** ⛔ **NO.**

#### PROD-C7 — "Some of this is live and some is delayed", without saying which

**Pattern.** Disclosing a mixed freshness or a proxy substitution in a FAQ rather than beside the
number.

**Mechanism.** It makes **every** displayed price conditionally untrustworthy **with no way to
resolve the condition.** `koyfin/dossier.md` §F calls it *"a genuine trust defect worth studying as
an anti-pattern"* and §J names the sentence *"the most damaging sentence in Koyfin's
documentation."*

**Why it survives review.** The disclosure exists. Legal is satisfied, the FAQ is accurate, and
nobody reads it.

**Recorded instance.** Koyfin's FAQ: the product shows *"a combination of live data and 15-minute
delayed data"*, **with no per-name indicator in the UI** (§F, §J, §N item 8). And the sharper one,
§N item 7: Koyfin's live **SPX/NDX/DJI are CFD prices** and differ from the official index — the
substitution is disclosed in an FAQ, **not on the number.** ⭐ The dossier's rule is the one to
adopt verbatim: ***"If UCT ever renders a proxy, the proxy's name belongs beside the value."***

**Cost when it fired.** Not measured. ⭐ **Two counter-patterns in the same corpus are measured and
are the fix.** `spotgamma/dossier.md` §M item 5 — **a two-speed data contract stated out loud**,
because *"it prevents the worst failure mode: a member trading a stale level believing it is
fresh."* And `unusual-whales/dossier.md` §F — **degrade by freshness, not by feature**: free flow is
15 minutes delayed with price data for JPM/INTC/IWM/XSP only, and every *derived* surface is 2 days
delayed.

**Structural fix.** One shell-level freshness authority, and a per-value as-of that the member can
see.

**Detector.** 🟡 **PARTIAL.** The primitives exist —
`app/src/components/provenance/FreshnessBadge.jsx` + `freshnessContract.js` + `sessionStale.js`
(ARCH-05 §1.6). ⛔ **Nothing asserts that every panel uses them**, and ARCH-07 Q3 leaves the
freshness contract **OPEN**, noting that the shipped mechanism is a good *per-chart* contract and
"*not a board contract*" — and that Chrome's intensive throttling (once per minute past five
minutes hidden, timers and fetch callbacks frozen) means **any tick-derived freshness indicator is
wrong exactly when it matters.**

#### PROD-C8 — An AI answer that cannot be traced to a sentence, and "no hallucinations" as a claim

**Pattern.** Shipping a generated summary whose claims have no addressable source, and marketing
the absence of a failure mode.

**Mechanism.** ⭐ *"A summary that reads as authoritative and cannot be traced becomes
consensus"* — the same mechanism as PROD-C5, at generation speed. And "no hallucinations" is
unfalsifiable, so the first counterexample costs more trust than the claim ever bought.

**Why it survives review.** The summaries are *good*. And the marketing claim is written by a
function that does not own the help centre, which is why the two disagree.

**Recorded instance.** `alphasense/dossier.md` §I flags it explicitly as
*"**ANTI-PATTERN, flagged here rather than in N because it is an AI claim**"* and repeats it as §N
item N1: the homepage promises *"sentence-level citations with **no hallucinations**"* while the
help centre promises only that the system *"will say so instead of fabricating."* ⭐⭐ **"The help
centre is the honest one."** Adjacent instances: `factset/dossier.md` §N item 3 — liability-correct
hedging (*"may contain inaccuracies, including those unique to generative artificial
intelligence"*) which the dossier calls *"decision-fatal"* for a desk; §N item 7 — **twelve**
separately-branded assistants (Mercury, Portfolio, Transcript, Draft, Topic, Theme Intelligence,
Search Intelligence, Slide, Template, Security Explanation, Signals, Agent Hub); and
`benzinga-pro/dossier.md` §I — Benzinga AI gates the **Essential** tier with **zero help-centre
articles out of a complete 119-article inventory**, grounding behaviour **NOT DETERMINED**, and
*"preserving transparency and trust"* recorded as *"a slogan, not a mechanism."*

**Cost when it fired.** ⚰️ The cleanest measured instance of ungrounded generated text reaching a
paying member: `unusual-whales/dossier.md` §I — the AAPL ticker page carried a **4:37 AM** item on
**three consecutive days at the same minute**: *"AAPL at $324.75 may break $325 Bollinger barrier
soon; MACD flat and open interest falling. A crucial 48 hours ahead."* A paying user, in the
vendor's own in-app chat: ***"paying thousands a year to get this, can't you guys license some
decent data?"*** Staff reply: *"understand the news leaves something to be desired. ill bump the
devs."*

**Structural fix.** Two mechanisms, both measured. **Index, do not replace** —
`bloomberg/04-earnings-estimates.md` §8, carried as **M9** and called *"the single strongest
transferable idea across two leaves"*: clicking a summary point **jumps to the corresponding
transcript excerpt** and links out to the underlying functions. And **highlight-to-verify** —
`alphasense/dossier.md` §I and §M's M2: select any sentence in a generated answer and the system
substantiates **that specific claim**. ⭐ *"It converts verification from a chore into a gesture."*

**Detector.** 🟡 **PARTIAL, and the gap is named.** UCT's producer side is strong — a blocking
grounding gate over the union of every model-authored free-text field, five coerced response
states, a derived refusal (see PROD-5). ⛔⛔ **ARCH-05 §0(2) states the gap exactly: grounding is
producer-side only, and that is the whole trust gap.** P5 — a machine-checkable citation pointer
per claim — is unshipped, and *"half of closing it is a wire format; the other half is a
data-modelling job no citation API will do — a computed number with no addressable row cannot be
cited by any mechanism in the field."*

#### PROD-C9 — Replacing a member's hand-built configuration with a generated one

**Pattern.** Letting an AI request overwrite state the member authored.

**Mechanism.** ⭐ *"A user who spent ten minutes on a screen and loses it to one prompt learns not
to use the prompt."* The feature teaches its own avoidance.

**Why it survives review.** "The AI sets the filters" is the feature statement. Overwriting is how
setting works.

**Recorded instance.** `tradingview/dossier.md` §N item 1 and §I, quoting TradingView's own
documentation: ***"Running an AI request replaces any manually set filters."*** No documented merge
and **no undo**.

**Cost when it fired.** Not measured. ⭐ **The positive half is in the same section and is the
fix:** the AI Screener emits an **editable configuration** plus an **Explanation panel** showing
every applied filter with its reasoning — ***"the artefact IS the citation."***

**Structural fix.** Stage beside; never overwrite. ⭐ **UCT already ships both halves of this, in
two places, and should not lose them:** the starter library ships the firm's setups as *"ordinary
definitions, editable on arrival (not a special read-only class)"*, and Compass's action tools use
**preview-confirm**, with an elevated-warning subtype for discipline mutations.

**Detector.** ✅ **YES-ish** — preview-confirm is the shipped pattern and is testable. Nothing
asserts that every generated mutation goes through it.

#### PROD-C10 — Onboarding as orientation, and a course as the answer to complexity

**Pattern.** Answering a learnability problem with training material.

**Mechanism.** ⭐ *"If a capability needs a course, the capability needs a redesign."* And with a
short trial, the first session has to produce **one useful saved artefact**, not a tour.

**Why it survives review.** A certification is a visible, fundable, measurable deliverable, and it
genuinely helps the users who complete it. It is also, in `alphasense/dossier.md` §N item N4's
words, *"the vendor's own admission that the product is not learnable by exploration"* — **a
warning marker, not a feature to copy.**

**Recorded instance.** **Five vendors independently**: AlphaDemics certification plus live training
plus a downloadable user guide (`alphasense` §N4, §J); an **LSEG Academy** with *"Become LSEG
Workspace certified"* (`lseg-workspace` §J); Bloomberg's **`BMC`, an 8-hour course covering 70+
functions across four modules**, plus `BCER` certificates and a claimed **~30,000 functions**
(`bloomberg/08-why-they-stay.md` §7/§9, `dossier.md` §J.5, **N1**); a *"Learning tab as the answer
to complexity"* (`factset` §N item 2); and a monthly *"An introduction to Quartr Pro"* webinar,
which the dossier calls *"a confession that the product does not teach itself"* (`quartr` §N item
7). ⛔ And the worst first-run in the corpus: `koyfin/dossier.md` §J and §N item 10 — the
getting-started article's **first instructions are to adjust browser zoom and enable dark mode**,
on a **7-day trial**, with no guided setup, no first-run template and no "tell us what you follow."

**Cost when it fired.** Bloomberg treats the learning curve as *"paradoxically an asset for
existing users"* by raising exit cost, and a former Bloomberg UX designer records what that bought:
*"In a couple cases we even ended up re-implementing UI **bugs** that one or more users had grown
accustomed to… but that came at the expense of a steep learning curve."* ⛔ The corpus's verdict:
**for a challenger, difficulty is pure churn** — raising exit cost by being hard to learn only
works if you already own the counterparty network.

**Structural fix.** ⭐⭐ **The corpus's preferred counter-pattern is directly actionable for
Terminal-Next's blank-canvas problem.** `bloomberg/02-monitors-workspaces.md` §7 names the
anti-pattern to avoid as *"a read-only 'demo' board or a guided tour"*, and ships instead
**pre-built, opinionated, editable desks segmented by what you trade** — *"the sample view is not a
read-only demo; it is a live view you immediately customise, which means the sample doubles as the
teaching artefact: you learn the model by taking one apart."* §6 of `06-screening-charting.md`
validates the same idiom structurally: Bloomberg's own example screens are addressed through **the
same API parameter** as a user's private screens, and `96 <GO>` edits an example's criteria in
place — ***"a new user's first screen is therefore a fork of an expert's, not a blank form."***

**Detector.** ⛔ **NO.** ⛔⛔ **And Terminal-Next's exposure is written into its own lock:** C5-01
§4 names the blank canvas as *"the known-hard problem"*, and C5-03 §2's option table records
hybrid's first-run as *"correct by construction, board starts seeded **or empty**"* — **the "or
empty" is the exposure**, and nothing has chosen.

⭐ **Also recorded from the corpus, compressed because each has one clear source and no measured
cost:** *don't let capability outrun findability* — TradingView's Chart help category's **largest
folder is "I can't find a certain feature or setting", 43 articles**, beside "Charts are not
saving/not syncing" (10) and "Why my color theme isn't getting saved?" (1)
[`tradingview/dossier.md` §J, §N item 2]; *don't make export a per-screen accident*, because "the
picture becomes the interchange format" [`bloomberg/07-collaboration-export-api.md` Topic 4]; *don't
let a licence constraint reach the member as an unexplained product limitation* — Fiscal.ai's
*"Due to licensing agreements… 20yrs of financial data is not available"* [`finchat` §N item 2],
and Koyfin's *"equities are currently restricted from download by our data vendor"*, read by its
dossier as ***"the vendor's contract is visible in the product's shape"*** [`koyfin` §F]; *don't
let one colour carry two meanings across surfaces* — red is "danger/negative gamma" in TRACE and
"below-average IV" (an opportunity) in the Fixed Strike Matrix, *"both documented, neither
reconciled"* [`spotgamma` §N item 2]; *don't emoji-load data semantics* — `Bid 🦴` / `Ask 🛍️` and
`🐂 %` / `🐻 %` as **column names**, which is *"a screen-reader and an internationalisation
problem, and it makes the filter set unsearchable by text"* [`unusual-whales` §N item N-4]; and
*don't let "beta" become a permanent permission-granting label* [`godel` §N item 1].

---

### 2.9 Process and concurrency

Nine entries. This family is why the programme's own findings are trustworthy at all.

#### PROC-1 — A test run without a totals line

**Pattern.** Reading the exit code of a test run.

**Mechanism.** The wrapper's status is uninformative **in both directions** — not merely
optimistic about startup.

**Why it survives review.** "Exit 0 means green" is true of well-behaved processes, and both
failures here were well-behaved processes reporting someone else's status.

**Recorded instance.** Two sightings, and the second **inverted the shape**. (1) A full-suite run
launched with an invalid `--minWorkers` flag: vitest died at argument parsing having executed
nothing, and the wrapper reported **exit 0** — "*nothing in the status distinguished '17,000 tests
passed' from 'the runner never started'.*" (2) 2026-09-13, the six-shard gate on the stage-2 merge
tip printed `GATE: 1 NEW failure(s) … exit 1` / `GATE EXIT: 1`, and the background-task
notification said **"completed (exit code 0)"**.

**Cost when it fired.** The first was caught only because the log had no `Test Files` / `Tests`
line; "*had that been trusted, a green gate would have been reported for a suite that never ran.*"
⛔ **Nobody may treat this as a solved trap.**

**Structural fix.** Assert the totals line **before** reading the exit code, and read the gate's
own `GATE EXIT:` line from the file. ⭐ **Corollary with its own measurement:** a chunked run must
be diffed against the full test-file list before its total is quoted — one gate's chunk list
covered **1,016 of 1,178 files**, missing a known baseline row, and "*a partial suite fails in the
flattering direction.*"

**Detector.** ✅ **YES** — the totals-line assertion plus `find src -name "*.test.js*" | wc -l`
against the chunks actually run.

#### PROC-2 — The pipe owns the exit code

**Pattern.** Verifying a runner through `| tail`, `| findstr`, `| head` or a trailing `echo`.

**Mechanism.** A pipeline's exit status is the **last** command's, and a filter that read some
text always succeeds. ⛔⛔ **The same is true of a semicolon** — `cmd; echo $?` *prints* the
runner's code and *exits* with the echo's, so a human reading the terminal sees the truth and
anything reading the process status sees a pass.

**Why it survives review.** The pipe is the famous case and people know it. The trailing `echo` is
the quiet one, and it was **the form this very section of CLAUDE.md used to recommend.**

**Recorded instance.** ⚰️ **Measured four times on the same tool.** 2026-09-10: three OOM-killed
pytest runs all read as clean because each was piped to `tail`. 2026-09-12: the same mistake hid a
lane that executed **one chunk of twelve** and then crashed — the reader saw `[exited with code
0]`. While building the fix, the verification command reproduced it a third time
(`python tools/pytest_chunks.py --out-dir . --only 1` exits **2** bare and **0** through
`| tail -1`). 2026-09-13, the fourth: a 12-chunk lane whose own log said
`VERDICT: FAIL — red chunks [1,2,4,5,6,7,8,9,10,11,12]` reported `exit code 0` to the session,
because `echo` was last.

**Cost when it fired.** Four masked failing runs, one of them an eleven-of-twelve-chunk failure
read as a pass. ⭐ "*A rule that fixes the pipe and leaves the semicolon has fixed the example, not
the defect.*"

**Structural fix.** Capture, print, then exit with it:
`cmd > run.log 2>&1; code=$?; echo "EXIT: $code"; exit $code`. ⚠️ In PowerShell, `$LASTEXITCODE`
is clobbered by the next native command — capture it on the very next line. A `VERDICT:` last line
in the runner is a **mitigation, not a fix**; the exit code is still gone.

**Detector.** ✅ **YES** — `tests/test_pytest_chunks_runner.py` carries a reproduction of **both**
maskings, "*so the next reader does not have to take either on trust.*"

#### PROC-3 — Chaining the verification into the commit

**Pattern.** `npx vitest run … ; git commit …` in one shell invocation.

**Mechanism.** The commit lands on a non-zero exit exactly as happily as on a zero one, and by the
time anyone reads the combined output the commit already exists.

**Why it survives review.** It looks like *more* rigour than committing without running the tests.

**Recorded instance.** 2026-09-10, the model's own slip an hour after writing the adjacent rule.
Adding a `@typedef` to `hub/contracts.js` broke `hub/phase3Contracts.test.jsx` — the rail that
pairs every Phase-3 typedef with a `validate*` export, on the grounds that "*a `@typedef` is a
comment; it enforces nothing.*" The run and the commit were one Bash call, so "*the failure
printed and the red commit landed in the same breath.*"

**Cost when it fired.** One red commit. ⭐ **"The mistake is not 'forgot to run the tests' — they
DID run. The output was right there. What failed is that nothing in the sequence could act on
it."**

**Structural fix.** Two calls, and the second only after reading the first. ⚠️ Same disease, one
level up: this is why `scripts/gate_shards.py` **refuses a dirty tree and records the tree hash at
start AND end** rather than trusting that the caller checked — "*a verification that cannot block
the thing it verifies is decoration.*"

**Detector.** ✅ **YES** — the dirty-tree refusal and the two-ended tree hash.

#### PROC-4 — Scoping each job does not bound the sum of the jobs

**Pattern.** Instructing every parallel worker to behave, and not bounding the aggregate.

**Mechanism.** Memory and account limits are properties of the **sum**.

**Why it survives review.** ⭐⭐ **"The 09-13 failure is the instructive one, because every
individual rule was followed."** Each agent was told to scope its pytest; none ran anything
reckless. The aggregate was never checked.

**Recorded instances.** 09-12: three concurrent gates plus an **unscoped** backend pytest on a
31.8 GB box — 11,854 MB RSS still climbing, free memory to 4.8 GB, `app/node_modules` swept to 2
entries then 0 then nonexistent **with no npm process running**, and the worktree's `.git` file
destroyed, so the tree stopped being a repository. 09-12: `--collect-only` alone, unscoped,
reached **6.6 GB** — so `-k` does not help, because collection is where the memory goes. 09-13:
**13 agents plus a 5-hour local whisper job** — the STT run was killed for low memory and the same
fan-out burned the account limit, with **7 of 12 agents dying mid-flight**, one of which had
committed nothing.

**Cost when it fired.** A destroyed worktree (recovered — commits live in the main repo's object
store), an unrecoverable-by-report lane whose work "*existed only in a dead worktree and had to be
salvaged and re-verified by hand*", and a lane that reported "done" carrying **5 failing tests it
never saw**. ⭐ And "*the evidence of an OOM sweep is that there is no evidence*" — no traceback,
no error, a suspiciously fast success line, an empty directory.

**Structural fix.** Three clauses that are one rule: cap concurrency at **3 agents plus the
integrator**; commit and push at **every** green checkpoint; and **the integrator runs the scoped
gate on every agent branch in its own session.** ⭐ "*A lane's self-report is evidence, never a
verdict … a gate run in a session you cannot see is a gate you did not run.*"

**Detector.** ✅ **YES** — "*before launching ANY agent, print free memory and the count of
running agents, and REFUSE the launch if the cap would be exceeded. A cap nobody measures against
is a preference.*" ⛔⛔ And the instrument matters: **`FreePhysicalMemory` is a proxy;
`Memory\Available MBytes` is the number** — WMI's free memory excludes the standby list, which
Windows reclaims on demand. Measured the same day: 4.44 GB "free" vs 4.53 GB available — close
*there*, because the standby list happened to be small, "*and that is exactly the kind of
agreement that teaches you to trust the wrong instrument.*"

#### PROC-5 — A session deleting what it did not create

**Pattern.** Cleaning up shared workspace.

**Mechanism.** A prune or a remove is indistinguishable from a tidy-up until it lands on someone
else's running work.

**Why it survives review.** Cleanup is virtuous, and a stale-looking worktree looks stale.

**Recorded instance.** 2026-09-12 ~16:12: `uct-worktrees\indicator-r0r1` had **every tracked file
deleted out from under a running 12-chunk pytest lane.** Established from the run's own logs, not
from timestamps — the runner enumerated 1,399 test files at start, chunk 1 then produced **332 ×
`ModuleNotFoundError: spec not found for the module 'api.services.crypto_box'`** (an
`importlib.reload` of a module whose source had gone from disk), and chunk 2 refused to start on a
path that no longer existed. Something wrote a fresh `.pytest_cache` into the emptied directory
**~45 s after that session's runner was already dead.**

**Cost when it fired.** ⭐ **Nothing was lost, and that is the only reason this is a rule rather
than an incident report** — every commit had been pushed and the branch was recreated from
`origin` byte-for-byte. ⛔ **What was NOT established, and is not guessed at: which process did
it.** Six Claude temp directories were live and four sibling worktrees were touched in the same
minutes.

**Structural fix.** `.uct-session-owner` at every worktree root, written at creation, naming the
session id and date. ⛔ **"No owner file is not permission"** — it means the worktree predates the
rule, and that is a stop-and-ask too. Move a damaged tree aside (`_dead-<name>-<date>`) rather
than deleting it: "*a post-mortem needs the body.*"

**Detector.** ✅ **YES-ish** — the owner file is a check a human or an agent must perform. Nothing
enforces it.

#### PROC-6 — Deleting a junction with a recursive command

**Pattern.** Removing a directory symlink the way you remove a directory.

**Mechanism.** `Remove-Item -Recurse`, `rm -rf` and `[IO.Directory]::Delete(path, true)` **follow**
the junction and delete the **target's** contents. `cmd /c rmdir` — **no `/s`** — removes the link
only.

**Why it survives review.** ⭐ **A junction and a real directory look identical in `ls`.** And
`cmd //c` through Git Bash mangles the path (`//c` → `/c`) and fails with *"The filename,
directory name, or volume label syntax is incorrect"* — "*which reads as a typo, so the next thing
tried is usually the PowerShell one that destroys the target.*"

**Recorded instance.** 2026-09-13. The warning existed and was followed in spirit, and a live
worktree's `node_modules` was emptied anyway — **368 packages gone, mid-programme.** ⛔ And the
false negative that made it look safe: `Get-Item` **without** `-Force` printed `is junction:
False` for a junction that had resolved **372 entries a minute earlier.**

**Cost when it fired.** 368 packages, recoverable by `npm ci` — "*but only on a quiet box, so the
damage is discovered at the worst possible moment.*"

**Structural fix.** `Get-Item <link> -Force | Select-Object LinkType, Target` before removing,
`cmd /c rmdir` to remove, and **verify the target, not the link**: `ls <existing>/app/node_modules
| wc -l` against the count you started with.

**Detector.** ✅ **YES** — the `-Force` read plus the post-hoc target count. ⛔ **Never conclude
"not a junction" from an unforced read.**

#### PROC-7 — Round-tripping a manifest through a serialiser

**Pattern.** `load → mutate → dump` to change part of a document.

**Mechanism.** The dump re-formats the whole file. The content is correct; the artifact is
destroyed.

**Why it survives review.** It is the obvious, safe, type-checked way to edit structured data, and
the result **parses**.

**Recorded instance.** Measured the day the rule was written: a script added **one** entry to
`closedTable.json` by `json.loads` → mutate → `json.dumps(indent=1)` and produced **3,272
insertions and 3,265 deletions for an eight-line addition.** Every line of a 3,277-line manifest
moved.

**Cost when it fired.** ⭐ "*Nothing was lost, and that is exactly the problem*" — an unreviewable
diff, `git blame` attributing the whole file to one commit, and a guaranteed whole-file conflict
for the next concurrent edit. ⚠️ "*It is not a style test. It exists because the failure is
invisible in review.*"

**Structural fix.** Insert the text at the right place, preserving the file's own formatting.

**Detector.** ✅ **YES** —
`app/src/components/chart/engine/ast/manifestFormatting.test.js`. Every manifest is exactly
`JSON.stringify(obj, null, 2)` once the hand-made blank separator lines are ignored, so a
re-serialisation at another indent, with ASCII escaping, or with reordered keys fails at once.
⭐ **The set under test is read from the directory, never typed**, so a manifest added next week is
guarded the day it lands — and it carries a control that re-serialises the real file and asserts
the check **sees** it.

#### PROC-8 — Writing a file with the endings on disk rather than the endings git stores

**Pattern.** `io.open(p, newline='')` round-trips, faithfully preserving whatever is on disk.

**Mechanism.** With `core.autocrlf=true`, what is on disk is not what git stores. ⛔ **The trap is
one-directional, and "never write CRLF" is the wrong lesson**: writing CRLF over an LF-stored file
is cleaned on the way in and `git diff` reports nothing. The direction that destroys a diff is a
**CRLF-stored or mixed blob flattened to LF.**

**Why it survives review.** `newline=''` is the *careful* choice — it is what you write
specifically to avoid mangling line endings.

**Recorded instance.** The same trap twice in one programme: a **2-line edit came back as a
918-line diff, and a 7-line edit as a 1,199-line one.** Both times the edit was correct and
unreviewable. Measured cause: 7 of 9,135 tracked blobs were committed CRLF, and
`docs/plans/joystick/deferred.md` is **mixed** — 87 CRLF lines among LF ones.

**Cost when it fired.** Two unreviewable diffs on correct work.

**Structural fix.** Write with the endings **git already stores** for that path; for a new file
that is LF. ⚠️ And `git show <sha>:<file>` is **not** how you read what endings a blob stores —
measured 2026-09-15, a helper deciding this by `git show` answered **LF** for five files
`git cat-file blob` shows are uniformly CRLF. The commit was correct **by luck** (`autocrlf`
supplied the CRLF at `git add`).

**Detector.** ✅ **YES** — `python tools/check_repo_hygiene.py`, with `--self-check` proving it can
fail, and `--staged` comparing the index blob so it works as a pre-commit hook. ⭐⭐ **And the
design detail is the most transferable thing in this entry: the gate compares CR-STRIPPED
content**, reporting a path only when endings are the *only* difference — because a bare CRLF ban
"*would go red on `deferred.md` the moment somebody edited it correctly, and a check that fires on
the right answer is muted within a week.*" Rails: 11 quiet cases beside 4 firing ones, an
exact-path allowlist check, and a **non-vacuity** case (the check walks CHANGED paths, so on a
clean tree it inspects nothing and a broken one is indistinguishable from a working one).

#### PROC-9 — A default argument bound at import defeats every monkeypatch

**Pattern.** `def f(..., thing_fn=real_function)`.

**Mechanism.** A parameter default is evaluated **once**, at module import, and captures the
original object forever. So `monkeypatch.setattr(module, "real_function", fake)` — what every
caller reasonably expects to work — **reaches nothing**, and the test silently exercises the real
function.

**Why it survives review.** ⭐ **It sat two lines from the correct form**, in the same signature:
`tree_state_fn=tree_state` and `file_count_fn=count_test_files` beside `run_shard_fn=None`. Two
conventions in one function, and the broken ones look like the tidier choice.

**Recorded instance.** 2026-09-17, and it had been eating runs for a day.
`test_the_wrapper_takes_and_RELEASES_the_lock_around_a_run` patches `gate_shards.tree_state` to
fake a dirty tree. With the patch inert it called the real one, found the tree clean, skipped the
refusal, and **ran a real six-shard gate inside a unit test** — real `npx vitest`, minutes of it,
against a 300 s ceiling.

**Cost when it fired.** ⭐⭐ **A day of runs, and four wrong diagnoses, because it looked like
flakiness.** It PASSED whenever the working tree happened to be dirty (the real `tree_state`
answered "dirty", the refusal fired, rc=2 in a second) and HUNG whenever it was clean. **Every
hang was immediately after a commit; every pass was mid-edit.** "*A test whose outcome depends on
`git status` is not flaky — it is reading the wrong thing, and from the outside those are
indistinguishable.*"

**Structural fix.** `thing_fn=None`, resolved in the body. ⛔ **And the rail must prove the patch
is CALLED, not just that the default is `None`** — a signature assertion alone passes if the body
ignores the parameter
(`test_the_injectable_seams_are_LATE_bound_so_a_module_patch_reaches_them`).

**Detector.** ✅ **YES** — the late-bind rail, plus an **AST class sweep over 364 files** in
`scripts/` and `tools/` that found **3** remaining (`deploy_watch.py:93`, `:99`,
`window_check.py:883`). ⭐ All three were left as-is **with the reason recorded** — none is
monkeypatched anywhere in `tests/`, so none is inert today — "*but any test that starts patching
`probe` or `mint_session_token` must late-bind the seam first.*" That is the right disposition:
named, not tidied.

---

## 3. The five most expensive, ranked by measured cost

| # | Entry | Measured cost | Measurement cited |
|---|---|---|---|
| **1** | **PERF-4** — a render loop starving the router's transition commit | **Navigation frozen app-wide for ~4.5 hours, found by a member**, against a green 18,708-test gate, a 200 `/api/health` throughout, and five clean watch samples taken while the defect was live | `_merge-master:CLAUDE.md`, "Registering a hub mode must never re-render the registrant" — Dashboard 0 renders/sec vs `CatalystTable` ~4,500/sec |
| **2** | **PERF-1 / PERF-2** — an unthrottled per-request DB write on the universal auth path, plus a size-blind cache bound reaching the same outage from the other side | **A bare 401 took 24 seconds**, site-wide, 2026-07-01. The second route: **31.7 % miss / ~3.1 k upstream fetches per 2 s poll round at 200×50**, 68.7 % / ~34 k at 200×250 | `_merge-master:CLAUDE.md`, "Performance & Scale — 2026-07-01 launch-hardening"; `api/services/cache.py:1-24` via D-05 |
| **3** | **GATE-7 / INST-1** — an auth auditor blind to GETs, and a probe that measured the gate | **Vendor real-time market data answering unauthenticated GETs** (R-17, CONFIRMED 2026-09-02, H/H), with **six route families still dependency-less** in the 2026-09-25 source read — and the paired misreading pointed at a change that could have re-served **3.07 MB of the firm's paid options tape** from the edge | `RISK_REGISTER.md` R-17; ARCH-06 §0(2) and `auth_surface_check.py:79,:248`; ARCH-07 §1.5 and `flow_router.py:17-20` |
| **4** | **PROC-4 / PROC-2** — aggregate resource limits, and the pipe owning the exit code | **11,854 MB RSS climbing, `app/node_modules` swept to 0 entries, a worktree's `.git` file destroyed**; and **four separately measured masked failing runs**, one of them 11 of 12 chunks red reported as exit 0 | `_merge-master:CLAUDE.md`, "THREE CONCURRENT SESSIONS OOM-SWEPT THIS BOX" and "NEVER VERIFY A RUNNER THROUGH A PIPE" |
| **5** | **PERF-3** — an aggregation endpoint serialising a client transform | **23.83 MB** on `/api/flow/aggregate`; and on the member's clock, **sidebar click → data ready 9,505 ms** (12.7 MB / 2,583 ms + 486 ms parse of 96,178 rows + 1,420 ms process, then an identical delta) | ARCH-07 §4 D5; D-05 citing `flowLoadPolicy.js:18-35` |

⚠️ **PERF-5's +7.9 MB/min leak is deliberately not on this list.** It is the largest *number* in
the record and its cost has never been paid, because a 26-minute median pod life keeps collecting
it. That is the finding, not an omission.

⛔ **And §2.8's costs are deliberately excluded, because they are other firms' costs.** The largest
of them would otherwise place: PROD-C1's blast radius — *"one student can exhaust a department's
month"*, against a cap whose figures *"are unpublished by design"* and whose circulating values
contradict each other — is a bigger measured cost than rows 3–5 here. It is on the exposure list
(§4 row 13) rather than this one because nothing in UCT has paid it yet, and the point of §4 is
that UCT's AI caps are currently the same shape.

---

## 4. Anti-patterns Terminal-Next is currently exposed to

Each row names the **specific design decision in an accepted or drafted programme document** that
creates the exposure. ⚠️ Where I am inferring rather than citing, the row says INFERRED.

| # | Entry | The decision that exposes it | Status |
|---|---|---|---|
| 1 | **DOC-1** | Terminal-Next is specified as a **panel registry plus a panel contract**, and C5-03 §4's commitment 1 is that "*the number of registry entries must stop being the bound on what the board can hold*" — so the registry will be written about constantly. The programme has already committed DOC-1 twice in `MASTER_CHECKLIST.md` (row 3, self-documented; row 20, **live right now**) | ⛔ **ACTIVE** |
| 2 | **DOC-4 / DOC-5** | `MASTER_CHECKLIST.md` row 20 still asserts "*there are currently zero per-widget error boundaries*" as a precondition of the hybrid lock. C5-03 §6 **corrected that against shipped code on 2026-09-25** — `ErrorBoundary` wraps `WidgetBody` at `WidgetHost.jsx:107-111`, the header renders **outside and before** it at `:227`/`:254`, and `PANEL_MOUNT_CAP = 3` at `ChartsWorkspace.jsx:84`, all in `424bf3355`, an ancestor of `origin/production`. And this research worktree's `CLAUDE.md` is eight recorded facts behind master's | ⛔ **ACTIVE, both** |
| 3 | **STATE-1, 2, 3, 4, 5, 6** | C5-03 §5 locks "one versioned document, and NOT in `user_preferences`" **as a sequence**: stamp a version on the existing blob now, build the new store for Terminal-Next. The bridge is cheap and the destination is not, and §5.2 names the failure directly: "*anyone who ships step 1 and stops has left the board on a store whose own repo documents why it is wrong for this*" | ⛔ **ACTIVE** — six of seven measured workspace failure modes are in this family |
| 4 | **INST-4** | D-05 §8's warm-ratio gate is the programme's only executed performance gate and a healthy system scores **0 %** on it. CARD 16's replacement (p95 ≤ 250 ms) is specified and **no p95 is computed for any surface** | 🟡 **MITIGATED IN PRINCIPLE, unmeasurable in practice** |
| 5 | **GATE-7** | ARCH-06 is the entitlement architecture, and the one instrument that audits the auth surface cannot see a GET. R-17 is deliberately **not** reported closed, and six families remain dependency-less in source | ⛔ **ACTIVE, highest severity** |
| 6 | **PERF-6 / INST-3** | ARCH-07 Q10: `bars_dropped_total`, `fh_budget_denied_total` and `/api/admin/bars-stream-status` exist and **nothing reads them on a schedule**; `_web_memwatch` logs `[mem]` every 60 s and nothing reads those either. Gate item 25 will be specified on top of this | ⛔ **ACTIVE** |
| 7 | **STATE-7** | ARCH-07 Q8 answers the multi-instance trigger and states the shape: every hub and budget is per-process **by design**, and they are correctness guards, so "*a second instance silently doubles each bound rather than degrading gracefully*". The trigger currently lives in a comment | 🟡 **NAMED, not detected** |
| 8 | **PERF-3** | ARCH-07's D5 ruling explicitly declines a board-level aggregation endpoint. ⚠️ **INFERRED exposure:** a board of N panels is the single most natural place for someone to propose one, and the ruling is in a draft document rather than a rail | 🟡 **RULED AGAINST, undetected** |
| 9 | **PROD-4** | D-12 names **six sibling `.catch(() => null)` call sites that never migrated** to `sectionFetch.js`. Any Terminal-Next panel that can render "we hold nothing" inherits them | ⛔ **ACTIVE** |
| 10 | **PROD-6 / DOC-1** | ARCH-05 §4.2's first requirement is a *derived* rail rather than a documented one, precisely because seven of nine spec citations moved in two days. ⚠️ **INFERRED:** three of the four gate-item drafts written in the last 48 hours (this one included) carry dozens of `file:line` citations and none is railed | ⛔ **ACTIVE** |
| 11 | **DOC-2** | ARCH-05 §3.1: **four of six model-price tables are still wrong**, and the one that never drifted is the one with a rail. A Terminal-Next AI panel adds a seventh lane | ⛔ **ACTIVE** |
| 12 | **INST-9 / PROC-4** | ARCH-07 §2.5: fourteen deploys in six and a half hours, median pod life 26 minutes, roughly half of them the measuring session's own. Every capacity, memory and latency number Terminal-Next needs has to be taken in that environment | ⛔ **ACTIVE, and it is a scheduling decision nobody has made** |
| 13 | **PROD-C1** | ARCH-05 §0(3): the per-user AI caps already in code sum to **~$610–650/member/month** against a $200 list price, and R-18 records Compass chat as having **no population-level cap**. **None of those caps is member-visible**, and ARCH-05 constraint 15's "a refusal names who spent the money" is 🟡 — the mechanism exists, the gauge does not | ⛔ **ACTIVE** |
| 14 | **PROD-C5 / PROD-C6** | UCT ships a **0–150** Exposure Rating with +10/+25/+50 bonus tiers, a **0–110** candle score, a **0–100** five-dimension process score, and `grade_ticker`'s A–F grade driving GO/HOLD/SKIP — plus a catalyst composite (`gap + log(vol)*15 + tweets*5 + rss*8 + earnings*20 + setup*12 + sector*5 − penny`) with a forced 10/5/3/2 quota on its output. **No base rate, sample window or method link is required beside any of them** | ⛔ **ACTIVE** — and both halves of the evidence base name it independently |
| 15 | **PROD-C7** | ARCH-07 Q3 leaves the freshness contract **OPEN** and requires one shell-level authority; the shipped mechanism is a per-chart hysteresis pair explicitly "*not a board contract*"; and Chrome's intensive throttling makes any tick-derived indicator wrong exactly when it matters. The `provenance/FreshnessBadge.jsx` primitive exists and **nothing asserts a panel uses it** | ⛔ **ACTIVE** |
| 16 | **PROD-C8** | ARCH-05 §0(2): grounding is **producer-side only**, and P5 — a machine-checkable citation pointer per claim — is the whole trust gap. Half of closing it is a wire format; the other half is a data-modelling job, because *"a computed number with no addressable row cannot be cited by any mechanism in the field"* | ⛔ **ACTIVE, and half of it is not a shipping problem** |
| 17 | **PROD-C10 / PROD-C4** | C5-01 §4 names the blank canvas as *"the known-hard problem"* and C5-03 §2 records hybrid's first-run as *"seeded **or empty**"* — **nothing has chosen**. And no workspace version history exists (STATE-1), so there is no undo to productise | ⛔ **ACTIVE, and it is one decision** |

⭐ **My judgement on which of these actually bites first:** row 2. Not because it is the most
severe — row 5 is — but because it is the only one that is **already false in a control document
that other agents read as authoritative**, and the programme's own dispatch pattern is to hand an
agent a checklist row as its brief.

---

## 5. ⛔ What this document does NOT decide

1. **Which anti-patterns Terminal-Next's design must be gated on.** This is a library, not a gate.
   Selecting a blocking subset is gate item 13's closure, and it needs the owner.
2. **Any fix.** Every "structural fix" field describes the fix the *recorded incident* adopted. No
   entry authorises work.
3. **Whether R-17 is closed.** ARCH-06 owns that and explicitly declines to close it; nothing here
   changes its status.
4. **The panel count, the freshness contract, the process topology or the conflation rate.**
   ARCH-07 §6 owns all four and leaves them open.
5. **Whether the `user_preferences` → own-store migration happens before or after ARCH-02.**
   C5-03 §5.2 sequences it; this document only records the failure mode of stopping halfway.
6. **The competitive product ranking.** Items 9 and 10 (capability matrix, best-of-breed) own that;
   this document uses the dossiers only as anti-pattern evidence.
7. **Anything about the running service.** Nothing was probed. Every source claim is a claim about
   a worktree at a date.
8. **Whether the stale worktree `CLAUDE.md` (DOC-5) should be deleted, symlinked or stamped.**
   That is an owner call about tooling, and deleting a file another session may be reading is
   PROC-5.

---

## 6. Appendix — suspected, unevidenced

⚠️ **These have no recorded instance in the artifacts read, so they are not in the library.** They
are listed so that a future reader can promote one if an incident arrives, and so that nobody
mistakes their absence for a judgement that they are safe.

1. **Alert fatigue as a member-facing failure.** The repo records the *mechanism* twice — the grace
   window that prevents an alert firing on every healthy case, and "*muted inside a week*" — but no
   member-facing alert-volume incident. ⭐ The corpus supplies the **counter**-pattern rather than
   the incident: `benzinga-pro/dossier.md` §J/§M publishes its cooldowns (price spikes *"fire at
   most once every 10 minutes for a given symbol"*, thresholds scaling with average range, a Series
   variant requiring **≥3 highs within 2s then 1s of quiet**), and
   `bloomberg/03-news-alerts.md` §6 shows **stories per hour for the current filter, at authoring
   time**, "*so the user can see whether a search is survivable before saving it*" — and publishes
   **its own noise list** of ~13 low-signal topic codes to exclude. Promotable the moment an
   incident exists.
2. **Keyboard-first command grammar as a retention property.**
   `06-ux-and-information-architecture/command-grammars.md` exists and was not read by this
   document. ⭐ Adjacent negative evidence does exist and is worth a look: SpotGamma has *"no
   command palette, no global search, no keyboard shortcut documented anywhere in the help centre,
   across all sixteen categories"*, Fiscal.ai has none either with the cost named (*"power-user
   velocity has no ceiling-raiser"*), and **three years of LSEG release notes surface exactly three
   keyboard shortcuts, all FX dealing.**
3. **Per-seat licensing punishing collaboration.** Documented across three vendors (Bloomberg's
   trial licence *"for the User's individual use only and on one Receiving Device"*; TradingView
   *"per-seat, not per-firm… nothing on the pricing page describes team, enterprise or firm
   licensing"*; SpotGamma two consumer tiers, no enterprise) but **no incident and no UCT
   exposure** — UCT has 26 production members and no seat model. ⭐ The one shipped mitigation
   worth remembering: `bloomberg/07-collaboration-export-api.md` Topic 8 — `LOGU`/`LOGR`, a
   **logged, sanctioned hand-over**, with the recommendation *"sanction and instrument the
   workaround rather than prohibiting it."*
4. **A board that cannot be shared or exported.** C5-01 §7 failure 5 (discoverability decay) is
   adjacent and is itself 🟡 — "*inferred from three vendors independently building mitigations,
   not from a study.*"
5. **Mobile parity as an anti-pattern rather than a gap.** C5-03 §8 explicitly declines a mobile
   workspace model, and the registry admits five types on `menus.mobile`. No incident. ⭐ And the
   corpus argues parity is the wrong goal: Bloomberg, with vastly more resources, explicitly did
   **not** chase it — mobile ships chat + worksheets + news + a conversational front door and does
   not port the workspace, because *"on a phone, a professional workstation should aim to be
   reachable and monitorable, with a conversational front door — not operable."* Measured
   asymmetry from the same class: LSEG streams **2,500 RICs on desktop and 1,000 per browser tab.**

---

## GAPS

- ⛔⛔ **THE LARGEST GAP: no dossier file was opened by this document.** §2.8 is entirely
  second-hand. The directory was listed, not rostered — `adjacent-notes`, `alphasense`,
  `benzinga-pro`, `bloomberg` (+ nine leaves), `desk-tools` × 4, `factset`, `finchat`, `godel`
  (+ 3), `koyfin`, `lseg-workspace`, `quartr`, `spotgamma`, `tradingview`, `unusual-whales`,
  `benchmark-universe.md` — and a **delegated agent** read all fifteen and returned §N section
  names, line numbers and verbatim quotes, which this document then wrote up. ⭐ **So every §2.8
  citation is an agent's reading of a dossier's reading of a vendor's page**, three removes from
  the vendor, and the dossier line numbers are as that agent read them on 2026-09-25. A verifier
  pass should re-quote §2.8's load-bearing figures (the Bloomberg download-limit text, SpotGamma's
  83%/89%, TradingView's *"Running an AI request replaces any manually set filters"*, the Koyfin
  mixed-freshness sentence, the Unusual Whales 4:37 AM item) directly from the files.
- ⚠️ **Nine of the fifteen dossiers were not mined for their `## GAPS` or `## P. Confidence`
  sections**, which the delegated read flags as *"where 'we could not verify the thing that
  matters' is recorded — the most honest material in the corpus."* That is the richest remaining
  seam and it is untouched.
- **`bloomberg/09-multi-asset-analytics.md`, `bloomberg/dossier.md` §M in full, and
  `godel/01-evidence.md`/`02-verification.md` were not reached**, nor were the three
  `adjacent-notes` §N sections beyond their headline items.
- **`11-risks-and-open-questions/` is empty** but for `.gitkeep`. It was listed, not assumed. So
  nothing was inherited from it and the RISK_REGISTER in `00-program-control/` was used instead.
- **Not one `file:line` here was opened by this document.** Every one is carried from an artifact
  that measured it at a stated date or SHA. Given PROD-6's own finding — seven of nine citations
  moving in two days — **assume every address below is approximate and re-derive before
  depending on one.**
- **No SHA is pinned** (no git by instruction), so this document cannot state its own inputs'
  provenance the way ARCH-05 does (`3b4140d46`) or ARCH-06 does (deliberately, as a ceiling).
- **The costs are other documents' measurements.** Nothing was re-measured. Where a cost is
  `n = 1` — the +7.9 MB/min leak, the 82–119 s deploy blip — the entry says so.
- **Three entries have no incident of their own and lean on a class:** STATE-5, REACH-5 and
  PROD-6's general form. They are retained because the class has an incident; a reader wanting a
  per-entry incident will not find one.
- **`command-grammars.md`, `information-architecture.md`, `personalization-patterns.md`,
  `data-architecture.md` and `licensing-register.md` were not read.** Each is 48–176 KB and each
  probably carries anti-patterns this document does not have. In particular
  `licensing-register.md` §3B/§4.4 is ARCH-06's input and almost certainly holds
  redistribution-shaped product anti-patterns.
- **No detector was run.** Every "Detector: YES" is a claim that a named rail exists in a cited
  artifact, never that it currently passes.

---

## SOURCES

**Primary, and by a wide margin the richest:**
`C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md` — 5,823 lines, cited by section heading
throughout for the reason given in §1. Sections drawn on: "Nav Tabs (left sidebar)" · "⚰️
DOCUMENTED BUT UNREACHABLE" · "Charts Hub V2" (widget types) · "Bars Push Feed — Phase C" (the
single-writer index) · "Theme Tracker Page — Taxonomy Redesign" · "Setup Library" · "Project
Overview" (the service roster) · "`C:\data` IS REAL ON THIS BOX" · "Sandbox boots — the 2026-09-08
incident" · "A dismissable control needs a recovery path IN THE SAME COMMIT" · "Assert user-facing
feedback by RENDERED TEXT" · "Registering a hub mode must never re-render the registrant" · "A
test run without a totals line" · "NEVER VERIFY A RUNNER THROUGH A PIPE" · "Run the suite in its
OWN tool call" · "An empty result is a failed invocation until proven otherwise" · "SAMPLING WHERE
A WAITER WAS AVAILABLE" · "A TIMEOUT HANDLER THAT DISCARDS ITS OUTPUT" · "A GLOBAL PROCESS COUNT
IS NOT A MEASUREMENT OF *YOUR* RUN" · "A MEASUREMENT THAT TAKES LONGER THAN THE GAP BETWEEN
DISTURBANCES" · "TWO INSTRUMENTS AGREEING IS EVIDENCE ABOUT THEIR SHARED INPUT" · "A GUARD ON THE
INCOMING RECORD" · "KIND 3 — a TRUE record standing in for a LIVE obligation" · "A measured fact
cites its artifact (R-CITE / R-RAW / R-HON)" · "A citation you cannot quote is struck" · "Write a
file with the line endings GIT ALREADY STORES" · "A MANIFEST IS EDITED AS TEXT" · "A DEFAULT
ARGUMENT IS BOUND AT IMPORT" · "WORKTREE OWNERSHIP" · "A FRESH WORKTREE, AND THE JUNCTION THAT
DELETED A LIVE `node_modules`" · "RESOURCE RULES" · "THREE CONCURRENT SESSIONS OOM-SWEPT THIS BOX"
· "Deploy windows" · "H14" · "H15" · "Performance & Scale — 2026-07-01 launch-hardening" · "The
Desk — … session pipeline audit" · "Phase E" · "Live-row drill-down" · "Fundamentals Accuracy
Monitor".

**Programme artifacts:**
`00-program-control/MASTER_CHECKLIST.md` (rows 3, 11, 20, 22, 23, 24) ·
`00-program-control/RISK_REGISTER.md` (R-17, R-18, R-19) ·
`06-ux-and-information-architecture/fixed-modular-hybrid.md` (C5-03 §0, §3, §5, §6, §7, §8) ·
`06-ux-and-information-architecture/workspace-systems-survey.md` (C5-01 §7 in full, §8) ·
`07-technical-architecture/current-performance-and-realtime.md` (D-05 §4.3, §8, the cache/LRU
evidence block, the flow-payload table) ·
`07-technical-architecture/domain-streaming-caching.md` (C7-01 §12 D1–D10, and the "quiet drop is
worse than a crash" citation at `:200`, `:496`, `:536`, `:876`) ·
`07-technical-architecture/realtime-performance-architecture.md` (ARCH-07 §0, §1.1–§1.5, §2.1–§2.5,
Q1–Q10, §4, §5, §6, GAPS) ·
`09-security-licensing-cost/security-entitlement-architecture.md` (ARCH-06 frontmatter ceiling,
§0(1)(2)(3), §1.1) ·
`08-ai/ai-architecture.md` (ARCH-05 §0, §1.1, §1.6, §3, §3.1, §4.1, §4.2, §4.3) ·
`11-risks-and-open-questions/` (listed; empty).

**Competitor corpus — `03-competitive-research/`, read by a delegated agent on 2026-09-25, not by
this document (see the evidence ceiling).** Directory listed, not rostered. The load-bearing
sections, with the headings as reported:
`bloomberg/07-collaboration-export-api.md` § *Topic 4* (export as a per-screen accident), § *Topic
6 — Download limits: the meter, and the deliberate absence of a gauge* (PROD-C1), § *Topic 2* (the
network effect), § *Topic 10* (mobile) ·
`bloomberg/08-why-they-stay.md` § *4. Trust … plus its dark twin* (the ASW quote), § *7. What they
hate — and why they stay anyway*, § *9. Anti-patterns to carry into TERMINAL-NEXT* ·
`bloomberg/02-monitors-workspaces.md` § *6. Persistence* and § *7. Templates and sharing* (`MNRS`,
Sample Views), § *9. What breaks*, § *10* ("a picture is free, a number is metered") ·
`bloomberg/01-search-navigation.md` § *1* (the unrecoverable close) ·
`bloomberg/03-news-alerts.md` § *6. Noise control is a first-class workflow* and § *7.
Prioritisation and dedupe* (PROD-C6) ·
`bloomberg/04-earnings-estimates.md` § *5. Provenance*, § *8*, § *11. Two loose ends*, § *12* ·
`bloomberg/05-fundamentals-valuation.md` § *11. Anti-pattern: opinionated computed outputs* ·
`bloomberg/06-screening-charting.md` § *1. EQS*, § *2*, § *3. BQL*, § *4. Charting* ·
`bloomberg/dossier.md` § *N — Bad ideas / anti-patterns for UCT* (the 13-row table N1–N13), §M
(M5, M8, M9, M10, M15), §J.2/J.4/J.5, §L ·
`alphasense/dossier.md` §I (the flagged AI claim), §J, §L, §M (M2, M8), §N (N1–N7) ·
`benzinga-pro/dossier.md` §F, §G, §I, §J, §L, §M, §N (nine ⛔-prefixed items) ·
`koyfin/dossier.md` §F, §H, §I, §J, §L, §N (ten items) ·
`tradingview/dossier.md` §I, §J, §L, §N (seven items) ·
`spotgamma/dossier.md` §G, §H, §I, §J, §K, §L, §M, §N (eight items), §GAPS ·
`unusual-whales/dossier.md` §F, §I, §J, §L, §N (N-1…N-7) ·
`finchat/dossier.md` §C, §F, §G, §I, §J, §L, §N (eight items) ·
`factset/dossier.md` §L, §N (seven items) and its `ANTI-PATTERN TO NOTE` ·
`lseg-workspace/dossier.md` §C.4/C.5, §J, §K, §L, §M, §N (seven items) ·
`quartr/dossier.md` §I, §M, §N (nine items) ·
`godel/dossier.md` § *Section M*, § *Section N* (seven items) ·
`adjacent-notes/dossier.md` §N × 3 (TIKR, YCharts, S&P CIQ Pro) ·
`desk-tools/finviz.md` §1–2, §5, §7 · `desk-tools/thinkorswim.md` §0, §3, §4 ·
`desk-tools/tradingview-desk-use.md` §6, §7 · `desk-tools/market-chameleon.md` § *OBSERVATION 3* ·
`benchmark-universe.md` § *Part 2 — Redundancy analysis*, § *Part 4*, the Gödel
`⚠️ EVIDENCE-HYGIENE WARNING`, §GAPS.

**Also second-hand via C5-01 §7** — Bloomberg `MNRS` (B-BBG-02 §5c), Bloomberg's three
discoverability mechanisms (§4, T2), Benzinga Pro's browser-cache layouts and four-tool cap
(B-BZ §G), and the seven-library persistence survey (C5-01 §8).

**New measurement taken by this document:**
a two-copy comparison of `CLAUDE.md` between `C:\Users\Patrick\uct-worktrees\terminal-research\`
and `C:\Users\Patrick\uct-worktrees\_merge-master\`, both read 2026-09-26, eight divergences
tabulated in DOC-5. Re-runnable: read both files and diff the ⚰️-marked claims.

**Provenance.** SHA not pinned (no git by instruction). No network request, no test run, no
script executed, no production call, no Railway command.
