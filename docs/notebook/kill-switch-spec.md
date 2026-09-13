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

⚰️⚰️ **STRUCK 2026-09-12 — `GET /api/config` WAS THE WRONG MECHANISM.**

> ~~`GET /api/config` returns the Notebook's capability flags. The client reads it
> once at boot and never polls.~~
>
> **Why it was struck, found while building K:** the app already has a
> server-served runtime kill switch, and `CLAUDE.md` records the absence of a
> config endpoint as a deliberate choice — *"There is no feature-flag endpoint in
> this app — the flag rides that payload by design."*
> `api/routers/auth.py::_access_payload` is shared by signup, login and
> `/api/auth/me`, already serves `hub_preview_enabled`,
> `research_technical_tab_enabled` and `s7_filing_watch_enabled`, and says in
> its own comments: *"READ AT REQUEST TIME, NOT AT IMPORT … RIDES AN EXISTING
> PAYLOAD RATHER THAN ADDING AN ENDPOINT … no extra round trip and no new
> route."*
>
> A new endpoint would have been a **second authority over server-served flags**,
> and it reaches members LATER: a boot-read needs a reload, the payload arrives
> on the next authenticated request. Owner ruling 2026-09-12; manifest §7.

### The shape K actually builds

The Notebook's capability flags ride **`_access_payload`**, read **per request**
on the server, and are **LATCHED** on the client for the life of the tab.

```
GET /api/auth/me  ->  { …, "notebook_offline_default_on": true, … }
```

| | |
|---|---|
| server | reads the env var **per request** — never at import. A module-level capture makes the no-redeploy rollback a fiction, which is the load-bearing case of `tests/test_hub_preview_flag.py` |
| client | `AuthContext` maps the payload onto state at all four auth paths, **from one map** (§5) |
| **latch** | the Notebook reads the flag **once**, on the first payload that arrives, and holds it for the tab's lifetime |

⭐ **WHY LATCH, WHEN THE POINT WAS TO READ PER REQUEST.** These are not in
tension — they answer different questions. The SERVER must re-read so a flip
needs no redeploy. The CLIENT must not let the answer move underneath a running
tab: Q1's `SESSION_ID`, its sync Web Lock and its in-flight marker are all
scoped to a tab that has already decided it may write. A flag that flipped
mid-session would change "am I allowed to write" in the middle of a write.
So: fresh on the server, frozen per tab. Rail **K-R9**.

## 2. What it does NOT buy — stated first, because it will be assumed otherwise

| | |
|---|---|
| ⛔ **it does not reach open tabs** | a boot-read flag is still a boot-time value. A member with the Notebook open keeps the old answer until they reload. Identical to the deploy-rollback gap; K makes rollback *fast*, not *retroactive* |
| ⛔ **it does not protect against "payload unreachable"** | see §3. ☠️ ~~*"if `/api/config` is down"*~~ — **struck 2026-09-12 with the rest of the `/api/config` design; the flags ride `_access_payload` and no endpoint was added.** The behaviour is unchanged and so is the danger: when the payload carries no `notebook_*` keys — an unreachable request, or a pod that predates K — the client falls back to the **compile-time constant**, which is currently `true`, so the wave stays **ON**. The kill switch kills a *decision*, not an *outage*. See §2b for the verbatim sentence and **K-1** for the queued fix |
| ⛔ **it does not replace the deploy rollback** | reverting the commit remains the way to remove code. K removes a capability |

⛔⛔ **Read the second row twice.** "Fail-closed to the compile-time constant" is
the ruling's wording and this spec implements exactly that — but with the
constant `true`, *closed* means *the previous known-good state*, which is ON. A
future reader who assumes "the kill switch always kills" will be wrong whenever
the config endpoint is the thing that broke. If that is not wanted, the fix is to
flip the constant to `false` once every member is on config — a separate,
owner-ruled change, recorded here as **K-1** rather than assumed.

## 2b. THE REACH STATEMENT — verbatim, in the flip packet and the rollback text

