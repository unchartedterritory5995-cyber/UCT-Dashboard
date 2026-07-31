"""Week-ahead calendar cards + the Saturday Discord post.

The renderers are dumb and deterministic (selection/ranking is the poster's
job), so they can be pinned exactly. The poster's job is mostly refusals:
don't post a hollow card, don't post twice, and never let `live` fall back into
the admin channel.
"""
import pathlib
from datetime import date
from unittest import mock

import pytest

from api.services import calendar_week_poster as poster
from api.services.calendar_week_png import (
    MAX_ECON_PER_DAY, MAX_PER_SESSION,
    render_earnings_week_png, render_econ_week_png,
)

MON = date(2026, 8, 3)

import tempfile
_TMP = pathlib.Path(tempfile.mkdtemp(prefix="uct-logo-"))


def _ent(sym, mc=10.0):
    return {"sym": sym, "mc_b": mc, "logo_path": None}


def _day(label, n_bmo=3, n_amc=3, overflow=0, total=None):
    return {
        "label": label,
        "total": total,
        "bmo": [_ent(f"B{i}") for i in range(n_bmo)],
        "amc": [_ent(f"A{i}") for i in range(n_amc)],
        "overflow": overflow,
    }


def _png_size(b: bytes) -> tuple[int, int]:
    from io import BytesIO
    from PIL import Image
    return Image.open(BytesIO(b)).size


# ── Renderers ─────────────────────────────────────────────────────────────────

def test_earnings_card_is_deterministic():
    days = [_day(f"DAY {i}") for i in range(5)]
    assert render_earnings_week_png("Week of Aug 3-7, 2026", days) == \
           render_earnings_week_png("Week of Aug 3-7, 2026", days)


def test_econ_card_is_deterministic():
    days = [{"label": "MON 3", "events": [
        {"time": "8:30 AM", "event": "CPI m/m", "estimate": "0.2%",
         "prior": "0.3%", "is_fed": False}]}]
    assert render_econ_week_png("W", days) == render_econ_week_png("W", days)


def test_cards_size_to_content_not_to_a_fixed_canvas():
    """A quiet week used to render as a mostly-empty letterbox."""
    thin = [_day(f"DAY {i}", n_bmo=1, n_amc=1) for i in range(5)]
    full = [_day(f"DAY {i}", n_bmo=MAX_PER_SESSION, n_amc=MAX_PER_SESSION) for i in range(5)]
    tw, th = _png_size(render_earnings_week_png("W", thin))
    fw, fh = _png_size(render_earnings_week_png("W", full))
    assert tw == fw == 1600
    assert th < fh


def test_a_busy_day_draws_only_the_cap_but_still_renders():
    days = [_day("MON 3", n_bmo=40, n_amc=40, overflow=200, total=280)]
    b = render_earnings_week_png("W", days)
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    # Height is bounded by the per-session cap, not by the 40 supplied.
    _, h = _png_size(b)
    assert h < 1200


def test_empty_week_renders_a_message_card_not_a_blank_grid():
    b = render_earnings_week_png("W", [_day("MON 3", n_bmo=0, n_amc=0)])
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    b2 = render_econ_week_png("W", [{"label": "MON 3", "events": []}])
    assert b2[:8] == b"\x89PNG\r\n\x1a\n"


def test_econ_card_handles_missing_estimate_and_prior():
    """Fed speakers carry neither — must not crash or print 'None'."""
    days = [{"label": "MON 3", "events": [
        {"time": "1:00 PM", "event": "FOMC Member Speaks",
         "estimate": None, "prior": None, "is_fed": True}]}]
    assert render_econ_week_png("W", days)[:8] == b"\x89PNG\r\n\x1a\n"


def test_renderers_never_touch_the_network():
    days = [_day("MON 3")]
    with mock.patch("requests.get", side_effect=AssertionError("network!")), \
         mock.patch("requests.post", side_effect=AssertionError("network!")):
        render_earnings_week_png("W", days)
        render_econ_week_png("W", [{"label": "MON 3", "events": []}])


# ── Webhook targeting ─────────────────────────────────────────────────────────

