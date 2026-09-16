---
id: k-cp6-build-record
unit: K CP6
packet: packet-k-two-command-signing-gate
merges-after: K CP5
status: UNSIGNED
---

# K CP6 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **K CP6 — a signature says what it approved, and refuses when it cannot.** Scope is
> `tools/sign_gate.py` **as enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof, three sources:** `packet-k-two-command-signing-gate.md` declares
**CP1–CP2**; build records on disk are **k-cp3, k-cp4, k-cp5**; manifest rows are
**CP1,CP2 · CP3 · CP4 · CP5**. **CP6 free.**

---

## 1 · The defect, pasted rather than described

`sign()` accepted a `scope` argument and never read it:

```
285: def sign(path: pathlib.Path, by: str, on: str, scope: str) -> str:
296:     lo, hi = span
297:     t = t[:lo] + "APPROVED AT SHA:  " + fp + t[hi:]
298:     t = re.sub("^APPROVED BY:" + _H + "$", "APPROVED BY:      " + by, …)
299:     t = re.sub("^APPROVED ON:" + _H + "$", "APPROVED ON:      " + on, …)
300:     path.write_text(t, encoding="utf-8")
301:     return fp
```

Three fields written, four fields in the block. The AST says it, with `by` and `on` as the
positive control:

```
sign() parameters : ['path', 'by', 'on', 'scope']
  path   READ
  by     READ
  on     READ
  scope  NEVER READ  <-- the drop
control: `by` and `on` ARE seen by this walk, so the miss is a real absence.
```

⭐ **A blank scope is not a cosmetic gap.** `read_approval` answers SIGNED on the AT SHA
line alone, so a scope-less approval reads as a full one: the packet says a person approved
something and does not say what. **Three signed blocks in this tree are already in that
state, and 38 more were one command away.**

## 2 · ⛔ THE CHECKPOINT TABLE IS DERIVED, AND THE WEAK MODE IS NAMED

A scope must name a checkpoint **the packet itself declares**. Two evidence tiers, and the
tier is returned rather than swallowed:

| mode | evidence | rows |
|---|---|---|
| `declared` | the packet's `unit:` line, or the first cell of its checkpoint table | **35** |
| `prose` | neither exists — the checkpoint is declared in a heading or a sentence | **3** |

⚠️ **The `prose` tier is not laziness, it is a measurement.** `packet-a-absent-bound-gate`
writes `A CP1` in a heading, `packet-t-stale-test-gate` writes *"One checkpoint: **T-CP1**"*
in a sentence, and neither has a table or a `unit:` line. A deriver that refused those would
have stopped the signing session at its first row.

⛔ **Hyphen and space are the same character here.** The manifest writes `A-CP1`, the packet
writes `A CP1`; `T2-CP1` vs `T2 CP1`. And `E CP25` must satisfy a row that says `CP25`,
because build records write the bare form. Both spellings are generated from one id.

**Pre-flight against the real manifest before this shipped: 38 rows, 0 refused.**

## 3 · The refusals, and what each one protects

```
2  the scope is blank or whitespace
3  the scope names no checkpoint this packet declares
4  the block has no BLANK `SCOPE APPROVED:` line to write into
```

⛔ **All three fire BEFORE any span is read, so a refusal writes nothing** — proved by
sha256 on both sides, not by the exit code. An exit code says the process stopped; only the
hash says the disk is unchanged.

⛔ **The scope is spliced BY SPAN**, into the blank line belonging to the block being signed
— never `re.sub(count=1)`, which writes the FIRST blank line in the file and would put this
block's scope on a different block's. Same defect as the 2026-09-13 fingerprint loss, one
field along. And the span is re-found from the AT SHA line **as it now stands**, because the
BY and ON writes happen earlier in the block and move every offset after them.

## 4 · ⚠️ THE FINGERPRINT DOES NOT MOVE, AND THE READER HAD TO CHANGE FOR THAT

`sign()` hashes **before** it writes, so the fingerprint still pins the bytes the owner READ
— an empty approval block. **`verify_manifest` → 38 OK, 0 STALE.** Nothing regenerated,
because nothing needed to.

⛔ But `rederive_signed` (K CP5) blanked three fields; it now blanks **four**, or every
packet this tool signs would stop re-deriving the day the scope started being filled in.
⚠️ That is correct for a packet **this tool signed**. A historical packet whose scope was
hand-written *before* signing had that text inside its hash — re-derive those with
`fingerprint(text, span)` instead. The note is in the function.

