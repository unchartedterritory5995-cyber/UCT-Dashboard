# The Pine corpus — 21 real published scripts, unmodified

⭐ **THESE ARE TEST INPUTS, AND THEY ARE SOMEBODY ELSE'S CODE.** Every `.pine`
file here was fetched verbatim from a public repository and is byte-for-byte as
published, including its author line and its licence header. Nothing in this
directory is authored, edited, cleaned up or truncated by this repo.

**Attribution — author, repository and exact URL for every file — is in
`SOURCES.md` beside this note.** The licences the files themselves declare are
GPL-3.0 (6 files) and MPL-2.0 (2 files); the rest carry an author line and no
explicit licence.

## Why they are committed rather than fetched

⛔ **A GATE THAT NEEDS THE NETWORK IS A GATE THAT SKIPS.** The corpus decides
whether `pine.js` translates real Pine or only the examples its author thought
of, and `pine.corpus.test.js` compares every script's outcome against a
committed snapshot. Fetching them at test time would make the gate go green on a
DNS failure, which is the `lesson_gate_that_cannot_fail` shape.

## What they are NOT

- ⛔ **Not shipped.** Nothing under `tests/` reaches the Vite bundle; no product
  module imports this directory, and nothing here is served to a browser.
- ⛔ **Not a source of product code.** No line of any of these scripts was
  copied into `pine.js` or anywhere else. They are read, translated and thrown
  away by a test.

## ⚠️ An owner call, recorded rather than assumed

Committing third-party GPL-licensed files into this repository — even as inert
test fixtures that are never distributed — is a licensing decision, and it is
not the decision of the task that added them. It is written down here so that it
is a decision somebody made rather than something that happened.

**Reversing it costs one command and one consequence:** delete this directory and
`pine.corpus.test.js` fails because its inputs are gone. ⛔ Do NOT make that test
skip when the directory is absent — a corpus gate that passes with no corpus is
worse than no gate, and re-fetching the scripts from the URLs in `SOURCES.md`
restores it exactly.
