# Decision: the indicator alert evaluator is rebuilt closed-bar

**Status:** ✅ **ACCEPTED — the evaluator judges the newest CLOSED bar; `ALERT_EVAL_MODE = "closed"`, and a closed-bar fire is the only kind the Signature ledger may ever admit.**

**Date opened:** 2026-08-06 · **Phase:** C · **Applied:** 2026-08-07 (`ALERT_EVAL_MODE` flipped, one line, its own commit) · **Record of the measurement:** §3 · **What it cost, per lane and per address:** §5

⛔ **THIS HEADER IS A RAIL, NOT A LABEL.** `tests/test_alert_closed_bar.py::test_the_record_and_the_code_agree_about_which_bar_is_judged` reads THIS LINE — isolated, and asserted to be the only `**Status:**` line in the file — and requires `"ACCEPTED" in it` to be exactly `eval_mode() == "closed"`. It fires in both directions: flipping the mode without resolving the record, and resolving the record without flipping the mode.

## 1. The fact

`api/services/indicator_alert_evaluator._evaluate_one` computes the indicator over
every bar the store holds — including the bar currently forming — and takes `prev`
from `alert["last_value"]`, which is whatever the **previous 60-second poll cycle**
wrote. So "crossed above 70" can fire on a wick that unwinds before the bar closes,
and the same bar can be judged five times with five different answers.

Spec §8: *"nothing enters the ledger unless it is closed-bar evaluated."* That
constraint has been carried since B1 and is unmet.

## 2. Why this record exists before the rebuild does

⛔ **An alert cannot be un-sent, and no screenshot catches a wrong one.** Phase B
had a pixel gate: a picture either changed or it did not, and the number of changed
pixels was the price of every decision. Phase C ships **notifications**. There is no
image to diff, and the analogous artefact — the fire log — is only an artefact once
something has recorded it. So the sequence is inverted relative to B: the
*instrument* is built and committed on the unmodified tree (Task 2), the rebuild
lands dark behind `ALERT_EVAL_MODE`, and this record is what the cutover commit
(Task 8) flips.

⚠️ **`.superpowers/` IS GITIGNORED.** Every number this phase measures has to
survive in the repo or it survives nowhere, which is why the baseline in §10 is
here rather than in the SDD ledger. The programme has corrected a prose count six
times already (7→16→20→21→22→32 enumeration sites; "84 chart pytest" matching no
command; "25 alert addresses" when the dict holds **28** — see §10.3).

## 3. The measurement

⚠️ **This section said "NOT YET TAKEN — Owner: Task 2" until Task 6 filled it, and
that was four tasks late.** Task 2 did take its measurement; it recorded it in
`docs/runbooks/alert-replay-gate.md` and left this section untouched, so the record
that the cutover commit reads has carried an empty measurement while three tasks
built on top of it. Recorded rather than quietly fixed: a decision record whose
measurement lives in a different file is a record nobody can act on.

### 3.1 The repaint oracle — does the lane agree with ITSELF? (Tasks 2 and 5)

| lane | fires per k `{1, 2, 4, 8}` | keyed disagreement | identity disagreement |
|---|---|---|---|
| **forming** (live) | `139,870 · 276,500 · 551,325 · 1,089,548` | **636,205** | **17,295** |
| **closed** (dark) | `134,135 · 268,270 · 536,540 · 1,073,080` | **0** | **0** |

Four frozen real-bar fixtures, 1,845 bars, 1,244 alerts. Reproduce with
`python tools/alert_replay.py --repaint --k 1 2 4 8 --mode {forming,closed}`; a
forming ZERO and a closed NON-zero both abort as vacuous, and the closed mode also
aborts on **no fires** (the closed lane fired 2,012,025 times while reading 0/0).
Full provenance in `docs/runbooks/alert-replay-gate.md`.

🔴 **AND IT IS NECESSARY, NOT SUFFICIENT — MEASURED, NOT ARGUED.** Task 5's
mutation M1 restored the defect itself (`prev = last_value`) and M4 shifted a whole
column by one bar; **both repaint ZERO and both are wrong**, because the replay
writes `last_value` back after every sample and a closed value is identical at
every sample of one bar. What killed them was a direct invariance test and a length
assertion. **Nothing below is built on "0 repaints" as a proxy for correctness.**

### 3.2 The lane diff — does the NEW lane agree with the OLD one? (Task 6)

A different question, and the one that reaches an inbox. Both lanes on the same
bars, the same grid and the same **k = 4** (the granularity the frozen fire log was
recorded at — a 60-second poll looking four times inside a 5-minute bar). Fires are
compared as `fire_key` **with the value inside the key**, because the single
largest shape here is a fire whose NUMBER moved.

```
python tools/alert_replay.py --diff --mode-a forming --mode-b closed \
       --out tools/alert_replay_out/diff.json
```

**Table 1 — total fires per lane.** 1,845 bars × 319 alerts (295 on the 66-bar
fixture), **30 of 30 catalog addresses driven**.

| lane | fires DELIVERED | distinct fires (`fire_key`) |
|---|---|---|
| **forming** (live today) | **552,083** | **417,935** |
| **closed** (dark) | **537,680** | **134,420** |

| fixture | bars | forming fires / keys | closed fires / keys | gained | lost |
|---|---|---|---|---|---|
| `intraday5m` | 579 | 176,492 / 137,192 | 171,676 / 42,919 | 33,970 | 128,243 |
| `spy_daily` | 400 | 119,896 / 94,217 | 118,120 / 29,530 | 24,851 | 89,538 |
| `nvda_5m_extended` | 800 | 244,556 / 178,350 | 237,068 / 59,267 | 44,429 | 163,512 |
| `wick_that_unwinds` | 66 | 11,139 / 8,176 | 10,816 / 2,704 | 2,043 | 7,515 |

