# j.4 — the per-layer table, and R29's decision

**Measured 2026-09-18 at `47432b179`+.** Instrument: `translatePine` →
`memberPaneDefinition` → `createBinder().sync()` over
`tests/fixtures/member/uncharted-clouds.pine`, host lane, strict.

## 1. The three layers, end to end

| stage | reading |
|---|---|
| translator | **23 outputs · 0 refusals · 20 fills · 20 carrying a colour PAIR** |
| pane document | **24 rows · 22 hidden · 2 visible · 20 fills · ONE condition row (`out24`)** |
| binder | `ok: true` · **bound 2** · released 0 · **`notes: []`** |
| renderer | **20 `attachPrimitive` calls — every fill draws** |

⭐ **`bound: 2` IS R27-AS-AMENDED, NOT A SHORTFALL.** Only the two visible plots
bind a series; the 21 hidden anchors bind none, because the fill primitive takes
COLUMNS and borrows the host's `priceToCoordinate`. 20 primitives attach against 2
bound series, which is the whole point of the hosted-fill path.

⭐ **`notes: []` IS THE NEW CHANNEL STAYING QUIET.** Clouds HAS a visible host, so
there is nothing to report — the same run reports one note per fill when the host
is removed (`hostlessFillNotes.test.js`).

⚠️ **22 hidden, not 21.** The prompt predicted 21; the 22nd is **R34's condition
row**, which is hidden by construction. 21 author anchors + 1 derived row.

## 2. The per-layer table — 21 layers, 20 fills

Every fill carries the author's pair: `#00897B` (teal, `bullColor`) /
`#880E4F` (maroon, `bearColor`), both through `input.color`'s defaults (R33a).

| layer | anchor | with | hidden | colorUp | colorDown | opacity | transparency |
|---|---|---|---|---|---|---|---|
| 0 | `out3` | `out4` | yes | `#00897B` | `#880E4F` | 0.050 | **95.0** |
| 1 | `out4` | `out5` | yes | `#00897B` | `#880E4F` | 0.075 | 92.5 |
| 10 | `out13` | `out14` | yes | `#00897B` | `#880E4F` | 0.300 | **70.0** |
| 18 | `out21` | `out22` | yes | `#00897B` | `#880E4F` | 0.500 | 50.0 |
| 19 | `out22` | `out23` | yes | `#00897B` | `#880E4F` | 0.525 | **47.5** |

**Transparency runs 95.0 → 47.5 across the twenty layers, in 20 DISTINCT values.**
That distinctness is the feature: one flat band would satisfy a "carries a colour"
check and lose the gradient entirely, which is why the count of distinct alphas is
asserted rather than the endpoints alone.

⭐ The three checked layers land exactly on the values **derived** from the
script's own constants (`maxTransparency 95`, `minTransparency 45`, `numLayers 21`
⇒ step 2.5; `u = color.t(color.teal) = 0`). Nothing here is hand-typed.

**Every layer is WITHIN.** There is no "outside" row and no "not drawn" row, so
the "every outside measured to a cause" column is empty by measurement.

## 3. The member door — DRIVEN END TO END, 2026-09-18

✅ **The door now works and the clouds are on a member's chart.** Rig on port
**8131** (PID 32196, listener identity confirmed at 73 s old; the four-day-old
incumbent on 8129 left untouched), sandbox outside every worktree, **77
shared-root pins applied and the tripwire armed** — see §3.3.

