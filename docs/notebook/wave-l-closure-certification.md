# WAVE L — CAPTURE EVERYWHERE · closure certification

**Date:** 2026-09-08 · **Branch:** `notebook-primary-platform`
**Span:** `83ec154e0` (entry checkpoint) → `65cf9833f` (Slice 5)
**Objective (entry §):** *"I found something useful anywhere — desktop or mobile
— and I can get it into the correct UCT research context in seconds, with
provenance intact."*

---

## 1. What Slice 5 was for, and what it found

Slice 5 was a **truth gate, not a feature wave**: every slice was independently
green, and the question was whether they are ONE product. They were not, in two
specific ways, and both were invisible to slice-level rails **because each slice
tested its own door with context the test supplied**.

| # | Defect | Why every existing rail passed |
|---|---|---|
| 1 | **No capture door ever passed a destination.** The palette and the hotkey both opened with `{}`, so a member inside a note was asked "Choose a note…" about the note they were reading, and `/research/NVDA` prefilled no ticker. | Slice 2 built the whole capability — `captureDestination()`, the dialog's label, `CaptureHost`'s `detail.destination` — and `captureConvergence.test.js` asserted the labels. It tested the **function**. No test asked whether a **door called it**. |
| 2 | **Ask Current Note could not see what was captured into that note.** `retrieve_note` read `body_json` and nothing else, so a note holding three captured passages answered *"This note doesn't have any text yet."* | Wave K certified the note scope when a note's only content **was** its body. Wave L added a content type to notes without extending the retriever. The notebook scope *did* search captures (it reported "6 document pages, 6 saved excerpts"), so corpus-level checks looked healthy. |

⛔ **The second defect had a second layer.** The first fix retrieved the captured
items and Ask *still* said "I couldn't find that in this note" — an evidence item
with no `relevance` never becomes answer evidence. **Retrieval and relevance are
two steps and both have to happen.** Verified live afterwards: Ask now reports
that the source states *"Gross margin normalizes toward the mid-70s"* **and** that
the member's own annotation pushes back on it — the provenance separation Wave L
exists for, visible in the answer.

---

## 2. Integrated E2E — `tools/wave_l_e2e.py`, **0 findings**

Real Chromium against the fail-closed sandbox; desktop 1440×900 and phone
390×844. Screenshots per journey in `tools/wave_l_e2e_out/`.

| Journey | Result | Evidence |
|---|---|---|
| **A** current-note quick thought | ✅ **3 actions** | destination visible; the saved thought carries no `source_url`/`domain` |
| **D** in-app external passage | ✅ | source text and member annotation stored in separate columns; annotation never inside the page text |
| **H** mobile share, explicit `url` | ✅ | url preserved, address bar scrubbed |
| **I** mobile share, **link inside `text`** | ✅ | link extracted, surrounding prose kept as the passage, link not left inside the quote |
| **J** mobile share, **no url** | ✅ | opens the thought box; `passage` empty; **no URL fabricated** |
| **K** **lapsed session** | ✅ | `?next=` is the bare route, no payload; after real sign-in the pending share is recovered with the URL intact and no query in the address bar |
| **L** rights refusal | ✅ | full-page **422**, oversized passage **422**, server-authored refusal text |
| **M** duplicate | ✅ | server returns `deduped: true` |
| **O** capture → Ask | ✅ | grounded answer citing the captured passage, distinguishing source claim from member annotation |
| **P** capture → thesis evidence | ✅ capability | attaches with `stance: "opposes"` on the **edge**; source text untouched — see residual R2 |
| **R** hostile source | ✅ | `window.__pwned` never set; no live markup; script/`onerror`/markdown/"ignore previous instructions" all inert |
| **N** capture → find | ⚠️ partial | findable via destination note and ticker context; **not** via note text search — see residual R1 |

⛔ **Deliberately not re-driven here:** the extension lifecycle, which is owned by
`tools/capture_extension_audit.py` (**28/28**, real unpacked MV3 in real
Chromium) and `tests/test_capture_auth_boundary.py` (**40 rails**: single-use
code, replay mints nothing, absolute expiry not extended by use, revocation,
account purge, cross-tenant refusal, and that `get_current_user` never learned to
accept a bearer). Re-driving them would duplicate authority, not add it.

---

## 3. Residuals — named, not resolved

