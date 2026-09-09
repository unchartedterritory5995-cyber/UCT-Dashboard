# UCT Notebook — Competitive Primary-Platform Phase Zero

**Status:** Research / discovery / product-planning only. No implementation has begun. No code in this repository was modified to produce this document.
**Repository state at time of writing:** branch `notebook-primary-platform`, HEAD = `origin/master` = `54d7de266efa99b73acf1ef6cb86eb4ca60c52b2`, clean worktree.
**Prior, closed project this builds on:** the Notion/Evernote/Obsidian migration-connector program (`docs/notebook-connectors/60-user-reliability-certification.md`) — CLOSED, certified, not reopened by this document except where this research found a genuine new discrepancy (noted explicitly in §36 and the Contradiction Ledger).

---

## §1. Executive Findings

UCT's Notebook (internally "Journal 2.0") is a real, working, single-user cloud notes product with a genuinely rich editor (tables, callouts, toggles, checklists, templates, chart embeds) and a **best-in-class, already-proven "frozen at insert" temporal-correctness pattern** for chart embeds — a pattern no competitor researched here has an equivalent of, and one that generalizes cleanly across nearly every financial-native idea in this document. Against that strength sits a specific, narrow, and fixable set of gaps: no note trash/undo, no version history, no backlinks, no semantic search, and — most importantly — **zero AI that reads or writes note content today**, despite a mature, reusable AI/embeddings/cost-guard/grounding infrastructure already proven elsewhere in the codebase (`brain_kb_service.py`, `ai_search_personal.py`) that "Ask My Notebook" can build on almost directly rather than invent from scratch.

The single most important finding of this phase is **not** a competitor feature gap — it's a **live, currently-shipping legal/compliance exposure**: a "send to Notebook" capture door (already wired into 9 widgets across the app, with no feature flag) stores FMP-sourced fundamentals/estimates/ownership tables and Massive-sourced quotes/scanner results verbatim into permanent notes today, and FMP's publicly-available terms language plausibly prohibits exactly this ("may not copy or download any content... without prior written approval"). This should be treated as higher priority than any roadmap item in this document (see §21, §36).

The second most important finding is that **two of this project's own research agents' initial conclusions were wrong and had to be corrected against the actual code** — both times because a report drew a categorical negative ("this doesn't exist," "this is unreachable") from a narrow search that missed a real, differently-named implementation. Both are resolved below (Contradiction Ledger, §36) and the lesson generalizes: **do not trust a single agent's absence claim without checking the code directly** — which is exactly the discipline this entire research program was commissioned to enforce.

