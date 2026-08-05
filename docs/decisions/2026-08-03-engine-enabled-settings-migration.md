# Decision: `engineEnabled` is false in every stored blob, and no phase plan has a settings migration

**Decision id:** `ENGINE_ENABLED_MIGRATION`
**Status:** ✅ **RESOLVED 2026-08-04 by B5 Task 4 — the flag is DELETED, at every site. §8.2's default recommendation was adopted in full; §12 records what resolved it, and §12.6 records B5 Task 9 shipping the DATA half (§6 R1a) that Task 4 left owing.**
**Owner of the read:** `app/src/components/chart/chartDefaults.js` → `mergeChartSettings`.
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B3 Task 10, as the reason its brief's two requirements could not both hold. **Carried unresolved** by Tasks 10, 11 and 12. **Written down and gated:** Task 13, the whole-branch gate.
**Pinned by:** `app/src/components/chart/engine/__tests__/engineEnabledMigration.test.js` (names this record and reads its Status header) and `enumerationSites.test.js` (asserts the Status header and the CODE agree — see §11.2, §12.1).

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

**…and all four rows were unchanged when `CHART_DEFAULTS.engineEnabled` was
flipped to `true`.** That was asserted, in place, against the real default, by
*flipping the default does not heal a stored blob*. ⭐ **That test is now
`engineEnabledMigration.test.js` → *"⛔ THE OLD RULE IS NOW IMPOSSIBLE, NOT MERELY
FALSE — there is no flag to flip"*** — the old rule kept as the thing that must no
longer hold, which is the only spelling that can tell *resolved* apart from *the
assertions were deleted*. All four rows now collapse to one answer: **the key is
not emitted at all.** See §12.

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

## 10. B4's adjudication — 2026-08-03

**Status is UNCHANGED: OPEN.** B4 does not resolve this record. It removes the
condition under which resolving it would have been urgent.

§8's recommendation is conditional — ship the versioned read-time migration *if
B4 needs a migrated-but-un-flipped definition.* **B4 does not need one.** Its
eighteen inherited ledger regions are retired by DERIVING name lists and control
lists from definitions that already exist for all fourteen series-expressible
natives. Derivation needs a *definition*; only rendering needs a *migration*. The
one region that appeared to force four more migrations — the legend rewrite,
whose six remaining chips belong to `stoch`, `atr`, `sar` and `ichimoku` — is
resolved instead by giving the LEGACY lane the same chip-formatting pipeline the
engine lane already has, keyed `<defId>::<plotKey>`, so both lanes read one
definition.

Therefore `ENGINE_FLIPPED_DEF_IDS === ENGINE_MIGRATED_DEF_IDS` holds at every B4
commit, §3 ("what a real stored blob does on ship day — it works") stays true
unchanged, and §8.2's default recommendation stands: **require
migrate-and-flip-together; delete the flag at B5.**

**Made failable, not asserted.** `enumerationSites.test.js` → *"creates no
migrated-but-un-flipped definition while the settings migration is open"* reads
this file's Status line and both flip sets together and asserts them as one
object. It goes red on the day someone migrates without flipping AND this record
still says OPEN — which is exactly the pair of facts that produces an indicator
rendering for nobody. It goes red the other way too, and deliberately:
**resolving this record's Status without updating the rail is also a red test**,
because a resolved record is the moment the rail's premise has to be re-read
rather than the moment it should go quiet. Both halves are mutation-proven
(migrate `stoch` without flipping it; flip the Status line to RESOLVED; both
exit 1 under `-t 'no migrated-but-un-flipped'`).

⚠️ **CORRECTED 2026-08-03 (Task 3). This record previously claimed the two rails
"are not redundant, and one run cannot tell them apart". The measurement did not
support it and the claim is withdrawn.** The evidence offered was a double run of
the migrate-without-flip mutation with `flipB.test.jsx` out of the selection and
then in it — but the OUT run was `-t`-filtered to this rail's own title, and a
filtered run can only ever report one test. Like-for-like, both **unfiltered**,
that mutation fails **four** assertions without `flipB` and **six** with it. This
rail is one of six, not the one.

