# Wave 10 lane WH — the production pass for scorecard clause 12a

Raw evidence committed first (R-RAW): `run.json` (raw step-by-step record, dumped after
every step), `run.log` (console transcript, no credentials), three screenshots,
`railway-log-excerpt.txt` (the production traceback, read via `railway logs --service
web`, read-only), `cleanup-verify.json` (an independent read-back confirming cleanup).
This file interprets those against the clause wording and states plainly what it does
NOT prove.

## What the scorecard owed

`docs/notebook/parity-scorecard.md` §12, clause "writing help with provenance": **NOT
MEASURED** — "the panel is live with provenance railed, and autofill is built (G-165);
no output has been observed in a browser: no sandbox holds a model key. Owed: a pass as
bench@ on production, where the gate is armed."

## What ran

`tools/notebook_wh_writing_help_prod_check.py`, one production run, `2026-09-29
21:12:58–21:13:14 UTC`, against `https://uctintelligence.com`. It signs in as
`bench@uctintelligence.internal` in its own Playwright Chromium context (never the
owner's Chrome, never the extension — `hub_nav_smoke.py`'s login idiom), reads
`/api/auth/me` before acting, creates a note, opens Writing help, asks for one action,
and records what the panel's own DOM shows.

## Clause-by-clause reading

**The account check** — MET. `run.json` step `account_check`: HTTP 200, `email:
"bench@uctintelligence.internal"`, `domain: "uctintelligence.internal"`, local part
`"bench"`, `role: "member"`, `paid_equiv: true`. The script asserts this BEFORE any
action and stops on a mismatch (it did not stop here).

**The panel is reachable and opens** — MET. `01-note-open.png` / `02-panel-open.png`
and `run.json` steps `note_open` / `panel_open` / `action_requested`: the "Writing help"
toolbar button rendered (confirms `notebook_writing_help_enabled` is true on the access
payload AND `isPaid` is true for this account — both conditions `writingHelpOn` in
`NoteEditorPage.jsx` requires), the panel opened as a `role="dialog"` named "Writing
help", and "Rewrite shorter" + "Write it" were clickable.

**Output observed** — NOT MET, this run. `03-draft-result.png` and `run.json` step
`draft_result`: the panel's own `[role="alert"]` rendered the product's own refusal
sentence, *"Something went wrong writing that. Nothing was changed in your note."*
(`WH_MESSAGES.failed` in `writingHelpStream.js`). No draft text, no provenance line, no
insert door were reached — the run stopped honestly rather than working around the
refusal (rule 5 of the brief: report a refusal, never route around it).

**Root cause, read not guessed** — `railway-log-excerpt.txt`, read via `railway logs
--service web` (read-only; this did NOT spend a second writing-help call): the server's
own `except Exception` handler around `wh.stream_text(kwargs)`
(`api/routers/notebook_writing_help.py:195-199`) caught

```
anthropic.BadRequestError: Error code: 400 - {'type': 'error', 'error':
{'type': 'invalid_request_error', 'message': 'Your credit balance is too low to
access the Anthropic API. Please go to Plans & Billing to upgrade or purchase
credits.'}, 'request_id': 'req_011CfYRMefWQiVtxUeJhEN7U'}
```

This is a production **Anthropic account billing exhaustion**, not a defect in the
writing-help feature, not a defect in `NOTEBOOK_WRITING_HELP_ENABLED`'s gate, and not an
artifact of this probe. The request reached the model provider (the reservation,
`begin_stream` slot and SSE `start` frame all succeeded — the panel showed the "Rewrite
shorter" choice and started writing before the failure) and the provider refused it at
billing, not at request shape or auth. **Every Anthropic-backed surface on production
shares this client and this key (`note_ask._async_client()` — Ask, Compass, writing
help, catalyst synthesis, the wire, COT narratives, …), so this is very likely blocking
more than writing help right now.** Owner/billing action, not a code lever this lane
owns.

**Provenance shown** — NOT OBSERVED this run, for the reason above. Read from source
instead (not a substitute for the browser observation still owed): the panel's `start`
SSE event carries `{model, action, instruction}` (`notebook_writing_help.py:168-169`),
and on Accept the client writes exactly those onto the inserted `askInsert` node's
`data-action` / `data-model` attrs (`askInsertNode.jsx`), which `AskInsertView.jsx`
renders as the label *"Compass · Rewrite · claude-sonnet-5 · HH:MM"* plus an
`aria-label="Written with Compass writing help: …"` on the block and a `title="Asked:
…"` — a real, wired provenance surface, unexercised by this run because the model call
itself failed upstream of it.

**Insert-on-accept door** — NOT OBSERVED this run (the panel never reached `status:
'ready'`, so no Accept button ever rendered to test). `acceptWritingHelp` in
`writingHelp.js` is a single document write gated on Accept, with `discard`/`Cancel`
removing nothing because nothing was ever added — read from source, not measured live
here.

**Cleanup** — MET. The step that failed was before any document write, so there was
nothing to undo in the note body; the note itself still had to be removed. The script's
`finally` fired a best-effort call to the product's own `DELETE
/api/j2/notes/{note_id}` (the same endpoint `journal_two.py:3455`'s `delete_note_endpoint`
serves, and the same one the UI's More → Delete → confirm button calls) —
`run.json` step `best_effort_cleanup: ok=true`. Independently re-verified in a
**separate** short-lived session (`cleanup-verify.json`, no writing-help call made):
gone from `GET /api/j2/notes?...&deleted=false` (`live_ids: []`), present in `GET
/api/j2/notes?...&deleted=true` (`trash_ids: [<note_id>]`), and a direct `GET
/api/j2/notes/{id}` now answers **404**. That session ended with `POST
/api/auth/logout` (200). Per CLAUDE.md's rule for `bench@`, this is a soft delete
(30-day trash retention, `TRASH_RETENTION_DAYS` in `notes.py`) — the account holds no
LIVE state, which is the invariant the rule protects; it is not a hard purge, and none
was owed.

## What this does NOT prove

- It does not prove writing help is broken in the ordinary sense (wrong prompt, wrong
  gate, wrong model name) — the model name (`claude-sonnet-5`) and the request shape
  reached the provider; the provider refused on billing. A code fix cannot address this.
- It does not observe the output text, the rendered provenance line, or the insert door
  in a live browser — those remain **NOT MEASURED** pending a re-run once the Anthropic
  account has credit. Read-from-source descriptions above are not a substitute and are
  labelled as such.
- It is one run. Per the task's "One pass… do not loop it" rule, this script was not
  re-run against production after the failure to try for a cleaner result — retrying to
  get past a billing block would not have produced a different outcome and would have
  spent a second charge attempt for no reason.
- The `railway logs` read is a one-time, read-only diagnostic taken after the failure
  (to establish root cause honestly rather than guess); it made no additional call to
  the writing-help endpoint and spent no additional model tokens.

## Next step, owned outside this lane

Restore Anthropic API credit on the production account, then re-run
`tools/notebook_wh_writing_help_prod_check.py --out
docs/notebook/proof/wh-<next-date>` once, exactly as this run did. If it completes, the
new `run.json` / `provenance-dom.json` / `inserted-block.html` / screenshots become the
clause's MET evidence; this run stands as the account-check + panel-reachability
evidence and the (unrelated-to-code) root-cause finding.