⛔⛔ **This sentence is reproduced WORD FOR WORD in K's flip packet and in every
place the rollback text lives. Owner ruling 2026-09-12. It is not paraphrased,
shortened, or softened — the last rollback sentence that drifted took eleven
evidence rows to find.**

> a flip reaches a member on their next authenticated request or reload; it does
> not reach a tab mid-session (latched for §21). If the auth payload is
> unreachable, the wave stays ON — the switch kills a decision, not an outage,
> until K-1.

⭐ **K-R8 greps for this sentence** in the five places it must appear, and fails
if any copy is missing or altered.

## 3. Failure behaviour

| event | result |
|---|---|
| auth payload carries the key | that value wins, and is **latched** for the tab |
| auth payload carries no such key (older backend) | the compile-time constant |
| `/api/auth/me` non-200, or the member is signed out | the compile-time constant |
| fetch throws (offline, DNS, CORS) | the compile-time constant |
| **timeout** (`K_CONFIG_TIMEOUT_MS`, 3000) — the gate waits no longer than this | the compile-time constant |
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
paint of that one route, and only when the **auth payload** is slow — ⚰️ this
said *"when `/api/config` is slow"*, an endpoint that was struck and never built.
No other route is gated, and the gate is seeded from the CURRENT latch state, so
a member switching back to an already-answered tab sees no loading state at all.

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
| the key on the AUTH PAYLOAD, and the client's state name | `snake_case` payload / camel state | `notebook_offline_default_on` / `notebookOfflineDefaultOn` |

⛔ **snake_case, not dotted camel.** The payload already carries
`hub_preview_enabled`, `research_technical_tab_enabled` and
`s7_filing_watch_enabled`; a dotted key beside them would be a second convention
on one object. The flip queue's `notebook.offlineReadOn` spelling is superseded —
the CAPABILITY is the same, the transport changed.

⛔ **Derived, never typed twice.** The server builds the config key from the env
var name by one function; a rail (`K-R6`) asserts every capability's two names
agree, so a rename cannot leave one behind. This is the
`lesson_a_second_authority_over_one_value` shape and it is closed by construction.

### One key per capability

| capability | env var | payload key | today |
|---|---|---|---|
| Q1 durable working copy | `NOTEBOOK_OFFLINE_DEFAULT_ON` | `notebook_offline_default_on` | **K migrates Q1 onto this** |
| Q2-A offline read cache | `NOTEBOOK_OFFLINE_READ_ON` | `notebook_offline_read_on` | Q2-A, dark |
| Q2-B conflict UX | `NOTEBOOK_CONFLICT_UX_ON` | `notebook_conflict_ux_on` | Q2-B, dark |
| Q2-C attachment pinning | `NOTEBOOK_ATTACHMENTS_ON` | `notebook_attachments_on` | Q2-C, dark |

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

| **K-R9** | `offlineEnabled()` and every derived flag return the SAME value for the life of the tab, whatever later payloads say; `SESSION_ID`, the Web Lock and the in-flight marker never observe a changed flag | the latch is real, and Q1's tab-scoped assumptions hold |
| **K-R10** | a flag in the map appears in ALL FOUR auth payload paths; a mapping omitted from any path reds | the four-way duplication cannot come back |

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

- [x] ⚰️ ~~`GET /api/config` serves the four keys~~ — **struck**; `_access_payload`
      serves them, per request. Server rail on the env→key derivation: **K-R6**,
      `tests/test_notebook_flags.py` · per-request property extended to the four
      keys in `tests/test_hub_preview_flag.py`, the file that owns that property
- [x] client latch module (`lib/offline/notebookFlags.js`): first payload carrying
      ANY boolean key wins, for the tab's lifetime; fallback per §3; a later
      disagreement COUNTED, not applied (**K-R9**)
- [x] the four duplicated AuthContext mappings collapsed to ONE map applied at all
      four seats, before the fifth flag was added (**K-R10**, derived not counted)
- [x] first-render gate on the Notebook route (shape A), K-R4 proving §21 across it,
      with the shape-B disproof beside it