**What it does carry that nothing else does.** As shipped in Task 1 the rail was
*strictly weaker* than the two rails beside it: it fired only when `flipB` or
`engineEnabledMigration` already fired, while three states fired those and not
it. Task 3 repaired all three and added the clause that makes it non-redundant:

* the Status match is **isolated to the header line and counted**, so appending a
  second `**Status:** … OPEN` line can no longer keep it green after the header
  has been resolved (the old whole-file `RegExp.test` did exactly that);
* it asserts the **equality in both directions** — `migrated \ flipped` alone was
  the subset check its own failure message forbade, and the missing direction
  (flipped-but-not-migrated) is the worse one: the legacy block is deleted and
  nothing is authorised to replace it;
* ⭐ it **probes both flip sets for mutability**, which no other rail in the tree
  does. `Object.freeze(new Set([…]))` does not stop `.add()`, so a runtime
  `ENGINE_MIGRATED_DEF_IDS.add('stoch')` created the stranded category for real
  while every static rail read the source and saw nothing. `flipState.js` now
  seals the mutators; deleting that seal is red **here and green everywhere
  else** — measured: the pair reports `50 passed`, exit 0, and this rail exits 1.

**B4's baseline, by command.** The branch's prose says "84 chart pytest"; that
number matches no command — the six-file selection below collects **86** at
`d2733adc`. Recorded here because a prose count is the thing this branch keeps
having to correct, and because `.superpowers/` is gitignored, so a corrected
count written to a scratch report does not survive into the repo (this branch
has already lost one that way).

| command | count at `d2733adc` |
|---|---|
| `cd app && npx vitest run` | **4,070 tests / 409 files**, exit 0 |
| `python -m pytest tests/test_indicator_compute.py tests/test_indicator_golden.py tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py -q` | **67 passed**, exit 0 |
| `python -m pytest tests/test_chart_parity_harness.py tests/test_chart_markers.py tests/test_chart_news.py tests/test_chart_health_alerts.py tests/test_admin_chart_health.py tests/test_charts_layout_service.py -q` | **86 passed**, exit 0 (⛔ not 84) |

Re-measured at this task's commit, after the ledger edits: vitest **4,071 / 409**
(the rail is the one new test), and both pytest selections unchanged at 67 and 86
— this task touches no Python and no shipped JS.

**The ledger partition B4 starts from.** A2 re-fated `paneMargins.PANES` to B5
(a layout table B4 is forbidden from modifying) and A4 re-fated
`indicator_alert_evaluator.INDICATOR_FUNCS` to the new fate `C` (spec §8 rebuilds
the evaluator). That is the decision; the resulting histogram is **not restated
here**. `enumerationSites.test.js` → *"every B4 region is retired — 1 to B5, 2 to
C, 3 kept, 2 phase bookkeeping"* asserts it, and every B4 task decremented the `B4`
bucket, so a number copied into this paragraph would be a control that rots green
— read it there.

> ⭐ **RE-CITED 2026-08-04 (B5 Task 9).** B5 Task 9 retired the ledger's three
> settings-blob rows and the histogram moved `B5: 4` → `B5: 1`, which renamed the
> test. The rail added by Task 1 — *"⭐ every test title the decision record cites
> verbatim is a title that exists"* — **went red on this exact line**, which is
> the second time it has caught this citation and the reason it exists.

> 🔴 **CORRECTED 2026-08-04 (B5 Task 1), and the correction is the point.** This
> sentence cited that test as *"the retirement column adds up"* — the title it had
> when §10 was written, and **B4 Task 4 renamed it**. Nothing went red: a decision
> record's one pointer at the assertion it deliberately refuses to restate had
> pointed at a test that does not exist for four tasks. A doc quoting a test title
> is the same control-rot shape as a comment quoting its expected literal, and it
> is now **failable** — `enumerationSites.test.js` → *"⭐ every test title the
> decision record cites verbatim is a title that exists"* extracts this file's
> `` `<file>` → *"<title>"* `` citations and resolves each against the suite's
> actual declared titles.

