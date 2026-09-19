# ✅ D3 CLOSED — five append cells GREEN on production, two consecutive windows

```
window 1  12:30:28Z   5 GREEN · 0 RED · 0 INCONCLUSIVE · 0 DEFERRED   310.8s
window 2  12:36:25Z   5 GREEN · 0 RED · 0 INCONCLUSIVE · 0 DEFERRED   306.5s
```

`NOTEBOOK_DOOR_GUARD = unknown-only`, verified IN THE RUNNING PROCESS before,
between and after — from the pod's own `os.environ`, never from
`railway variables --kv`.

Every cell reads both halves:

```
offline sentence in the server body: True    ← the member's words survived
appended node present:               True    ← and the door's own node landed
```

⭐ **The standing rule is "two consecutive GREEN windows → the guard STAYS
unknown-only, D3 TRUE".** Both windows are GREEN, so the guard stays narrowed and
the append door is open to members with Q1 fix 6 as its protection.

## What it took, and none of it was the product

D3 sat OPEN for the whole programme behind **five instrument defects**, each
uncovered by fixing the one before it:

| # | defect | effect |
|---|---|---|
| 1 | editor mount sampled, not waited | the sentence was never typed |
| 2 | second-context door sampled | "no folder `<select>` on the page" |
| 3 | setup keystroke read too early | "never got the sentence into a queued entry" |
| 4 | a 2200 ms toast read at 5000 ms | `DEFERRED` was structurally unreachable |
| 5 | release-the-note gated to the controlled experiments | every append cell timed out |

⛔ Every one was a `wait_for_timeout` beside a point-in-time read, and every one
produced a message that was TRUE and pointed at the wrong subsystem.

## The one product defect, and it was real

`persist` dropped words a member typed **on top of their own unsent work** —
`discardsUnsentWork` was documented as directional and implemented as symmetric.
Fixed by splitting the predicate by PROVENANCE (`editorStateDiscardsUnsentWork`
for the editor, `discardsUnsentWork` for a server ack), gated, landed, and
confirmed when the two cells that exposed it passed first try.

## What is NOT claimed

- The `slow PUT` RED of run 3 was a **server 500 on `/embeds`**, and the member's
  words survived it. It is not evidence about the client and was not re-run to
  make it disappear — it passed on a quiet pod because the server answered.
- Two consecutive windows is the rule's bar, not proof for all time. The guard
  stays narrowed **because the rule says so**, and the rollback lever is one
  verified command if a member reports otherwise.

## RESERVED

**`NOTEBOOK_OFFLINE` untouched for the entire programme.**
