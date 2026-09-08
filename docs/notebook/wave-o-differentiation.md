# Wave O §48 — the review loop, compared honestly

**The task, exactly as the directive words it:**

> "I have an investment thesis with source-backed supporting and opposing
> evidence. I want to review it periodically, understand what changed since last
> review, record my decision, and return later to see how my thinking evolved."

⛔ **The question is NOT "can they make reminders."** All three can, well. It is
whether the product knows *which thesis*, *which evidence*, *what changed*, and
*what the member decided last time*.

⛔⛔ **ONE EVIDENCE TIER PER PRODUCT PER ROW** (`lesson_one_evidence_tier_per_product`).
Every row states its tier: **MEASURED** (run this session, artefact on disk) ·
**VENDOR DOC** (the vendor's own current documentation) · **COMMUNITY DOC**
(third-party/plugin listing) · **NOT ASSESSED** (not tested, not documented —
*not* a claim of absence).

---

| # | dimension | UCT | Notion | Evernote | Obsidian | verdict |
|---|---|---|---|---|---|---|
| 1 | **Setup friction** | MEASURED — "Review thesis" sits on the thesis; nothing to create, link or configure | VENDOR DOC — a date property + reminder, on a database the member designed | VENDOR DOC — a reminder on a note | COMMUNITY DOC — a plugin plus a convention | **SUPERIOR** |
| 2 | **Context linking** | MEASURED — the review IS the thesis note's; ticker, evidence and status are already known | VENDOR DOC — relations exist, but the member builds and maintains the schema | VENDOR DOC — notebooks/tags only | COMMUNITY DOC — wikilinks, untyped by default | **SUPERIOR** |
| 3 | **Evidence awareness during review** | MEASURED — supporting/opposing counts, from typed stance edges | NOT ASSESSED for a stance model; a member could build select properties | NOT ASSESSED | NOT ASSESSED | **MATERIAL GAP** for them |
| 4 | **Review history as its own record** | MEASURED — a completed review is immutable, with outcome, member note, and thesis-version refs | VENDOR DOC — a completed task is a row that can be edited freely | VENDOR DOC — a checked reminder | COMMUNITY DOC — a markdown file | **SUPERIOR** |
| 5 | **Scheduling** | MEASURED — explicit next-review date, written through the canonical property path | VENDOR DOC — date properties, reminders, and **recurring templates** (repeat daily/weekly/monthly) | VENDOR DOC — reminders with dates | COMMUNITY DOC — plugin-dependent | **COMPETITIVE** — Notion's recurrence is genuinely ahead of ours |
| 6 | **"What changed since last review"** | MEASURED — deterministic counts from evidence `created_at`/`removed_at` and version rows | NOT ASSESSED — no documented mechanism; the search found none | NOT ASSESSED | NOT ASSESSED | **NOT COMPARABLE** |
| 7 | **Financial state integration** | MEASURED — the thesis carries a ticker; positions link through typed trade refs | VENDOR DOC — a relation to a manually maintained table | — | — | **SUPERIOR** |
| 8 | **Portability** | MEASURED — review history exports in the note's front matter | VENDOR DOC — Markdown/CSV export of database rows | VENDOR DOC — ENEX | COMMUNITY DOC — it is already markdown | **COMPETITIVE** — Obsidian's files are portable by construction |
| 9 | **Mobile** | MEASURED — 390×844 coarse pointer, every control ≥44px, hit-tested, announced | VENDOR DOC — mature native apps | VENDOR DOC — mature native apps | COMMUNITY DOC — mobile plugin support varies | **COMPETITIVE** at best; their apps are years older than ours |

---

## Honest summary

⭐ **Where UCT is genuinely ahead (rows 2, 3, 4, 6, 7):** the review knows *which
thesis*, *which evidence*, *what its stance was*, *what changed since last time*,
and *what the member decided before* — without the member designing a schema to
make any of that true. Row 6 is the one with no counterpart anywhere: a
deterministic answer to "what changed since I last looked at this" computed from
the member's own research chronology.

⛔ **Where UCT is behind, said plainly:**

- **Recurrence (row 5).** Notion has repeating templates; Wave O ships explicit
  dates only. A member who wants "review every quarter" must set each date.
- **Mobile maturity (row 9).** Ours is *correct* — measured, not asserted — but
  Notion and Evernote have had native apps for years.
- **Portability (row 8).** Obsidian's vault is plain files. Our export is good
  and it is still an export.

⛔ **What is NOT claimed:** rows 3 and 6 say **NOT ASSESSED** for competitors,
not "they cannot do it". Nobody measured whether a sufficiently determined Notion
user could build a stance model and a changed-since view with formulas and
automations. They probably could. The difference Wave O is claiming is that in
UCT **nobody has to** — and that the product, not the member's schema, is what
knows an investment thesis has opposing evidence.

## The distinction, in the directive's own shape (§49)

```
Notion : "Reminder: review NVDA."

UCT    : "NVDA thesis review is due.
          Since your last review:
            1 opposing evidence item added.
          Your thesis has not changed.
          Open Review."
```

⭐ And then — the part that matters — **the member decides what that means.**
UCT surfaces the facts and never the verdict.

---

## Sources

- Notion reminders + date properties (vendor): <https://www.notion.com/help/reminders> ·
  <https://www.notion.com/help/database-properties>
- Notion recurring templates (vendor): <https://www.notion.com/releases/2022-11-08>
- Evernote Web Clipper / reminders (vendor): <https://evernote.com/features/webclipper>
- Obsidian community plugins: <https://community.obsidian.md/plugins/obsidian-annotator>

UCT rows rest on this session's artefacts: `tools/wave_o_e2e_out/report.json`,
`tools/wave_o_mobile_out/report.json`, `tools/wave_o_perf_out/report.json`, and
the rails named in `docs/notebook/wave-o-closure.md`.
