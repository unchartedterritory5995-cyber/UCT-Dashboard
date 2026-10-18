# P4a verify-before-building (Task 1)

Run id `2026-10-17T13-29-31` (UTC). Raw output: `docs/notebook/evidence/p4a-verify-2026-10-17T13-29-31/`.
Base: `origin/master` at `f2e816e04229b6b3cf750cd097cbd99d18faf0fe`, branch `notebook-p4a-layouts`, worktree
`C:\Users\Patrick\uct-worktrees\notebook-p4a`. No product code was changed. `J/` below means
`app/src/pages/journal-2-0/`.

Everything here is read from the files at that SHA, or measured in the logs named. A sentence marked
"read, not run" is an inference from source and was not executed.

## V1. Base SHA

`git worktree add ... origin/master` printed: `HEAD is now at f2e816e042 Merge pull request #368 from
unchartedterritory5995-cyber/fix/focus-small-loose-ends`. Full SHA `f2e816e04229b6b3cf750cd097cbd99d18faf0fe`.

## V2. Today's render block and gates

`J/surfaces/TodaySurface.jsx:98-257` is the whole render side of the file. Line 98 is
`const scopeNote = scopeActive ? (` and line 257 is the closing `}` of the file. The gates, in order:

| line | gate |
|---|---|
| 110 | `if (isLoading) {` skeleton, routes to nothing until the position, option and comparison fetches settle |
| 143 | `if (showFirstReport) {` First Edge Report replaces the normal lead |
| 154 | `if (zeroData) {` TodayZeroData |
| 156 | `} else if (allAccounts) {` TodayAllAccountsLead |
| 158 / 160 | `} else if (session === 'premarket') {` / `} else if (session === 'market') {`; the final `else` is postclose |
| 183 | `<CoachStrip accountId={accountId} />` (always, renders null when empty) |
| 188 | `{!zeroData && (` week strip, goals, quick actions |
| 196 | `{account && <GoalProgress account={account} progress={overview?.goal_progress} />}` |
| 201 / 215 / 231 | `modal === 'import'` / `'trade'` / `'position'` |

Today ignores Scope (header comment line 14; the `scopeNote` at 98-103). "Unchanged since the map": the map was not
available to this task, so only the line range and the text above are confirmed. Last commit touching the file:
`37d608967a fix(notebook): Stage A Bucket A`.

## V3. Does any rail require a `NOTEBOOK_` prefix for a `NOTEBOOK_FLAGS` row?

**No rail requires the prefix.** `NOTEBOOK_FLAGS` is `api/routers/auth.py:144`, and a live row without the prefix
exists: `api/routers/auth.py:159`

    "J2_SHARE_LINKS_ENABLED": False,         # enablement  — unset means OFF (share links, lane 8B)

and `tests/test_notebook_flag_parse.py:73` lists it as a first-class row:

    WAVE8_FLAGS = ("J2_SHARE_LINKS_ENABLED", "NOTEBOOK_PUBLISH_ENABLED", "NOTEBOOK_ONBOARDING_ENABLED")

The payload key is `env_name.lower()` (`api/routers/auth.py:295-301`, `_notebook_flag_key`), with no prefix logic.
`tests/test_notebook_flags.py` pins the key list by name (line 31 `"j2_share_links_enabled"`) and
`test_K_R6_...` (line 119) derives each key from `_notebook_flag_key`, not from a prefix.

The one prefix-dependent line is `tests/test_notebook_flags.py:176`, and it is a scan, not a requirement:

    if "os.environ" in line and "NOTEBOOK_" in line:

It only looks for a module-level `os.environ` read of a name containing `NOTEBOOK_`. A row without the prefix would
escape that one scan (so it would not catch a module-level capture of it). It does not fail a prefixless row.
`tests/test_notebook_flag_parse.py` scans by name against `NOTEBOOK_FLAGS` keys (`names = set(auth_router.NOTEBOOK_FLAGS)`,
test lines 233 and 289), so it covers a prefixless row.

