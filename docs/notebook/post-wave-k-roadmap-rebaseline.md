# Post-Wave-K Roadmap Re-Baseline

**Date:** 2026-09-07 · **Occasion:** Wave K parked behind the 8G-B shared-production
hold; the waiting window used for read-only re-baselining.
**Status:** PLANNING ONLY — **ACCEPTED with owner rulings 2026-09-07 (see §6, which governs).** No implementation authorized by this document. Wave L
does not begin until Wave K is fully production-certified.

**The question this answers:** *after Waves A–K, what would still force a serious
user to keep Notion, Evernote, or Obsidian open beside UCT?*

---

## 0. Method, and why the old ledger could not answer this on its own

Every claim below was checked against **code and production configuration**, not
against the ledger's own status column. That mattered: **the gap ledger's statuses
have drifted badly.** Rows closed by later waves still read OPEN, because a wave
that closes a gap writes its own new section rather than editing the old row.

Verified stale (closed in code, still reading OPEN/PARTIAL in the ledger):
G-025 saved views (`SavedViewEditor.jsx`, `useJ2SavedViews.js` — Wave E),
G-026 templates (`TemplatePicker.jsx`, `notebookTemplates.js`),
G-051 Ask Notebook (Wave K), G-075 per-ticker research surface (Wave H),
G-100/G-101 raw-error leaks (Wave B, mostly — see finding D).

⛔ **A ledger whose status column is stale is worse than no ledger, because it is
consulted for planning.** Reconciling it is a task in its own right, listed in §5.

---

## 1. Four findings that change the plan

### A. Public share links are LIVE in production. Three documents say they are dark. 🔴

`J2_SHARE_LINKS_ENABLED=1` on the `web` service — read directly from Railway
2026-09-07, and independently corroborated by the 2026-09-04 observability audit's
"Actual prod value" column. The member-facing UI is wired: `NoteEditorPage.jsx`
fetches `/api/j2/notes/{id}/share`, offers copy-link and unshare.

Meanwhile:

| Document | What it says |
|---|---|
| Gap ledger G-080 | "flag-gated OFF (`J2_SHARE_LINKS_ENABLED=0`)", status **DONE (dark)** |
| Build plan G-080 activation row | "Flip `J2_SHARE_LINKS_ENABLED` on — policy decision once real demand exists" (written as pending) |
| Phase Zero §18 table | "PROVEN LIVE (flag-gated OFF by default)" |

And G-080's own recorded preconditions for flipping it are:
**Validation condition — "Real usage data shows demand before flipping the flag."
Dependencies — "§21 legal review (shared vendor-data exposure risk)."**
Neither is recorded anywhere as met.

**This is not a feature gap; it is a live member-facing publishing surface that the
program's own planning record believes is switched off.** The exposure is bounded
by real engineering — the payload is sanitized (no user id, tags, folder or ticker)
and widget embeds render as static archived images rather than live vendor data —
which is very likely *why* it is safe, but "probably fine" is not the same as the
legal review the ledger names as its dependency.

⛔ **Owner ruling needed, and it is a ruling, not an engineering task.** Three
options: (1) confirm the flip was deliberate and record it, closing G-080 properly
and scheduling the discoverability/UX certification the surface never got; (2) turn
it off until §21 clears; (3) confirm §21 already cleared and the record simply
missed it. **I did not change the flag.** This is the inverse of
`project_feature_flag_ledger`'s known failure mode: not "off and unset look alike",
but *the documentation says off while production says on*.

### B. A correctness bug sits inside the product's own moat 🟠

G-063, still open, verified in `app/src/pages/journal-2-0/lib/widgetEmbedCore.js:237`:

```js
if (isReconstructable(attrs.widgetId, attrs.params)) return { kind: 'live', reason: 'reconstructable' }
```

There is no future-relative-to-capture gate. A Calendar embed captured *before* an
event resolves re-renders live, so the member reviewing an old note sees **actual
results where they wrote down an expectation.** Frozen-at-insert temporal
correctness (G-061) is the differentiator this whole program calls its moat, and
this is a hole in it. The fix is small and scoped: gate `reconstructable` on
whether the captured date was future-relative to capture time.

