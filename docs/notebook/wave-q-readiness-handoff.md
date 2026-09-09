# Wave Q readiness handoff — offline / local-first

```
STATUS         DECISION PACKET ONLY · NO WAVE Q WORK STARTED
WAVE P         CLOSED IN PRODUCTION (OCR live on web, concurrency 1)
THE QUESTION   can a serious investor still access and work with their research
               when the network or the server is not available?
```

⛔ **Everything in §C is read out of the code as it stands today**, not
remembered and not inferred from what the architecture "should" be. Where the
answer is "there is none", that is stated rather than softened.

---

## A · The Notebook capability chain, as it exists

```
MIGRATE      importers (Notion/Obsidian/Evernote/md·docx·txt·html) + background connectors
CAPTURE      web captures, attachments, note editor (TipTap), day notes
RETRIEVE     note FTS + document-page FTS, tenant-scoped, sectioned not blended
DOCUMENTS    native PDF extraction (pypdf) AND scanned pages (Tesseract 5.3.0, live)
SEARCH       page-true hits with `text_origin` provenance ("Scanned text")
ASK          note / document / entity scope, typed evidence envelope, refusal copy
EXCERPTS     exact, source-backed against the canonical page text — or refused
EVIDENCE     stance is the member's; the source claim and their reasoning stay apart
REVIEW       finance-native thesis review, changelog, `changes_since`
RECALL       search and ask over historical decisions
```

⭐ **This is why Wave Q is the next trust question and not a feature.** The chain
above is now the place a member's judgement lives. "Can I get at it without the
network" stops being a convenience and becomes a property of the product.

---

## B · The offline parity pressure

The pressure is **Obsidian-shaped**, and it is not about caching:

- Obsidian's files are on the member's disk in a format they can open with
  anything. The trust claim is *ownership*, not availability.
- Notion is server-authoritative with an offline working copy, and has been
  criticised for years over exactly the seam Wave Q must design.
- Evernote sits between the two, with a long history of sync-conflict artifacts
  that members learned to distrust.

⛔ **UCT does not have to clone Obsidian to earn the trust.** It has to be
explicit about which model it is. §17 is the decision; §E is the bar.

⚠️ **And UCT carries a weight Obsidian does not**: a thesis, its evidence, and a
review history are *dated claims about what was known when*. Offline
reconciliation that silently rewrites those is worse than no offline mode.

---

## C · The current storage architecture, from real code

### Server-side (the whole source of truth today)

```
auth.db                     sessions, users, and every j2_* table
j2_notes                    + j2_notes_fts / _fts_map (trigger-maintained)
j2_note_versions            per-edit history + restore (Wave C/E)
j2_note_documents           one row per attached PDF
j2_note_document_pages      + _fts / _fts_map  — page text, `text_origin`
j2_note_document_ocr_pages  per-page OCR job state
j2_note_excerpts            immutable saved quotes (offsets into the page text)
j2_thesis_evidence          stance, caption, target
attachment bytes            <DATA_DIR>/j2_attachments/... on the Railway volume
```

Attachments are served by **`GET /api/j2/notes/attachments/...` behind
`get_current_user`** — nothing about a document is fetchable without a session.

### Client-side — and this is the short list

```
SERVICE WORKER    ⚰️ NONE. `app/public/sw.js` is a KILL SWITCH (2026-04-26): it
                  installs, deletes every cache the old SW made, unregisters
                  itself and reloads open tabs. `main.jsx` only registers it at
                  all when an old registration is found.
                  ⛔ The previous cache-first SW served stale JS/CSS after every
                  Railway redeploy, so "fresh code" was invisible until a member
                  cleared site data. That is the reason it was deleted.
PWA MANIFEST      `app/public/manifest.json` exists and is linked from index.html.
                  Installability only — it caches nothing.
IndexedDB         exactly ONE user: `app/src/utils/barsIDB.js` (chart bars).
                  ⛔ NOTHING in the Notebook uses IndexedDB.
localStorage      UI preferences only — sidebar open/width, ticker panel, last
                  note opened, Compass TTS toggles.
DRAFT RECOVERY    `uct.j2.notedraft.{noteId}` in localStorage. The ONLY
                  offline-ish write path that exists: the network autosave is
                  debounced 800ms, so a tab closed before it fires (or offline)
                  would lose everything since the last PUT. It is a SAFETY NET,
                  not sync — it recovers one note's body on next open and asks.
SWR              `revalidateOnFocus: false`, `revalidateOnReconnect: false`,
                  dedup 8s (App.jsx). Reads are cached in memory only and die
                  with the tab.
```

⛔⛔ **So today the Notebook is 100% server-authoritative with zero durable
client state.** Offline, a member has: an installable shell that will not load,
and one note's unsaved draft. That is the honest starting line.

### Session and identity

- Cookie session, `SESSION_TTL_DAYS`, validated per request against `auth.db`.
- ⛔ **There is no offline identity story at all.** Any cached research would
  outlive a session that can no longer be validated, which is §16's problem
  before it is an encryption problem.

### The sync precedent that already exists — read this before designing

⭐ **The note connectors already solve a version of Wave Q's hardest question,
and they solve it well** (`api/services/journal_two/note_connectors/engine.py`):

> For a note whose local `updated_at` is newer than its `imported_at` (edited
> locally since the last sync), **do NOT touch the original.** Upsert a sibling
> under `{key}#remote` titled "{title} (synced copy)" and tag **both** the
> sibling and the untouched original `sync-conflict`.

