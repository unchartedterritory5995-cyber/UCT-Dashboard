import io

from PIL import Image, ImageDraw

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


def test_evening_is_host_aware():
    # The same evening template serves any host — the "FROM <host>" line changes,
    # so TSDR and Bracco render distinct cards, both at the right size.
    tsdr = t.render_session_thumbnail("June 30, 2026", "EVENING UPDATE FROM TSDR")
    bracco = t.render_session_thumbnail("June 30, 2026", "EVENING UPDATE FROM BRACCO")
    assert Image.open(io.BytesIO(bracco)).size == (1280, 720)
    assert tsdr != bracco


def test_chartmaster_eyebrow_routes_to_plate():
    assert t._resolve_theme(None, "WORKSHOP WITH CHARTMASTER").layout == "plate"


def test_chartmaster_variant_override_routes_to_plate():
    assert t._resolve_theme("chartmaster", "LIVE TRADING SESSION").layout == "plate"


def test_live_trading_still_classic():
    assert t._resolve_theme(None, "LIVE TRADING SESSION").layout == "classic"


def _fake_plate(path, size=(1280, 720)):
    Image.new("RGB", size, (10, 30, 60)).save(path, "PNG")


def test_plate_render_returns_jpeg_1280x720_under_2mb(monkeypatch, tmp_path):
    plate = str(tmp_path / "plate.png")
    _fake_plate(plate)
    monkeypatch.setattr(t, "_PLATE_CHARTMASTER", plate)
    data = t.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER")
    assert data[:2] == b"\xff\xd8"                      # JPEG magic
    img = Image.open(io.BytesIO(data))
    assert img.size == (1280, 720)
    assert len(data) < 2 * 1024 * 1024


def test_plate_cover_fits_non_16x9_source(monkeypatch, tmp_path):
    plate = str(tmp_path / "wide.png")
    _fake_plate(plate, size=(1886, 892))                # ~2.11:1 like the sample
    monkeypatch.setattr(t, "_PLATE_CHARTMASTER", plate)
    data = t.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER")
    assert Image.open(io.BytesIO(data)).size == (1280, 720)


def test_plate_missing_falls_back_to_classic(monkeypatch, tmp_path):
    monkeypatch.setattr(t, "_PLATE_CHARTMASTER", str(tmp_path / "nope.png"))
    data = t.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER")
    classic = t.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER",
        variant="default")
    assert data == classic                              # deterministic Pillow output


def _smoke(eyebrow, variant=None):
    data = t.render_session_thumbnail("July 1, 2026", eyebrow_label=eyebrow,
                                       variant=variant)
    assert data[:2] == b"\xff\xd8"
    img = Image.open(io.BytesIO(data))
    assert img.size == (1280, 720)
    assert len(data) < 2 * 1024 * 1024
    return data


def test_classic_smoke():
    _smoke("LIVE TRADING SESSION")


def test_classic_long_arbitrary_eyebrow_no_crash():
    _smoke("SUPER EXTENDED WEEKEND DEEP DIVE MASTERCLASS MARATHON SESSION")


def test_editorial_smoke():
    _smoke("THOUGHTS ON THE MARKET")


def test_editorial_long_title_no_crash():
    # Regression: long editorial titles must render without overflowing the gold
    # frame or crashing. Exercises the multi-line headline fitting logic
    # (~lines 487-501 in _render_editorial).
    _smoke("A REMARKABLY LONG AND WINDING REFLECTION ON EVERYTHING THE MARKET DID THIS QUARTER")


def test_fit_tracked_truncates_when_floor_overflows():
    img = Image.new("RGB", (1280, 720))
    d = ImageDraw.Draw(img)
    long_text = "— " + ("VERY LONG WEBINAR NAME " * 12).strip() + " —"
    f, fitted = t._fit_tracked(d, long_text, "DejaVuSans-Bold.ttf", 20, 10, 1280 - 120, 5)
    assert t._tracked_w(d, fitted, f, 5) <= 1280 - 120
    assert fitted.endswith("…")


def test_evening_smoke_host_aware():
    _smoke("EVENING UPDATE FROM TSDR")


def test_evening_smoke_no_host():
    _smoke("EVENING UPDATE")


def test_same_inputs_render_identical_bytes():
    a = t.render_session_thumbnail("July 1, 2026", eyebrow_label="LIVE TRADING SESSION")
    b = t.render_session_thumbnail("July 1, 2026", eyebrow_label="LIVE TRADING SESSION")
    assert a == b


def test_different_dates_render_different_cards():
    a = t.render_session_thumbnail("July 1, 2026", eyebrow_label="LIVE TRADING SESSION")
    b = t.render_session_thumbnail("July 2, 2026", eyebrow_label="LIVE TRADING SESSION")
    assert a != b
    a = t.render_session_thumbnail("July 1, 2026", eyebrow_label="EVENING UPDATE FROM TSDR")
    b = t.render_session_thumbnail("July 2, 2026", eyebrow_label="EVENING UPDATE FROM TSDR")
    assert a != b


def test_gen_trend_bounds_over_many_seeds():
    # Regression for the "tower candle" bug: the old implementation force-set
    # values[-1] = end unconditionally, so the final close-open delta could
    # blow past the documented +-0.22 step bound (median 0.28, max ~0.92 over
    # a seed sweep). Every step, including the last, must now stay in-bounds.
    for s in range(10_000):
        vals = t._gen_trend(s)
        assert all(0.0 <= v <= 1.0 for v in vals)
        assert 0.90 <= vals[-1] <= 1.0
        deltas = [b - a for a, b in zip(vals, vals[1:])]
        assert all(-0.125 <= d <= 0.225 for d in deltas), (s, deltas)
        assert 2 <= sum(1 for d in deltas if d < 0) <= 4