### C. The cheapest high-leverage UX gap in the entire audit is still open, eleven waves later 🟠

G-102. Re-verified by fresh grep today: `CommandPalette.jsx` exists app-wide
(`Layout.jsx`, `Settings.jsx` participate) and **`pages/journal-2-0/` registers
exactly zero commands.** The scorecard has called this "the single cheapest,
highest-leverage UX gap found in this entire audit" since the first audit pass, and
Power-User Efficiency is still the lowest score on the board at 3.

Notion users reach for `Cmd+K`; Obsidian users reach for the quick switcher. In UCT
they get a palette that cannot find their notes. **This is not a missing capability
— the capability exists and Notebook simply is not wired into it.**

### D. The raw-error defect class recurred in a later wave 🟠

Wave B fixed the raw-error leaks (G-100). Wave H then reintroduced the exact
pattern in `TickerResearchWorkspace.jsx:73,85`:

```js
alert(`Could not create note: ${e.message || e}`)
```

Both a raw exception interpolated into member-facing text *and* a native `alert()`
— the same two patterns the scorecard names as trust-eroding. A fix that is not
railed is a fix with a shelf life; this one lasted one wave.

---

## 2. The honest answer to the question

**What still forces a serious user to keep another notebook app open:**

| # | Blocker | Who feels it | Competitor with it |
|---|---|---|---|
| 1 | **No web capture.** A researcher reads filings, news and blog posts in a browser and has no way to get them into UCT | Everyone, daily | All three (Evernote's clipper does article / simplified / screenshot / annotated; Notion's clipper; Obsidian via plugins) |
| 2 | **Semantic recall.** "I know I wrote something about margin pressure" returns nothing when the note says "gross margin normalization" | Everyone, weekly | Notion, Evernote (both semantic); Obsidian via Smart Connections' **local** model |
| 3 | **No OCR.** A scanned 10-K or a screenshot of a chart is text-invisible | Document-heavy | Evernote (server-side OCR) |
| 4 | **No mobile capture.** No share-sheet; the PWA manifest is a stub (`start_url:/dashboard`, one SVG icon, no 192/512 PNGs, no maskable icon) | Everyone, daily | All three |
| 5 | **No keyboard speed.** No palette participation, no note-level shortcuts | Power users, constantly | Notion, Obsidian |
| 6 | **No offline.** No service worker at all | Obsidian switchers especially | Obsidian (native), Evernote, Notion (degraded) |
| 7 | **Note bodies are plaintext at rest.** Connector tokens are Fernet-encrypted; note content is not (G-004, P1) | Anyone told this is their primary store | Baseline expectation for the pitch |

**And the second half of the standard — is UCT so financially aware that generic
notebooks feel incomplete?** Here the answer is already strong and getting stronger:
frozen financial facts, thesis objects with evidence edges and a changelog,
page-anchored document excerpts, per-ticker research workspaces, and now
citation-grounded Ask across four scopes. Nothing in Notion, Evernote or Obsidian
comes close to any of it. **The remaining risk is not that UCT is not financial
enough — it is that a member cannot get their material IN (1, 3, 4) or FIND it
again (2), which are exactly the boring capabilities that decide whether a
notebook becomes primary.**

---

## 3. The re-baseline's central insight

**OCR and semantic retrieval are blocked on the same decision, and the roadmap
treats them as two unrelated rows.**

⛔ **Corrected by owner ruling 2026-09-07** (this section originally said they were
"the same decision", which overstated it): they share the *external-data / privacy*
question, and they are **NOT the same technical capability**. One privacy
evaluation, two separate technical benchmarks. See §6.A/§6.B.

- G-121 (OCR) is blocked on: *may private member documents be processed by an
  external service, and at what cost?*
- G-127 (semantic) is blocked on: *may private member notes be sent to an external
  embedding endpoint, and under what retention terms?*