## 11. B5's adjudication — 2026-08-04

**Status is UNCHANGED: OPEN.** B5 Task 1 does not resolve this record; **B5 Task 9
does**, and §8.2 is why. This section is what Task 9 has to come back and read.

### 11.1 B5 adopts §8.2 in full, and takes the LARGER reading of it

§8.2's default recommendation was *"require migrate-and-flip-together; delete the
flag at B5."* B5 adopts it **verbatim and completely**:

* **all ten remaining natives migrate and flip TOGETHER**, in registry order, in
  the same commit each (`stoch`+`atr` → `sar`+`ichimoku` → `mfi`+`cci`+`williamsR`
  → `adx`+`obv`+`donchian`). The migrated-but-un-flipped category of §4.1 is
  therefore never created, exactly as it never was in B4;
* **and then the flag is deleted — but the flag is not the whole job.** §7 says
  `engineEnabled` "can be deleted at B5 along with the rest of `cs.indicators`",
  and that clause is load-bearing. The ledger fates BOTH `chartDefaults.js` rows
  (`CHART_DEFAULTS.indicators`' fifteen keyed sections AND `mergeChartSettings`'
  fifteen-line allow-list) to B5, so retiring the flag alone would leave the
  mirror it guards standing. B5 splits the work across two tasks **for
  measurability, not for scope**:

  | | what goes | why it is its own commit |
  |---|---|---|
  | **Task 4** | `engineEnabled`, at all six sites | `mergeChartSettings` is on every chart path — this is the LAST commit in which a change to it can be measured at absolute 0 changed pixels, before any geometry moves |
  | **Task 9** | the MIRROR — `settingsVersion` 1→2, a read-time fold of `cs.indicators.<id>` into `indicatorInstances` **only below version 2**, `CHART_DEFAULTS.indicators` shrunk to `volumeProfile`, the allow-list to one line | this is the versioned read-time migration §6 R1a describes, arriving for the DATA rather than for the flag, and it is asserted **by what it destroys** |

**§6 R1a is therefore shipped, and shipped for the reason §6 gives** — it must
reach BLOBS, not defaults; an explicit stored value must still win; it is gated
from a JSON string. What changed since §6 was written is only *what it migrates*:
not "turn the flag on for everyone" but "fold the legacy sections forward once,
below version 2, so a deleted indicator never returns."

**§6 R2 — the seventh writer — still applies unchanged.** `PRESETS[*]`,
`resetToDefaults`, `ChartSettingsModal`'s `JSON.parse(JSON.stringify(CHART_DEFAULTS))`
and `ChartsWorkspace`'s `uctDefaultChartSettings()` all spread `CHART_DEFAULTS`, so
they follow the shrink — and `PRESETS[*].settings.settingsVersion` must be the NEW
version, or a theme click writes a blob the migrator re-migrates forever.

### 11.2 The rail was RE-READ, not deleted — and here is what it now asserts

`enumerationSites.test.js` → *"creates no migrated-but-un-flipped definition while
the settings migration is open"* used to assert `stillOpen: true`: *the header
still says OPEN*. That is a true sentence about a branch on which nobody was
permitted to resolve it, and B5 is the phase that resolves it. A rail whose whole
content is "the sentence still says OPEN" has exactly one response to that day —
somebody edits `true` to `false`, the suite goes green, and the clause constrains
nothing, because *"the record does not say OPEN"* is not a claim about any code.
**That is not a rail retiring; it is a rail inverting silently.**

It is re-read as a **biconditional between this record and the code**:

> the header says **OPEN** ⟺ `mergeChartSettings` still reads `parsed.engineEnabled === true`

| | header `**Status:**` | the flag is still read | `recordAgreesWithTheCode` |
|---|---|---|---|
| **before Task 4/9** (today) | `OPEN` | yes | `true` |
| **after Task 4/9** | `RESOLVED` | no | `true` |

so the transition is ONE deliberate two-field edit that cannot be made halfway:

* **resolve this record while the flag still exists → red.** The decision claims
  to be answered while the thing it decides is still deciding.
