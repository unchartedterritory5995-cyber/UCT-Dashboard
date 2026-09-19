---
id: PACKET-C
title: Signature-regex rail + the CLAUDE.md service count — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: SIGNED (PACKET-C, fingerprint c443515eb)
date: 2026-09-14
---

# PACKET C — the approval-block regex rail, and one stale line in CLAUDE.md

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-17
APPROVED AT SHA:  c443515eb
SCOPE APPROVED:   CP1, CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** Neither checkpoint may be merged until a
> line is signed naming one of them. A signature naming "Packet C" authorizes nothing — §3
> exists so an approval can name a checkpoint instead.

⛔ **ZERO PRODUCT CODE.** Both checkpoints are an instrument and a documentation line. No
member-facing behaviour changes under either.

---

## 1. Why this packet exists

Two live items, unrelated in subject and identical in shape: **a fact that was true once and
is not now, in a place a reader trusts.**

1. A throwaway verification snippet on 2026-09-14 counted signed approval blocks with
   `APPROVED AT SHA:\s*\S`. `\s` matches a newline, so on an **empty** block it crossed into
   the next line and matched the `S` of `SCOPE APPROVED:` — **counting unsigned blocks as
   signed.** It named `s9-entitlements`, a packet the owner has deliberately left unsigned.
2. `CLAUDE.md:10` says Railway runs **FIVE** services. It runs **six** — because *this
   programme added the sixth* (`terminal-next-monitor`) on 2026-09-14.

---

## 2. ⛔ What was ALREADY correct — because the gap is not "the tools are broken"

**Measured, not assumed:** the defective pattern appears in **no committed file** on either
branch. The two instruments that actually parse approval blocks were already line-safe:

| instrument | pattern | verdict |
|---|---|---|
| `tools/sign_gate.py` | `_H = "[ " + chr(92) + "t]*"`, used inside `^…$` under `re.M` | ✅ line-anchored |
| `tools/audit_scope_vs_checkpoints.py:153` | `^APPROVED BY:[ \t]+[A-Za-z]` under `re.M` | ✅ line-anchored |

⭐ So **CP1 does not fix a defect — it pins a property.** The property is invisible on
inspection (both spellings look fine at a glance) and the cost of losing it is a miscounted
signature registry, which is the one number this programme cannot afford to have drift.

---

## 3. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | `tools/audit_signature_regexes.py` — a rail asserting every approval-block pattern in the two signature instruments is line-anchored, with positive, negative, decoy and missing-file controls. **No instrument changed.** | measured at build: **none** (docs worktree, no `api/**`) | **S** |
| **CP2** | `CLAUDE.md:10` — **FIVE → SIX** services, one line, derived by `railway status --json`. **No other line touched.** | measured at build: see §4 | **XS** |

⛔ **CP1 and CP2 are independently mergeable.** They share no file and neither depends on the
other; this packet groups them only because both were found in the same pass.

---

## 4. ⛔ Watch-coverage classification — MEASURED at build time, not guessed

`tools/flow_worker_watch_coverage.py`, run on the tree each checkpoint merges on.

- **CP1** touches `terminal-research` only. Flow-worker's closure is a property of `api/**`
  on `master`; a docs-branch tool is not in it and cannot be.
- **CP2** touches `CLAUDE.md` on the code branch. Measured at build: **`OK`, changed=1,
  not in the 156-module closure.** No marker bump.

---

## 5. The evidence

### CP1 — the mutation proof, and the v1 that failed it

⚰️⚰️ **THE FIRST RAIL WAS DECORATION, AND ONLY A MUTATION SHOWED IT.** v1 walked
`ast.Constant` string literals hunting `\s`. Mutating the real instrument —
`sign_gate._H` from `"[ " + chr(92) + "t]*"` to `chr(92) + "s*"` — **did not fire it.**

