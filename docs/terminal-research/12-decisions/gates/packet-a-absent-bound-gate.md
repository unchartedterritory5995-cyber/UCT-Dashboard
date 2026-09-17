---
id: PACKET-A
title: Absent-bound-read-as-open — CLOSED AS FINDING
role: a packet that concluded its own proposed rail must not be built
status: ⛔ CLOSED-AS-FINDING. **There is no approval block, because there is nothing to sign.**
date: 2026-09-14
---

# PACKET A — absent-bound-read-as-open (F-S7-TICK-1's shape)

## ⛔ GATE LINE — **CLOSED-AS-FINDING**

> **This packet is not signature-ready and must not be made so.** It was opened to build a
> rail over a defect shape. The sweep it built to find that shape reported **30** sites;
> hand-triage of all 30 found **zero** defects. The honest output is therefore a **finding**
> (**F-A-1**) plus a **triage instrument** and a **behavioural regression guard** — not a
> gate line, not a checkpoint, and not the rail that was asked for.
>
> ⛔ ~~**No approval block appears in this file deliberately.** An empty block invites a
> signature, and there is nothing here a signature should authorise.~~
>
> ⚰️ **SUPERSEDED 2026-09-15 by owner ruling — and the sentence was half right, which is
> why it survived.** It is true that the **refused rail** is not a thing a signature should
> authorise. But this packet did not only refuse something: it **shipped three files in two
> commits** (`18dd13683`, `31e28c6e3`), and that code sits on `feat/s7-price-level` waiting
> to merge to master like any other unit's.
>
> ⛔ **The consequence was measured, not theorised.** With no block, `merge_all.is_signed()`
> answered **SIGNED** for this packet — because it derived "signed" from the *absence* of an
> unsigned block — so these two commits would have merged with nothing approving them; and
> `verify_manifest --check-commits` showed them claimed by **no unit at all**, so the other
> branch of the same bug would have silently never merged them (**F-MERGE-1**). Both
> failures came from the same missing block.
>
> ⭐ **So the block below signs the DELIVERED CODE, not the refused claim.** The packet stays
> **CLOSED-AS-FINDING** — F-A-1 stands, the shape rail is still refused, and nothing here
> authorises building it. `A CP1` authorises exactly the three files that shipped.

⭐ **The finding is the deliverable.** A packet that discovers its own premise is wrong and
says so is a completed unit, not an abandoned one.

## ⛔ APPROVAL — A CP1, and it covers the shipped code only

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-17
APPROVED AT SHA:  f6180b3da
SCOPE APPROVED:   A-CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **A CP1 — the delivered artifacts of a closed finding.** The triage instrument
> `tools/audit_absent_bound.py`, the caller-level behavioural guard
> `tests/test_s7_ticking_caller_decision.py`, and the clock-injection change to
> `tools/s7_price_level_report.py` that the guard requires, **as enumerated by
> `git show --stat` of the two commits named below**, are delivered. **The shape rail is
> REFUSED per F-A-1 and this checkpoint does not authorise it.**

**Scope, by commit — exactly two, and nothing else:**

| commit | files | what |
|---|---|---|
| `18dd13683` | `tools/audit_absent_bound.py` | the triage instrument — report-only, exit 0, UNREADABLE on an empty roster |
| `31e28c6e3` | `tests/test_s7_ticking_caller_decision.py` · `tools/s7_price_level_report.py` | the caller-level guard, and the `now=` keyword threaded into `_window` that lets it inject a real clock instead of mocking one |

⛔ **`tools/s7_price_level_report.py` is a PRODUCTION tool and its change is named here
rather than folded into "the tests".** `ticking_one()` is what the Layer 1 monitor posts to
admin Discord at 09:12 ET and what the gate check reads at 16:30. The change is additive —
a keyword-only `now=None` threaded to `_window` — so every existing caller is byte-identical
in behaviour, **and that is a claim a signature is entitled to see stated.**

