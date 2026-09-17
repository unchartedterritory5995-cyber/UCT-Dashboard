"""The screenshot harness's own rails (DC-2 §3.2).

⛔ A HARNESS IS AN INSTRUMENT, AND AN INSTRUMENT GETS THE SAME TREATMENT AS THE PRODUCT.
Every failure this file pins is one where the harness would keep producing confident,
well-formatted, WRONG evidence:

  * a fixture that cannot distinguish the condition it exists to exercise;
  * a differ that cannot see a one-pixel change;
  * a capture that silently shot somebody else's server.

None of those announce themselves — they all look exactly like a passing run, which is
why they are asserted here rather than trusted.

⚠️ These tests do NOT launch a browser or build the app. They exercise the pure parts:
the fixture, the differ, and the source-level presence of the identity guard. The
end-to-end proof is `python tools/breadth_charts_shots.py --capture`, whose own control
is `--self-check`.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from tools import breadth_charts_shots as H          # noqa: E402


# ── The fixture ──────────────────────────────────────────────────────────────────────

def test_the_fixture_DISTINGUISHES_the_era_note_condition():
    """⛔⛔ THE ONE THAT CAUGHT A REAL DEFECT. The first version grew `universe_count`
    by `i / (n - 1)`, which is 74 % on EVERY span — so the era note (>20 % end to end)
    would have fired on all of them, and a shot of "the note fires" would have been
    indistinguishable from "the note always fires".

    `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`, caught by asking the
    fixture for both spans and comparing, which is the whole of the method."""
    def growth(n):
        u = H._fixture(n)["series"]["universe_count"]
        return (u[-1] - u[0]) / u[0] * 100

    short, long = growth(365), growth(4530)
    assert short < 20, f"short span grows {short:.1f}% — the note would fire when it must not"
    assert long > 20, f"long span grows {long:.1f}% — the note would never fire"


def test_the_weekly_series_is_actually_SPARSE():
    """A-28/A-10: AAII is a weekly survey. If the fixture gave it a reading every
    session, a renderer that draws it as a daily line would look CORRECT in every shot."""
    v = H._fixture(365)["series"]["aaii_bulls"]
    present = sum(x is not None for x in v)
    assert 0 < present < len(v) / 3, f"{present}/{len(v)} readings — not a weekly shape"


def test_qqq_close_is_absent_before_2026_so_A39_has_something_to_disclose():
    """A-39's condition is that reconstructed rows lack `qqq_close`. A fixture where it
    is always present cannot exercise the disclosure at all."""
    f = H._fixture(4530)
    dates = H._dates_of(f)
    q = f["series"]["qqq_close"]
    before = [q[i] for i, d in enumerate(dates) if d < "2026-01-02"]
    after = [q[i] for i, d in enumerate(dates) if d >= "2026-01-02"]
    assert before and all(x is None for x in before), "A-39 has nothing to disclose"
    assert after and all(x is not None for x in after), "nothing is present after the boundary"


def test_the_fixture_reads_no_clock_and_is_byte_stable():
    """⛔ Two calls must be identical. A fixture that consults `date.today()` re-records
    every golden at midnight, which is the moving-reference defect this harness exists
    to avoid."""
    import json
    a = json.dumps(H._fixture(365), sort_keys=True)
    b = json.dumps(H._fixture(365), sort_keys=True)
    assert a == b


def test_universe_count_is_offered_or_the_era_note_cannot_be_computed():
    """The era note is computed CLIENT-SIDE from `universe_count` (01-audit.md:309-311),
    and `/series` caps at 8 keys — so if it is not requested, the note is impossible."""
    assert "universe_count" in H.FIXTURE_KEYS
    assert len(H.FIXTURE_KEYS) <= 8, "the /series cap is 8 keys; a 9th is a 400"


# ── The matrix ───────────────────────────────────────────────────────────────────────

def test_the_matrix_covers_both_flags_independently():
    """V2-3 must not ride in on V2-2's flip, so the shot matrix has to contain a state
    where exactly one is on — otherwise no screenshot can ever show the difference."""
    states = H.FLAG_STATES
    only22 = [k for k, v in states.items()
              if v["breadth_dc_v2_2_enabled"] and not v["breadth_dc_v2_3_enabled"]]
    only23 = [k for k, v in states.items()
              if v["breadth_dc_v2_3_enabled"] and not v["breadth_dc_v2_2_enabled"]]
    assert only22 and only23, f"matrix cannot separate the flags: {states}"
    assert any(not v["breadth_dc_v2_2_enabled"] and not v["breadth_dc_v2_3_enabled"]
               for v in states.values()), "no flag-OFF baseline to diff against"


def test_the_phone_viewport_is_below_the_breakpoint():
    """640 is the phone boundary. A 'mobile' shot at 700px exercises the tablet branch
    and proves nothing about the phone."""
    w, _h = H.VIEWPORTS["380"]
    assert w < 640, f"{w}px is not below the 640 phone breakpoint"


def test_the_fixture_member_is_NOT_an_admin():
    """⛔ With an admin payload, the `admin` owner-preview value is indistinguishable
    from `true`, and every shot would be the owner's view rather than a member's."""
    assert H._auth_payload({})["user"]["role"] == "free"


# ── The differ ───────────────────────────────────────────────────────────────────────

def test_the_differ_sees_ONE_pixel_and_a_size_change(tmp_path):
    """The smallest real regression is one pixel. A differ that cannot see it will not
    see a shifted label either."""
    from PIL import Image
    a, b, c = tmp_path / "a.png", tmp_path / "b.png", tmp_path / "c.png"
    img = Image.new("RGB", (30, 20), (9, 9, 9))
    img.save(a)
    m = img.copy()
    m.putpixel((5, 5), (9, 9, 10))       # one pixel, one channel, by one
    m.save(b)
    Image.new("RGB", (31, 20), (9, 9, 9)).save(c)

    assert H.pixel_diff(a, a) == 0
    assert H.pixel_diff(a, b) == 1
    assert H.pixel_diff(a, c) == -1, "a size change must be reported, not counted"


def test_self_check_passes():
    """The tool's own control, run here so a broken differ fails the suite and not just
    an operator's manual invocation."""
    assert H.self_check() == 0


