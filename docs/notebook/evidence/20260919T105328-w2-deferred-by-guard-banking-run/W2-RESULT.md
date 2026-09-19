# ⚰️ W2 — RESOLVED: it was the RIG, and it could never have worked

**The "two explanations" below were settled the same day. It was (1), and not
occasionally — structurally.**

```
useJournalToast.jsx:17   setTimeout(() => setJournalMsg(null), 2200)
q1_f5_matrix.py          page.wait_for_timeout(5000)  then read the toast
```

The product clears the deferral toast at **2200 ms**; the rig slept **5000 ms**
and then looked. The toast was gone before every read, so `toast_seen` was
structurally always False and `DEFERRED-BY-GUARD` was **unreachable**. W2 could
never have banked its reading.

⭐ And the member IS told. Proved independently of any rig by rendered DOM text:
`deferralReachesTheMember.test.jsx` renders the real `useJournalToast` +
`JournalToast` chain and asserts `getByText(STILL_SYNCING_MESSAGE)` — 4 passed,
mutation-proved by reintroducing the historical wrong-prop defect (`message`
for `msg`), which reds it 2 of 4.

⛔ THE RAIL GAP WAS REAL EVEN THOUGH THE PRODUCT WAS FINE.
`doorDefersWhileUnsent.test.js` asserted the RETURN VALUE and never rendered
anything, so nothing proved the sentence reached a member — which is exactly
what the standing rule forbids, and why this looked like a live product
suspicion for an hour.

---

## Original write-up, kept


`append_widget_embed`, all five orderings, guard `full` (verified in-process).

```
GREEN 0 · RED 0 · DEFERRED-BY-GUARD 0 · INCONCLUSIVE 5
```

Four of five: **"a SILENT NOTHING: no call to the door's endpoint and no deferral
sentence on screen."** One: the editor never mounted inside 30 s.

## What that means, and what it does not

The cell's fourth outcome exists precisely so a deferral can be told apart from a
door that silently did nothing, and it **cannot answer DEFERRED without the
toast** — the tool's own self-check asserts that. It saw no toast, so it correctly
refused to record one.

⛔ **This does NOT establish that the guard failed to defer.** No call to
`/embeds` was made, which is what a working guard produces. What is missing is the
member-facing half.

⚠️ **Two explanations remain open and this artifact cannot separate them:**

1. the rig's click missed the control, or
2. **the guard defers without telling the member** — the door stops, and no
   sentence appears on screen.

(2) would be the class CLAUDE.md already records twice for this repo: a toast
passed the wrong prop name, and a toast owned by the element its own action
unmounts — *"the only broken part was the half that talks to the member"*, with
every structural assertion green.

## What would separate them

One run with the door's control asserted present-and-clicked **before** the toast
is looked for, or a DOM read of the toast host immediately after the click. The
rig currently infers the click from the absence of an endpoint call, and absence
is exactly what both explanations produce.

## Status

R-RAW satisfied — the raw artifact is on disk and committed before this summary.
The cell is requeued, not banked. **D1's "the member was told" half is not
evidenced by this run**, and the earlier D1 citation
(`evidence/20260917T122035-…`) should be re-read before anyone treats it as
covering the toast.