⚠️ **TOLD-VS-FOUND on the one number in the commissioning text.** It described *"the six
caller-level tests"*. Measured — `python -m pytest <file> --collect-only -q` — the file
collects **8**: seven test functions, one of which is parametrized over two keys. The
packet's own prose and the commit message both say eight and are correct.

⭐ **Which is why the assertion above names a PATH and a command, not a count.** Under the
standing rule that an assertion carries no derived numbers, *"the six caller-level tests"*
would have pinned a wrong number into a signature; *"as enumerated by `git show --stat`"*
cannot go stale, because the enumeration is performed rather than quoted.

---

## F-A-1 — a syntactic shape does not distinguish this defect from the ordinary idiom

**Opened 2026-09-14. Non-colliding:** `F-A-1` appears nowhere in `docs/` (checked with a
positive control proving the search finds `F-S7-TICK-1`).

### The claim that was tested

F-S7-TICK-1 was *"an absent bound compared to `None` inside a window predicate is read as
`constraint satisfied` rather than `constraint unknown`."* The packet assumed that shape
could be swept for and railed against.

### What the sweep measured

`tools/audit_absent_bound.py`, AST over the code worktree — never grep, because `CLAUDE.md`
records six separate sweeps that matched their own prose:

```
files parsed 2570 | rows 150
  ABSENT-GUARDED-AND  30      the shape under test
  CLOSED-ON-ABSENT    71      safe by construction
  UNREADABLE          49      not decidable statically — never counted as safe
```

**Non-vacuity, proved:** the roster contains the original defect site,
`tools/s7_price_level_report.py:301`. Had it not, the derivation would have been wrong and
this would have stopped there.

### The 30, by idiom — derived, not typed

| idiom | n |
|---|---|
| window/segment (`window_*`, `start`, `started`, `run_start`, `end`) | 11 |
| deadline/timeout (`deadline`, `until`, `retry_after`, `expires`) | 8 |
| staleness/age (`age_days`, `since`, `stale`) | 7 |
| other | 3 |
| cap/limit (`cap_after`) | 1 |
| **total** | **30** |

**All 30 hand-read. Zero are defects.** They are the ordinary, correct Python optional-guard:

```python
if retry_after is not None and ...                  # absent = the server sent no header
if deadline is not None and ...                     # absent = no deadline was set
if age_days is not None and age_days > _STALE_DAYS  # absent = age UNKNOWN, not stale
if cap_after is not None and ...                    # absent = no cap, deliberately
```

### The 49 UNREADABLE, triaged

| why unreadable | n |
|---|---|
| bare `is not None:` — opens a block, decides nothing | 31 |
| other non-literal comparison (ternary, mixed and/or, cross-module bound) | 18 |
| parse failure | **0** |

⛔ **Each of the 49 was examined by AST for its ENCLOSING FUNCTION**, because the defining
property is at the caller, not in the file. **2** sit inside a function that returns a
window/due verdict:

| site | verdict |
|---|---|
| `api/flow_gap_autofill.py:230` in `detect_windows` — `if cap_end_min is not None:` | **CLEAN** — absent leaves `end_min = _session_end_min(target)`, a real bound |
| `api/services/journal_two/broker/sync.py:246` in `sync_due_accounts` | **CLEAN** — absent falls back to `_default_interval_min()` |

**ZERO candidate defects.** ⭐ And the ZERO is a measurement, not a blind spot: the same
probe run against the known F-S7-TICK-1 site returns `fn=_window, window-deciding=True`.

### ⭐ Why the rail must not be built

**What made F-S7-TICK-1 a defect was never `X is not None and …`.** It was that shape inside
a predicate **whose caller reads "the guard did not fire" as "we are inside the window".**
That property lives at the **caller**, and no pattern over the predicate alone can see it.

⛔ A rail failing on the shape would red **30 correct sites**. A rail that cries wolf gets
muted — which is *precisely the lesson F-S7-TICK-1 itself teaches*: **"a rail that cries wolf
weekly gets muted, and then it is not a rail."** Building it would have re-committed the
defect it was meant to prevent, one level up.

