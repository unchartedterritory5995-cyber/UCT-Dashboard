# Session report — 2026-09-14, session 2

**REPORT FILES · MANIFEST ROWS 11-12 · CI DIAGNOSED · D4 FILED**

---

## 1 · ET and trees

Start **2026-09-14 23:44 EDT Mon**, end **2026-09-15 00:04 EDT Tue**, both
`python tools/weekly_exec.py et`. ⚠️ **The clock rolled over mid-session.** This file keys to
the START date so it sorts beside session 1; the rollover is stated rather than hidden,
because a report filed under a date the session did not begin on is how a timeline drifts.

Both worktrees `git status --porcelain` → **0** at start and end. **5 commits**, all docs
worktree, none pushed, nothing signed, nothing merged.

## 2 · P.1 — the standing rule has its first artifact

`docs/terminal-research/reports/SESSION_REPORT_2026-09-14_1.md`, committed `7ad7d1917`.

It is the previous report **as delivered**, extracted verbatim from the transcript (assistant
message at line 26354, 7,710 chars), not re-composed. ⭐ **A report rewritten after the fact is
a different artifact wearing the same name**, and the whole point of the rule is to preserve
what was actually said. It carries 11 numbered sections plus `STATUS: RAN` — preserved as-is
rather than "corrected" to twelve.

One claim in it is now known false; it is corrected in the file's header, **not edited in the
body**.

## 3 · C2 — why `ci-results` was missing, and the answer is none of the four

**It exists now.** A background poller left running by the previous session found it at
`5b36957e7`, and run #2 completed **success** at `03:49:41Z`.

| candidate cause | verdict | evidence |
|---|---|---|
| PUSH-NOT-LANDED | **no** | `origin/feat/s7-price-level` = `e767a7aab` |
| WORKFLOW-DID-NOT-TRIGGER | **no** | run #2 exists on that sha, `event: push` |
| PUBLISH-JOB-SKIPPED | **no** | it ran, and pushed the branch |
| TOKEN-READ-ONLY | **no** | the write succeeded |
| **the job had never run** | ⭐ **YES** | run #1's commit contained **zero** `publish:`; run #2 was still `in_progress` at every check |

Run #1 fired against `af9fe21a6`, which predates the publish job. Run #2 is the first run
carrying it and took **23 minutes** (vitest alone: 1,020 s). Every check fell inside that
window. **Nothing was broken, and no owner action is needed.**

⛔ **TOKEN-READ-ONLY was my leading hypothesis and it was wrong.** The four local
`permissions:` facts from C2.1 were all correct and all irrelevant — they describe what the
workflow *asks for*, and none can distinguish "refused" from "not yet reached." ⭐ **A question
that names its own candidate answers gets answered from inside that list.** The true cause was
the option not offered, and it was found by reading the run's job list rather than re-reading
the config.

## 4 · F-CI-2 — CI was readable without auth the whole time

The previous session filed CI **UNREADABLE**, and that verdict reached a report, the briefing,
the workflow's stated motive, and `ci_summarize.py`'s docstring.

**The repository is PUBLIC. `api.github.com` answers anonymously.**

```
GET /repos/unchartedterritory5995-cyber/UCT-Dashboard   -> 200
GET .../actions/workflows/full-suite-report.yml/runs     -> full run records
GET .../actions/runs/<id>/jobs                           -> per-job status
```

No `gh`, no token, no PAT, no browser.

⭐ **The error, stated so it is recognisable: "I lack the tool I reached for" was treated as
"the thing cannot be read."** `gh` was absent and the MCP server had no token, and an
UNREADABLE verdict was written from those two facts. **Nobody tried the unauthenticated
path** — against a repo whose public status is already in user memory
(`lesson_a_public_repo_cannot_prove_authentication`: *a public repo answers anonymously*). The
instrument was chosen before the question was asked.

⛔ **E CP2 is still worth having — re-justified, not quietly kept.** It is no longer the only
way to read a result; it is the **durable** way. Actions logs age out, the API needs network
and is rate-limited, and `results/latest.json` is a committed artifact a session can diff.

