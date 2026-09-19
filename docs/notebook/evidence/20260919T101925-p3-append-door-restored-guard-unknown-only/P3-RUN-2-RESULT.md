# P3 run 2 — the instrument fix did not fire, and THAT is the finding

Same shape as run 1: **GREEN 0 · RED 0 · DEFERRED-BY-GUARD 0 · INCONCLUSIVE 3.**
Guard verified `unknown-only` in the running process before, `full` after.

## What was changed between the runs, and what it proves

The drain-wait was taught to accept EITHER condition:

```
the outbox emptied            (the sweep delivered it)
the server HAS the sentence   (the editor delivered it)   ← added
```

**The second never fired.** There is no `the SERVER has the sentence` line in the
artifact. So within 240 s the member's words reached **neither** the server via
the sweep **nor** the server via the editor.

## The picture that now closes

| layer | has the sentence? |
|---|---|
| the editor's own view | **no** — its `PUT /<id>` went out WITHOUT the sentence (no `+SENT` tag) |
| the durable IndexedDB copy | **yes** — `sentenceInDurableCopy: True` for the whole window |
| the outbox entry | **yes** — `queuedForThisNote: 1`, carrying it |
| the server | **no** |

⭐ **That is fix 6 doing exactly its job.** The editor's view was reseeded by the
append door and no longer holds the offline words; `persist` therefore refuses to
write the editor's content over the durable copy, and the words survive locally.
Every one of those rows is the designed outcome.

⛔ **And delivery is blocked by a second, independent fact:** the sweep skips the
note the editor has open (`excludeNoteId`), and the editor cannot deliver words
its own view does not contain. So while the member stays on that note, the words
are SAFE and UNDELIVERED.

## Is that a defect?

**Stated, not decided.** It is the conservative outcome — nothing is lost, and
closing the note hands the entry to the sweep (`NoteEditorPage.jsx:807`). But a
member who stays on the note sees "unsynced" indefinitely, and nothing in the
product moves it until they navigate away. Whether that is acceptable is a
product call, not a rig call, and it is the last open question in this programme.

## What D3 needs

The cell must **leave the note before waiting** — that is the one interleaving
under which the entry is the sweep's and the existing measurement is valid. That
is a change to what the cell MODELS (a member who fires the door and moves on,
rather than one who stays), so it is a deliberate scope decision and is NOT made
unilaterally here.

⛔ Not by raising the ceiling — this is the fourth time that lever would have
hidden the answer instead of producing one.

## Unchanged

**RED 0 across both P3 runs**, with the door open and the guard not protecting it.
Nothing was lost. `NOTEBOOK_OFFLINE` untouched.
