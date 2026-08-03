# Decision: `engineEnabled` is false in every stored blob, and no phase plan has a settings migration

**Decision id:** `ENGINE_ENABLED_MIGRATION`
**Status:** 🟡 **OPEN — nothing is broken today and nothing may be changed on this branch. This is the owner's and B5's call, written down and gated so it cannot be forgotten.**
**Owner of the read:** `app/src/components/chart/chartDefaults.js` → `mergeChartSettings`.
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B3 Task 10, as the reason its brief's two requirements could not both hold. **Carried unresolved** by Tasks 10, 11 and 12. **Written down and gated:** Task 13, the whole-branch gate.
**Pinned by:** `app/src/components/chart/engine/__tests__/engineEnabledMigration.test.js` (names this record and asserts it still says OPEN).

> The other two flagged decisions on this branch — `MACD_HEAD_MASK` and
> `VWAP_SESSION_ANCHOR` — were **measured, priced and answered**. This one is
> different in kind: it was **discovered**, three tasks ago, as a fact that made
> a brief self-contradictory, and it has travelled forward since as a sentence in
> a report. A sentence in a report is not a gate.
>
> **It is also not urgent in the way it sounds.** Nothing breaks on ship day.
> §3 says exactly why, with the evidence. What is missing is a *decision*, and
> the specific danger is that the obvious fix — flipping the default — **does not
> work**, looks like it does, and would be discovered by a user rather than by a
> test.

---

## 1. The fact

`mergeChartSettings` computes the flag like this (`chartDefaults.js:404`):

```js
// `=== true`, not `??`: only an explicit boolean lights the engine up.
engineEnabled: parsed.engineEnabled === true,
```

`parsed` is the **stored blob** — the JSON string in `user_preferences.chart_settings`.
`CHART_DEFAULTS.engineEnabled` is **never consulted** for this key. Therefore:

| stored blob | merges to |
|---|---|
| the key is **absent** (every blob written before B2) | `false` |
| the key is explicitly `false` | `false` |
| a stray truthy value (`"1"` from a URL param) | `false` |
| the key is explicitly `true` | `true` |

**…and all four rows are unchanged when `CHART_DEFAULTS.engineEnabled` is flipped
to `true`.** That is asserted, in place, against the real default, by
`engineEnabledMigration.test.js` → *"⛔ FLIPPING THE DEFAULT DOES NOT HEAL A
STORED BLOB — the read is of the blob"*.

**Nothing in shipped source ever writes it `true`.** One occurrence exists —
`ChartRender.jsx:236`, the headless `/r/chart` parity and newsletter route, and
only when `?instances=` is present. The share-link decode (`StockChart.jsx:2464`)
copies whatever the *sender* had, which is `false` for everyone. So on the day B3
ships, `cs.engineEnabled` is `false` for **every user alive**, and it cannot
become `true` by any action a user can take.

## 2. Why "flip the default" is the trap and not the fix

Flip B's brief asked for two things that cannot both hold:

* *"flag off ⇒ a flipped indicator draws nothing"* (its Step-1 test), and
* *"the flag-off parity cases stay at 0 changed pixels"* (its Step-6 gate).

If a **flipped** definition — one whose hand-written render block has been
DELETED — kept the flag as a gate, the gate would not make the engine dark. It
would **delete the indicator**, for everybody, on the first load after deploy.
Flipping `CHART_DEFAULTS.engineEnabled` does not rescue that, per §1.

**The resolution B3 adopted, and it is the right one:**

> A **FLIPPED** id runs the engine **regardless of the flag**; an **un-flipped
> but MIGRATED** id still needs it.

`StockChart` therefore computes `engineActive = engineOn ||
ENGINE_FLIPPED_DEF_IDS.size > 0`, and narrows the instance list to flipped ids
alone while the flag is off. `flipState.js` carries the reasoning in place.

## 3. What a real stored blob does on ship day — the answer is "it works"

`ENGINE_FLIPPED_DEF_IDS` is `{rsi, bb, macd, vwap}` and **equals**
`ENGINE_MIGRATED_DEF_IDS`. So for every existing user:

| | |
|---|---|
| `cs.engineEnabled` | `false` |
| `cs.indicatorInstances` | `[]` |
| RSI / BB / MACD / VWAP | **drawn**, by the engine, from instances the migrator projects from `cs.indicators.<id>` every paint |
| the legacy toggle (`cs.indicators.rsi.enabled`) | still the switch, still honoured, through `isIndicatorEnabled` |
| the reserved band | still reserved, through `csForPaneMargins` |
| the ten un-migrated indicators | untouched, drawn by their legacy blocks |