Alongside it: the raw resolution write is **optimistic-locked** so a concurrent
user edit can never be clobbered (it reroutes to a conflict sibling), and it
deliberately does **not** bump `updated_at`, because completing an import
episode is not a new edit — a false-conflict bug that was found and fixed.

⭐ And the ordinary write path already supports compare-and-set:
`notes.update_note(..., expected_updated_at=...)`.

⛔ **Wave Q should start from "never clobber, always fork", not from
last-write-wins and not from a CRDT.** The product already has a conflict
vocabulary a member has seen (`sync-conflict`, "(synced copy)"), and a second,
different one would be worse than either.

---

## D · The design questions, with what the code already implies

1. **Read-only offline, or editable offline?** ⛔ These are different products.
   Read-only is a caching and eviction problem; editable is a sync, conflict and
   history problem. The draft safety net shows appetite for the second, and
   nothing in the codebase is ready for it.
2. **Which objects must be available offline?** Notes and their bodies are the
   floor. Excerpts, evidence, thesis and reviews are the *reason* someone opens
   the Notebook without a network — and they are the objects where a bad
   reconciliation does real damage.
3. **What is the local source of truth while disconnected?** There is no local
   store today. Whatever is chosen (IndexedDB is the only precedent in the repo)
   becomes a second authority over member research — the failure mode this
   program has paid for repeatedly.
4. **How are edits reconciled?** Start from the connector policy above.
5. **What conflict semantics?** ⛔ Not last-write-wins, not full CRDT
   (per directive). "Never clobber, always fork" already ships.
6. **Attachments and PDFs?** ⚠️ Distinguish **metadata cached** from **bytes
   cached**. A 25 MB scan is the unit here; a member told "available offline"
   who then cannot open the page they are citing has been lied to. Storage
   budget and eviction policy are part of the design, not an afterthought.
7. **Review / evidence / thesis writes offline?** These are dated claims. Wave F
   and Wave O's temporal discipline applies: a completed review is history.
8. **Logout / account deletion?** ⛔ A cache that survives logout on a shared
   device is a data-protection incident, not a bug.
9. **Local encryption and security?** Browser storage is not encrypted at rest
   by default on any platform UCT ships to.
10. **Which surfaces first?** The phone is where offline actually bites, and the
    phone is where the P5 work found the layout and touch defects — it is the
    least forgiving surface to start on and the most valuable one.

---

## E · The competitor bar

⛔ **Stated from general product knowledge and not re-verified in those apps for
this handoff** — the UCT column is the measured one.

| | Obsidian | Notion | Evernote | **UCT today** |
|---|---|---|---|---|
| Offline reading | full — files are local | partial, cache-dependent | yes, with a local database | **none** |
| Offline editing | full | limited, historically the weak seam | yes | **one note's draft, as recovery** |
| Local-first authority | yes — the vault IS the truth | no | hybrid | **no — server-authoritative** |
| Conflict handling | file-level conflicted copies | opaque | conflict notes members distrust | **fork-not-clobber, sync only** |
| Attachments offline | local files | partial | yes | **none** |
| Mobile | strong | strong | strong | **shell only, no offline** |
| Trust / export | the strongest bar | improving | mixed | **export exists; offline does not** |

⭐ **UCT's advantage is not going to be "as offline as Obsidian".** It is that
the thing being made available offline is *source-backed judgement* — excerpts
that resolve against a real page, evidence with stance and provenance, reviews
with dates. No competitor has that to lose.

---

## F · A proposed slicing — NOT implemented, and deliberately ordered by trust

```
Q0  DECIDE THE AUTHORITY MODEL          local-first vs server-authoritative
                                        working copy. Nothing else can start.
Q1  OFFLINE READ OF NOTES               a durable local store, an explicit
                                        eviction policy, and a member-visible
                                        "what is available offline" answer.
Q2  OFFLINE READ OF RESEARCH OBJECTS    excerpts, evidence, thesis, reviews —
                                        read-only, with their provenance intact.
Q3  DOCUMENT AVAILABILITY               metadata vs BYTES, stated separately,
                                        with a storage budget.
Q4  OFFLINE EDIT OF NOTE BODIES ONLY    the narrowest editable surface, on the
                                        connector conflict policy.
Q5  RECONCILIATION + CONFLICT UX        the member-facing half of Q4.
Q6  HISTORY-SAFE WRITES                 thesis/evidence/review offline, or a
                                        reasoned refusal to allow them.
Q7  SECURITY + LIFECYCLE                logout, account switch, deletion,
                                        shared devices, encryption posture.
Q8  MOBILE CERTIFICATION                the same eleven-step discipline P5 used.
```

⛔ **Q0 is not paperwork.** Every question in §D resolves differently depending
on it, and the marketing word "local-first" must not be used unless the
architecture actually is (§17).

⛔ **And none of Q1-Q8 is "make the service worker cache more files."** The app
shell, the research data, editing, and sync are four separate claims. This repo
has already deleted one service worker for making the first claim badly.

---

## Decisions needed before Wave Q starts

1. **Q0 — the authority model.** Local-first, or server-authoritative with an
   offline working copy?
2. **Editable offline at all in v1**, or read-only first?
3. **Do thesis / evidence / review writes go offline?** They are dated claims;
   the safe answer may be "read-only, forever".
4. **Storage budget for attachment bytes**, and who is allowed to evict what.
5. **Logout policy**: purge local research on logout (safe, and loses the cache
   every time) or keep it per-account (useful, and a shared-device risk)?
6. **Which surface first** — phone, desktop web, or both.
