"""C-07's producer: the V2 render call puts the DATA's vintage where the URL can carry it.

⛔⛔ WHY THIS FILE EXISTS AS ITS OWN RAIL. Lane D built the whole chain — `badge.vintage_param` →
`build_render_url`'s `?stale=` → the page drawing it → a golden over the URL — and then reported,
honestly, that **nothing in production put a vintage into the options.** Every piece was built,
tested, green and reachable by nobody: this repo's most-repeated defect, and the one a component
test is structurally blind to (`lesson_built_tested_green_and_unreachable`).

⭐ THE SEAM IS THE ADAPTER, NOT `produce_chart`. The freshness envelope exists only on the V2 path
— the bars adapter derives it, `bindings.house_fn` carries it onto the render request — so the
producer lives where the envelope already is. The pre-V2 path has no envelope, passes neither key,
and its URL stays byte-for-byte what it was. That is the same trade the C-04 fold made.
"""
from __future__ import annotations

from api.services.discord_render import freshness
from api.services.discord_render.adapters import renderer as renderer_ad

PNG = b"\x89PNG\r\n\x1a\n" + b"body"


def _env(stale, as_of="Sep 11"):
    return freshness.Envelope(as_of_utc=None, as_of_et=as_of, provider="bars",
                              session_state="closed", age_s=None, budget_s=None, stale=stale)


def _capture(envelope, options=None):
    """Run a real render through the adapter and return the options the house call received."""
    seen: dict = {}

    def house(sym, tf, stats, opts):
        seen.update(opts or {})
        return PNG

    res = renderer_ad.fetch(renderer_ad.RenderRequest(
        ticker="NVDA", tf="D", stats={}, options=dict(options or {}),
        remaining_s=5.0, envelope=envelope), house_fn=house)
    assert res.ok, f"the render failed, so nothing about its options is measurable: {res.reason()}"
    return seen


def test_a_stale_envelope_reaches_the_render_call_as_a_vintage_the_url_can_carry():
    """The end of the chain, measured at the one seam that decides it."""
    opts = _capture(_env(True))
    assert opts["stale"] is True and opts["as_of"] == "Sep 11"

    from api.services.discord_chart_house import build_render_url
    url = build_render_url("NVDA", "D", {}, base_url="https://x", token="T", options=opts)
    assert "stale=" in url, "the vintage reached the options and still did not reach the URL"


def test_a_fresh_envelope_produces_no_badge_even_though_the_verdict_travels():
    """⛔ FRESH IS NOT A BADGE, and the place that decides that is `badge.render_badge`, not here.

    The verdict still travels — `stale=False` is a real answer — but it must draw nothing. A badge
    on every chart is furniture, and furniture is not there on the day it matters (04 §2)."""
    opts = _capture(_env(False))
    assert opts["stale"] is False
    from api.services.discord_chart_house import build_render_url
    assert "stale=" not in build_render_url("NVDA", "D", {}, base_url="https://x", token="T",
                                            options=opts)


def test_an_unknown_vintage_is_carried_as_unknown_and_never_as_fresh():
    """⛔ THE TRI-STATE IS THE POINT. `None` means we could not tell, which is NOT `False`. It must
    survive the trip as `None` — a `setdefault` here would be unable to tell a deliberate `None`
    from an absent key, and the deliberate one would be silently replaced."""
    opts = _capture(_env(None))
    assert "stale" in opts and opts["stale"] is None, (
        "an unknown vintage was dropped or coerced; unknown must not read as fresh")


def test_a_callers_own_vintage_is_never_overwritten():
    """A second authority over one value is what this chain exists to remove."""
    opts = _capture(_env(True, as_of="Sep 11"), options={"stale": False, "as_of": "Sep 12"})
    assert opts["stale"] is False and opts["as_of"] == "Sep 12"


def test_no_envelope_leaves_the_options_untouched_which_is_the_prev2_guarantee():
    """⛔ THE NON-VACUITY CONTROL FOR THE BYTE-FOR-BYTE CLAIM. The pre-V2 path passes no envelope;
    if the adapter added a key anyway, every pre-V2 render URL would move."""
    opts = _capture(None, options={"darkpool": False})
    assert opts == {"darkpool": False}, f"the adapter added keys with no envelope: {opts}"


def test_the_producer_is_actually_on_the_path_a_chart_takes():
    """⛔ AND THE WHOLE POINT: `bindings.house_fn` must hand the bars envelope to the adapter.

    Reads the real binding rather than the adapter in isolation — the adapter being correct while
    nothing calls it with an envelope is precisely the state this file was written to end."""
    import inspect

    from api.services.discord_render.adapters import bindings
    src = inspect.getsource(bindings.house_fn)
    assert "envelope=" in src, "house_fn stopped passing an envelope; the producer has no input"
    # The control: prove the probe can fail by asking for something that is not there.
    assert "envelope_not_a_real_kwarg=" not in src
