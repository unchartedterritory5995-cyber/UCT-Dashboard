---
id: GATE-S9
title: Entitlements & Licensing Gate — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-13
---

# GATE-S9 — Entitlements & Licensing Gate

## ⛔⛔ THIS SYSTEM IS OWNER-BLOCKED BEFORE IT IS SPEC-BLOCKED

> **S9 waits on OI-03(a), OI-03(b) and OI-12, and nothing in this packet can be signed until that is answered.**
> S9 decides **what a member may see**, and that is a function of two contracts nobody has read back to this programme — the Massive tier (OI-03(a)) and whether an FMP display agreement exists (OI-03(b)) — plus the commercial model (OI-12), where the code and the seed facts **disagree** about which page is free.

⭐ **The packet exists anyway, and that is deliberate.** Until now S9 had **no packet at all**,
which is a different and worse state than "unsigned": an unsigned packet is a thing the owner can
read and sign, while a missing one is work this programme owes before the owner can do anything.
COMPLETION_AUDIT §0 separates the two for exactly this reason.

⛔ **ZERO CODE WAS WRITTEN FOR THIS PACKET.** Nothing below is built, started, or partially
started.

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint may be built, merged, or partially
> started until a line is signed naming one of them. A signature naming "S9" authorizes
> nothing — §3 exists so an approval can name a checkpoint instead.

---

## 1. What S9 is, per the architecture

`product-architecture.md` §5: the single authority on which plan, which cadence and which **data class** a member may receive — and, per the provider ledger §3.4, which trigger types may run on which data class for which audience.

---

## 2. ⛔ What is ALREADY SHIPPED, measured — because the gap is not "nothing exists"

⛔ **Entitlement logic is live and DUPLICATED, which is the finding.** `AuthGuard`, `FREE_PAGES`, `require_paid`, and `entitlements.py`'s `TOOLKITS` all answer a form of 'may this member', and `PAID_PLANS` **is already copied twice** (TD-20, cited in the architecture at §120).

⚠️ `entitlements.py` ships exactly ONE toolkit (`"all"`) and the lookup is still real — returning the default unconditionally would be indistinguishable from a lookup that had been deleted. Any S9 checkpoint must preserve that distinction.

⛔⛔ **AND THE LICENSING HALF IS NOT A REFACTOR.** If OI-03(a) comes back *individual tier*, member-facing display of that data is **not permitted at all**, and S9's job changes from 'consolidate the gates' to 'enforce a prohibition'. Those are different systems. This is why no checkpoint below is proposable as more than a shape.

---

## 3. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | The entitlement axis as **INERT DATA** + a duplication rail: every site that answers 'may this member' enumerated from source, with `PAID_PLANS`' two copies named. **No gate changed.** | measure at build | **S/M** |
| **CP2+** | ⛔ **NOT PROPOSABLE.** The shape depends on OI-03(a): a permissive answer makes CP2 a consolidation; a restrictive one makes it an enforcement boundary with member-visible consequences. | — | — |

---

## 4. ⛔ Watch-coverage classification — to be MEASURED at build time, not guessed

Every checkpoint above must be classified with `tools/flow_worker_watch_coverage.py` against the
tree it will merge on. ⚠️ **This packet deliberately does not pre-declare a classification**: the
closure moves as imports move, and a classification written weeks before the build is the stale
artifact this programme keeps paying for. The one exception is D4 CP3, where the owner
pre-declared BEHAVIOUR-CHANGING **because the measurement had already been taken that day**.

---

## 5. What this packet does NOT ask for

- **No answer to OI-03(a), OI-03(b) and OI-12.** That is the owner's, and it is upstream of every checkpoint here.
- **No member-visible change** at any checkpoint below CP1.
- **No flag armed.** Arming is always a separate owner decision.

---

## 6. Recommendation

**Sign nothing.** ⭐ CP1 (enumerate the duplication, change no gate) is real work that is correct under either answer, and it is the only part of S9 that is. Everything else waits on a contract. ⚠️ A14 Portfolio & Risk is blocked behind this AND behind D8, so S9 answering does not by itself unblock A14.
