# Benchmark runs

One directory per sitting: `runs/<run-id>/`, holding that sitting's `machine.json` (a filled copy
of `../machine.json`) and one dump per app, op and round, saved exactly as the probe printed it:

    runs/<run-id>/<app>__<op>__r<round>.json      e.g.  runs/2026-10-03-a/notion__H4__r1.json

`<app>` is one of `notion`, `evernote`, `obsidian`, `uct`; `<op>` one of the ids in
`../protocol.md` (H1 … H9, H2-full, H3-full). The automated UCT run keeps its own dumps beside
its summary JSON and enters the report through `--uct-auto`, never through this directory.

⛔ Nothing here is typed by hand. `tools/notebook_bench_report.py` reads these files and writes
`../results.md`; a dump it refuses is listed there with the reason. Until the owner's first sitting
this directory holds only this file, and every competitor cell in `../results.md` reads
**NOT MEASURED**.
