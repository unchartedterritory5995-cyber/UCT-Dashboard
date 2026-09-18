---
id: PACKET-K
title: Nine signatures and eight merges from two commands — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-14
---

# PACKET K — two commands, not seventeen

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  36179a330
SCOPE APPROVED:   CP1, CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs the signing or
> merging procedure. **Non-collision:** `PACKET-K` appears nowhere in either worktree
> (control: the same search finds `PACKET-E` and `PACKET-V`).

⛔ **ZERO PRODUCT CODE.** Two operator scripts and a manifest. Nothing runs this session.

---

## 1 · The problem, stated as a number

Nine unsigned units. Signing them by hand is **ten** `sign_gate.py` invocations (the
T/D3 packet carries two checkpoints), each needing a hand-written scope file and a
hand-pasted fingerprint. Merging them is eight merges, each with a guard wait and a deploy
watch.

⭐ **This removes typing, not judgement.** The owner still authorises every signature — by
choosing to run the command, having read the manifest table, which is printed before
anything is written. What it removes is seventeen hand-typed invocations and the chance of
pasting the wrong fingerprint into one of them.

---

## 2 · ⚰️ The drift this exists to catch is already in the record

The F-S2-1 packet was published to the owner as **`28da7740d`** and edited **the same day**
(an attribution correction: `0b7570df4` → `453ecc3ec`). Its real fingerprint is
**`72cda4cda`**.

**A signature recorded against `28da7740d` would have approved a document that no longer
existed.** `sign_all.py` recomputes every fingerprint before writing anything, and this row
is the reason the check is a hard stop rather than a warning.

---

## 3 · Proposed checkpoints

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | `tools/sign_all.py` + `tools/sign_manifest.txt` — verify-then-sign, in merge order | none | **S** |
| **CP2** | `tools/merge_all.py` — verify-signed, merge, push through the Layer-0 guard, wait for SUCCESS | none | **S** |

⛔ **Both are operator tooling in the docs worktree. Neither is run by the session that
builds them**, which is the whole point: a script that merges to production must be read
before it is trusted, and its author is the least reliable reader.

---

## 4 · What `sign_all.py` refuses to do

| refusal | why |
|---|---|
| **Two passes.** Verify EVERY row, then sign. | A manifest that has drifted in one place is not trustworthy in the others, so a mismatch writes **nothing at all** — not even for rows that verified. |
| **Never invents a date.** Reads the ET clock authority; exits if it cannot. | F-CLOCK-1: `TZ=… date` silently returns UTC in Git Bash, and **two prompts in this programme already carried a wrong date**. |
| **Never reimplements the fingerprint.** Imports `sign_gate.fingerprint`. | A second implementation of a fingerprint is a second authority over it. |
| **Scope names the CHECKPOINT.** Written from the manifest's ids. | *"SCOPE APPROVED: Packet B"* authorises nothing; §4 of every packet exists so a line can name a checkpoint instead. |

⚠️ **One defect found while building it, and the refusal was correct.** v1 looked for
`weekly_exec.py` beside itself and exited — the clock authority lives in the **code**
worktree. It refused rather than guessing a date, which is the designed behaviour; the
scope was simply wrong. Candidates are now declared, tried in order, and **named** when
none works.

⚠️ **And a second-authority trap:** `git hash-object` returns 40 characters,
`sign_gate.fingerprint()` returns the 9-character form it actually writes into the block.
The manifest carries **sign_gate's form**, because the value in the block is the one a
reader will later compare against.

---

## 5 · What `merge_all.py` refuses to do

| refusal | why |
|---|---|
| **Reads the approval block with `sign_gate`'s own parser**, never a regex | ⚰️ `APPROVED AT SHA:\s*\S` once counted UNSIGNED blocks as signed by matching the `S` of the next line (Packet C). |
| **F-S2-1 needs `--include-member-visible`** | It is the only unit a member can feel. Without the flag the script **stops before it and says so**. |
| **One unit at a time**, each waiting for `SUCCESS` + ≥150 s settled | ⚰️ Two merges four minutes apart marked the first deploy `REMOVED` mid-flight and served 502s. *"The queue was clear when I started my gate"* is true and useless. |
| **Stops on any non-SUCCESS** | A deploy that did not finish is not a deploy that finished. |
| **Never `--no-verify`** | The Layer-0 guard is the serialisation; bypassing it leaves no trace anywhere. |

---

## 6 · The manifest is the artifact the owner actually reads

`tools/sign_manifest.txt` — `packet path | checkpoint id(s) | fingerprint`, in **merge
order**, one row per **checkpoint**. Its header carries the three ordering constraints
(C before D, B before V, F-S2-1 last) so the order is legible without this document.

---

## 7 · Drafted ledger row — NOT written

```
| 80 | <K commit> | 2026-09-14 | TOOLING | 3 | Packet K: sign_all.py + merge_all.py + the manifest. Two commands replace 17 hand-typed invocations; the fingerprint recompute immediately caught F-S2-1 published as 28da7740d and edited to 72cda4cda the same day.
```

## 8 · Drafted RESUME delta — NOT applied

> ⛔ **A published fingerprint goes stale the moment the packet is edited.** Recompute
> before signing; never sign against a value from a report. ⚰️ 2026-09-14: F-S2-1 was
> published as `28da7740d` and edited hours later to `72cda4cda`.
> `python tools/sign_all.py --manifest tools/sign_manifest.txt` verifies every row before
> writing any.