## V4. Preference keys and validation

`api/routers/auth.py`:

- `_PREF_OPAQUE = "opaque"` at 2800; `_PREFERENCE_KEYS = {` at 2807, closing `}` at 2935. Values are a schema id.
- Named-schema examples: `"indicator_templates": "indicator_templates",` (2839) and `"joystick_hub": "joystick_hub",` (2842).
  `"theme": "theme"` is a closed-value key (`_CLOSED_VALUES`, 3051).
- `_validate_preference(key, value)` at 3116:

      schema = _PREFERENCE_KEYS.get(key)
      if schema is None: raise HTTPException(status_code=400, detail=f"Unknown preference key '{key}'.")
      if schema == "joystick_hub": _validate_joystick_hub(value)
      elif schema == "indicator_templates": _validate_indicator_templates(value)
      elif schema in _CLOSED_VALUES: _validate_closed_value(key, value)

  So a new named schema needs: a row in `_PREFERENCE_KEYS`, a `_validate_<key>(raw)` function (model:
  `_validate_indicator_templates` at 3077, which takes a JSON string, accepts `""`/None, bounds size at
  `_INDICATOR_TEMPLATES_MAX_BYTES = 262144`, carries unknown fields), and an `elif` branch in `_validate_preference`.
- `tests/test_preference_key_validation.py:228` `test_every_key_the_client_writes_is_still_accepted` derives every
  key the client writes by scan and POSTs it. For a named-schema key it uses `shaped = {"joystick_hub": "{}",
  "indicator_templates": "[]"}` (line 250); any other non-opaque new key falls back to the value `"x"`, so a new named
  schema key must be added to that `shaped` dict with its smallest valid value or this rail posts `"x"` and gets a 400.

## V5. usePreferences / parsePref / setPrefMerged

`app/src/hooks/usePreferences.js`. The brief's cited lines have drifted; current lines:

- `parsePref(raw, fallback)` line 31: `if (raw == null) return fallback`; non-string returns as-is; else `JSON.parse`, fallback on throw.
- `export default function usePreferences(enabled = true)` line 237. Returns (line 385)
  `{ prefs, setPref, setPrefMerged, loading: isLoading }`. `prefs` is `{ ...DEFAULTS, ...data }` (DEFAULTS = `default_chart_tf: 'D'`, `theme: 'oled'`).
- `setPref(key, value)` line 246: non-string values are `JSON.stringify`'d; optimistic cache write; resolves **`true`** when
  the write is confirmed, **`false`** on a non-ok answer (cache untouched) and `false` on a thrown fetch (cache reverted).
- `setPrefMerged(key, updater)` line 346: `updater(current)` runs inside the SWR cache update; `current` is
  `parsePref(base[key], undefined)`; returning `undefined` abandons the write (no request); a throwing updater re-throws.
  Resolves with the queued write's `postPref` result (`{ ok: true }` / `{ ok: false, ... }`), or `undefined` when
  abandoned or after a reverted failure. It does **not** resolve a boolean, unlike `setPref`.
- Writes are per-key queued at module level (`queueWrite`).

## V6. `useJ2DayDetail`, `useJ2DayNotesMutation`, DayRulesChecklist

- `J/hooks/useJ2DayDetail.js:11` `useJ2DayDetail(date, accountId, basis)`. Key (line 16):
  `date ? \`/api/j2/calendar/day/${date}${qs}\` : null` where `qs` carries `account_id` and `basis` when truthy.
  Returns `{ metrics, trades, strategies, notes, isLoading, error, refresh }`; `notes` is `data?.notes ?? null`.
- `J/hooks/useJ2DayNotesMutation.js:11` `useJ2DayNotesMutation(date)` returns `{ save, saving, error }`.
  `save` is declared (line 19) `async ({ notes, attachments, rules })`, PUTs `/api/j2/calendar/day/${date}/notes` with
  body `JSON.stringify({ notes, attachments, rules })` (line 34), and resolves `true`/`false` (or `null` when `date` is falsy).
