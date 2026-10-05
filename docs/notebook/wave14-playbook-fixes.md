# Wave 14 — visual playbook fixes (lane W14-PB)

Branch `feat/notebook-w14-pb`, from `c55d73ae69`. Four items from a read-only audit of
the wave-13 visual playbook (`docs/notebook/wave13-13i2.md`) and of lane 13E
(`docs/notebook/wave13-13e1.md`, `wave13-13e2.md`). Nothing here deploys, flips a flag or
touches `C:\data`.

| commit | what |
|---|---|
| `dce71df850` | item 1, backend: the regime filter reads 13E's frozen entry context |
| `f3a24aa852` | item 2 + item 1 client: the sheet opens on the whole playbook; the regime select is live |
| `e7dde4d842` | item 3: a Notebook chart block's buttons clear `--tap-min` on the touch tier |
| this doc | item 4 and the record |

## 1. The regime filter is wired to 13E

**Before.** `visual_playbook.py` returned `{"available": False, "reason": REGIME_UNAVAILABLE}`
on every call ("needs the entry context lane (13E), which is not built yet"), although 13E
had landed.

**The authority.** 13E-1 §1–§4: `j2_entry_context`, keyed `(user_id, symbol, entry_day_et)`,
the entry day being `timeutil.compute_trading_day_et(entry_date)`. Its `fields.regime.value`
is `regime.get_current_regime()` frozen at capture. 13E-1 §1 says a reader that wants *the
market at the fill* uses `at_entry` rows only. The read door 13E built for Python callers
(13F, 13I-2) is `entry_context.contexts_for_trades(uid, trades)`, keyed by the trade's
`id`/`symbol`/`entryDate`, never by position id. The playbook calls that and re-derives
nothing.

**What a card's regime is.** The regime frozen at the entry of the card's primary trade, which
is the trade its outcome already reads (`trades[0]`, newest exit first). The card carries
`regime: {value, status, entryDay[, asOf | missing]}`, where `status` is one of:

| status | meaning | filters as |
|---|---|---|
| `captured` | an `at_entry` row with a regime value | that value |
| `not_captured` | the trade has no context row on its entry day (13E never reconstructs a past day) | unknown |
| `captured_late` | the backfill froze a later day's market, not the market at the fill | unknown |
| `regime_missing` | the row exists, its regime field carries a `missing` code (e.g. `wire_unavailable`) | unknown |
| `no_trade` | no trade is linked to the chart, so there is no entry day | unknown |

With a regime filter set, an unknown card is **excluded and counted** (`regime.excludedUnknown`),
never matched. That is the rule the range filters already follow for missing fingerprint numbers.

**The vocabulary is derived.** `REGIMES` comes from sweeping `regime.classify_regime` over 0–150,
the UCT Exposure Rating's whole scale, best first: `('green', 'amber', 'orange', 'red')`. There is
no typed list and no restated threshold.

**The payload, gate on** (`NOTEBOOK_ENTRY_CONTEXT_ENABLED`): `regime: {available: true, values,
selected, facets (counted before filtering, like the other facets), unknown, excludedUnknown,
unknownReasons, source}`. A bad `regime=` is a 422.

**Gate off: unchanged.** The payload is byte-identical to the pre-13E build: the same
placeholder sentence, no `regime` key on any card, and `regime=` ignored (not refused), the
same as an unknown query parameter before. A rail asserts that `cards(regime=x)` equals
`cards()` for three values, an invalid one included. The visual playbook's own gate
(`NOTEBOOK_VISUAL_PLAYBOOK_ENABLED`) still answers the one 404 before anything is read.

**Client.** When `regime.available` is true, the select is enabled. It lists `values` with their
counts, sends `regime=`, shows "Regime at entry: …" on each card, and says out loud how many
charts a regime filter left out for an unknown regime. When it is false, it renders the old
disabled placeholder unchanged.

**Tests.** `tests/test_notebook_visual_playbook_regime.py`, 11 tests. The context rows are
written through 13E's own `freeze_static` door with caller-supplied fields, so no live
wire/breadth read is reachable. Covered:
- **present:** green and red, case-insensitive, composing with the outcome and range filters;
- **absent:** no row, and a row on a *different* day for the same symbol, which must not answer;
- **unknown:** missing regime value, `captured_late`, and no trade;
- the gate-off equality, the derived vocabulary, the 422, and the route carrying `regime=` with
  the gate on and off.

