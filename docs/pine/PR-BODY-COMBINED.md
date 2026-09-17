> **Two waves in one branch.** **Wave 1** puts a member's translated Pine script on their own chart as a hosted pane, behind a flag that is OFF. **Wave 2** closes the grammar that pane stands on — nine items censused, four built, five retired on their numbers — and carries item **(j)** (Uncharted Clouds) in progress. This PR is a **DRAFT**: it is opened so CI runs and the work can be read, and it is flipped to ready only on the owner's word. **Wave 1's section is first, Wave 2's follows.**

---

# Uncharted Volume v2 renders on a member's own chart — the Pine → chart-engine wave, behind a flag that is OFF

A member pastes a TradingView Pine script, presses one button, and their own
indicator draws on their own chart on UCT Intelligence: four plots in a
quarter-height sub-pane, both of the author's dashboards as real DOM at the
corners the script declares, three cells out of four byte-identical to what
TradingView draws for the same script on the same symbol, and every place we
knowingly differ disclosed in a sentence under the chart.

**It ships dark.** `VITE_PINE_MEMBER_PANE_ENABLED` is unset on the merged tree
and the gate only opens on the literal string `'1'`, so nothing in this PR is
visible to any member until somebody sets that variable and deploys.

---

## 1. What a member sees

### Flag OFF — the default, and the state this branch merges in

**Nothing.** Not a disabled control, not an empty pane, not a hidden div:

- the attach control does not render, so a saved script cannot be put on a chart;
- `MemberPane` returns `null`;
- no `indicatorInstances` entry can be created through this route;
- nothing this wave added appears in the DOM at all.

`attachedPineDisclosures.test.jsx` drives the **real** doors with the flag off
and asserts the absence — *"⛔⛔ flag-off on the member route: no pane, no
instance, nothing in the DOM"* — rather than asserting a component returns null
in isolation.

### Flag ON

A member can attach a saved Pine definition through the doors that already
shipped — `BuilderSheet` saves the document → `/api/user-definitions` → the store
→ `useInstalledUserDefinitions` installs it on every page load → the Indicator
Library lists it as *Your formula* → `addInstance` writes into
`chart_settings.indicatorInstances` → the binder draws it. No new route, no new
storage, no new door.

For `uncharted-volume-v2.pine` on SPY 1D that means:

| what draws | detail |
|---|---|
| four plots | Volume, Avg Vol Columns, Avg Vol Line, Scale Padding — in a sub-pane about a quarter of the chart's height, not a 29px strip |
| the Range dashboard | `position.top_left`, the author's declared corner, as an HTML `<table>` |
| the Volume dashboard | `position.top_right`, inset by the live width of the price scale so it cannot sit on the price labels |
| an empty cell | **absent**, not blank — matching the vendor's own capture, which renders 3 Range cells and 1 Volume cell for a script that writes 4 and 2 |
| three disclosures | the `ta.cum` window badge with the live bar count, the `baseTimeframeFolds` note, and the D1 alert note |
| a fourth, at phone width only | R-R's scaling note, when a table had to be scaled to fit |

---

## 2. The flag

| | |
|---|---|
| **name** | `VITE_PINE_MEMBER_PANE_ENABLED` |
| **default** | **OFF.** The gate is `import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED === '1'`, so absent, `''`, `'0'`, `'true'` and `'yes'` are all off. Only the literal `'1'` opens it. |
| **read in** | `app/src/components/chart/engine/memberPaneGate.js::memberPaneEnabled` — **one place**, so a rename is one line. The rail derives the name from that file rather than typing it. |
| **fails** | **closed.** A build with no `import.meta.env` returns `false` rather than throwing. |
| **declared in** | `docs/frontend_feature_flags.json`, `status: dark`, with its `readBy` naming the function above. |
| **and in the image** | `Dockerfile.web`, as an `ARG` **and** an `ENV` — added at **`e6ca532c6`**. Without that line Railway drops the variable silently at build time and the flag can never be turned on. See §9. |

**Why BOTH ledgers, and why this branch's original answer was wrong.** This wave
recorded the flag only in `docs/frontend_feature_flags.json`, arguing that a Vite
build constant has a different lifecycle from a Railway variable — it is baked in
at build time, cannot be flipped without a deploy, and is invisible to
`railway variables` — so putting the two in one ledger would make "is it on?"
ambiguous.

⚰️ **Master ruled the other way while this branch was in flight, and shipped a rail
for it.** `tests/test_vite_flag_ledger.py` (**`294fc28fe`**, *close the VITE_\*
ledger blind spot*) requires every build-time `VITE_*` the frontend reads to carry
a row in `docs/feature_flags.json::build_flags`, and gives the better reason:
*"an unset build flag and a flag off ON PURPOSE are indistinguishable from outside
the repo."* That is exactly the question the lifecycle argument fails to answer —
`docs/frontend_feature_flags.json` says the flag is dark, and says nothing about
what Railway holds. The newer authority wins. Both rows now exist (**`b0c26d3b6`**):
the `build_flags` row carries the Railway state, the measured baked value and the
Dockerfile history; the frontend ledger keeps the reader-level record. The rail
asks for presence, not exclusivity.

⛔ The rail still names one flag, `VITE_CHART_RENDER_TOKEN_PREVIOUS`, which belongs
to the discord-render lane (`app/src/lib/renderToken.js`, `4821ec3f2`). Its Railway
state is not ours to record and a guessed row is worse than an absent one, so it is
named rather than filled in — the same split as the Dockerfile finding.

⛔ **One deliberate exception, recorded in the file that makes it:** the flag does
**not** reach `AttachedPineDisclosures.jsx`. The flag gates the *feature* — whether
a member may attach a script. A *disclosure* is an obligation. Turning the flag off
is a deploy, and every definition a member attached while it was on is still in
their `chart_settings` and still draws; gating the disclosure component would mean
that deploy silently strips the required sentences off drawings that keep drawing.

---

## 3. Measured metrics, with commit hashes