- The exact basis DayDetailPage passes (`J/components/calendar/DayDetailPage.jsx:81-85`):

      const effectiveBasis = isBroker
        ? parsePref(prefs.j2_calendar_pnl_basis, 'account')
        : 'closed'
      ...
      useJ2DayDetail(valid ? date : null, accountId, effectiveBasis)

  `useJ2DayNotesMutation(valid ? date : null)` is line 86, and `<DayRulesChecklist ... onSave={save} saving={saving}>` is line 177-185.
- DayRulesChecklist's `onSave` contract (`J/components/calendar/DayRulesChecklist.jsx:39, 48, 54`):

      onSave({ notes, prepNotes, midDayNotes, recapNotes, attachments, rules: next })  ->  Promise<boolean>

  It reads `ok` as truthy/falsy (`if (ok) ... else setError(...)`), so any `onSave` must resolve a boolean. Props: `notes,
  prepNotes, midDayNotes, recapNotes, attachments, rules, onSave, saving`. `MAX_RULES = 25`. Rules are `{ id, label, checked }`.
  There is no test file for DayRulesChecklist (see "Differs").

## V7. MyRulesBlock

`J/components/notebook/blocks/MyRulesBlock.jsx:39` `export default function MyRulesBlock({ params, editable })`.
Read-only (`editable` falsy):

- the edit form never opens: line 109 `const formOpen = editable && !dismissed && editing?.id === rule.id`;
- the Edit button is not rendered: line 148 `{editable && (`;
- the "Before entry" switch IS rendered but disabled: line 143 `disabled={!editable || busy === rule.id}`;
- the list (label, evidence, version line, dismissed marker) still shows.

The "pick an account" path is `ACCOUNT_LINES` at line 29-33 and the early return at line 59:

    'no-account': 'Your rules show here when one account is selected.',
    'no-accounts': 'Your rules show here once you have a Journal account.',
    'accounts-error': "Your accounts couldn't load, so your rules aren't shown.",
    if (Object.hasOwn(ACCOUNT_LINES, rulesState)) return <p className={styles.muted}>{ACCOUNT_LINES[rulesState]}</p>

`rulesState` comes from `useMyRulesSources` (`J/hooks/useMyRulesSources.js`), whose states are
`'loading'|'no-account'|'no-accounts'|'accounts-error'|'error'|'ready'`. Loading and error return `BlockLoading` / `BlockError` first (lines 57-58).

## V8. Trade page sections (`J/components/trade/TradeDetailPage.jsx`, render block 567-964)

Order of the render block, with the state each reads:

| # | line | section | reads |
|---|---|---|---|
| top | 570 | top bar: back link, prev/next | `backTo`, `prevId`, `nextId` (from `useJ2Trades` + URL filters) |
| 1 | 591 | Outcome header `<header identityRow>`: symbol, side, result, head actions (Replay, Save to Notebook, card actions, Share to Floor, research menu) | `trade`, `tf` |
| 1 | 618 | `LinkedNotesPanel` (only if `trade.id != null`) | `trade.id` |
| 1 | 623 | `EntryContextCard kind="trade"` (only if `trade.id != null`) | `trade.id` |
| 1 | 630 | `PlanGradeCard` inside `Suspense`, only while `planGradingEnabled()` | `trade`, `patchTrade`, `navigate` |
| 1 | 641 | outcome grid `data-testid="trade-outcome-grid"`: Net P&L, P&L %, R-multiple (with the add-stop form), Hold time, Exit efficiency, True R | `out`, `excursion`, `addingStop`, `stopInput` |
| 2 | 745 | Chart card: `ChartPane` + foot (legend hint, date-only caption) | `trade`, `tf`/`setTf`, `chart.markers`/`chart.priceLines`, `isDateOnly`, `notesRef` |
| - | 797 | `patchError` alert line | `patchError` |
| - | 799 | `TradeBeforeAfter`, only when `notebookFlag('notebook_visual_playbook_enabled') === true` | `trade.id` |
| 3 | 805 | The story `<section>`: Setup select, `AdherenceChecklist`, `TagSuggestions`, Mistakes picker, Emotions picker, Notes textarea, Screenshots | `trade`, `settings`, `setupOptions`, `tagSuggestions`, `notesDraft` |
| 4 | 892 | Executions `<details>` (broker activities when `isBroker && brokerActivities.length > 0`, else Entry/Exit rows) | `brokerActivities`, `trade` |
| 5 | 939 | Compass post-mortem, only when `isPaid` | `review`, `reviewLoading`, `reviewError` (`useTradeReview(accountId)`) |