* **delete the flag while this record still says OPEN → red.** The code answered a
  question the written decision still calls open — which is precisely how
  `engineEnabled` came to be read by six sites that nobody had chosen. **This
  direction is new**; `stillOpen: true` could not catch it at all.

Three details are load-bearing and are stated so Task 9 does not have to
rediscover them. The status token comes from a **closed set** (`OPEN` / `RESOLVED`;
neither, or both, reads `UNREADABLE` and fails), so a typo cannot pass as
"resolved". The `**Status:**` header line is still **isolated and counted**
(`statusLines: 1`) — the R-I1 defect. And the flag probe reads **comment-stripped**
source: every retirement on this branch leaves a comment naming what it deleted, so
a raw probe would read Task 4's own tombstone as the flag and stay green forever.

The other clauses are unchanged and hold in BOTH worlds, which is why they are not
conditioned on the status: `FLIPPED === MIGRATED` in both directions, and both flip
sets refusing a runtime `.add()` (`Object.freeze(new Set())` does **not** block
`.add()` — measured).

### 11.3 B5's baseline, by command

Same discipline as §10, and the same reason: `.superpowers/` is gitignored, so a
count written to a scratch report does not survive into the repo — this branch has
already lost one that way — and the branch's prose numbers have needed correcting
before (§10's "84 chart pytest" collected **86**).

Measured on a clean tree at **`60abd6fb`**, which is byte-identical to `084eeded`
for every file except `docs/superpowers/plans/2026-08-04-phase-b5-cutover.md`
(`git diff --stat 084eeded 60abd6fb` = 1 file changed, +2917, docs only):

| command | count at `60abd6fb` |
|---|---|
| `cd app && npx vitest run` | **4,215 tests / 418 files**, exit 0 |
| `python -m pytest tests/test_indicator_compute.py tests/test_indicator_golden.py tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py -q` | **78 passed**, exit 0 |
| `python -m pytest tests/test_chart_parity_harness.py tests/test_chart_markers.py tests/test_chart_news.py tests/test_chart_health_alerts.py tests/test_admin_chart_health.py tests/test_charts_layout_service.py -q` | **86 passed**, exit 0 |

⚠️ **The indicator selection moved 67 → 78 across B4; the chart selection did not
move at all.** Both are the same four- and six-file selections §10 records — the
commands are copied verbatim so the two rows are comparable, and the delta is B4's
alert-catalog work, not a different selection.

**Re-measured after Task 1's edits**, same three commands:

| command | after Task 1 | delta |
|---|---|---|
| `cd app && npx vitest run` | **4,217 / 418**, exit 0 | **+2 tests, +0 files** — the per-site fate mapping and the citation rail, both added to an existing file |
| indicator pytest (4 files) | **78 passed**, exit 0 | unchanged |
| chart pytest (6 files) | **116 passed**, exit 0 | ⚠️ **+30, and NONE of it is this task's** — see below |

⛔ **THE CHART PYTEST DELTA IS NOT ATTRIBUTABLE TO TASK 1, AND SAYING SO IS THE
POINT.** Task 1 touches no Python: its whole diff is one JS test file, one JS
comment block, and two markdown files. The +30 is a PARALLEL agent's in-flight,
uncommitted work on `tests/test_chart_parity_harness.py` (37 → 67 collected on its
own) plus `tools/chart_parity.py` and `tools/chart_parity_cases.json`, none of
which are in Task 1's commit. **The honest number for this task is the one
measured on a clean tree — 86 — and it is unchanged by anything Task 1 did.** A
count taken from a shared worktree while another writer is live is a count of two
people's work; recording it as one person's is exactly how "84" survived four
tasks.

### 11.4 ⭐ HANDOFF TO TASK 4 — `engineOwned` has had ZERO readers since Flip B

Found by B5 Task 1 reading the code rather than the ledgers, and recorded here
because **Task 4 is the task that deletes this flag's machinery** and this is a
piece of it that no test, no lint and no ledger currently names. Task 1 did not
touch `StockChart.jsx` — that file has exactly one writer per phase and it is
Task 4's.

**The measurement** (`StockChart.jsx` at `60abd6fb`, comments stripped with
`engine/__tests__/sourceScan.stripComments` so an explanatory comment cannot be
mistaken for a reader):

| symbol | occurrences in CODE | what they are |
|---|---|---|
| `engineOwned` | **1** | the declaration at **`StockChart.jsx:5918`**, and nothing else |
| `engineOwnedDefIds` | 2 | the import (line 42) and the single call on 5918 |
| `EMPTY_OWNED` | 2 | the declaration (line 63) and the `else` arm of 5918 |

```js
const engineOwned = engineActive ? engineOwnedDefIds(engineInstances, engineRegistry) : EMPTY_OWNED
```

The value is computed and never read. The whole chain — the import, `EMPTY_OWNED`,
and `engineOwnedDefIds`' only production call site in `app/src` — exists to
produce it.

**Why, exactly, and why nothing went red.** `engineOwned` was the Flip-A arbiter:
a legacy block guarded on `!engineOwned.has('X')`. Flip B **deleted the blocks**
rather than guarding them, so the last consumer went with `macd` and `vwap` at
`400005ee`. `enumerationSites.test.js` → *"keeps no Flip-A guard for a flipped id —
the block should be GONE, not guarded"* asserts `engineOwned.has('<id>')` is
ABSENT for every flipped id, and `FLIPPED === MIGRATED`, so that rail **demands**
the emptiness it produced — it is doing its job, and the leftover it leaves behind
is invisible to it by construction.

**But five comment paragraphs still describe it as live**, at
`StockChart.jsx:5660-5663`, `5703-5709`, `5780-5783`, `5910-5914` and
`6293-6295` — including *"`engineOwnedDefIds` is the arbiter … X's legacy block
guards on `!engineOwned.has('X')`"*, a guard shape the same suite asserts cannot
exist. **This is the control-rot shape in its purest form: five paragraphs of
present-tense prose about a mechanism that has not run since Flip B.**

**Task 4's instruction, precisely:** delete the binding at `:5918`, the
`engineOwnedDefIds` import, and `EMPTY_OWNED` if `:5918` was its only user — then
**rewrite the five paragraphs rather than deleting them**, in the past tense, the
way this branch has recorded every other retirement, because "why is there no
arbiter" is a question the next reader will otherwise ask of an empty space.
⚠️ `engineOwnedDefIds` itself is **not** dead — it is `paneMarginsProjection`'s
stated model and it keeps its own suite; only StockChart's call is.

⚠️ **Not fixed at Task 1, deliberately.** It is a shipped-source edit in a file
this phase gives one writer at a time, and it is Task 4's file. It is recorded
here rather than in `.superpowers/` because `.superpowers/` is gitignored — the
same reason §11.3 exists.

## 12. RESOLUTION — 2026-08-04, B5 Task 4

**§8.2's default recommendation, adopted in full: the flag is DELETED.** Not
flipped, not defaulted-`true`, not versioned. §1 is why — the read was of the
blob, so a default flip was a no-op for every user alive — and §7 is why deletion
is available at all: the flag's one remaining job was to distinguish
migrated-but-un-flipped from flipped, and B5 migrates and flips in the same commit
(A1), so that category is never created.

### 12.1 ⚠️ THIS RECORD RESOLVES AT TASK 4, NOT AT TASK 9, AND THE RAIL IS WHY

§11.1's table splits the work across Task 4 (the flag) and Task 9 (the mirror), and
§11 twice says *"B5 Task 9 resolves this record"*. **That is not available, and the
reason is a rail this branch wrote deliberately.**

`enumerationSites.test.js` → *"creates no migrated-but-un-flipped definition while
the settings migration is open"* asserts a **biconditional**:

> the header says **OPEN** ⟺ `mergeChartSettings` still reads `parsed.engineEnabled === true`

with `recordAgreesWithTheCode: true` required in both worlds. §11.2 states both
failure directions and both are mutation-proven. Task 4 deletes the read;
therefore `flagLives` is `false`; therefore leaving this header at `OPEN` is
**red**, by construction, in the commit that does the deletion. There is no halfway
state — that is the whole point of re-reading the clause as a biconditional rather
than as `stillOpen: true`.

So the two-field edit is made here, in the commit that deletes the flag. **Task 9
is unaffected in scope**: it still ships §6 R1a, the versioned read-time migration,
for the DATA (`settingsVersion` 1→2, the fold of `cs.indicators.<id>` into
`indicatorInstances` below version 2, `CHART_DEFAULTS.indicators` shrunk to
`volumeProfile`, the allow-list to one line). What it no longer carries is a
`**Status:**` edit it could not have made without being red for five tasks first.

### 12.2 What deletion means, site by site

Seven sites in shipped source, **not six** — §11.2's "six sites that nobody had
chosen" undercounts by one, and the extra one is the interesting one.

| # | site | what went |
|---|---|---|
| 1 | `chart/chartDefaults.js` — `CHART_DEFAULTS.engineEnabled: false` | the declaration §1 proves nothing consulted |
| 2 | `chart/chartDefaults.js` — `mergeChartSettings` | **the read.** With the line gone the hard allow-list stops emitting the key, and a stored `true`/`false`/`"1"` is destroyed on the next read like any undeclared key |
| 3 | `chart/engine/flipState.js` — `engineDrawnInputs` | the `cs.engineEnabled !== true` guard. §4.2's divergence: the toolbar fell back to the legacy MIRROR on a flag-off chart, i.e. **on every chart**. Now unconditional |
| 4 | `components/StockChart.jsx` | `engineOn`; `engineActive`'s disjunct; the instance filter's second gate; `engineNeeded`'s disjunct; the share-link encode AND decode; the visibility effect's dep |
| 5 | `pages/ChartRender.jsx` | **the only write of `true` in shipped source** — `?instances=` on the headless parity route |
| 6 | `pages/charts/ChartsWorkspace.jsx` | `uctDefaultChartSettings()`'s stamp. ⚠️ Deleted as a LINE, not assigned `undefined`: `JSON.stringify` drops `undefined`, so the output string is byte-identical either way and only a source scan can tell |
| 7 | `chart/engine/binder.js` | `sync`'s `ctx.cs && ctx.cs.engineEnabled` fallback — **the seventh, named by nothing.** It is what an "all six sites" scope would have left behind: a live read of a key that no longer exists, resolving to `undefined`, i.e. permanently OFF, for any caller that omitted `enabled` |

`pages/Settings.jsx` and `chart/ChartSettingsModal.jsx` — two of door seven's three
sites — needed **no edit**: they spread or clone `CHART_DEFAULTS`, so they followed
the deletion. That is the property §6 R2 asks of them, and it is asserted rather
than assumed (`engineEnabledMigration.test.js` → *"the three door-seven writers no
longer stamp a key that does not exist"*, over the payloads, plus
`controlDoorCensus.test.js` on the sites).

### 12.3 §9's list, closed one by one

| test | §9 said | what happened |
|---|---|---|
| *flipping the default does not heal a stored blob* | update it, old rule kept as what must no longer hold | done — *"⛔ THE OLD RULE IS NOW IMPOSSIBLE, NOT MERELY FALSE"*, and all four §1 rows are asserted as one object |
| *a flag-off chart holding a live instance shows the toolbar NOTHING* | there is no flag-off chart | inverted — *"the toolbar shows the DRAWN inputs on every chart now"*, asserted twice: on a normal blob and on one that explicitly said `false` |
| *the decision record is still OPEN* | this file's Status line | moved to RESOLVED, **here**, for the reason in §12.1 |
| `flipBStoredBlobs.test.jsx` | a blob that merges engine-on takes a different branch | **no blob changed branch.** Nothing merges engine-on, because nothing merges the key at all; every one of the 25 renders unchanged |
| `chartDefaults.test.js` | the merge rule itself | its three `engineEnabled` cases assert ABSENCE now |
| the parity gate | `mergeChartSettings` is on every chart's path | 24 live cases, 0 changed pixels, both build identities named — §12.4 |

**And the one §9 predicted would NOT move: `ChartToolbar.engineInert`.** §9 was right
that this deletion could not catch it, and wrong about it existing: **B4 Task 8 had
already deleted `engineInert`, `inertTitle`, `shownInput` and all 34 row bindings**
when spec §6 replaced the fifteen per-indicator rows with one launcher.
`flipState.js` still carried a present-tense paragraph saying they "STAY (they are
what a B4 migration reactivates)"; that paragraph is corrected in this commit.

