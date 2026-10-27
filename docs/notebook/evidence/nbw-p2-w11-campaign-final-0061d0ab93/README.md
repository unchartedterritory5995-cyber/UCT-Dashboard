# Wave 11 final campaign evidence: w11-campaign-final-0061d0ab93

This is the raw evidence (R-RAW) from the final full run of the 50-member test campaign (Task 11.21 Step 4).
- App root: impl `0061d0ab93`, frozen.
- Campaign tool tree: `ca045805ce`.
- Sandbox: a unique `sbx-campaign-final-20261027T094932` data dir, run with `--block-outbound` and never against `C:\data`.

## What is committed here (small parts only)

| Path | What it is |
|---|---|
| `out/run.json` | the runner's run record |
| `out/results.jsonl` | one line per persona x viewport x input run, with step verdicts |
| `out/defects.jsonl` | raw runner findings (untriaged numbering) |
| `triage.md` | the verdict on every raw finding |
| `summary.md` | the persona x viewport pass/fail table with defect ids |
| `aggregate.txt` | totals |
| `logs/*.txt`, `logs/*.json` | data-dir name, heavy-lock status, PIDs, sandbox identity, the P49 `/api/auth/me` capture (a local sandbox member, not a real account) |

Headline (from the ledger):
- Runs: 240 PASS / 14 FAIL / 19 INCONCLUSIVE of 273.
- Steps: 1513 / 5 / 21 of 1539.
- Product defects open: 0. Console errors 0, page errors 0, overflow 0, axe critical 0.

Line endings were normalised to LF on commit. Nothing else was changed.

## What is NOT committed, and where it lives

The full evidence set (106,671,366 bytes, about 101.7 MiB) holds:
- the per-persona step screenshots (`out/Pnn/<viewport>-<input>/`);
- the sandbox and clock server logs (`out/sandbox-boot*.log`, `out/clock-boot*.log`, `out/integrity-boot*.md`);
- `logs/runner.log` and `logs/seed.log`;
- `triage-raw.json` and the `tools-used/` snapshot.

It was not committed because of its size. This repo is public, and screenshots and server logs do not belong in it.

It is kept locally on the owner's machine at:

`C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\5effcdc4-7e7d-42f4-a3df-67b99c63791b\scratchpad\campaign-run-final\`

That is a session scratchpad, so it is not durable. Copy it somewhere permanent if the screenshots are needed after this session.
