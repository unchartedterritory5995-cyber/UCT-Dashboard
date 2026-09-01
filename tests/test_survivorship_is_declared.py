"""The universe is a roster of survivors, and the artifact must say so.

⛔ THE OBVIOUS SUSPECT IS INNOCENT, which is why this rail names it. Measured
2026-09-01: `load_universe` reads tickers at the latest `snapshot_date`, so a
row that stopped being rebuilt is skipped — and that is SEVEN tickers out of
3,714, 0.2%. Negligible. An auditor who checks the stale-stamp mechanism and
finds it small has not found the bias; they have found the wrong mechanism.

⛔⛔ THE REAL ONE IS UPSTREAM. Membership comes from
`api/data/cap_universe.json`, a static git-tracked list that NOTHING IN THE REPO
WRITES — no generator, no refresh, no as-of date. It is a roster of companies
that exist now, and the bars reach back ~3,000 sessions. Every company that
listed and vanished inside that window is absent entirely, history and all.

⚠️ AND THE SIGN IS UNKNOWN, not merely unmeasured. Delisting is not one event:
an acquisition at a premium leaves after a move that is a WIN on the long
metric; a failure leaves after a LOSS on the long metric and a WIN on the short.
Excluding both removes wins and losses from both arms, and the mix over twelve
years is a number this repo does not hold. Claiming a direction would be the
easy mistake.
"""
import sys, pathlib, json, sqlite3
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import lift_ledger as ll

ROOT = pathlib.Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "api/data/cap_universe.json"


def test_the_limitation_travels_with_the_numbers():
    lim = ll.load().get("limitations") or ""
    assert "SURVIVORSHIP" in lim, (
        "the ledger no longer declares that its universe is a roster of "
        "survivors — a reader cannot infer that from any row")
    # ⛔ CASE-INSENSITIVE. The note shouts its headings, and a rail that pins
    # the casing of prose fails on a reword that changed nothing — which is a
    # rail training its author to fight it rather than read it.
    low = lim.lower()
    for must in ("0.2%", "cap_universe.json", "not clean"):
        assert must.lower() in low, (
            f"the survivorship note lost {must!r}: it must carry the innocent "
            f"suspect, the real mechanism, AND the admission that the sign is "
            f"unknown — any one alone misleads")


def test_the_universe_list_still_has_no_generator():
    """⭐ THE CLAIM THAT MAKES IT STRUCTURAL. If something started writing this
    list — a dated, point-in-time roster — the limitation would need rewriting
    rather than inheriting."""
    writers = []
    for d in ("api", "tools", "scripts"):
        base = ROOT / d
        if not base.exists():
            continue
        for f in base.rglob("*.py"):
            if "__pycache__" in f.parts:
                continue
            src = f.read_text(encoding="utf-8", errors="ignore")
            if "cap_universe" not in src:
                continue
            # a WRITE would pair the name with an output call
            for line in src.splitlines():
                if "cap_universe" in line and any(
                        w in line for w in ("json.dump", "write_text",
                                            'open(', "w+", "dump(")):
                    if '"w"' in line or "'w'" in line or "json.dump" in line:
                        writers.append(f"{f.name}: {line.strip()[:80]}")
    assert not writers, (
        f"something now writes cap_universe.json: {writers}. If it has become "
        f"a generated, dated roster the survivorship note is stale — re-derive "
        f"it rather than leaving the old wording in place.")


def test_the_roster_is_large_enough_that_its_composition_matters():
    """⛔ NON-VACUITY. A tiny universe would make this a different problem."""
    names = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    assert isinstance(names, list) and len(names) > 3000, (
        f"cap_universe holds {len(names) if isinstance(names, list) else '?'} "
        f"entries — the limitation's arithmetic assumes a few thousand")


def test_the_stale_stamp_exclusion_is_still_small():
    """⭐ THE NUMBER THAT REDIRECTS THE AUDITOR. If this ever grows, the
    innocent suspect stops being innocent and the note must change."""
    from api.services.screener import snapshot_db
    path = snapshot_db.get_db_path()
    if not pathlib.Path(str(path)).exists():
        pytest.skip("no local screener.db to measure against")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "select snapshot_date, count(*) from screener_rows "
            "group by snapshot_date").fetchall()
    except sqlite3.OperationalError:
        pytest.skip("screener_rows not present in this database")
    finally:
        con.close()
    if not rows:
        pytest.skip("screener_rows is empty")
    total = sum(c for _, c in rows)
    newest = max(rows, key=lambda r: r[0])[1]
    excluded_pct = 100.0 * (total - newest) / total
    assert excluded_pct < 5.0, (
        f"{excluded_pct:.1f}% of rows are no longer on the latest snapshot — "
        f"the stale-stamp mechanism is no longer negligible and the ledger's "
        f"survivorship note, which calls it 0.2% and innocent, is now wrong")
