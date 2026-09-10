"""The saved TradingView probes must not drift away from their committed sources.

⛔⛔ WHY THIS EXISTS. `tools/visual_conformance/probes/saved-scripts.json` maps a
committed `.pine` file to a script SAVED IN THE OWNER'S TRADINGVIEW ACCOUNT, and
`tests/fixtures/vendor/saved-probe-integrity-2026-09-10.json` is the sweep that
checked, against the vendor, that the two still agree. Neither artifact had a
reader. **A capture whose bytes or roster do not match the committed source is
hard stop H6** — and until this file, nothing in the repo could notice the day a
probe was edited while its saved twin stayed behind.

⭐ WHAT THIS CAN AND CANNOT CHECK. The vendor half of the sweep needs a browser
and an authenticated session, so it cannot run here. The COMMITTED half can: if
a probe file is edited, its balanced-paren plot roster moves away from the number
the sweep recorded, and the recorded vendor roster is then describing a script
that no longer exists in this repo. That is exactly the drift H6 names, and it is
detectable with no network at all.

⛔ SO A RED HERE IS NOT "FIX THE NUMBER". It means the saved script and the
committed source have parted company, and the fix is to re-save the probe at
TradingView and re-run the sweep — then update the fixture from the new reading.
Editing the expected number to match the file is how the gate becomes a comment.
"""

import io
import json
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
PROBES = REPO / "tools" / "visual_conformance" / "probes"
SWEEP = REPO / "tests" / "fixtures" / "vendor" / "saved-probe-integrity-2026-09-10.json"
SAVED = PROBES / "saved-scripts.json"


def plot_roster(src):
    """The plot titles of a Pine source, by BALANCED-PAREN scan.

    ⛔⛔ NEVER A REGEX, and this is measured rather than stylistic:
    ``plot(str.contains(a, b) ? 1 : 0, "name")`` puts commas INSIDE argument one,
    so a regex that splits on commas mis-counts it. A roster under-count in this
    repo has already shipped twice — once from a regex, once from reading
    ``_metaInfo`` style-key order instead of ``plots`` order.
    """
    out, i = [], 0
    while True:
        j = src.find("plot(", i)
        if j < 0:
            return out
        if j > 0 and (src[j - 1].isalnum() or src[j - 1] in "._"):
            i = j + 5  # `hline(`/`fill(`-style suffix match, or `myplot(`
            continue
        line_start = src.rfind("\n", 0, j) + 1
        if src[line_start:j].lstrip().startswith("//"):
            i = j + 5  # a commented-out plot is not a plot
            continue
        k, depth, args, cur, instr = j + 5, 1, [], "", None
        while k < len(src) and depth:
            c = src[k]
            if instr:
                if c == instr:
                    instr = None
                cur += c
            elif c in "\"'":
                instr = c
                cur += c
            elif c == "(":
                depth += 1
                cur += c
            elif c == ")":
                depth -= 1
                if depth:
                    cur += c
            elif c == "," and depth == 1:
                args.append(cur)
                cur = ""
            else:
                cur += c
            k += 1
        args.append(cur)
        title = None
        for a in args[1:]:
            a = a.strip()
            if a.startswith('"') and a.endswith('"'):
                title = a[1:-1]
                break
        out.append(title)
        i = k


def _sweep_rows():
    return json.loads(io.open(SWEEP, encoding="utf-8").read())["rows"]


def _saved():
    d = json.loads(io.open(SAVED, encoding="utf-8").read())
    return d.get("scripts", d)


@pytest.mark.parametrize("row", _sweep_rows(), ids=lambda r: r["name"])
def test_a_saved_probe_still_matches_the_source_the_sweep_measured(row):
    """The committed roster must still be the one the vendor was checked against."""
    entry = _saved()[row["name"]]
    src_name = entry.get("sourceFile") or entry.get("probe") or entry.get("source")
    path = PROBES / src_name
    assert path.exists(), f"{row['name']}: {src_name} is gone"
    roster = plot_roster(io.open(path, encoding="utf-8").read())
    assert len(roster) == row["committedRoster"], (
        f"{row['name']}: {src_name} now declares {len(roster)} plots, but the "
        f"2026-09-10 sweep measured {row['committedRoster']} against the SAVED "
        f"TradingView script. The file and its saved twin have parted company — "
        f"re-save the probe and re-run the sweep. Do NOT edit the expected number.")
    assert all(t for t in roster), (
        f"{row['name']}: a plot with no title. Every capture reads values by "
        f"TITLE, so an untitled plot is a column nobody can name.")


def test_every_saved_script_is_covered_by_the_sweep():
    """⛔ A probe saved at TradingView and left out of the sweep is ungated.

    The sweep is the H6 check; a script that skips it is a capture source nobody
    has compared to its source.
    """
    saved, swept = set(_saved()), {r["name"] for r in _sweep_rows()}
    assert saved == swept, (
        f"saved-but-unswept: {sorted(saved - swept)}; "
        f"swept-but-not-saved: {sorted(swept - saved)}")


def test_the_sweep_CONTAINS_A_ROW_WHERE_THE_VENDOR_DISAGREES():
    """⭐⭐ THE NON-VACUITY CONTROL, and it is the point of the whole file.

    Every other row passes because the vendor's plot count equals the committed
    one. A sweep where that is true of EVERY row cannot be distinguished from a
    sweep that compares nothing — so it must contain at least one row where the
    two differ FOR A KNOWN REASON. `UCTPROBE_GB_BARSSINCE_2ARG` is that row: it
    declares three plots and TradingView answers with a ONE-plot failed stub,
    because its whole purpose is to be rejected (`ta.barssince` takes one
    argument; ours takes two, and the divergence row rests on that rejection).
    """
    rows = _sweep_rows()
    disagreeing = [r for r in rows if r["vendorPlots"] != r["committedRoster"]]
    assert disagreeing, (
        "every row agrees, so this sweep cannot be told apart from one that "
        "compares nothing. It must carry a script the vendor refuses.")
    for r in disagreeing:
        assert r["compiles"] is False, (
            f"{r['name']}: vendor roster {r['vendorPlots']} != committed "
            f"{r['committedRoster']} on a script that COMPILED. That is real "
            f"drift, not the deliberate control.")
        assert r["vendorPlots"] == 1, (
            f"{r['name']}: a failed Pine study carries a ONE-plot stub; "
            f"{r['vendorPlots']} means the failure signature itself has moved.")


def test_the_roster_scan_beats_the_regex_that_would_replace_it():
    """⛔ The guard that keeps the scanner honest.

    If a comma inside argument one did not break a naive split, the balanced-paren
    scan would be ceremony. It does, and this proves it on the exact shape the
    corpus contains — so the next person to 'simplify' this into a regex has a
    red test to read first.
    """
    src = 'plot(str.contains(syminfo.ticker, "/") ? 1 : 0, "N01_slash")\n'
    assert plot_roster(src) == ["N01_slash"]
    naive = src[src.find("plot(") + 5:].split(",")[1].strip()
    assert naive != '"N01_slash"', (
        "the naive comma split now agrees, so this control proves nothing")