⭐ **The row that matters to a user is the SECOND column, not the first.** The two
lanes deliver a comparable number of times (552,083 vs 537,680) because neither has
fire-once. But the forming lane's 552,083 deliveries carry only **417,935 distinct
facts**, and the closed lane's 537,680 carry **134,420** — because `above` and
`below` re-deliver on every poll at a slightly different running number, and the
closed lane says the same thing every time.

**Table 2 — what changes.**

| direction | fires (`fire_key`) | fires (`alert_key`, `bar_index` only) |
|---|---|---|
| **gained** — the closed lane fires where the forming lane did not | **105,293** | **6,724** |
| **lost** — the forming lane fires where the closed lane does not | **388,808** | **29,045** |

Every differing fire is given a SHAPE mechanically, by looking for the same alert
on the same bar / the adjacent bar in the other lane — so the four shapes this
phase predicted are *recognised* rather than assumed:

| shape | lost | gained | what it is |
|---|---|---|---|
| `value_moved` | **323,461** | **98,569** | same alert, same bar, different NUMBER — the per-poll re-delivery |
| `shifted_later` | **26,689** | **6,615** | the forming lane saw the crossing mid-bar; the closed lane fires it at that bar's close |
| `vanished` | **38,658** | — | the crossing existed only on a wick that unwound — **this is the phase's whole purpose** |
| `appeared` | — | **109** | the forming lane's `prev` was a mid-bar value that had ALREADY crossed, so the bar-close crossing was swallowed |

⚠️ **PRICE THE `above`/`below` CHANGE AS A COUNT — it is the one most likely to
surprise a user.** `above`/`below` are LEVEL conditions with no reference to `prev`,
so today a held condition re-delivers bell + email + Discord **every 60 seconds**.
They account for **373,748 of the 388,808 lost fires (96.1 %)** and **99,299 of the
105,293 gained (94.3 %)**. After the cutover the same alert arrives **once per bar**.
That is a reduction in noise, not a loss of information — but a member whose RSI
alert used to arrive every minute will notice, and it should be said before it
happens, not after. (Fire-once / re-arm is **Task 11's**, still absent, still latent
— prod `indicator_alerts` has zero rows.)

