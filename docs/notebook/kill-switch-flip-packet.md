# THE NOTEBOOK KILL SWITCH — FLIP PACKET

⛔ **NAMED FOR THE MECHANISM, NOT THE LETTER.** This file is deliberately NOT
`wave-k-*.md`: in this directory that prefix already means the OTHER Wave K — Ask
Notebook, which shipped months ago and has its own closure and certification
records. The manifest's §10 trap 1 is precisely that *"the wave letters I, J and K
each mean two different things"*, and a reader who opens `wave-k-production-certification.md`
looking for this switch has been sent to the wrong wave by a filename. The spec
beside it is `kill-switch-spec.md` for the same reason.

**Wave K ships DARK. This packet is what the owner needs in order to decide
whether anything flips, and it is the only document that may be read as
authorising one.** Nothing here has been flipped. `C-2` of the manifest sets the
required fields: key · railway command · preconditions TRUE with evidence ·
window + verdict rule · rollback · member-impact paragraph.

⛔⛔ **DARK MEANS DARK.** With none of these variables set, every member's
browser receives the same four keys at their **defaults** and behaves **byte for
byte as it did before K** — the kill switch reads ON because unset means
*nothing has been killed*, and the three Q2 gates read OFF because unset means
*nobody decided to release this*. The merge changes no member-visible behaviour.
Nothing becomes visible until the owner sets a key.

---

## 1. THE KEYS

| Railway variable (`web`) | payload key | kind | unset means | today |
|---|---|---|---|---|
| `NOTEBOOK_OFFLINE_DEFAULT_ON` | `notebook_offline_default_on` | **kill switch** | **ON** — nothing has been killed | unset |
| `NOTEBOOK_OFFLINE_READ_ON` | `notebook_offline_read_on` | enablement gate | **OFF** — not released | unset |
| `NOTEBOOK_CONFLICT_UX_ON` | `notebook_conflict_ux_on` | enablement gate | **OFF** — not released | unset |
| `NOTEBOOK_ATTACHMENTS_ON` | `notebook_attachments_on` | enablement gate | **OFF** — not released | unset |

⛔ **The polarity split is not a style choice and it is railed** (`K-R6`,
`tests/test_notebook_flags.py`). A kill switch that defaulted OFF would make a
variable somebody forgot to set indistinguishable from a deliberate shutdown —
the exact ambiguity `project_feature_flag_ledger` exists to prevent. An
enablement gate that defaulted ON would release a surface nobody decided to ship.

⭐ **The env name and the payload key are DERIVED from one another**
(`_notebook_flag_key`, `api/routers/auth.py`) — never two hand-written lists,
which is how the writer-index `FOUR` and the COT router's "4 routes" happened.

⛔ **An unrecognised value takes the DEFAULT, never its opposite.** A typo'd
`flase` must not kill a shipped wave, and `ture` must not release a dark one.
Accepted: `1/true/yes/on` and `0/false/no/off`, case- and whitespace-insensitive.

---

## 2. THE COMMANDS

```sh
# kill the offline wave for everyone, on their next authenticated request
railway variables --service web --set "NOTEBOOK_OFFLINE_DEFAULT_ON=0"

# undo that (or state "on, on purpose" so it is distinguishable from unset)
railway variables --service web --set "NOTEBOOK_OFFLINE_DEFAULT_ON=1"

# a Q2 surface, when its own wave is ready and the owner says so
railway variables --service web --set "NOTEBOOK_OFFLINE_READ_ON=1"
```

⚠️ **`railway variables --set` has been measured BOTH ways** (staged on
`chart-renderer` 2026-08-30, auto-redeployed on `web` 2026-09-09). Verify a **NEW
BOOT** by startup-line timestamp, and confirm the RUNNING process — `--kv` shows
what the service is *configured* with, which is not evidence the process has it.
Then update `docs/feature_flags.json` in the same docs push that records the flip
time, or the ledger describes a state that stopped being true.

---

## 3. REACH — verbatim, §2b of `kill-switch-spec.md`, owner ruling 2026-09-12

> a flip reaches a member on their next authenticated request or reload; it does
> not reach a tab mid-session (latched for §21). If the auth payload is
> unreachable, the wave stays ON — the switch kills a decision, not an outage,
> until K-1.

⭐ **Why latched, and why that is the design rather than a shortfall.** Wave Q1's
`SESSION_ID`, its sync Web Lock and its in-flight marker all belong to a tab that
answered *yes, I may write* exactly once. If the answer could move mid-session,
`offlineEnabled()` could say *no* between a PUT going out and its ack coming
back — "am I allowed to write" changing DURING a write. The latch (`K-R9`,
`lib/offline/notebookFlags.js`) makes that impossible; a later payload
disagreeing is **counted, not applied**, and visible in `notebookFlagsDebug()`.

⚰️ **Superseded wording, recorded rather than dropped.** The 2026-09-12 ruling
that queued K-1 required the limitation printed verbatim as *"if `/api/config` is
unreachable, the wave stays ON …"*. The later ruling the same day struck the
`/api/config` design in place — the flags ride `_access_payload` and no endpoint
was added — so the sentence above is the governing one. It says the same thing
about the same failure, over the transport that actually exists.

---

## 4. PRECONDITIONS — each with its evidence