| metric | value | where |
|---|---|---|
| curated corpus | **266** scripts | `tools/corpus_metric.json`, re-derived on the merged tree at **`59aee8f73`**; the file was not rewritten, so the derivation matched byte-for-byte |
| host-lane pass | **31 / 266** | same file; unchanged by this wave and by the merge |
| screener-lane pass | **44 / 266** | same file |
| install census | **25 / 269** | member definition tree; unchanged |
| `pine_oos` corpus | **59 / 59** sources verified, 0 hash mismatches | R-N; the floor moved 60 → 59 **by measurement** |
| R-I parity set | **9 / 9** measured and green | was reported 8 of 9 |
| v2 refusals at 1D | **0** (from 22 of 133 nodes) | R-Q, commit `c28808d4d` |
| step ceiling | 1,000,000 → **12,000,000** | derived: deepest real warm-up 250 × deepest reachable depth 32,000 = 8,000,000 worst real, ×1.5 |
| interpreter cost, JS vs Python | **4.9×**, measured | corrected from a written-down "~40× slower" that nobody had measured |
| cells vs TradingView | **3 of 4 byte-identical**; the 4th decomposed | `pineTableVendorParity.test.js` |
| mobile audit | every row PASS at **390×844** and **1024×768** | `tools/pane_gesture_audit.py` |

### The one cell that is not byte-identical, decomposed rather than waived

Our Volume column is **our bars, exactly** — the column is not wrong. The
difference is upstream of the renderer:

| bar | ours | vendor | Δ | rel |
|---|---|---|---|---|
| 2026-09-11 | 45,477,300 | 45,512,741 | +35,441 | 7.79e-4 |
| 2026-09-10 | 42,740,400 | 42,740,375 | −25 | 5.85e-7 |
| 2026-09-09 | 32,812,400 | 32,812,411 | +11 | 3.35e-7 |
| 2026-09-03 | 43,494,000 | 43,531,581 | +37,581 | 8.63e-4 |

⛔ **Every one of our values ends in `00`: our store quantises volume to 100
shares.** Two of these four bars differ by 25 and 11 shares — pure rounding,
invisible at any float tolerance and fatal to an integer-exact test. The other two
carry a real ~35k provider difference on top of it. That is the open divergence
row in §6, not a renderer defect.

⭐ `Avg Vol Columns` **agrees about WHEN it draws** — null on 09-10, 09-09 and
09-03 on both sides, a value on 09-11 on both. The two-tone cap fires on the same
bars; the value differs by 5,349 (1.2e-4) because it averages volumes that already
differ.

### Per-series comparison, through `seriesCompare.js`

```
series                 kind   bars  cmp  blank  max rel     verdict
Volume                 int    4     4    0      —           4 integer values differ
Avg Vol Columns        float  4     1    3      1.235e-4    max rel error exceeds 1e-9
Avg Vol Line           float  4     0    0      0.000e+0    4 bars blank on one side only
Scale Padding          float  4     0    0      0.000e+0    4 bars blank on one side only
```

The comparator discriminated on its first meeting with real vendor numbers, which
is why it was built and exercised before it ever saw them.

### Mobile audit, both tiers, gate v2.1 read before every capture

| row | phone390 | touch1024 |
|---|---|---|
| tables drawn, both corners | PASS | PASS |
| quarter-height pane (no 29px frame) | PASS — 652px | PASS — 528px |
| disclosures readable | PASS — 3 lines, 0 with zero layout | PASS — 3 lines |
| scrub · pinch-zoom · scroll · rotate — anchored / no artefacts | PASS ×8 | PASS ×8 |
| no overlap — price scale / toolbar / joystick hub | PASS | PASS |
| tables-fit (R-R) | PASS — scaled `['0.758','0.941']`, wrap 0, note shown ×1 | PASS — `['none','none']`, no note |
| capture @100% · @125% | PASS — gate true | PASS — gate true |

`data-uct-objects-unreadable: 0` and `boundTf: D` at both tiers, so R-Q holds on
mobile. "Anchored" is measured as *the table's rect is byte-identical before and
after the gesture*; "no artefacts" as *the cell TEXT is identical* — a redraw that
changed a number would pass a rect check and fail this one.

---

## 4. Vendor fixtures, by commit

| fixture | commit | window |
|---|---|---|
| SPY 1D, forced depth | **`f2578f82c`** | `study_bars_loaded 4,633` · 2008-04-14 → 2026-09-11 · **`FULL_WINDOW`** (window 2,751) |
| AGEN 1D | **`5c4d67ef2`** | 4,066 bars · `FULL_WINDOW` |
| `ta.tr(true)` | **`40b5d7d0d`** | the true-range probe |
| SPY 1D, shallow | **`7f94f4404`** | ⛔ **SUPERSEDED — `WINDOW_UNMEASURED`.** Keeps its numbers and gains `_SUPERSEDED`. |

⚰️ **Why `7f94f4404` is superseded and not deleted.** At ~640 bars it recorded
`HVE Trigger` as flat 0 and I wrote that this was *"correct, and useless as a test
of the condition."* At 4,633 bars the same script **fires 25 times** — Lehman week,
the Flash Crash, the 2011 US downgrade. A capture whose window was never measured
is not a smaller version of the truth, it is a different answer, and R-L's depth
gate exists so that a comparison against one refuses instead of agreeing.

⚰️ **And that fixture carried a day-out label that invented a 28% divergence.**
`plots.rows[3]` was labelled `2026-09-04` while its own `time` said `2026-09-03`
(bars_back 5 from 09-11 IS 09-03; 09-07 was Labor Day). Aligning on the label put
34,015,600 against 43,531,581. The label is corrected and `plots._alignment_rule`
now says to key on `time` — a human-written date beside a machine-written one is a
second authority over one value.

---

## 5. Divergences

`tests/fixtures/vendor/divergences.json` — 19 rows: 7 confirmed, 6 accepted,
2 refuted, 2 corrected, 1 suspected, **1 open**.

### Accepted, with the member hook that carries each one

| id | hook kind | what a member is told |
|---|---|---|
| `request-security-base-period-identity-vs-lookahead-off-step-back` | `fold` → `baseTimeframeFolds` | that their `request.security` at the chart's own timeframe became the chart's own series |
| `hve-window-depth-fires-more-on-a-shorter-series` | `requirementTag` → `window_dependent` | the bar count the value depends on, live, on the pane |
| `atr-tr-starts-at-bar-1` · `barstate-viewer-dependent-on-vendor` · `barssince-unbounded-vs-bounded-state` · `barstate-three-axes-not-a-tristate` | documented | recorded behaviour differences with no member-visible effect on this script |

### Open — one row, and it is the fourth cell

