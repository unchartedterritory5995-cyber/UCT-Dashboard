# UCT Notebook — Primary Notebook Readiness Scorecard

**Purpose:** one durable, evidence-scored answer to "how close is UCT Notebook to
being a credible primary notebook for its target financial persona." Scores are
0-10 confidence-ladder readiness, not effort-remaining or feature-count. **A score
reflects evidence, never optimism** — "code exists" alone caps a domain at 4-5;
higher scores require production verification, and 9-10 requires demonstrated real
member behavior, which — per the active Stage A gate — does not exist yet for
anything in this product.

**Baseline date:** 2026-09-06. Source: `competitive-primary-platform-phase-zero.md`
+ `-phase-one-adversarial.md` (2026-09-05 research) reconciled against Wave 0-3,
Stage A instrumentation, and Wave 4 prep (shipped/designed since), verified via 3
fresh read-only research passes this session. Re-score only on real evidence
change, not on a schedule.

## Score ladder (used for every domain below)

| Score | Meaning |
|---|---|
| 0-1 | Absent, no code |
| 2-3 | Designed or partially built, not member-facing |
| 4-5 | Code exists, unit/integration tested, not production-verified |
| 6-7 | Production-verified (deployed, health-checked, correct) but no real member usage evidence |
| 8 | Real member usage exists and the capability holds up under it |
| 9 | Real member usage across MULTIPLE members (not one power user) confirms the capability works and is used repeatedly |
| 10 | Sustained, multi-week real usage; the capability is a demonstrated reason members don't return to their old tool |

**Every score below is capped at 6-7 today** — Stage A validation (real member
behavior) is active but has recorded zero usage as of this baseline (instrumentation
deployed 2026-09-06, day 0). No domain can honestly score 8+ yet. This cap is
itself the most important fact on this scorecard and should not be inflated away
by a future editor without new evidence.

---

## Domain Scores