**Evidence, not assertion.** `flipBStoredBlobs.test.jsx` renders **25** blobs from
JSON strings through the real merge — the July capture, a short/legacy `overlays`
array, tombstones, the pre-flip crossover, the frozen template, the same blob at
daily and at intraday — and compares each post-flip render against
`computePaneMargins(<the stored blob>)`, the pre-flip layout function called on
the pre-flip blob. And the parity gate's `flipb_*` cases carry **legacy-shaped
settings on BOTH sides with no instances at all** — the shape a real user has —
and read **0 changed pixels**.

**So this record is not reporting a breakage. It is reporting that a flag which
decides nothing today is assumed by B4 and B5 to be meaningful, and no plan
contains the step that would make it so.**

## 4. What the flag still decides — three things, all live

1. **A MIGRATED-BUT-UN-FLIPPED definition needs it.** That category is empty
   right now, which is the only reason §3 is clean. **B4 creates it the first
   time it migrates a fifth definition without flipping it in the same change** —
   and that definition would then be engine-drawn for nobody, because nobody has
   the flag. `flipB.test.jsx` asserts the two sets are EQUAL, so that day arrives
   as a red test; this record is what that red test should send the reader to.
2. **`engineDrawnInputs` returns EMPTY on a flag-off chart** (`flipState.js:179`),
   so `ChartToolbar` falls back to showing the legacy MIRROR. The six control
   doors all keep the mirror in sync, so today this is invisible — until a writer
   that does not keep it in sync (a grid `settingsOverride`, an `?instances=`
   link) puts two numbers on one line. Task 12 carry #2; asserted **as it ships**
   in `engineEnabledMigration.test.js` so closing it is a deliberate red.
3. **`ChartToolbar.engineInert` is identically false** because it is
   `engineDrawn.has(key) && !ENGINE_FLIPPED_DEF_IDS.has(key)` and `engineDrawn`
   is a subset of the migrated set. Its 34 row bindings are kept precisely
   because a B4 migration reactivates them.

## 5. ⭐ THE SEVENTH WRITER — where a migration leaks

B3 found **six control doors** one at a time, each of which writes ONE
indicator's enable state: the toolbar row, right-click **Indicators ▸**,
right-click **Hide `<label>`**, the Ctrl family (`Ctrl+I`/`Ctrl+O`/`Ctrl+B`),
`Alt+U`, and the settings tab's generated row. All six route through
`instanceControls` now. **That set is complete** — every `setIndicatorEnabled`
call site in shipped source is one of them.

**There is a seventh writer, of a different kind, and no ledger walk opened it:**

| writer | file |
|---|---|
| `applyPreset` — four theme buttons | `chart/ChartToolbar.jsx` |
| `applyPreset` — the same four, again | `pages/Settings.jsx` |
| `resetToDefaults` — writes `CHART_DEFAULTS` verbatim | `pages/Settings.jsx` |

Each writes a **whole `chart_settings` blob** built by spreading `CHART_DEFAULTS`,
so each **stamps `engineEnabled` and `indicatorInstances` over whatever the user
had**. That is the same hazard class as `ChartsWorkspace`'s frozen "UCT Default"
capture, which was a Flip-B ship-blocker until `uctDefaultChartSettings()` was
made to stamp the two engine keys from the default instead of freezing them.

It is **not** an enumeration site — a preset names no indicator, so a sixteenth
costs zero edits there and Task 12's discovery scan cannot see it. It is a place
**the settings migration has to reach**, because a preset click writes the
default back over whatever the migration wrote.

**Today it is harmless and it is spread, not literal** — verified by identity
(`PRESETS[k].settings.indicatorInstances` **is** `CHART_DEFAULTS.indicatorInstances`,
the same array object, which a hand-written `[]` could not be) and by a bounded
source probe that no preset hand-writes either key. Both are in
`engineEnabledMigration.test.js`, and the source probe fails the moment a literal
appears.

⚠️ **Measured, and the migration must not make it worse:** applying any preset
today clears `indicatorInstances` to `[]` **and** turns every `cs.indicators.*.enabled`
off. That is pre-existing — `{...CHART_DEFAULTS}` did the same before the engine
existed — but it means "click OLED Black" is currently spelled "and remove my
indicators", which a generated settings dialog will make more visible, not less.

## 6. What the migration must do

Three requirements, in order of how easy they are to get wrong.

**R1 — it must reach blobs, not defaults.** A default flip is a no-op (§1). Two
shapes work:

