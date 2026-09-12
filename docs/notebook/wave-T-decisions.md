# Wave T — the decision-blocked rows, as questions

⛔⛔ **NOTHING IN WAVE T IS BUILT.** Manifest §6 logs each row as blocked on a
decision, a legal review, or a design spike — *"logged as OPEN and skipped, not
invented."* This file turns each into a question the owner can answer in one pass.

⭐ **Answer format:** yes / no, or A / B. An answered row becomes schedulable and
joins the merge queue by dependency. An unanswered row stays blocked and is
**not** a gap in the charter.

**⚖️ ALL TWELVE RULED 2026-09-12. Nothing in T is held. Every row joins the
queue by dependency or is closed.**

| # | row | question | **RULING (2026-09-12)** | why |
|---|---|---|---|---|
| 1 | **T-01** semantic / vector retrieval | Activate embeddings now under a **local** model (A) or keep blocked pending ZDR verification for the OpenAI org (B)? | **RULED: stay blocked** | Blocked on two things, not one: ZDR *and* out-of-process placement (~478 MB + 25 s cold load in the single web process). A local model removes the vendor question but not the memory one. Neither is a Notebook-wave problem. |
| 2 | **T-02** public share-link activation | Activate G-080 public share links? | **RULED: NO** — *configuration is not authorization* | Implemented, activation disabled, **authorization unverified**. §6's own words: *"CONFIGURATION IS NOT AUTHORIZATION."* Turning it on without an authz proof is the one failure that leaks a member's research publicly. |
| 3 | **T-03** Ask Notebook over live UCT vendor data | Commission the external legal / data-rights review? | **RULED: PROCEED — legal approval GRANTED by the owner outside this repo; the legal precondition is SATISFIED.** Build dark to the standard; only the flip stays owner-bound | It is the gate, not the build. Nothing moves until someone asks a lawyer, and that has no engineering dependency. |
| 4 | **T-04** `analyst_price_target_consensus` fact type | Same review — bundle with T-03? | **RULED: PROCEED, bundled with T-03.** Same approval; same treatment | Same rights question, same reviewer, and the fact type is already architected and inert. One review answers both. |
| 5 | **T-05** encryption at rest | Fund the design spike (A) or record as not-planned (B)? | **RULED: FUND THE SPIKE** — sized and queued after R-4a | The spike must first answer whether SQLite here supports whole-file encryption *under search*. That answer is cheap and it unblocks or closes the row permanently. ⛔ Client-side E2E stays on §8 do-not-build regardless. |
| 6 | **T-06** full-page content storage / rendered snapshot | Store rendered page snapshots? | **RULED: NO** | Owner rights ruling, and §8 already carries *"general web clipper"* as do-not-build with a narrow bookmarklet carve-out. Storing rendered third-party pages is the clipper by another name. |
| 7 | **T-07** OCR handwriting · non-English · image attachments | Assess and certify (A) or record as out of scope (B)? | **RULED: ASSESS NOW** — one page, build/defer/reject with a recommendation, in tomorrow's report | §6 is explicit that this is *"not assessed / not certified — **not rejected**"*. Leaving it unassessed lets it read as rejected by default, which is not what anyone decided. |
| 8 | **T-08** OCR concurrency 2 | Start the 7-day / ~20-document production observation? | **RULED: CLOCK STARTS 2026-09-12** — 7-day / ~20-document observation; deadline **2026-09-19** | It is an observation gate, not a build. It can run alongside the Notebook waves at zero engineering cost. |
| 9 | **T-09** per-service Railway build configuration | Split the build so each service builds its own image? | **RULED: NO** | Owner trade already taken: one `railway.json`, every service builds the same image. Revisiting it touches every service's deploy — a platform change, not a Notebook one. |
| 10 | **T-10** collaboration of any depth | Build the account/team boundary primitive? | **no** | §8 lists *"enterprise collaboration depth"* as do-not-build. The primitive does not exist and building it is a product direction, not a debt row. |
| 11 | **T-11** native POST share service worker | Override the standing "no service worker" constraint? | **no** | It is a **charter standing constraint**, and the repo has already paid for a service worker once: the deleted shell cached `index.html` beside immutable hashed assets under a constant that never changed, yielding a coherent OLD app forever. |
| 12 | **T-12** pre-launch smoke | — | ⛔ **not a decision — it is the gate that outranks every row** | §6 says so directly. `T-12-prelaunch-smoke.md` exists; it must pass before "on for members" means anything. Tracked as completion criterion **C-7**, not as a question. |

⛔ **Two of these are not really blocked on engineering at all** — T-03/T-04 need a
lawyer and T-08 needs a clock. Both can start today without touching code, and both
would otherwise sit in this file for the length of the charter.


---

## ⚖️ Rulings recorded 2026-09-12 — what each one now means operationally

| row | becomes |
|---|---|
| T-01 | closed for this charter; blocked on ZDR **and** out-of-process placement, neither a Notebook problem |
| **T-02** | **NO, permanently for now.** Implemented, activation disabled, authorization unverified |
| **T-03 / T-04** | ⭐ **SCHEDULABLE.** Owner granted legal approval outside this repo; the precondition is **satisfied**, not pending. Build dark like any other row. ⛔ If either needs a member-facing disclosure, its spec drafts that text in plain English and the owner supplies final wording **before the flip** |
| **T-05** | spike funded — sized and queued **after R-4a** |
| T-06 | NO — owner rights ruling; §8 already carries "general web clipper" |
| **T-07** | **ASSESS NOW.** ⛔ *"Not assessed" must never read as rejected by default* |
| **T-08** | **clock started 2026-09-12 → deadline 2026-09-19.** An observation, not a build |
| T-09 | NO — one `railway.json`, every service builds the same image |
| T-10 | NO — §8 enterprise collaboration depth |
| **T-11** | **NO, and it goes to §8 DO-NOT-BUILD permanently** — the charter's standing "no service worker" constraint |
| T-12 | not a decision — completion criterion **C-7** |

⛔ **Zero rows in this file are waiting on the owner.** T-03/T-04's only remaining
owner-bound step is the flip, which is true of every row in the charter.
