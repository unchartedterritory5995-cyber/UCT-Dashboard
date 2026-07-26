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


def test_chartmaster_eyebrow_space_insensitive_routes_to_plate():
    # A Zoom template renamed "Workshop with Chart Master" (space between
    # Chart/Master) must still route to the plate layout.
    assert t._resolve_theme(None, "WORKSHOP WITH CHART MASTER").layout == "plate"


def test_chartmaster_variant_override_routes_to_plate():
    assert t._resolve_theme("chartmaster", "LIVE TRADING SESSION").layout == "plate"


def test_live_trading_still_classic():
    assert t._resolve_theme(None, "LIVE TRADING SESSION").layout == "classic"


def test_zen_eyebrow_routes_to_zen():
    assert t._resolve_theme(None, "WORKSHOP WITH ZEN").layout == "zen"
    assert t._resolve_theme(None, "Zen Workshop").layout == "zen"


def test_zen_word_boundary_avoids_false_friends():
    # "zen" routes only as a whole word — substrings must NOT hijack the card.
    assert t._resolve_theme(None, "CITIZEN INSIGHTS").layout == "classic"
    assert t._resolve_theme(None, "ZENITH REVIEW").layout == "classic"


def test_zen_variant_override_routes_to_zen():
    assert t._resolve_theme("zen", "LIVE TRADING SESSION").layout == "zen"


def test_zen_render_returns_jpeg_1280x720_under_2mb():
    data = t.render_session_thumbnail("July 20, 2026", eyebrow_label="WORKSHOP WITH ZEN")
    assert data[:2] == b"\xff\xd8"                      # JPEG magic
    img = Image.open(io.BytesIO(data))
    assert img.size == (1280, 720)
    assert len(data) < 2 * 1024 * 1024


def test_zen_missing_asset_falls_back_to_classic(monkeypatch, tmp_path):
    # A missing/corrupt Zen mark must never break a publish — it falls back to
    # the deterministic classic branded card (mirrors the plate fallback).
    monkeypatch.setattr(t, "_ZEN_LOGO", str(tmp_path / "nope.png"))
    data = t.render_session_thumbnail("July 20, 2026", eyebrow_label="WORKSHOP WITH ZEN")
    classic = t.render_session_thumbnail("July 20, 2026", eyebrow_label="WORKSHOP WITH ZEN",
                                         variant="default")
    assert data == classic


def test_zen_smoke_and_long_name():
    _smoke("WORKSHOP WITH ZEN")
    _smoke("WORKSHOP WITH ZEN AND FRIENDS EXTRA LONG BONUS DEEP DIVE MARATHON")


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


# --- Sunday Scans (dawn horizon + scanner results strip) --------------------

def _px(data, xy):
    return Image.open(io.BytesIO(data)).convert("RGB").getpixel(xy)


def test_sunday_scans_eyebrow_routes_to_sunday():
    assert t._resolve_theme(None, "SUNDAY SCANS").layout == "sunday"
    assert t._resolve_theme(None, "Sunday Scan").layout == "sunday"
    # A weekday show must NOT get pulled into the dawn card.
    assert t._resolve_theme(None, "LIVE TRADING SESSION").layout == "classic"


def test_sunday_variant_override_routes_to_sunday():
    assert t._resolve_theme("sunday", "LIVE TRADING SESSION").layout == "sunday"
    assert t._resolve_theme("scans", "LIVE TRADING SESSION").layout == "sunday"


def test_sunday_render_is_1280x720_jpeg_under_2mb_and_distinct():
    data = t.render_session_thumbnail("July 26, 2026", eyebrow_label="SUNDAY SCANS")
    im = Image.open(io.BytesIO(data))
    assert im.size == (1280, 720) and im.format == "JPEG"
    assert len(data) < 2_000_000            # YouTube thumbnails.set hard limit
    default = t.render_session_thumbnail("July 26, 2026", eyebrow_label="LIVE TRADING SESSION")
    assert data != default


def test_sunday_paints_a_warm_horizon_over_a_dark_ground():
    # The card's whole identity is "light low, not high": a warm dawn band at the
    # horizon with dark ground beneath it. Assert the rendered PIXELS, so a
    # gradient/stop regression that flattens the scene actually fails here.
    data = t.render_session_thumbnail("July 26, 2026", eyebrow_label="SUNDAY SCANS")
    hr, hg, hb = _px(data, (640, 508))      # just above the horizon line
    assert hr > 150 and hr > hg > hb        # warm amber, red-dominant
    # Ground, just below the horizon on the SAME column. The sun's glow bleeds
    # a little past the horizon by design, so assert the drop relative to the
    # dawn band rather than an absolute floor.
    gr, gg, gb = _px(data, (640, 536))
    assert gr < hr * 0.6                    # ground clearly darker than the band
    # Off to the side, clear of the sun, the ground is properly dark.
    assert max(_px(data, (120, 536))) < 70
    tr, tg, tb = _px(data, (4, 4))          # upper sky stays deep indigo
    assert tb > tr and max(tr, tg, tb) < 90


def test_sunday_scan_tiles_are_translucent_not_solid_gold():
    # Regression: translucent ink drawn STRAIGHT onto the RGBA base sets the
    # pixel alpha instead of blending, so the tiles came out as solid gold
    # blocks after convert("RGB"). They must composite as faint gold over the
    # dark ground. Sample inside the first tile, below its sparkline.
    data = t.render_session_thumbnail("July 26, 2026", eyebrow_label="SUNDAY SCANS")
    r, g, b = _px(data, (110, 641))
    assert (r, g, b) != (201, 168, 76)
    assert r < 90 and g < 85, f"tile interior rendered opaque: {(r, g, b)}"


def test_sunday_is_deterministic_for_the_same_episode():
    a = t.render_session_thumbnail("July 26, 2026", eyebrow_label="SUNDAY SCANS")
    b = t.render_session_thumbnail("July 26, 2026", eyebrow_label="SUNDAY SCANS")
    assert a == b
    c = t.render_session_thumbnail("August 2, 2026", eyebrow_label="SUNDAY SCANS")
    assert c != a                            # a different week varies the strip


def test_sunday_handles_a_long_eyebrow_without_clipping():
    data = t.render_session_thumbnail(
        "July 26, 2026", eyebrow_label="SUNDAY SCANS WITH THE WHOLE DESK TEAM AND FRIENDS")
    assert Image.open(io.BytesIO(data)).size == (1280, 720)
