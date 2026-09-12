"""⛔⛔ THE WINDOW RAIL ON THE VENDOR CAPTURES — owner ruling, 2026-09-12.

    Every vendor capture records `bars_loaded` and asserts it against the
    script's largest declared window before the read. Below that window the
    capture is WINDOW_TRUNCATED — not void — and its window-dependent columns
    are excluded from comparison.

The rule exists because a capture that is short of the window still LOOKS like a
measurement: every value is a real number TradingView drew, the spread control
passes, and the only thing wrong is that the script was answering a question
about less history than it declares. `tools/vendor_window.py` carries the
forensics; this file is the enforcement.

⭐ WHAT MAKES THIS A RAIL RATHER THAN A TRANSCRIPTION CHECK: it never reads the
fixture's own arithmetic and agrees with it. `largest_declared_window`, the
verdict and the excluded set are all RE-DERIVED here from the cross-lane oracle
and compared against what the fixture claims, so a capture cannot certify
itself. The one number the fixture is the sole authority on is `bars_loaded`,
which is an observation of the rig and nothing else can supply it.
"""

from __future__ import annotations

import hashlib
import io
import json

import pytest

from tools import vendor_window as vw

ROOT = vw.ROOT
VENDOR = ROOT / "tests" / "fixtures" / "vendor"
MEMBER = ROOT / "tests" / "fixtures" / "member"

REQUIRED_KEYS = ("script", "script_sha256", "bars_loaded", "largest_declared_window",
                 "verdict", "excluded_from_comparison")

# ⛔⛔ A CLOSED LIST, AND IT SHRINKS. These captures were taken before the ruling
# and their rig depth was never read, so `bars_loaded` cannot be recovered from
# the artifact — only from the chart, on another visit. They are allowed to sit
# at UNMEASURED; nothing else is, and a capture taken after 2026-09-12 that
# lands here fails this rail by name. Delete the entry the moment the depth is
# measured — do not add to it.
PREDATES_THE_MEASUREMENT = frozenset({
    "uncharted-volume-v2-spy-1d-2026-09-12.json",
})


def _member_shas():
    """`{sha256 -> 'member/<name>'}` for every script a capture could have run."""
    out = {}
    for f in sorted(MEMBER.glob("*.pine")):
        out[hashlib.sha256(f.read_bytes()).hexdigest()] = "member/" + f.name
    return out


def captures_of_known_scripts():
    """Vendor captures that RECORD the sha of a member script they ran.

    ⭐ The link is the receipt, not the filename. The capture procedure already
    requires the editor buffer to be hashed at the write, so any capture taken
    correctly names its script in a way no rename can break — and one that does
    not record a receipt is outside this rail by construction, which is a gap
    the procedure closes rather than a hole here.
    """
    shas = _member_shas()
    found = []
    for f in sorted(VENDOR.glob("*.json")):
        text = f.read_text(encoding="utf-8")
        for sha, script in shas.items():
            if sha in text:
                found.append((f, script, json.loads(text)))
                break
    return found


def _spread_control_titles(doc):
    """Every column the capture recorded a per-series reading for."""
    titles = set()

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "spread_control" and isinstance(v, dict):
                    titles.update(t for t in v if not t.startswith("_"))
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(doc)
    return titles


def test_the_sweep_finds_the_captures_it_is_supposed_to_govern():
    """Non-vacuity. A rail over an empty set passes for the wrong reason."""
    found = captures_of_known_scripts()
    names = {f.name for f, _, _ in found}
    assert "uncharted-volume-v2-spy-1d-2026-09-12.json" in names
    assert "uncharted-volume-v2-agen-1d-hve-2026-09-12.json" in names
    # And the receipt is what did the finding: every match names a real script.
    for _, script, _ in found:
        assert (ROOT / "tests" / "fixtures" / script).exists()


def test_the_sha_link_is_load_bearing_and_not_a_filename_coincidence():
    """Control: strip the receipt and the capture stops being governed."""
    shas = _member_shas()
    f = VENDOR / "uncharted-volume-v2-agen-1d-hve-2026-09-12.json"
    text = f.read_text(encoding="utf-8")
    hit = [s for s in shas if s in text]
    assert len(hit) == 1, "the capture should name exactly one member script"
    blinded = text.replace(hit[0], "0" * 64)
    assert not any(s in blinded for s in shas)


@pytest.mark.parametrize("fixture", [f.name for f, _, _ in captures_of_known_scripts()])
def test_every_vendor_capture_carries_a_window_check(fixture):
    doc = json.load(io.open(VENDOR / fixture, encoding="utf-8"))
    wc = doc.get("window_check")
    assert isinstance(wc, dict), (
        f"{fixture}: no `window_check`. Owner ruling 2026-09-12 — a capture "
        "states the depth it was read at, or its numbers cannot be told apart "
        "from a truncated window's.")
    missing = [k for k in REQUIRED_KEYS if k not in wc]
    assert not missing, f"{fixture}: `window_check` is missing {missing}"


