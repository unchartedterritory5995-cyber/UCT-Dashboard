# Wave 15, lane W15-N — Notion column research for the owed scorecard rows

Research only. No edits to `tools/parity_scorecard.py` or `docs/notebook/parity-scorecard.md` —
an integrator applies these proposals. Every Notion page fetched below was read live via WebFetch
on **2026-10-04**; the extracted text for each page that states something is saved OUTSIDE this
repo at
`C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\scorecard-pages\notion\<page id>.txt`
(vendor text, never committed) with its sha256 recorded below. Every quote was checked verbatim
against its saved file with `grep -F` before being entered here. Rows where no official page states
the capability record that finding instead, per the rule that an absence on a competitor's page is
never cited and is never inferred.

Verdict proposals follow `tools/parity_scorecard.py`'s closed set and its rule: a verdict of AHEAD,
PARITY or BEHIND needs both sides evidenced, and AHEAD requires the competitor's own page to state
the limit (an absence is never cited as AHEAD). These are proposals for the integrator, not edits to
the scorecard.

---

## G-005 — Local draft safety net (crash/close protection)

- Page: no page states it
- URLs checked: https://www.notion.com/help/use-pages-offline ; https://www.notion.com/help/reset-notion
- Fetched (UTC): 2026-10-04
- Quote: none found
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: the offline-pages help doc describes syncing changes once reconnected to WiFi and the
  reset-Notion troubleshooting doc only reassures that synced data survives a reset — neither states
  what happens to an edit that is unsynced when the app crashes or a tab is closed, so the capability
  stays unconfirmed on the Notion side.

## G-011 — Search read-latency at platform scale

- Page: no page states it
- URLs checked: https://www.notion.com/help/search ; https://www.notion.com/help/enterprise-search ; https://www.notion.com/help/optimize-database-load-times-and-performance
- Fetched (UTC): 2026-10-04
- Quote: none found
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: the base workspace-search help page publishes no latency figure at all, and the
  "in seconds" language on the Enterprise Search and Q&A pages describes a separate LLM-mediated
  product, not the raw full-text search this row measures, so it cannot stand in as the row's
  competitor evidence.

## G-014 — Query-aware search snippets ('snippet()'/'highlight()')

- Page: no page states it
- URL checked: https://www.notion.com/help/search
- Fetched (UTC): 2026-10-04
- Quote: none found
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: the search help page documents sort options, filters and labels like "Most viewed" but
  never states that a result shows a highlighted snippet of the text that matched.

## G-113 — Page-aware document search, sectioned separately from note search

- Page: no page states it
- URLs checked: https://www.notion.com/help/import-data-into-notion ; https://www.notion.com/help/images-files-and-media ; https://www.notion.com/help/search
- Fetched (UTC): 2026-10-04
- Quote: none found (closest related, but not dispositive, text on the import page: "Notion will
  convert the text so it's searchable (and works well with Notion AI)" — about whether a PDF's text
  becomes searchable at all, not about page-anchored or separately-sectioned results)
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: the import page confirms an imported PDF becomes a single searchable Notion page but
  never states whether a search match is anchored to a page number or shown in a section separate
  from ordinary note search, which is the specific capability this row asks about.

## G-123 — A citation that is a VERIFIED LOCATION in the source, not a quoted string the model produced

- Page: no page states it (the row asks specifically where inside a source a citation points)
- URLs checked: https://www.notion.com/help/enterprise-search ; https://www.notion.com/help/research-mode ; https://www.notion.com/help/notion-ai-connectors ; https://www.notion.com/help/notion-ai-faqs ; https://www.notion.com/help/guides/unearth-fresh-insights-from-your-personal-knowledge-library-using-q-and-a ; https://www.notion.com/help/guides/get-answers-about-content-faster-with-q-and-a
- Fetched (UTC): 2026-10-04
- Quote: none found (every page says only that an answer "cites its sources" / "always cites its
  sources so you can go back to the source" — already in the scorecard as `N_cite` — with one partial
  exception: the AI Connectors page states that for a connected third-party app "Notion AI will...
  cite... the specific messages it referenced," i.e. message-level for Slack, which is a different
  surface than a Notion page)
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: every official page that documents Q&A, Enterprise Search or Research Mode citations
  states only that the answer cites its sources, never whether the citation opens the whole page or
  a specific passage/location within it, so the page-level-vs-passage-level question the row asks
  stays unanswered by Notion's own docs.

## G-124 — Refusing to answer when the corpus does not support one — and not paying a model to do it

- Page id: `notion__understanding_how_q_and_a_finds_answers_can_help_you_get_better_results`
- URL: https://www.notion.com/help/guides/understanding-how-q-and-a-finds-answers-can-help-you-get-better-results
- Fetched (UTC): 2026-10-04T15:08:00Z
- sha256: `a6688375cb9f459377c12e3c84f89a901f5d031bf8c9a09178aeb1aa2105a492`
- Quote: "If you ask about topics that aren't explicitly covered in your workspace, Q&A won't return a result."
- Proposed N verdict: **PARITY**
- Reasoning: Notion's own guide states Q&A will not return a result when a topic is not explicitly
  covered by the workspace's content, which matches UCT's refuse-when-unsupported behavior, though
  the guide says nothing about whether a model call still runs to produce that refusal, so the row's
  "and not paying a model to do it" half stays a UCT-only claim rather than grounds for AHEAD.

## G-138 — Find and replace

