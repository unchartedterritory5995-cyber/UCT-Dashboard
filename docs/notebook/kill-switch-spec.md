# Wave K — the runtime kill switch

**Owner ruling, 2026-09-12.** Approved in advance on the contents below. Written
from that ruling plus `wave-q2-PRD.md` §"The kill switch"; where the two differ,
the ruling governs and the difference is recorded here rather than smoothed over.

⛔ **K MERGES FIRST.** `wave-q2-PRD.md` recommended *"BUILD BEFORE Q2-C, NOT
BEFORE Q2-A/B"*. That recommendation is **superseded** — every other track's flag
is specified to ride on K's config, so K precedes all of them. The PRD text is
struck and annotated in the same commit as this file; the ruling is recorded in
manifest §7.

---

## 1. Shape

`GET /api/config` returns the Notebook's capability flags. The client reads it
**once at boot** and never polls.

```
GET /api/config  ->  { "notebook": { "offlineDefaultOn": true, ... } }
```

⭐ **Why boot-read and not reactive-polling.** A flag that can change under a
running tab changes the durable layer's answer to "am I allowed to write" in the
middle of a write. Q1's whole design rests on that answer being stable for the
life of the tab (`SESSION_ID`, the Web Lock, the in-flight marker). One read, at
boot, before anything can write.

## 2. What it does NOT buy — stated first, because it will be assumed otherwise

| | |
|---|---|
| ⛔ **it does not reach open tabs** | a boot-read flag is still a boot-time value. A member with the Notebook open keeps the old answer until they reload. Identical to the deploy-rollback gap; K makes rollback *fast*, not *retroactive* |
| ⛔ **it does not protect against "config unreachable"** | see §3. On fetch failure the client falls back to the **compile-time constant**, and that constant is currently `true`. So if `/api/config` is down, the wave stays **ON**. The kill switch kills a *decision*, not an *outage* |
| ⛔ **it does not replace the deploy rollback** | reverting the commit remains the way to remove code. K removes a capability |

⛔⛔ **Read the second row twice.** "Fail-closed to the compile-time constant" is
the ruling's wording and this spec implements exactly that — but with the
constant `true`, *closed* means *the previous known-good state*, which is ON. A
future reader who assumes "the kill switch always kills" will be wrong whenever
the config endpoint is the thing that broke. If that is not wanted, the fix is to
flip the constant to `false` once every member is on config — a separate,
owner-ruled change, recorded here as **K-1** rather than assumed.

## 3. Failure behaviour

| event | result |
|---|---|
| `/api/config` 200 with the key | the config value wins |
| `/api/config` 200 without the key | the compile-time constant |
| `/api/config` non-200 | the compile-time constant |
| fetch throws (offline, DNS, CORS) | the compile-time constant |
| **timeout** (`K_CONFIG_TIMEOUT_MS`, 3000) | the compile-time constant |
| member `localStorage['uct.j2.offline.enabled'] === '0'` | **OFF — always, and it outranks every row above** |

⛔ **THE MEMBER'S OPT-OUT IS TERMINAL.** It is checked last and it wins against
config, constant and default alike. A member who switched the wave off must never
be switched back on by a server value. Rail: `K-R3`.

## 4. The synchronous-render problem — the decision, justified and provable

The requirement: **a pre-config render must never enable what config would
disable.** Two shapes were on the table.

| | shape | verdict |
|---|---|---|
| **A** | **first-render gate** on the Notebook route: render nothing until config resolves or `K_CONFIG_TIMEOUT_MS` elapses, then use config-or-constant | ✅ **CHOSEN** |
| B | reactive flag, pre-config value = the compile-time constant | ❌ **provably cannot meet the requirement** |

⛔ **Why B fails, and it is not a close call.** The constant is `true`. If config
says `false`, B renders with the wave ON, then flips it off when config lands.
Between those two moments the durable layer is live: it can open the account's
IndexedDB, take the sync Web Lock, and write a working copy — which is precisely
what **§21** forbids (*"switching the wave off must write nothing"*). B does not
merely render the wrong thing for a frame; it **writes**. A is the only shape
that satisfies both the ruling's requirement and §21.

⭐ **What the gate costs.** The Notebook route is already lazy-loaded and already
shows a loading state. The gate adds, at worst, `K_CONFIG_TIMEOUT_MS` to first
paint of that one route, and only when `/api/config` is slow. No other route is
gated.

⛔ **And the gate must not become a second authority on "is the layer on".**
`offlineEnabled()` stays the single predicate every call site asks; the gate only
decides *when that predicate has a trustworthy answer*.

## 5. Naming — one capability, two names, derived

⚰️ The flip queue in `wave-all-RESUME-HERE.md` lists
`NOTEBOOK_OFFLINE_DEFAULT_ON` (row 1) beside `notebook.offlineReadOn` (row 3) and
`notebook.attachmentsOn` (row 4) — **two conventions for one kind of thing, in
one table.** Resolved here:

| layer | form | example |
|---|---|---|
| Railway variable + `docs/feature_flags.json` | `SCREAMING_SNAKE` | `NOTEBOOK_OFFLINE_DEFAULT_ON` |
| the JSON `/api/config` serves, and the client reads | dotted camel | `notebook.offlineDefaultOn` |