## 5 · The first full-suite CI record — RED

| suite | collected | passed | failed | skipped | wall | ok |
|---|---|---|---|---|---|---|
| vitest | **19,898** | 19,862 | **21** | 15 | 1,020 s | `false` |
| pytest | **2** | 0 | 0 | 2 | 82.7 s | `false` |

21 vitest failures across **14 files** — the first full-suite measurement this programme has
had (CI previously ran **28 of 2,782** files).

⛔ **pytest DID NOT RUN: `2 skipped, 8 warnings, 479 errors in 82.68s`.** It collected **2**.
That is a COLLECTION failure, and it is exactly what `ci_summarize.py` refuses to call green —
`collected == 0` sets `ok: false`. **A suite reporting `0 failed` because it never collected is
the most flattering possible lie.** Cause not diagnosed; filed, not fixed.

⚠️ **F-CI-3 — `oom_or_timeout: true` on both suites is an INSTRUMENT DEFECT, not a finding.**
The regex matches the *word* "timeout" anywhere in the log. Both suites completed with totals
lines; neither was killed. **A flag that fires on the word rather than the event gets muted
within a week.** `vitest.runner_line` also came back empty. Both recorded, neither repaired —
**repairing an instrument in the same breath as reading its first result destroys the only
measurement it has produced.**

## 6 · M2 — rows 11 and 12, and two checkpoint-id collisions

**Two id collisions in two consecutive units.** Both found by one `grep` against the packet's
own checkpoint table, before any code; both would have been invisible afterwards, because the
manifest row would have looked perfectly well-formed.

| commissioned as | already meant | built as |
|---|---|---|
| **E CP2** | packet E's CP2 = *promote to a required check (NOT BUILT)* | CP2 = the publish job; **promotion renumbered to CP3** |
| **K CP2** | packet K's CP2 = `merge_all.py` itself, built, manifest row 7 | **K CP3** |

⭐ **When two names collide, renumber the side nothing has bound yet.** E's promotion checkpoint
has no commit and no ledger row; the publish job's id is fixed in an immutable pushed commit
message. Renumbering the built side would have left the packet permanently disagreeing with
the record.

⛔ **The pattern, since it happened twice:** checkpoint ids are being assigned in the prompt
that commissions the work and verified against the packet only if somebody thinks to look.
**Read the packet's checkpoint table and take the next free number before writing a line.**

**Row 11** — `e-cp2-build-record.md` | CP2 | `00eecb391`. packet-e's fingerprint moves
`c90ad04d2` → `beeffe8e6`; **approval-block lines changed: 0** — category (d) re-numbering,
which the manifest header already declares refreshable.

**Row 12** — `k-cp3-build-record.md` | CP3 | `ba5e34e79`. packet-k **untouched** (the B→V
precedent: a later checkpoint gets its own document and the relation is recorded in the
manifest, rather than churning a settled fingerprint).

## 7 · K CP3 — the merge order is enforced, not trusted

`UNITS` in `merge_all.py` was a hand-typed ordered list beside a manifest that stated the same
order in three English sentences nothing could check — **this programme's oldest recurring
defect** (the writer-index `FOUR`, the COT router's *"4 routes"*, the setup catalog's *"24"*).

The manifest now carries `#!after:` / `#!last:` directives. They begin with `#`, so
`verify_manifest`'s three-column parser skips them and **the manifest stays one file with one
authority**. `merge_all` derives the graph and checks `UNITS` **before the first cherry-pick** —
exit 2 naming the pair and both positions. Checking afterwards would be a post-mortem.

**Seven controls pass** (`--self-check`). Three are load-bearing:

- ⛔ the constraint **count is printed** and asserted non-zero — *"0 violations"* over 0
  constraints is not a pass;
- ⛔ a constraint naming an unknown unit is **REFUSED, not skipped** — a typo would otherwise
  silently disable the constraint it was meant to add and go green **because** it was broken;