### 12.4 The parity numbers

`mergeChartSettings` is on every chart's path on every surface, and this is the
last commit in B5 at which a change to it can be measured against an unmoved
geometry. **24 live cases · 0 changed pixels · 5/5 runs · `worst=0 tol=0` on every
case.**

| side | build identity | bundle |
|---|---|---|
| A (`669542f9`, this task reverted in place) | `d4d1a37ca9f7` | `index-BJZPT9V-.js` |
| B (`669542f9` + this task) | `f1b0f7d5b1c4` | `index-CxU4TFCH.js` |

`same_build:false`, served==disk on both. Fail-proofs on this pair, both `rc=1`:
vwap opacity → **2,601 px**, candles `#1ae51b` → **1,953 px**.

### 12.5 What is still open, and it is not this

`ENGINE_ENABLED_DELETED` (`docs/decisions/2026-08-04-engine-enabled-deleted.md`)
carries the deletion itself. **The MIRROR was Task 9's and is not resolved by this
record**: `cs.indicators`' fifteen keyed sections and the fifteen-line allow-list
are both fated B5, §11.1 splits them into Task 9, and §6 R1a describes the shape.
This record's subject was the flag, and the flag is gone.

⭐ **Task 9 has since shipped it — §12.6.**

### 12.6 What B5 Task 9 shipped, and the two things §6 got wrong