| # | Residual | Owner | Why it is not a Wave L defect |
|---|---|---|---|
| **R1** | **Note search does not index document page text.** A captured passage is not findable by its own words in Search. | product | `notes.py` documents the boundary; a **PDF behaves identically**. Pre-existing shape, not a Wave L regression. **Ask does reach it** via `j2_note_document_pages_fts`. Strong competitive gap — see §6. |
| **R2** | **A captured passage is not listed as an excerpt of its note**, so its id is not discoverable and there is no member path from "I captured this" to "attach as thesis evidence". | next wave | `list_note_excerpts` joins the refs sidecar that `notes.py` derives from `documentExcerpt` nodes in the **body**; a capture never embeds one. The evidence API accepts a captured excerpt perfectly. **Surfacing gap, not a broken capability** — and building the surface is a feature, which Slice 5 is not. |
| **R3** | **GET share payload reaches Railway's edge** before our code runs. | unenforceable | See §5. |
| **R4** | **No physical handset.** Certified in Chromium at phone width. | next wave | Install eligibility on a given Android build is not proven by a viewport. |
| **R5** | **iOS has no Web Share Target.** | platform | iOS members use in-app capture. No parity claimed. |
| **R6** | Files/images cannot be shared in. | design | A `GET` target cannot carry them; see §5. |

---

## 4. Claimed support — exactly, and no further

| Surface | Status |
|---|---|
| **Chrome / Edge / Chromium MV3 extension** | Built and certified **unpacked**, against the fail-closed sandbox. **No browser-store distribution exists** — do not describe it as published. |
| Firefox extension | **Unbuilt.** Browser-specific assumptions are isolated in `lib/config.js` / `lib/auth.js`, which makes a port a port. That is portability, **not user support**. |
| Safari extension | **Unbuilt.** Needs a native wrapper and a separate distribution path. |
| **Android / Chromium Web Share Target** | Implemented; certified at 390×844 in real Chromium including a real lapsed-session sign-in round trip. **Physical handset not tested.** |
| iOS Web Share Target | **Not the supported mechanism** — the platform does not implement it. |

---

## 5. The GET privacy residual — final wording

**The initial GET Web Share Target request contains the incoming share fields in
its request target.** UCT's application-controlled persistence, navigation and
logging paths have been minimised and railed:

- raw payload removed from the login `next=` (it also never worked: the only
  consumer read `sessionStorage`, so in the storage-blocked browser that carrier
  existed for, the payload arrived back and died — pure privacy cost);
- continuation uses the bare `/journal/share`;
- query scrubbed from the visible URL with **replace** semantics, so Back/Forward
  cannot resurrect it (verified in a real browser: `locationSearch` empty in all
  four states);
- in-process carrier for the same-runtime transition, one-time `sessionStorage`
  only for the sign-in page load, and an **honest failure** when storage is
  refused rather than smuggling the payload through a URL;
- the app's access logger emits no request URLs (`uvicorn.access` silenced in
  `api/main.py`; verified empirically at `--log-level info`), with
  `api/logging_redaction.py` as an independent backstop;
- analytics sends `location.pathname` only, and the route is outside `Layout`;
- no Sentry DSN was present at certification (measured against 226 live vars).

⛔ **Railway edge query visibility remains UNVERIFIED and outside application
enforcement.** Do not write "shared content can never appear in infrastructure
logs."

**Future mitigation, DESIGNED · NOT BUILT · NOT CURRENTLY REQUIRED BY AVAILABLE
EVIDENCE:** a narrow POST-only share handler — service worker handling *only* the
Web Share Target POST, no application caching, **no Cache API at all** (so
`caches` can be banned outright and the rail is structural), no GET/navigation
interception, IndexedDB handoff, and a mutation rail that goes RED on cache-first
behaviour. It is an owner decision because it replaces "no service worker at all"
— a state reached deliberately after a member-visible stale-bundle outage.

---

## 6. Competitive re-run — Capture Everywhere

⚠️ **Classification honesty:** UCT rows are measured in this session. Competitor
rows are from current product knowledge and **were not re-tested hands-on here**;
anything I could not verify is marked **UNVERIFIED** rather than asserted.

