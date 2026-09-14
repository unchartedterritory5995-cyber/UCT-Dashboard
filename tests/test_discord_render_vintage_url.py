"""C-07 CLOSED: the vintage reaches the page, and the pre-V2 URL did not move to do it.

C-07 is "data or wall clock shown as current when it is not" — 27 of 85 closed-market cases
differing run to run, the footer's wall clock named as a cause. The structural fix is **vintage,
not wall clock** (03 §3.8, §3.10): the render page is told the DATA's `as_of` and stamps THAT, so
the same closed-market input renders the same pixels.

⛔⛔ **THE SEAM THAT DECIDES IT IS THE URL**, which is why this file lives at that seam and not at
the page. `tests/test_discord_render_forensics.py`'s strict-xfail
`test_c07_..._carries_the_data_vintage_...` is the standing statement of the gap and asserts exactly
one thing: the vintage REACHES the page. This file is the closure proof behind it — that the
vintage reaches the page, that what reaches it is the ONE sentence and not a second phrasing of it,
and that everything which carries no vintage comes out byte-for-byte as it did before.

⛔ **THE BYTE-IDENTICAL CLAIM IS DERIVED, NOT ASSERTED.** `test_the_pre_v2_url_is_byte_identical_…`
reads `api/services/discord_chart_house.py` as it stood at `_BASE_SHA` out of git, executes THAT
version, and compares its `build_render_url` with today's across a matrix of option shapes. A
transcribed expected-URL string proves only that somebody typed it correctly once
(`lesson_a_comment_claiming_agreement_is_not_agreement`); asking the previous version is evidence.
Provenance is `git show <sha>:<file>`, never `git status` — the rule this repo already runs on.
"""
from __future__ import annotations

import subprocess
import sys
import types
from pathlib import Path

import pytest

from api.services import discord_chart_house as house
from api.services.discord_render import badge, freshness

ROOT = Path(__file__).resolve().parents[1]

#: The commit this lane branched from — the last state of `build_render_url` before the vintage
#: parameter existed. ⛔ A SHA, not "master": master moves, and a moving baseline turns a
#: byte-identical proof into a comparison against whatever landed this morning.
_BASE_SHA = "4eec5e0aa"

BASE = dict(base_url="https://x", token="T")

STATS = {"as_of": "2026-09-11", "close": 553.11, "day_pct": -3.47}

#: Every option shape the house URL builder has a branch for. ⛔ NOT A HAPPY PATH: a byte-identical
#: proof over one bare daily chart would pass while every intraday, panned, breadth and compare URL
#: moved. None of these carries a vintage — that is the point of the matrix.
PRE_V2_MATRIX = [
    ("bare-daily", ("NVDA", "D", None), {}),
    ("stats-daily", ("NVDA", "D", STATS), {}),
    ("intraday-5-ext", ("AAPL", "5", STATS), {"ext": True}),
    ("intraday-30-noext", ("AAPL", "30", None), {"ext": False}),
    ("weekly-prefs", ("SPY", "W", STATS), {"stats": False, "preset": "dark",
                                           "indicators": {"heikinAshi": True}}),
    ("panned", ("NVDA", "D", STATS), {"to": "2026-06-01", "bars": 240}),
    ("breadth", ("UCTA5", "D", None), {"breadth": "pct_above_5sma"}),
    ("compare", ("NVDA", "D", STATS), {"compare": ["spy", "qqq"]}),
    ("exttag", ("NVDA", "D", STATS), {"exttag": ("post", 178.125)}),
    ("dpzones", ("NVDA", "D", None), {"dpzones": [{"lo": 1, "hi": 2}]}),
    ("instances", ("NVDA", "D", None), {"instances": [{"id": "rsi"}]}),
]


def _url(*args, **opts) -> str:
    return house.build_render_url(*args, **BASE, options=opts or None)


# ── 1 · the vintage reaches the page ───────────────────────────────────────

def test_the_render_url_carries_the_vintage_when_the_data_is_stale():
    """The forensics xfail's own call, and the closure it was waiting for."""
    url = house.build_render_url("NVDA", "D", {"as_of": "2026-09-11"}, base_url="https://x",
                                 token="T", options={"stale": True, "as_of": "2026-09-11"})
    assert "stale=" in url, "the render URL carries no vintage; the page can only stamp the clock"


def test_what_travels_is_the_ONE_sentence_and_not_a_second_phrasing_of_it():
    """⛔⛔ THE SENTENCE, NOT THE DATE — and the sentence is `Envelope.badge`'s.

    Sending a bare `as_of` would leave the page to phrase `⚠ data as of … (stale)` for itself,
    which is a second author over the one value. That is how a chart reached the public channel on
    2026-08-31 carrying Monday's clock beside Friday's numbers. Derived from the envelope here
    rather than typed, so re-wording the badge cannot leave this test agreeing with a stale copy.
    """
    env = freshness.envelope("2026-09-04", tf="D", provider="disk",
                             now=freshness.dt.datetime(2026, 9, 11, 15, 0, tzinfo=freshness.ET))
    assert env.stale is True and env.badge, "the fixture is not stale, so this proves nothing"

    from urllib.parse import parse_qs, urlparse
    url = _url("NVDA", "D", None, stale=env.stale, as_of=env.as_of_et)
    assert parse_qs(urlparse(url).query)["stale"] == [env.badge]
    assert parse_qs(urlparse(url).query)["stale"] == [badge.render_badge(env)]