def test_live_never_falls_back_to_the_admin_channel(monkeypatch):
    """An unset production webhook must STOP the post, not redirect it."""
    monkeypatch.delenv("DISCORD_EVENT_CALENDAR_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://admin.example/hook")
    monkeypatch.setenv("DISCORD_EVENT_CALENDAR_TEST_WEBHOOK_URL", "https://test.example/hook")
    url, _ = poster.resolve_webhook("live")
    assert url == ""


def test_test_target_falls_back_to_admin_so_a_dry_run_needs_no_setup(monkeypatch):
    monkeypatch.delenv("DISCORD_EVENT_CALENDAR_TEST_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://admin.example/hook")
    url, name = poster.resolve_webhook("test")
    assert url == "https://admin.example/hook"
    assert "admin-fallback" in name


def test_test_target_prefers_its_own_webhook(monkeypatch):
    monkeypatch.setenv("DISCORD_EVENT_CALENDAR_TEST_WEBHOOK_URL", "https://test.example/hook")
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://admin.example/hook")
    url, name = poster.resolve_webhook("test")
    assert url == "https://test.example/hook"
    assert name == "test"


# ── The job ───────────────────────────────────────────────────────────────────

@pytest.fixture
def _isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr(poster, "_STATE_PATH", str(tmp_path / "posts.json"))
    monkeypatch.setenv("DISCORD_EVENT_CALENDAR_WEBHOOK_URL", "https://live.example/hook")


def test_an_empty_calendar_aborts_the_post_and_alerts(_isolated_state):
    """A scheduled job that 'succeeds' with an empty card is worse than one
    that fails loudly — this is the silent-success failure mode."""
    empty = ([{"label": "MON 3", "total": None, "bmo": [], "amc": [], "overflow": 0}],
             [{"label": "MON 3", "events": []}])
    with mock.patch.object(poster, "build_payloads", return_value=empty), \
         mock.patch.object(poster, "_post_two_images") as post_m, \
         mock.patch.object(poster, "_alert_admin") as alert_m:
        out = poster.post_week(target="live", monday=MON)

    assert out["ok"] is False and out["reason"] == "empty_calendar"
    post_m.assert_not_called()
    alert_m.assert_called_once()


def test_empty_earnings_aborts_even_when_econ_is_healthy(_isolated_state):
    """THE 2026-07-30 BAD POST: a Finnhub 429 emptied the earnings set while
    econ came back fine, and the old `earnings==0 AND econ==0` guard let it
    through — the card shipped reading "No scheduled reporters for this week".
    A trading week with zero reporters does not exist, so that reading is always
    a provider failure; and both images ride in ONE message, so a hollow
    earnings card makes the whole post a lie."""
    broken = ([{"label": "MON 3", "total": None, "bmo": [], "amc": [], "overflow": 0}],
              [{"label": "MON 3", "events": [
                  {"time": "8:30 AM", "event": "CPI", "estimate": "0.2%",
                   "prior": "0.3%"}]}])
    with mock.patch.object(poster, "build_payloads", return_value=broken), \
         mock.patch.object(poster, "_post_two_images") as post_m, \
         mock.patch.object(poster, "_alert_admin") as alert_m:
        out = poster.post_week(target="live", monday=MON)

    assert out["ok"] is False and out["reason"] == "empty_calendar"
    post_m.assert_not_called()
    alert_m.assert_called_once()


def test_a_quiet_macro_week_still_posts(_isolated_state):
    """Econ is judged SEPARATELY from earnings: a week with no major releases is
    real, and its card says so honestly. Only empty earnings blocks the post."""
    payloads = ([_day("MON 3")], [{"label": "MON 3", "events": []}])
    with mock.patch.object(poster, "build_payloads", return_value=payloads), \
         mock.patch.object(poster, "_post_two_images", return_value=True) as post_m:
        out = poster.post_week(target="live", monday=MON)
    assert out["ok"] is True and out["econ"] == 0
    post_m.assert_called_once()


def test_a_populated_week_posts_once_and_dedupes(_isolated_state):
    payloads = ([_day("MON 3")], [{"label": "MON 3", "events": [
        {"time": "8:30 AM", "event": "CPI", "estimate": "0.2%", "prior": "0.3%"}]}])
    with mock.patch.object(poster, "build_payloads", return_value=payloads), \
         mock.patch.object(poster, "_post_two_images", return_value=True) as post_m:
        first = poster.post_week(target="live", monday=MON)
        second = poster.post_week(target="live", monday=MON)

    assert first["ok"] and first["earnings"] == 6
    assert post_m.call_count == 1                  # the second run is deduped
    assert second.get("skipped") == "already_posted"


