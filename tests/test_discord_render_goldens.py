"""The pre-V2 reply payloads are byte-for-byte unchanged (step 2.7, 04 §6).

⛔⛔ **THIS IS THE P2 GROUND RULE AS A TEST.** With `DISCORD_RENDER_V2_ENABLED` unset, a member sees
exactly what they see today — the same content string, the same control tree, the same filename, the
same image. Every step of this programme has been merged on that promise; nothing until now could
fail if it were broken.

⛔⛔ **THE CAPTURE'S OWN DETERMINISM IS ASSERTED BEFORE ANY STORED GOLDEN IS TRUSTED**, and it is the
first test in the file for that reason. A golden harness whose output varies proves nothing: it goes
red on a wall clock and green on a real regression, and within two weeks everyone re-baselines
without reading the diff. `test_the_capture_agrees_with_itself` runs the whole capture twice back to
back; if it fails, every other result in this file is void.

⛔ **NO NETWORK, AND THE STUB IS PART OF THE GOLDEN.** There is no Chromium here and there must not
be — this is payload-level, not pixel-level. The stubs are listed inside the capture and compared
like any other field, so swapping one reads as a drift rather than as a mystery.

Re-baseline deliberately, never reflexively:

    python docs/discord-render/instruments/golden_capture.py --write
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "drender_golden_capture", ROOT / "docs" / "discord-render" / "instruments" / "golden_capture.py")
gc = importlib.util.module_from_spec(_SPEC)
sys.modules["drender_golden_capture"] = gc
_SPEC.loader.exec_module(gc)


@pytest.fixture(autouse=True)
def _restore_env():
    """`capture()` pins env by design; this keeps that out of the rest of the session."""
    before = {k: os.environ.get(k) for k in gc.ENV_PINS}
    yield
    for k, v in before.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


@pytest.fixture(scope="module")
def captures():
    """Two full captures, back to back. Module-scoped: the determinism check and the golden
    comparison are two questions about the SAME pair of runs, and capturing four times to ask them
    separately would make the pair the test compares stop being the pair it proved stable."""
    return gc.capture_twice()


# ── 1 · the capture has to agree with itself before anything else means anything ──

def test_the_capture_agrees_with_itself(captures):
    """⛔⛔ IF THIS FAILS, EVERY OTHER RESULT IN THIS FILE IS VOID."""
    first, second = captures
    drift = gc.diff_paths(first, second)
    assert not drift, ("the capture is not deterministic — two back-to-back runs disagree, so a "
                       "stored golden would be pinning noise:\n  " + "\n  ".join(drift[:20]))


def test_the_capture_is_not_empty_and_covers_the_replies_a_member_actually_gets(captures):
    """⛔ THE NON-VACUITY CONTROL. An empty capture agrees with itself perfectly, and a golden of
    nothing compares clean forever."""
    scenarios = captures[0]["scenarios"]
    assert len(scenarios) >= 15
    for expected in ("chart/NVDA/D/default", "chart/NVDA/D/controls-expanded",
                     "chart/NOPE/D/unknown-ticker", "flow/NVDA/5/delivered",
                     "flow/NVDA/1/quiet-tape", "buzz/board/drawn"):
        assert expected in scenarios, f"{expected} is not being captured at all"
    assert all(s["edits"] for s in scenarios.values()), (
        "a scenario that produced no edit captured no reply — the member got nothing and the "
        "golden would record that as a clean pass")


def test_every_captured_reply_carries_something_a_member_can_read(captures):
    """Text or an image, on every single path. A payload with neither is the silent failure C-11
    describes, and a golden that accepted one would freeze it in place."""
    for name, scenario in captures[0]["scenarios"].items():
        for i, edit in enumerate(scenario["edits"]):
            assert edit.get("content") or edit.get("png_sha256"), f"{name} edit[{i}] says nothing"


def test_the_capture_carries_no_wall_clock(captures):
    """⛔ §3.10: THE SAME CLOSED-MARKET INPUT MUST RENDER THE SAME PIXELS. Today's date appearing
    anywhere in a capture of closed-market data means something read the clock, and that golden
    would go red tomorrow morning for no reason anybody could act on."""
    today = dt.date.today().isoformat()
    assert today != gc.FIXED_TODAY, (
        "the control: this test can only detect a leak while today differs from the fixed world. "
        "Move FIXED_TODAY to another closed session rather than deleting the check")
    assert today not in gc.canonical(captures[0])


# ── 2 · zero drift against the stored golden ───────────────────────────────

def test_the_stored_golden_exists_and_is_the_shape_the_capture_produces():
    stored = gc.load_golden()
    assert stored is not None, (
        f"no stored golden at {gc.GOLDEN} — run the instrument with --write")
    assert stored["version"] == gc.CAPTURE_VERSION
    assert stored["scenarios"], "a golden with no scenarios compares clean against anything"


def test_a_fresh_capture_matches_the_stored_golden_at_zero_drift(captures):
    """⛔ ZERO. Not 'close', not 'within tolerance' — a payload either is what we ship today or it
    is not. Every name below is a member-visible change: read it, then decide whether to
    re-baseline with `--write`."""
    drift = gc.diff_paths(gc.load_golden(), captures[0])
    assert not drift, ("the pre-V2 reply payloads have MOVED — that is the one thing P2 promised "
                       "would not happen:\n  " + "\n  ".join(drift[:40]))


def test_the_stubs_are_part_of_the_golden(captures):
    """⛔ A STUB SWAPPED QUIETLY IS THE HARNESS LYING TO ITSELF. They are compared like any other
    field by the test above; this asserts they are actually IN the artifact, so that comparison is
    not over an absent key.

    ⚰️ It read only the STORED file, so a capture that stopped recording its stubs altogether
    left this green — the stored JSON on disk still had them. A mutation caught it. The fresh
    capture is now checked first, because that is the artifact a future run would write."""
    fresh, _ = captures
    assert fresh["stubs"] == gc.STUBS and len(fresh["stubs"]) >= 5, (
        "a FRESH capture no longer records its stubs; the stored golden would be compared "
        "against an artifact that cannot say what it faked")
    stored = gc.load_golden()
    assert stored["stubs"] == gc.STUBS and len(stored["stubs"]) >= 5
    for stub in stored["stubs"]:
        assert stub["target"] and stub["why"], "a stub with no stated reason is an unexplained gap"
    assert stored["world"]["env"] == dict(gc.ENV_PINS), (
        "an unpinned variable is a golden that only reproduces on the machine that wrote it")


def test_the_golden_stores_no_image_bytes():
    """04 §6: PNGs are hashed, not stored. A committed binary nobody can read cannot distinguish a
    render change from a library upgrade — and it makes the diff unreadable, which is the same
    failure by another route."""
    raw = gc.GOLDEN.read_text(encoding="utf-8")
    assert "png_sha256" in raw and "\\u0089PNG" not in raw and "iVBORw0KGgo" not in raw
    for scenario in json.loads(raw)["scenarios"].values():
        for edit in scenario["edits"]:
            assert "png" not in edit and "pngs" not in edit


# ── 3 · the controls this file exists because of ───────────────────────────

def test_the_differ_reports_a_change_by_NAME_and_not_as_a_count():
    """⛔ A DIFFER THAT SAYS "3 FIELDS MOVED" MAKES THE READER OPEN BOTH FILES, which is the moment
    a golden stops being read and starts being re-baselined. And a comparison nobody has seen report
    a difference is not a comparison — this whole file is one comparison."""
    stored = gc.load_golden()
    mutated = json.loads(json.dumps(stored))
    mutated["scenarios"]["chart/NVDA/D/default"]["edits"][0]["content"] = "NVDA · Dailyy"
    drift = gc.diff_paths(stored, mutated)
    assert len(drift) == 1 and "chart/NVDA/D/default" in drift[0] and "Dailyy" in drift[0]

    dropped = json.loads(json.dumps(stored))
    dropped["scenarios"]["chart/NVDA/D/default"]["edits"][0].pop("components")
    assert any("components" in d for d in gc.diff_paths(stored, dropped)), (
        "a control tree that vanished from a reply must be reported, not tolerated")

    assert gc.diff_paths(stored, stored) == [], "the differ finds a difference in identical input"


def test_the_capture_reaches_no_network(captures, monkeypatch):
    """⛔ IT MUST NOT TOUCH THE NETWORK. Not because it would be slow — because a golden that can
    reach a provider is a golden that goes red when the provider does, and the next person deletes
    it. Runs a full capture with every socket refused."""
    import socket

    def _refuse(*a, **k):
        raise AssertionError("the golden capture opened a socket")

    monkeypatch.setattr(socket.socket, "connect", _refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", _refuse)
    monkeypatch.setattr(socket, "create_connection", _refuse)
    with pytest.raises(AssertionError, match="opened a socket"):
        socket.create_connection(("127.0.0.1", 9))
    with pytest.raises(AssertionError, match="opened a socket"):
        socket.socket().connect(("127.0.0.1", 9))
    assert gc.diff_paths(gc.capture(), captures[0]) == [], (
        "the capture behaves differently with the network cut off, which means it was using it")


def test_the_fixtures_do_not_depend_on_the_process_hash_seed():
    """⛔ `hashlib`, NEVER `hash()`. Python's is salted per process, so a fixture built on it
    produces a different golden on every run — and the determinism check would then fail for a
    reason that has nothing to do with the product."""
    import ast

    path = ROOT / "docs" / "discord-render" / "instruments" / "golden_capture.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    # ⛔ AST, NOT GREP. This check's own first version matched the sentence ABOVE explaining the
    # rule and failed on the file that follows it — the invented-citation defect, one layer down.
    calls = [n.func.id for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    assert "hash" not in calls
    assert calls, "the control: the walk found no calls at all, so the assertion above is vacuous"
    bars = gc.bars_for("NVDA", "D", 5)
    assert bars == gc.bars_for("NVDA", "D", 5) != gc.bars_for("AAPL", "D", 5)
    assert [b["t"] for b in bars][-1] == gc.FIXED_TODAY
