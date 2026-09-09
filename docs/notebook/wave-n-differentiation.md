# Wave N §16 — the evidence chain, compared honestly

**The task, exactly as the directive words it:**

> "I captured a passage from external research. Now I want to use it as
> structured evidence for my investment thesis."

⛔ **The question is NOT "can a competitor link text to a page."** They all can.
It is whether the product **natively preserves the chain**:

```
SOURCE → CAPTURED EVIDENCE → SECURITY CONTEXT
       → SUPPORTING/OPPOSING STANCE → THESIS → LATER FINANCIAL REVIEW
```

⛔⛔ **ONE EVIDENCE TIER PER PRODUCT PER ROW.** A negative claim about a
competitor needs the same standard as a positive one about us
(`lesson_one_evidence_tier_per_product` — five false "we lack X" findings came
from breaking this). Every row below states its tier:

| tier | meaning |
|---|---|
| **MEASURED** | run in the product this session, artefact on disk |
| **VENDOR DOC** | the vendor's own current documentation |
| **COMMUNITY DOC** | a third-party/plugin listing, not a vendor guarantee |
| **NOT ASSESSED** | not tested and not documented — *not* a claim of absence |

---

## Row by row

### 1. Capture a selected passage (not the whole page)

| product | tier | finding |
|---|---|---|
| **UCT** | MEASURED | The capture dialog has a `Selected passage` field distinct from `Your note`, and the tier is explicit: `passage` stores what the member selected, `reference` stores title + URL only, and **`full_page` is REFUSED** — `web_capture.assert_permitted_tier` raises rather than silently downgrading. |
| Notion | VENDOR DOC | The official help page describes saving "any web page"; it does **not** document clipping a selection. Third-party clippers advertise highlight-only capture. |
| Evernote | VENDOR DOC | Web Clipper offers article / simplified article / selection clipping and in-clipper markup before save. |
| Obsidian | COMMUNITY DOC | Via community plugins (Annotator, PDF++, PDF Highlight Notes); highlight-to-note is a plugin capability, not a core one. |

**Not a differentiator.** Everyone can keep a passage.

### 2. Keep the source's words and the member's reading as two fields

| product | tier | finding |
|---|---|---|
| **UCT** | MEASURED | Two labelled controls at capture (`Selected passage` / `Your note`), two columns at rest (`captured_text` / `annotation`), two fields in the picker, two in the revisit sheet, two in the export (`passage` / `passage_note`), and attributed separately in the Ask answer — verified this session with an adversarial fixture where the source and the member's reading point in **opposite** directions. |
| Notion | VENDOR DOC | A clip becomes page content; commentary is typed into the same page body. No modelled distinction between quoted source and member commentary. |
| Evernote | VENDOR DOC | Annotation is markup **on** the clip (highlights, arrows) — the same object, not a separate field. |
| Obsidian | COMMUNITY DOC | Convention-based: a blockquote plus prose in one markdown file. Nothing enforces the boundary. |

⭐ **Differentiator, and the load-bearing one.** In every competitor the boundary
between "what the publisher said" and "what I think about it" is a *typographic
convention a human maintains*. In UCT it is a schema and it is checked on every
surface, so nothing downstream — including the model that answers questions
over the corpus — can present one as the other.

### 3. The captured passage carries a security (ticker) context

| product | tier | finding |
|---|---|---|
| **UCT** | MEASURED | A capture lands in a note that carries `ticker`, and the capture endpoint takes one directly; the entity resolves through `entity_master` with aliases, so Ask's "this security's research" scope reaches it. |
| Notion | VENDOR DOC | A database property can hold a ticker, but the clipper **cannot set property values at clip time** ("Not at the moment, unfortunately") — the member opens the page afterwards and fills it in. |
| Evernote | VENDOR DOC | Tags can be applied at clip time. A tag is a string, not a resolved security. |
| Obsidian | COMMUNITY DOC | Frontmatter/tags by convention. |

⭐ **Differentiator in degree.** Notion and Obsidian can hold a ticker *string*;
none of them resolve it to a security whose research is then a retrievable
scope.

### 4. SUPPORTING / OPPOSING as a first-class relationship

| product | tier | finding |
|---|---|---|
| **UCT** | MEASURED | `j2_thesis_evidence` with `stance ∈ {supports, opposes}` on the EDGE, one live edge per (thesis, target) enforced server-side, the same passage free to bear on other theses, and the stance never written back onto the passage. Verified this session end-to-end through the UI. |
| Notion | VENDOR DOC | A relation property plus a select property could encode this. **The member designs and maintains that schema**; nothing in the product knows what "opposing evidence" means. |
| Evernote | VENDOR DOC | No relation model. Notebooks and tags only. |
| Obsidian | COMMUNITY DOC | Wikilinks are untyped by default; typed relations exist via Dataview/Breadcrumbs conventions the member authors. |

