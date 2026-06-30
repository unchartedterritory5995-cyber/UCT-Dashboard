import io

from PIL import Image

from api.services import desk_thumbnail as t


def test_render_returns_1280x720_jpeg():
    data = t.render_session_thumbnail("June 24, 2026")
    assert isinstance(data, (bytes, bytearray)) and len(data) > 5000
    im = Image.open(io.BytesIO(data))
    assert im.size == (1280, 720)
    assert im.format == "JPEG"
    assert im.mode == "RGB"


def test_render_handles_any_date_text():
    # Long month name still renders without raising.
    data = t.render_session_thumbnail("September 30, 2026")
    assert Image.open(io.BytesIO(data)).size == (1280, 720)


def test_render_uses_custom_eyebrow():
    # different session type renders without error at the right size
    data = t.render_session_thumbnail("June 24, 2026", eyebrow_label="POST MARKET RECAP")
    assert Image.open(io.BytesIO(data)).size == (1280, 720)


def _top_left_pixel(data):
    return Image.open(io.BytesIO(data)).convert("RGB").getpixel((4, 4))


def test_thoughts_on_market_uses_distinct_emerald_theme():
    # The "Thoughts on Market" card must look different from Live Trading: its
    # background is emerald (green channel dominates), the default is near-black.
    thoughts = t.render_session_thumbnail("June 24, 2026", eyebrow_label="THOUGHTS ON MARKET")
    default = t.render_session_thumbnail("June 24, 2026", eyebrow_label="LIVE TRADING SESSION")
    assert Image.open(io.BytesIO(thoughts)).size == (1280, 720)
    assert thoughts != default                       # visually distinct bytes

    tr, tg, tb = _top_left_pixel(thoughts)
    assert tg > tr and tg > tb                        # emerald background
    dr, dg, db = _top_left_pixel(default)
    assert dg <= dr + 4 and dg <= db + 8              # dark/neutral background


def test_explicit_variant_overrides_eyebrow():
    # An explicit variant wins even when the eyebrow says something else.
    emerald = t.render_session_thumbnail("June 24, 2026", eyebrow_label="LIVE TRADING SESSION",
                                         variant="thoughts")
    tr, tg, tb = _top_left_pixel(emerald)
    assert tg > tr and tg > tb


def test_evening_update_uses_distinct_twilight_theme():
    # "Evening Update from TSDR" gets its own twilight navy card: the top-left
    # background is blue-dominant, unlike the near-black Live card and the
    # emerald Thoughts card.
    evening = t.render_session_thumbnail("June 29, 2026", eyebrow_label="EVENING UPDATE FROM TSDR")
    default = t.render_session_thumbnail("June 29, 2026", eyebrow_label="LIVE TRADING SESSION")
    assert Image.open(io.BytesIO(evening)).size == (1280, 720)
    assert evening != default                         # visually distinct bytes

    er, eg, eb = _top_left_pixel(evening)
    assert eb > er and eb > eg                         # twilight navy background


def test_evening_resolves_by_eyebrow_and_explicit_variant():
    # Eyebrow keyword routes to the evening layout; explicit variant also works.
    assert t._resolve_theme(None, "EVENING UPDATE FROM TSDR").layout == "evening"
    assert t._resolve_theme("evening", "anything").layout == "evening"
    # Untouched: live stays classic, thoughts stays editorial.
    assert t._resolve_theme(None, "LIVE TRADING SESSION").layout == "classic"
    assert t._resolve_theme(None, "THOUGHTS ON THE MARKET").layout == "editorial"