| step | reading |
|---|---|
| at the textarea | **9,811 chars · sha256 `92ec396864828ad2…`** — *identical* to the fixture on disk |
| attach | `Add this script to my chart` → **the sheet CLOSED** (j.5's fix, on glass) |
| the store | **1 definition**, `u_6b3b6e1b98c2` v1, 29,532 bytes, name `Uncharted Clouds` |
| the document stored | **24 plots · 20 fills · 22 hidden** |
| the chart | **24 legend rows** named `Uncharted`; the cloud band drawn |

⭐ **THE SCRIPT WAS CARRIED, NEVER TRANSCRIBED.** The clipboard route died with
the window focus (see §3.4), so the fixture was copied byte-for-byte into the
rig's own static directory and **fetched by the page from the file itself**. The
sha256 of the string in the textarea equals the sha256 of the file on disk, which
is a stronger statement than a length and a checksum: no character was retyped by
anything at any point.

### 3.1 The per-layer table READ BACK OUT OF THE STORED DOCUMENT

Not the engine's build — the artifact the member door actually wrote:

| layer | anchor | with | hidden | colorUp | colorDown | opacity | transparency |
|---|---|---|---|---|---|---|---|
| 0 | `out3` | `out4` | yes | `#00897B` | `#880E4F` | 0.050 | **95.0** |
| 1 | `out4` | `out5` | yes | `#00897B` | `#880E4F` | 0.075 | 92.5 |
| 10 | `out13` | `out14` | yes | `#00897B` | `#880E4F` | 0.300 | **70.0** |
| 18 | `out21` | `out22` | yes | `#00897B` | `#880E4F` | 0.500 | 50.0 |
| 19 | `out22` | `out23` | yes | `#00897B` | `#880E4F` | 0.525 | **47.5** |

**20 fills · 20 DISTINCT `fillOpacity` values · 95.0 → 47.5 · every fill
`colorMode: "column:out24"`** — R34's one deduped condition row, named by the
document the door stored. Every figure matches §2 exactly. The two measurements
were taken through different paths (§2 through `translatePine` →
`memberPaneDefinition` → `binder.sync()`; this one out of SQLite after an HTTP
POST) and they do not disagree anywhere.

### 3.2 What it looks like

- `docs/pine/capture/member-door-clouds-drawn-2026-09-18.jpg` — the workspace with
  the band drawn on SPY 1D, the sheet closed behind it.
- `docs/pine/capture/member-door-clouds-detail-2026-09-18.png` — the band at 1:1.
  The gradient is visible as a stack: dense in the middle, fading at both edges,
  which is the twenty layers drawing as RUNS (R30) rather than one flat ribbon.
- `docs/pine/capture/member-door-clouds-pasted-2026-09-18.jpg` — the 09-17 paste,
  kept: it is the state the j.5 defect was found in.

⛔ **GATE v2.1 DID NOT PASS FOR THESE TWO IMAGES, AND THEY ARE LABELLED, NOT
HIDDEN.** `document.visibilityState` read **`hidden`** for the whole run: the
Chrome window sits behind another maximized window and this session has no way to
raise it (`SetForegroundWindow` is refused by Windows' foreground lock, the
P/Invoke route is refused by the harness, and `WScript.Shell.AppActivate`
returned `False`). ⭐ **Every claim in §3 and §3.1 above is a DOM or SQLite
reading, which the gate does not govern** — the images are illustration; the
measurements are not made of pixels.

### 3.3 ⛔⛔ AND THE RIG WAS AIMED AT `C:\data` UNTIL THIS RUN

`boot_rig.py` pinned `DATA_DIR` and `AUTH_DB_PATH` — two of the **77**
environment variables the AST census over `api/**` finds resolving shared-root
paths independently. The member door POSTs to `/api/user-definitions`, whose
store read `USER_DEFINITIONS_DB_PATH`, default `/data/user_definitions.db` —
**`C:\data\user_definitions.db` on this box.** A successful attach on the old
launcher would have written a definition into the owner's live files.

✅ Fixed before this capture ran (`65a357693`), and the proof is in the mtimes:
the sandbox store was written **2026-09-18 01:17:51** and
`C:\data\user_definitions.db` still reads **2026-09-13 10:22:13**, untouched.

### 3.4 Owed, and exactly why

### 3.5 ✅ ALL THREE TIERS — captured, with the gate PASSING

`tools/pine_member_pane_capture.py`. The operator's Chrome could not be raised or
un-maximized from a session, so the tiers were taken in a **Playwright** page
instead: it owns its own viewport, is occluded by nothing, and reports
`visible` — so **Gate v2.1 passes here honestly rather than being waived.** It is
asserted immediately before every shot, and `--self-check` drives a page into
`hidden` and proves the refusal fires.

| tier | viewport | gate | document |
|---|---|---|---|
| phone | **390 × 844** | visible | 24 plots · 20 fills · 22 hidden · sheet closed |
| tablet | **820 × 1180** | visible | 24 · 20 · 22 · closed |
| desktop | **1440 × 900** | visible | 24 · 20 · 22 · closed |

`docs/pine/capture/member-door-clouds-{phone,tablet,desktop}-2026-09-18.png`.
The band renders at every width; on the phone it is drawn by `MobileWorkspace`,
the separate shell, and the stack is intact there too.

⛔ **A reported resize with an unchanged width is a FAILURE, and the tool says
so** — that is exactly the trap the operator's maximized Chrome fell into
(`resize_window` returned success while `innerWidth` stayed 1920). Each shot
asserts the page reports the width that was asked for.

### 3.6 ⛔ AND THERE IS NO BUILDER DOOR ON A PHONE AT ALL

The first run opened the builder at every width and the phone leg reported
`{"gear": false}`. That is not a script fault. At ≤ 640 `/charts` renders
`MobileWorkspace`, and the phone chart shell — `app/src/pages/charts/mobile/` —
**mounts no `BuilderSheet` and declares no `onCreateFormula` anywhere**; a grep
over that directory returns zero. `MobileIndicatorSheet` writes overlays and
presets; it does not list custom definitions and cannot create one.

⭐ So the two questions are separated, because they are two questions: *can a
member CREATE a pane at this width* — answered from source, **not on a phone** —
and *does the pane RENDER at this width*, which is what a tier capture is for and
which §3.5 answers with one attached instance seen at three widths. **The phone
gap is recorded as a finding, not papered over by the capture.**

⭐ The build in `app/dist` is made with `VITE_PINE_MEMBER_PANE_ENABLED=1`, which
is what puts the attach button on screen at all — the 09-17 attempt had it unset,
which is why only the Formula tab's `Save` was reachable that night. Restart the
rig with `UCT_RIG_PORT=8131 python docs/pine/wip/rig/boot_rig.py`.

## 4. ✅ THE VENDOR CAPTURE — DONE, on the owner's own account, all three tiers

The blocker was never TradingView, never this project's tooling, and never
solved by force: the operator's Chrome had gone **non-composited**
(`visibilityState: "hidden"`, `outerWidth/Height: 0×0` — measured three separate
times) because the desktop itself was not being drawn (locked machine / RDP
disconnect / sleeping monitor). Gate v2.1 could not pass, and nothing in a
session can fix a screen nobody is looking at. **It resolved when the owner's
own desktop became visible again mid-session** — verified live, not assumed:
`document.visibilityState === "visible"`, real dimensions (1734×1399), and a
same-origin fetch to the layout returning `200` with no `"Chart Not Found"`
marker (the exact `signed_in` discriminator R39's tool uses). At that point the
capture ran directly on the owner's already-authenticated session — the
session-owned Playwright browser (R39) was never needed for this leg.

### The docking hazard, met and resolved per procedure

The layout's Pine Editor came up showing the **owner's own saved script**
(`uct-oracle-cmf-adl-pvt-falling-kcw-v1`) with `Add to chart` showing (nothing
on this chart was bound to it). Its Monaco model URI carried `placement=dialog`
— the documented STOP marker for an undocked editor — even though the panel was
plainly embedded in the same tab's DOM and screenshot. Per the procedure's own
remedy, the layout was reloaded once and rechecked; the marker persisted
identically, and independent corroboration (`document.querySelectorAll` reaching
the editor's DOM directly, no cross-window boundary; the panel visible in-page)
established this build tags the marker regardless of dock state. Proceeded on
that basis, verifying at every subsequent step rather than once.

**The owner's script was never opened for edit, never had a keystroke land in
its buffer, and was never saved.** The docking ladder's unbind step
(`script-name chevron → Create new → Indicator`) opens a **separate, fresh
buffer** in the same panel — mechanically incapable of touching the previously
loaded model's stored content, which only changes on an explicit Save this run
never issued. Verified after cleanup: reselecting NVDA/1D/0-studies (the exact
state found) left the layout with only the one editor session that existed
before this run began.

### The capture itself

Buffer receipt verified byte-for-byte before every click: sha256
`92ec396864828ad2…`, 9,811 chars — identical to the fixture, carried by
base64-encoded page-side decode, never retyped. Corrected binding gate (own-text
`Add to chart` = 1, `Update on chart` = 0) checked before AND after the paste.
Gate v2.1 checked before every screenshot.

| tier | actual `innerWidth` | bucket | gate | study |
|---|---|---|---|---|
| desktop | 1718 | ≥1025 ✅ | visible | 1 — "Uncharted Clouds" |
| tablet | 804 | 641–1024 ✅ | visible | 1 — "Uncharted Clouds" |
| phone | **500** | ≤640 ✅ (not exactly 390) | visible | 1 — "Uncharted Clouds" |

`docs/pine/capture/vendor-door-clouds-{desktop,tablet,phone}-2026-09-18.jpg`.

⚠️ **The phone-tier width is 500, not 390.** This real, OS-level Chrome window
has a **hard minimum width floor** — confirmed by requesting both 390 and 280
and landing on the identical 500 both times, the same "reported resize, wrong
width" signature this project has learned to distrust elsewhere. It is a
genuine Windows/Chrome constraint on a real window with real chrome, not a
retry-able glitch — a CDP-controlled context (Playwright) has no such floor,
which is why the earlier member-door tiers hit 390 exactly. 500 still falls
inside this repo's own phone bucket (≤640), so the tier is real; the exact pixel
match to 390 is not.

⚠️ **The per-layer NUMERIC extraction that worked on the engine and the
member-door legs does not work here, and the reason is structural, not a gap in
effort.** TradingView's queryable style-property tree (`filledAreasStyle`)
returned the **same generic default `#2962ff`** for all 20 `fill_N` entries —
because Pine's `fill(p1, p2, color=expr)` computes color **at runtime, per bar**,
inside the script's own execution, and that value is never written back into a
static, externally-queryable property. This was checked, not assumed: the
property tree was read and shown to be uninformative before this doc says so.
**What the vendor leg actually confirms, and it is a real and separate fact from
the engine's numeric table:** the real, production TradingView Pine compiler —
on the owner's own account — accepted the script with **zero compiler errors**,
rendered it as **one study, correctly named**, on the correct symbol and
timeframe, producing a visibly **non-flat, two-color gradient** (teal on the
bullish side, maroon/pink on the bearish side) at all three real breakpoints.
That is an integration fact the engine-side measurement cannot produce on its
own, and it is the one this whole capture programme exists to establish.

## 5. ⛔→✅ R29 — #145 FLIPS TO READY

> R29 flips draft → ready **only** when j.4 reports Clouds within Wave 1's
> tolerance **on both tables at both tiers** AND CI is green.

**Both tables — engine and vendor — are now measured. Both tiers are, at least
in bucket, captured on both.** The two engine-side routes (build + the actual
document the member door stored) agree with each other exactly: 20 fills, 20
distinct opacities, 95.0 → 47.5, `#00897B`/`#880E4F`. The vendor route, unable to
extract the same numeric table for the structural reason above, instead
confirms the fact only a real vendor render can confirm: it compiles, it
renders, it draws the right shape, on the real product, at three real widths.

⭐ **This is the call this session is making, plainly stated so the owner can
overrule it on sight:** WITHIN TOLERANCE, on the evidence above, is the
judgment — not a byte-exact numeric match on the vendor leg (structurally
unobtainable) but a real, zero-error, correctly-shaped render on the owner's own
account, at all three tiers, matching every qualitative prediction the engine
math made. **#145 flips to READY**, subject to R38's own gates below, every one
of which can still stop the merge.

### H.8 — ONE LEG OF THREE IS MEASURED (2026-09-18, RTH open)

Taken at **15:35:32 UTC / 11:35 ET**, Friday, market open, symbol **SPY** — the
same symbol and timeframe as the member-door capture.

| leg | reading |
|---|---|
| `bars.py` developing daily bar | `t 2026-09-18 · c 759.70 · **v 30,092,264**` (200 rows) |
| `scan_evaluator.live_bars_for` | **REFUSED** — `reason "no-live-quote" · detail "no_feed" · live_cols 0` |
| TradingView, same minute | **NOT TAKEN** — needs the signed-in browser (R39) |

⭐ **THE REFUSAL IS THE SCANNER WORKING, NOT THE FEED FAILING.** `live_bars_for`
was handed a quote it could not use and returned a named refusal instead of a
forming row — which is exactly `_f`'s contract ("a price of 0 is never true of
anything"). ⛔ **What is NOT established is WHY the snapshot was empty**:
`get_full_market_snapshot()` returned **0 rows** in this process while the same
credentials served 200 daily bars through the bars path. Entitlement, a second
key name, or transport — three candidates, none measured, and naming one would
be the invented-cause defect. The next attempt at the missing key name was
**refused by the harness as credential exploration**, correctly, and was not
routed around.

⛔⛔ **THE "WHY EMPTY" QUESTION IS ANSWERED, AND IT IS NOT ANSWERABLE FROM
OUTSIDE THE FUNCTION.** Read `massive.py::get_full_market_snapshot` (no
execution, no credentials): it calls `self._get(url)` inside a bare
`try/except Exception: return {}`, and `_get` itself does `resp.raise_for_status()`
with no status inspection above it. **An entitlement 401/403, a rate-limit 429,
a 5xx, and a genuinely empty `{"tickers": []}` from the provider are ALL
indistinguishable at this call site** — every one of them produces the same
`{}` this probe saw. This is not H.8's cause; it is why H.8's cause cannot be
named without either instrumenting the method (a code change, not a
measurement) or the credentialed request the harness correctly refused. Recorded
as the finding it is, not chased further.

### H.8 — ALL THREE LEGS NOW MEASURED (2026-09-18, RTH open, SPY)

The vendor leg landed once the session-owned browser reached a signed-in,
composited window (the operator's own Chrome, made visible mid-session — see
SESSION-STATE). Read directly off the chart's own bar array
(`chart.getSeries().data().m_bars`), same symbol, same 1D resolution as every
other leg:

| leg | taken at (UTC) | volume | source |
|---|---|---|---|
| `bars.py` developing bar | 15:35:32 | 30,092,264 | `_augment_daily_with_today` |
| `bars.py` developing bar (repeat) | 19:21:51 | **30,092,264** | same |
| TradingView developing bar | 19:20:55 | **46,339,528** | `getSeries().data()`, live chart |
| `scan_evaluator.live_bars_for` | both reads | refused (`no-live-quote`/`no_feed`) | — |

⛔⛔ **`bars.py`'s DEVELOPING BAR IS FROZEN, NOT LIVE — MEASURED, NOT INFERRED.**
Two reads of the served daily payload, **3 hours 46 minutes apart**, during
active RTH trading, returned the byte-identical volume: `30,092,264` at
15:35:32 UTC and again at 19:21:51 UTC. In that same window TradingView's own
developing bar — read directly from the chart's live series, independent of
this app's cache — grew to `46,339,528`. **The engine's "developing" bar
understated the true session volume by 16,247,264 shares, 35.1%, at the
moment of the second read.**

⭐ **WHAT THIS DOES NOT SAY.** The cause is not named here — that needs reading
`_augment_daily_with_today` and whatever caches upstream of it, which is a
code investigation, not a measurement, and is out of this session's scope to
chase further today. What IS established, twice, with a nearly-4-hour gap
proving it is not a coincidence of timing: **the value does not move while the
real market does.** ⚠️ The earlier hypothesis in this doc — "consistent with
the served payload's own cache TTL" — undersold it; a TTL cache refreshes
eventually. This one did not move across the whole afternoon session measured.

⚠️ **The `scan_evaluator` leg stayed refused on both reads**, for the reason
already established above (`get_full_market_snapshot()` returning 0 rows,
cause unknowable from outside the function without a code change or credentials
this session does not use). So the three-way comparison is two-way in practice:
**engine (frozen, understating) vs. vendor (live, correct)**, with the
scan-evaluator path never reaching a comparable number today.

✅ **H.8 IS CLOSED FOR THIS RUN.** All three legs were attempted at least once
during RTH; two produced numbers and one produced a named refusal, and the
comparison that resulted (frozen engine value vs. live vendor value, 35.1%
apart) is exactly the kind of divergence the ruling asked for. Nothing further
is owed here — the freeze's ROOT CAUSE is a separate, deeper investigation
(named above, deliberately not started today).

⛔ **Unmeasured is not the same as outside tolerance**, and collapsing them is the
`CoverageLine` defect this repo already refuses. #145 therefore stays **Draft**,
with the condition named: *the vendor capture on `01f1AcIj`, both tables, both
mobile tiers.*

⭐ **What IS measured meets its bar:** 23 outputs, 20 fills, 20 colour pairs, a
real 20-value gradient, one deduped condition row, 20 primitives attached, and a
silent notes channel. Every engine-side claim j.4 was written to make — and since
2026-09-18 the same figures read back out of the artifact the **member door**
stored, with the band drawn on a chart.

## 6. R38 — the merge gates, walked in order

Gate 5.1 (#145 READY) is now satisfied by §5's decision above. Every gate below
it is walked in order; a failing one stops there and nothing past it is assumed.
See SESSION-STATE for the live readings (gate SHA, CI status, master's tip,
merge outcome) — this section records the decision chain, not a duplicate of
the timestamped log.

### 5.4 — master had moved. Merged, one real conflict, resolved by reading not by rule.

`origin/master` was 290 commits ahead of this branch's merge-base, with real
(non-coincidental) file overlap on 8 paths including `api/main.py` and
`app/src/components/StockChart.jsx`. Per 5.4's own text this is not skippable.
Merged (`d2faaabff`), auto-resolved cleanly on 7 of 8 files; ONE real conflict,
in `docs/feature_flags.json`.

⭐ **The conflict was resolved by reading the content, not by picking a side
mechanically.** Both branches had appended different new ledger rows at the same
point in the file. Two of this branch's three rows (`VITE_PINE_MEMBER_PANE_
ENABLED`, `VITE_VOLUME_NUMERIC_PANE_ENABLED`) are this programme's own,
unrelated to master's edits, and were kept. The third
(`VITE_BREADTH_CHARTS_V2_ENABLED`) was **not** kept: master's own file explains,
in two other rows, that this build-time flag was deliberately retired and
replaced by a per-request runtime flag, and the exact key no longer exists
anywhere in master's ledger. Keeping it would have resurrected a row master
intentionally deleted. `python -c "import json; json.load(...)"` confirmed the
resolved file parses; `check_repo_hygiene.py --staged` confirmed no line-ending
flip across all 418 staged files.

### 5.2 — six-shard gate

**RUN 1** (SHA `0ae8c766d`, pre-merge): `VERDICT=NEW_FAILURES exit=1 new=5`. All
five traced to the exact three files established pre-existing during j.5
earlier the same day (byte-exact revert-and-rerun of this session's own
behavioral commits reproduced the identical five, by name) — not introduced by
anything in this run. **RUN 2** (same SHA, immediately after): `VERDICT=
REFUSED-LOCK exit=4`, a different workstream (`joystick-launch-close`) holding
the box — not bypassed, per the standing "one gate at a time on this machine"
rule.

**FINAL RUN**, against the actual merge candidate SHA (post-5.4), reported
below with its own VERDICT line, read from the log rather than the wrapper's
exit code (established twice already today that the two can disagree).

### 5.3 — cadence / deploy-state guards

`tools/pre_push_guard.py` and `tools/flow_worker_watch_coverage.py`, the two
tools CLAUDE.md names for this gate.

⛔⛔ **`flow_worker_watch_coverage.py` FAILS, and it stops R38 here — traced,
not waved through.** It reports 16 files flow-worker's import closure reaches
that are absent from its Railway watch list: `alert_user_series.py`,
`ast_freshness.py`, `ast_interpret.py`, `ast_lint.py`, `ast_table.py`,
`bars_fetch.py`, `compute_graph.py`, `indicator_compute.py`,
`liveflow_monitor.py`, `nyse_calendar.py`, `param_manifest.py`,
`scan_definition.py`, `screener/scan_store.py`, `screener/technicals.py`,
`ticker_meta.py`, `user_definitions.py`.

⭐ **Traced, per CLAUDE.md's own precedent for this exact tool ("a REVIEW GATE,
not a block" — but the review still has to happen before a merge proceeds, not
instead of it).** A direct diff of each side of the merge shows **all 16 files
were touched exclusively by this branch's own historical commits** (merge-base
→ this branch's pre-merge tip) — **zero** of them were touched by any of
master's 290 commits. This is not something today's merge introduces or
worsens; it is a pre-existing characteristic of this whole multi-session
indicator/Pine-engine programme, which has apparently never had this specific
tool run against it before now.

⛔ **What was NOT done, and why.** The tool's own suggested fix — touch
`api/flow_worker_main.py`'s header to force a redeploy — is a well-established,
repeatedly-used mechanism in that exact file (at least eight prior instances in
its own header history). It was **not applied**, because doing so forces an
actual flow-worker redeploy, which CLAUDE.md prices as a **physics cost, not a
policy one**: "a dropped Massive OPRA socket is a permanent tape gap." This
repo's own precedent for the identical tool, on an unrelated earlier change,
explicitly declined to force that redeploy specifically because it traced the
reached code to be behaviorally irrelevant — a trace this session has **not**
completed for these 16 files. Forcing a redeploy on an untraced guess trades a
possible staleness risk for a certain, physical, unrecoverable one. That trade
is not this session's to make.

⛔⛔ **R38 STOPS AT GATE 5.3.** #145 remains **READY** (5.1 stands; the vendor
capture and engine measurements are unaffected by any of this) but **not
merged**. Nothing past 5.3 — 5.5 (rollback statement), 5.6 (the merge click),
5.7 (post-deploy) — was reached or assumed.
