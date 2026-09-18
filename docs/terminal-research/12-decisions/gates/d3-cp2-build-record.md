---
id: D3-CP2-BUILD
title: D3 CP2 — the bars-pair cap gets a name — build record
role: the evidence an approval line for D3 CP2 is signed against
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-14
---

# D3 CP2 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  f7e851d58
SCOPE APPROVED:   CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED.** Gate line:
> `docs/terminal-research/12-decisions/gates/d3-realtime-streaming-pre-implementation-gate.md`
> **§4, id CP2**, verbatim: *"Name the bars-pair cap. `stream.py:359`'s inline `pairs[:50]`
> becomes a module constant beside `MAX_SSE_TICKERS` (`:24`), and
> `barsStreamManager.js:20`'s "mirror" comment cites the name instead of a magic number.
> One literal, one rename, one comment."*
>
> ⛔ **The D3 packet's own approval block is NOT touched.**

⚰️ **THIS DOCUMENT EXISTS BECAUSE OF A DESIGN DEFECT IN MINE.** T and D3 CP2 were first
written into **one** packet with **one** approval block. `sign_gate.py` refuses a file with
more than one unsigned `APPROVED AT SHA:` line (*"refusing to guess which"*), and a single
block cannot carry two signatures — so **two checkpoints in one packet are unsignable**.
Found by dry-running `sign_all.py`, not by reading. **One checkpoint, one block.**

---

## 1 · The defect

`api/routers/stream.py` capped with an inline `pairs[:50]` **several hundred lines below**
`MAX_SSE_TICKERS`, and `app/src/lib/barsStreamManager.js:20` carried its own `50` whose
comment read *"mirror of api/routers/stream.py pairs[:50]"* — **a magic number citing a
magic number**, with nothing able to notice if either moved.
`lesson_a_comment_claiming_agreement_is_not_agreement`, in one line.

⭐ **SAME VALUE, DIFFERENT FACT.** `MAX_SSE_TICKERS` is Finnhub's per-key subscription
ceiling; `MAX_BARS_PAIRS` bounds how much fan-out one browser may ask of this pod. Both are
50 today and are **free to diverge**, so the rail asserts each name separately and **never**
that the two numbers are equal.

---

## 2 · Told-vs-found, before a line was written

| told | found | delta |
|---|---|---|
| `stream.py:359` — `pairs[:50]` | **`stream.py:361`** | ⚠️ **2 lines** |
| `stream.py:24` — `MAX_SSE_TICKERS` | `:24` | 0 |
| `barsStreamManager.js:20` — the mirror comment | `:20` | 0 |

---

## 3 · The rail was RED on the repo before the change

`tests/test_bars_pair_cap_is_named.py` — **4 failed / 2 passed** before, **6 passed** after.
⭐ That is what makes it a gate rather than a report: the repo had been on the wrong side of
it since the cap was written.

| mutation | result |
|---|---|
| restore the inline `pairs = pairs[:50]` | ⛔ **RED** — *"an inline numeric bars-pair cap is back; use MAX_BARS_PAIRS"* |
| restored by EDIT | ✅ **6 passed** |

⚠️ **The rail's first version would have red-flagged correct code.** It forbade *any*
`pairs[:N]` and matched `pairs[:10]` at `stream.py:381` — a log line truncating the list for
readability. **A rail that reds correct code gets muted**, so it is scoped to the ASSIGNMENT
form. Caught by running it, not by reading it.

**Named tests:** `test_non_vacuity_both_files_are_readable_and_substantial` ·
`test_the_python_cap_is_a_named_module_constant` ·
`test_the_cap_site_uses_the_NAME_and_no_inline_literal_survives` ·
`test_the_finnhub_ceiling_keeps_its_own_name` ·
`test_the_browser_mirror_cites_the_NAME_not_the_literal` ·
`test_both_sides_agree_today_and_the_check_can_see_a_difference`

---

## 4 · ⛔ Watch coverage — the first `api/**` change of the programme's recent work

`reachable=156 · changed=18 · verdict OK · stranded []`. `api/routers/stream.py` is **not in
flow-worker's closure**, exactly as the D3 packet's CP2 row predicted (*"no —
`api/routers/stream.py` is not in the closure (measured)"*). No marker bump, no flow-worker
redeploy, no tape gap.

---

## 5 · Files, and the one-unit-one-commit proof

`api/routers/stream.py` · `app/src/lib/barsStreamManager.js` ·
`tests/test_bars_pair_cap_is_named.py` — commit **`af9fe21a6`**, disjoint from every other
unit's file set (intersections printed in the session report).

---

## 6 · Drafted ledger row — NOT written

```
| 79 | `af9fe21a6` | 2026-09-14 | D3 / naming | 3 | D3 CP2: MAX_BARS_PAIRS named beside MAX_SSE_TICKERS; the browser mirror cites the NAME; rail was 4-red before the change
```

## 7 · Drafted RESUME delta — NOT applied

> ⛔ **A comment that claims two numbers agree is not agreement.** `barsStreamManager.js`
> called its `50` a *"mirror of api/routers/stream.py pairs[:50]"* and nothing could notice
> if either moved. Name the constant, cite the NAME, and rail the two separately so they
> stay free to diverge.
>
> ⛔ **One checkpoint, one approval block.** `sign_gate.py` refuses a packet with two
> unsigned blocks and a single block cannot carry two signatures — so two checkpoints in one
> packet are **unsignable**. Found by dry-running the signer, not by reading it.
