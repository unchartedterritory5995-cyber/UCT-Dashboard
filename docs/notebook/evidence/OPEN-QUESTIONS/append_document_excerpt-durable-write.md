# OPEN QUESTION — typing may not reach the durable copy while an attachment entry is queued

⛔ **This is filed as an OPEN QUESTION, not as a rig limitation, because the
evidence is compatible with a PRODUCT defect and nobody has ruled that out.**

## The reading, reproduced across five independent runs

Cell: `append_document_excerpt`, second-writer mode. Its SETUP attaches a PDF
while online; the member then goes offline and types the sentinel sentence.

```
sentenceOnScreen        : True      <- the words ARE in the editor
sentenceInDurableCopy   : False     <- and NOT in IndexedDB
sentenceInQueuedEntry   : False
queuedForThisNote       : 1         <- an entry exists — the ATTACHMENT's
dirty                   : True      <- the app KNOWS there are changes
outboxTotal             : 1
```

Held for **45 s** of polling, **plus one full re-focus-and-retype**, and the
sentence still never reached the durable copy.

## Why this is not obviously the instrument

- The words are **on screen**, so the keystrokes landed.
- `dirty: True`, so the app has registered that the record changed.
- The same cell has gone **GREEN** in other orderings (`drain-first`), so the
  door and the family are drivable.
- It is **biased toward failing in this ordering specifically**, not uniformly
  flaky.

⭐ **The shape to notice:** a note that already has a queued outbox entry (from
the attachment) receives typing that never produces its own durable write. If
that is real, it is the Wave Q1 defect class — **unsent member work that the
durable copy does not hold** — reached by a route nobody has examined, and the
member-facing consequence would be words lost on a note with a pending upload.

## Why it is NOT being called a finding

- Not measured against a control: nobody has run the same interleaving on a note
  **without** an attachment to see whether the typing persists.
- The rig's own label for it is `an INSTRUMENT answer, not a finding`, and that
  label was written before this pattern was visible across five runs.
- No RED was produced anywhere — the cell never got far enough to measure loss,
  so "the member lost words" has not been observed. This is about the SETUP not
  completing, which is a different claim.

## What would settle it

1. Run the same ordering on a note with **no** attachment. If the sentence
   persists there and not here, the attachment is implicated.
2. Read whether a second queued entry is ever created for the note, or whether
   the attachment's entry is expected to coalesce the typing into itself.
3. If it is the product: it belongs to the same family as fix 6 and should be
   named as its own defect, not absorbed into 2.8b's INCONCLUSIVE column.

⛔ **Do not close this by widening a budget.** It survived 45 s and a retype;
another 30 s would only hide it for longer.