- [x] `offlineFlag.js` migrated, constant retained as fallback, value unchanged
- [x] K-R1…K-R10 in `tools/q1_mutation_gauntlet.py`, every one mutation-proved —
      **GAUNTLET PASS, 34/34 reddened**, control 495 browser + 65 server green before
      and after, every file restored byte-identical. The tool grew a **second runner**
      to get there: two of K's guards are Python, and a gauntlet that could only reach
      vitest would have left them "proved by hand, once"
- [x] `q1_flag_default_sweep.py` extended: the served answer is a route to the default
      with no `localStorage` call in it, so `__resetNotebookFlags()` classifies as
      REACHES-DEFAULT while an EXPLICIT `latchNotebookFlags({…: false})` is deliberately
      NOT listed. 53 sites, self-check PASS
- [x] ⚠️ **`docs/feature_flags.json` gains THREE keys, not four — and the ledger's own
      doctrine is why.** `needs_declaration` is false for a gate that defaults ON: it is
      self-evidently a live decision. `NOTEBOOK_OFFLINE_DEFAULT_ON` defaults ON, so
      declaring it would trip `test_the_ledger_does_not_describe_gates_that_no_longer_exist`.
      The three enablement gates are declared `dark` with reasons.
      ⛔⛔ **And the index could not SEE any of the four**: it matches a string constant,
      `os.environ.get(env_name)` has none, so 140 flag tests passed over a ledger four
      gates short — the failure that ledger exists to prevent, one level up. Fixed by
      teaching `feature_flag_index` to read a gate TABLE
      (`tests/test_notebook_flag_table_form.py`, with the control that a bare
      loop-variable read is still invisible)
- [x] rollback text rewritten in all five places, **K-R8 green and mutation-proved**
      (`tests/test_k_reach_statement.py`)
- [x] gate · plain-diff · sweep · merge **dark** · SUCCESS · three-way · DEPLOY row
      — all done 2026-09-12, `53a181082`. Gate: 1305 runnable files, 19,296 passed,
      **0 NEW attributable** (the one NEW is master's `focusDivergence` orphan, proved
      by provenance). Plain diff: read line by line, and it found two comment-only
      defects — both applied afterwards with a **byte-level proof** that the gated and
      pushed trees are behaviourally identical, rather than an assertion that they are.
      SUCCESS + `/api/health` `uptime_seconds` **39** — a fresh boot, read by the
      artifact. Three-way: local `HEAD` = `origin/master` = the deployed SHA.
      ⚠️ **Sandbox canary DELIBERATELY NOT RUN**, and this says so instead of quietly
      dropping it: a sandbox boots against a synthetic DB where the four keys are unset
      — which is the state the gate already covers exhaustively and the state production
      is in anyway. The reading K actually needs is *what the payload served a real
      signed-in member*, and only the rig can take it
- [ ] **one Q1 production real-door canary after** — held for the window: the
      `UCT-WaveQ1-Observe` task fires at 22:00 CT and the standing rule is that the rig
      runs only when no Q1 scheduled task is due within the hour. ⛔ Recorded as OPEN
      rather than skipped
- [ ] flip packet posted — **the first packet the owner expects**

## 10. Open, named

| id | item | needs |
|---|---|---|
| **K-1** | flip `OFFLINE_DEFAULT_ON` to `false` so an unreachable auth payload fails to OFF | **QUEUED, NOT PARKED** — owner ruling 2026-09-12. Precondition: *config-served rate 100% over the K window, measured by identity, rig excluded.* It ships as **K's own second flip packet** |
| **K-2** | `shellFlag.js` justifies itself with *"The deploy freeze (9:15am–4:20pm ET options tape) makes a same-day deploy-rollback impossible"* — **that freeze was removed 2026-08-24** (`CLAUDE.md`, "Shipping window: NO FREEZE"). A live file arguing from a rescinded rule. ⛔ **Recorded, NOT touched by K** (owner ruling): it is a third flag mechanism with a different scope (per-browser rollout dial), and editing it here would widen K into someone else's surface | an owner ruling on whether to restate or retire it |
