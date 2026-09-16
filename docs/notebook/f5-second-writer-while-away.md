# F5 — SECOND-WRITER-WHILE-AWAY · **GREEN** · 2026-09-14T03:53:58Z

> **The ruling's branch, taken:** *"GREEN → the variable is narrower than 'server
> moved' — post the trail delta against the embed cell and stop."*
> Posted below. Stopped.

## What this cell was for

`navigate-no-door` came back GREEN, so leaving a note and coming back with work
queued does not cost the member their words. The RED cells therefore differ in
something else, and the leading candidate was **whether the server's copy changed
while the member was away**.

This cell changes exactly that and nothing else:

```
queue an offline edit on note N   (rig context, offline)
  -> leave to /charts, fire NO door          (still offline)
  -> a SECOND signed-in browser context moves N's folder through the
     member's own control                    (rig context still offline)
  -> reconnect
  -> return to N
  -> release the note
  -> drain
```

⭐ **It is a second CONTEXT, not a second tab.** Measured against a throwaway
browser on a temp profile before the window opened: two CDP browser contexts see
**nothing** of each other's `localStorage` or `IndexedDB`. A second tab shares the
durable copy and the Web Lock, which is a different experiment entirely.

⛔ **Every failure path in the driver is INCONCLUSIVE, never GREEN**, because a
second writer that wrote nothing would silently re-measure `navigate-no-door`
while wearing this cell's name. The driver reads the server's revision before and
after and refuses the cell if it did not move. It was proved to refuse, twice,
against a stub before the window opened.

## The measurement

**The second writer really did move the server** — this is the non-vacuity
control, and it passed:

```
server_before  2026-09-14T03:54:23.165008+00:00
server_after   2026-09-14T03:55:03.301586+00:00      via select.change
```

**Store trail** `(queued, dirty, base, sentence-in-record)`:

```
[(0, False, 'None', True)]          drain emptied after 2.5s
```

**Wire** (the tail that decides it):

```
PUT /21b276…+SENT[08+00:00] -> 409        the stale baseline is refused
PUT /21b276…+SENT[86+00:00] -> 200        rebased onto the newer revision, carrying the words
```

**Verdict: GREEN — offline sentence in the server body `True`**, 5 requests
carried the sentence, 0 successful sends carried it before the door fired.

## THE TRAIL DELTA — the whole point of the cell

| cell | trail `(queued, dirty, base, sentence-in-record)` | verdict |
|---|---|---|
| `navigate-no-door` | `(0, False, None, True)` | ✅ GREEN |
| **`second-writer-while-away`** | **`(0, False, None, True)`** | ✅ **GREEN** |
| `append_widget_embed × drain-first` | `(1,True,'48',True)` → `(1,True,'85',False)` → `(0,False,None,False)` | 🔴 RED |

⭐⭐ **The second-writer trail is byte-identical to the GREEN one.** The note never
sits dirty-and-queued after the return; the entry is gone in a single 2.5 s poll,
and the words are on the server.

⛔ **The RED cell's trail contains a transition neither GREEN cell ever reaches:**
`sentence-in-record` goes **True → False while the entry is STILL QUEUED and the
record is STILL DIRTY** — `(1,True,'85',False)`. The member's words leave the
durable copy *before the drain runs*, and the entry that is later cleared no
longer carries them.

## What is now known, and what is not

✅ **"The server moved while the member was away" is NOT sufficient to lose the
words.** A metadata door fired by a genuine second writer, with the first context
offline and away, produces the correct behaviour end to end: 409 on the stale
baseline → rebase onto the newer revision → 200 carrying the sentence. That is
the same path `folder × drain-first` proved GREEN, reached from a harder start.

✅ **Navigation is not sufficient either** (`navigate-no-door`, already GREEN).

✅ **Neither is the two of them together** — which is this cell, and it is GREEN.

🔴 **So the variable is narrower than any of those**, and the remaining
difference between this cell and the RED one is that the RED cell fires an
**append door in the FIRST context** — the editor's own append write against the
note it owns, while that note has a queued body save. The suspicion now points at
the interaction between an append write and the editor's own queued save, not at
navigation and not at the server moving.

⛔ **That is a suspicion, not a finding, and it is not published as one.** The
next cell that could settle it has not been run.

## Consequences recorded

- **The remount fix stays HELD and UNSHIPPED.** Its mechanism was not confirmed
  by this measurement, and a fix for a mechanism the measurement did not confirm
  is not shipped. `patch_remount_fix.py` + `patch_remount_mutations.py` remain
  prepared.
- **`remountNeverDiscardsUnsent.test.js` stays committed RED**, as the supersede
  rail already is: it is a faithful unit reproduction of a destructive behaviour
  in `settleLandedSave`, proved to turn 3/3 green under the held fix. What is
  unproven is whether production reaches that call in that state — the audit
  could not derive a producer for it from source either, and said so.
- **R-1a stays HELD**, and its door is already built and dark (see manifest
  §10.28) — so the hold is on a flip, not on a build.

## Instrument faults found in this cell, recorded so they are not rediscovered

1. ⛔ **A leading-`/` argument through Git Bash became a Windows path.**
   `--second-writer /charts` arrived as `C:/Program Files/Git/charts`. The run
   printed the mangled value, which is the only reason it was caught in one
   second. Fixed by passing no value at all and letting `nargs='?'` supply the
   constant; `MSYS_NO_PATHCONV=1` is the general remedy.
2. ⛔ **The profile default resolved to the wrong worktree.** It pointed at
   `notebook-k/.worktrees/…`, which does not exist. ⭐ **The guard refused rather
   than creating one** — *a fresh profile is a SIGNED-OUT profile* — which is the
   guard doing exactly its job. `--profile` must name the one rig profile
   explicitly from this worktree.
3. ⛔⛔ **A document-load return cannot happen offline.** The first attempt
   deferred the reconnect until after the return, per the ruling's literal
   ordering, and `page.goto` died with `net::ERR_INTERNET_DISCONNECTED`.

   ⚠️ **The obvious fix was the wrong one.** Switching the return to an SPA route
   change would have worked — and would have made this cell differ from the GREEN
   baseline in **two** ways at once (the second writer *and* the return
   mechanism), destroying the isolation that is the entire reason the cell
   exists. The reconnect was moved to just after the second writer instead, so
   the cell is now byte-identical to `navigate-no-door` plus one variable.

   ⚖️ **Stated deviation from the ruling's literal wording:** the ruling said
   *"return to N in the first context; reconnect"*. This cell reconnects **before**
   the return. The member is still away and offline while the server moves, which
   is what "while away" means; and matching the GREEN cell's ordering is what
   makes the comparison mean anything. Recorded rather than done quietly.