## 5 · The reader

**A SIGNED block with a blank `SCOPE APPROVED:` is now MALFORMED.** Same refusal the reader
already makes about a missing approver, applied to the field that says *what* was approved.

## 6 · ⛔ ONE INSTRUCTION COULD NOT BE EXECUTED, AND HERE IS THE MEASUREMENT

The session prompt asked that a two-checkpoint row *"signs twice, once per CP."* **It
cannot, and should not:**

```
rows with two or more checkpoints: 4
  packet-c-instrument-and-claudemd-gate.md   CP1,CP2      blank AT SHA=1  blank SCOPE=1
  packet-d-nav-tabs-gate.md                  CP1,CP2      blank AT SHA=1  blank SCOPE=1
  packet-b-schema-resolution-gate.md         CP1,CP2,CP3  blank AT SHA=1  blank SCOPE=1
  packet-k-two-command-signing-gate.md       CP1,CP2      blank AT SHA=1  blank SCOPE=1
across all 38 rows: rows NOT (1 blank AT SHA, 1 blank SCOPE) = 0
```

Each of those packets holds **one** blank approval block, and `target_span` refuses a packet
with more than one (*"refusing to guess which"*). Signing twice would mean **adding a second
approval block to four approved-shape documents** — an edit to the packets, not a change to
the signer. ⭐ What the manifest already encodes is the right thing: **one signature whose
scope names every checkpoint in that row** — `CP1, CP2 ONLY — …`. That is what ships.

## 7 · Controls

```
CONTROL 1  a packet declaring CP1,CP2, scope "CP2 ONLY — …"   -> exit 0, line written verbatim
CONTROL 2  a BLANK scope                                      -> exit 2, sha256 UNCHANGED
CONTROL 3  a scope naming CP9 (undeclared)                    -> exit 3, sha256 UNCHANGED
           ...and the message names what the packet DOES declare (CP1, CP2)
CONTROL 4  a pre-SIGNED block with a blank scope              -> reader MALFORMED
CONTROL 5  a pre-SIGNED block WITH a scope                    -> reader SIGNED (non-vacuity)
EXTRA      rederive_signed still returns the stored value after the scope is written
           ...and a one-byte body edit moves it (not a tautology)
in --self-check, permanently: CONTROL 8 write · 9 blank-refuse+sha · 10 undeclared-refuse+sha
           · 11 deriver mode + "CP9 is NOT in it" · 12 re-derivation survives the write
```

⛔ Controls 2 and 3 are only controls because **control 1 proves the file CAN change**.
Without it, "nothing was written" is satisfied by a signer that never writes anything.

## 8 · Validators

```
sign_gate --self-check      PASS, exit 0
sign_gate --read-check      PASS, exit 0
K6.2 five controls          PASS, exit 0
sign_all  --dry-run         38 rows, 38 ok, 0 refusing, exit 0
verify_manifest             38 OK, 0 STALE
merge_all --self-check      PASS, exit 0
merge_all --dry-run         38 units, 30 constraints, exit 0
```

## 9 · Drafted ledger row — NOT written

| 105 | *(this unit's commit — named in the session report)* | 2026-09-15 | TOOLING | 1 | K CP6: `sign_gate.sign()` accepted a scope argument and never read it, so every signature it made carried a blank SCOPE APPROVED line — an approval that does not say what was approved, which `read_approval` answers SIGNED to on the AT SHA line alone. The scope is now written, and refused when blank (2) or when it names a checkpoint the packet does not declare (3), both proved by sha256 on either side rather than by an exit code. The checkpoint table is derived from the packet's own `unit:` line or table, with a named `prose` fallback for the three packets that have neither. Fingerprints do not move — `sign()` hashes before it writes — so verify_manifest is 38 OK, 0 STALE. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔ **A parameter that is accepted and never read is a promise the caller is keeping for
  nothing.** Sweep for it by AST with a positive control, not by reading the call site.
- ⛔ **"Nothing was written" is proved by a hash on both sides, never by an exit code.**
- ⛔ **When an instruction cannot be executed, measure why and say so.** "Sign twice, once
  per CP" met four packets with one blank block each, and the honest answer was one
  signature naming both.
- ⭐ **Name the weaker evidence tier instead of hiding it.** Three packets declare their
  checkpoint in a sentence; a deriver that pretended otherwise would have refused them.