One question, asked twice. And Wave K's competitor research surfaced the answer
that dissolves both: **Obsidian's most-used AI plugin does vault-wide semantic
search with a local embedding model — no API key, nothing leaving the machine.**
The same shape applies to OCR (Tesseract-class local extraction).

⭐ **Recommendation: one privacy/compute evaluation, two separate technical
benchmarks** (§6). The purpose is to determine whether UCT can close both gaps
**without expanding private member content to an external processor.** If it
clears, OCR and semantic recall both unblock with no vendor retention question at
all, and ZDR stops being a dependency for shipping. If it does not clear, both stay
blocked on one owner decision instead of two.

⛔ **Benchmark first. Do not adopt a model merely because a competitor uses one.**
Obsidian's plugin is evidence that the shape is viable, not evidence that any
particular model is right for this corpus on this pod.

This does not authorize implementation, and it changes nothing about Wave K:
semantic retrieval remains architecturally approved, quality-justified by the
measured deterministic recall failure, **NOT ACTIVATED**, and blocked on
exact-project Zero Data Retention verification. No Notebook content has been sent
to the embedding endpoint.

---

## 4. Re-ranked next-wave sequence

Ranked against the owner's ten criteria (switching blockers, frequency, UX impact,
financial differentiation, dependency order, trust/portability, mobile, parity,
acquisition, retention). **Deliberately not inherited from the old roadmap order.**

### Wave L — CAPTURE & COMMAND · "get it in, and get around fast"
*Switching blockers #1, #4, #5. Highest frequency-of-use of anything remaining.*

1. **Web capture.** G-043 was previously REJECTED (general) / EXPERIMENT (narrow) —
   that ruling deserves revisiting, because it was made before the product had
   documents, excerpts, theses and Ask to capture *into*. A financial researcher's
   day is spent in a browser. The narrow, high-value form: capture a page or
   selection **to a ticker's research**, not to a generic inbox.
2. **Finish G-040's four uncovered surfaces** — Screener, Options Flow, COT Data,
   Model Book. Cheapest capture win available: the mechanism exists at nine call
   sites and simply is not wired at four. **Do this before building an extension.**
3. **Command palette participation (G-102).** Notes, saved views, Ask, and
   "new note in this ticker's research" as commands. Cheap, and it is the
   difference between "an app I use" and "an app I live in".
4. **Mobile capture + a real PWA manifest** — share-sheet target, proper icon set.
5. **Note-level keyboard shortcuts** to lift Power-User Efficiency off 3.

### Wave M — RECALL · "find what you wrote, however you phrase it"
*Switching blockers #2, #3 — gated on the §3 spike, sequenced after it.*

The local-intelligence spike first; then, on its result, semantic retrieval and OCR
together, sharing one privacy model, one index, one cost story. If the spike fails,
this wave becomes the external-vendor decision instead — still one decision.

### Wave N — THE FINANCIAL REVIEW LOOP · "the thing no generic notebook can do"
*Highest financial differentiation and retention of anything on the list.*

Reminders and review workflows that are finance-native rather than generic tasks:
review this thesis when earnings land; re-check this catalyst on its date; surface
the note whose thesis its own captured facts now contradict (G-074, previously
deferred as an experiment — it is the natural payoff of Waves F+G+K together and
should be re-tiered). **This is where "generic notebooks feel incomplete" stops
being a slogan.**

### Wave O — DURABILITY & REACH
Offline read-only cache of recent notes (G-083 — the honest middle; full offline
editing G-082 stays low-value against a live-data product), note-body encryption at
rest (G-004), mobile deepening, export/portability hardening.

### Deferred, deliberately
Public API / webhooks (G-085), plugin marketplace (G-086, rejected), multiplayer and
comments (G-081) — none is a pre-launch switching blocker for a single-member
research tool.

### Not a wave — do these inside Wave K's production closure or immediately after
- **A ruling on the live share-link flag** (§1A). Owner decision, no code.
- **G-063 temporal-correctness gate** (§1B). Small, and it is a hole in the moat.
- **A rail on the raw-error/native-`alert` pattern** (§1D), so the class stops
  recurring; plus the two `TickerResearchWorkspace.jsx` call sites.
