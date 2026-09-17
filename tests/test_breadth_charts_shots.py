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


@pytest.mark.parametrize("span", [365, 4530])
def test_the_fixture_obeys_the_series_contract(span):
    """⛔⛔ A FIXTURE THAT DISOBEYS THE CONTRACT TESTS A SHAPE THE SERVER NEVER SENDS.

    The first version omitted `dates` entirely. Nothing threw — `useBreadthSeries` reads
    `data.dates` with an EMPTY fallback — so the V2 shell rendered against an empty
    x-axis and the screenshots looked perfectly reasonable. It would have been found
    when V2-2 drew a chart with no time on it, i.e. after the work was done.

    The contract is `docs/breadth/api-series.md:38-45`, asserted here clause by clause.
    """
    f = H._fixture(span)
    assert "dates" in f, "the response carries `dates` — the client reads it by that name"
    dates = f["dates"]
    assert dates == sorted(dates), "`dates` ascending"
    assert len(set(dates)) == len(dates), "each date once"
    assert f["sessions"] == len(dates), "`sessions == len(dates)`, in stored sessions"
    for key, col in f["series"].items():
        assert len(col) == len(dates), f"{key} column is not the length of `dates`"
    assert set(f["reconstructed"]) <= set(dates), "reconstructed names a date not served"
    assert f["from"] == dates[0] and f["to"] == dates[-1]


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

def test_the_differ_sees_ONE_pixel_past_the_tolerance_and_a_size_change(tmp_path):
    """The smallest change the differ can honestly claim to see, and its boundary.

    ⚰️ This asserted that a ONE-LEVEL change on one pixel counted. It no longer does, and
    the reason is measured rather than convenient: Chromium rasterises the y-axis label
    column and the tab bar's rounded pill a grey level differently per launch, so a
    one-level sensitivity reported a diff on runs where nothing had changed. The rail was
    updated rather than the tolerance widened — `ANTIALIAS_TOLERANCE` is 1 and both sides
    of it are pinned here, so raising it would fail this test rather than quietly blind
    the differ.
    """
    from PIL import Image
    a = tmp_path / "a.png"
    noise = tmp_path / "noise.png"
    real = tmp_path / "real.png"
    sized = tmp_path / "sized.png"

    base = Image.new("RGB", (30, 20), (9, 9, 9))
    base.save(a)

    n = base.copy()
    n.putpixel((5, 5), (9, 9, 9 + H.ANTIALIAS_TOLERANCE))       # the rasterisation noise
    n.save(noise)

    r = base.copy()
    r.putpixel((5, 5), (9, 9, 9 + H.ANTIALIAS_TOLERANCE + 1))   # one level past it
    r.save(real)

    Image.new("RGB", (31, 20), (9, 9, 9)).save(sized)

    assert H.pixel_diff(a, a) == 0
    assert H.pixel_diff(a, noise) == 0, "the measured antialias noise must be absorbed"
    assert H.pixel_diff(a, real) == 1, "one level past the tolerance must be CAUGHT"
    assert H.pixel_diff(a, sized) == -1, "a size change must be reported, not counted"


def test_self_check_passes():
    """The tool's own control, run here so a broken differ fails the suite and not just
    an operator's manual invocation."""
    assert H.self_check() == 0


# ── The checker's classification ─────────────────────────────────────────────────────