**Table 3 — the gained/lost count per address, and every one declared.** All 30
addresses change. The declaration lives in
`tests/fixtures/alerts/fire_diff_declared.json` — **59 rows**, each naming an
ADDRESS, a DIRECTION, a bounded COUNT and a prose REASON. An **undeclared**
difference FAILS in either direction (a *missing* alert is the failure a user
cannot see and cannot report); a declared difference that does not OCCUR in a given
configuration is REPORTED, never failed (B5's `provenance_unmet` ruling); and the
row counts **sum to the recorded totals**, which is what refuses a count larger than
what was measured — an unbounded declaration is a wildcard wearing a number.

| address | lost | gained | lost shapes | gained shapes |
|---|---|---|---|---|
| `adx.adx` | 10,966 | 5,119 | value_moved 10,388 · shifted_later 452 · vanished 126 | value_moved 4,904 · shifted_later 215 |
| `adx.minusDI` | 15,319 | 5,271 | value_moved 13,920 · shifted_later 1,172 · vanished 227 | value_moved 4,858 · shifted_later 412 · appeared 1 |
| `adx.plusDI` | 15,556 | 5,338 | value_moved 14,175 · shifted_later 1,156 · vanished 225 | value_moved 4,915 · shifted_later 423 |
| `atr` | 16,501 | 5,440 | value_moved 14,529 · shifted_later 757 · vanished 1,215 | value_moved 5,144 · shifted_later 296 |
| `bb` | 834 | 215 | value_moved 438 · shifted_later 235 · vanished 161 | value_moved 175 · shifted_later 40 |
| `bb.lower` | 20,611 | 5,150 | value_moved 19,775 · shifted_later 495 · vanished 341 | value_moved 5,077 · shifted_later 73 |
| `bb.middle` | 20,669 | 5,164 | value_moved 20,001 · shifted_later 390 · vanished 278 | value_moved 5,107 · shifted_later 57 |
| `bb.upper` | 20,638 | 5,142 | value_moved 19,724 · shifted_later 510 · vanished 404 | value_moved 5,069 · shifted_later 73 |
| `cci` | 22,143 | 5,799 | value_moved 18,860 · shifted_later 2,110 · vanished 1,173 | value_moved 5,175 · shifted_later 624 |
| `donchian.lower` | 1,583 | 1,044 | value_moved 1,106 · vanished 391 · shifted_later 86 | value_moved 990 · shifted_later 43 · appeared 11 |
| `donchian.middle` | 3,576 | 1,623 | value_moved 2,463 · vanished 756 · shifted_later 357 | value_moved 1,568 · shifted_later 48 · appeared 7 |
| `donchian.upper` | 2,139 | 718 | value_moved 1,014 · vanished 912 · shifted_later 213 | value_moved 664 · shifted_later 42 · appeared 12 |
| **`ichimoku.chikou`** | **19,574** | **0** | **vanished 19,574** | — |
| `ichimoku.kijun` | 3,031 | 1,387 | value_moved 2,112 · vanished 622 · shifted_later 297 | value_moved 1,335 · shifted_later 42 · appeared 10 |
| `ichimoku.spanA` | 5,362 | 2,822 | value_moved 4,332 · vanished 528 · shifted_later 502 | value_moved 2,744 · shifted_later 69 · appeared 9 |
| `ichimoku.spanB` | 2,225 | 937 | value_moved 1,321 · vanished 698 · shifted_later 206 | value_moved 893 · shifted_later 35 · appeared 9 |
| `ichimoku.tenkan` | 4,828 | 2,291 | value_moved 3,535 · vanished 749 · shifted_later 544 | value_moved 2,207 · shifted_later 72 · appeared 12 |
| `macd` | 525 | 196 | vanished 305 · shifted_later 194 · value_moved 26 | shifted_later 169 · value_moved 25 · appeared 2 |
| `macd.histogram` | 21,266 | 5,524 | value_moved 18,920 · shifted_later 1,332 · vanished 1,014 | value_moved 5,054 · shifted_later 470 |
| `macd.signal` | 20,271 | 5,218 | value_moved 19,663 · shifted_later 483 · vanished 125 | value_moved 5,042 · shifted_later 176 |
| `mfi` | 16,900 | 4,455 | value_moved 14,897 · shifted_later 1,378 · vanished 625 | value_moved 4,000 · shifted_later 449 · appeared 6 |
| `obv` | 17,365 | 4,309 | value_moved 15,725 · shifted_later 1,146 · vanished 494 | value_moved 4,128 · shifted_later 162 · appeared 19 |
| `price_vs_ma` | 19,394 | 4,931 | value_moved 18,279 · shifted_later 787 · vanished 328 | value_moved 4,895 · shifted_later 36 |
| `rsi` | 21,933 | 5,397 | value_moved 18,211 · shifted_later 2,339 · vanished 1,383 | value_moved 5,053 · shifted_later 344 |
| `sar.priceCrossedSar` | 139 | 136 | shifted_later 131 · vanished 8 | shifted_later 131 · appeared 5 |
| `sar.trendFlipped` | 137 | 136 | shifted_later 130 · vanished 7 | shifted_later 130 · appeared 6 |
| `stoch` | 22,929 | 5,814 | value_moved 17,433 · shifted_later 3,314 · vanished 2,182 | value_moved 5,160 · shifted_later 654 |
| `stoch.d` | 22,003 | 5,671 | value_moved 18,657 · shifted_later 2,301 · vanished 1,045 | value_moved 5,036 · shifted_later 635 |
| `vwap` | 17,462 | 4,232 | value_moved 16,524 · shifted_later 358 · vanished 580 | value_moved 4,191 · shifted_later 41 |
| `williams_r` | 22,929 | 5,814 | value_moved 17,433 · shifted_later 3,314 · vanished 2,182 | value_moved 5,160 · shifted_later 654 |

⚠️ **`stoch` and `williams_r` are byte-identical in this table and that is
arithmetic, not a duplicated row.** `compute_williams_r == compute_stoch − 100`
exactly (asserted), and the threshold ladder is three quantiles of each address's
*own* series, so the two grids are the same grid shifted — every fire maps one to
one. Left in rather than collapsed, because a coincidence nobody explains reads as
a bug in the instrument.

### 3.3 The row a user will call a bug: `ichimoku.chikou`

`ichimoku.chikou` **loses 19,574 fires and gains none**, and every one of them is
shaped `vanished` — but **not for the wick reason every other row carries**. The
chikou column back-shifts bar *i*'s close to index *i − 26*, so the newest 26 slots
are `None` by construction. The forming lane's `_last_non_none` walks backwards past
that trailing pad and reports a number from 26 bars ago; the closed lane reads
`series[i]` and reports no value at the bar being judged.

**So a Chikou alert stops firing entirely at the cutover.** That is the honest
answer — chikou at the newest closed bar is a fact about a bar that has not happened
— and the alternatives are worse: forward-displacing the cloud is an owner-facing
chart change, and reaching backwards is the forming lane's defect reintroduced in
one column. It is named here, with a count, so it is a decision at T8 and not a
support ticket at T8 + 1.

### 3.4 What the shadow soak adds that none of the above can

The frozen fixtures prove the lane is correct **on history**. `ALERT_SHADOW_ENABLED=1`
runs the closed lane as its **own APScheduler job** (`indicator_alert_shadow_cycle`,
60 s) against the **live tape**, with real armed alerts, real gaps and a real clock,
writing only to `/data/alert_shadow.db`.

⛔ **The shadow lane may not write `indicator_alerts`.** It shares the rows it reads
with the live lane, and `last_value` there is not bookkeeping — under
`ALERT_EVAL_MODE == "forming"` it IS the `prev` a crossing is measured against, so a
shadow write would change what the LIVE lane fires: the observer changing the
observed, on production, silently. The rail is
`test_a_shadow_cycle_leaves_indicator_alerts_BYTE_IDENTICAL`, which dumps the whole
table before and after a cycle, with
`test_the_live_lane_DOES_change_that_table_which_is_why_the_shadow_may_not` as its
control.

⛔ **Its own job, not a branch inside `_run_one_cycle`.** Two jobs can be disabled
independently; a branch cannot — turning the soak off would otherwise mean editing
the code path that DELIVERS.

**Before Task 8: at least three full trading sessions with the flag on**, comparing
the shadow log against the live lane's `triggered_at` daily, and folding any new
difference shape into `fire_diff_declared.json` **before** the cutover, not after.

### 3.5 The fork this measurement found

Widening the diff from the fire log's 28 `INDICATOR_FUNCS` addresses to all **30**
(the two `sar` EVENT addresses included) exposed a live fork in the harness:
`tools/alert_replay.py::make_forming_evaluate` resolved its value function through
`INDICATOR_FUNCS` alone, while the shipped `_evaluate_one` resolves through
`value_function`, which consults `INDICATOR_FUNCS` **and then** `EVENT_FUNCS`. So
`sar.priceCrossedSar` evaluated to `(None, False)` in the harness and fired **39
times** in the shipped lane on `spy_daily` alone.

It survived because **the anti-fork rail iterated the same dict the bug was in** —
`test_the_harness_agrees_with_the_evaluators_own_evaluate_one` looped
`ev.INDICATOR_FUNCS`, so no oracle had ever driven an event address through that
function. Both now iterate `INDICATOR_FUNCS + EVENT_FUNCS`. **A rail that iterates
the same list the code under test does can only ever see what that list contains** —
the same shape as the `dpc` constants finding in the pre-C repair.

Proof it moved nothing else: `python tools/alert_replay.py --check` is still exit 0,
8 (fixture, k) pairs, **digest for digest** — `build_alert_grid` is untouched and the
diff's extra alerts come from separate `build_event_alerts` / `build_price_alerts`
passes that never touch the frozen grid.

⚠️ **THE FIRE TOTAL THAT USED TO BE QUOTED HERE HAS MOVED ONCE, ON PURPOSE, AND THE
SENTENCE IS NOW WRITTEN SO IT CANNOT ROT AGAIN.** It read 691,195 from Task 2 until the
daily-VWAP unit fix landed (`29569946` + `2999e8f0`) and re-froze it at **685,193**
(−6,002, 0.87%). That was the one sanctioned exception to *"if the log moves, that is a
finding, never a number to regenerate"*, and it was justified at three independent
resolutions before the re-freeze: **6 of 8 (fixture, k) pairs byte-identical**; across
all 1,244 keys × 8 pairs **exactly 20 moved and every one was a `spy_daily|vwap|…`
address, non-VWAP = 0**; and `per_address_fires` moved for **exactly 1 of 28** addresses.
The claim this paragraph makes — *"it moved nothing else"* — is about **`build_alert_grid`
being untouched**, and that claim is checked by the digest equality, not by the total.

## 5. What the cutover cost, priced before it was taken

Re-measured on the tree that flipped the constant:
`python tools/alert_replay.py --diff --mode-a forming --mode-b closed`, exit 0,
**EVERY DIFFERENCE IS DECLARED**, 61 rows, 0 undeclared / 0 over-budget.
`--check` is **exit 0, FIRE LOG MATCHES, 22 (fixture, k) blocks, 1,153,245 fires,
digest for digest identical to the run before the flip** — the flip changes which
lane an ARMED alert takes; it changes nothing the replay records, and that
equality is the proof.

### 5.1 Total fires per lane

Over the four fixtures the declaration was measured on (`intraday5m`,
`spy_daily`, `nvda_5m_extended`, `wick_that_unwinds`), k=4, 200-bar window:

| | fires | distinct keys |
|---|---:|---:|
| forming lane | **569,830** | 435,259 |
| closed lane | **555,332** | 138,833 |
| GAINED (closed only) | **109,355** | identity 6,859 |
| LOST (forming only) | **405,781** | identity 29,869 |

**Read the KEY column, not the fire column.** The two lanes fire a similar
NUMBER of times, and that is the least interesting row here: 435,259 distinct
forming keys collapse to 138,833 closed ones, because a key carries the value,
and the forming lane produces a different value for the same alert on the same
bar every time it looks. That 3.1× is the repaint, stated as a count.

Shapes: lost `value_moved` 338,376 · `vanished` 39,335 · `shifted_later` 28,070.
Gained `value_moved` 102,496 · `shifted_later` 6,750 · `appeared` 109.

### 5.2 Gained / lost per address

⚠️ **THE DECLARED REASON FOR EVERY ROW LIVES IN
`tests/fixtures/alerts/fire_diff_declared.json`, NOT HERE, AND THAT IS
DELIBERATE.** Sixty-one prose reasons copied into this file would be sixty-one
sentences no gate reads — this record has already had a number rot green twice
(§3.5). The tool compares its measurement against that file every run and exits
1 on an undeclared or over-budget group, so the reasons below are *summarised*
by shape and the authoritative text is the artefact the gate checks.

| address | gained | lost | shapes LOST | shapes GAINED |
|---|---:|---:|---|---|
| `adx.adx` | 5119 | 10966 | value_moved 10388, shifted_later 452, vanished 126 | value_moved 4904, shifted_later 215 |
| `adx.minusDI` | 5271 | 15319 | value_moved 13920, shifted_later 1172, vanished 227 | value_moved 4858, shifted_later 412, appeared 1 |
| `adx.plusDI` | 5338 | 15556 | value_moved 14175, shifted_later 1156, vanished 225 | value_moved 4915, shifted_later 423 |
| `atr` | 5440 | 16501 | value_moved 14529, vanished 1215, shifted_later 757 | value_moved 5144, shifted_later 296 |
| `bb` | 215 | 834 | value_moved 438, shifted_later 235, vanished 161 | value_moved 175, shifted_later 40 |
| `bb.lower` | 5150 | 20611 | value_moved 19775, shifted_later 495, vanished 341 | value_moved 5077, shifted_later 73 |
| `bb.middle` | 5164 | 20669 | value_moved 20001, shifted_later 390, vanished 278 | value_moved 5107, shifted_later 57 |
| `bb.upper` | 5142 | 20638 | value_moved 19724, shifted_later 510, vanished 404 | value_moved 5069, shifted_later 73 |
| `cci` | 5799 | 22143 | value_moved 18860, shifted_later 2110, vanished 1173 | value_moved 5175, shifted_later 624 |
| `close` | 5258 | 21774 | value_moved 19682, shifted_later 1402, vanished 690 | value_moved 5121, shifted_later 137 |
| `donchian.lower` | 1044 | 1583 | value_moved 1106, vanished 391, shifted_later 86 | value_moved 990, shifted_later 43, appeared 11 |
| `donchian.middle` | 1623 | 3576 | value_moved 2463, vanished 756, shifted_later 357 | value_moved 1568, shifted_later 48, appeared 7 |
| `donchian.upper` | 718 | 2139 | value_moved 1014, vanished 912, shifted_later 213 | value_moved 664, shifted_later 42, appeared 12 |
| **`ichimoku.chikou`** | **0** | **19574** | **vanished 19574** | **—** |
| `ichimoku.kijun` | 1387 | 3031 | value_moved 2112, vanished 622, shifted_later 297 | value_moved 1335, shifted_later 42, appeared 10 |
| `ichimoku.spanA` | 2822 | 5362 | value_moved 4332, vanished 528, shifted_later 502 | value_moved 2744, shifted_later 69, appeared 9 |
| `ichimoku.spanB` | 937 | 2225 | value_moved 1321, vanished 698, shifted_later 206 | value_moved 893, shifted_later 35, appeared 9 |
| `ichimoku.tenkan` | 2291 | 4828 | value_moved 3535, vanished 749, shifted_later 544 | value_moved 2207, shifted_later 72, appeared 12 |
| `macd` | 196 | 525 | vanished 305, shifted_later 194, value_moved 26 | shifted_later 169, value_moved 25, appeared 2 |
| `macd.histogram` | 5524 | 21266 | value_moved 18920, shifted_later 1332, vanished 1014 | value_moved 5054, shifted_later 470 |
| `macd.signal` | 5218 | 20271 | value_moved 19663, shifted_later 483, vanished 125 | value_moved 5042, shifted_later 176 |
| `mfi` | 4455 | 16900 | value_moved 14897, shifted_later 1378, vanished 625 | value_moved 4000, shifted_later 449, appeared 6 |
| `obv` | 4309 | 17365 | value_moved 15725, shifted_later 1146, vanished 494 | value_moved 4128, shifted_later 162, appeared 19 |
| `price_vs_ma` | 4931 | 19394 | value_moved 18279, shifted_later 787, vanished 328 | value_moved 4895, shifted_later 36 |
| `rsi` | 5397 | 21933 | value_moved 18211, shifted_later 2339, vanished 1383 | value_moved 5053, shifted_later 344 |
| `sar.priceCrossedSar` | 136 | 139 | shifted_later 131, vanished 8 | shifted_later 131, appeared 5 |
| `sar.trendFlipped` | 136 | 137 | shifted_later 130, vanished 7 | shifted_later 130, appeared 6 |
| `stoch` | 5814 | 22929 | value_moved 17433, shifted_later 3314, vanished 2182 | value_moved 5160, shifted_later 654 |
| `stoch.d` | 5671 | 22003 | value_moved 18657, shifted_later 2301, vanished 1045 | value_moved 5036, shifted_later 635 |
| `vwap` | 3036 | 12661 | value_moved 11757, vanished 567, shifted_later 337 | value_moved 2997, shifted_later 39 |
| `williams_r` | 5814 | 22929 | value_moved 17433, shifted_later 3314, vanished 2182 | value_moved 5160, shifted_later 654 |

**All 31 addresses are driven and all 31 change.** `ichimoku.chikou` is the only
row that gains nothing, and the only one whose losses are 100% `vanished`.

### 5.3 The `above`/`below` cadence, as a count — and the correction nobody had made

Split by condition family (from `per_condition` in the same run):

| condition family | gained | lost | share of all lost |
|---|---:|---:|---:|
| **LEVEL (`above`/`below`)** | 103,208 | **390,253** | **96.2%** |
| CROSS (`cross_*`) | 5,932 | 14,694 | 3.6% |
| BAND touch (`touch_upper`/`touch_lower`) | 215 | 834 | 0.2% |

So **96.2% of everything the flip removes is a level condition re-answering
itself.** At the evaluator level, an `above` alert that held for a whole
390-minute 5-minute session was TRUE at all **390** sixty-second polls and the
replay records **390** fires; after the flip the same alert is judged once per
CLOSED bar and records **78**. That is the 5× the fixtures are measuring.

⛔ **AND THAT IS NOT WHAT A MEMBER SEES TODAY, WHICH THIS RECORD HAD NEVER
STATED.** The replay predates fire-once. Live, an alert delivers **iff
`alert_fired_log.record_fire` lands a new row**, and a LEVEL condition keys on
its ARMED EPISODE — so both 390 and 78 collapse to **exactly ONE delivery**
until the condition goes false and the alert re-arms. Task 11 measured that
directly through the real cycle: *12 cycles above 70 → evaluator asked 12×,
member told 1×.*

**The user-visible change for `above`/`below` is therefore not the COUNT, it is
WHEN and WHETHER the one delivery happens:**

* it now lands at a bar close rather than mid-bar (§5.4 prices the wait), and
* an episode that existed only on a wick never starts at all — `vanished`
  39,335 across all conditions, of which `close` alone is 690: *"my price alert
  fired and the candle closed nowhere near it"*, deleted.

A member with a level alert should expect **the same number of emails, arriving
up to one bar later, and fewer of them wrong.**

### 5.4 Worst-case latency per timeframe

Closed-bar evaluation on a 60-second cycle means the notification cannot arrive
before the bar closes, and the poll that notices it can be up to a full cycle
later. Read straight off the shipped handler
(`GET /api/indicator-alerts/latency`, which computes it from the EFFECTIVE lane,
so a rollback moves these numbers with it):

| tf | worst case | | tf | worst case |
|---|---:|---|---|---:|
| 1m | 120 s | | 1h | 3,660 s |
| 5m | **360 s** | | 1D | 86,460 s |
| 15m | 960 s | | 1W | 604,860 s |
| 30m | 1,860 s | | 1M | 2,678,460 s |

On the forming lane every one of these is **60 s** — the cycle alone. The second
term is the honest price of not repainting. Spec §8 requires it stated in the
UI; Task 11 put it on the surface, and this row is where the number is fixed.

⚠️ **A 5m alert arriving up to 60 s after its bar closes is the headline
number the owner accepted.** The 360 s in the table is worst case measured from
the EVENT (an intra-bar print at the very start of a 5m bar), not from the bar
close; from the close it is ≤ 60 s.

### 5.5 The casualty, confirmed five independent ways

`ichimoku.chikou` **loses 19,574 fires and gains none, 100% `vanished`** (§3.3
explains the mechanism). It was predicted offline from the column shape,
quantified offline by the declared diff, and then confirmed on real production
tape by an instrument with no knowledge of the prediction:

1. Task 5's closed-bar analysis — the 26-bar trailing pad makes `series[i]`
   always `None`;
2. Task 6's declared diff — lost 19,574 / gained 0, all `vanished`;
3. the live production shadow lane — **30 of 31 distinct addresses observed
   across a full session; the one absentee was `id 29 · SPY · tf 5 ·
   ichimoku.chikou`**;
4. the closed-lane corpus on seven NEW real-tape fixtures — gained 0 / lost
   10,995, again 100% `vanished`;
5. `cutover_watch` §3 on three separate live runs — `closed-lane silence: 1
   address, unexpected: 0`.

**What was decided, and implemented in the commit before the flip:**

* the rows **stay `active=1`** — deleting or deactivating a member's alert as a
  side effect of an engine change is not a thing this product does;
* they surface as **`needs_attention` with a `state_detail`** naming the
  displacement and offering the sibling plots that DO resolve at a closed bar.
  The pad (26) and the offer (`ichimoku.kijun`, …) are both MEASURED from the
  columns, never typed;
* **no `i-26` shim.** Reaching backwards is the forming lane's defect
  reintroduced in one column, and it would be a fourth definition of that plot's
  value;
* the create path **refuses a NEW chikou alert while the closed lane is
  running** — and reads `eval_mode()` to decide, so pulling the rollback lever
  makes it accept them again with no deploy.

A member waiting on a signal that can never arrive is the worst available
outcome. A flagged alert is honest.

### 5.6 What this record does NOT claim

* **The offline corpus cannot price the CLOCK.** `make_closed_evaluate` derives
  `now_epoch` from `bar_close_epoch` itself, so every replay number is blind to
  that function being wrong about *when* a bar stops changing. That is how the
  60-minute grid defect went unseen until a next-bar equality found it (fixed in
  `a5207048`, before the flip rather than after).
* **`cutover_watch` NO-GOs on a developer box** — `[cannot-read-store]`,
  `[no-armed-alerts]` — because `C:\data\auth.db` is not production. A local
  NO-GO is neither a reason to stop nor a pass; the GO/NO-GO that counts is the
  one taken against the pod.
* **Nothing here says the live tape has been observed disagreeing.** Three
  `cutover_watch` runs on 2026-08-07 reported `groups with a FORMING (open)
  newest bar: 0 of 1` all session, because the alert lane's bar store was
  28-108 minutes stale; 9,570 shadow rows were collected and every one compared
  a bar to ITSELF. The bars-freshness fix (`bba00796` + `9c6d851c`, measured
  67.4 → 2.5 min on real prod state) is what makes the first honest live
  observation possible, and it must be deployed for that observation to mean
  anything.

### 5.7 Still open after the flip, named rather than assumed done

* **`ALERT_SHADOW_ENABLED` is still 1 on production** and `alert_shadow_fires`
  grows ~30 rows/minute, 24/7, with no retention and no market-hours gate. The
  soak's purpose is served; turning it off is an operational step.
* **The 31 soak rows are still armed and snoozed.** `--disarm` at the cutover is
  task #56; `verify()` exits 1 seven days before the muzzle expires.
* ~~**The ledger door stays shut.**~~ **CLOSED 2026-08-08 — the door is WIRED.**
  It had one definition and zero call sites; it now has one definition and
  **exactly one** production call site,
  `indicator_alert_evaluator._accrue_ledger_receipt`, and the count is still a
  gate (`test_the_door_has_EXACTLY_ONE_production_call_site`, `==` on an
  AST-derived set — `git grep -c` says 3 and all three are prose). The wiring was
  the separate decision this bullet asked for: spec §12's Phase E row needs the
  ledger to hold public-worthy history, and a door with no caller writes no
  receipts, so that history could never begin. The receipt is gated on
  `record_trigger` (i.e. on `UNIQUE(alert_id, fire_key)` itself) and accrued
  **after** `_dispatch_delivery` with every refusal swallowed, so nothing the
  ledger does can cost a member an alert. **The fire log did not move:**
  `alert_replay --check` is byte-identical across the change.

### 5.8 Three consequences the pricing had not predicted, found by running it

The flip reddened **11 tests in four files** that nothing in §3 or §5.1–5.5
anticipated. None was a defect in the cutover; each is a claim that was true of
the forming lane and had never been asked of the closed one. They are recorded
here because *"a difference that appears only now is a difference the shadow run
should have shown"*, and these could not have come from the shadow run — they
came from running the suite.

1. **The `compute.rev` migration's suppression loses its premise.**
   `suppress_first_cycle` exists because a rev-1 `last_value` can become a rev-2
   `prev` and *the migration itself* invents a crossing. The closed lane takes
   `prev` from `series[i-1]`, so both sides of every comparison come from one
   call to one revision's column and the cross-revision comparison is **not a
   reachable state** rather than a suppressed one. Measured: the crossing
   binding now fires on the second post-migration cycle and it is a real rev-2
   crossing, not a late lie. **The suppression is NOT deleted** — it is what the
   rollback lane needs, and the rollback is one variable away. Both lanes are
   now tested by name (`test_alert_rev_migration.py`).

2. **`tools/alert_soak_matrix.py --arm` still arms 31 while the API now offers
   30.** That is the create-path split working exactly as designed —
   `refusal_for` is the API surface, `create()` is the writer and is deliberately
   ungated so the 31 production soak rows stay idempotent — but nothing had ever
   stated the consequence: the tool and the route now disagree about
   `ichimoku.chikou`, on purpose, and a future reader who found that by accident
   would reasonably file it as a bug.

3. **Six value-arithmetic tests were riding an unqualified `_evaluate_one`.**
   Their fixtures number `t` as a counter (`0, 1, 2 …`), which is not a bar
   clock, so `bar_close_epoch` cannot resolve it and the closed lane declines
   the whole window — the safe direction, and invisible until the default lane
   moved. They now say `mode="forming"`, which is what they always meant.

## 10. Baseline, by command

**Measured 2026-08-06 at `bb089bf2`** (branch `feat/phase-c-alerts`), working tree
clean, before any Phase C source change. Every later task compares against **these**
numbers, never against the four in the plan header.

| # | command | measured | exit |
|---|---|---|---|
| 1 | `cd app && npx vitest run` | **5,494 tests / 499 files** | 0 |
| 2 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py tests/test_indicator_compute.py tests/test_indicator_golden.py -q` | **150 passed** | 0 |
| 3 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_admin_chart_health.py tests/test_chart_health_alerts.py tests/test_chart_markers.py tests/test_chart_news.py tests/test_chart_parity_harness.py tests/test_charts_layout_service.py -q` | **164 passed** | 0 |
| 4 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_signature_*.py tests/test_confluence.py -q` | **186 passed** | 0 |

⚠️ **THE PLAN'S PREDICTION FOR COMMAND 1 WAS "~5,493 / 5,494, one known
master-side flake". Measured: 5,494 / 5,494, exit 0 — every test passed.** The
named flake is §11, and it did not reproduce in this run. All four plan-header
numbers for commands 2–4 were confirmed exactly.

### 10.1 After Task 1

Task 1 adds three cases to `enumerationSites.test.js` — the Python discovery scan,
the two-Python-`C`-rows sizing case, and `stripPyComments`' own code-not-prose rail
— and touches no shipped source, on either lane.

| # | command | after Task 1 | delta |
|---|---|---|---|
| 1 | `cd app && npx vitest run` | **5,497 tests / 499 files**, exit 0 | **+3**, all three new, all three in the ledger suite |
| 2 | indicator pytest | **150 passed**, exit 0 | 0 — no Python source touched |
| 3 | chart pytest | **164 passed**, exit 0 | 0 — no Python source touched |
| 4 | signature pytest | **186 passed**, exit 0 | 0 — no Python source touched |

`cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js`
alone: **33 → 36**, exit 0. Test-file count unchanged at 499: no new file, because
the ledger has exactly ONE writer per phase and the Python half belongs beside the
JS half or it is a second ledger.

### 10.1.1 The third case exists because a mutation fixture failed first

The stripper rail was not planned. The gauntlet's **M2b** — *prepend a four-id `#`
comment to a Python module, and watch the identity stripper make the scan flag it*
— **SURVIVED** on its first run, and not because the stripper is unnecessary: the
fixture read `# … rsi macd bb vwap …`, and `namesIndicators` matches a **quoted**
id, an `id:` key or an `id?.` read, **never a bare word**. The fixture named ZERO
ids raw, so it proved nothing in either direction and would have been reported as
"the stripper is not load-bearing".

It was caught only because the protocol demands the negative fixture trip the RAW
scan first. Corrected to `# … rsi: 14, macd: 26, bb: 20, vwap: session …`, M2b
KILLS. **That control is now a permanent test** rather than a one-off mutation:
*"⭐ the PYTHON scan reads CODE, not prose — and still reads code"*, which carries
the raw-side control the fixture lacked, plus a `#`-inside-a-string case, a
quote-inside-a-`#`-comment case, and a CRLF line-structure case.

### 10.1.2 Mutation results

Nine cases. **CONTROL A** = the unmutated ledger suite, ANSI-stripped, aborting on
a zero/unparseable passed count: `rc=0 passed=36`. **CONTROL B** = each mutation's
own `-t` filter on the unmutated tree, aborting on `passed=None` or `0`: every case
`rc=0 passed=1`. Verdicts from the **exit code**. Restore is byte-level with a
sha256 check (`git checkout -- <file>` does not restore bytes under
`core.autocrlf`), re-verified green at 36 afterwards.

| id | mutation | verdict | why |
|---|---|---|---|
| M1 | append a four-id dict to `indicator_alert_service.py` | **KILLED** | *a PYTHON module hand-lists four or more indicators and is not on the ledger* — a **born** Python site is refused |
| M2 | `stripPyComments` → identity, alone | **SURVIVED — by design** | all three files clear the four-id floor on CODE alone today, so the found-set does not move. Reported as the designed survivor, not a gap |
| M2b-control | four-id `#` comment, **real** stripper | **SURVIVED — required** | the comment must NOT flag the file; otherwise M2b's red proves nothing about the stripper |
| M2b | the same comment **+** identity stripper | **KILLED** | the same unledgered-site message — this is the kill M2 alone cannot make |
| M3 | `keepPython` floor → `[]` | **KILLED** | *the Python scan has no surviving subject to be measured against* — a control that stops looking rots GREEN |
| M4-histogram | swap `_INDICATOR_ALIASES`(C) ↔ `INDICATOR_CHORDS`(keep) | **SURVIVED — the measured blind spot** | total and every bucket preserved, so the histogram passes. This is B5's finding, re-measured on a 7-row ledger |
| M4-mapping | the SAME swap | **KILLED** | *a site is fated to a phase it did not have* — only the sorted-pair literal refuses a permutation |
| M4b | re-fate `indicator_compute.py` `keep` → `C` | **KILLED** | the Python floor collapses to `[]` — proof the new row's fate is load-bearing, not editorial |
| M5 | identity stripper vs the stripper's OWN rail | **KILLED** | *a `#` comment or a docstring still reads as an enumeration* — M2's survival is about the found-set, not about the stripper being untested |

### 10.2 Zero rendered change, asserted rather than screenshotted

Task 1 touches **no render path**: two files under `app/src/**/__tests__/` (which
Vite never bundles and which the discovery scan itself skips), one decision record,
and one new decision record. There is no shipped-source diff for the pixel gate to
measure, so running `tools/chart_parity.py` would produce a 0 that means "nothing
was compared", not "nothing changed" — a green that asserts nothing, which is this
programme's most-repeated defect. **The assertion is the diff:** every path in
Task 1's commits is `app/src/components/chart/engine/__tests__/*` or `docs/**`.

The measured non-change that IS a real claim is in the suite: the **JS** discovery
scan's found-set is pinned to the three files it saw before this task
(`instances.js`, `nativeRegistry.js`, `keyboardShortcuts.js`), so adding the Python
half cannot have moved what the JS half sees.

### 10.3 Two prose corrections, and one that had nothing to correct

1. 🔴 **"25 addresses in 14 groups" → 28 in 14.** MEASURED:
   `len(INDICATOR_FUNCS) == 28` (8 legacy + 6 same-base + 14 new-base), 14 catalog
   groups. The two prose sites that carried 25 are both in the **gitignored** B5
   SDD ledger (`progress.md` §ADDRESSING and `alerts-gap-report.md`); they are
   corrected there, and the durable correction is an **assertion** in
   `enumerationSites.test.js` → *"⭐ the two Python C rows are the size the ledger
   says — 28 addresses, and NO `sar` alias"*, which parses the dict literal out of
   comment-stripped Python and refuses 25.
   ⚠️ **The plan named a THIRD site that does not have the defect**: "the
   evaluator's own B5 comment block" also says 25. It does not.
   `indicator_alert_evaluator.py` carries **no address count in prose at all** —
   its only `25` is ADX's conventional guide level in `_DEFAULT_THRESHOLDS`.
   Recorded rather than dropped, because a correction applied to a site that never
   had the defect is indistinguishable from a correction that was skipped.
2. 🔴 **The ledger claimed `_INDICATOR_ALIASES` contains `"parabolic sar" → sar`.
   It does not, and never did.** MEASURED: **eleven** phrases resolving to **seven**
   targets — `vwap`, `avwap`, `ma50`, `ma200`, `bb`, `macd`, `rsi`. Two of those
   seven are not registry ids at all, and `sar` — the one the comment invented — is
   the single id the evaluator **deliberately refuses to offer**
   (`_SAR_IS_NOT_OFFERED`, with `test_sar_is_deliberately_not_offered_and_says_why`
   holding it). The invented example pointed at the one place in the codebase where
   naming `sar` is a decision somebody wrote a paragraph about. A ledger whose whole
   job is stopping a comment from outliving its subject cannot carry a fabricated
   example of its own; the corrected sentence is now **failable** by the case named
   above.
3. ⚠️ **Found while auditing, NOT corrected here, and named so it is not lost.**
   `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (the
   `VWAP_SESSION_ANCHOR` decision row) argues its blast radius from *"`vwap` is not
   in `INDICATOR_FUNCS` (8 keys) so a VWAP alert can be created but can never
   fire"*. That was true when the decision was taken and is **false now** — B5 put
   `vwap` in the dict and it is one of the 28. The row is a dated record of a
   decision already applied, so rewriting its reasoning would falsify the record;
   what it needs is a dated addendum, and that belongs to whichever Phase C task
   next moves the VWAP lane, not to a baseline task.

## 11. Known-red on the inherited tree

**`app/src/pages/calendar/Calendar.realModal.test.jsx` — inherited, not ours.**

⚠️ **THE PLAN GOT BOTH HALVES OF THIS BACKWARDS, MEASURED AT `bb089bf2`:**

| | plan says | measured |
|---|---|---|
| path | `app/src/pages/Calendar.realModal.test.jsx` | `app/src/pages/**calendar/**Calendar.realModal.test.jsx` — the plan's path resolves to **no test file at all**, and vitest exits 1 with "No test files found", which reads exactly like a failure |
| standalone | "passes 6/6" | **1 failed / 5 passed, 2 unhandled errors, exit 1** |
| full suite | "red under full-suite load" | **green** — the 5,494-test run in §10 has zero failures |

The failing case is *"a slow real enrichment-batch fetch still lands in the modal
once it resolves"*; the two unhandled errors are
`TypeError: Cannot set properties of null (setting 'dpr')` and
`TypeError: Cannot read properties of null (reading 'clearRect')` — a canvas teardown
race, which is why load changes the answer.

**So it is genuinely load-dependent, in the direction opposite to the one recorded,
and Task 1 changed nothing that touches it** (Task 1's whole diff is
`app/src/components/chart/engine/__tests__/**` plus `docs/**`).

⛔ **The rule for later tasks:** this file being red is **NOT a regression**, in
either mode. Before reporting it as one, run it BOTH ways — standalone and in the
full suite — and say which. A single-mode observation of this file has already
produced a wrong conclusion once, in the plan header.
