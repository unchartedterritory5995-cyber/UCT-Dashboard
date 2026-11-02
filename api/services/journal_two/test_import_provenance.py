"""`import_provenance`: the ONE "edited since import" rule and its legacy-finalize extension
(Plan B Task 10, controller ruling R4). Pure: no database, no filesystem."""
from datetime import datetime, timedelta, timezone

import pytest

from api.services.journal_two import import_provenance as ip

T = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc)


def _iso(dt):
    return dt.isoformat()


def _shape(*, updated_s, media_s, later=False, imported=T):
    """legacy_finalize_shape with times given as seconds after `imported`."""
    media = None if media_s is None else (imported + timedelta(seconds=media_s)).timestamp()
    return ip.legacy_finalize_shape(_iso(imported + timedelta(seconds=updated_s)), _iso(imported), media, later)


def test_the_base_rule_is_unchanged():
    assert ip.edited_since_import(_iso(T + timedelta(seconds=1)), _iso(T))
    assert not ip.edited_since_import(_iso(T), _iso(T))
    assert not ip.edited_since_import(_iso(T), None)          # missing stamp: not known edited
    assert not ip.edited_since_import("garbage", _iso(T))


def test_stamp_readable():
    assert ip.stamp_readable(_iso(T)) and ip.stamp_readable("2026-10-01T12:00:00Z")
    for junk in (None, "", "not a date", 5):
        assert not ip.stamp_readable(junk), junk


def test_legacy_finalize_shape_reads_the_importers_own_finalize_put():
    # media copied 590 s after confirm, the finalize PUT 5 s later, no later version
    assert _shape(updated_s=595, media_s=590)


@pytest.mark.parametrize(("updated_s", "media_s", "later", "why"), [
    (595, 590, True, "a version captured after the import is a member edit"),
    (595, None, False, "no media: nothing to place the finalize write"),
    (ip.LEGACY_FINALIZE_WINDOW_S + 10, ip.LEGACY_FINALIZE_WINDOW_S + 1, False, "media too long after import"),
    (5, -10, False, "media older than the import"),
    (590 + ip.LEGACY_FINALIZE_SLACK_S + 1, 590, False, "write too long after the media"),
    (589, 590, False, "write before the media"),
])
def test_legacy_finalize_shape_refuses_anything_else(updated_s, media_s, later, why):
    assert not _shape(updated_s=updated_s, media_s=media_s, later=later), why


def test_legacy_finalize_shape_bounds_are_inclusive():
    w, s = ip.LEGACY_FINALIZE_WINDOW_S, ip.LEGACY_FINALIZE_SLACK_S
    assert _shape(updated_s=w + s, media_s=w)
    assert _shape(updated_s=0, media_s=0)


def test_legacy_finalize_shape_refuses_unreadable_stamps():
    media = (T + timedelta(seconds=10)).timestamp()
    assert not ip.legacy_finalize_shape(None, _iso(T), media, False)
    assert not ip.legacy_finalize_shape(_iso(T + timedelta(seconds=12)), "nope", media, False)
    assert not ip.legacy_finalize_shape(_iso(T + timedelta(seconds=12)), _iso(T), "nope", False)


def test_the_window_and_slack_constants():
    assert ip.LEGACY_FINALIZE_WINDOW_S == 7200 and ip.LEGACY_FINALIZE_SLACK_S == 120