State at the top of the component (line 335+): `useParams` id, `tf`, `notesDraft`, `addingStop`, `stopInput`,
`patchError`, `useSWR('/api/j2/trades/${id}')` giving `trade` and `brokerActivities`, `useJ2Trades`,
`useJ2SelectedAccount`, `useJ2Settings`, `useIsPaid`, `useFeatureFlag('tagSuggest')`, `useTradeReview`.
Every write goes through `patchTrade(patch, optimistic)`.

## V9. a11y population

**No a11y population covers Today or the trade page itself.**

- `J/a11y/population.js` `derivePopulation()` reads `components/notebook/*.jsx`, `.../export`, `.../import`, `.../blocks`,
  `tabs/NotebookTab.jsx`, and three Settings cards (`PersonalApiCard`, `InboundEmailCard`, `BrowserCaptureCard`). It does
  not include `surfaces/TodaySurface.jsx`, anything under `surfaces/today/`, or `components/trade/TradeDetailPage.jsx`.
- A grep of `J/a11y/` for `TodaySurface` and `TradeDetailPage` finds only `phoneOverflow.test.js` (a CSS check on
  `TradeDetailPage.module.css`) and `cssAudit.js`/`notebookSurfaces.js` entries for individual trade cards.
- Journal-side surfaces with their own axe recipe are listed in `OUTSIDE_POPULATION_SURFACES` in
  `app/src/pages/journal-2-0/a11y/notebookSurfaces.js` (line 297; `OTHER_LANES_OUTSIDE_POPULATION` is at line 284 and is a different, lane-owner list).
  It already holds trade-page cards: `components/trade/PlanGradeCard.jsx` (recipe `plan-grade-card`),
  `components/trade/TradeBeforeAfter.jsx`, `components/EntryContextCard.jsx`. Each entry is
  `{ recipe: '<id>', railFile: 'a11y/<x>.a11y.test.jsx' }`, and `surfaceCoverage.test.js` checks that the id is registered by an
  `axeSurface('<id>', ...)` call in a rail file (`a11y/surface.js`).
- So a P4a recipe goes in a new `app/src/pages/journal-2-0/a11y/<name>.a11y.test.jsx` calling `axeSurface('<id>', recipe)`,
  plus one entry per file in `OUTSIDE_POPULATION_SURFACES`. The derived Notebook population array is not the place.

## V10. Measured first-open closure (base, after `npm run build`)

