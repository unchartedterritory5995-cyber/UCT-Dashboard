# Indicator ecosystem — session resume state

**Written 2026-09-09 before a planned machine restart.** Everything below is
recoverable from git and the repo alone; nothing lives only in a chat window.

---

## Where the work is

| | |
|---|---|
| Worktree | `C:\Users\Patrick\uct-dashboard\.claude\worktrees\indicator-ecosystem` |
| Branch | `worktree-indicator-ecosystem` |
| HEAD | `ae2ed68ec` — *barstate: six columns from the clock and the fetch* |
| Working tree | clean (tracked). Untracked: `tests/fixtures/pine_oos_staging/` and `tools/c*_out*/` — both pre-date this wave, neither is ours |
| Pushed? | **No.** Nothing has reached `master` and nothing may without an explicit "deploy" from the owner plus a plain-English member-impact paragraph |

### The four commits of this wave, newest first

```
ae2ed68ec  barstate: six columns from the clock and the fetch, one refusal, two named gaps
f55350c0a  containment at the STORE door, the innermost-refusal rule, and a routed red
cd078bbd2  syminfo Kind 4: symbol-scoped names, bind-time text, and a rail on the runner
e71675388  bind fold: JS mirror + pinned parity fixture; bundler fails loud on unknown keys
```

`git log --format='%h %s' e71675388~1..HEAD` reproduces that list. Each message
carries its own argument — read them before re-deriving anything.

---

## How to check the state is still what this says

```bash
cd C:/Users/Patrick/uct-dashboard/.claude/worktrees/indicator-ecosystem

# the engine, through the NAMED command (this is the point of suiteCoverage.test.js)
cd app && npm run test:engine        # expect: 220 files, 4745 passed, 4 skipped

# the Python half
cd .. && python -m pytest tests/test_ast_interpret.py tests/test_ast_conformance.py \
  tests/test_indicator_compute.py tests/test_vendor_truth.py tests/test_ast_bind_fold.py \
  tests/test_ast_bind_parity.py tests/test_user_definitions.py \
  tests/test_requirement_consumers.py tests/test_member_fixtures.py \
  tests/test_starter_library.py -q       # expect: 339 passed, 2 failed (both inherited)
```

⛔ **`npm run test:engine`, never a narrower path.** Three directories went unrun
in this wave because a narrower path was reported as "the engine suite".
`app/src/components/chart/engine/__tests__/suiteCoverage.test.js` is the rail
that now makes that impossible; it is mutation-checked both ways.

### The two Python failures are INHERITED and are not ours

```
tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE_and_the_reconciliation_says_so
tests/test_ast_conformance.py::test_the_guarded_census_offers_each_case_to_the_DOOR_ITS_CLAIM_IS_ABOUT
```

Both reproduce at HEAD with our files reverted; both are green outside pytest and
red under the repo-root `conftest.py`. Full repro, both outputs and the evidence
are in **`requests.md`** at the repo root, addressed to the session that owns the
conftest. **Do not chase them and do not claim repo-green.**

A third, `tests/test_no_shadowed_definitions.py`
(`ticker_explain._DOMAIN_FETCHERS` bound twice), is already on the known-issues
list.

---

## Measured facts to re-quote rather than re-derive

**Volume's refusal list at `ae2ed68ec`** (measured, not remembered):

```
SCREENER (lenient)   ok=false  outputs=5  refusals=5
  4 × pine:function  line 225  — `ta.cum` for a SCREEN
  1 × pine:window    line 233  — argument 2 of `ta.sma`

HOST (strict)        ok=false  outputs=5  refusals=4
  3 × pine:window    line 233  — argument 2 of `ta.sma`
  1 × pine:reassign  line 250  — `volD`
```

⭐ Every line number in that list comes from `grep -n` on the on-disk fixture
`tests/fixtures/member/uncharted-volume.pine`, per the owner's standing rule.