- ⛔ the violation message **names both units**; a bare *"order violation"* sends the reader
  back to diff two lists by hand.

Also fixed a crash this unit's own dry-run exposed: a Windows console encodes stdout as cp1252
and the file prints box-drawing glyphs, so `merge_all` died with `UnicodeEncodeError` on the
first unit it announced — after the order check, before any cherry-pick. It fails safe, but the
traceback reads as a logic fault. Same family as `flag_ledger_audit.py`'s cp1252 bug, output side.

## 8 · F-MERGE-1 — two commits no unit claims

`verify_manifest.py --check-commits` walks `git log origin/master..feat/s7-price-level` and
fails on any commit no unit claims. It reads `merge_all`'s **own** `UNITS` rather than keeping
a second copy, and **prints the branch commit count** — a walk that found nothing reports
"0 unreferenced" and looks identical to full coverage. Zero commits walked is UNREADABLE
(exit 2), never a pass.

**First run, and not vacuous — 11 of 13 mapped, exit 1:**

```
⛔ UNREFERENCED: 31e28c6e3  A' — F-A-1: the caller-level guard for F-S7-TICK-1
⛔ UNREFERENCED: 18dd13683  Packet A A.1/A.2 — absent-bound roster
```

Both are Packet A, whose gate document is titled **CLOSED AS FINDING** and carries **no
approval block at all** — `sign_gate` refuses it: *"no UNSIGNED `APPROVED AT SHA:` line"*. So
the branch carries a closed **finding** that nonetheless shipped two commits, and the machinery
only knows how to handle signable **gates**.

⛔ **NOT REGISTERED, deliberately.** Adding Packet A to `UNITS` would put two commits into the
merge sequence that no approval covers — and because `is_signed()` returns `True` for a
document with no unsigned block, they would sail through unchallenged. **That is an owner
decision, not a gap to close by typing two lines into a list.**

## 9 · Q.1 — F-D4-1 filed, with the collision proof

D4 CP4's assertion presumes `fundamentals::{TICKER}::{period}` and calls the unit a rename.
Decomposed into nouns and resolved by command, **two of three do not resolve**:

| noun | resolved | verdict |
|---|---|---|
| `earnings_table` key | `f"earnings_table::{ticker}"` — **two segments** (`:586`, `:693`; invalidations `:655`, `:671`) | exists, different shape |
| `{period}` | nowhere in the family's key construction | ⛔ **UNRESOLVABLE** |
| `fundamentals` key | `fundamentals.py` builds **no cache key in this family at all** | ⛔ **UNRESOLVABLE** |

**The collision proof.** `fundamentals_monitor.py:486` recovers the ticker with
`k.split("::", 1)[1].upper()`. On a three-segment key that is **`"AAPL::Q1"`**, not `"AAPL"` —
so the monitor would not merely miss entries, it would **manufacture malformed ticker strings**
and feed them to `check_ticker`, whose failures then read as data defects. ⭐ **The instrument
would report a property of the key FORMAT as a property of the DATA.** On the serve path the
same change splits one live cache entry into two and leaves the existing invalidation sites
stale by construction.

The original is **struck through in place**, with **CP4′ PROPOSED** beneath it and explicitly
not approved. ⚠️ Stated rather than hidden: the comment-strip pass changed nothing here (raw
and code-only counts identical, 4/4 and 1/1), so **the strip proves nothing on these files** —
the finding rests on reading the assignment sites and the parse.

## 10 · Q.2 — noun table for the next unit (D5 CP2), and it does not fully resolve

> **D5 CP2, verbatim:** *"The ledger, INERT. `corp_actions.db` + its one self-declaring
> `CREATE TABLE` literal + the D2 builder extension that derives its five metrics by AST.
> Written by nothing, read by nothing; the derivation rail and the axis report extended to the
> new store."*

