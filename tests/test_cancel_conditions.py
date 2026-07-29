"""
Cancel-condition drop-set (2026-07-28): 206 was the documented §4 gap.
Verified against /v3/reference/conditions — 201-207 are the cancel/late/
out-of-sequence family (updates_volume == False); 208+ update volume.
"""

import os
import tempfile

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="mp_"))

from api.massive_processor import CANCEL_CONDITIONS


def test_cancel_family_201_to_207_all_dropped():
    for c in (201, 202, 203, 204, 205, 206, 207):
        assert c in CANCEL_CONDITIONS, f"{c} should be dropped (updates_volume False)"


def test_206_gap_closed():
    assert 206 in CANCEL_CONDITIONS


def test_volume_updating_codes_not_dropped():
    # 208 "Opening Trade and Late" + 209 "Automatic Execution" update volume —
    # real trades, must NOT be filtered out.
    assert 208 not in CANCEL_CONDITIONS
    assert 209 not in CANCEL_CONDITIONS