- Page: no page states it
- URLs checked: https://www.notion.com/help/keyboard-shortcuts ; https://www.notion.com/help/search
- Fetched (UTC): 2026-10-04
- Quote: none found
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: Notion's own keyboard-shortcuts page documents `cmd/ctrl+F` to find text inside a page
  but no replace counterpart, and no other official page documents a find-and-replace feature.

## G-144 — An undo/redo control on touch

- Page id: `notion__writing_and_editing_basics`
- URL: https://www.notion.com/help/writing-and-editing-basics
- Fetched (UTC): 2026-10-04T15:08:00Z
- sha256: `032c0f4847ea4f20cbdb765067c8a85cd23f74eceb8c315c7df87a500c928aa8`
- Quote: "Undo/Redo: Take back your last action on a page, or reinstate it."
- Proposed N verdict: **PARITY**
- Reasoning: the page's "On mobile" section states this control is reachable from the `•••` menu at
  the top right on touch, which is the same touch-tier undo/redo capability UCT shipped in wave 10.

## G-147 — Nested tags

- Page: no page states it
- URLs checked: https://www.notion.com/help/database-properties ; https://www.notion.com/help/views-filters-and-sorts
- Fetched (UTC): 2026-10-04
- Quote: none found
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: Notion's property documentation describes Select and Multi-select as a flat list of
  tags you type and press enter after each, with no mention anywhere of a tag having sub-tags or a
  parent/child hierarchy.

## G-148 — Unlinked mentions

- Page: no page states it
- URL checked: https://www.notion.com/help/create-links-and-backlinks
- Fetched (UTC): 2026-10-04
- Quote: none found
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: the backlinks page documents only backlinks created by an explicit `@`-mention and
  never describes a surface that lists other notes naming this one's title without linking it.

## G-152 — Split view (desktop, two notes side by side)

- Page id: `notion__views_filters_and_sorts`
- URL: https://www.notion.com/help/views-filters-and-sorts
- Fetched (UTC): 2026-10-04T15:08:00Z
- sha256: `ca9055b78a059971493d984cf11269ad3b7471695789a82c298695a3066548af`
- Quote: "Side peek: Open pages on the right side of the database. The rest of the database view continues to be interactive on the left."
- Proposed N verdict: **PARITY, flagged** — not a clean match, integrator should weigh the mechanism difference
- Reasoning: the page documents opening a page on the right while another view stays interactive on
  the left, which is Notion's closest documented two-surfaces-at-once capability, but the mechanism
  is a page opened beside a DATABASE TABLE view rather than UCT's "a second arbitrary note opens
  beside the first," so it settles that Notion has some split-pane capability without being certain
  it is the same capability the row names.

## G-156 — A real daily note ("today's note")

- Page id: `notion__database_templates`
- URL: https://www.notion.com/help/database-templates
- Fetched (UTC): 2026-10-04T15:08:00Z
- sha256: `06ca4f4fdf2cb06d6190a6395aa9cc3dcffa74e2ffee530594b393b6763fb2cf`
- Quote: "Repeating database templates automatically create a copy of a template in your database however often you would like."
- Proposed N verdict: **PARITY**
- Reasoning: the same page's setup steps state the repeat interval can be set to "daily," so Notion
  documents an automatically-recreated daily entry that is the functional equivalent of UCT's
  one-note-per-member-per-day design, the same way the scorecard already treats Notion subpages as
  PARITY for nested folders despite a different underlying mechanism.

## G-161 — Email-to-notebook (a per-member inbound address)

- Page: no page states it
- URLs checked: https://www.notion.com/help/workspace-settings ; https://www.notion.com/help/account-settings ; https://www.notion.com/help/add-members-admins-guests-and-groups ; https://www.notion.com/help/embed-and-connect-other-apps ; https://www.notion.com/help/notion-ai-connectors
- Fetched (UTC): 2026-10-04
- Quote: none found
- Proposed N verdict: **NOT-VERIFIED** (unchanged)
- Reasoning: no notion.com/help page documents a per-member inbound email address for turning an
  emailed message into a page — multiple third-party blogs describe an "Email Content to Pages"
  workspace setting, but per the rule against using third-party sources as the verdict source, and
  having checked the settings/members/connections pages that would document it, this is recorded as
  not verified rather than inferred from those blogs.

---

## Summary table

| row | capability | N quote found? | proposed N verdict |
|---|---|---|---|
| G-005 | Local draft safety net | no | NOT-VERIFIED (unchanged) |
| G-011 | Search read-latency at scale | no | NOT-VERIFIED (unchanged) |
| G-014 | Query-aware search snippets | no | NOT-VERIFIED (unchanged) |
| G-113 | Page-aware document search, sectioned | no | NOT-VERIFIED (unchanged) |
| G-123 | Citation is a verified location | no | NOT-VERIFIED (unchanged) |
| G-124 | Refuses to answer when corpus doesn't support one | yes | PARITY |
| G-138 | Find and replace | no | NOT-VERIFIED (unchanged) |
| G-144 | Undo/redo control on touch | yes | PARITY |
| G-147 | Nested tags | no | NOT-VERIFIED (unchanged) |
| G-148 | Unlinked mentions | no | NOT-VERIFIED (unchanged) |
| G-152 | Split view, two notes side by side | yes (flagged) | PARITY, flagged |
| G-156 | A real daily note | yes | PARITY |
| G-161 | Email-to-notebook | no | NOT-VERIFIED (unchanged) |
