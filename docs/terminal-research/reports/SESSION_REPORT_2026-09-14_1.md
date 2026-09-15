# Session report — 2026-09-14, session 1

**MANIFEST TRUTH · CI READABLE WITHOUT AUTH · QUEUE CONTINUES**

> **Provenance.** This is the report as it was DELIVERED to the terminal at the end of
> that session, extracted verbatim from the session transcript
> (`eb32f565-19d2-42ea-ba1d-8f7af2ae2354.jsonl`, assistant message at line 26354,
> 7,710 characters). It is **not** a re-write, a summary, or a correction — the
> standing rule asks for the report itself, and a report re-composed after the fact
> would be a different artifact wearing the same name.
>
> ⚠️ **Sections 1-9 of this report never reached the owner** — the paste was truncated
> on mobile for the third session running, which is what created the standing rule
> that every session write its full report to a file under
> `docs/terminal-research/reports/`. This file is that rule's first artifact, written
> retroactively for the session it describes.
>
> ⛔ **One claim in it is now known FALSE and is corrected below rather than edited
> above.** §4 says CI *"is only visible in the Actions UI, which this box cannot
> read"* and files the run **UNREADABLE**. Measured 2026-09-14 23:45 EDT: the
> repository is **public**, so `api.github.com` answers **anonymously** — no `gh`, no
> token, no PAT. `GET /repos/{owner}/{repo}` returns **200** and
> `/actions/runs` returns full run and job records. The run was readable the whole
> time. See the 2026-09-14 session-2 report for the finding (**F-CI-2**) and for why
> `ci-results` was genuinely absent (the publish job did not exist on the commit that
> run #1 fired against, and run #2 was still in flight).
>
> The body below is unaltered.

---

Both trees clean. Nothing merged, nothing signed.

## 1 · ET and trees

Start **2026-09-14 23:20 EDT Mon**, end **23:37 EDT Mon**, both `python tools/weekly_exec.py et`. Both worktrees `git status --porcelain` → **0** at start and end.

## 2 · Prelude

**P.1** — re-printed into the briefing (compressed): U (7 files / 4 units, six EMPTY intersections, empty diff, 12 one-unit commits); K (10 rows, 10 commands, negative control stops writing nothing); C.1 (120 deploys = 100% master; 5 deploy-verb matches, all false positives); C.2/C.3 (pushed `7bd9c8785..af9fe21a6` fast-forward, CI UNREADABLE); I.3 EXPECTED-DRIFT, I.4 UNEXPLAINED, I.1/I.2 not reached; Q not reached.

**P.2 — category (a), refreshable.** `2d8156692`→`28da7740d`, `d606922fe`→`72cda4cda`. The diff is §6's attribution correction (`0b7570df4`→`453ecc3ec`). **Approval-block lines changed: 0.**

**P.3** — `packet-t-and-d3cp2-gate.md`. `sign_gate`: *"⛔ 2 unsigned APPROVED AT SHA lines — refusing to guess which. Leave exactly one block blank."* **Cause: structural** — two checkpoints, one block. Not a sign_gate limitation.

## 3 · M — manifest truth

`tools/verify_manifest.py` built. **Controls:** clean → OK; dirty (one byte) → STALE with a **one-commit** trail and the matching version found; empty manifest → **ZERO rows**; a value that was never the doc's → no matching commit after hashing every version. All pass.

⚰️ **The dirty control caught a real bug in my own tool:** `def git(args, cwd=REPO)` binds `REPO` at definition time, so the fixture's repo override never reached it — the trail came back empty and every *"no matching commit"* was a silence, not a search.

**Real manifest: 10 rows, 10 OK, 0 STALE.** M.2's refresh was already applied last session and P.2 now *justifies* it. **M.3:** all 10 packets carry exactly one unsigned block; `sign_gate` would refuse **0**. **M.4:** `sign_all --dry-run` = 10 ok / 10 commands / 0 mismatches; `merge_all --dry-run` = 10 units / 9 cherry-picks / 6 pushes, ending at the member-visible stop.

## 4 · R — CI readable without auth

**Guard predicate, verbatim (`tools/pre_push_guard.py:2`):** *"Refuse a push to master while the last `web` deployment is not settled."* It is invoked explicitly and **no pre-push hook is installed** in this worktree. `ci-results` is written by Actions, not from here — the guard is untouched.

**Workflow:** top-level `contents: read`; only the new `publish` job raises `contents: write`, `needs: [vitest, pytest]`, `if: always()`. Validates as YAML with 3 jobs.

**`tools/ci_summarize.py`** — 7 controls pass, plus three **real scoped runs**: pytest 6/6 ok; vitest 8/8 ok; and a genuinely red one (`reachable.test.js`) → `failed: 1`, `failed_files: ["src/components/screener/reachable.test.js"]`. It strips ANSI before matching (a coloured *"2 failed"* would read green), treats zero-collected as **not ok**, and a missing log as `totals_line_found: false`.

**Pushed** `af9fe21a6..e767a7aab`. ⛔ **`ci-results` has not appeared** — checked repeatedly over ~17 minutes. **UNREADABLE.** Last observable: the push was accepted; the ref does not exist; whether the run started is only visible in the Actions UI, which this box cannot read. R.4/R.5 therefore have **NONE** to report.

## 5 · Q — no units opened, and the reason is a measurement

**D4 CP4: file-disjoint (intersection EMPTY vs all 13 commits) — but NOT BUILT.**

Its assertion says the family moves to **`fundamentals::{TICKER}::{period}`**. Measured:

- the current key is **two segments** — `earnings_table::{ticker}` (`earnings_table.py:586, 693`)
- `fundamentals_monitor.py:486-487` parses it as exactly two: `k.split("::", 1)[1]`
- **no `{period}` dimension exists anywhere in the family**

So CP4 is not a rename: adding `{period}` **splits one cache entry into two** on a live member-facing serve path, and silently breaks the monitor's parse unless changed in lockstep. Whether the entry *should* vary by period is a design decision the assertion presumes and the code does not answer. **Reported, not invented** — filed as **F-D4-1**.

**D5 CP2: not opened.** With D4 CP4 stopped on a measurement and the branch already carrying eleven unsigned units, starting an M-sized unit at the end of this session is the wrong trade. Said plainly rather than rushed.

## 6 · Instrument self-reference

Built 2 (`verify_manifest.py`, `ci_summarize.py`); both controlled before the repo. **One reported a property of itself:** `verify_manifest.git()`'s default-argument binding made it read the real repository during its own fixture test — fixed, and the control that caught it is the reason it was visible.

## 7 · OPEN QUESTIONS

1. `ci-results` never appeared; CI run status unreadable from this box.
2. **F-D4-1** — does the fundamentals cache entry vary by period, or not? CP4 cannot proceed until that is decided.
3. I.1 (`d2_dual_samples` zero rows) and I.2 (FROZEN rule) still not reached.
4. `page_views` 16-day span unexplained — no prune exists.
5. `terminal-next-monitor` still UNREADABLE, not woken.
6. `origin/feat/s7-price-level` is no longer stale — the memory rule needs updating.

## 8 · Findings filed

| ID | one line |
|---|---|
| **F-D4-1** | D4 CP4's target key `fundamentals::{TICKER}::{period}` presumes a period dimension the family does not have; the monitor parses the key as exactly two segments. |

## 9 · [KEYBOARD]

```
python tools/sign_all.py --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt
```
then separately, for the member-visible one:
```
python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible
```

| # | packet | CP | fingerprint | state | merges-after |
|---|---|---|---|---|---|
| 1 | packet-c-instrument-and-claudemd-gate | CP1,CP2 | `c443515eb` | OK | — |
| 2 | packet-d-nav-tabs-gate | CP1,CP2 | `e279c828c` | OK | C (same file) |
| 3 | packet-b-schema-resolution-gate | CP1,CP2,CP3 | `a03e0cbf5` | OK | — |
| 4 | packet-v-multi-volume-gate | CP4 | `f94d7addc` | OK | B (adds CP4 to its roster) |
| 5 | s4-cp2-build-record | CP2 | `21d6ad3e8` | OK | — |
| 6 | packet-e-ci-gap-gate | CP1 | `c90ad04d2` | OK | — |
| 7 | packet-k-two-command-signing-gate | CP1,CP2 | `36179a330` | OK | — |
| 8 | packet-t-stale-test-gate | T-CP1 | `5179b2890` | OK | — |
| 9 | d3-cp2-build-record | CP2 | `f7e851d58` | OK | — |
| 10 | s2-accelerator-chord-…-gate | CP1 | `72cda4cda` | OK | last, alone |

⚠️ **E CP2 (`e767a7aab`) has no manifest row yet** — it needs one appended to row 6's packet or its own. Not added blind; it is an OPEN item for the next session.

**Production impact:** rows 1–9 → **nothing member-visible**. Row 10 → Ctrl/Cmd/Alt+Shift+F stops silently flagging tickers on three screens; plain Shift+F unchanged.

## 10 · Merge readiness

**13 commits** on the branch, all previously proven cherry-pick clean; `e767a7aab` (E CP2) is the thirteenth and is **not yet covered by a manifest row**, so the commit↔row mapping is **12 of 13**. `merge_all --dry-run` honours C→D and B→V by list order; the constraints are recorded in the manifest header but are **not yet machine-enforced** — an OPEN item.

## 11 · Three phone-readable sentences

**The manifest now checks itself: ten rows, all true, and the one number that had gone stale is explained — it was a text correction, not the approval block.**

**CI results will publish into the repo itself so no login is ever needed to read them, but the branch hasn't appeared yet, so this run is still unread.**

**I stopped before building the next queued unit because its instruction assumes a piece of the cache key that doesn't exist, and inventing it would have split a live cache in two.**

---

`STATUS: RAN`