| # | Task | UCT | vs Notion / Evernote / Obsidian |
|---|---|---|---|
| 1 | In-app quick thought | **3 actions**, destination prefilled | **COMPETITIVE** |
| 2 | Global quick capture | palette + `Cmd/Ctrl+Shift+Y`; 4 actions with no context (the 4th is the destination question, kept deliberately) | **COMPETITIVE** |
| 3 | Browser reference clip | extension prefills title/URL; page stays active | **COMPETITIVE** |
| 4 | Selected-passage clip | exact selection, 8k ceiling, full-page refused | **COMPETITIVE** (Obsidian adds persistent in-page highlights — **MATERIAL GAP**) |
| 5 | Destination selection | ticker / note / picker over own recents | **SUPERIOR** — no competitor has a *security* to file under |
| 6 | Annotation during capture | separate field, never merged into the quote | **SUPERIOR** — source claim vs member belief is structural, not a convention |
| 7 | Duplicate handling | server-resolved, "Already saved to …" | **COMPETITIVE** |
| 8 | Failure recovery | nothing cleared; retry never means retype | **COMPETITIVE** |
| 9 | Mobile share | server-side destination; works with no local app installed | **SUPERIOR vs Obsidian** (whose clipper needs the app installed and running), **COMPETITIVE** vs Notion/Evernote native apps |
| 10 | Auth friction | one first-party handshake, scoped revocable credential | **COMPETITIVE** |
| 11 | Finding captures later | destination note ✅, ticker workspace ✅, Ask ✅, **text search ✗** | **MATERIAL GAP** (R1) |
| 12 | Provenance | URL + domain + `captured_at`, server-derived; source never becomes belief | **SUPERIOR** |
| 13 | Offline capture | none | **MATERIAL GAP** (Obsidian is local-first) |
| 14 | Privacy/security | scoped token, damage-contained; GET residual documented | **COMPETITIVE** |
| 15 | Capture into structured context | lands in the security's research workspace | **SUPERIOR** |
| 16 | Research continuation | thesis evidence works via API; **not reachable in the UI** | **MATERIAL GAP** (R2) — the biggest single miss, because it is the differentiating journey |

**Where UCT already wins:** a destination that is a *security*, structural
separation of source claim from member interpretation, and a mobile capture that
needs no local app.
**What still blocks a switch:** finding captured text by searching for it (R1),
turning a captured passage into thesis evidence without an API call (R2), and
offline (R6/R13).

---

## 7. Semantic benchmark — measurement only

Local `all-MiniLM-L6-v2`, loaded **offline** from the on-disk cache. No Notebook
content embedded in production, nothing written to a member database, no external
endpoint contacted — the ZDR question is untouched because no member text left
the machine.

| Class | Arm | recall@5 | precision@5 | MRR |
|---|---|---|---|---|
| **Low-overlap** (the Wave K failure class) | lexical | 0.345 | 0.464 | 0.500 |
| | **local semantic** | **0.512** | 0.393 | **0.714** |
| | hybrid (RRF) | 0.512 | 0.393 | 0.714 |
| **Lexical controls** (exact matching should win) | **lexical** | 1.0 | **0.917** | 1.0 |
| | local semantic | 1.0 | 0.608 | 1.0 |
| | hybrid | 1.0 | 0.608 | 1.0 |
| **No-answer** (returning anything is a false positive) | all three | — | **0/3 false positives** | — |

**Ops:** 91.5 MB model on disk · 0.49 s load · 384 dims · ~1.5 KB/passage
(≈15 MB for a 10k-passage member) · **26 ms** vs **0.8 ms** lexical query latency
· index build 0.14 s for 24 passages.

**Three honest conclusions:**
1. **Local semantic is credible.** +48% relative recall and +43% MRR on the exact
   failure class Wave K documented, with no vendor, no retention question and a
   small footprint.
2. **It must be additive, never a replacement.** It *loses* precision on exact
   matching (0.917 → 0.608): a member typing `NVDA` or `inventory days` means it.
3. **Embeddings buy paraphrase, not inference.** Both arms scored **zero** on
   "what could go wrong" and "is demand slowing". And naive RRF fusion gave **no
   measured advantage over semantic alone** while still costing lexical precision
   — so the hybrid needs designing (route by query shape), not just switching on.

---

## 8. Readiness matrix

