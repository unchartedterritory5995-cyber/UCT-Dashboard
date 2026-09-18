---
id: k-cp18-build-record
unit: K CP18
packet: packet-k-two-command-signing-gate
merges-after: K CP19
status: UNSIGNED
---

# K CP18 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  5ef59fc8d
SCOPE APPROVED:   CP18 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP18 — R-LOCK and R-NO-BULK.** Scope is `tools/merge_lock.py` (new),
> `tools/merge_all.py`, `tools/sign_all.py`, and `tools/pre_sitting.py` **as enumerated by
> `git show --stat` of this unit's commit.**

⛔ **Collision proof:** build records top out at k-cp19 (this session). **CP18 free** —
reserved by the owner's own numbering for this checkpoint, built after K CP19 even though
numbered before it: collision proof is the authority, not build order.

---

## 1 · F-SESSION-1 — two sessions, one merge checkout, nothing stopped them

A concurrent Claude Code session shared `_merge-master` with this one across sessions 7-8 and
independently signed and merged rows 3-6 (`packet-d-nav-tabs-gate`, `packet-b-schema-
resolution-gate`, `packet-v-multi-volume-gate`, `s4-cp2-build-record`) while K CP13-16 were
being built. **Nothing in the tooling detected this, let alone refused it.** Both sessions'
work happened to be compatible — verified after the fact, not guaranteed by anything — which
is exactly the shape of luck this programme's own Layer-0 push guard exists to remove from the
PUSH step. Nothing removed it from the CHECKOUT step one layer earlier.

Separately, `sign_all.py --until k-cp13-build-record` bulk-signed 49 rows when 3 were
intended, because the flag's scope was never audited before running it — a second,
independent way the same session (this one) put more signatures on the wire than it meant to,
in the same window.

## 2 · The fix — a real exclusive lock, and one signer

**`tools/merge_lock.py` (new).** Same shape as this repo's gate-box lock: atomic file
creation (`O_CREAT | O_EXCL` — wholly succeeds or wholly fails, no window where two callers
both believe they hold it), the file records who holds it (pid, session id, ET, checkout
path), a dead holder is reclaimed and the reclaim is RECORDED (never silent), a corrupt lock
file reads as HELD (never as absent — an absence is not evidence a lock can safely be created
over), no TTL (a timed expiry is a lock two sessions can both hold across the boundary), and
`release()` refuses to release a lock it does not itself hold (checked by pid, not merely by
session-id string). Lives at `%PROGRAMDATA%\uct\merge-checkout.lock` (or `/var/tmp/uct` off
Windows) — outside every repo and outside `/data`, the same reasoning as the gate-box lock's
own placement: a fact every worktree of every checkout must see the same way.

**`merge_all.main()` acquires it before `_run()` touches anything**, and releases it in
`finally` on EVERY path out, including every refusal (`main()` was split into a thin outer
`main(argv)` — parse args, dispatch `--self-check`, acquire, call `_run(a)`, release — and the
UNCHANGED original body, renamed `_run(a)`, so the lock wraps the whole thing without
re-indenting several hundred lines by hand). A live holder REFUSES with **exit 6**, naming the
holder; a dead holder is reclaimed, loudly.

**`sign_all.py` no longer signs, at all — R-NO-BULK.** PASS 2 (the write path) is deleted
outright, not merely gated: the tool's only remaining behaviour is PASS 1's verification
report, reachable via `--dry-run` or the clearer `--verify` (kept as the two accepted modes,
per the owner's ruling). `--until` is REFUSED by name (exit 2, "REMOVED (R-NO-BULK...)"), not
silently ignored and not left to argparse's generic "unrecognized argument." Signing already
done stays signed — nothing is retroactively touched.

⚠️ **`sign_all` was NOT given the merge lock.** It no longer writes anything, so the specific
collision the lock exists to prevent (two writers) cannot occur through it — acquiring an
exclusive lock for a pure read would add ceremony without removing risk. Recorded here as a
deliberate scoping decision, not an oversight.

## 3 · A format-drift bug, found by running the FULL pre_sitting after this change

`pre_sitting.py`'s `merge_all --dry-run (REPLAY)` row regex still expected the OLD CLEAN line
shape (`"replay CLEAN N of N"`) — K CP13 changed it to `"replay CLEAN N picked, M already
merged, of T"` and nothing updated this consumer at the time. Result: a perfectly green replay
showed `(no line matched)` in the RESULT column — the identical "right verdict, wrong reason"
shape F-SIGN-11 already named once this session for a different regex. Fixed alongside
`sign_all`'s own output line, which needed the SAME treatment (its callers grep for
`"[sign-all] DRY RUN"`; the new VERIFY-ONLY message keeps that exact prefix for that reason,
stated in-line).