`npm run build` in `app/` finished (`built in 44.04s`, log `npm-build.log`). From the worktree root:
`python tools/notebook_perf_budgets.py --dist app/dist --json docs/notebook/evidence/<run>/perf-budgets.json`
(flags read from the tool's argparse: `--budgets --dist --bench --budget --ratio --curve --json`). Output:

    bytes.notebook_first_open: 2,259,916 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
    VERDICT: PASS -- within every budget checked

**Headroom under the budget is 877 bytes** (2,260,793 - 2,259,916). Any change that adds more than 877 B to the
Notebook first-open closure fails the byte budget. Largest chunks: `index-DuCWD7PS.js` 576,354; `vendor-react` 378,377;
`NotebookFlagGate` 352,557; `tiptap` 282,859; `index-DNiYcbSA.js` 216,080 (full list in `perf-budgets.json`).

## Base reds (measured on the base, each file run alone)

See `task-1-report.md` for the full table. Summary: `keyListenerCensus.test.js` (2 tests) and `test_notebook_flag_parse.py` (2 tests)
are red on the base; every other named file is green. `DayRulesChecklist*.test.jsx` matches no file.

| file | result (log) |
|---|---|
| `J/surfaces/TodaySurface.test.jsx` | 26 passed (`vitest-TodaySurface.log`) |
| `J/components/trade/TradeDetailPage.test.jsx` | 32 passed |
| `J/components/notebook/NoticesBox.test.jsx` | 14 passed |
| `J/components/calendar/DayRulesChecklist*.test.jsx` | no such file |
| `app/src/hooks/usePreferences*.test.js*` (6 files) | 55 passed |
| `app/src/styles/tapFloor.test.js` | 5 passed |
| `app/src/components/screener/reachable.test.js` | 17 passed |
| `app/src/pages/command/keyListenerCensus.test.js` | **2 failed, 5 passed** |
| `tests/test_preference_key_validation.py` | 27 passed |
| `tests/test_notebook_flags.py` | 61 passed |
| `tests/test_notebook_flag_parse.py` | **2 failed, 279 passed** |
| `tests/test_feature_flag_ledger.py` | 408 passed |

## Differs (plan or brief versus the code)

1. **No test file for DayRulesChecklist.** The brief's glob `J/components/calendar/DayRulesChecklist*.test.jsx` matches nothing; only
   `DayRulesChecklist.jsx` and its `.module.css` exist. `DayDetailPage.test.jsx` mocks `DayRulesChecklist`, `useJ2DayNotesMutation` and
   `useJ2DayDetail` away (lines 21, 31, 38), so the checklist and the save path have no test at all.
2. **`useJ2DayNotesMutation.save` drops three of the four narrative fields (read, not run).** DayRulesChecklist, DayAttachments and
   DayReflection all call `onSave({ notes, prepNotes, midDayNotes, recapNotes, attachments, rules })`, but `save` (`useJ2DayNotesMutation.js:19`)
   destructures only `{ notes, attachments, rules }` and PUTs only those (line 34). The server replaces the row and reads a missing narrative
   key as `""` (`api/services/journal_two/calendar.py:1174-1184`, `upsert_day_notes` 1187+), so a save that carries no
   `prepNotes`/`midDayNotes`/`recapNotes` blanks them. The optimistic data is also `{ notes, attachments, rules }`. Any P4a surface that reuses
   `onSave` inherits this; it needs a decision before it is built on.
3. **The mutation hook's cache key has no query string, the detail hook's does (read, not run).** `useJ2DayNotesMutation.js:16` uses
   `/api/j2/calendar/day/${date}`; `useJ2DayDetail.js:16` uses `/api/j2/calendar/day/${date}?account_id=...&basis=...`, and DayDetailPage always
   passes a non-empty basis. SWR matches a string key exactly, so the optimistic write and the `revalidate: false` result land on a key the page does not read.
4. **Cited lines in V5 have drifted.** `:303` and `:332` are now `setPref` at 246 and `setPrefMerged` at 346; `parsePref` is 31 (brief: 28-32).
5. **V2 "unchanged since the map"** cannot be confirmed without the map. The range 98-257 matches the file's text and end.
6. **V9: the brief says "`J/a11y/`" holds the population.** The derived population (`population.js`) is Notebook-only; the Journal-side list is a
   separate hand-kept map, `OUTSIDE_POPULATION_SURFACES` (`notebookSurfaces.js:297`).
7. **V10 headroom is 877 bytes.** The budget file leaves almost nothing for new first-open code on the Notebook route.
8. **Base reds.** `keyListenerCensus.test.js` and `test_notebook_flag_parse.py` are red on the base (details in `task-1-report.md`).