def test_force_bypasses_the_dedup_guard(_isolated_state):
    payloads = ([_day("MON 3")], [{"label": "MON 3", "events": []}])
    with mock.patch.object(poster, "build_payloads", return_value=payloads), \
         mock.patch.object(poster, "_post_two_images", return_value=True) as post_m:
        poster.post_week(target="live", monday=MON)
        poster.post_week(target="live", monday=MON, force=True)
    assert post_m.call_count == 2


def test_test_and_live_dedupe_independently(_isolated_state, monkeypatch):
    """A dry run must not consume the week's live slot."""
    monkeypatch.setenv("DISCORD_EVENT_CALENDAR_TEST_WEBHOOK_URL", "https://test.example/hook")
    payloads = ([_day("MON 3")], [{"label": "MON 3", "events": []}])
    with mock.patch.object(poster, "build_payloads", return_value=payloads), \
         mock.patch.object(poster, "_post_two_images", return_value=True) as post_m:
        poster.post_week(target="test", monday=MON)
        poster.post_week(target="live", monday=MON)
    assert post_m.call_count == 2


def test_a_discord_failure_does_not_record_the_week_as_posted(_isolated_state):
    """Otherwise a transient 500 would permanently silence that week."""
    payloads = ([_day("MON 3")], [{"label": "MON 3", "events": []}])
    with mock.patch.object(poster, "build_payloads", return_value=payloads), \
         mock.patch.object(poster, "_post_two_images", return_value=False):
        out = poster.post_week(target="live", monday=MON)
    assert out["ok"] is False
    assert not poster.already_posted(MON.isoformat(), "live")


def test_the_job_never_raises(_isolated_state):
    with mock.patch.object(poster, "build_payloads", side_effect=RuntimeError("boom")):
        out = poster.post_week(target="live", monday=MON)
    assert out["ok"] is False


def test_scheduled_entry_point_is_inert_without_the_flag(monkeypatch):
    monkeypatch.delenv("CALENDAR_WEEK_POST_ENABLED", raising=False)
    with mock.patch.object(poster, "post_week") as m:
        poster.run_scheduled_post()
    m.assert_not_called()


def test_week_label_spans_a_month_boundary():
    assert poster.week_label(date(2026, 8, 3)) == "Week of Aug 3-7, 2026"
    assert poster.week_label(date(2026, 6, 29)) == "Week of Jun 29 - Jul 3, 2026"


# ── The shared-chrome extraction must not have changed the existing card ──────

def test_most_anticipated_card_render_is_pinned():
    """calendar_png_common is shared by all three cards, so a change there
    reaches this already-shipped one too. The hash is a TRIPWIRE, not a
    freeze: when a deliberate chrome change trips it, look at the render and
    re-pin. Last re-pinned 2026-07-30 for the full-bleed logo tile (which
    also nudged the monogram corner radius 0.22 -> 0.24)."""
    import hashlib
    from api.services.calendar_anticipated_png import render_anticipated_png
    entries = [
        {"sym": "AAPL", "name": "Apple Inc.", "timing": "amc", "weekday": "MON",
         "mc_b": 3400.0, "logo_path": None},
        {"sym": "MSFT", "name": "Microsoft Corporation", "timing": "bmo",
         "weekday": "WED", "mc_b": 3100.0, "logo_path": None},
        {"sym": "NVDA", "name": "NVIDIA Corporation", "timing": "amc",
         "weekday": "THU", "mc_b": 4200.0, "logo_path": None},
        {"sym": "XOM", "name": "Exxon Mobil Corporation", "timing": "bmo",
         "weekday": "FRI", "mc_b": 480.0, "logo_path": None},
        {"sym": "KO", "name": "The Coca-Cola Company", "timing": "bmo",
         "weekday": "TUE", "mc_b": 290.5, "logo_path": None},
        {"sym": "F", "name": "Ford Motor Company", "timing": "amc",
         "weekday": "TUE", "mc_b": 0.42, "logo_path": None},
    ]
    got = hashlib.sha256(
        render_anticipated_png("Week of Aug 3-7, 2026", entries)).hexdigest()
    assert got == "f1ae5925d8d831afff593177813d75518587518dca245ce9b3bfc17075e86d0c"
    empty = hashlib.sha256(render_anticipated_png("Week of Aug 3-7, 2026", [])).hexdigest()
    assert empty == "9e753e7faf45d06b12f4f6605c03c5024e0f7e333bb7ebf85593ea1ade2fef21"