### ⚰️ And it is the third of its kind in one day

Three instruments on 2026-09-14 reported a property of **themselves** as a finding about the
repo — two of them this session's own:

1. `audit_scope_vs_checkpoints`' three retired derived versions (**F-AUDIT-2**, pre-existing)
2. the `APPROVED AT SHA:` block counter whose `\s*` crossed a newline (**Packet C**)
3. this classifier, whose OPEN class is the language's optional-guard idiom (**F-A-1**)

**The class is live, not historical.**

---

## Delivered artifacts

| artifact | path | what it is |
|---|---|---|
| triage instrument | `tools/audit_absent_bound.py` | **report-only, exit 0.** Prints the roster and its size; returns UNREADABLE on zero so an empty derivation is visible |
| behavioural guard | `tests/test_s7_ticking_caller_decision.py` | 8 cases at the **caller**, at fixed ET instants |

### The guard, and why it is at the caller

`ticking_one()` is what the Layer 1 monitor posts to admin Discord at 09:12 ET and the gate
check reads at 16:30. The cases assert **the decision a human acts on** — *is this a fault,
or is it not yet due?* — never the predicate's return value.

⛔ **The clock is INJECTED, not mocked.** `now=` threads a real `datetime` into `_window`,
whose real logic runs. Nothing patches the *source* of time, which is F-CLOCK-1's trap: on
this box `TZ=America/New_York date` silently returns UTC, so a test stubbing a time source
would pass against a clock that lies.

⭐ **Two cases exist to stop the fix becoming a mute**: a silent sweep *inside* its window is
still a fault, and `catalyst-match` at **17:31** — after its firing — is a fault again. A
guard that only ever says "not yet due" would close the false alarm by closing the alarm.

⚠️ **The suite corrected one of its own premises.** `scan_membership` was first parametrised
with the other two as "not yet fired", and failed. It was right to: that cron carries **no
`day_of_week`** — it runs every night — so its last firing is never more than ~24 h back and
staleness is **always** judgeable. It now has its own case documenting the finding's other
half: the pre-fix code returned `n/a (weekend)` for it, hiding a Friday death until Monday.
**Its cadence string said "weekdays"; its cron disagreed, and the cron wins.**

⚠️ **One residual, documented rather than fixed:** a sweep armed *after* its most recent
scheduled firing still reads `NO` until its next one, because the store cannot tell *"armed
ten minutes ago"* from *"died"*. Inventing a grace period would silence a sweep on the
morning it actually died.

---

## Mutations, both restored by EDIT

| mutation | result | restore |
|---|---|---|
| `_window`'s `fires` branch → `if False:` (the pre-fix whole-weekday model) | **3 of 8 caller cases RED** | EDIT; `git diff --stat` shows only the 3 intentional `ticking_one` lines |

**Suite after restore: 90 passed** across `test_s7_ticking_caller_decision`,
`test_s7_ticking_window_is_schedule_aware`, `test_s7_report_selfcheck_is_derived`,
`test_alert_taxonomy_price_level_projection`, `test_weekly_exec`.

---

## Drafted ledger row — NOT written

```
| 68 | `<commit>` | 2026-09-14 18:xx | **S7 / method** | 3 | F-A-1: absent-bound shape is the optional-guard idiom, not the defect; rail refused, caller guard built instead |
```

## Drafted RESUME delta — NOT applied

Under **§5 What a session must NOT do**:

> ⛔ **Do not rail a defect SHAPE that hand-triage shows is an idiom.** 2026-09-14: a sweep
> for F-S7-TICK-1's shape found 30 sites and **zero** defects — `X is not None and …` is the
> ordinary optional guard. The defining property was at the **caller**, which no pattern over
> the predicate can see. **F-A-1.** The protection is
> `tests/test_s7_ticking_caller_decision.py`; the sweep survives as a report-only triage
> instrument, `tools/audit_absent_bound.py`.