⛔ **Derived, never typed twice.** The server builds the config key from the env
var name by one function; a rail (`K-R6`) asserts every capability's two names
agree, so a rename cannot leave one behind. This is the
`lesson_a_second_authority_over_one_value` shape and it is closed by construction.

### One key per capability

| capability | env var | config key | today |
|---|---|---|---|
| Q1 durable working copy | `NOTEBOOK_OFFLINE_DEFAULT_ON` | `notebook.offlineDefaultOn` | **K migrates Q1 onto this** |
| Q2-A offline read cache | `NOTEBOOK_OFFLINE_READ_ON` | `notebook.offlineReadOn` | Q2-A, dark |
| Q2-B conflict UX | `NOTEBOOK_CONFLICT_UX_ON` | `notebook.conflictUxOn` | Q2-B, dark |
| Q2-C attachment pinning | `NOTEBOOK_ATTACHMENTS_ON` | `notebook.attachmentsOn` | Q2-C, dark |

⛔ **A capability with no key does not ship dark.** Every track's flip packet
names its key; the enumeration of keys lives in the manifest and `K-R6` reads it.

## 6. The migration of `OFFLINE_DEFAULT_ON`

`app/src/pages/journal-2-0/lib/offline/offlineFlag.js` keeps the constant. It
becomes the FALLBACK, not the authority:

```js
// before K:  offlineEnabled() = OFFLINE_DEFAULT_ON, minus the member opt-out
// after  K:  offlineEnabled() = config.notebook.offlineDefaultOn
//                               ?? OFFLINE_DEFAULT_ON,   minus the member opt-out
```

⛔ **The constant is not deleted and its value does not change in K.** Deleting
it would leave no fallback and make §3's failure rows impossible; changing it is
K-1, a separate owner ruling. K is a plumbing change with no member-visible
behaviour when config is absent — which is exactly what makes it safe to merge
dark and flip later.

## 7. The six config rails (gauntlet entries)

Each is **mutation-proved**: break the guard, watch the rail redden, restore.

| id | rail | proves |
|---|---|---|
| **K-R1** | config `false` + constant `true` ⇒ `offlineEnabled()` is false, **and no IndexedDB is opened** | the switch actually kills, and kills before any write |
| **K-R2** | every failure row in §3 (non-200, throw, timeout, key absent) falls back to the **constant**, each driven separately | fail-closed is a behaviour, not a promise |
| **K-R3** | member `'0'` beats config `true` **and** constant `true` | the member's opt-out is terminal |
| **K-R4** | the first-render gate renders **nothing** before config resolves — no store opened, no lock taken, no working copy written | §21 holds across the gate; this is the rail that makes shape A's justification real |
| **K-R5** | config is read **exactly once** per page load, no matter how many components ask | a boot-read flag that polls is a different design with different failure modes |
| **K-R6** | every capability's env var and config key agree, derived from one function | the two names cannot drift |

⛔ A seventh, from Q1's own history: **K-R7 — with the wave off by CONFIG, the
sixteen door settles write nothing.** Q1 proved this for the constant
(`settleNoteWrite.test.jsx` §21 rail); K moves the authority, so the proof moves
with it or it is no longer a proof.

## 8. Rollback text — rewritten everywhere it lives

⚰️ Wave Q1 shipped a canary that stamped *"set the env var"* for a flag that had
no env var, in eleven evidence rows, because the rollback sentence lived in more
than one place and only one was corrected. After K the sentence changes again —
and now it is **true** that a variable exists.

Every location, to be updated in K's merge:

| file | what it says now | after K |
|---|---|---|
| `tools/window_check.py` (`ROLLBACK_LINE`) | "it is a DEPLOY, not a variable" | config flip first, deploy-revert as the fallback |
| `docs/notebook/wave-q1-RESUME-HERE.md` | same | same |
| `CLAUDE.md` §"Rolling back a FRONTEND flag" | same | same, pointing here |
| `docs/notebook/wave-q1-sunday-gate.md` §5b REVERT | deploy-revert | config flip |
| `docs/runbooks/deploy-windows.md` | unchanged — K does not change deploy tiers | — |

⛔ **A rail, not a checklist.** `K-R8` greps for the old sentence across the repo
and fails if it survives anywhere. The reason the last one took eleven rows to
find is that nothing looked.

## 9. Definition of done

- [ ] `GET /api/config` serves the four keys; server rail on the env→key derivation
- [ ] client config module: one boot read, bounded timeout, fallback per §3
- [ ] first-render gate on the Notebook route (shape A), K-R4 proving §21 across it
- [ ] `offlineFlag.js` migrated, constant retained as fallback, value unchanged
- [ ] K-R1…K-R8 in `tools/q1_mutation_gauntlet.py`, every one mutation-proved
- [ ] `q1_flag_default_sweep.py` extended: every new default-reading site classified
- [ ] `docs/feature_flags.json` gains the four keys, status `dark`
- [ ] rollback text rewritten in all five places, K-R8 green
- [ ] gate · plain-diff · sweep · sandbox canary · merge **dark** · SUCCESS ·
      three-way · DEPLOY row · one Q1 production real-door canary after
- [ ] flip packet posted — **the first packet the owner expects**

## 10. Open, named

| id | item | needs |
|---|---|---|
| **K-1** | flip `OFFLINE_DEFAULT_ON` to `false` once every member is on config, so "fail-closed" means off | an owner ruling; only sensible after K has run long enough that a config outage is the likelier failure than a rollout gap |
