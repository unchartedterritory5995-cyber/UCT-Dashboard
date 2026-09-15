---
id: PACKET-T
title: A stale ThemeTracker test, and D3 CP2's named bars-pair cap — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-15
---

# PACKET T — the stale test · and D3 CP2

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. Two checkpoints, two different gate lines — sign them separately.**
>
> - **T-CP1** — **PROPOSED** (`PACKET-T`, non-collision proved: 0 hits either worktree).
> - **D3-CP2** — existing gate line:
>   `gates/d3-realtime-streaming-pre-implementation-gate.md` **§4, id CP2**, verbatim:
>   *"Name the bars-pair cap … One literal, one rename, one comment."*
>   ⛔ That packet's approval block is **not touched**.

---

## 1 · T — the test was STALE, not failing

| | |
|---|---|
| test | `app/src/pages/ThemeTrackerPage.chartmount.test.jsx` |
| before | **2 failed / 1 passed** |
| after | **3 passed** |
| decision | **REWRITE** |

**Why rewrite and not delete, in one sentence:** the behaviour the test asserts — select a
holding, `ChartPane` mounts with that symbol and the current timeframe, `stored=null`,
retargeting enabled — is **intact at HEAD**; only its PRECONDITION was removed.

| | commit | what |
|---|---|---|
| introduced | **`3fe7b63e3`** (2026-07-14) | *"single-open accordion (first theme open by default)"* — added `firstThemeTicker`, which auto-opened the first theme |
| test landed | **`7adfdda2b`** (2026-08-05) | its harness comment says the page *"auto-opens the FIRST theme on load"* |
| removed | **`453ecc3ec`** (2026-09-05) | *"feat(theme-sets): rebuilt editor"*, +253/−115 — `openTheme` now starts `null`; `toggleTheme()` (`ThemeTrackerPage.jsx:907`) is the observable equivalent |

⛔ **The removed feature was NOT restored and the test was NOT muted.** The repair is one
click — expand the theme — with the removing commit named in the file.

### Mutation, restored by EDIT

| mutation | diff | result |
|---|---|---|
| hardcode what `ChartPane` receives | `sym={selectedSym} tf={chartPeriod}` → `sym={'HARDCODED'} tf={'W'}` at `ThemeTrackerPage.jsx:1507` | ⛔ **1 failed / 2 passed** — *"selecting a holding mounts ChartPane with that symbol and the current timeframe"* |
| restored | `git diff --numstat` **empty** — byte-identical | ✅ **3 passed** |

---

## 2 · D3 CP2 — the bars-pair cap gets a name

`api/routers/stream.py` capped with an inline `pairs[:50]` **several hundred lines below**
`MAX_SSE_TICKERS`, and `app/src/lib/barsStreamManager.js:20` carried its own `50` whose
comment read *"mirror of api/routers/stream.py pairs[:50]"* — **a magic number citing a
magic number**, with nothing able to notice if either moved. That is
`lesson_a_comment_claiming_agreement_is_not_agreement` in one line.

⭐ **SAME VALUE, DIFFERENT FACT, and the rail keeps them apart.** `MAX_SSE_TICKERS` is
Finnhub's per-key subscription ceiling; `MAX_BARS_PAIRS` bounds how much fan-out one
browser may ask of this pod. Both are 50 today and are **free to diverge**, so the rail
asserts each name separately and **never** that the two numbers are equal.

### Told-vs-found, before a line was written

| told | found | delta |
|---|---|---|
| `stream.py:359` — `pairs[:50]` | **`stream.py:361`** | ⚠️ **2 lines** |
| `stream.py:24` — `MAX_SSE_TICKERS` | `:24` | 0 |
| `barsStreamManager.js:20` — the mirror comment | `:20` | 0 |

### The rail was RED on the repo before the change

`tests/test_bars_pair_cap_is_named.py` — **4 failed / 2 passed** before, **6 passed**
after. ⭐ That is what makes it a gate rather than a report: the repo had been on the wrong
side of it since the cap was written.

| mutation | result |
|---|---|
| restore the inline `pairs = pairs[:50]` | ⛔ **RED** — *"an inline numeric bars-pair cap is back; use MAX_BARS_PAIRS"* |
| restored by EDIT | ✅ **6 passed** |

⚠️ **The rail's first version would have red-flagged correct code.** It forbade *any*
`pairs[:N]` and matched `pairs[:10]` at `stream.py:381` — a log line truncating the list
for readability. **A rail that reds correct code gets muted**, so it is scoped to the
ASSIGNMENT form. Caught by running it, not by reading it.

### ⛔ Watch coverage — the first `api/**` change of the session

`reachable=156 · changed=18 · verdict OK · stranded []`. `api/routers/stream.py` is **not
in flow-worker's closure**, exactly as the D3 packet's CP2 row predicted (*"no —
`api/routers/stream.py` is not in the closure (measured)"*). No marker bump, no
flow-worker redeploy, no tape gap.

---

## 3 · Drafted ledger rows — NOT written

```
| 78 | <commit> | 2026-09-15 | S-TEST | 1 | Packet T: ThemeTracker chartmount test was STALE (asserted an auto-open removed by 453ecc3ec), rewritten against toggleTheme; 2 failed/1 passed -> 3 passed
| 79 | <commit> | 2026-09-15 | D3 / naming | 3 | D3 CP2: MAX_BARS_PAIRS named beside MAX_SSE_TICKERS; the browser mirror cites the NAME; rail was 4-red before the change
```

## 4 · Drafted RESUME delta — NOT applied

> ⛔ **A test that fails because its feature was deliberately removed is STALE, not a
> regression.** Resolve it by rewrite-or-delete with a finding naming the removing commit
> — never by restoring the feature, never by muting. ⚰️ 2026-09-15:
> `ThemeTrackerPage.chartmount.test.jsx` asserted an auto-open added by `3fe7b63e3` and
> removed by `453ecc3ec`; the assertions were still valid and only the precondition had
> gone.
>
> ⛔ **A comment that claims two numbers agree is not agreement.**
> `barsStreamManager.js` called its `50` a *"mirror of api/routers/stream.py pairs[:50]"*
> and nothing could notice if either moved. Name the constant, cite the NAME, and rail the
> two separately so they stay free to diverge.