* **read-time, versioned.** `CHART_DEFAULTS.settingsVersion` is already `1` and
  already merged. Bump it to `2` and let `mergeChartSettings` answer
  `engineEnabled` from `CHART_DEFAULTS` when the stored blob is **below** the new
  version and carries no explicit key. Heals every user on the next read, writes
  nothing, is a pure function, and is testable against real blob strings the way
  `flipBStoredBlobs.test.jsx` already tests. **An explicit stored `false` must
  still win** or the migration silently overrides a user who turned it off.
* **write-time, one-shot.** A server-side pass over `user_preferences` rows.
  Durable and auditable, but it is a data migration on a JSON column for ~200
  users, it cannot heal a blob that arrives later from a share link or a
  template, and it needs the read-time rule anyway for those. **Not recommended
  alone.**

**R2 — it must reach the seventh writer.** Presets and `resetToDefaults` spread
`CHART_DEFAULTS`, so a default flip does carry to them — which is exactly why the
source probe in §5 must keep passing. If the migration is versioned (R1a) then
`PRESETS[*].settings.settingsVersion` must be the NEW version, or a theme click
writes a blob that the migrator then re-migrates forever. The same applies to
`ChartsWorkspace`'s `uctDefaultChartSettings()`, which already stamps from
`CHART_DEFAULTS` and would follow.

**R3 — it must be gated, and the gate must be failable.** The rule to assert is
*"a blob written before the engine existed merges to engine-on"* — driven from a
**JSON string**, through the real `mergeChartSettings`, exactly as
`flipBStoredBlobs.test.jsx` does, because a fixture built as an object skips the
step that is being migrated. The gate that catches the wrong fix is already
written: `engineEnabledMigration.test.js`'s *"flipping the default does not heal
a stored blob"* goes red the day the read changes, which is the day this record
must be re-read and the assertion updated deliberately.

## 7. The option nobody has priced: delete the flag

`engineEnabled`'s only remaining job (§4.1) is to distinguish **migrated-but-un-flipped**
from **flipped** — a state that exists only *inside* a migration, for the length
of one phase, and that no user has an opinion about. It is not a preference. It
became a stored preference because B2 landed the engine dark and "dark" was
spelled as a settings key.

If B4 adopts the rule **migrate and flip in the same change** — which is what B3
did for all four pilots, and what the runbook's per-indicator checklist now
describes — then the category in §4.1 never exists, and the flag can be
**deleted** at B5 along with the rest of `cs.indicators`. That is one fewer
migration, not one more.

**The cost of choosing wrong is asymmetric:** shipping the versioned read-time
migration and later deleting the flag is cheap; skipping it and having B4 migrate
without flipping is a definition that renders for nobody, discovered in
production.

## 8. Recommendation

1. **Decide at B4's plan, not later** — because B4 is the phase that can create
   the broken state, and the decision changes B4's own migration checklist.
2. **Default recommendation: delete the flag at B5**, and until then require
   *migrate and flip together* (already the runbook rule, §5 of
   `docs/runbooks/chart-parity-gate.md`).
3. **If B4 needs a migrated-but-un-flipped definition for any reason**, ship R1a
   (versioned read-time migration) **first, in its own commit, with R3's gate**,
   and re-measure the full parity set — a change to `mergeChartSettings`
   reaches every chart on every surface.
4. **Do not flip `CHART_DEFAULTS.engineEnabled` on its own.** It reads like the
   fix, changes nothing for any existing user, and would move the branch from
   "the flag decides nothing" to "the flag decides nothing *and* the tests say it
   does".

## 9. What would go red when this is applied

Named now, so whoever applies it does not have to discover them:

| test | why it moves |
|---|---|
| `engine/__tests__/engineEnabledMigration.test.js` — *flipping the default does not heal a stored blob* | it asserts the CURRENT read. Update it in the same commit, to the new rule, with the old rule kept as the thing that must no longer hold |
| ″ — *a flag-off chart holding a live instance shows the toolbar NOTHING* | there would no longer be a flag-off chart to hold one |
| ″ — *the decision record is still OPEN* | this file's Status line |
| `engine/__tests__/flipBStoredBlobs.test.jsx` | every case asserts the post-migration render; a blob that now merges engine-on takes a different branch through `engineInstances` |
| `chartDefaults.test.js` (`settingsVersion`, `engineEnabled` cases) | the merge rule itself |
| the parity gate | `mergeChartSettings` is on every chart's path — the 24-case set must be re-run, both build identities named, before and after |

**And one that would NOT move, which is the trap:** `ChartToolbar.engineInert`.
Its predicate is `engineDrawn.has(key) && !FLIPPED.has(key)`, and with
`FLIPPED === MIGRATED` it stays identically false whatever the flag does. It has
already been retargeted four times on this branch; it will not catch this.