def test_econ_cap_constant_is_respected():
    events = [{"time": "8:30 AM", "event": f"E{i}", "estimate": None, "prior": None}
              for i in range(MAX_ECON_PER_DAY + 5)]
    assert render_econ_week_png("W", [{"label": "MON 3", "events": events}])[:8] \
        == b"\x89PNG\r\n\x1a\n"


# ── The logo-forward redesign's contract ──────────────────────────────────────

def test_a_session_is_a_full_grid_with_no_ragged_row():
    """The logo block reads as a block; a ragged last row breaks the rhythm
    that makes the card scannable."""
    from api.services.calendar_week_png import GRID_COLS, GRID_ROWS
    assert MAX_PER_SESSION == GRID_COLS * GRID_ROWS


def test_the_renderer_survives_a_missing_logo():
    """Coverage is ~99.5% but never 100 — a miss must fall back to a monogram,
    not blow up the Saturday post."""
    days = [{"label": "MON 3", "total": 2, "overflow": 0,
             "bmo": [{"sym": "NOSUCH", "mc_b": 1.0, "logo_path": None},
                     {"sym": "ALSONONE", "mc_b": 1.0, "logo_path": "/nope/x.png"}],
             "amc": []}]
    assert render_earnings_week_png("W", days)[:8] == b"\x89PNG\r\n\x1a\n"


def test_econ_fetch_cap_matches_what_the_card_draws():
    """Otherwise the ranking picks an event the renderer then cuts."""
    import inspect
    from api.services import calendar_week_poster as p
    src = inspect.getsource(p.build_payloads)
    assert "limit_per_day=MAX_ECON_PER_DAY" in src


def test_a_logo_with_its_own_background_renders_edge_to_edge():
    """84 of 93 cached logos ship pre-composited on their own opaque
    background (white, brand colour, black). Padding those onto ANOTHER plate
    threw away the colour that makes a 54px tile identifiable — the reason the
    first pass read flatter than the board it mirrors."""
    from PIL import Image
    from api.services.calendar_png_common import logo_tile

    brand = Image.new("RGBA", (256, 256), (237, 28, 36, 255))   # opaque red mark
    path = str(_TMP / "brand.png")
    brand.save(path)
    tile = logo_tile("X", 54, path)
    # Sample near the TOP EDGE, inside the rounded mask: the contain path pads
    # with a light plate there, the cover path carries the brand colour to the
    # edge. The centre pixel is red under BOTH paths, so asserting on it would
    # pass vacuously.
    assert tile.getpixel((27, 3))[:3] == (237, 28, 36)


def test_a_transparent_logo_still_gets_a_light_plate():
    """A dark glyph on a transparent background would vanish edge-to-edge on
    the dark panel, so that minority keeps the contained light plate."""
    from PIL import Image, ImageDraw
    from api.services.calendar_png_common import logo_tile

    glyph = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).ellipse([64, 64, 192, 192], fill=(10, 10, 10, 255))
    path = str(_TMP / "glyph.png")
    glyph.save(path)
    tile = logo_tile("X", 54, path)
    # A corner inside the rounded mask is the light plate, not transparent.
    assert tile.getpixel((27, 6))[:3] == (245, 246, 248)


def test_the_post_copy_says_what_it_is_and_where_it_came_from(_isolated_state):
    """Owner-set copy. The cards carry the counts and the week in their own
    headers, so the message body stays to the drop and the source."""
    payloads = ([_day("MON 3")], [{"label": "MON 3", "events": []}])
    seen = {}
    with mock.patch.object(poster, "build_payloads", return_value=payloads), \
         mock.patch.object(poster, "_post_two_images",
                           side_effect=lambda u, c, l, a, b: seen.update({"c": c}) or True):
        poster.post_week(target="live", monday=MON)

    assert seen["c"] == (
        "**Earnings and Economic Events for the week ahead (Aug 3-7, 2026)**\n"
        "UCTIntelligence.com")
