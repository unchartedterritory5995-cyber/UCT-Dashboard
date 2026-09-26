# Head-to-head benchmark: data sheet (the run form)

Copy this file to `runs/<run-id>/datasheet.md` for the sitting and fill it as you go. The method is
[`protocol.md`](protocol.md); the numbers come ONLY from the saved dumps, through
`tools/notebook_bench_report.py` -- never type a timing here.

## Header

| field | value |
|---|---|
| run id | |
| date, start and end time | |
| operator | |
| machine record | `runs/<run-id>/machine.json` (every `FILL` replaced) |
| `gate_box_lock` status at start (lock / load) | |
| Chrome version (clean profile, no extensions) | |
| Obsidian version | |
| Notion plan | |
| Evernote plan (Starter, bought by the controller today) | |
| UCT build (`/api/health`) and bench account | |
| corpus folder and `--verify` result | |
| probe sha256 (must equal protocol.md §1) | |

## Pre-flight (per app, before anything is timed)

| app | import finished (notes shown) | indexing wait | rare term finds its note | switcher title found | notes |
|---|---|---|---|---|---|
| notion | | | | | |
| evernote | | | | | |
| obsidian | | | | | |
| uct | | | | | |

## One row per saved dump

`Available MB` is `typeperf "\Memory\Available MBytes" -sc 1` before and after the round. The
selfTest reading is the PASS line's milliseconds.

| op | round | app | dump file | Available MB before | Available MB after | selfTest ms | attempts / samples | deviation (if any) |
|---|---|---|---|---|---|---|---|---|
| H1 | r1 | notion | `notion__H1__r1.json` | | | | | |

## Deviations

Anything that was not exactly as `protocol.md` says: a menu path that differed, a mis-click, a
reload, an app without a quick switcher, a paste that did not land, a selfTest FAIL and its retry.

## Close-out

| item | done |
|---|---|
| every dump saved under `runs/<run-id>/` | |
| `results.md` regenerated with the report tool | |
| Evernote Starter CANCELLED by the controller today (confirmation saved) | |
| corpus removed from the UCT bench account | |