## 4 · Controls

```
1. no lock -> runs (ACQUIRED)                                                          ok
2. a LIVE holder -> HELD, names pid/session/ET                                         ok
3. a dead holder -> RECLAIMED, and the reclaim is RECORDED (old holder named)           ok
4. a CORRUPT lock file -> HELD, never treated as absent                                ok
5. six racers (one real, alive pid) -> exactly ONE ACQUIRED; it did NOT reclaim;
   the other five all read HELD                                                        ok
6. release with the WRONG pid -> refused, names whose lock it actually is              ok
sign_all --until <row>          -> exit 2, "REMOVED (R-NO-BULK...)", nothing written    ok
sign_all --verify (real manifest) -> per-row table, VERIFY-ONLY line, nothing written,
  pre_sitting's regex still matches it                                                 ok
pre_sitting.py, end to end, after all of the above -> READY, 8/8 green                 ok
```

⚰️ **Three bugs in the self-check's OWN fixtures, caught by running them, not reading
them:** (1) the first draft returned a separate `CORRUPT` state where the spec asked for
`HELD` — collapsed to match; (2) the six-racers fixture used fabricated, non-existent pids
(10000-10005), which `tasklist` correctly reports as dead, so every "loser" RECLAIMED instead
of seeing HELD — fixed by having all six racers share THIS process's own real, alive pid;
(3) a release-refusal assertion checked for the substring `"session=s5"` where the actual
detail string reads `"session s5"` (space, not equals) — a trivial format mismatch in the
test, not the underlying logic.

## 5 · Files

```
tools/merge_lock.py     new — acquire/release, dead-pid reclaim, corrupt=HELD, self-check
tools/merge_all.py      main() split into main()+_run(a); lock acquire/release wired in
tools/sign_all.py       --until refused (exit 2); PASS 2 deleted; --verify added;
                        --dry-run's success line keeps its exact old prefix for pre_sitting
tools/pre_sitting.py    REPLAY row's regex updated for K CP13's CLEAN line shape
```

## 6 · Validators

```
ast.parse (all four files)         OK
merge_lock.py --self-check         PASS (6 numbered controls, 10 assertions)
merge_all.py --self-check          PASS (unchanged plus everything from K CP13-19)
sign_all.py --until / --verify     exit 2 refused / exit 0 report, both measured
pre_sitting.py                     READY, 8/8 green, REPLAY row's RESULT column populated
```

## 7 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-18 | SIGNING | 1 | K CP18: two sessions shared one merge checkout with nothing to stop them, and a second, independent incident put 49 signatures on the wire from one bulk-signing command. Fixed with an exclusive, atomic merge-checkout lock (same shape as the gate-box lock: dead-pid reclaim recorded, corrupt reads as held, no TTL) wired into `merge_all`'s entry point, and by deleting `sign_all`'s write path outright — it now only ever verifies. A pre_sitting regex left stale by K CP13's own earlier format change was found and fixed in the same pass, by running the full validator suite rather than trusting the individual pieces. |

## 8 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A collision this programme's own culture would have caught at the PUSH layer went
  uncaught one layer earlier, at the CHECKOUT layer, because nothing had ever asked "can two
  of these run at once" about the checkout itself.** The push guard was built first because
  the push is where a member notices; the checkout collision is quieter and exactly as real.
- ⭐ **Removing a capability is sometimes the correct fix, not a workaround.** `sign_all
  --until`'s bulk path was in tension with K CP10's "signing is the last act before THAT
  unit's merge" from the moment it was written; deleting it resolves the tension rather than
  asking the next session to be more careful with a flag whose blast radius is easy to
  misjudge under time pressure.
- ⛔ **Run the FULL validator chain after any format change, not just the function that
  changed.** K CP13 changed a message format and never re-ran `pre_sitting.py` end to end to
  see whether anything downstream depended on the old shape. It did.
