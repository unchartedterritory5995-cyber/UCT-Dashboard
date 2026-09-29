# Production writing-help check, run b (2026-09-29, 22:24Z)

Clause **12a** (writing help with provenance), run on production after the
Anthropic API credit was restored. The first run (`../wh-2026-09-29/`) found the
credit exhausted, so no output could be observed there.

Tool: `tools/notebook_wh_writing_help_prod_check.py --out docs/notebook/proof/wh-2026-09-29b`
Account: `bench@uctintelligence.internal`, a member (`run.json` step `account_check`).

## What was observed (all cited to `run.json`)

| Step | Result |
|---|---|
| `output_observed` | "Rewrite shorter" returned 148 characters. The fine print read "Nothing is added to your note until you choose Accept. Written by claude-sonnet-5." (`03-draft-result.png`) |
| `accept_clicked` | `document_changed_by_accept: true`, `ask_inserts_before: 0` |
| `insert_confirmed` | The inserted block is labelled "Compass · Rewrite · claude-sonnet-5 · 17:24", with aria-label "Written with Compass writing help: Rewrite — shorter" (`04-accepted.png`, `inserted-block.html`, `provenance-dom.json`) |
| `delete_clicked` | ok (`05-after-delete.png`) |

**Verdict for 12a: output, provenance and insert-on-accept were all observed on production.**

## The run exited 1, and the cause was the check, not the product

The probe's `cleanup_confirmed` step read `gone_from_live_list=False, in_trash=False`
once, 1.5 s after the delete. Both reads were HTTP 200, and the step looked the
note up by a title search. The `finally` block then ran its best-effort DELETE
(ok).

An independent read-back a few minutes later (`cleanup-verify.json`) found the
note fully cleaned up:

- a direct GET on the note returned **404**;
- the note is **absent from the live list**;
- the note is **present in the trash**.

The test note is removed. Two explanations fit the probe's reading: a race
against the delete, or a delay in the title-search index. This run cannot tell
them apart. **Follow-up:** the probe should look the note up by id rather than by
title search, and poll rather than read once.

## Known defect in the raw artifact

The strings in `run.json` are double-encoded ("â€”" where "—" belongs). The
probe's own text is affected; the product's is not, as the screenshots and
`inserted-block.html` show. **Follow-up:** fix the probe's writer encoding.