**`volume-provenance-two-sources-disagree-and-one-of-them-rounds`.** Our store
quantises to 100 shares; the provider and TradingView's feed disagree by ~35k on
two of four sampled bars. Same shape as
`agen-historical-volume-differs-by-1-8-percent-before-2016`, on a different symbol,
which is evidence that row is **not symbol-specific**.

**What closes it:** a provenance decision, not a code change — either we state
which tape the volume column is (and the ~1e-3 disagreement becomes a documented
property), or we source volume from the same tape the vendor uses. Until then the
cell is compared with the difference decomposed, never asserted equal.

⚠️ Also carried forward and named, not fixed: **R-O**, 13 stale `ticker_meta` rows
holding raw yfinance tier codes (`OQB`×5, `OID`×5, `OQX`×3), which the current
`_YF_EXCHANGE` map already handles — plus **`BF.B` (`YHD`)**, which is the genuine
residual: unmapped, not stale, and a refresh will not move it.

---

## 6. Rulings, by name and where each is recorded

Pointers, not restatements — each location is the authority.

| ruling | recorded in |
|---|---|
| **`ta.cum` class** | `closedTable.json::_requirement_tags.window_dependent` — `refused_by` screener/sweep/alert/share/listing, `accepted_by` pane, with `why_the_pane_may` |
| **R-A3** (refuse with an offer) | SESSION-STATE §"R-A3, recorded as a ruling"; `pine:state@284` |
| **R-F** (nine columns) | `db9ea2f2e` — host 31/266, screener 46/266 at the time |
| **3.1** axis pair | `docs/pine/barstate.md` + fixture sha |
| **3.2** `ta.barssince` arity | deferred with its reason; `DECISIONS-2026-09-11.md` |
| **3.3** four names refuse in the JS lane | `DECISIONS-2026-09-11.md` |
| **3.4** member wording | placed verbatim on `pine:text-value` in `pine.js` |
| **3.5** `'D'` identity | `pine.security.test.js` (10 cases), `divergences.json` |
| **D1** (an `alertcondition` is not a plot) | `memberPane/memberPaneDefinition.js`; the sentence rides on `meta.disclosures` |
| **D2** — a pane acts on the **HOST lane's saved definition** (`paneGate.js::PANE_LANE = 'host'`), and **the screener lane is inadmissible by construction**; *the IR lane being off the pane path is the consequence, not the ruling* (corrected in place, R19, 2026-09-15) | SESSION-STATE §D2; the pane is driven by `translatePine` → binder |
| **R-G** (the fold wherever it sits) | `ast/bind.js::foldBound`; cross-lane oracle `tools/lookback_agreement.json` |
| **R-H** (two definitions, toggles on and off) | `pineTableVendorParity.test.js` |
| **R-I** (the parity set) | 9 of 9 measured; SESSION-STATE §"R-I IS 9 OF 9" |
| **R-J** (a window that names a member's knob) | `closedTable.json::_input_windows`; `parse.js::INPUTS_ARE_FOLDED`, mirrored in `ast_table` |
| **R-K** (the symbol OBJECT, settled at bind time) | `ast/bind.js::symbolConstantsWith`; witnesses in `symbolScope.json::confirmed`; assembled once by `bind.js::bindConstsFor`, re-exported by `nativeRegistry` |
| **R-L** (the depth gate) | `memberPane/seriesCompare.js::depthVerdict` |
| **R-M / gate v2.1** (container resize; the capture gate) | exercised in `352cba711`; anchor is `objectTableDom.js::anchorStyle` |
| **R-N** (the corpus re-frozen at 59/59) | SESSION-STATE §R-N; `census_member: false` on the unpublished member |
| **R-Q** (the step ceiling, derived) | `c28808d4d`; derivation in `recurrenceSteps.measure.test.js`; constant + docblock in `ast/interpret.js`, mirrored in `api/services/ast_interpret.py` |
| **R-R** (phone-tier table fit) | `69032af47`; `closedTable.json::_tables_fit`; `objectTableDom.js::fitFactor`/`applyFit`; `paneTablesFit.test.jsx` |
| **compareAll gate** | `seriesCompare.js::compareAll`; both branches driven in `pineTableVendorParity.test.js` |

---

## 7. Deferred to wave 2, each with its routing note

| deferred | measured state | routing |
|---|---|---|
| **arrays, `for` loops, `color.t()`** | 21 refusals at lines 64–84 of the Clouds script | one grammar wave; the refusals are precise and name their lines |
| **runtime inputs** | R-J bounds a knob, never a bare name; `INPUTS_ARE_FOLDED` is the constant four readers agree on | the rule is already written; wave 2 lands on it |
| **nested text helpers** | **0 of 266** scripts hit the refusal | measured low priority, not a guess |
| **short-circuit evaluation** | both sides always evaluate today | named; no script in the corpus depends on it |
| **IR-lane tuples** | `runtime:tuple` at `v2:251` — an 8-value destructure the IR has no form for | a capability the lane lacks, not a wire somebody forgot |
| **the IR lane's absence from the pane path** | by ruling **D2**; `buildRuntimeIr` clears v2:249 after this wave's symbol fold | not on the criterion; `reachable.test.js` carries the dated entry and its re-argued expiry |
| **`alertSets` wiring** | precondition measured: the alert fires 25× only at **2,751 bars** of loaded history, so first paint must reach that depth | wire it with the depth precondition, not before |
| **`s := close` typing** | real Pine rejects it; we render `<if> + num + ""` | a typing decision, recorded |
| **stale `ticker_meta` rows** | 13 rows (R-O) + `BF.B` as the genuine residual | one-liner against `_YF_EXCHANGE`; `BF.B` needs a map entry |
| **volume provenance** | the open divergence row above | a provenance decision |
| **11b** | untouched by this wave, deliberately | another lane's |

---

## 8. Process

### ⛔⛔ Worktree ownership — first, because it is the one that nearly cost work

**A session deletes only what it created.** Never `git worktree remove`, never
`git worktree prune`, never a delete under `C:\Users\Patrick\uct-worktrees\` that
this session did not create *in this session*. Every worktree carries
`.uct-session-owner` at its root naming the creating session; **no owner file is
not permission** — it is a stop-and-ask.

⚰️ **2026-09-12, ~16:12:** `uct-worktrees\indicator-r0r1` had every tracked file
deleted out from under a running 12-chunk pytest lane. Established from the run's
own logs: chunk 1 produced **332 ×** `ModuleNotFoundError: spec not found for the
module 'api.services.crypto_box'` — an `importlib.reload` of a module whose source
had gone from disk — and chunk 2 refused to start on a path that no longer existed.
**Which process did it was never established** and is not guessed at. Nothing was
lost only because every commit had been pushed. Recorded in `CLAUDE.md`; the
throwaway worktree used for this PR's merge dry-run carried its owner file and was
removed by the session that made it, and nothing else was touched.

### ⛔⛔ Never verify a runner through a pipe

A pipeline's exit status is the **last** command's. `python tools/pytest_chunks.py
2>&1 | tail -30` reports `tail`'s status, and a filter that read some text always
succeeds. Redirect, read the bare exit code, then read the file.

⚰️ Measured three times on the same tool: three OOM-killed pytest runs read as
clean in 2026-09-10; a lane that ran **one chunk of twelve** then crashed read as
`[exited with code 0]`; and while building the fix, the verification command
reproduced it a third time — `--out-dir . --only 1` exits **2** bare and **0**
through `| tail -1`. The runner now prints a `VERDICT:` line last, which is a
mitigation, not a fix. Both rules are in `CLAUDE.md` on this branch and survived
the merge.

### One lane at a time

Backend pytest on this box is **scoped, never repo-wide** — an unscoped run reached
18 GB and was OOM-killed, and `--collect-only` alone reached 6.6 GB, so it is
import/collection time and neither `-k` nor `--timeout` can contain it. The full
suite runs through `tools/pytest_chunks.py`, one lane at a time, foreground,
redirected.

### `boot_rig.py` blast radius

The rig backend resolved its sandbox as `__file__.parent/rig-data` — correct in a
scratchpad, a trap the moment the file was committed into the repo, where running
it would write `auth.db`, a bars cache and a dozen markers **into the worktree**
whose cleanliness is the resume contract. It now honours `UCT_RIG_DATA`, defaults
outside the repo, and **refuses to start if the resolved path is inside any git
worktree**, asked of `git rev-parse --show-toplevel` rather than pattern-matched.
Rail: `tests/test_rig_sandbox_never_inside_a_worktree.py` (5 cases including the
non-vacuity one). `rig-data/` is in `.gitignore` as a second layer.

### `check_scope_paths.py` — a scope list that fails open

A rails run named **seven** test files, vitest ran **six**, and it exited **0**:
`symbolFoldParity.test.js` is at `engine/ast/`, not `engine/__tests__/`, and a path
matching nothing is a filter selecting nothing, which is not an error. The tool
asserts every path in a scope list exists before the runner sees it, with
`--suggest` for the realistic mistake (a moved file) and `--self-check` to prove it
can fail. ⚠️ It was itself corrected in this wave: it refused a **directory** scope,
which is legal and is what the sweep uses — a gate that cries wolf gets muted. It
now accepts a directory *that selects at least one test file*, because "it exists"
is not the question.

### ⛔ Every push from this worktree was UNSCANNED, and the terminal said so

Master's `pre-push` hook (`4fb4f9daf`) runs a secret scan before anything else. It
looks for `tools/secret_scrub.py` at the worktree root and at one sibling; the tool
lives on the breadth-charts branch and **is not on master**, so a worktree branched
off master does not have it and every push here printed:

```
[pre-push] WARNING: tools/secret_scrub.py not found in this worktree —
[pre-push]          the secret scan did NOT run. This is not a pass.
```

⭐ The hook is behaving exactly as written — it warns rather than blocking, citing
`lesson_a_rails_important_half_can_be_opt_in`, so worktrees that legitimately lack
the file are not wedged. **It was not edited and not disabled.** The fix is to
install the tool, and that is now the first line of the resume checklist in
`docs/runbooks/indicator-ecosystem-resume.md`, with the one-line copy-in and its
`--self-check`. Recorded because this repo is **public** and "the scan did not run"
reads exactly like "the scan found nothing" to anyone skimming.

### The rig, and the gate every capture passed

The vendor captures were taken on a disposable TradingView layout (`e3cTXatd`,
titled *UCT AGENT VISIT 2026-09-10 (disposable)*), and **gate v2.1** was read on
the driving tab before every browser write and every screenshot:
`visibilityState === 'visible'` **and** `availTop ≤ screenY` **and**
`screenY + outerHeight ≤ availTop + availHeight`.

⛔ **The binding gate is own-text `Add to chart` plus a study probe reading 0** —
not "the editor is closed". An open editor says nothing about whether a capture is
bound to a study; those two facts do. ⚰️ And the study probe was itself caught
being blind once: it returned 0 legend rows, which reads identically to "no
studies", and was only trusted after a control (the Object tree seeing
`SPY · NYSE Arca, 1D`) proved the probe could see anything at all.

---

## 9. Member impact

> ⚰️ **THE FLAG WOULD HAVE BEEN PERMANENTLY OFF IN PRODUCTION — fixed at
> `e6ca532c6`.** `Dockerfile.web` declared no `ARG` for
> `VITE_PINE_MEMBER_PANE_ENABLED`. Railway hands each service variable to the
> build as a build arg and **drops an undeclared one silently**, so setting the
> flag to `1` in Railway would have reached the bundle as `undefined`,
> `memberPaneEnabled()` would have returned `false` forever, and this entire wave
> would have been dark in production — with every test, every audit and every row
> of the flag ledger saying it was ready to flip. It was caught by master's own
> `tests/test_dockerfile_vite_build_args.py` on the merged tree, which is the
> argument for running the full lane after a merge and not only the scoped one.
> **This is the one thing in this PR a reader of the flag ledger would otherwise
> assume worked**, so it is stated here rather than buried in the test evidence.

Nothing changes for anyone today. This work ships switched off, and the switch is
a build constant — a member cannot turn it on, and neither can an admin without a
deploy. When it is turned on, a member who has a TradingView Pine script they
already trust will be able to paste it into UCT Intelligence, save it, and put it
on their own chart, where it draws with our bars instead of TradingView's: the same
plots, in the same colours, in a proper sub-pane, with the script author's own
dashboards in the corners the author chose. On a phone those dashboards are scaled
to fit rather than clipped, because losing a number is worse than losing a font
size. Where our answer differs from TradingView's, the chart says so in a sentence
underneath — how much history the value depends on, that a same-timeframe
`request.security` became the chart's own series, and that an alert condition is
recorded rather than drawn. The one number we cannot yet match exactly is volume,
because our data source rounds to the nearest hundred shares and disagrees with
TradingView's tape by about a tenth of a percent on some days; that is written down
as an open item rather than papered over. Scripts using arrays, loops or runtime
inputs are not supported yet and are refused by name and line number rather than
drawn wrong — a refusal a member can read is the honest answer, and it is the one
this engine gives.

---

## 10. Test evidence, post-merge

Merged `origin/master` at **`da0803baa`** (the branch is level with master: behind
by 0 at the time of writing). Dry-run measured against `368520647` in a throwaway
worktree; the ref store is shared across worktrees on this box and master advanced
18 commits between the probe and the merge, so the merge's second parent is
`384f01159`, of which `368520647` is an ancestor — **the conflict set came back
identical**, which is what keeps the probe evidence rather than a stale reading.
A second, clean merge commit took the remaining drift to `da0803baa`.

### Conflicts — 7, every one a union

| file | resolution |
|---|---|
| `.gitattributes` | keep both; **order load-bearing** — master's `wave_p_cert_corpus/manifest.json -text` must follow our `tools/**/*.json text eol=lf` or the OCR corpus is re-normalised |
| `.gitignore` | keep both; disjoint appends |
| `CLAUDE.md` | keep both; master's `node_modules` junction block given a heading so it is not read as part of our pipe rule |
| `api/services/ticker_explain.py` | **one comment, not two** — both sides deleted the same double binding, code byte-identical; master's unique fact (the rail's name) folded into ours |
| `app/src/components/StockChart.jsx` | keep both named imports; both consumers verified live |
| `app/src/components/chart/pane/ChartPane.jsx` | keep both props |
| `app/src/components/screener/reachable.test.js` | union — **and our block's expiry condition re-argued**: it said "delete when step 6 mounts the runtime", step 6 landed, and the files are still unreachable because D2 keeps the IR lane off the pane. The condition is now "the commit that puts the IR lane on the pane path". |

### JS

| scope | result |
|---|---|
| `npm run test:engine` | **266 files · 5,407 passed · 32 skipped · 0 failed** |
| `chart/engine` + `chart/builder` + `chart/pane` | **356 files · 7,354 passed · 32 skipped · 5 failed in 3 files · 0 timeouts** |
| the sweep suites alone | 4 files · 57 passed · **0 timeouts** |
| the ten rails | 10 files · 89 passed |
| flag-off rails | 4 files · 36 passed |
| corpus metric | re-derived **266 / 31 / 44**, file not rewritten |
| `src/hooks` | 36 files · 273 passed · **1 failed** — see below |

**The 5 reds are the pre-existing HEAD trio, by name**, red before this branch and
outside its diff:

- `BuilderSheet.pine.test.jsx` — *the SAVED DOCUMENT is byte-identical…*
- `ImportBox.thinkscript.test.jsx` — *the Pine door shows the offer and NO button*
- `pineBoxSuggestVoice.test.jsx` — three cases

**The hooks red is R-P, extended by the merge, and is not ours.**
`pollingSites.rail.test.js` names four bare polling sites its 2026-08-09 census
does not hold. Our branch has **0 commits** on the rail and **0** on all four
files. Two (`floor2/hooks/useFloor.js` 5 sites, `hooks/useWatchlistIntelligence.js`
1) already had them at the merge-base — the rail was red on this branch before the
merge and on master. Two arrived with master: `useBoundDrawingAlerts.js`
(`d26695853`, Fibonacci alerts) and `useFilingWatch.js` (`611bcf92e`, the filing
watch flag). The rail asks for a census row *with a reason*, and says in as many
words **"Do NOT add a row to silence this"** — the reason belongs to whoever added
the sites.

### Python

| lane | result |
|---|---|
| scoped ast/bind/parity/fixtures (12 files) | **364 passed · 5 skipped · 0 failed** |
| full 12-chunk lane, once | see the chunk table below |

⭐ **The two inherited reds are GONE.** The baseline carried
`test_the_escape_census_ZERO_is_ATTRIBUTABLE…` and
`test_the_guarded_census_offers_each_case_to_the_DOOR_ITS_CLAIM_IS_ABOUT` as
"red at HEAD, not ours, do not chase". Both are green on the merged tree — master
fixed the conftest interaction underneath them. 339 passed / 2 failed → **364
passed / 0 failed.**

#### The full 12-chunk lane — one run, foreground, redirected, exit code read bare

```
chunk 01/12   129 files  exit=1      red    {'failed': 8, 'passed': 2467, 'skipped': 2}
chunk 02/12   129 files  exit=1      red    {'failed': 1, 'passed': 2124, 'skipped': 6}
chunk 03/12   129 files  exit=0      ok     {'passed': 3117, 'skipped': 1, 'xfailed': 9}
chunk 04/12   129 files  exit=1      red    {'failed': 5, 'passed': 2242, 'skipped': 5, 'xfailed': 1}
chunk 05/12   129 files  exit=1      red    {'failed': 2, 'passed': 1948, 'skipped': 30}
chunk 06/12   129 files  exit=1      red    {'failed': 4, 'passed': 2294}
chunk 07/12   129 files  exit=1      red    {'failed': 9, 'passed': 2592, 'skipped': 5}
chunk 08/12   129 files  exit=1      red    {'failed': 18, 'passed': 2256, 'skipped': 6}
chunk 09/12   129 files  exit=1      red    {'failed': 5, 'passed': 1427}
chunk 10/12   128 files  exit=1      red    {'failed': 16, 'passed': 2194, 'skipped': 4}
chunk 11/12   128 files  exit=1      red    {'failed': 14, 'passed': 2218, 'skipped': 1}
chunk 12/12   128 files  exit=1      red    {'failed': 10, 'passed': 1675, 'skipped': 2}

TOTALS: {'failed': 92, 'passed': 26554, 'skipped': 62, 'xfailed': 10}
KILLED chunks: none
VERDICT: FAIL — red chunks [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]
```

**12 of 12 chunks ran. `KILLED chunks: none`.** chunk logs read: 12   failing cases: 92   failing files: 34.

⛔ **AND THE HARNESS SAID `exit code 0` FOR A RUN THAT FAILED.** The command was
`python tools/pytest_chunks.py … > log 2>&1; echo "EXIT: $?"`, it was backgrounded,
and the status reported back was the **`echo`'s** — the same defect as the pipe
rule in a different costume: the last element of a compound command owns the exit
code. The runner's own `VERDICT:` line in the log is what says FAIL, which is why
that line exists. Read the log, never the wrapper.

#### Every failing file, attributed — measured, never patterned

Each row is `git rev-list --count <merge-base>..<side> -- <file>`. "Pre-merge-base"
means **0 commits on BOTH sides** since `8be420d8f`, i.e. red before this branch
existed and red on master.

| file | cases | ours | master | attributed to |
|---|---|---|---|---|
| `api/routers/stream_bars_test.py` | 6 | 0 | 0 | **master** `2d121371f` — gated `api/routers/stream.py`; the test expects the ungated `503` and gets `401` |
| `api/services/data_sync_test.py` | 2 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 8120fbc48 test(data-sync): the fixture wrote a close ten times above the high |
| `api/services/test_ticker_search_entity_master_integration.py` | 1 | 0 | 0 | **master** `2d121371f` — same commit gated `ticker_search.py` |
| `tests/test_alert_taxonomy_scan_membership_change_compare.py` | 3 | 0 | 2 | **master** `edebd8bf0` · `0c6caf25b` — S7 scan-membership-change CP1–CP3 |
| `tests/test_alert_taxonomy_scan_membership_change_schema.py` | 2 | 0 | 2 | **master** `edebd8bf0` · `0c6caf25b` — S7 scan-membership-change CP1–CP3 |
| `tests/test_calendar_actuals_patch.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch a19679c17 fix(wire): a row that has EPS can now gain its revenue leg â€” pending is field-by-field everywhere |
| `tests/test_calendar_month.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 1214dc246 Modernize A5 (Events & Calendar) onto S3/D1/S8 for the four real event categories |
| `tests/test_corp_actions_census.py` | 3 | 0 | 1 | **master** `9458ea641` — D5 CP1, the corporate-actions census |
| `tests/test_cross_module_imports_resolve.py` | 1 | 0 | 0 | **master** `13fafce74` · `a353596ce` — a REAL dead import — `discord_render/commands.py:34` imports `INTERACTIVE` from a `runtime.py` that does not define it |
| `tests/test_desk_session_recap.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 6bb3a43de Desk recaps: route Live Trading Sessions to dedicated recap channel |
| `tests/test_dockerfile_vite_build_args.py` | 1 | 0 | 3 | **OURS — FIXED** `e6ca532c6` — two of the three undeclared flags were ours; `VITE_CHART_RENDER_TOKEN_PREVIOUS` is the discord-render lane’s (`4821ec3f2`) and is named, not silenced |
| `tests/test_earnings_analysis.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 74be76814 earnings modal: the 20-30s wait was a 5000-bar fetch inside the request |
| `tests/test_exposed_routes_gated.py` | 1 | 2 | 1 | **pre-merge-base** `74e0d302f` — the failure is a `TypeError: Header and str` at `api/flow_admin_auth.py:49`, whose blame is `74e0d302f` — an ANCESTOR of the merge-base, so it is on both sides. Our two commits on this FILE (`80a34f0b8`, `f7dcd9fe5`) touch a different test function: `git show <c> -- <file> | grep -c "test_the_gate_ladder…"` is **0** for both, and the failing function body blames to `ba905f796` |
| `tests/test_flow_aggregate.py` | 5 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 0dd58f5c9 fix(flow): count member traffic apart from the warmer's own calls |
| `tests/test_flow_worker_watch_coverage.py` | 1 | 0 | 2 | **master** `169c1fd53` — S7 price-level CP3 |
| `tests/test_implied_backfill.py` | 15 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 94f29952d fix: the four red tests in the full backend sweep â€” three causes |
| `tests/test_launch_hardening.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 8601d3604 fix(security): the admin guard was written, tested and never installed |
| `tests/test_massive_ws_stop.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 9b4b456cc Tests: de-race the maxconn strike-reset assertion |
| `tests/test_mutation_check.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch e82b31f57 Wave K Slice 5: the prompt boundary -- retrieved content is data, never instruction |
| `tests/test_nb_observe.py` | 2 | 0 | 5 | **master** `eddea6a92` — deployed-copy drift check on the notebook gate |
| `tests/test_no_cr_in_tracked_text_blobs.py` | 1 | 0 | 0 | **master** `b7a0c6f3b` — master’s own two rails disagree: `.gitattributes` declares `tools/wave_p_cert_corpus/manifest.json -text` on purpose, and this rail forbids a CR blob. Blob `a449287f8a82` is **byte-identical to master’s** |
| `tests/test_preference_key_validation.py` | 1 | 0 | 3 | **master** `938d5acbf` — Deploy-B preference-key prep |
| `tests/test_scan_screener_auth.py` | 3 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch c3f6945b5 test(auth): the route pin caught its own author â€” 19 â†’ 20, verified not rubber-stamped |
| `tests/test_screener_wave2_analyst_store.py` | 9 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch b74beb0cd screener: eps-growth pairs (current, next) FY â€” floor out past years, widen past FMP's newest-first edge (final review) |
| `tests/test_screener_wave2_earnings_dates.py` | 4 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch e6eb45f80 screener: earnings-date pull goes one-day-per-call with at-cap detection + ET clock |
| `tests/test_shared_state_landmines.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 0f0752f4f fix(residuals): a real timeout bound, the fourth AUTH_DB_PATH claim, and a rev migration keyed on the TREE |
| `tests/test_ticker_explain.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch ec095a23d Seam 29: thread analyst-source outage signal into Ask AI and Compare |
| `tests/test_ticker_logos.py` | 5 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch b9e42ab5f fix: migrate profile2 off Finnhub to FMP stable/profile (Task 8) |
| `tests/test_ticker_logos_prewarm.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 948883467 feat(calendar): background logo prewarmer over cap_universe |
| `tests/test_ticker_meta.py` | 5 | 1 | 0 | **master** `553f6b68b` · `614036147` — the five failures are all `test_fmp_*`. Our one commit on the file (`1fb020b56`) is **+81 lines, 0 deletions** adding ONE new OTC-tier test and touches none of the five (grep count 0 each) and **0 lines mentioning `fmp`** in the code. The FMP return path blames to four commits; the two after the merge-base are both master’s |
| `tests/test_two_engines_do_not_agree.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 1066caf07 fix(rail): my own test was green alone and red in company |
| `tests/test_vite_flag_ledger.py` | 1 | 0 | 1 | **OURS — FIXED** `b0c26d3b6` — master’s new rail (`294fc28fe`) wants a `build_flags` row for every build-time VITE flag; two of the three named were ours and now have one. `VITE_CHART_RENDER_TOKEN_PREVIOUS` is the discord-render lane’s (`4821ec3f2`) — named, not guessed at |
| `tests/test_web_capture_coverage.py` | 8 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch 37820c0dd Wave L Slice 1b: coverage travels with the evidence, and a captured passage stops pretending to be page 2 |
| `tests/test_yf_guard_binds.py` | 1 | 0 | 0 | pre-merge-base — **0 commits on BOTH sides** since `8be420d8f` · last touch d2bd796fa Charts perf (instant-charts Phase 0+1): instrument index/breadth + cache indices |

**Two were ours, and both are fixed rather than attributed away:**

- `tests/test_dockerfile_vite_build_args.py` → **`e6ca532c6`**. See §9 — the flag
  would have been permanently off in production.
- `tests/test_vite_flag_ledger.py` → **`b0c26d3b6`**. See §2 — master's newer rail
  overrode this branch's ledger reasoning, and the rail was right.

**Two needed measurement before they could be attributed, because our side had
commits on the FILE:**

- `tests/test_exposed_routes_gated.py` — our two commits touch a *different* test
  function (`grep -c` on each commit's diff = 0 for the failing name); the failing
  line is `api/flow_admin_auth.py:49`, blaming to `74e0d302f`, an **ancestor of the
  merge-base**.
- `tests/test_ticker_meta.py` — our one commit is +81/−0, adds a single OTC-tier
  test, and touches **0 lines mentioning `fmp`**; all five failures are `test_fmp_*`
  and the FMP return path's post-base blame is entirely master's.

⭐ One of these is a genuine defect the rail is right to name and it is **master's**:
`tests/test_cross_module_imports_resolve.py` catches
`api/services/discord_render/commands.py:34` importing `INTERACTIVE` from a
`runtime.py` that does not define it.

⭐ And one is **master disagreeing with itself**: `test_no_cr_in_tracked_text_blobs.py`
forbids a CR blob while `.gitattributes` deliberately declares
`tools/wave_p_cert_corpus/manifest.json -text` so the OCR corpus stays bytes
(`b7a0c6f3b`). Our blob is `a449287f8a82`, **byte-identical to master's**.


### Diff

```
$ git diff --stat origin/master...HEAD | tail -1
 1741 files changed, 764499 insertions(+), 2278 deletions(-)
```

⚠️ Measured at **`52b93d025`**, the close-out commit. Re-running it now returns a
few more insertions, because the commits that *record* this number are themselves
part of it — the SHA is given so the figure is reproducible rather than a literal
that drifts every time the document is touched.

Against the merged master `da0803baa`, by area:

| area | files | insertions |
|---|---|---|
| tests/fixtures/vendor | 120 | 409,982 |
| docs/ | 143 | 111,525 |
| corpus/ (the 266 scripts + references) | 803 | 91,136 |
| app/src/components/chart | 260 | 53,766 |
| tools/ | 143 | 52,109 |
| tests/fixtures (other) | 65 | 18,841 |
| tests/ | 67 | 11,022 |
| tests/fixtures/pine_oos | 92 | 9,129 |
| api/ | 31 | 4,912 |
| root config | 9 | 1,109 |
| app/src (other) | 7 | 414 |

Most of the volume is evidence, not code: the vendor captures and the 266-script
corpus with its reference copies. The engine change itself is the
`app/src/components/chart` row.

# Wave 2 — the Pine grammar closes: nine items censused, four built, five retired on their numbers

This wave does not add a feature. It **finishes the grammar** the Wave 1 pane stands on,
and the honest headline is that **most of it was already correct** — five of the nine
items retired on measurement, and two of those retired because a census proved the
engine does the right thing today.

⛔ **The flag is still OFF.** No member-facing behaviour changes here except two
sentences, both of which say *more* than they did before.

---

## What this wave actually changed

| | |
|---|---|
| **Built** | (d1′) a chart-only call **inside a block** is noted · (d2) an alert **message rides beside the title** · (g) the reassign refusal **carries the reason it already recorded** · (h) three `syminfo.*` fields **retire by name** |
| **Retired on their numbers** | (b) time inputs · (e) short-circuit · (f) 44 of 50 nested-text-helper forms · (i) volume provenance · (c)'s IR half, blocked |
| **Frozen and still frozen** | `NODE_TYPES` **11** · `REFUSALS` **41** |

---

## The five findings worth the reviewer's time

### 1. The engine was right more often than the plan assumed, and measurement is what showed it

Three items were priced against premises that **measured false**:

- **(e)** — *"both sides always evaluate today."* True at **run** time, **false at plan
  time**: the engine already prunes the conditional operand in **1,836 of 13,906** uses,
  and across **20,954 conditional operands it is measurably wrong in zero.**
- **(g)** — *"`s := close` is a typing gap."* There is nothing to type. A binding holds a
  **node**, and for `s := close` that node *is* the series. **Only 13 of 266** scripts
  refuse `pine:reassign` at all.
- **(d1)** — *"`alert()` is dropped whole."* It was already noted at top level; the gap
  was **depth**.

Each correction was made **in place, at every site that stated it**, because a sentence
quoted in two places is two authorities.

### 2. A census found a defect in work shipped the same day

(f) measured that (d2)'s **two "expression messages" are not expressions** — they are
string literals whose `+` sits *inside the quotes* (`…Grade A+ - Highest confidence…`).
The corpus holds **489 of 555** carryable and **zero** expressions.

⭐ The carriage was never wrong; **only its sizing was.** What the correction changes is a
fact about the guard: **`pine:alert-message` has zero corpus firings**, and only a
synthetic specimen exercises it. That is recorded rather than left for someone to cite
later as though the corpus had proved it.

⚰️ It is the **same instrument defect twice in one item**, and the second survived the
first correction. Both are *"ask the kind before the literal."* **Fixing one violation of
a rule does not find the others.**

### 3. Two member-facing sentences now name the cause, not just the line

A member whose `varip` accumulator stopped the fold was told *"a name that is reassigned
later cannot be folded into one expression."* True about the line it names, silent about
the cause — which was thirty lines earlier. The closing pass had **computed that reason
and never read it.**

Visible in a committed artifact for a real public script:

> `— \`resistancebroken\`` → `— \`resistancebroken\` — and the fold stopped before it, at
> line 181: a Pine block spans several statements and this engine stores a single
> expression — \`for\``

And three `syminfo.*` fields that were refused **anonymously** through a namespace
fallthrough now refuse **by name**, from the roster whose own manifest says *"the roster
is the thinking."* That fix is **three data entries and no code.**

### 4. What is owed is owed by name, and none of it is hidden

Fourteen rows in one table (`WAVE2-A-PLAN.md`), each with its number and its owner —
including four that belong to **other workstreams** and were recorded with reproductions
rather than crossed into: **BF.B** share-class normalisation, four disagreeing renderings
of today's volume, two vendors filling one `v` column, and the screener's second snapshot
endpoint.

### 5. Wave 1's tolerance has a blind half, and (j) must not inherit it

Wave 1 measured against a frozen `/api/bars` payload whose **last bar is `2026-09-11`** —
**every bar sealed**, which is exactly the half where the pane and screener lanes agree
*by construction*. (i) measured **three live divergence points**, plus **four different
renderings of today's volume inside the pane path alone.** An acceptance that reuses that
procedure unchanged would not exercise the developing bar at all.

---

## Verification

| leg | result |
|---|---|
| full vitest | **EXIT 1** — 1,493 files / 21,497 tests, 11 failed in 8 files, **0 NEW** |
| Python lane, 51 files **by name** | **EXIT 0** — 1,589 passed, 13 skipped, 1 xfailed |
| vite build, alone | **EXIT 0** |

All 11 failures are attributed to the branch's **own recorded baseline**
(`SESSION-STATE:458-466`) and the counts match it exactly.

### Re-verified after master merged in (`b854e75d0`, 223 commits, **zero conflicts**)

| leg | result |
|---|---|
| full vitest | **EXIT 1** — 1,568 files / 22,632 tests, **13 failed in 10 files**, 0 timeouts |
| Python twin, 25 files **by name**, 2 serial scopes | **EXIT 0** — 829 passed, 5 skipped, 1 xfailed |
| vite build, alone | **EXIT 0**, 21.25s — `dropped 36 prose keys, 99.6kB off the bundle` |

⭐ **The count matched the baseline and the SET did not** — two files left it and two
arrived, so a count comparison would have read "back to baseline" and shipped two
unexamined reds. Every one of the 13 is attributed and **none is owned by this
branch**: `surfaces/manifest.test.js` is **master's** (its `App.jsx` declares
`/admin/wisdom` and its surfaces manifest carries no row for it, so master alone is
red) and `stockChartWiring` is the known **intermittent**, re-classified by the rule
that costs a wrong attribution — clean tree, alone, twice, 216/216.

⚠️ One baseline row went green with **no commit touching it**
(`paramSingleTranslation`, previously classed OURS-DEFECT-OWED). Recorded as **cause
not established** rather than closed: "intermittent" and "fixed by something unnamed"
are different facts.

⚰️ The full run's wrapper reported **exit 0** because the command ended in a `grep`. The
verdict above is read **from the log file**. This repo has recorded that defect four
times; this is the fifth — **and the sixth happened in this session**, where a
background wrapper again said *"exit code 0"* for a run whose own log recorded
`VITEST EXIT: 1`, because the command ended in `echo`. A seventh variant was also
caught: `--reporter=basic` does not exist in this vitest, so the runner died at
reporter load **having executed nothing** and produced no totals line at all.

**Moved artifacts, by name:** `27-support-resistance-channels.json`.
**Unchanged:** `corpus_metric.json`, `lookback_agreement.json`.

---

## What is NOT in this PR

- **(j) Uncharted Clouds — j.1, j.2 and j.3a ARE IN; j.3b and j.4 ARE NOT.** The
  `23 → 2` drop was **two independent drops** and **both are closed**: j.1 got all 23
  outputs into the pane document with their **20 fills** (21 carried `hidden: true`),
  and **j.2 made a fill between two hidden anchors draw**, hosted on a visible bound
  series and fed from two columns — **R27 as AMENDED by measurement**: a hidden plot
  binds **no** series, because the fill primitive takes columns and borrows only the
  host's `priceToCoordinate`.
- **j.3a — a fill is drawn as RUNS (R30)** is in: `fillStyle` once per run, a `null`
  colour ends a run and starts no polygon, and the fill goes to `columnColorsForPlot`
  — the **same reader a plot goes to**, so there is no second colour path.
  ⭐ Segmentation is **two-level**: colour decides where `fillStyle` changes,
  finiteness decides where polygons split, so a STATIC band with an `na` hole is
  still one `fillStyle` over three polygons and the shipped call list cannot move.
- ⛔ **j.3b — the translator half — is NOT started, and the reason is a measurement.**
  Clouds' fills still carry **no** colour. The sentence below was written before this
  wave and is still exactly right — what is new is that it is now *costed*:
  `isBullish ? getBullFillColor(0) : getBearFillColor(0)` resolves to
  `{colorDynamic: true}` because `staticColourOf` has **no user-function branch** and
  `color.new(base, t)` refuses a non-literal `t` (`pine.js:12359`) — and Clouds' `t`
  is `getAdjustedTransparency(layerIndex, …)`. Carrying it needs a **constant folder
  over user functions**, which is a parser change whose re-baseline reaches the
  corpus; the owner's standing corollary says such an atomic unit is not *started*
  mid-block. The four insertion points are pinned in `WAVE2-A-PLAN.md`.
- **The vendor capture (j.4)** — owed. And when it runs, **H.8's live-bar line is
  REPORTED, not asserted**: Wave 1's fixture ends at a sealed bar, so it cannot cover the
  live divergence.
- **Alert sets (d3)** — deferred beyond Wave 2 under **H.7**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019qreemr6kQCvfBpHAsprZu