To re-measure: write a throwaway `__probe_volume.test.js` under
`app/src/components/chart/engine/ast/`, call `translatePine(SRC)` and
`translatePine(SRC, { strict: true })`, print `refusals`, then delete it. A
vitest file is used rather than a bare `node` script because the manifest is a
JSON import that node will not load without an import attribute.

---

## What is next, in the owner's order

1. **Wire the bind-time fold into the translate path.** Line 233 still refuses
   `pine:window` because `fold_bound` / `foldBound` are built, railed and
   cross-lane-pinned but not yet called by the door. This is the single change
   that clears the largest remaining refusal.
2. **Line 226 — the ratio-symbol tests at pane level** (owner §3): four plots
   `na` on a synthetic ratio symbol via the witness-map parameter; four non-`na`
   on a synthetic equity; four `na` when `ta.cum(nz(v)) > 0` is false; and the
   screener contract asserted to produce `na` columns rather than an error.
3. **Tuple `request.security` at line 259** (owner §4): quote the call from disk
   first, then **measure on TradingView before building** — tuple field order,
   forming vs closed HTF bar, `gaps=`/`lookahead=` defaults, `na` before the
   first HTF bar, and the same-timeframe case.
4. **Volume through strict mode** (owner §5) — paste both contracts verbatim in a
   fenced block at the END of the turn.
5. **M1 — Volume's numeric plots as a pane behind the flag** (owner §6).
   ⚠️ **The owner's §6 message was truncated mid-sentence at "Feature fl…"** —
   ask for the tail before starting M1.

### Deferred to the next TradingView visit (window visible AND focused, asserted first)

* the barstate realtime capture at the open;
* the live Aroon pane read (Ruling 2c);
* the fold-pass vendor probe (Ruling 1g);
* the tuple-security measurements in item 3 above;
* ⚰️ the `syminfo.prefix` / `tickerid` capture — **DONE 2026-09-10, and the prediction held
  exactly**: `symbolScope.json::confirmed` was empty on purpose, the capture landed six
  witnessed rows, and both fields now serve **with no code change to the fold**, precisely as
  this line said they would. ⛔ The field was named `syminfo.exchange` here; no such identifier
  exists in Pine v6 (CE10272) and the binding is now `syminfo.prefix`. Six store spellings
  serve; the FMP free-text half still refuses per binding.

### Smaller open items

* Pane **data-notes disclosure** for the barstate early-close gap and for
  `window_dependent` — needs the pane, so it rides with M1.
* **Pipeline backlog item**: NYSE half-day (1pm ET) closes beside
  `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`. `barstate.test.js` asserts the current
  defect on purpose and will go red by name the day that set lands.
* Screener/pane **re-fold tests** (Ruling 1 e–f) and `docs/pine/` fold
  documentation (Ruling 1h).
* Clouds linemap: record both counts with units, resolve 23-plots-vs-22-colorers,
  confirm 20 fills vs 21 boundaries, write the `^plot(` census trap into
  `docs/pine/` and check `tools/pine_survey/` handles the assignment form.

---

## One decision waiting on the owner

**`barstate.isnew` is now refused on BOTH contracts.** It folded to `1` for the
screener until `ae2ed68ec`. The ruling said "refused this wave" and the fold was
a restatement of the question — but it is a **shipped-behaviour change**: a screen
that spelled it translated before and refuses now. Flagged in the commit message
and in the last report; say the word and the screener fold is restored.

---

## Standing rules that survive the restart

* **Nothing reaches `master` without an explicit "deploy"** plus a one-paragraph
  plain-English summary of what members will see change.
* **Pause conditions:** member data, a vendor contradiction, the other session's
  files, or a real blocker.
* **Per-turn report format:** commit hash · what a member would see with the flag
  on · Volume's refusal list **verbatim** · any expired proof recorded rather
  than patched.
* Merge `origin/master` into the branch at least weekly, each merge its own
  commit with a conflict summary.
* Deploy checklist: `docs/runbooks/indicator-ecosystem-deploy.md`.