- **Reconcile the gap ledger's status column** (§0) before it misleads the next
  planning pass.

---

## 5. Preserved debt, unchanged

- Exact-project **ZDR remains unverified**; the **semantic leg remains dark**; no
  Notebook content has been sent to the embedding endpoint.
- **Local-embedding architecture is a legitimate future option** discovered from
  competitor research and **was NOT adopted in Wave K**.
- **Voice embedding retention** is a separate cross-workstream risk, outside
  Notebook ownership, untouched.
- The **competitor-task-matrix omission** was a process defect discovered and
  corrected at Wave K closure; treat the matrix as an entry gate item.
- All other recorded residual debt (Wave J's OCR/zoom/cross-page items, the four
  low-overlap paraphrases, the generic-word `no_answer` overclaim, the 16 orphaned
  `floor2`/`community` modules from `cc195e888`) stands unchanged.
- **Zero real member usage evidence.** Day 0. Every ranking above is a judgment
  about what members will need, not a measurement of what they do need — and the
  first real cohort should be allowed to reorder it.

---

# 6. OWNER RULINGS — 2026-09-07 (re-baseline ACCEPTED)

The re-baseline above is accepted subject to the rulings in this section. Where a
ruling refines or corrects the analysis above, **the ruling governs**; the original
text is left in place rather than rewritten, with the correction marked inline.

**The 8G-B shared-production hold remains active.** No merge, no deploy, no
production flag change, no 8G-B polling, no Wave L implementation.
**Wave K release remains the next executable production action.**

## 6.0 G-080 / public share link — LIVE CONFIGURATION, AUTHORIZATION UNVERIFIED

`J2_SHARE_LINKS_ENABLED=1` is live. The durable planning artifacts still describe
activation as gated on conditions whose satisfaction has not been recovered.
Classify the state exactly as:

    LIVE CONFIGURATION
    BUT ACTIVATION AUTHORIZATION / GATE EVIDENCE UNVERIFIED

- ⛔ **Do NOT close G-080 merely because the flag is enabled.** A flag being on is
  evidence of configuration, not of authorization.
- ⛔ **Do NOT change the production flag while the 8G-B hold is active.**

**After the hold clears**, in this order:
1. Search for durable evidence that the required §21 / legal and activation
   approval actually occurred.
2. **If that evidence exists** — reconcile the canonical records and close or
   reclassify G-080 appropriately.
3. **If that evidence does NOT exist** — **disable `J2_SHARE_LINKS_ENABLED`** until
   the required review/approval is completed.

⛔ The engineering mitigations (sanitized public payload; no user id, tags, folder
or ticker; static archived widget images rather than live vendor widgets) **are
relevant risk controls but are NOT substitutes for the missing activation
evidence.** Do not let their quality be read as approval.

## 6.1 Post-Wave-K integrity mini-pass — AFTER production certification, BEFORE Wave L

Narrowly scoped. It owns three items and **no additional product features**.

**A. G-063 temporal correctness.** A reconstructable widget captured before a
future event must not later rewrite the research context with resolved/live
results. The invariant to preserve:

> **WHAT THE MEMBER CAPTURED THEN MUST NOT SILENTLY BECOME WHAT IS TRUE NOW.**

Investigate the exact `widgetEmbedCore.js` behavior and implement the *smallest*
correct frozen-at-insert / current-state distinction consistent with the existing
temporal-semantics architecture (`docs/notebook/financial-temporal-semantics.md`).

**B. Raw-error regression.** `TickerResearchWorkspace.jsx` reintroduced
`alert(...e.message)` after an earlier wave fixed this defect class. Fix the
current paths **and add a reusable rail** so member-facing Notebook surfaces cannot
regress to raw backend/provider errors.

**C. Gap-ledger reconciliation.** Reconcile the **ORIGINAL authoritative rows** —
do not merely append another section saying they shipped. The planning artifact
must again answer truthfully: **what is OPEN, what is PARTIAL, what is CLOSED.**
⛔ Do not rewrite history: preserve dates and evidence, and add closure references.