| # | precondition | state | evidence |
|---|---|---|---|
| K-a | The server half reads the environment **per request**, so a flip needs no app rebuild | ✅ TRUE | `tests/test_notebook_flags.py` + `tests/test_hub_preview_flag.py::test_each_notebook_flag_is_read_PER_REQUEST` (parametrised over the roster, DERIVED from `NOTEBOOK_FLAGS`). **Mutation-proved**: cache the read at module level → all four red |
| K-b | Every auth path that seats a member applies the flags — signup included | ✅ TRUE | `app/src/context/authFlagPaths.test.js` (K-R10). Four seats: `/me` · login · TOTP verify · signup. **Mutation-proved**: remove the applier from the TOTP path → 2 red, naming line 160 |
| K-c | The switch **kills before any write** — no store opened, no lock taken | ✅ TRUE | `notebookFlags.test.jsx` K-R1, with the CONTROL that the same call DOES reach the store when config says on |
| K-d | Nothing mounts before the answer lands (first-render gate, shape A) | ✅ TRUE | `NotebookFlagGate.test.jsx` K-R4, including the **shape-B disproof** — the reactive alternative mounts the durable layer before the server's `false` arrives |
| K-e | The answer cannot move under a running tab | ✅ TRUE | K-R9, plus the CONTROL that a NEW tab does see the new answer |
| K-f | K merges **dark**: nothing set ⇒ behaviour is what it was before K | ✅ TRUE | `notebookFlags.test.jsx` "K merges DARK", and the four-key defaults rail in `tests/test_notebook_flags.py` |
| K-g | The reach statement is identical in all five places it lives | ✅ TRUE | `tests/test_k_reach_statement.py` (K-R8) derives it from the spec and compares |
| K-h | Gate · plain-diff · flag-default sweep · sandbox canary | *stamped in §7* | — |

---

## 5. WINDOW + VERDICT RULE

**K is a dark merge, so the window is not a keep-or-revert vote on a member-visible
change — it is the measurement K-1 needs.**

- **Window:** from the `web` deploy that carries K, to the owner's next Notebook
  decision point.
- **What is measured:** the canary's `notebook config served` row
  (`tools/window_check.py`), which reads `/api/auth/me` **signed in as the rig
  account** and names the `notebook_*` keys the payload actually carried.
- **The rule:** *absent* and *off* are **different readings** and the row reports
  them differently. A pod that predates K returns no keys at all and the browser
  falls back to the compile-time constant — correct behaviour, and precisely the
  state K-1 must never be flipped in front of.
- **Verdict:** K needs no verdict to stay. **K-1** — flipping the constant to
  `false` so an unreachable payload fails to OFF — is **QUEUED, NOT PARKED**, and
  its precondition is *config-served rate 100% over the K window, measured by
  identity, rig excluded.* It ships as K's own **second** flip packet.

---

## 6. ROLLBACK

**Two levers. Pull the first.**

1. **The switch:** `railway variables --service web --set "NOTEBOOK_OFFLINE_DEFAULT_ON=0"`.
   No app rebuild. Verify a new boot; read the value in-process.
   Reach: the verbatim sentence in §3.
2. **The deploy**, if the CODE must come out (a defect in the durable layer
   itself, not a decision to stop defaulting it on): merge
   `rollback/notebook-offline-default-off` @ `3db89e205`, wait for the `web`
   rebuild (**103–138 s measured**). Every member with an open tab keeps the OLD
   bundle until they reload — no service worker, no version prompt, by charter.

⛔ **K itself is reverted by reverting K's merge commit**, which returns the
client to the compile-time constant. Nothing about Q1's save path depends on K
being present.

---

## 7. MEMBER IMPACT

**On merge, with nothing set: none.** A member opening the Notebook today and a
member opening it after K lands get the same product, from the same durable
working copy, with the same outbox and the same conflict behaviour. The only new
code on their path is a first-render gate that waits for an answer the auth
payload already carries, bounded at **3 s**, after which the pre-K constant stands
in.

⭐ **In practice the gate is transparent**, and it is worth being exact about why
rather than claiming a loading state that is now INSIDE the gate: `AuthContext`
fetches `/api/auth/me` at app boot and latches the flags there, so by the time a
member reaches the Notebook sub-tab the answer is already latched and the gate
renders its children on the FIRST render — that is what seeding `useState` from
`notebookFlagsReady()` buys. The 3 s ceiling is reachable only by a member whose
`/api/auth/me` has not answered yet, and `AuthGuard` has not rendered the route at
all in that window. ⛔ The gate's `fallback` is deliberately `null` rather than a
spinner: a spinner that appears for zero frames in every realistic case is copy
nobody can verify, and this repo has shipped two toasts that rendered for exactly
that long.

**If the owner sets `NOTEBOOK_OFFLINE_DEFAULT_ON=0`:** on their next
authenticated request or reload, a member's Notebook stops using the durable
offline path and behaves as it did before Wave Q1 went live — saves go straight
to the server, there is no local working copy and no outbox. **Work already in a
member's outbox is not lost by the flip**, because the flip does not reach a tab
mid-session and never deletes a store; a tab that was mid-drain finishes its
drain. A member who had explicitly opted IN in their own browser
(`uct.j2.offline.enabled = '1'`) **keeps the offline path** — that key is checked
first and is terminal in both directions, by ruling (K-R3).

**If the owner sets any of the three Q2 gates to `1`:** nothing happens yet.
Those surfaces are not built; the keys exist so that the wave that builds each
one ships behind a switch that already works, instead of adding one afterwards.

---

## 8. WHAT THIS PACKET DOES NOT AUTHORISE

- It does not flip anything. **Nothing member-visible moves until the owner flips
  its key** (`docs/notebook/PROGRAM-MANIFEST.md`, §12).
- It does not authorise **K-1**. That is a separate packet with a measured
  precondition, recorded in the manifest §10.
- It does not claim the switch protects against an outage. Read §3 again.
