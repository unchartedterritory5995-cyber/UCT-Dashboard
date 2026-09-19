# ⛔⛔ CONFIRMED DEFECT — fix 6 drops words the member is still typing

**This is the resolution of `append_document_excerpt-durable-write.md`. That file
asked whether a rig INCONCLUSIVE was hiding a product bug. It was.**

Status: **reproduced, railed, NOT fixed.** A fix was written and reverted because
it traded this bug for a worse one. See "Why it is not fixed".

## The defect

`discardsUnsentWork` (`recoverLocalState.js`) documents itself as DIRECTIONAL and
is implemented as SYMMETRIC:

```
@returns true when `prev` is carrying words `incoming` does not have
return !sameAuthoredContent(incoming, prev)
```

Once a note is **dirty**, every further keystroke makes `incoming` differ from
`prev` — in the direction where incoming has **more**. `persist` then does:

```js
const source = unsentWork ? prev : state
```

and writes `prev`. **The member's newer words never reach the durable copy.** The
editor keeps showing them; a reload does not.

⭐ This is the exact failure class Wave Q1 exists to prevent, introduced by the
fix built to prevent it.

## Member-facing consequence

A member with unsent work — offline, or after a failed sync — who keeps typing
has everything after the first debounce window held only in memory. Close the tab
or reload and it is gone. It is not forked, not queued, not on the server.

## Why 86 GREEN production cells could not see it

Every F5 rig cell types its sentinel in **one burst**, which a single debounce
window captures **while the record is still clean**. The failure needs a note
already dirty when the typing starts.

⚰️ That is exactly what `append_document_excerpt`'s setup leaves behind — it
attaches a PDF first — which is why **that one cell failed reproducibly across
five runs** while everything around it passed, and why it spent the evening
labelled *"an INSTRUMENT answer, not a finding"*. The rig was right to keep
flagging it. The label was wrong.

## Why it is not fixed

A directional fix — "does `incoming` still CARRY prev's words?" — makes `persist`
correct and **breaks `settleLandedSave`**: a door passing LOCAL state as `acked`
also carries prev's words, so the queue clears and unsent work is deleted. That
is the original fix 4 defect.

Measured, not predicted: `selfForkDoors.test.jsx > a door must NOT pass local
state as \`acked\`` went **11 passed → 1 failed**, and re-running it against
`HEAD~1` proved the regression was the fix's and not master's.

## ⭐ The real finding: one predicate cannot answer both callers

| caller | what `incoming` is | what the right answer depends on |
|---|---|---|
| `persist` | the **editor's** live content | authoritative, legitimately newer than the durable copy |
| `settleLandedSave` | what the **server acked** | may be a door's lie about what the server has |

Fix 6 merged them on "one authority" grounds. **It was right about the invariant
and wrong about the question.** The two paths need predicates that know where
their input came from — probably a provenance tag on the write, not a content
comparison. That needs its own design and its own evidence, and must not be
improvised on the note-saving path.

## Rail

`app/src/pages/journal-2-0/lib/offline/fix6KeepsTyping.test.js` **pins the wrong
behaviour on purpose** and says so in its assertion message, so whoever fixes it
gets a red telling them to delete the pin rather than adjust it.