⭐ **Because `_H` is ASSEMBLED BY CONCATENATION**, no literal in the file ever contains `\s`;
it is built at runtime from `chr(92)`. And it is written that way **deliberately** — this
repo's own rule says to build needles by concatenation so a literal-hunting sweep cannot
match itself. **The house convention that protects one check structurally blinded another.**

v2 evaluates the module and reads `.pattern` off the compiled objects, which sees the
assembled value however it was built.

```
MUTATION  _H = chr(92) + "s*"
  v1 -> exit 0, "OK, none can cross a line"        ⛔ BLIND
  v2 -> exit 1, FAIL _AT_LINE, FAIL _AT_LINE_BLANK ✅ FIRES
RESTORED by EDIT; `git diff --stat tools/sign_gate.py` empty; sign_gate --self-check PASS
```

**Controls** (`--self-check`, all four required, each failing for a different reason):

```
POSITIVE control  bad.py  -> 2 offender(s) ok        the real defect is caught
NEGATIVE control good.py -> 0 offender(s) ok         the correct spelling is NOT caught
DECOY  empty block: \s*\S matches=True (must be True) | [ \t]*\S matches=False (must be False)
MISSING file      -> exit 2 ok                       unreadable is never a pass
SELF-CHECK: PASS
```

⛔ **The DECOY is the load-bearing control.** It asserts the *behaviour* — that `\s*\S`
really does read the next line on a real empty block — rather than testing the pattern
string. If that ever stops being true, the whole finding was wrong and this rail should be
deleted rather than kept green.

⛔ **NON-VACUITY:** the live run prints `in-scope approval-block patterns examined: 3` and
returns **UNREADABLE** on zero, so an empty derivation is visible rather than passing
silently.

⛔ **SCOPE, so it is not misread as a repo-wide ban on `\s`:** the rail audits only patterns
containing `APPROVED`. A repo-wide ban would flag **71** legitimate uses — parsing a pytest
totals line, `[\s\S]` where multi-line reach is the point — and be muted inside a week.

### CP2 — the derivation

```
railway status --json | (serviceName)
  bars-api · chart-renderer · flow-worker · terminal-next-monitor · web · worker
services: 6
```

The line's own `⛔` already instructs the reader to *"derive the roster with
`railway status --json`"*, so it is self-correcting by design; this brings the stated count
back in line with it.

---

## 6. Reconciliation — unmoved, which is what makes CP1 a fix and not a finding

Re-run after CP1, using the audit tool's **own** line-safe pattern rather than a hand-rolled
one:

```
packets globbed (non-vacuity)  : 22
signed blocks on disk (gates)  : 35
external declared (PRD-D2 §9.5): 1
declared rows total            : 36
reconciles                     : True
drift                          : none
```

⭐ **The number did not move.** Had it moved, CP1 would have been a *finding* about the
registry rather than a fix to an instrument, and this packet would have stopped here.

---

## 7. Drafted ledger row — NOT written

```
| 66 | `<CP1 commit>` | 2026-09-14 18:xx | **TOOLING** | 1 | Packet C CP1: approval-block regexes pinned line-anchored; v1 was blind to a concatenated pattern |
| 67 | `<CP2 commit>` | 2026-09-14 18:xx | **DOCS** | 1 | Packet C CP2: CLAUDE.md FIVE → SIX services, derived |
```

## 8. Drafted RESUME delta — NOT applied

Under **§5 What a session must NOT do**, after rule 0:

> ⛔ **A whitespace class must not cross a line boundary in any check that parses a
> line-oriented record.** `\s`, `\S`, `\D`, `\W` all match `\n`. Use `[ \t]`, or anchor with
> `^…$` under `re.M`. ⚰️ 2026-09-14: `APPROVED AT SHA:\s*\S` counted **unsigned** approval
> blocks as signed by matching the `S` of the next line's `SCOPE APPROVED:`. Railed by
> `tools/audit_signature_regexes.py` — ⭐ and note its v1 was **blind to a pattern built by
> concatenation**, so the rail reads COMPILED patterns, not string literals.