**§6 R1a, in full.** `settingsVersion` 1 → 2, with a read-time fold of every
stored `cs.indicators.<id>` into `indicatorInstances` that runs **only below
version 2**; `CHART_DEFAULTS.indicators` down to `volumeProfile` alone; the
per-key allow-list down to one line. Ledger **11 → 8** (rows 1, 2 and 14 retire
together — the table, the allow-list that let it survive a read, and
`ChartsWorkspace`'s frozen capture of it), partition `{B5: 1, C: 2, keep: 3,
phase: 2}`.

**What a July blob does, measured:** every indicator that was on is still on,
with the same period / colour / opacity / line style, in the shipped stack order,
no key resurrected, and **the user does nothing** — no reset, no re-tick, no
re-login. `engineEnabledMigration.test.js` → *"every indicator is still on, with
the same period / colour / opacity / line style"* walks a fourteen-section July
capture key by key, off the stored fixture, into the seeded instances.

**① §6 R2's hazard was real and is closed by an unconditional stamp.** The fold
is gated on the STORED version; what is EMITTED is always the current version.
A preset that echoed the stored `settingsVersion` would re-run the migration on
every load and re-seed instances the user had since deleted.

**② §6 R1a DID NOT NAME THE DOUBLE-SEED, AND IT IS THE WORST FAILURE AVAILABLE
HERE.** `migrateLegacyToInstances` reserves ids per INSTANCE ID; a legacy toggle
is per DEFINITION. A blob holding `{instanceId: 'grid-cell-3:rsi', defId: 'rsi'}`
plus `indicators.rsi.enabled` therefore seeds a SECOND `legacy:rsi` — two RSI
lines — and unlike the render-time version of the same defect (§6.1, which
`StockChart.updateChart` already guards) the answer here is **written back at
version 2 and never re-migrated**. The fold applies the same rule: a projection is
outranked by a LIVE stored instance of the same definition.

**③ And one thing the fold does NOT preserve, stated rather than discovered.**
`setIndicatorInput` on a switched-OFF indicator writes the legacy MIRROR alone
(typing a period beside an unchecked box must not add the indicator to the chart).
The mirror no longer survives a read, so that value is lost on reload where it
used to persist. That is the settings model this phase is moving to — an
indicator's settings belong to the INSTANCE, and there is no instance — and it is
recorded here rather than left to be found.
