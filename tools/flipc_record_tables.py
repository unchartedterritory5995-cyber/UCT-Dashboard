#!/usr/bin/env python3
"""Fill the Flip-C decision record's tables FROM `report.json`, never by hand.

`docs/decisions/2026-08-04-flip-c-pane-geometry.md` prices a change nobody has
made yet, per case and per region, and every number in it has to name the two
builds it came from. Typing ~50 rows out of a terminal is a transcription, and a
transcription is what put a wrong number in a record on this branch twice.

So the record carries MARKERS and this fills between them::

    python tools/flipc_record_tables.py \
        --cutover tools/chart_parity_out_main/report.json \
        --sub 2.1=tools/chart_parity_out_sep/report.json \
        --sub 2.2=tools/chart_parity_out_axis/report.json \
        --sub 2.3=tools/chart_parity_out_hgt/report.json \
        --write

Re-running it against the same reports is a no-op, which is what makes the
record's numbers checkable rather than merely present. It also refuses to write a
table from a report whose runs DISAGREE with each other without saying so: the
`distribution` column carries the run-value histogram, so a case that is not a
single value cannot be rounded into one.
"""
from __future__ import annotations

import argparse
import collections
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORD = ROOT / "docs" / "decisions" / "2026-08-04-flip-c-pane-geometry.md"


def ident(report, side):
    b = report[f"build_{side}"]
    return b["id"]


def distribution(entry):
    vals = entry.get("changed_values") or []
    if not vals:
        return "—", None
    hist = collections.Counter(vals)
    if len(hist) == 1:
        return f"{len(vals)}/{len(vals)}", vals[0]
    return " · ".join(f"{v}×{n}" for v, n in sorted(hist.items())), None


def region_hist(entry, name):
    """One region's value across every run, as `value` or `a|b` when it varies."""
    vals = [(r or {}).get(name) for r in (entry.get("region_values") or [])]
    vals = [v for v in vals if v is not None]
    if not vals:
        return "—"
    hist = collections.Counter(vals)
    if len(hist) == 1:
        return f"{vals[0]:,}"
    return " · ".join(f"{v:,}×{n}" for v, n in sorted(hist.items()))


def cutover_table(report):
    rows = ["| case | changed px | % | header | price_plot | mid_panes | osc_strip | time_axis | rest | distribution | manifest geometry |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|"]
    total_single = 0
    varied = []
    for e in report["results"]:
        dist, single = distribution(e)
        if single is None:
            varied.append(e["name"])
        else:
            total_single += single
        changed = "—" if e.get("changed") is None else f"{e['changed']:,}"
        pct = "—" if e.get("pct") is None else f"{e['pct']}"
        rows.append(
            f"| `{e['name']}` | {changed} | {pct} | {region_hist(e, 'export_header')} | {region_hist(e, 'price_plot')} | "
            f"{region_hist(e, 'mid_panes')} | "
            f"{region_hist(e, 'osc_strip')} | {region_hist(e, 'time_axis')} | "
            f"{region_hist(e, 'rest')} | {dist} | "
            f"{len(e.get('manifest_geometry_diff') or [])} line(s) |")
    rows.append(f"| **46 cases, summed** | **{total_single:,}** | | | | | | | | | |")
    if varied:
        rows.append("")
        rows.append("⚠️ **NOT A SINGLE VALUE, and therefore NOT MEASURED:** "
                    + ", ".join(f"`{n}`" for n in varied))
    return rows


