# Q1-F5 — THE APPEND-ONLY MERGE IS UNREACHABLE FOR THE DOOR THIS BROWSER FIRED

**Found 2026-09-13, at unit level, by widening the property rail to seven families —
before the production driver was built. It is LIVE in production today.**

⛔ **NOT FIXED HERE, DELIBERATELY.** The F5 freeze says a branch may not change the
drain's classification or the settle while F5 is open, *"because if the append-only
classification is ever found wrong on production, the investigation has to start
from the code that was measured, not from code that moved underneath it."* This is
that case, arriving earlier than expected. **Owner ruling required.**

---

## The measurement

`offlineWordsSurvive.property.test.jsx`, widened from four doors to all seven
families × six orderings:

| | result |
|---|---|
| **4 metadata families** (`folder` · `ticker` · `tags` · `hero`) × 6 orderings | **24 / 24 GREEN** |
| **3 append families** (`append_widget_embed` · `append_financial_fact` · `append_document_excerpt`) × 6 orderings | **0 / 18 — every one RED** |

The member's offline sentence survives in all 42. What fails is the other half of
the property, which only exists for append families:

> *the server's appended node — the widget, fact or excerpt the member just
> captured — is still in the server's body afterwards.*

⭐ **A clean structural split, not a flaky one.** Every metadata case passes and
every append case fails, in every ordering. That is the signature of a mechanism,
not of timing.

## The mechanism, traced to the line

1. The member queues an offline edit to note *N*.
2. From a surface with **no editor mounted** — `/charts` "Send to Journal", a
   TickerPopup "Save price to Notebook" — they fire an append door. The server
   appends a node to *N*'s body and moves `updatedAt`.
3. `settleNoteWrite` **records that revision in the landed ring**. It does not
   settle; its own docstring says so: *"`settleLandedSave` is an editor-only
   optimisation that needs local state; recording the revision is what stops the
   fork."* The local record does **not** gain the node, and no `serverBase` is
   snapshotted.
4. Reconnect. The drain sends the queued body → **409**.
5. `serverCopyIsOurs` → bodies differ, but the ring holds that revision ⇒
   `{ours: true, identical: false}`.
6. `outboxDrain.js:452` — **the ring-vouched rebase runs first**:
   *"OURS BUT DIFFERENT ⇒ REBASE AND RESEND ONCE."* It calls
   `rebaseEntry(db, entry, mine.serverUpdatedAt)` **with no `serverBase`**, then
   re-sends **the member's body unchanged**.
7. `update_note` sets `body_json` to exactly what the client sent. There is no
   server-side merge of appended nodes.
8. **The node is gone.**

⛔ **The classifier never runs.** `outboxDrain.js:504` is guarded by
`!retriedRebase` — *"It runs ONLY when the ring had nothing to offer and no rebase
has been tried."* A door **this browser fired** is always in the ring, so the ring
always vouches, so `APPEND_ONLY` → `mergeAppends` is unreachable for it.

⭐ **The irony is the point, and it is worth stating plainly.** The landed ring
exists to stop a spurious FORK when a door moves a revision — and it is the same
ring that makes the append merge unreachable. The classifier works exactly when
the door was fired somewhere else (another tab, another device), which is the
rarer case. **The fix is not to weaken the ring.**

## What a member loses

They press *Send to Journal* on a chart, see it confirmed, and a moment later —
when a queued edit drains — the widget is gone from the note. Same for a saved
price and a saved PDF excerpt. It is content loss of exactly the class Wave Q1
exists to prevent, one step over: the lost content is what the member just
**captured**, not what they just **typed**.

⚠️ **Bounded by:** it needs a queued outbox entry for the same note at the moment
the append door fires. With no queued work there is no 409 and nothing to rebase.

## H14

| step | state |
|---|---|
| 1. name the **class** | *a ring-vouched rebase resends a body that predates a server-side append* |
| 2. enumerate what exhibits it, from source | the three frozen append call sites: `captureTargets.js`, `AddPositionModal.jsx`, `importer/enrichment.js` (`/embeds`), `captureFinancialFact.js` (`/facts/…/insert`), `NoteEditorPage.jsx` (`/excerpts`) |
| 3. check the **live build** | ⛔ **OPEN — this is what the F5 production driver must now measure first.** The unit proof is not a production reading |
| 4. block the next deploy | no code change is pending; the next Notebook deploy is docs-only and cannot touch this |

## The shape of a fix — recorded, NOT implemented

The ours-rebase at `outboxDrain.js:452` has the server document in hand
(`mine.serverNote`) and throws it away. Classifying **before** choosing between
rebase and merge — rather than only after the ring declines — would reach
`mergeAppends` for exactly these cases, and change nothing for the metadata
families whose diff classifies as `METADATA_ONLY`.

⛔ That is a change to the drain's classification, which the F5 freeze forbids while
F5 is open, and it is one line away from the code every metadata family's proof was
measured against. **It needs the owner's word, and the production driver's reading
first.**

## Evidence

- `app/src/pages/journal-2-0/lib/offline/offlineWordsSurvive.property.test.jsx` —
  the widened matrix, held on `feat/notebook-kill-switch` and **deliberately not
  merged to master**: 18 red rows would otherwise land in everyone's baseline, and
  banking a known failure is what this programme refuses to do.
- ⚰️ **The first run of it manufactured a finding and the second one nearly did.**
  The fake `serverCopyIsOurs` omitted `serverNote`, so the classifier could not run
  in the fixture *at all* — the same 18 rows went red for a reason that was purely
  the instrument's. Fixed, re-run, and only then traced to the product. **Third
  time this wave the instrument was the first suspect and was right to be.**