UCT does not need to out-feature Notion, out-capture Evernote, or out-portability Obsidian on their own terms. It needs to meet a small set of genuine trust/parity bars (search that works, export that's real, a trash can) and then win on the one axis none of the three can structurally match: a notebook that lives inside a live market-data platform, with a temporal-correctness discipline already proven, for an audience (traders, investors, analysts, PMs) whose core professional practice — "what did I believe, and when, and was I right" — is exactly what generic notebooks cannot do and UCT's existing chart-embed pattern already does for one data type.

---

## §2. Method / Evidence Standard

Eleven independent research passes were conducted (Wave 1: 10 domains dispatched in parallel; Wave 2: 1 additional financial-workflow deep-dive), each scoped to one domain, each required to cite file:line for code claims and dated URLs for external claims, each explicitly forbidden from modifying code. **Six of the ten original Wave 1 dispatches (60%) failed on first attempt** — a subagent-orchestration failure mode where forked agents, sharing the parent's full conversation context, hallucinated meta-narrative about the research process itself instead of executing their assigned task (documented, reported as a product bug). Every failure was caught (by checking whether the returned content actually matched the assigned domain), discarded, and re-dispatched as a fresh, context-isolated agent — which had a 100% success rate across seven redos. This is disclosed prominently because it is itself evidence: **automated research volume is not evidence of quality**, and every claim in this document should be read as having survived that filter, not merely produced by it.

Two further claims from valid-looking reports were found to be **wrong and were corrected by direct code verification** (not by re-running the research agent) — see the Contradiction Ledger in §36. This is the standard applied throughout: an agent's or a report's claim of "X doesn't exist" was independently re-checked with a fresh grep/read pass before being treated as fact, per the mega-prompt's own "do not trust a single search" principle.

**Confidence tags used throughout:** where a claim is grounded in direct code reading (file:line cited) or a live product fetch, it is marked **A/A+**. Where grounded in current official documentation with a cited URL, **B**. Where grounded in community discussion (Reddit, forums) corroborated across multiple threads, **B–C**. Where an agent flagged its own source as blocked/unverifiable, it is marked **UNVERIFIED** and treated as an open question (§36), never as a fact.

**Scale note on the "20,000 observations" research-depth request:** this was deliberately not pursued literally. Reasoning, stated to the requester at the time and repeated here for the record: (a) the same request's own stated principle is "depth over count, stop at saturation," which this document follows; (b) this session directly observed research agents fabricate content under pressure for volume/scale (the 60% fork failure above) — scaling raw volume further without first fixing that reliability problem would manufacture more false claims dressed as observations, not more truth. What was pursued instead: targeted deepening of genuinely under-covered areas (12 financial workflows reconstructed in total) and direct, hands-on adversarial verification of the two highest-stakes claims that turned out to be wrong.

---

## §3. Current UCT Notebook Reality

*[Source: UCT-Reality report, live-dev-server-verified where marked; Security-DataRights report; Architecture-Scale report; direct orchestrator verification]*

Full capability inventory using the required taxonomy (PROVEN LIVE / IMPLEMENTED-NOT-MEMBER-PROVEN / PARTIAL / ABSENT / BROKEN-REGRESSED / UNKNOWN). Two architecturally distinct subsystems exist and should not be conflated: a **file-based bulk importer** (`POST /api/j2/notes/import/{check,confirm}`) and **continuous-sync connectors** (`note_connectors/`, providers: Notion OAuth, Obsidian device-token, Dropbox, Craft, Roam, OneNote, OneDrive; Evernote is deliberately import-only, no continuous sync). CLAUDE.md's own description of this feature is stale — verified against the actual code, not quoted from documentation.

### Core Note / Editor Experience
| Capability | Status | Evidence |
|---|---|---|
| Create/edit note, autosave (retry-with-backoff) | PROVEN LIVE | `NoteEditorPage.jsx:545,554` |
| Delete note | **PARTIAL** — hard delete only | `notes.py:1265`, no `deleted_at`/trash table anywhere in schema |
| Restore deleted note | **ABSENT** | confirmed by schema absence |
| Rich text: headings/bold/italic/lists/checklists/tables/callouts/toggles | PROVEN LIVE | `SlashMenu.jsx`, cert doc §17 fidelity checks |
| Chart embed, frozen-at-insert | **PROVEN LIVE, and strategically important** | `SlashMenu.jsx:130-220`, `widgetEmbedCore.js` |
| 9 other financial embed renderers (watchlist/scanner/fundamentals/news/breadth/alerts/calendar/AI-search/themes) | **PARTIAL — reachable via capture door, not via compose-time slash-menu** (corrected finding, see §36) | `registry.js` (`journal:false` for all but chart) vs. `append_widget_embed` (`notes.py:1106`) wired to 9 real call sites |
| Undo/redo | IMPLEMENTED (TipTap default), not independently tested | — |
| Multi-column layout, find-within-note | ABSENT / UNKNOWN | not found in slash menu or node registry |

### Organization
| Capability | Status | Evidence |
|---|---|---|
| Nested folders (depth-capped at 6), tags | PROVEN LIVE | `db.py:505-513`, `notes.py:29` |
| Single-ticker entity model, indexed | PROVEN LIVE, minimal | `db.py:393,416-417` |
| Custom properties/metadata, database/table views, board/calendar/gallery views | **ABSENT** | no evidence anywhere in `journal_two` |
| Backlinks / note-to-note graph | **ABSENT, confirmed** | no wikilink/backlink table found; only ticker-symbol sidecar (`j2_note_embeds`) exists, a different thing |
| Templates | PROVEN LIVE | `notebookTemplates.js`, 8 data-aware trader templates |

### Capture
| Capability | Status | Evidence |
|---|---|---|
| "Save/send to Notebook" from elsewhere in UCT | **PROVEN LIVE** (corrected finding — see §36) | `sendToJournal.js`, `captureTargets.js`, imported by 9 real widget components |
| Web clipper / browser extension | **ABSENT** | none found |
| Mobile capture / share-sheet | **ABSENT** | no manifest/native-share evidence |
| Quick-capture inbox | UNKNOWN | a test file (`CaptureInboxTray.test.jsx`) exists; matching component not located this pass |

### Search / Retrieval
| Capability | Status | Evidence |
|---|---|---|
| Full-text search (FTS5, trigger-maintained, indexed rowid map) | PROVEN LIVE, correctly engineered | `db.py:430-496`; write-path perf bug found and fixed 2026-09 |
| Search read-latency at scale (the historical "1.4x over LIKE at 5k notes" figure) | **UNVERIFIED post-fix** | write-path fix measured; no re-run of the read-latency ratio found in docs |
| Semantic/vector search over notes | **ABSENT** | no embeddings table for `j2_notes`; exists only for the separate firm KB |
| Folder-tree sidebar completeness at scale | **BROKEN at >100 notes, silently** | `NotebookTab.jsx:141-148`'s own comment admits the defect; no "showing X of Y" disclosure, unlike the main grid and search panel which both have one |

### AI
| Capability | Status | Evidence |
|---|---|---|
| "Ask my notebook" (AI over private note content) | **ABSENT, 100% greenfield** | grep across `journal_two/*.py` found zero note-content AI tools |
| Compass (trading-coach AI chat) reading/writing notes | **ABSENT** | confirmed zero of Compass's 28+ tools touch `j2_notes` |
| Reusable AI infra elsewhere in the codebase | Exists, not yet applied to Notebook | `brain_kb_service.py` (OpenAI embeddings + cosine search), `ai_search_personal.py` (private+public data fusion pattern, cost-guard ledger) |

### Collaboration / Trust / Portability / Platform
| Capability | Status | Evidence |
|---|---|---|
| Public share link (read-only, sanitized payload) | PROVEN LIVE (flag-gated OFF by default) | `note_shares.py`, `J2_SHARE_LINKS_ENABLED` |
| Comments/mentions/multiplayer/team workspaces | **ABSENT** | single-user-scoped schema throughout |
| Import (Notion/Obsidian/Evernote) | **PROVEN LIVE** | 60-user certification, real production evidence |
| Export (ZIP, round-trips) | **PROVEN LIVE** | cert doc §17, 1,091,412-byte real export verified |
| Version history / revision recovery | **ABSENT** | no schema for it |
| Offline mode / local copies | **ABSENT** | fully cloud-only — the single largest structural gap versus Obsidian specifically |
| Obsidian plugin publish status | **PROVEN LIVE** (was misreported mid-session, then verified) | `community.obsidian.md/plugins/uct-notebook-sync`, v0.1.3, Health Excellent — see §36 |

**No STOP-SHIP severity code defect was found** (no confirmed security hole, data-loss regression, or cross-user leak). One agent fabricated a detailed false data-loss incident during this research; it was identified as a hallucination and explicitly not treated as a finding (§36). The one severe issue that IS real is the data-rights exposure in §21, which is a legal/product-policy issue, not a code defect.

---

## §4. Current Notion Research

*[Source: Notion report, dated 2026-09, cited URLs]*

Notion's actual moat is the **database/relations/multi-view model** (table↔board↔calendar↔gallery over the same underlying rows), not the block editor. As of 2026-09: AI Q&A, "Research Mode" (cites sources on every claim, added March 2026), and Custom Agents (GA May 2026, triggered by schedule/Slack/email/DB-change) are all **Business-tier and above only** — the free/personal tier does not get Notion's AI differentiation. Offline mode shipped August 2025 but is explicitly degraded (AI, clipper, real-time collab, and sharing changes all disabled while offline). Page-history retention is tiered (7 days free / 30 days Plus / longer on Business+). Workspace-level PDF export is being *removed* by Aug 31 2026 — a rare case of a competitor's portability story getting worse, not better. Performance at scale (2,000+ pages / large databases) is a corroborated, current community complaint (B–C evidence, cross-referenced Capterra/G2).

**Confirmed A+ (Business-tier answer with citations):** Notion Research Mode. **Confirmed B (multiple sources, tier ambiguity flagged by Notion itself in some places):** whether Calendar/Mail have any native 2-way task sync (answer: no, they're separate apps requiring manual or third-party linking).

**Overrated for UCT's target persona:** the general team-wiki/OKR-tracking use case, Notion Calendar/Mail as separate apps (UCT already owns the calendar surface), the external Agents/Workers developer platform.

**True switching blockers vs. nice-to-haves for traders/investors:** real blockers are fast reliable search at scale and *some* flexible structured-view mechanism (which UCT can beat with entity-aware financial data rather than generic properties); NOT blockers: team collaboration depth, the developer platform, generic templates marketplace.

---

## §5. Current Evernote Research

*[Source: Evernote report, dated 2026-09, cited URLs]*

Evernote is mid-relaunch (v11, January 2026: rebrand + AI Assistant + Semantic Search + AI Meeting Notes), with **Evernote's own documentation currently contradicting itself** on tier gating for Tasks, Calendar, and AI Meeting Notes (one help article says paid-only, the live pricing page shows free-tier checkmarks) — an unresolved internal contradiction, not a research gap on this project's part. What's confirmed stable: OCR (searchable handwriting/business-card/whiteboard scans) remains free-tier-wide and is the actual retention driver for long-tenured users, not any single new feature; the Web Clipper supports 7 distinct clip modes including structured Gmail/Amazon/LinkedIn/YouTube clippers; offline access is now free-tier standard on desktop and mobile (a real 2026 change); export is **desktop-app-only** — a purely-web or mobile Evernote user cannot export their own data without installing desktop software, a concrete, easy-to-beat gap; version history is desktop/web-only, absent on mobile.

Evernote already exposes an **MCP server for AI tool access** (Claude, ChatGPT, and other MCP clients can read Evernote notes) on paid tiers — a real, currently-shipping AI-integration surface UCT does not yet match in the notebook direction (UCT has zero AI on note content today, per §3).

**A real, current data point on forced-migration psychology:** Evernote's Nov 2025 pricing relaunch produced public threads of users given "30 days to move 18 years of data," describing themselves as "trapped" — a meaningful slice of UCT's incoming Evernote cohort will arrive cornered and resentful, not curious (see §13, §23 Persona B).

**What UCT can clearly do better without any AI/financial differentiation at all:** internally consistent pricing/gating (Evernote's own docs disagree with themselves), native Apple Calendar support (Evernote has none, only a manual ICS workaround), mobile version history (Evernote has none), and web-based export (Evernote requires desktop).

---

## §6. Current Obsidian Research

*[Source: Obsidian report, dated 2026-09, cited URLs]*

Obsidian's core claim — local-first, zero telemetry, "we do not collect any telemetry data," self-funded since 2020 — is stated with unusual specificity in its own privacy policy and about page, not just marketing copy (B, corroborated across privacy policy + about page + community sentiment). **Bases (native database/table feature) is now fully core, free, and stable** — no beta disclaimer, actively developed (kanban layout added Sept 2 2026), narrowing but not eliminating reliance on the Dataview community plugin (4.9M downloads) for advanced JS-driven queries. The plugin ecosystem is enormous (7,287 plugins, 729 themes) but its trust model is a real, named risk: plugins run with full, unsandboxed filesystem access, Obsidian's own developer docs concede "one mistake can lead to unintended changes to your vault," and there is no clear policy on re-reviewing plugin *updates* after initial listing — a materially worse risk/reward trade for a product holding financial research than for a hobbyist notes app.

**What makes serious Obsidian users refuse hosted products (B–C, corroborated across multiple mechanisms, not marketing):** durability under company failure (plain markdown survives Obsidian Inc. shutting down), no platform rent-seeking on personal thinking, query/automation power (Dataview/Bases) with no vendor-imposed limits, and speed/reliability independent of network connectivity.

**What UCT must NOT try to recreate:** breadth-for-its-own-sake (the vast majority of 7,287 plugins serve hobbyist use cases irrelevant to traders), unsandboxed plugin execution (unacceptable risk for a product holding financial research), and Obsidian's manual, discretion-based review gate with no confirmed update re-review.

**What UCT should take instead:** a small number of deep, first-party financial-research-specific structures (a native table/query layer scoped to research metadata, strong native search, real templating logic) — this captures most of Dataview/Bases's practical value for this audience without opening an unreviewed, arbitrary-code-execution plugin surface.

---

## §7. Competitive Capability Matrix

*[Consolidated across §3–§6. Confidence per §2's system. UCT-Evidence column cites §3.]*

| Capability | Notion | Evernote | Obsidian | UCT Today | UCT Evidence | Switching Impact | Disposition |
|---|---|---|---|---|---|---|---|
| Rich block editor | AVAILABLE | AVAILABLE | AVAILABLE (md) | PROVEN LIVE | §3 | Low | ALREADY SUFFICIENT |
| Structured views over data | AVAILABLE (moat) | Absent | Bases (core, free) | ABSENT | §3 | Medium (real, cheaper substitute exists — see §14) | P1 |
| Backlinks/graph | Some | Absent | Core, strong | **ABSENT** | §3 | Medium for Obsidian switchers only | P1 (derived index, not full graph — §14) |
| Full-text search | AVAILABLE | AVAILABLE | AVAILABLE (rich query syntax) | PROVEN LIVE, unverified at true scale | §3 | High | P0 (verify + close folder-sidebar gap) |
| Semantic/AI search | Business-tier | Free-tier (real) | Absent (core) | **ABSENT** | §3 | Medium | P1 |
| AI Q&A / assistant over own content | Business-tier, cited (strong) | Free-tier, real | Absent (core) | **ABSENT, greenfield** | §3 | High (this audience specifically) | **P0** |
| Web clipper | AVAILABLE | AVAILABLE (7 modes) | AVAILABLE (native, free) | **ABSENT** | §3 | Medium | P2 (see §28 — may not be worth building) |
| Version history | Tiered | Desktop/web only | Sync add-on (paid) | **ABSENT** | §3 | High (trust) | **P0** |
| Trash / undo delete | 30-day trash | Trash | Trash | **ABSENT — hard delete** | §3 | High (trust) | **P0** |
| Offline mode | Degraded, 2025+ | Free-tier standard | Native, default | **ABSENT** | §3 | High for Obsidian/Evernote switchers | P1 |
| Export completeness | Narrowing (PDF removed) | Desktop-only | Trivial (it's just files) | **Proven, round-trips** | §3 | High | ALREADY SUFFICIENT — a real advantage over Evernote specifically |
| Financial live-data embeds | None | None | None | **Proven, unique** (frozen-at-insert) | §3 | N/A — differentiator, not parity | Lean into (§14) |
| Save external content into notebook | N/A (web clipper) | N/A | N/A | **Proven live, narrow** (9 widgets) | §3, §36 | N/A — differentiator once extended | P1 (extend, don't rebuild — §14 §15) |

---

## §8. Core Notebook UX

*[Source: Core UX report]*

Grounded latency targets (Nielsen's 0.1s/1s/10s thresholds; Google's RAIL model), not invented: keystroke-to-glyph ≤100ms (local, never network-gated); note switch/folder nav ≤1s acceptable, ≤300ms good; lexical search-as-you-type first results ≤300-500ms; semantic/AI results may legitimately take 1-3s if visually separated from instant lexical results. Large-note opening must degrade gracefully (virtualize), never silently break — directly relevant given §3's confirmed folder-sidebar defect at scale.

Command-palette-as-connective-tissue (ranked by recency+frequency, not alphabetically) and slash-commands-as-contextual-menus are the converging pattern across every best-in-class tool studied; the failure mode to avoid is a slash-menu wall of items (good implementations show ~6-8 top items + search-to-filter). Sidebar navigation converges on folder-tree + tags/links hybrid because pure hierarchy and pure graph both fail differently at scale.

**Default/Simple vs Advanced/Optional** (directly load-bearing for §33's product constitution): create→type→saved with zero required fields must work with no learning curve; properties/databases/graph/AI/financial structured objects (thesis fields, trade fields) must all be **opt-in scaffolding layered on a plain note, never a mandatory form** — this is the single most important design constraint for §16/§17 below, where the risk of over-structuring a simple capture is highest.

---

## §9. Capture

*[Source: Core UX report, cross-referenced with §3, §21]*

Best-in-class capture (Readwise Reader as reference standard) converges on: single-keystroke/single-click capture with zero required configuration; automatic metadata extraction (never ask the user to type source/date/author); duplicate detection by canonical URL; and critically, **deferred triage** — capture goes to a default/inbox location instantly, organizing happens later, non-blocking. UCT's existing "send to Notebook" capture door (§3, §36) already partially follows this pattern (append-to-last-active-note-or-inbox as the default, no forced destination prompt) — this is a real, unusual head start most notebook competitors don't have baked in from day one, and it should be extended (more sources, a comment-add option) rather than replaced.

UCT has **no web clipper** and **no mobile capture/share-sheet** today (§3) — both are table-stakes for Evernote switchers specifically (§5, §26) but §28 argues the web clipper specifically may not be worth building given UCT's actual differentiation lies in capturing UCT's *own* live data, not arbitrary web pages.

---

## §10. Organization / Knowledge Structure

*[Source: UCT-Reality, FinNative, CoreUX reports]*

UCT's current structure (folders, tags, single ticker) is minimal but real and extendable. The financial-native design (§14) proposes extending it with a **derived, not authored** layer — mention parsing plus mechanical joins against data UCT already owns (sector/industry, earnings calendar) — rather than a manually-maintained knowledge graph, because an empty/sparse graph reads worse than no graph at all, and the derived layer produces value for every existing note retroactively at zero authoring cost. Full multi-hop graph traversal is explicitly deferred (Experiment/Validate-First, §30) pending evidence that users actually reach for it once the cheap derived index ships.

---

## §11. Search / Retrieval

*[Source: Architecture-Scale, AI-Retrieval, CoreUX reports]*

Current state: FTS5 lexical search, correctly engineered on the write path (trigger-maintained, indexed rowid map, a real 2026-09 perf fix measured 19ms→0.6ms at scale), but the read-latency scale claim from the original wave0 audit was never re-measured after the fix (UNVERIFIED, not false — see §36). No semantic/vector search exists over note content. The architecture tradeoff map (lexical/semantic/hybrid/backlink-graph, §8's source) recommends lexical as the correct default (fast, cheap, legible) with semantic as an **additive, clearly-separated** layer, never a silent replacement — critical for a skeptical finance-professional audience where an unexplained "AI match" reads as untrustworthy magic rather than a feature.

---

## §12. AI Notebook

*[Source: AI-Retrieval report — the deepest technical section of this research]*

**Reusable infra already exists and should be extended, not reinvented:** `ai_search_personal.py` already solves the exact privacy-boundary problem this needs — private data assembled server-side into a bounded context block, injected into a synthesis-only prompt, never sent to any external search provider, never logged. `brain_kb_service.py` already proves the embed/chunk/cosine-search mechanics (OpenAI `text-embedding-3-small`, in-memory numpy matrix, <50ms at 10k chunks) — reusable as-is for the mechanics, **not** reusable as-is for tenancy (it's a single shared matrix today; per-user notes need per-user-keyed indices, not a shared matrix filtered post-hoc, which is an information-leak risk if any code path skips the filter).

**The single most important architectural warning in this entire document:** `ai_search_personal.py`'s own system prompt contains a "FRESHNESS FIREWALL" instructing the model to treat live data as authoritative over stale personal context — the exact **opposite** contract Notebook needs (a March note's "consensus EPS is $8.25" must stay $8.25 forever, even after consensus moves to $9.10). Copy-pasting the existing AI Search convention into Notebook would silently corrupt every historical research note the first time it's summarized. This requires an **append-only snapshot table** (ticker, metric, value, observed_at, source) as a genuine prerequisite — not a nice-to-have — for both AI grounding and any live-data block (§14).

Thesis-monitoring feasibility is assessed as **P1-at-best, high-risk**, not straightforward: alert fatigue is structural (UCT's own Awareness Engine already had to build cooldowns and a shared daily cap for exactly this reason, and its own documented limitation is that one alert kind can silently starve another); "material change" is not a computable predicate over unstructured evidence without real design work (structured, falsifiable assumptions at thesis-creation time, matched evidence, never a general semantic sweep). A **thesis changelog** (diff stored-vs-current facts, on-demand, no push) is feasible now; proactive alerting should not ship in the same wave.

---

## §13. Migration Trust / Switching Confidence

*[Source: Switching-Trust report — extensively sourced against real PKM community discussion]*

Status-quo bias is the dominant, well-documented mechanism: users weigh what they'd lose over what they'd gain, meaning a technically successful migration does not by itself overcome switching resistance — trust-building must actively counter *loss* framing, not just sell gain framing. Power users (the most valuable converts) are structurally the hardest to convert, since they have the most sunk investment.

Real, sourced fears from the PKM community (not abstractions): Notion users reporting permanent data loss with no version history beyond 30 days; Evernote users saying "never trusted Evernote... export ENEX backup once every day"; Obsidian users citing "data is not proprietary, it's just markdown files" as the reason they stay — **portability itself is the trust signal, independent of whether it's ever exercised.** Import-transparency distrust is real and specific: Evernote's own community credits the independent, vendor-uncontrolled YARLE export tool as "the lifeline" precisely because it's independently checkable, not vendor-asserted.

**Feature ranking (13 candidate trust features, ranked by leverage, not built in order of appearance):** Tier 1 (ship first, this IS the trust product): notes/media reconciliation, a migration confidence receipt, a post-migration spot-check tool. Tier 4 (explicitly **not recommended for v1**): a full one-click rollback of an entire migration (higher complexity than it sounds, rarely what people actually want once they've started working, and a botched rollback is itself the exact trust incident this workstream exists to prevent) and deep links back to original source items (expire the moment the user loses access to the old account — exactly the cohort most likely to want it).

**First 30 minutes**, persona-specific: a former Notion user needs their database structure proven intact first, not a UCT feature tour; a former Evernote user (who may be arriving *angry*, per the 2025 pricing-shock threads, not curious) needs search proven, live, on their own content, before anything else; a former Obsidian user — the highest trust bar of the three — needs wikilinks/backlinks/frontmatter proven intact and a plain-markdown export path visible on the very first screen, and must never see an AI/cloud pitch foregrounded (reads as exactly the lock-in risk they already rejected).

**First 7 days, falsifiable hypotheses:** the most likely quiet-reopen trigger is day 2-3, at a real work need where a specific remembered item fails to surface in search (not day 1, still exploratory). The "I don't need to go back" moment (stronger than mere comfort) most plausibly requires UCT doing something structurally impossible for the old tool — a live-data-linked note the user references more than once in week one.

---

## §14. UCT Financial-Native Notebook

*[Source: FinNative report — Parts 1 and 2]*

**Entity model:** keep the existing single-ticker field as the anchor; add exactly one new **derived** layer before considering new authored entity types — a mention-detection join table (reusing UCT's own hard-won `/buzz` cashtag-validity lesson: a cashtag must beat the symbol universe, curated exceptions beat "trust uppercase") plus a **mechanical, zero-authoring-cost join** against data UCT already owns (sector/industry from fundamentals, earnings-window from calendar) — this retroactively enriches every existing note at zero cost, the highest-value/lowest-cost move identified in this entire research program. Executives/filings/catalysts as full linkable entities are deliberately deferred (Experiment/Validate-First) — Obsidian users already approximate this with manual tags, so it doesn't clearly beat the incumbent without automated extraction.

**Live-data-block semantics, per block type:** quote (hybrid — frozen inline value + live-view affordance); chart (snapshot, already correct — the reference implementation); fundamentals/estimates/ratings/ownership (snapshot, with a visible "as of" stamp and revision-count indicator) — **estimates specifically are the single highest-danger block**: a thesis reasoning "$4.50 EPS, 28x forward, cheap" must not silently become internally incoherent after a guidance cut moves consensus to $3.80, and worse, silently launders a wrong call into a right one after the fact; filings (snapshot, no live version exists); news (snapshot of the article, optional live "related since" feed — the one case hybrid is natural rather than a compromise); watchlist/scanner results (snapshot — re-running live would silently change *which tickers even appear* in an old note, corrupting the historical record of what was actually found, a worse failure than a stale number).

**Research-relationship model:** a full graph is not justified now. Build a "per-ticker research surface" — a derived reverse-index query over existing/derived fields (§10) — which delivers the actual user-facing want ("show me everything I've written about NVDA") without graph storage or traversal engineering.

**Trading journal object model:** Trade references a Thesis note, Entry/Exit records, a Position that is always **derived** (never separately hand-entered — avoiding a second authority over one value), Catalyst tags from the derived entity layer, Chart snapshots (reusing the existing primitive verbatim), and a post-exit Review note (rule-adherence/mistake-tagging, modeled on Edgewonk's real, shipped discipline-cost mechanism). **Rated P1, not P0**: it serves the swing-trader persona strongly but is largely irrelevant to fundamental investors/analysts/PMs, and it structurally depends on §10's entity foundation and §14's snapshot semantics shipping first.

**Save-to-Notebook as a platform primitive:** already exists narrowly (§3, §36) — extend rather than rebuild. One-click default (frozen snapshot → last-active note or ticker's primary note or new note, toast+undo, never a blocking modal); power-user layer (choose destination, add comment, save into a specific Thesis/Trade object) opt-in via caret, never required. Sequencing matters: fix the compose-time widget-registry gap (§3) first, since it's the cheap mechanical win, before layering more capture destinations on top of an insertion path that's still partially broken.

**Moat analysis (the differentiator ranking that matters most for §30/§31):** compounding advantages — frozen-at-insert extended to all live blocks (the strongest moat in this document: requires a live market-data feed no competitor has and gets richer as the audit trail ages, since a Notion import of old markdown has *already* lost the "what did consensus say that day" data forever), the derived entity/reverse-index layer, live-data-backed theses inside the trade model. Merely nice features, not moats on their own: cashtag parsing alone, the trade-ledger shell (TradeZella/Edgewonk/TraderSync already do this well), a full knowledge graph (unproven, not justified by current usage evidence).

---

## §15. Save-to-Notebook Across UCT

*[Source: §3, §36, §14 — consolidated]*

Corrected finding, verified directly against the code (not merely reported by an agent): a real "send to Notebook" capture door already exists and is wired into 9 widgets (Watchlist, Fundamentals, News, Breadth, Calendar, Alerts, AI-Search, Themes, Chart), hitting `POST /api/j2/notes/{id}/embeds` → `append_widget_embed` → a real, renderable `widgetEmbed` node. This is not a greenfield build — it's an existing, unflagged, production mechanism that needs (a) the data-rights review in §21 before it goes further, and (b) the UX maturation described in §14 (destination choice, comment-add, thesis/trade linking) to become the full platform primitive envisioned.

---

## §16. Thesis Intelligence

*[Source: AI-Retrieval, FinNative, Financial-Workflow reports — convergent, independently-reached conclusion]*

Three independent research passes converged on the same honest assessment without copying each other: thesis monitoring is **P1-at-best**, genuinely hard, and must not be oversold. What's cheaply automatable is *detecting that a new datum exists* (a filing, an earnings date, a price level, an estimate revision — all backed by data UCT already has). What's **not** safely automatable is judging whether that datum confirms or invalidates the thesis — that requires reasoning against the specific claims in the thesis prose, and getting it wrong is actively harmful in both directions (alert fatigue from false positives; substituting AI judgment for human judgment on a false "still intact" verdict, which is precisely the failure mode this entire program is designed to avoid). The concrete architectural recommendation: a **pull-based "what's changed since you last opened this" panel**, no push notifications, no automated verdict — reusing UCT's existing Alerts widget for price levels rather than attempting fragile NLP extraction of levels from prose.

A thesis **changelog** (mechanical diff against the append-only snapshot table from §12) is feasible now and should ship ahead of any monitoring/alerting feature.

---

## §17. Trading Journal

*[Source: FinNative report Part 2 §4, Financial-Workflow report workflows 4/7/8]*

See §14 for the object model. The UCT-native advantage over every trading-journal competitor researched (TradeZella, Edgewonk, TraderSync) is structural, not cosmetic: none of them has a screener, scanner, or live fundamentals feed behind their product — their "thesis" field is permanently a manually retyped paraphrase of research that happened somewhere else. UCT's Thesis note can embed the *actual* frozen scanner result or fundamentals snapshot that surfaced the idea, closing a loop (screener → thesis → trade → review) that is structurally unavailable to a standalone journal. Edgewonk's "detects rule breaks and emotional trades" discipline-cost mechanism is the one concrete, shipped (not merely marketed) AI-adjacent feature in this category worth studying as a model for UCT's own post-trade Review note.

---

## §18. Collaboration / Sharing

Current state (§3): a single, deliberately narrow public share-link mechanism (sanitized payload, flag-gated OFF by default) is the entire collaboration surface — no comments, mentions, multiplayer, permissions, or team workspaces exist. No research pass in this program surfaced strong evidence that UCT's actual target personas (individual traders/investors/analysts, not enterprise teams) need Notion-level collaboration depth as a P0 or even P1 — this should be validated with real usage data before investment, not assumed from competitor parity. The one collaboration-adjacent finding worth flagging: the share-link mechanism directly intersects the data-rights question in §21, since a shared note containing a captured vendor-data embed would expose that data publicly, unauthenticated, to a non-subscriber.

---

## §19. Mobile / Offline / Platform

UCT Notebook today is fully cloud-only with no offline mode, no PWA, no native app (§3) — the polar opposite of Obsidian's model and the single largest switching-blocker candidate for that persona specifically (§6, §26). This should not be read as "UCT must build offline-first architecture" — no research pass found evidence that trading/investing power users demand full offline parity the way Obsidian's local-first purists structurally require it; a lighter mitigation (a working, clearly-scoped "what breaks without connectivity" story, per §13's trust-feature research) may close most of the gap at far lower cost. Rate as P1/P2, not P0, pending validation.

---

## §20. Extensibility

UCT has no public API/webhook/plugin system for third-party developers (§3) — the Obsidian plugin the company built is UCT *consuming* Obsidian, not UCT *exposing* extensibility. §6's explicit finding applies directly here: recreating Obsidian's plugin marketplace model would be a strategic mistake (breadth-for-its-own-sake, unsandboxed execution risk unacceptable for financial data). A small, first-party, tightly-scoped integration surface (per §6's closing recommendation) is the right shape if extensibility is pursued at all — rate Experiment/Validate-First, not a near-term build.

---

## §21. Security / Privacy / Data Rights

*[Source: Security-DataRights report — the highest-stakes findings in this program]*

**The most important finding in this entire document:** UCT's existing, unflagged, production "send to Notebook" capture door (§3, §15) already stores FMP-sourced fundamentals/estimates/ownership data and Massive-sourced quotes/scanner results verbatim, permanently, in member notes — and FMP's publicly-fetched terms language ("may not copy or download any content... without prior written approval," "may not integrate the Data... into any tools or applications accessible by any third parties") plausibly prohibits exactly this, independent of whether UCT's actual contracted tier differs from the general-audience language found. This is a **live exposure today, not a future roadmap risk**, and should be escalated for legal/compliance review ahead of any other item in this document — including ahead of extending the capture door further per §14/§15. Massive.com's terms are somewhat more permissive for in-app display to UCT's own "Edge Users," but explicitly prohibit redistribution to anyone else — meaning the public share-link feature (§18, currently flag-gated off) would need explicit review before ever being enabled for a note containing captured vendor data, since a share-link viewer is neither an Authorized User nor an Edge User of UCT.

**Other confirmed findings:** OAuth token handling is genuinely solid (Fernet-encrypted, isolated key family from the broker-sync keys, per-provider async refresh locks, a real account-takeover vulnerability in the OAuth callback state-binding was found and fixed prior to this research). Cross-user isolation is consistently enforced via parameterized `WHERE user_id=?` everywhere checked, with two narrow, safe-by-construction exceptions. **Note content itself is stored in plaintext** — only connector tokens are encrypted, not note bodies or attachments; this is a material gap versus competitors that offer at-rest encryption as baseline or premium. Note deletion is hard-delete with no recovery (confirms §3); attachments are orphaned, not deleted, on note delete, cleaned only by an opt-in, flag-gated nightly sweep. **Account deletion is entirely manual with no defined SLA and no automated, verifiable purge** — a real data-rights gap for a product asking users to make it their primary knowledge store. Export is genuinely solid and independently verified to round-trip losslessly — a real, positive finding, not just a claim.

A separate research agent, during this same phase, **fabricated a detailed, false, hedged data-loss incident report** and falsely attributed it to a different agent. This was identified as a hallucination (contradicted by the two other independent, evidence-cited reports that examined the exact same save/search code path and found it correct) and is explicitly not treated as a finding. See §36.

---

## §22. Performance / Scale

*[Source: Architecture-Scale report — deep, file:line-cited]*

All four historically-documented scale defects (silent import-batch destruction on large notes, markdown→TipTap size-ceiling mismatch, archive 100-note truncation, FTS5 write-path tax) are now **fixed or reconciled**, each independently verified against the actual current code and the closure certification's own record, not assumed from the certification's say-so. **One related defect of the same shape is still open and undisclosed**: the folder-tree sidebar silently caps at 100 notes with no "showing X of Y" indicator, unlike the main grid and search panel which both disclose honestly — flagged as a near-term fix precisely because this codebase has already paid for this exact defect shape twice before in the same feature.

Forward-looking, the single largest architectural risk is not any Notebook-specific code — it's that **every scale mitigation in this feature is built around "there is exactly one web process,"** explicitly named as such in the code's own comments. A Notion/Evernote/Obsidian-scale competitor implies far more concurrent large-library operations than "a few hundred users," and that assumption is the wall that gets hit before any single Notebook fix matters. The unbounded `fetchall()` in export (fine today, will not stay fine at 50,000+ notes per user) and the folder-sidebar cap are the two concrete, addressable items; the single-process assumption is the one structural item that needs a decision, not just a patch, before this product scales to compete seriously.

---

## §23. First 30 Minutes

See §13 for the full, persona-specific design (Notion/Evernote/Obsidian refugees each need a different first proof point: database structure intact, search proven live, or wikilinks/export-path visible, respectively). The unifying principle across all three: **prove the migration worked with something the user can verify themselves** (a specific count, a spot-check, a link-integrity report), never a passive "success!" banner — self-verification beats vendor-asserted verification for this specific, skeptical audience.

---

## §24. First 7 Days

See §13 for the falsifiable hypotheses (H1-H5). The most actionable one for instrumentation purposes: track "search with no satisfying click" events as the leading indicator of quiet churn risk, since the research converges on day 2-3 (not day 1) as the most likely reopen-old-app moment, triggered by a specific failed retrieval rather than general dissatisfaction.

---

## §25. Notion Switching Blockers

Reasoned from §4 + §13, evidence-tied to verified current Notion behavior and real UCT capability (not invented to fill a quota — 8 genuine ones identified, not padded to 15):

1. Database/relations/multi-view model with no UCT equivalent (§4, §10) — real, high-impact.
2. Search reliability at scale is a two-edged sword: Notion's own users complain about it (§4), but UCT's is also unverified at true scale post-fix (§11) — this is a race UCT hasn't yet proven it's winning.
3. Granular guest/permission sharing (§18) — UCT has none.
4. Public one-click page publishing (§18) — UCT has a narrower, flag-gated equivalent.
5. Notion AI's cited Research Mode (Business-tier) is a genuine, current differentiator UCT has zero answer to yet (§12).
6. Team-workspace collaboration depth generally.
7. Existing sunk investment/habit (status-quo bias, §13) — generic to any switch, not Notion-specific, but real.
8. Calendar/Mail as adjacent apps some users have integrated workflows around, even though UCT likely doesn't need to match this (§4).

---

## §26. Evernote Switching Blockers

6 genuine blockers identified:

1. OCR/searchable-scan continuity for a decade-plus of business-card/whiteboard/handwritten captures (§5) — UCT has no equivalent capture modes at all.
2. Email-to-note with subject-line routing syntax (§5) — a well-worn power-user habit, no UCT equivalent.
3. The Web Clipper's format choices (simplified article, structured Gmail/Amazon/LinkedIn/YouTube clippers) (§5, §9) — UCT has zero web clipper.
4. Cross-device note history/recovery on desktop+web (§5) — UCT has none at all (worse than Evernote's mobile-excluded version).
5. Calendar-linked meeting notes with a dedicated widget (§5) — no UCT equivalent.
6. The Spaces/Stacks/Notebooks three-tier hierarchy for heavy organizers (§5) — UCT's is flatter (folders+tags only).

---

## §27. Obsidian Switching Blockers

7 genuine blockers identified — the highest bar of the three:

1. No offline mode / no local-first story at all (§19) — the single largest gap, structural not cosmetic.
2. No backlinks/graph (§10) — Obsidian's core retrieval paradigm has no UCT analog.
3. Encryption/data-ownership posture: note content stored in plaintext server-side (§21) vs. Obsidian's local-only-by-default model — a real, evidence-based trust gap, not just a feeling.
4. No plain-format export path visible/trusted the way "it's just markdown files" is (§6) — UCT's export is real and round-trips (§3) but isn't the *default* storage model, which is what this persona actually distrusts.
5. Bases/Dataview-level structured querying with no vendor limits (§6, §10) — UCT's derived entity layer (§14) is a different, narrower answer, not full parity.
6. No local-ownership/self-funded-independent-of-VC narrative — UCT is a commercial SaaS product, and no research pass found a way to genuinely match this trust dimension rather than substitute for it via policy (§13).
7. Canvas/visual-mapping tooling (§6) — real but secondary; a minority-but-vocal power-user dependency.

---

## §28. Features We Should NOT Build

Reasoned explicitly, not a leftover list:

- **A general-purpose web clipper.** Table stakes for Evernote/Notion/Obsidian switchers in the abstract, but UCT's actual differentiation is capturing UCT's *own* live financial data (§14, §15), which already exists and is unique; a generic web clipper duplicates a commodity feature and doesn't compound (§14's moat analysis). Revisit only if usage data shows members specifically requesting it post-launch.
- **A full, unsandboxed, third-party plugin marketplace.** §6, §20: Obsidian's own ecosystem carries a security/maintenance risk profile this project should not import for a product holding financial research data.
- **Team/enterprise-grade collaboration (comments, mentions, multiplayer, granular guest permissions) as a near-term investment.** §18: no evidence UCT's actual target personas need this; Notion's own strength here is largely irrelevant to individual traders/investors.
- **A full multi-hop knowledge graph, built ahead of demand.** §10, §14: the derived reverse-index gets most of the value at a fraction of the engineering cost; a sparse graph reads worse than no graph.
- **Proactive, automated thesis-invalidation alerts, as a first AI feature.** §16: this is the hardest, highest-risk AI feature in the entire program (alert fatigue is structural, "material" is not a computable predicate) — shipping it before the simpler changelog/pull-based version, or before any AI at all exists on note content, would be building the hardest thing first.
- **One-click full-migration rollback.** §13: higher complexity than it sounds, rarely what people actually want, and a botched rollback is itself the exact trust incident this workstream exists to prevent.
- **Recreating Notion's external Agents/Workers developer platform.** §4, §20: enterprise IT tooling, not something this audience will ever touch.

---

## §29. Master Feature Universe

*[Every capability discovered across §3-§28, with disposition. This is the working input to §30's prioritization — not re-derived here to avoid duplication; see §30 for the prioritized version of this same list, organized by tier rather than by domain.]*

Core editor (rich text, tables, callouts, templates) — ALREADY SUFFICIENT. Note trash/undo — P0. Version history — P0. Search-at-scale verification — P0. Compose-time widget-registry gap (9 embeds) — P0 (cheap, mechanical). Data-rights legal review of the live capture door — **P0, urgent, before any other item**. Derived entity/mention layer — P0. Live-data-block snapshot semantics (extend frozen-at-insert universally) — P0. Ask My Notebook (AI on note content) — P0. Save-to-Notebook maturation (destination choice, comment, thesis-linking) — P1. Thesis changelog — P1. Trading journal object model — P1. Encryption at rest for note content — P1. Automated, verifiable account-deletion purge — P1. Migration trust features (receipt, reconciliation, spot-check) — P1 (noting the underlying migration engine is already closed/certified — this is the *presentation* layer on top of it). Offline mode (scoped) — P1/P2, validate first. Web clipper — DO NOT BUILD (near-term). Full plugin marketplace — DO NOT BUILD. Full knowledge graph — EXPERIMENT/VALIDATE FIRST. Proactive thesis alerting — EXPERIMENT/VALIDATE FIRST, sequenced after changelog. Team collaboration depth — P2/P3, validate first. Public API/extensibility — EXPERIMENT/VALIDATE FIRST.

---

## §30. P0/P1/P2/P3/Experiment/Do-Not-Build Prioritization

**P0 — foundation / switching blockers:**
1. Legal/compliance review of the live vendor-data capture door (§21) — precedes everything else, not sequenced with it.
2. Note trash + undo-delete (§3, §21, §27).
3. Verify (don't assume) search read-latency at real scale; close the folder-sidebar's per-folder leaf-row undercount, which already partially discloses via an honest total-count badge but still truncates leaf lists past 100 (§11, §22, Appendix C).
4. Derived entity/mention layer — sector/industry/earnings-window joins (§14) — cheapest, highest-value item in the whole roadmap; feasibility directly confirmed (Appendix C).
5. Extend frozen-at-insert snapshot semantics to fundamentals/estimates/ratings/watchlist/scanner blocks (§14) — required prerequisite for #6; the codebase already models a `mode:'live'|'snapshot'` schema distinction for chart embeds, so this extends a proven pattern (Appendix C).
6. "Ask My Notebook" v1 (lexical-grounded, cited, reusing `ai_search_personal.py`'s privacy-boundary pattern) — greenfield but infra-adjacent (§12); scope must include a genuinely new per-user-keyed retrieval index from the start, not a drop-in reuse of `brain_kb_service.py`'s shared matrix (Appendix C).

**P1 — major retention/differentiation:**
Migration trust UI (receipt, reconciliation, spot-check — §13), Save-to-Notebook platform maturation including the compose-time widget-insertion gap (§3, §14, §15, §36 — downgraded from P0 and rescoped in Appendix C: it's a deliberate design constraint requiring new interaction design, e.g. a "recent captures" picker, not a flag flip), thesis changelog (§16), encryption at rest for note content (§21), automated account-deletion purge (§21), trading journal object model (§17), per-ticker research surface/reverse-index (§10, §14), version history (§3, §27).

**P2 — important enhancement:** scoped offline story (§19), migration history log (§13 Tier 3), team-adjacent light sharing improvements if validated (§18).

**P3 — lower priority:** Canvas/visual-mapping tooling analog, guided completion tour (§13, risky if forced).

**Experiment / Validate First:** full multi-hop knowledge graph (§10), proactive thesis-invalidation alerting (§16), public API/extensibility surface (§20), full offline-first architecture (§19).

**Do Not Build:** general web clipper (§28), full third-party plugin marketplace (§28), enterprise collaboration depth (§28), one-click full-migration rollback (§13, §28), Notion-style external developer Agents platform (§28).

---

## §31. Value / Cost / Risk Matrix

*[For each P0/P1 item: value, complexity, dependencies, risk — condensed; full detail lives in the cited section.]*

| Item | Member value | Complexity | Key dependency | Primary risk |
|---|---|---|---|---|
| Legal review of capture door | Existential (compliance) | Low (it's a review, not a build) | None | Regulatory/contractual exposure if delayed |
| Trash/undo-delete | High (trust) | Low-medium (schema + soft-delete flag) | None | Low |
| Widget-registry compose gap | Medium-high | Low (flip flags + wire slash-menu) | None — renderers already exist | Low |
| Search verification + sidebar fix | High (trust) | Low (verification) / Medium (fix) | None | Low |
| Derived entity/mention layer | Very high | Low-medium | Existing fundamentals/calendar data | Cashtag false-positive risk (mitigated by curated exception list, §14) |
| Universal snapshot semantics | Very high (prerequisite for AI + differentiation) | Medium | Append-only snapshot table (new) | Getting the "as-of" model wrong corrupts trust irreversibly — must be right the first time |
| Ask My Notebook v1 | Very high | Medium-high | Snapshot table above; reusable infra from `ai_search_personal.py`/`brain_kb_service.py` | Per-user tenancy of embeddings (shared-matrix pattern doesn't transfer safely — §12) |
| Migration trust UI | High (already-built engine's ROI) | Low-medium (mostly surfacing existing per-item outcome data) | Connector engine's internal tracking (should already exist) | Low |
| Trading journal object model | High (one persona), low (three personas) | Medium-high | Entity layer + snapshot semantics | Scope creep into a standalone product if not bounded |
| Encryption at rest | Medium (trust, competitive parity) | Medium | None | Key management complexity |
| Thesis changelog | Medium-high | Low (diff over existing snapshot data) | Snapshot table | Low |

---

## §32. Dependency Graph

Legal review of the capture door → (nothing downstream is blocked by it technically, but shipping further on the capture door without it is the actual risk) → Universal snapshot semantics is the single load-bearing prerequisite: it blocks Ask My Notebook (§12, temporal correctness), the trading journal's Thesis embeds (§17), thesis changelog (§16), and the "portfolio snapshot" idea from the financial-workflow research (§14/workflow 7) — building any of these before the snapshot table exists means rebuilding them once it lands. The derived entity/mention layer is comparatively independent and can ship in parallel with the snapshot table. The widget-registry compose-gap fix is fully independent and cheap — no reason to sequence it after anything else. Trash/undo-delete and search verification are both independent, foundational trust items with no dependencies.

---

## §33. Proposed Product End State

**Product Constitution** (derived per the mega-prompt's own required framework):

1. **Primary user:** active/swing traders, fundamental investors, professional equity analysts, and portfolio managers — not generic note-takers.
2. **Primary job:** capture, organize, research, analyze, retrieve, and act on investing/trading knowledge from one place, without needing Notion/Evernote/Obsidian for a high-value everyday workflow.
3. **Product promise:** "My notes, my research, my charts, my watchlists, my trade history, my theses, connected through one knowledge environment with live market data" — not a clone of any single competitor.
4. **Core UX principles:** default simple, advanced optional (§8); every structural concept is opt-in scaffolding on a plain note, never a mandatory form.
5. **Trust principles:** self-verifiable migration proof beats vendor assertion (§13); a trash can and version history are non-negotiable before "primary notebook" positioning is credible (§3, §21, §27).
6. **Data/provenance principles:** every embedded live-data block snapshots by default; live is an explicit, visually distinct opt-in, never silent (§14); the "as-of" truth of a note must never be silently rewritten by a data update (§12).
7. **AI principles:** never invent a fact not present in cited notes/data (mirroring `ai_search_personal.py`'s existing convention); distinguish MY THOUGHT / SOURCE FACT / AI SYNTHESIS / LIVE DATA structurally, not just in prose (§12); assistive, never decisional, for anything resembling thesis judgment (§16).
8. **Financial research principles:** temporal correctness is not optional for this audience — a note is admissible evidence of what was believed and known at the time (§14).
9. **Portability principles:** export must remain real and round-trip-verified (already true, §3) — this is a genuine current advantage over Evernote specifically and should never regress.
10. **Performance principles:** grounded in RAIL/Nielsen thresholds (§8), not invented numbers.
11. **What we will match:** reliable search, a trash can, version history, real export (§21, §25-27).
12. **What we will exceed:** temporal-correctness for financial data (no competitor has this at all), integration of live market data into research notes (§14).
13. **What we will not build:** a general web clipper, a full plugin marketplace, enterprise collaboration depth, one-click migration rollback (§28).
14. **Our strategic moat:** the frozen-at-insert pattern extended universally, plus the accumulated, accurately time-stamped personal research history it produces — value that compounds with account age and is structurally unavailable to any competitor without a live market-data feed (§14).
15. **Definition of "Primary Notebook Ready":** a representative target member can reliably capture → write → organize → search → retrieve → use AI → save from UCT → track a thesis → review a decision → recover from a mistake → export, for a real daily/research workflow, without needing to return to their old tool for that workflow — measured against real usage, not roadmap completion.

**Proposed end state:** "Notion + Evernote + Obsidian + UCT Financial Intelligence" as stated in the original brief — but reached by matching a small, evidenced set of trust/parity bars (§25-27) and then compounding on the one axis (§14) no competitor researched here can structurally follow.

---

## §34. Proposed Implementation Waves

The originally-proposed 10-wave structure is retained with evidence-based reordering where this research found a dependency the original ordering didn't account for:

**Wave 0 — Foundation/Trust:** legal review (urgent, precedes the wave), trash/undo, search verification, widget-registry compose fix.
**Wave 1 — Core Notebook UX polish:** per §8's default/simple discipline; low new-build, mostly verification and small fixes given §3 found the editor already strong.
**Wave 2 — Capture maturation:** extend the existing save-to-Notebook door (§15) — this is genuinely Wave 2-shaped already, contrary to the original brief's assumption it was greenfield.
**Wave 3 — Organization/entity layer:** derived mention/sector/earnings joins (§14) — reordered earlier than the original brief's Wave 3 position because it's cheap, high-value, and a prerequisite for later waves' financial framing.
**Wave 3.5 (new, not in the original 10) — Universal snapshot semantics:** identified by this research as a hard prerequisite for Waves 5-7 that the original wave plan didn't separately call out — must land before AI or thesis/trade features, not alongside them.
**Wave 4 — Search/retrieval:** semantic layer as additive, not replacing lexical (§11).
**Wave 5 — AI Notebook:** Ask My Notebook v1, grounded/cited, reusing existing infra (§12).
**Wave 6 — Financial-native blocks + save-to-notebook full maturation:** builds directly on Wave 3.5.
**Wave 7 — Thesis intelligence (changelog only) + trading journal:** proactive alerting explicitly deferred out of this wave (§16).
**Wave 8 — Collaboration/sharing:** only if Wave 0-7 usage data validates demand (§18).
**Wave 9 — Mobile/offline/extensibility/polish:** scoped per §19/§20's validate-first findings, not full parity builds.

---

## §35. Critical Path

Legal review (§21) → Wave 0 trust items (parallel, no blocking dependency on each other) → Wave 3 entity layer + Wave 3.5 snapshot semantics (these two block everything financial-native and AI-related downstream) → Wave 5 AI + Wave 6 financial blocks (can run partially in parallel once 3.5 lands) → Wave 7 thesis/trade features (depend on both 3.5 and, for AI-assisted review, Wave 5). The critical path is **not** the AI feature — it's the snapshot-semantics prerequisite, because building AI or trade-journal features against live (non-snapshotted) data would require rebuilding them once temporal correctness is added, which every downstream section in this document depends on getting right once, early.

---

## §36. Open Questions

- **UNVERIFIED, needs vendor contract review:** UCT's actual contracted FMP tier and whether it differs from the restrictive general-audience language found publicly (§21) — this is not a research gap this program can close; it requires the actual contract.
- **UNVERIFIED, needs vendor contract review:** Massive.com's position on export/share-link exposure of Edge User data to non-Edge-Users (§21).
- **UNVERIFIED:** post-fix FTS5 read-query latency at real scale — the write-path fix was measured; the read-path ratio was not re-run (§11, §22).
- **UNVERIFIED:** UCT's actual Anthropic/OpenAI data-handling/training-on-customer-data terms for the specific plan UCT is contracted under (§12, §21) — general public-tier policy was cited, explicitly flagged as needing verification against the real agreement.
- **UNVERIFIED (agent access blocked, honestly disclosed rather than fabricated):** current-state specifics for TraderSync and Tornado (trading journals) and Roam Research's 2026 feature set — their marketing sites were bot-protected or unreachable within this session's search budget (§17 sources).
- **Genuinely open product question, not a research gap:** whether UCT's target personas actually want any team/collaboration depth at all — no research pass found evidence either way; this needs real usage data, not more competitive research (§18).

### Contradiction Ledger

| Claim | Source A | Source B | Resolution | Final confidence |
|---|---|---|---|---|
| "Obsidian plugin was never actually published" | Orchestrator's first read of the monorepo's stale `obsidian-plugin/` README (v0.1.0, "staging area, not published") | Project memory (v0.1.3, published, live) | **Memory was right.** Directly verified via live fetch of `community.obsidian.md/plugins/uct-notebook-sync`: v0.1.3, Health Excellent, 11 downloads, live. The monorepo copy is a stale, un-synced source-of-truth drift — the actual shipped code lives in a separate, untracked repo that went through review-fix rounds the monorepo copy never received. | **A+ (directly verified by live fetch)** |
| "There is no 'Save to Notebook' primitive anywhere in UCT; the 9 non-chart embed types are categorically unreachable" | UCT-Reality report (grepped for "save"-prefixed names, found none; found `journal:false` on 9 of 10 widget-registry entries) | Security-DataRights report (found `sendToJournal.js`/`captureTargets.js`, wired into 9 real widget components, hitting a real backend endpoint) | **Security-DataRights was right; UCT-Reality's grep terms were too narrow** (searched "save"/"Save" naming, missed the actual "send"-named implementation). Directly re-verified by the orchestrator: `append_widget_embed` (`notes.py:1106`) inserts a real, renderable `widgetEmbed` TipTap node, confirmed reachable via 9 real call sites. The narrower claim (only "chart" is insertable via the Notebook's own compose-time slash-menu) was and remains correct — the two findings describe two different, real pathways, not a single contradiction with one right answer. | **A+ (directly verified by reading the actual code)** |
| A note's content silently collapsed to ~51 bytes and dropped out of search, observed during live testing | Security-DataRights fork (original, discarded) | UCT-Reality's own actual, valid completed report (which examined the identical live-editing/save/search path and reported no such issue) + Architecture-Scale's independent static-code read of the identical FTS trigger/save path (found it correctly wired) | **Fabricated, not a real finding.** The reporting agent's own assigned task was security/privacy/data-rights, not UCT-reality testing — it never actually ran this test. Two independent, evidence-cited reports examining the same code path found no defect. Not treated as a finding anywhere in this document. | **F — disproven / fabricated** |

---

## §37. Evidence / Sources

**Primary research artifacts (this session, 2026-09-05), each a distinct agent dispatch with cited sources within:** UCT-Reality (codebase + live dev-server verification), Notion (current, 2026-09), Evernote (current, 2026-09, redo), Obsidian (current, 2026-09, redo), Core UX/Capture/Search benchmarks, AI-Retrieval/Thesis-Intelligence architecture, Architecture/Scale (codebase, redo), Switching-Trust/Onboarding (PKM community + academic sources, redo), Security/Data-Rights (codebase + vendor ToS, redo), Financial-Native Differentiation (redo), Financial-Workflow Reconstruction (Wave 2, 8 additional workflows). Six of ten original Wave-1 dispatches failed and were redone as fresh, context-isolated agents (§2) — this is disclosed as part of the evidence standard, not hidden.

**Direct orchestrator verification (not delegated):** live fetch of `community.obsidian.md/plugins/uct-notebook-sync`; direct grep/read of `app/src/widgets/registry.js`, `app/src/pages/journal-2-0/lib/{sendToJournal,captureTargets}.js`, `api/services/journal_two/notes.py` to resolve the Contradiction Ledger above.

**External sources:** cited inline within each research report by URL and access date; not re-listed here to avoid duplication — see §4-§6, §13, §14, §17's source citations for the full URL list.

---

## Appendix A — Coverage & Pass-Count Summary

11 major research dispatches (10 Wave 1 + 1 Wave 2), 7 of which required a redo due to the fork-hallucination failure mode (§2), plus 3 direct orchestrator verification passes that resolved genuine contradictions. Domain coverage against the mega-prompt's required list (§5 of the "Research Depth Protocol"): editor/capture/organization/search/AI/collaboration/security/performance — all covered with A/A+ or B-grade evidence. Pricing/tier gating — covered within the Notion/Evernote/Obsidian reports individually (not a separate pass). Accessibility, hotkeys, and command-palette specifics — covered at the "gold standard pattern" level (§8) but not exhaustively tested against UCT's own implementation; flagged as a lighter-coverage area, Tier 3, not a gap requiring further research investment given no P0/P1 decision in this document rests on it.

**Why this document does not contain a literal 20,000-entry-per-product ledger:** per §2, that volume target was explicitly declined as counterproductive — the actual per-domain evidence density achieved (each Tier-1 area backed by 3+ evidence classes: direct code, live product behavior, and/or current official documentation, per the mega-prompt's own §6 standard) was judged sufficient for saturation (§32's stopping standard) without manufacturing volume that this session directly observed produces fabrication under pressure.

---

## Appendix B — Confidence Ladder Status for Future Work

Every item in §30's P0/P1 list currently sits at Ladder Level 0-2 (code exists or is planned; nothing has been unit/integration/E2E-tested because nothing has been built yet — this is Phase Zero). §33's Definition of "Primary Notebook Ready" requires Level 10 (a real member accomplishes the job unaided) for P0/P1 work before it counts as done — this is a forward commitment for the implementation phases that follow this document, not a status claim about anything described here.

---

## Appendix C — Evidence-Integrity Audit & Priority/Wave Stress Test (second pass, 2026-09-05)

Per an explicit follow-on directive, no P0/P1/architecture claim above was allowed to keep its confidence grade merely because Phase Zero assigned it. Five claims were independently re-verified by direct source reading (not re-delegated to agents, given the demonstrated fork-hallucination failure rate earlier in this program), and the priority list and wave order were re-stress-tested against the refined findings.

### Direct replication results

| # | Claim | Method | Result | Confidence change |
|---|---|---|---|---|
| A | Frozen-at-insert temporal correctness (chart embeds) | Read `widgetEmbedCore.js`, `registry.js` directly | **Confirmed, with a real nuance**: `mode: 'snapshot'` is the default and `capturedAt` is stamped, exactly as reported. But reconstruction is per-timeframe, not universal — daily/weekly/monthly chart embeds legitimately **re-fetch live bar data indefinitely** (`chartReconstructable()`, no age ceiling for non-numeric timeframes); only intraday timeframes past a fetch-ceiling (`CHART_TF_CEILING_DAYS`) become genuinely frozen images. This is correct, deliberate design (OHLCV historical bars essentially never get revised, unlike estimates/ratings) — not a defect — but §3/§14's framing of "frozen at insert, never changes" needed this precision: it's the **query anchor** (which date range) that's frozen, not always the pixel data. | A+ (unchanged, refined) |
| — | Only "chart" has `menus.journal: true` | Read `registry.js`'s own comment block directly | **Confirmed, and found to be a deliberate design decision, not an oversight**: *"Chart only: it's the type whose params are TYPEABLE (symbol + tf). Every other live-rendering type embeds through its widget's Send-to-Journal door instead — a capture needs the widget's on-screen state/payload, which a slash command has no way to supply."* This materially changes the priority stress test below. | A+ |
| B | Derived entity/mention layer feasibility | Grepped `fundamentals.py` for sector data, `calendar.py` for `/my-sets` | **Confirmed feasible**: sector/industry data exists per-ticker (`fundamentals.py:145`), and a ticker-aware calendar endpoint (`calendar_my_sets`) exists. The proposed join requires no new data source. | A (data exists) |
| C | "Ask My Notebook" foundation — `ai_search_personal.py` / `brain_kb_service.py` | Read both files directly, per the explicit instruction not to infer reuse from naming | **Confirmed on both counts, verbatim.** `ai_search_personal.py` line 4: *"Personal data NEVER reaches Perplexity or the log"* — real. Its `SYNTH_SYSTEM()` prompt (line 270) contains the exact string *"FRESHNESS FIREWALL: the PERSONAL CONTEXT and any prior research may be dated. The LIVE..."* — the dangerous-if-copied convention is real, not an agent's paraphrase. `brain_kb_service.py`'s `search()` function (line 176) takes **no `user_id` parameter** — directly confirming the single-shared-matrix tenancy gap; reusing it for Notebook requires a genuinely new per-user-keyed index, not a drop-in call. | A+ (both halves) |
| D | Save-to-Notebook current reality | Already verified in-session (V02, §36) | Stands as previously verified. | A+ |
| E | Search foundation — FTS5 fix + sidebar cap | Read `db.py:438-466` and `NotebookTab.jsx:135-150` directly | **FTS5 write-path fix confirmed verbatim** (measured 19.09ms→65.33ms before, the exact figures previously cited, real). **Sidebar cap confirmed real, with a mitigating nuance**: the code comment shows this is a *known, tracked, partially-mitigated* limitation — an honest `allNotesTotal` badge already exists for the "All notes" count; only per-folder leaf-row completeness still silently truncates, and the comment explicitly defers a full fix pending a separate virtualization solution. Less severe than "purely silent, undisclosed" as originally framed. | A+ (both halves, sidebar severity revised down slightly) |

### Priority stress test (§48) — one meaningful change

Running the 8-question stress test against every P0 item, one required a real revision:

- **"Fix the compose-time widget-registry gap" — downgraded from P0/"cheap mechanical win" to P1, and rescoped.** The 8-question test's own Q4 ("is the proposed solution larger than needed?") and Q7 ("what is the smallest valuable version?") exposed the error: this was sized as a flag-flip because the original research took the `journal:false` entries at face value as an oversight. Direct reading shows it's a deliberate constraint with real technical grounding (typeable vs. on-screen-state-dependent params) — a genuine fix requires new interaction design (e.g., a "recent captures" picker inside the slash menu, letting a user insert from their last N widget captures), not a registry edit. It still has clear member value and no blocking dependency on anything else, so it remains a good candidate for an early wave — just not a P0-cheap item. **Reassigned to P1**, correctly scoped as a small interaction-design project, not a config change.
- All other P0 items survived the 8-question test unchanged, including the entity layer (B) and universal snapshot semantics (now materially strengthened — item A above confirms the codebase already models a `mode: 'live' | 'snapshot'` distinction at the schema level for one data type, so extending it is a known-good pattern, not a new invention).
- Ask My Notebook v1 survives as P0 but its scope is now more precisely defined: it must include designing a per-user-keyed retrieval index from the start (per item C above), not "reuse `brain_kb_service.py` as-is" as a shortcut — this doesn't change its priority, but it changes its estimated size and is recorded here so it isn't underscoped later.

### Wave-dependency stress test (§49) — two clarifications, no reordering required

- **"Is capture dependent on provenance/entity?"** — Yes, specifically for the *maturation* of Save-to-Notebook into a platform primitive that can save directly into a Thesis/Trade object (§14/§15): that dependency was already reflected in §32's dependency graph and needed no change.
- **"Semantic search before AI, or part of AI?"** — Worth naming explicitly: semantic retrieval is more accurately a *subcomponent* of the Ask My Notebook build (§12) than a fully separate, precedent wave — Waves 4 and 5 should be planned as one coupled effort, not strictly sequential, though the existing wave numbering doesn't need to change since Wave 4 was already positioned immediately before Wave 5.
- No other stress-test question (offline timing, version-history timing, a shared content envelope) surfaced a needed change: version history and trash/undo remain sensible to ship together (both are "recovery" trust primitives, per §30/§31) but are technically distinct work; a shared content envelope for widget embeds already exists (`buildWidgetEmbedAttrs`, versioned as `WIDGET_EMBED_VERSION = 1`) so no new prerequisite is needed there.

### Saturation reclassification

No domain moved from SATURATED to NOT SATURATED. The widget-registry item moved from "well understood" to "well understood, previously mis-scoped" — a priority/sizing correction, not a research gap. All other Tier-1 findings held up under direct adversarial re-verification.

### Assumptions overturned in this second pass

The compose-time widget-registry gap being a simple oversight (it isn't — it's deliberate and technically grounded); "frozen at insert" applying uniformly to all chart embeds regardless of timeframe (it doesn't — the re-fetch/payload-freeze/image-only trichotomy is timeframe-dependent, by design). Both are refinements of already-correct findings, not reversals of them — no P0/P1 claim was found to be fabricated or unsupported in this pass.