| Domain | Score | Rationale |
|---|---|---|
| **Editor** | 6 | Genuinely strong, production-verified (headings/lists/tables/checklists/callouts/toggles/images/links, autosave with retry+backoff, native undo/redo). Real gaps: no command palette, no find-in-note, no note-to-note link authoring UI, attachments image-only. Capped at 6 (no real-usage evidence) not 7 (a few confirmed gaps a "strong" editor shouldn't have). |
| **Organization** | 5 | Nested folders (depth 6), tags, single-ticker field — all production-verified. No favorites, no recents, no saved views, no structured properties. Solid foundation, real gaps versus all three competitors on the organization axis specifically. |
| **Search / Retrieval** | 5 | FTS5 engine is correctly built and production-verified, but one real correctness bug is open ($NVDA-ticker-field-only miss), the folder-sidebar undercount's current status is unconfirmed, and ranking is confirmed absent (recency-only). Wave 4 (date/snippet/ranking/entity filters) is fully designed but Stage-A-gated — not shippable yet, so it cannot lift this score until it ships and is verified. |
| **Capture (Save-to-Notebook)** | 6 | The mechanism itself is live, real, and unusually mature for this stage (`CaptureInboxTray`, shared envelope, 9 widget doors) — a genuine structural head start. Capped at 6 by real, confirmed gaps: 4 major surfaces (Screener, Options Flow, COT Data, Model Book) have no capture door; no comment/annotation field at capture time; destination-menu wiring status needs a direct confirm. |
| **AI on Notebook content** | 4 | Ask Current Note is live, scoped correctly, production-verified — a real, working P0. Corpus-wide "Ask Notebook" is 100% greenfield (zero embedding infrastructure exists for note content specifically). The domain average reflects that the harder, higher-value half of "AI on my notebook" hasn't started. |
| **Temporal Correctness / Provenance** | 5 | The chart-embed "frozen at insert" pattern is real, correctly designed, and the strongest genuine differentiator in the whole product — but it's proven for ONE data type. Fundamentals/watchlist/scanner snapshot semantics are also done. Analyst estimates/ratings cannot be captured AT ALL yet (not hardened, doesn't exist), and a live, real Calendar-embed forward-looking bug is open. The pattern is proven; its promised universality is not yet true. |
| **Thesis Intelligence** | 3 | "Thesis" is a bare tag string today, no structured fields, no changelog, no diff view. The trade-link half (a DIFFERENT capability, see Trading Journal Integration below) is strong — don't let that borrow credibility for this domain, which is genuinely early. |
| **Trading Journal Integration** | 7 | Wave 3's typed `tradeRef`/`tradeRefType` reference system, resolver, and bidirectional navigation are live, extensively tested, and production-verified — and per Phase One's independent adversarial review, this is the CORRECT scope (a link layer to the already-superior existing Journal 2.0/Compass system), not an underbuilt version of something bigger. Highest score on this scorecard for a reason: it's both complete AND correctly scoped, not merely complete. |
| **Trust / Recovery** | 6 | Trash/undo-delete is live and production-verified (Wave 0). The account-deletion cascade FK gap — the single most severe finding across both research phases — is confirmed fixed. Version history remains entirely absent, and the product's own constitution names it a non-negotiable trust bar alongside trash/search, which this domain hasn't earned yet. |
| **Security / Privacy / Isolation** | 6 | Tenant isolation is structurally sound and consistently enforced (`user_id`-scoped everywhere, confirmed via spot-checks this session). Note content and attachments remain plaintext at rest — a real, known, unresolved gap. The Stage A telemetry/sandbox safety rail work this session (AUTH_DB_PATH isolation) is testing infrastructure, not a member-facing security capability, and does not raise this score. |
| **Performance / Scale** | 5 | `list_notes` (the "open Notebook" path) is flat 1.3-2.3ms even at 50k synthetic notes — genuinely strong. Several other read paths (folder counts, backlinks, FTS at platform scale) are confirmed super-linear at 50k and NOT yet root-caused. The single-uvicorn-process architectural ceiling is a named, real, unowned risk. Real production scale today (89 notes) is nowhere near where any of this matters — the score reflects unresolved risk at a scale the product doesn't face yet, not a current member-facing problem. |
| **Export / Portability** | 6 | Full-library export is genuinely strong and independently round-trip-verified — a real advantage over Evernote specifically. Two real gaps found THIS session, previously unflagged by either research phase: no single-note export, and trade-link references silently drop on export (undermining the "your research is yours" portability principle for exactly the data type this product differentiates on). |
| **Mobile** | 4 | Notebook is reachable via the standard mobile nav path and has CSS-level responsive handling in 7 component stylesheets — not zero, contrary to what a first look might suggest. No JS-level responsive hooks, no mobile capture/share-sheet (a confirmed, explicitly-deferred-to-Stage-B gap). |
| **Offline** | 1 | Fully absent — no service worker, no manifest, no offline read cache. Correctly and deliberately low-priority per both research phases (UCT's live-streaming architecture makes ~90% of the product useless offline regardless of Notebook), but the honest score for the capability itself is near-zero. |
| **Collaboration** | 3 | One real, substantial, but fully dark capability exists (`note_shares.py`, sanitized public read-only links) — more built than a "0" would suggest, but flag-gated OFF with zero real usage and zero validated demand, so it can't score higher. |
| **Templates** | 5 | 8 real, data-aware, production-verified templates exist — but every one is trading-ritual-shaped; zero fundamental/company-research templates exist, and there's no user-defined template capability. Strong for the primary beachhead persona, absent for secondary personas. |

---

## Composite view

**Unweighted average across the 16 domains above: ~4.9 / 10.**

This number is presented for orientation only — **do not average domains of
wildly different strategic weight into one score for decision-making.** The
Product Constitution (Phase One, revised) names trash+search+version-history as
non-negotiable trust bars and temporal correctness as the strategic moat; those
domains matter more than, say, Collaboration or Offline, which are both
correctly deprioritized. Read the table, not the average.

**What would move the composite most, per domain leverage (not per point):**
1. Ship the fact/snapshot ledger + analyst-estimates capture path — unlocks Thesis
   Intelligence, Ask Notebook, and completes Temporal Correctness's universality
   claim (currently the single most load-bearing prerequisite in the whole
   dependency graph).
2. Close the two new export findings (single-note export, trade-link preservation)
   — cheap, directly serves the Portability principle.
3. Confirm/fix the folder-sidebar correctness bug's current status — cheap,
   directly serves the Trust-parity bar.
4. Ship version history — the one Trust-parity bar with no current P0 disposition,
   an explicit open tension the Product Constitution itself flags.

**What will NOT move any score, no matter how much engineering goes into it:**
more Wave 4 design work, more competitive research, or any synthetic/sandbox
testing. Every domain here is capped at 6-7 until real Stage A member behavior
exists — that gate is the actual ceiling on this scorecard right now, not any
individual feature gap.

---

## Update discipline

Re-score a domain only when:
- New production code ships and is verified (may raise a score to 6-7).
- Real member usage is observed for that domain specifically (may raise to 8+ —
  requires MULTIPLE members per the Stage A gate's own anti-gaming discipline,
  never one power user).
- A new gap is discovered (may lower a score — record the finding, don't silently
  adjust the number).

Do not re-score on a calendar schedule. Do not round up because "it's basically
done" — the whole point of this artifact is to resist that pressure.