| Capability | Impl | Reachable | Unit | Integration | Real E2E | Adversarial | Regression | Perf | Sandbox/Prod | Mobile | Security/Rights | Competitive | Residual |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| In-app quick thought | ✅ | ✅ *(fixed in Slice 5)* | ✅ | ✅ | ✅ A | ✅ | ✅ | ✅ | sandbox | ✅ | ✅ | COMPETITIVE | — |
| In-app source capture | ✅ | ✅ | ✅ | ✅ | ✅ D | ✅ R/L | ✅ | ✅ | sandbox | ✅ | ✅ | COMPETITIVE | — |
| Destination context | ✅ | ✅ *(was unreachable)* | ✅ | ✅ | ✅ A | n/a | ✅ | ✅ | sandbox | ✅ | n/a | SUPERIOR | — |
| Browser extension | ✅ | ✅ | ✅ | ✅ | ✅ 28/28 | ✅ | ✅ | ✅ | sandbox | n/a | ✅ 40 rails | COMPETITIVE | unpacked only |
| Mobile Web Share Target | ✅ | ✅ | ✅ | ✅ | ✅ H/I/J/K | ✅ | ✅ | ✅ | sandbox | ✅ 390px | ✅ | SUPERIOR (vs Obsidian) | R3/R4/R5/R6 |
| Rights boundary | ✅ | ✅ | ✅ | ✅ | ✅ L | ✅ | ✅ | n/a | sandbox | ✅ | ✅ | COMPETITIVE | — |
| Duplicate resolution | ✅ | ✅ | ✅ | ✅ | ✅ M | ✅ | ✅ | ✅ | sandbox | ✅ | ✅ | COMPETITIVE | — |
| Capture → Ask | ✅ | ✅ *(fixed in Slice 5)* | ✅ | ✅ | ✅ O | ✅ | ✅ 308 | ⚠️ unmeasured | sandbox | — | ✅ | SUPERIOR | — |
| Capture → find (search) | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ N | — | ✅ | — | sandbox | — | ✅ | **MATERIAL GAP** | **R1** |
| Capture → thesis evidence | ✅ API | ❌ **no UI path** | ✅ | ✅ | ✅ P (API) | — | ✅ | — | sandbox | — | ✅ | **MATERIAL GAP** | **R2** |
| PWA installability | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | sandbox | ✅ | n/a | COMPETITIVE | R4 |

⛔ **"Implemented" and "certified" are different columns on purpose.** Two rows
above are implemented and *not* reachable by a member.

---

## 9. G-080 — reaffirmed, unchanged

**PUBLIC OUTBOUND NOTEBOOK SHARE LINKS: IMPLEMENTED · ACTIVATION DISABLED ·
AUTHORIZATION UNVERIFIED.** Re-verified live during this wave:
`J2_SHARE_LINKS_ENABLED=0`.

⛔ **Inbound mobile sharing INTO UCT is not authorization for public sharing OUT
of UCT.** They are different rights questions with different affected parties.
Wave L touched only the inbound direction. No affirmative §21 evidence has been
found, and the flag stays off.

---

## 10. PWA `start_url` — resolved as INTENTIONAL

Investigated rather than changed. `start_url` is `/dashboard`:

| Who | What happens | Verdict |
|---|---|---|
| Paid member | lands on the Dashboard | correct |
| Free member | `AuthGuard` → `/morning-wire`, the one page they can use | correct — the same resolution any nav link gets |
| Logged out | `AuthGuard` → `/login` | **correct, and better than the alternative** |

**Changing it to `/` would be worse:** `COMING_SOON_MODE=1` and
`VITE_COMING_SOON=1` are live, so `/` serves the marketing holding page — an
installed app whose icon opens a "coming soon" page instead of sign-in.

A manifest `start_url` is static; `AuthGuard` already does dynamic
entitlement resolution. Pointing at the richest destination and letting the guard
downgrade is the correct division. **Not a defect. No change made.**

---

## 11. Regression

Run with the resource-aware separation this repo requires: the heavyweight
whole-tree reachability traversal is **never** in the same vitest invocation as
the Notebook suites, which it provably destabilises.

- **Ask suites:** 308 passed, exit 0.
- **Notebook + capture frontend:** green in the separated invocation.
- **Integrated E2E:** 0 findings.

**Pre-existing reds inherited from master, NOT Wave L-owned and deliberately not
touched** (`git diff origin/master...HEAD` over their paths is empty):
`components/screener/reachable.test.js` (the Floor/community orphans),
`chart/builder/ImportBox.thinkscript`, `chart/engine/ast/manifestProse`,
`chart/engine/ast/pine.blindCorpus` — the indicator workstream's.

⛔ **This is not "the entire repository is green", and it is not claimed to be.**
