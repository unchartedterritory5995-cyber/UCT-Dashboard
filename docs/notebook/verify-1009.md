# Notebook verification, 2026-10-09

The owner asked, after meaning search and voice notes were armed: is everything tested, and
what is left? This records what was then run, on the live site and in a local sandbox, and what
it found. Raw evidence was committed before each summary.

## 1. Live site (production, smoke account)

Tool: `tools/notebook_prod_verify_live.py`. Evidence: `docs/notebook/evidence/verify-1009/live/`.
Every note the run created was removed through the product's own delete and checked gone (404);
the smoke account ended with 0 active notes.

| check | 1280 | 390 |
|---|---|---|
| Long-note Ask (the PLTR question that spans the whole note; fin-walk 8.2, K1) | PASS: 26.35, 24.85, both risks, the final rule, cited, the citation opens the note | PASS, same |
| Meaning search: the PRODUCTION sweep indexed the new notes (314 s after creation); a phrase sharing no word with the note finds it by meaning; plain search finds nothing | PASS, row labelled "Related by meaning" | PASS, same |
| Voice note: upload a recording, transcribe (5.7 s), AI-labelled summary, NVDA and TSLA, the action item, transcript in the saved note | PASS | the sheet opens; every button at least 44 x 44 (`voice-dialog-390-targets.json`) |

Two things to know about the run:

- Attempt 1 hit a 502 four seconds in, during another workstream's deploy swap, and stopped
  before any check. Its three notes were removed by hand (404 each); its log is kept under
  `attempt1-502/`. The tool now retries a 5xx on create and delete.
- The first 390 voice reading was an instrument miss: the walker waited for Transcribe, which
  renders only after a file is chosen. The sheet's buttons were measured separately and the
  walker now measures them itself.

## 2. Local sandbox (items the fin-walk never walked)

See `docs/notebook/verify-1009-sandbox.md` (branch `feat/notebook-verify-sbx-1009`).

## 3. Full test run

Pending at the time of writing; see section 4 when filled.
