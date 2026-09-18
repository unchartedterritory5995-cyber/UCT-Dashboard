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

⚠️ **The mobile tiers are NOT captured.** The Chrome window is maximized and
cannot be resized (`resize_window` reports success; `innerWidth` stays 1920) or
raised from this session, so the phone (≤640) and tablet (641–1024) renderings of
the drawn band are owed. They need a human to bring that window forward, or the
window-raise permission. Restart the rig with:

```
UCT_RIG_PORT=8131 python docs/pine/wip/rig/boot_rig.py
```

⭐ The build in `app/dist` is already made with `VITE_PINE_MEMBER_PANE_ENABLED=1`,
which is what puts the attach button on screen at all — the 09-17 attempt had it
unset, which is why only the Formula tab's `Save` was reachable that night.

## 4. ⛔ R29 — #145 STAYS DRAFT. The failing condition, named.

> R29 flips draft → ready **only** when j.4 reports Clouds within Wave 1's
> tolerance **on both tables at both tiers** AND CI is green.

**The vendor half is STILL UNMEASURED — not failed.** The layout exists (R37,
`01f1AcIj`) and the engine half is now measured twice over, but the capture did
not run, and on 2026-09-18 it was refused for a stated reason rather than skipped:

⛔ **GATE v2.1 CANNOT PASS FROM THIS SESSION.** The gate is
`visibilityState === 'visible'` on the driving tab, read **before every write and
every screenshot**. It reads `hidden` and cannot be changed — the browser window
is occluded and every route to raising it is closed (Windows' foreground lock,
the harness's refusal of the P/Invoke route, `AppActivate` → `False`). On the
rig that was tolerable, because every reading there is DOM or SQLite. **On the
owner's TradingView account it is not**: a click behind a failing visibility gate
is exactly the case the gate was written for, and taking one would be the
"a rendering is not the source" failure with somebody else's layouts underneath.

⚠️ **H.8 is additionally out of session.** Its measurement is the developing
bar's volume read in `bars.py`, in `scan_evaluator.py` and on the vendor chart
**at the same moment**; the run reached this point at **02:24 ET**, with no
developing bar to read. Both code sites were re-read and are unchanged
(`_augment_daily_with_today` appends today's developing daily bar;
`scan_evaluator`'s `forming` row carries `today_vol`, counting `live_cols` over
`c,v,o,h,l`). The triple itself is owed to an RTH window.

⛔ **Unmeasured is not the same as outside tolerance**, and collapsing them is the
`CoverageLine` defect this repo already refuses. #145 therefore stays **Draft**,
with the condition named: *the vendor capture on `01f1AcIj`, both tables, both
mobile tiers.*

⭐ **What IS measured meets its bar:** 23 outputs, 20 fills, 20 colour pairs, a
real 20-value gradient, one deduped condition row, 20 primitives attached, and a
silent notes channel. Every engine-side claim j.4 was written to make — and since
2026-09-18 the same figures read back out of the artifact the **member door**
stored, with the band drawn on a chart.

## 5. R38 — the merge gate, and which clause stopped it

Part 5 of the 2026-09-18 prompt authorises merging #145 under gates. **Gate 5.1
is "#145 is READY", and Part 4 did not flip it**, so Part 5 stopped at its first
clause and nothing was merged. No other gate was reached, and none of them was
assumed: 5.2 (full verification), 5.3 (cadence/deploy-state), 5.4 (master
unmoved), 5.5 (the rollback SHA) and 5.7 (post-deploy) were not run, because a
gate list is only meaningful in order.

⛔ The blocking chain is one sentence long: **no visible browser window → no
vendor capture → "both tables at both tiers" unmeasured → R29 keeps #145 Draft →
R38's first gate fails.** Everything upstream of the browser is done.