⛔ **G-102 command-palette participation is NOT in this mini-pass — it remains
Wave L scope.**

## 6.2 Wave L — CAPTURE & COMMAND (next major implementation wave)

Begins only after Wave K is production-certified **and** the integrity mini-pass is
complete. Scope, with evidence-based design rather than assumed solutions:

- external web capture;
- **reconsideration of G-043** now that Notebook has documents, excerpts, theses
  and Ask to capture *into* — the rejection predates the destination existing;
- the four remaining internal capture surfaces: **Screener, Options Flow, COT,
  Model Book**;
- Notebook participation in the existing application-wide command palette;
- fast navigation / command discoverability;
- mobile capture / share workflow;
- appropriate PWA foundations / manifest.

The goal, in the owner's words:

> **ANYTHING IMPORTANT I ENCOUNTER CAN ENTER MY RESEARCH WITH MINIMAL FRICTION**, and
> **I CAN REACH NOTEBOOK ACTIONS WITHOUT HUNTING THROUGH UI.**

## 6.3 Wave M — PRIVATE RECALL FOUNDATION (refined)

**Local/private semantic retrieval + local/private OCR, under ONE privacy/compute
evaluation but TWO separate technical benchmarks.** They share the external-data
question; they are not the same capability, and a single combined verdict would
hide which one actually failed.

**A. Local embedding model** — paraphrase recall · false positives · index size ·
RAM · CPU · latency · incremental indexing · Railway/pod impact · the real
751-note corpus · larger synthetic scale.
**Fixed baseline: the existing low-overlap benchmark** (0/7 before the AND→OR fix,
3/7 after). It is the control, and it does not move to flatter a candidate.

**B. Local OCR engine** — scanned-PDF accuracy · screenshot/image accuracy ·
financial-document quality specifically · CPU/RAM · page latency · large-document
behavior · temp-file lifecycle.

**Purpose:** determine whether UCT can close both gaps **without expanding private
member content to an external processor.**
⛔ **Benchmark first. Do not adopt a model merely because a competitor uses one.**

Wave K's semantic status is unchanged and is not affected by this evaluation:
**ARCHITECTURALLY APPROVED · QUALITY-JUSTIFIED · NOT ACTIVATED · BLOCKED ON
EXACT-PROJECT ZDR.** No Notebook content has been sent to the embedding endpoint.

## 6.4 Wave N — FINANCIAL REVIEW LOOP (elevated)

Preserved and **elevated as a major financial-differentiation candidate.**
Potential jobs: thesis review date · catalyst reminder · earnings review ·
assumption review · invalidation condition · evidence/counter-evidence follow-up ·
position/thesis review loop.

It must **compose** what already exists — Wave F temporal facts + Wave G
thesis/evidence + Wave H research workspace + Wave K private-corpus intelligence —
rather than introduce a parallel object model.

⛔ **Do NOT reduce this to generic todo-list parity.** The product goal:

> **UCT BRINGS ME BACK TO THE INVESTMENT DECISION WHEN SOMETHING I SAID MATTERED
> NEEDS REASSESSMENT.**

## 6.5 Wave O / later

Durability and reach remain later. **API/extensibility, plugins, and
multiplayer/collaboration remain DEFERRED** unless future evidence changes their
priority. **Offline, mobile, security and portability remain real parity
requirements** and must be re-evaluated as the roadmap progresses — deferred is not
dismissed.

## 6.6 Day-0 evidence cap

Zero real-member usage evidence. This roadmap is an **evidence-informed pre-launch
judgment, not behavioral validation**, and the first genuine cohort may reorder it.
⛔ **That does NOT impose a construction freeze** — it is a statement about the
confidence of the ordering, not a reason to stop building.

## 6.7 Stop condition

Park until the 8G-B release hold is **explicitly cleared**. No production mutation,
no new implementation. Wave K release is the next executable production action;
the sequence after it is: **Wave K certification → integrity mini-pass → Wave L.**