| noun | resolved by command | verdict |
|---|---|---|
| the D2 builder | `tools/build_canonical_address_book.py` | ✅ exists |
| the axis report | `canonical_address_book.json["axis_report"]`, railed at `tests/test_canonical_address_book.py:201` | ✅ exists |
| the derivation rail | `tests/test_canonical_address_book.py` (12 tests) | ✅ exists |
| `api/data/canonical_address_book.json` | present, `stores`/`axes`/`metrics` blocks | ✅ exists |
| `api/services/{bars_*,entity_master}` | both present | ✅ exists |
| `corp_actions.db` + its `CREATE TABLE` | new; shape pinned in canonical SPEC §2.1/§2.2 | ✅ declared |
| **"its five metrics"** | **never enumerated for `corp_actions` anywhere** | ⛔ **UNRESOLVED** |

**D2's "five" is `ohlcv.o/h/l/c/v`** — the *bars* metrics, confirmed in the book. No five-item
metric set is named for corporate actions in the packet or the spec.

⭐ **And the number should not be there at all.** The clause says the builder *"derives its
metrics **by AST**"* — the entire point of D2 is that the builder READS the schema. **Asserting
a count beside a list the tool is supposed to derive is the exact anti-pattern D2 exists to
kill.** So the honest correction is not "name the five"; it is to drop the number:

> **PROPOSED:** *"…the D2 builder extension that derives its metrics by AST from the store's
> own `CREATE TABLE` literal."*

**Verdict: BUILDABLE once the count is dropped or the members are named.** Not opened —
per the standing instruction, at most one unit, and the two built this session were assigned.

## 11 · Instrument self-reference

Two instruments were extended; **both reported honestly, and one exposed its own defect.**

- `merge_all.py --self-check` passed seven controls **and then the real dry-run crashed** on
  cp1252. The controls never touch stdout encoding, so the self-check could not have caught it —
  recorded rather than glossed.
- `ci_summarize.py`'s first real output contains **F-CI-3, a defect in itself**
  (`oom_or_timeout` matching the word, not the event). It is filed and left unrepaired on
  purpose.
- ⚠️ The comment-strip in the F-D4-1 measurement **changed nothing on its corpus** — a
  positive control that did not control anything. Said plainly in §9 rather than presented as
  rigour.

⚰️ **And the last measurement of the session was wrong, in the way this repo documents most
often.** `verify_manifest --check-commits` was run as `... | tail -10; echo; echo
"${PIPESTATUS[0]}"` — the bare `echo` between the pipeline and the read **reset
`PIPESTATUS`**, so the reported exit code was `echo`'s, not Python's. It printed **0** beside
output that plainly says two commits are unreferenced.

⭐ **The tool was correct; the measurement was not.** Re-run without a pipeline: **exit 1**,
with a control confirming the flag is what changes it (`0` without `--check-commits`). This is
the *"a test runner's exit status must reach you — never `tail`'s"* rule wearing a new costume:
it is not only pipes that lose a status, it is **anything that runs between the command and the
read**. Caught because the printed code contradicted the printed findings — **two outputs that
disagree is the cheapest bug detector there is, and it only works if both are shown.**

## 12 · [KEYBOARD] and merge readiness

**Nothing needed.** The previous session's phone-readable ask — *open the Actions tab and tell
me whether the publish job is red* — is **withdrawn**: the job is green, `ci-results` exists,
and the whole question was answerable from this box without an account.

**Merge readiness:** 12 manifest rows, **12 OK / 0 STALE**. Commit coverage **11 of 13** —
`merge_all` would silently skip Packet A's two commits (§8). `sign_all --dry-run` prints **12**
sign commands; `merge_all --dry-run` reports **5 constraints, all SATISFIED**, 12 units, and
stops at the member-visible unit as designed.

⛔ **Do not run the two commands yet.** F-MERGE-1 is unresolved, and the branch's own CI says
**RED** with a backend suite that does not collect.

**Production impact of everything in this session: none.** All five commits are docs-worktree
only; nothing pushed, nothing signed, nothing merged.

---

`STATUS: RAN`