**Mutation proof** (the restore was verified against the committed blob with `git status`, which
was clean after the run; the control was green before and after):

| mutation | result |
|---|---|
| M1 `captured_late` accepted as the market at the fill | KILLED, 1 failed |
| M2 13E's gate ignored (regime always on) | KILLED, 2 failed |
| M3 an unknown regime counted as a match | KILLED, 4 failed |
| M4 the regime read off a constant instead of the context | KILLED, 4 failed |

## 2. "3 of 5 tagged charts on open": the root cause

**The record.** `wave13-13i2.md` §5 says *"`cards_unfiltered` read 3, not the 5 tagged charts
the walk seeds … `chart_blocks.catch_up`'s `FREEZE_BUDGET`/indexing timing"*. The evidence is in
`evidence/wave13-13i2/walk-e796315fe4/walk.json` (`"cards_unfiltered": 3`).

**The cause was not timing. The sheet was never unfiltered.** `FingerprintPanel.jsx` mounts the
sheet with `initialSetup={ta?.setupTag}`, and `VisualPlaybookBody` seeded its Setup filter from
it (`useState(tag ? \`tag:${tag}\` : '')`). The walk opens the playbook from the NVDA chart, which
W2 had just tagged VCP. So the first request was `?setup=VCP`, and the grid showed the walk's
three VCP charts (AMD, TSLA, NVDA) out of five (plus MSFT Flat Base Breakout and META Bull Flag).
The run's own screenshot `w3-playbook-all-1200.jpg` shows **"VCP (3)"** selected in the Setup
select. `catch_up` never drops a block from the list. A block that is still pending a freeze is
listed with no fingerprint, so the indexing hypothesis could not produce a short grid in the
first place.

**Fix.** The sheet opens on the whole playbook. The chart's own tag is now a visible one-tap
shortcut ("Only this chart's setup (VCP)"), with "Show all N tagged charts" as the way back. N is
the facet total, which the server counts before filtering.

**Regression test.** `VisualPlaybook.test.jsx`: *"opens on the WHOLE playbook even when opened
from a tagged chart"* asserts that the first request carries no `setup` and that the select is
empty. On the old initializer (restored by mutation, then reverted, `git status` clean) this test
and the shortcut test both fail: **2 failed | 13 passed (15)**.

⚠️ `tools/notebook_w13i2_walk.py`'s `cards_unfiltered` is now what its name says. The walk was
**not** re-run in this lane, and no browser was driven. The fix is proved at the unit layer only.

## 3. ChartEmbed touch targets

`ChartEmbed.jsx` renders StockChart at `density="mini"` (ChartPane drops its own chrome at
`mini`). The buttons StockChart can still show inside an embed are derived from source, not
listed by hand:

| class | size | when |
|---|---|---|
| `.scaleToggleBtn` (A / L / %) | 9px type, ~11px box | always |
| `.chipMore` (`+N`) | 20px | horizontal legend with folded chips |
| `.studyMore` (`+N more`) | 14px | stacked legend with folded rows |
| `.toPresentBtn` (back to latest) | 26px | live or peek-to-now embed, scrolled back (snapshots pass `replayCutoff` and never show it) |

All four were under `--tap-min` on phone and tablet. 13I-2 fixed this only for
`TradeBeforeAfter`, by hiding the chrome.

**Fix, tokens only.** The embed's figure carries `data-notebook-chart-embed`.
`StockChart.module.css` and `IndicatorChip.module.css` declare `min-width` / `min-height:
var(--tap-min)` for the four classes under `@media (max-width: 1024px)`, scoped
`:global([data-notebook-chart-embed]) .x`. The pattern is the same as the existing
`html[data-mobile-chart-shell]` scope. No colour, no px literal. Every other chart surface is
byte-identical.

**Rail.** `ChartEmbed.touchTargets.test.js`, 8 tests:
- **Derivation.** It derives every `<button className>` class from `StockChart.jsx`, reading the
  className brace-balanced. A non-vacuity check names the four fixed classes.
- **Exclusions.** It excludes `goLivePill` and `rangeBtn` only by assertion: the embed must never
  name `showGoLive`, and must pass `showRangeSelector: false`.