def _png(path, size=(60, 60), colour=(7, 7, 7), blot=0):
    """A flat image, optionally with `blot` pixels changed well past the noise budget."""
    from PIL import Image
    im = Image.new("RGB", size, colour)
    for i in range(blot):
        im.putpixel((i % size[0], i // size[0]), (240, 10, 10))
    im.save(path)


def _pair(tmp_path, names, dom=True):
    shots, gold = tmp_path / "shots", tmp_path / "gold"
    (shots / "dom").mkdir(parents=True), (gold / "dom").mkdir(parents=True)
    for n in names:
        _png(shots / n)
        _png(gold / n)
        if dom:
            html = f"<div>{n}</div>"
            (shots / "dom" / (n[:-4] + ".html")).write_text(html, encoding="utf-8")
            (gold / "dom" / (n[:-4] + ".html")).write_text(html, encoding="utf-8")
    return shots, gold


#: Comfortably past `PNG_NOISE_BUDGET`, so these tests are about classification and not
#: about where the budget happens to sit.
BIG = H.PNG_NOISE_BUDGET * 3


def test_a_flag_OFF_change_is_a_REGRESSION_and_fails(tmp_path, capsys):
    """⛔ `off__*` IS V1 — the product members see today. A real change there fails."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png", "v22__365__1280.png"])
    _png(gold / "off__365__1280.png", blot=BIG)
    assert H.check(shots, gold) == 1
    assert "REGRESSION" in capsys.readouterr().out


def test_a_flag_ON_change_is_EXPECTED_and_does_not_fail(tmp_path, capsys):
    """⭐ The increments changing IS the work. A checker that reds on the intended change
    trains everyone to `--update-goldens` without looking — which is exactly how a real
    V1 regression would then slip through."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png", "v22__365__1280.png"])
    _png(gold / "v22__365__1280.png", blot=BIG)
    assert H.check(shots, gold) == 0
    out = capsys.readouterr().out
    assert "EXPECTED" in out and "REGRESSION" not in out


def test_a_sub_budget_pixel_diff_is_NOISE_on_every_case(tmp_path, capsys):
    """⛔⛔ THE CORRECTION THAT COST A ROUND. The flag-off cases were first held to ZERO
    pixels, on the strength of ONE run in which they came back clean. The next run moved
    `off__365__1280` by 17 px, twice — a y-axis label rasterised at a different subpixel
    offset. One sample does not establish determinism, so the budget applies everywhere
    and the DOM carries exactness."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png"])
    _png(gold / "off__365__1280.png", blot=H.PNG_NOISE_BUDGET)
    assert H.check(shots, gold) == 0
    out = capsys.readouterr().out
    assert "noise only" in out and "REGRESSION" not in out


def test_a_DOM_change_alone_is_a_REGRESSION_even_with_identical_pixels(tmp_path, capsys):
    """⭐ THE REASON THE DOM RAIL EXISTS. Pixels carry a measured noise floor; the
    normalised DOM does not (16/16 byte-stable across two full runs). A structural change
    that happens to land under the pixel budget must still be caught."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png"])
    (gold / "dom" / "off__365__1280.html").write_text("<div>something else</div>",
                                                      encoding="utf-8")
    assert H.check(shots, gold) == 1
    assert "DOM changed" in capsys.readouterr().out


def test_a_DISAPPEARED_case_is_a_regression(tmp_path):
    """A golden with no shot means the matrix lost a case — silently shrinking coverage
    is the flattering direction of failure."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png"])
    (shots / "off__365__1280.png").unlink()
    assert H.check(shots, gold) == 1


def test_the_checker_is_not_vacuous_on_a_clean_pair(tmp_path, capsys):
    """CONTROL: if it returned 0 for everything, the tests above would pass for the wrong
    reason."""
    shots, gold = _pair(tmp_path, ["off__365__1280.png", "v22__365__1280.png"])
    assert H.check(shots, gold) == 0
    assert "match their goldens" in capsys.readouterr().out


def test_the_dom_normaliser_keeps_the_product(tmp_path):
    """⛔ A NORMALISER THAT ERASES TOO MUCH IS A GOLDEN THAT CANNOT FAIL. The id rule was
    once written through a shell heredoc that ate its backreferences and collapsed the
    whole match to `<ID>` — deleting `id="` itself, after which every golden would have
    matched every other golden."""
    out = H.normalise_dom('<div id="r7" class="keep" aria-controls="x9">Data Charts</div>')
    assert 'id="<ID>"' in out, "the attribute NAME was destroyed, not just its value"
    assert 'aria-controls="<ID>"' in out
    assert 'class="keep"' in out, "an unrelated attribute was eaten"
    assert "Data Charts" in out, "the normaliser removed visible text"


def test_the_dom_normaliser_actually_removes_the_volatile_parts(tmp_path):
    """CONTROL for the one above: it must still erase what it is for."""
    before = '<div id="r7" style="background:url(#grad-42)" _echarts_instance_="ec_9">x</div>'
    out = H.normalise_dom(before)
    assert "r7" not in out and "grad-42" not in out and "ec_9" not in out
    assert out != before


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