def test_the_page_is_told_nothing_when_there_is_nothing_to_tell_it():
    """⛔ FRESH IS NOT A BADGE AND UNKNOWN IS NOT STALE (04 §2). All three draw no parameter, so
    "we measured and it is fine" and "we did not measure" reach the page identically — correct,
    because in both cases there is nothing to say to a member."""
    for name, opts in [("fresh", {"stale": False, "as_of": "2026-09-11"}),
                       ("unknown", {"stale": None, "as_of": "2026-09-11"}),
                       ("stale-but-no-readable-timestamp", {"stale": True, "as_of": ""}),
                       ("stale-with-no-timestamp-key", {"stale": True}),
                       ("vintage-with-no-verdict", {"as_of": "2026-09-11"})]:
        assert "stale=" not in _url("NVDA", "D", None, **opts), f"{name} drew a badge"


def test_a_truthy_but_not_True_verdict_is_refused():
    """`stale` is three-valued on purpose. A caller handing over a truthy string is a caller who
    has not measured, and `is True` is the whole guard — the one `render_badge` documents."""
    assert "stale=" not in _url("NVDA", "D", None, stale="yes", as_of="2026-09-11")
    assert "stale=" not in _url("NVDA", "D", None, stale=1, as_of="2026-09-11")


def test_the_vintage_is_the_LAST_parameter_so_nothing_else_shifts():
    """Ordering is behaviour here: `urlencode` writes a dict in insertion order, so appending is
    what makes every other URL byte-identical. A vintage inserted mid-way would move `token`,
    `stats` and `compare` on every stale render."""
    url = _url("NVDA", "D", STATS, compare=["spy"], stale=True, as_of="2026-09-04 16:00")
    assert url.index("stale=") > url.index("compare="), "the vintage no longer trails the URL"


# ── 2 · the pre-V2 path is byte-for-byte what it was ───────────────────────

@pytest.fixture(scope="module")
def base_module() -> types.ModuleType:
    """`api/services/discord_chart_house.py` as it stood at `_BASE_SHA`, executed.

    ⛔ `git -C <root>`, never the caller's cwd: git resolves pathspecs relative to the cwd, and a
    pathspec that silently resolves to nothing returns an empty blob that would compare clean
    against anything (`lesson_an_empty_result_is_a_failed_invocation`)."""
    out = subprocess.run(["git", "-C", str(ROOT), "show", f"{_BASE_SHA}:api/services/discord_chart_house.py"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert out.returncode == 0, f"could not read the base blob: {out.stderr.strip()[:200]}"
    src = out.stdout
    assert "def build_render_url" in src, "the base blob has no build_render_url in it"
    mod = types.ModuleType("discord_chart_house_at_base")
    mod.__file__ = "<git:%s>" % _BASE_SHA
    sys.modules[mod.__name__] = mod
    exec(compile(src, mod.__file__, "exec"), mod.__dict__)
    return mod


def test_the_base_blob_really_is_an_older_version_of_the_file(base_module):
    """⛔ THE NON-VACUITY CONTROL. If `git show` returned today's file — a wrong SHA, a pathspec
    that resolved to nothing, a fixture that quietly fell back to the import — then every
    comparison below is the current module compared with itself and passes forever."""
    assert "_vintage_param" not in base_module.__dict__, (
        "the base version already has the vintage helper, so it is not the version this lane "
        "started from and the byte-identical claim below is vacuous")
    assert "_vintage_param" in house.__dict__
    assert base_module.build_render_url is not house.build_render_url


@pytest.mark.parametrize("name,args,opts", PRE_V2_MATRIX, ids=[c[0] for c in PRE_V2_MATRIX])
def test_the_pre_v2_url_is_byte_identical_to_the_version_this_lane_started_from(
        base_module, name, args, opts):
    """⛔⛔ THE P2 GROUND RULE, AT THIS SEAM. With no vintage in `options` the URL the renderer is
    pointed at must be the same string, character for character — not equivalent, not
    reordered."""
    before = base_module.build_render_url(*args, **BASE, options=opts or None)
    after = house.build_render_url(*args, **BASE, options=opts or None)
    assert after == before, f"the {name} render URL moved:\n  was: {before}\n  now: {after}"


def test_the_comparison_can_actually_fail(base_module):
    """⛔ A COMPARISON NOBODY HAS SEEN REPORT A DIFFERENCE IS NOT A COMPARISON. The same call with
    a vintage in `options` MUST differ between the two versions — that is the whole change."""
    opts = {"stale": True, "as_of": "2026-09-04 16:00"}
    before = base_module.build_render_url("NVDA", "D", None, **BASE, options=opts)
    after = house.build_render_url("NVDA", "D", None, **BASE, options=opts)
    assert before != after, (
        "the base version produced the same URL for a stale render, so the matrix above is "
        "comparing something that never changed")
    assert "stale=" not in before and "stale=" in after


def test_the_prefs_the_bot_actually_sends_carry_no_vintage_keys():
    """The reason the matrix above is exhaustive enough to matter: `render_options` is what every
    pre-V2 call site passes, and it cannot grow a `stale` or an `as_of` without this going red."""
    from api.services import discord_chart_prefs as prefs
    for p in ({}, {"mas": "off", "volume": False}, {"style": "heikin", "theme": "dark"},
              {"stats": False}, {"zoom": "3m", "ext": True, "indicators": "rsi"}):
        opts = prefs.render_options(p)
        assert "stale" not in opts and "as_of" not in opts, (
            f"render_options({p!r}) now carries a vintage key, so the pre-V2 URL has changed")
        assert "stale=" not in house.build_render_url("NVDA", "D", STATS, **BASE, options=opts)