# ── The checker's classification ─────────────────────────────────────────────────────

def _png(path, size=(20, 12), colour=(7, 7, 7), poke=None):
    from PIL import Image
    im = Image.new("RGB", size, colour)
    if poke:
        im.putpixel(poke, (colour[0] ^ 1, colour[1], colour[2]))
    im.save(path)


def _pair(tmp_path, names):
    shots, gold = tmp_path / "shots", tmp_path / "gold"
    shots.mkdir(), gold.mkdir()
    for n in names:
        _png(shots / n)
        _png(gold / n)
    return shots, gold


def test_a_flag_OFF_change_is_a_REGRESSION_and_fails(tmp_path, capsys):
    """⛔ `off__*` IS V1 — the product members see today. It must not move one pixel
    while two increments are built behind a dark flag."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png", "v22__365__1280.png"])
    _png(gold / "off__365__1280.png", poke=(3, 3))      # V1 moved
    assert H.check(shots, gold) == 1
    assert "REGRESSION" in capsys.readouterr().out


def test_a_flag_ON_change_is_EXPECTED_and_does_not_fail(tmp_path, capsys):
    """⭐ The increments changing IS the work. A checker that reds on the intended
    change trains everyone to `--update-goldens` without looking — which is exactly how
    a real V1 regression would then slip through."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png", "v22__365__1280.png"])
    _png(gold / "v22__365__1280.png", poke=(3, 3))
    assert H.check(shots, gold) == 0
    out = capsys.readouterr().out
    assert "EXPECTED" in out and "REGRESSION" not in out


def test_a_DISAPPEARED_case_is_a_regression(tmp_path):
    """A golden with no shot means the matrix lost a case — silently shrinking coverage
    is the flattering direction of failure."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png"])
    (shots / "off__365__1280.png").unlink()
    assert H.check(shots, gold) == 1


def test_the_checker_is_not_vacuous_on_a_clean_pair(tmp_path, capsys):
    """CONTROL: if it returned 0 for everything, the three tests above would pass for
    the wrong reason."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png", "v22__365__1280.png"])
    assert H.check(shots, gold) == 0
    assert "match their goldens" in capsys.readouterr().out


# ── The identity guard ───────────────────────────────────────────────────────────────

def test_the_capture_refuses_a_server_it_cannot_identify():
    """⛔ A PORT ASSIGNMENT IS NOT A SERVER IDENTITY. Source-level, because starting a
    rogue server to prove it would be the very thing this box has been bitten by.

    Read as CODE, not prose: the docstring explains the guard at length and a naive
    substring search would match its explanation and pass over a deleted guard."""
    src = (REPO / "tools" / "breadth_charts_shots.py").read_text(encoding="utf-8")
    body = src.split('"""', 2)[2]        # everything after the module docstring
    code = "\n".join(ln for ln in body.splitlines()
                     if not ln.lstrip().startswith("#"))
    assert "SERVER IDENTITY MISMATCH" in code, "the identity refusal is gone"
    assert "expect_sha" in code and "_sha(served)" in code, "nothing compares the hashes"
    assert "_port_is_quiet" in code, "the pre-bind occupancy check is gone"


def test_the_occupancy_check_CONNECTS_rather_than_binds():
    """⛔ `bind()` succeeding proves nothing on Windows — a second listener on 127.0.0.1
    is permitted while another process holds 0.0.0.0. Only a successful connect is proof
    somebody is there."""
    import inspect
    src = inspect.getsource(H._port_is_quiet)
    assert "create_connection" in src
    assert ".bind(" not in src, "the occupancy check binds, which decides nothing"


def test_it_refuses_to_build_for_you():
    """A harness that rebuilds silently hides which tree it shot."""
    src = (REPO / "tools" / "breadth_charts_shots.py").read_text(encoding="utf-8")
    assert "npm run build" in src, "it should NAME the command"
    assert "does not build for you" in src


@pytest.mark.parametrize("name", ["off", "v22", "v23", "both"])
def test_every_flag_state_produces_a_complete_auth_payload(name):
    """The gate reads `=== true`, so a payload missing the key must read as OFF rather
    than as undefined-and-therefore-whatever."""
    p = H._auth_payload(H.FLAG_STATES[name])
    for k in ("breadth_dc_v2_2_enabled", "breadth_dc_v2_3_enabled"):
        assert isinstance(p[k], bool), f"{k} is {type(p[k])}, not a bool"