⭐⭐ **The clearest differentiation.** Every competitor can *express* a stance if
the member invents a schema for it. None of them **hold** it, which is why none
of them can do row 5.

### 5. Counting sources honestly once a passage is curated

| product | tier | finding |
|---|---|---|
| **UCT** | MEASURED | A passage reachable both as research and through a thesis edge collapses to **ONE lineage** (`from_excerpt` shares the page's `lineage_key`; `_thesis_edge_evidence` marks an object already retrieved rather than appending one). Verified through the real Ask panel: one source cited, and the answer says "no other notes, pages, or excerpts were found". |
| Notion | NOT ASSESSED | Notion AI answers over a workspace; whether it de-duplicates a clip that is also referenced from a project page was not tested and is not documented. |
| Evernote | NOT ASSESSED | Same. |
| Obsidian | NOT ASSESSED | Depends entirely on the plugin answering. |

⛔ **Stated as NOT ASSESSED on purpose.** "Competitors double-count evidence"
would be exactly the fabricated negative the one-evidence-tier rule exists to
prevent. What is provable is that **UCT does not**, and that this is a property
of the retrieval model rather than of a prompt.

### 6. Truthful citation of a source that has no pages

| product | tier | finding |
|---|---|---|
| **UCT** | MEASURED | A web capture is cited as "Captured passage · Reuters: NVDA margins (reuters.com)" everywhere — picker, thesis, search, export, Ask — and **never** as `p.N`; a real PDF excerpt keeps `p.47`. Both verified this session. This wave had to fix four separate surfaces to make it true. |
| Notion / Evernote / Obsidian | — | Not applicable: none of them attach a page number to a web clip, so none of them can make this mistake. |

⛔ **Not a differentiator — a self-inflicted problem we removed.** Listing it as
a win would be dishonest. It earns a row only because it is what the wave spent
most of its effort on, and the reason is instructive: **the moment a product
models a paginated document and a web capture with one storage type, every
consumer that formats a citation becomes a place to get it wrong.**

### 7. Revisiting the evidence later, from the thesis

| product | tier | finding |
|---|---|---|
| **UCT** | MEASURED | The thesis row opens the passage, the member's note, the domain and the publisher's link — and for a real PDF it opens the viewer at p.47 instead. A purged source degrades in words ("source no longer available") rather than becoming a dead click. |
| Notion | VENDOR DOC | The clip is a page; a relation opens it. The URL property preserves provenance. |
| Evernote | VENDOR DOC | The note holds the source URL. |
| Obsidian | COMMUNITY DOC | A backlink or a plugin's deep link reopens the PDF at the highlight. |

**Parity on the common case.** Everyone can get you back to what you saved.

---

## Honest summary

**UCT is at parity on capture and revisit, and differentiated on the middle of
the chain — the part where a saved quote becomes reasoning about a position.**

The specific things that are ours:

1. **Source claim and member interpretation are separate objects**, enforced
   from capture through export and through the model's answer. Everywhere else
   this is a habit.
2. **Stance is a property of the relationship**, not of the passage or of a
   tag — so the same source can oppose one thesis and support another, and
   changing your mind is a recorded event rather than an edit to a quotation.
3. **Curation cannot manufacture corroboration.** Attaching a passage to a
   thesis makes it more relevant and no more corroborated, and the retrieval
   model enforces that rather than a prompt asking nicely.

⛔ **What is NOT a differentiator, said plainly:** capturing a highlight,
keeping a source URL, tagging, or getting back to what you saved. Every one of
these is table stakes and every competitor does them, several of them longer
and better than we do.

⛔ **What we have not shown:** anything about how competitors' AI features count
sources (rows 5). Those rows say NOT ASSESSED and must keep saying it until
somebody actually measures them.

---

## Sources

Competitor rows above rest on:

- Notion Web Clipper help (vendor): <https://www.notion.com/help/web-clipper>
- Evernote Web Clipper (vendor): <https://evernote.com/features/webclipper> ·
  <https://help.evernote.com/hc/en-us/articles/209125877-Evernote-Web-Clipper-Quick-Start-Guide>
- Evernote annotation (vendor): <https://help.evernote.com/hc/en-us/articles/208430588-Annotate-key-info>
- Obsidian Annotator (community plugin listing): <https://community.obsidian.md/plugins/obsidian-annotator>
- Obsidian PDF Highlight Notes (community plugin listing): <https://community.obsidian.md/plugins/pdf-highlight-notes>

UCT rows rest on this session's own artefacts: `tools/wave_n_e2e_out/report.json`
and its screenshots, and the rails named in `docs/notebook/wave-n-target-type-audit.md`.
