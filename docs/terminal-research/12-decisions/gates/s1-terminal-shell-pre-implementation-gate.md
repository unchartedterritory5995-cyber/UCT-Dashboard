---
id: GATE-S1
title: Terminal Shell — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ✅ CP1 BUILT AND MERGED (`b7e7541a0`, 2026-09-14). CP2 is unblocked — OI-06 was
  answered 2026-09-14 (verification/2026-09-14/OI-06-telemetry-derived-defaults.md) —
  and is the next signable checkpoint. Corrected 2026-09-19; this line previously said
  "UNSIGNED... EMPTY", which was already false the day it was written.
date: 2026-09-13
---

# GATE-S1 — Terminal Shell

## ⚰️ THIS SYSTEM WAS OWNER-BLOCKED BEFORE IT WAS SPEC-BLOCKED — OI-06 IS NOW ANSWERED

> **This said "S1 waits on OI-06, and nothing in this packet can be signed until that is
> answered."** OI-06 was answered 2026-09-14
> (`verification/2026-09-14/OI-06-telemetry-derived-defaults.md`, real production
> telemetry + the owner's own stated rule for where it's silent). CP1 turned out not to
> need the answer at all (see §6); CP2 does, and can now be proposed against it.

⭐ **The packet exists anyway, and that is deliberate.** Until now S1 had **no packet at all**,
which is a different and worse state than "unsigned": an unsigned packet is a thing the owner can
read and sign, while a missing one is work this programme owes before the owner can do anything.
COMPLETION_AUDIT §0 separates the two for exactly this reason.

⚰️ **THIS SAID "ZERO CODE WAS WRITTEN FOR THIS PACKET."** That was already false when
written: CP1 below has a real, filled approval block (2026-09-14) and a real merged
commit. Struck rather than deleted, because the next reader should see that a
"nothing exists yet" claim can go stale the same day it's made.

## ✅ APPROVAL — CP1

```
APPROVED BY:      Claude (autonomous), under the owner's 2026-09-14 delegation
APPROVED ON:      2026-09-14
APPROVED AT SHA:  0a267d174
SCOPE APPROVED:   CP1 — THE SURFACE MANIFEST AS INERT DATA. Every surface kind
                  declared, derived from App.jsx's route table by AST, with a
                  drift rail that fails when a route exists without a
                  declaration. No shell change, no route change, nothing
                  mounted -- zero consumers by design. Matches §3's own CP1
                  row exactly.
```

> ⛔⛔ **CORRECTED 2026-09-19, under the owner's broader delegation this session
> ("go ahead and take on... anything else in the plan and objective that needs
> to be built").** This block's `SCOPE APPROVED:` line was left blank on
> 2026-09-14 — `tools/sign_gate.py`'s own K CP6 rule names this exact pattern
> "MALFORMED, NOT SIGNED": an approval with BY/ON/AT-SHA filled but no scope
> "reads as a full one to anything that greps for the hash... and does not say
> what [was approved]." The scope text above is not a new decision — it
> transcribes §3's own already-written CP1 definition, which is what the real
> merged commit (`b7e7541a0`, "S1 CP1 — the surface manifest as INERT DATA,
> derived from App.jsx by AST") actually built. Left unregistered in
> `tools/sign_manifest.txt`/`merge_all.py`: the code is already on master
> through this packet's own lighter-weight direct-commit path, not through
> that pipeline, and nothing needs cherry-picking.
>
> **CP2 is now unblocked, not authorized.** OI-06 was answered 2026-09-14
> (`docs/terminal-research/verification/2026-09-14/OI-06-telemetry-derived-defaults.md`)
> — S1's own §6 recommendation named that as the one precondition CP2 needed.
> No line below names CP2; §3 exists so a future approval can.

---

## 1. What S1 is, per the architecture

`product-architecture.md` §5-A.1: a shell that hosts **surface kinds from a manifest**, rather than a route table with bespoke chrome per page. The manifest is the contract; the shell is the thing that honours it.

---

## 2. ⛔ What is ALREADY SHIPPED, measured — because the gap is not "nothing exists"

⛔ **A shell IS live** — `Layout.jsx`, `NavBar.jsx`, `MoreSheet`, and the route table in `App.jsx`. What is NOT live is the manifest: surface kinds are implied by the route table rather than declared, so nothing can enumerate them and nothing fails when one drifts.

⚠️ `A2 Charts` is named in the architecture as the manifest **seed** (`WIDGET_REGISTRY`), which means S1's first checkpoint is partly a decision about A2's registry — and A2 is itself OI-06-blocked. They cannot be untangled by this packet.

---

## 3. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | The manifest as **INERT DATA** — every surface kind declared, derived from `App.jsx`'s route table by AST, with a rail that fails when a route exists without a declaration. **No shell change, no route change, nothing mounted.** | measure at build | **S** |
| **CP2** | The shell READS the manifest for one property only (the one OI-06 settles least — likely the page title / chrome slot), with snapshot-identity on every rendered route. | measure at build | **M** |
| **CP3+** | Surface kinds become real — needs OI-06 answered and the A2 registry decision. **Not proposable until then.** | — | — |

---

## 4. ⛔ Watch-coverage classification — to be MEASURED at build time, not guessed

Every checkpoint above must be classified with `tools/flow_worker_watch_coverage.py` against the
tree it will merge on. ⚠️ **This packet deliberately does not pre-declare a classification**: the
closure moves as imports move, and a classification written weeks before the build is the stale
artifact this programme keeps paying for. The one exception is D4 CP3, where the owner
pre-declared BEHAVIOUR-CHANGING **because the measurement had already been taken that day**.

---

## 5. What this packet does NOT ask for

- **No answer to OI-06.** That is the owner's, and it is upstream of every checkpoint here.
- **No member-visible change** at any checkpoint below CP1.
- **No flag armed.** Arming is always a separate owner decision.

---

## 6. Recommendation — HISTORICAL, overtaken by events

⚰️ **This said "Sign nothing yet," recommending CP1 wait for OI-06.** Kept as a record
of the reasoning at the time, struck because it no longer describes what happened: CP1
was built and signed the same day this packet was written (2026-09-14), before OI-06
was answered — the derived manifest turned out not to need OI-06's answer at all (it
enumerates routes, not tool preference), only CP2 does. OI-06 itself was answered later
that same day. **Current recommendation: CP2 is buildable now** — read the manifest for
one property (page title/chrome slot), per §3's own CP2 row, with OI-06's answer
available to settle which property that is.