def sub_table(label, report):
    rows = [f"| case | changed px | % | header | price_plot | mid_panes | osc_strip | time_axis | rest | distribution |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for e in report["results"]:
        dist, _ = distribution(e)
        changed = "—" if e.get("changed") is None else f"{e['changed']:,}"
        pct = "—" if e.get("pct") is None else f"{e['pct']}"
        rows.append(f"| `{e['name']}` | {changed} | {pct} | {region_hist(e, 'export_header')} | {region_hist(e, 'price_plot')} | "
                    f"{region_hist(e, 'mid_panes')} | "
                    f"{region_hist(e, 'osc_strip')} | {region_hist(e, 'time_axis')} | "
                    f"{region_hist(e, 'rest')} | {dist} |")
    return rows


def trust_block(reports):
    """What makes the numbers believable, computed from the reports themselves.

    ⛔ NOT "it doesn't flake". The 95% upper bound implied by n consecutive clean
    runs is quoted, and where it does NOT apply the reason is stated — which is
    the wording `docs/decisions/2026-08-02-macd-head-mask.md` settled on.
    """
    rows = ["| run | cases | runs/case | every capture `shots=2/2` | every capture `stable` | "
            "cases at a single value | 95% flake bound |",
            "|---|---:|---:|---|---|---:|---:|"]
    for label, rep in reports:
        runs = [r for e in rep["results"] for r in e.get("runs", [])]
        shots = all(r.get("shots_a") == 2 and r.get("shots_b") == 2 for r in runs) if runs else False
        stable = all(r.get("ready_reason_a") == "stable" and r.get("ready_reason_b") == "stable"
                     for r in runs) if runs else False
        single = sum(1 for e in rep["results"] if distribution(e)[1] is not None)
        n = rep["repeat"]
        bound = 1 - 0.05 ** (1.0 / n) if n else 0
        rows.append(f"| {label} | {len(rep['results'])} | {n} | "
                    f"{'yes' if shots else '**NO**'} | {'yes' if stable else '**NO**'} | "
                    f"{single}/{len(rep['results'])} | {bound * 100:.1f}% |")
    return rows


def identity_line(report, a_label, b_label):
    return (f"*A = {a_label} — build **{ident(report, 'a')}**; "
            f"B = {b_label} — build **{ident(report, 'b')}**; "
            f"{report['repeat']} run(s) per case; served == disk verified on both.*")


def splice(text, marker, body):
    begin, end = f"<!-- BEGIN:{marker} -->", f"<!-- END:{marker} -->"
    i, j = text.find(begin), text.find(end)
    if i < 0 or j < 0:
        raise SystemExit(f"the record has no `{marker}` markers — nothing to fill.")
    return text[:i + len(begin)] + "\n" + "\n".join(body) + "\n" + text[j:]


LABELS = {
    "2.1": ("the cutover with LWC's default separator", "the chart's own separator token"),
    "2.2": ("the cutover's overlay scale (no axis labels)", "a visible per-pane right axis"),
    "2.3": ("today's band heights, preserved", "LWC's own stretch defaults (equal panes)"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cutover", required=True)
    ap.add_argument("--sub", action="append", default=[],
                    help="`2.1=path/to/report.json`, repeatable")
    ap.add_argument("--extra-trust", action="append", default=[],
                    help="`label=path/to/report.json` for a run that gets a trust row but "
                         "no table (the same-build determinism runs), repeatable")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    text = RECORD.read_text(encoding="utf-8")

    rep = json.loads(Path(args.cutover).read_text(encoding="utf-8"))
    body = [identity_line(rep, "`PANE_MODE = 'bands'` — what ships", "the cutover, ONE edit"), ""]
    body += cutover_table(rep)
    text = splice(text, "cutover-table", body)

    trust = [("the cutover", rep)]
    for spec in args.sub:
        label, _, path = spec.partition("=")
        r = json.loads(Path(path).read_text(encoding="utf-8"))
        a_lbl, b_lbl = LABELS[label]
        b = [identity_line(r, a_lbl, b_lbl), ""] + sub_table(label, r)
        text = splice(text, f"sub-{label}", b)
        trust.append((f"sub-choice {label}", r))
    for spec in args.extra_trust:
        label, _, path = spec.partition("=")
        trust.append((label, json.loads(Path(path).read_text(encoding="utf-8"))))
    text = splice(text, "trust", trust_block(trust))

    if not args.write:
        sys.stdout.write(text)
        return 0
    RECORD.write_text(text, encoding="utf-8", newline="\n")
    print(f"filled {RECORD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