- **Floor.** It asserts each target is pinned to the token for both properties at 390 and 820.
  It also checks the wire attribute, that desktop is untouched, and that the scoped rules use
  tokens only.
- **Controls.** A phone-only floor, an unscoped floor and a literal-px floor each fail.

The app-wide `styles/tapFloor.test.js` stays green.

**Mutation proof** (`git status` clean after the run):

| mutation | result |
|---|---|
| drop the `toPresentBtn` floor | KILLED, 1 failed |
| `chipMore` floor as literal `44px` | KILLED, 2 failed |
| remove the attribute from `ChartEmbed.jsx` | KILLED, 1 failed |

⚠️ This is a structural rail. jsdom lays nothing out, and no device or `tools/mobile_audit.py`
pass was run. The `.scaleToggle` panel grows from about 40px to 132px wide on touch embeds.
`.studyMore` now overruns the 22px row that the fold reserves (`STUDY_ROW_PX`), by about 22px,
on touch only. Both are worth a look on a real tablet.

## 4. `entry_context.freeze_static`: who calls it

Left in place, as instructed.

- **At the base `c55d73ae69`:** `git grep freeze_static` matches only its definition
  (`entry_context.py:604`, `:619`), the docstring of `forget` (`:645`) and
  `wave14-integration.md:290`. It has **no caller in `api/`, `tools/`, `scripts/` or `app/`, and
  no test calls it.** ⚠️ `wave14-integration.md:290` says *"its own tests remain"*, which is
  false at that SHA: no test file mentions it.
- **On this branch:** its only caller is `tests/test_notebook_visual_playbook_regime.py` (3
  references). The test uses it as the seed door for context rows, because it writes through
  13E's real INSERT OR IGNORE with caller-supplied fields and makes no live read. That is a test
  use, not a product caller. The delete-or-keep call stays with W14-E's owner. If it is deleted,
  those tests need a direct INSERT helper instead.
- Its sibling `entry_context.forget` **is** still called, from
  `sample_examples.py:475` (`entryContextDeleted`).

## 5. Verification (this session, totals lines read from the run)

```
python -m pytest tests/test_notebook_visual_playbook.py tests/test_notebook_visual_playbook_regime.py tests/test_notebook_entry_context.py -q
  -> 63 passed
npx vitest run src/pages/journal-2-0 --maxWorkers=2
  -> Test Files  5 failed | 618 passed (623)
     Tests  5 failed | 7872 passed | 1 skipped (7878)
```

None of the five touches this lane's code, and each was re-read before being classified:

- **3 source-scan rails timed out at 15 s** while the box sat at 100% CPU with 1.2 GB available.
  They took 20–37 s in the full run, and 34 s even when re-run alone at `--maxWorkers=2`. These
  are `captureContext` "every door", `VoiceInputButton.ref` "no caller passes a ref", and
  `setContentEmitsUpdate` / `offline/baseline` source contracts.
  - At `--maxWorkers=1 --testTimeout=120000`, `captureContext` (11) and `VoiceInputButton.ref`
    (7) give **18 passed (18)**.
  - When the five were re-run alone, `setContentEmitsUpdate` and `offline/baseline` **passed**.
  - So these are load, not code.
- **`iteratorGlobalFloor` "every built asset is clear"** reads `app/dist/assets`, and this
  worktree has no build: *"app/dist/assets missing — run `npm run build`"*. That is an
  environment precondition, not a test result. No build was run, because of the box's memory
  pressure.

``````

## 6. Open items

- **The regime placeholder sentence still says "not built yet" while 13E's gate is off.** It is
  kept byte-identical because the brief requires flag-off behaviour to be unchanged. Rewording it
  ("…which is switched off") is a one-line owner call.
- **A card with several linked trades filters on its primary trade's regime only.** That is the
  same trade its outcome reads. A per-trade regime breakdown inside one card is not built.
- **The 13I-2 walk was not re-run** (no browser in this lane). Its next run should read
  `cards_unfiltered` as 5.
- **Other `density="mini"` StockChart hosts keep the gap:** OptionsFlow's 320px column and the
  chart builder's preview. The scope attribute is per-host on purpose.
- **Device check of item 3 is owed.** See the two layout notes in §3.