@pytest.mark.parametrize("fixture", [f.name for f, _, _ in captures_of_known_scripts()])
def test_the_window_check_is_the_one_the_oracle_derives(fixture):
    """The fixture may not certify itself: recompute and compare."""
    doc = json.load(io.open(VENDOR / fixture, encoding="utf-8"))
    wc = doc["window_check"]
    derived = vw.check(wc["bars_loaded"], wc["script"])

    assert wc["largest_declared_window"] == derived["largest_declared_window"], (
        f"{fixture}: records a largest window of {wc['largest_declared_window']} "
        f"while the cross-lane oracle reads {derived['largest_declared_window']}. "
        "The oracle is the authority; a transcribed number has drifted.")
    assert wc["verdict"] == derived["verdict"], (
        f"{fixture}: claims {wc['verdict']} at {wc['bars_loaded']} bars against a "
        f"{derived['largest_declared_window']}-bar window; the rule says "
        f"{derived['verdict']}.")
    assert sorted(wc["excluded_from_comparison"]) == derived["excluded_from_comparison"], (
        f"{fixture}: excludes {sorted(wc['excluded_from_comparison'])}, derivation "
        f"says {derived['excluded_from_comparison']}.")

    # The receipt must hash the script the window was derived from.
    named = ROOT / "tests" / "fixtures" / wc["script"]
    assert hashlib.sha256(named.read_bytes()).hexdigest() == wc["script_sha256"], (
        f"{fixture}: `script_sha256` is not the sha of `{wc['script']}` as it "
        "stands today, so the window derived from that file describes different "
        "bytes than the capture ran.")


@pytest.mark.parametrize("fixture", [f.name for f, _, _ in captures_of_known_scripts()])
def test_the_oracle_speaks_for_every_column_the_capture_read(fixture):
    """⛔ An absent title is not a zero-window title.

    The oracle stores distinct TREES, so a column can be missing from it. Read
    as `window 0` that column would be silently admitted to every comparison at
    every depth — an absence turned into a fact, which is the failure mode this
    repo keeps paying for.
    """
    doc = json.load(io.open(VENDOR / fixture, encoding="utf-8"))
    wc = doc["window_check"]
    windows = vw.declared_windows(wc["script"])
    uncovered = vw.uncovered(_spread_control_titles(doc), windows)
    assert not uncovered, (
        f"{fixture}: the oracle declares no window for {uncovered}. Walk those "
        "trees before this capture's columns can be compared.")


@pytest.mark.parametrize("fixture", [f.name for f, _, _ in captures_of_known_scripts()])
def test_unmeasured_is_allowed_only_where_it_is_already_named(fixture):
    doc = json.load(io.open(VENDOR / fixture, encoding="utf-8"))
    wc = doc["window_check"]
    if wc["verdict"] != vw.UNMEASURED:
        return
    assert fixture in PREDATES_THE_MEASUREMENT, (
        f"{fixture}: UNMEASURED, and not one of the captures that predate the "
        "ruling. Read `bars_loaded` off the rig — it is one probe — rather than "
        "widening the list.")
    assert wc.get("_why_unmeasured"), (
        f"{fixture}: UNMEASURED with no reason recorded. The next reader has to "
        "know whether the depth is unknown or merely untranscribed.")


def test_the_grandfather_list_names_only_files_that_exist():
    """A stale entry is a hole: it would excuse a capture nobody is looking at."""
    for name in PREDATES_THE_MEASUREMENT:
        assert (VENDOR / name).exists(), name + " is listed and does not exist"


def test_a_truncated_capture_is_marked_and_loses_only_its_short_columns():
    """⭐ THE CONTROL, ON THE DEPTHS THAT ACTUALLY HAPPENED.

    The AGEN study loaded 1,003 bars on add and 400 after a timeframe change
    before the capture forced 4,066. Both are real readings off the rig, so this
    is the rule applied to the two captures that were nearly taken.
    """
    windows = vw.declared_windows("member/uncharted-volume-v2.pine")

    verdict, excluded = vw.classify(1003, windows)
    assert verdict == vw.WINDOW_TRUNCATED
    assert excluded == ["HVE Trigger"], (
        "at 1,003 bars only the 2,751-bar column is unanswerable; the 50-bar "
        "columns are as good as they are at any depth")

    verdict, excluded = vw.classify(400, windows)
    assert verdict == vw.WINDOW_TRUNCATED
    assert excluded == ["HVE Trigger"]

    # And the boundary is the window itself, not a round number near it.
    assert vw.classify(2750, windows) == (vw.WINDOW_TRUNCATED, ["HVE Trigger"])
    assert vw.classify(2751, windows) == (vw.FULL_WINDOW, [])


def test_a_shallower_load_takes_the_fifty_bar_columns_too():
    """Per-column, not all-or-nothing — proved in the other direction."""
    windows = vw.declared_windows("member/uncharted-volume-v2.pine")
    verdict, excluded = vw.classify(40, windows)
    assert verdict == vw.WINDOW_TRUNCATED
    assert excluded == ["Avg Vol Columns", "Avg Vol Line", "HVE Trigger", "Scale Padding"]
    # `Volume` declares no window, so no depth can disqualify it.
    assert "Volume" not in excluded
    assert vw.classify(0, windows)[1] == excluded


def test_an_unread_depth_is_a_refusal_rather_than_a_pass():
    windows = vw.declared_windows("member/uncharted-volume-v2.pine")
    verdict, excluded = vw.classify(None, windows)
    assert verdict == vw.UNMEASURED
    assert excluded == ["Avg Vol Columns", "Avg Vol Line", "HVE Trigger", "Scale Padding"]
    # ⛔ NOT the same answer as a deep load. If it were, not measuring would cost
    # nothing and nobody would measure.
    assert vw.classify(999_999, windows) == (vw.FULL_WINDOW, [])


def test_the_readers_must_agree_before_a_window_is_derived_from_them():
    """The oracle is two readers agreeing; if they stop, the derivation stops."""
    forked = {"rows": [
        {"from": "member/x.pine", "lane": "host", "title": "T", "lint": 50, "interpret": 51},
    ]}
    with pytest.raises(ValueError):
        vw.declared_windows("member/x.pine", forked)


def test_a_script_the_readers_never_walked_has_no_window_to_check_against():
    with pytest.raises(KeyError):
        vw.declared_windows("member/never-seen.pine", {"rows": []})
