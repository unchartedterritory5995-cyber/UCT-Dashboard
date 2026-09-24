"""The round-trip fixture proves its archive readable BEFORE the test gets it.

`roundtrip_export_fixture.py` used to print the export zip base64-encoded on
stdout, and anything else the process printed landed inside the payload -- the
JS round-trip test then died in beforeAll on "unknown compression type". Wave-5
re-review, round 4: the archive now goes to a FILE, and only after
`zipfile.testzip` has read every member back. These rails pin that gate; the
JS side (`exportRoundtrip.test.js`) pins the frame and the stray-output cases.
"""
import hashlib
import io
import zipfile
from pathlib import Path

import pytest

from api.services.journal_two.roundtrip_export_fixture import (
    CorruptArchive, write_validated_archive,
)

_NAME = "note.md"
_BODY = b"The thesis holds. Range $5-$10 on $NVDA.\n" * 8


def _stored_zip() -> bytes:
    """A one-member archive, STORED (not deflated), so a flipped byte lands in
    the member's data verbatim and only its CRC can notice."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr(_NAME, _BODY)
    return buf.getvalue()


def _flip_one_data_byte(blob: bytes) -> bytes:
    data_at = blob.index(_BODY)  # stored: the body sits in the archive as-is
    out = bytearray(blob)
    out[data_at + 5] ^= 0x01
    return bytes(out)


def test_a_readable_archive_is_written_whole_and_its_sha256_is_the_files(tmp_path):
    blob = _stored_zip()
    path, sha = write_validated_archive(blob, tmp_path)
    with open(path, "rb") as f:
        on_disk = f.read()
    assert on_disk == blob
    assert sha == hashlib.sha256(on_disk).hexdigest()
    assert [p.resolve() for p in tmp_path.iterdir()] == [Path(path).resolve()]


def test_a_member_that_fails_its_crc_is_refused_and_nothing_is_written(tmp_path):
    bad = _flip_one_data_byte(_stored_zip())
    # non-vacuity: the damage is invisible to the zip's structure -- it still
    # opens and lists its member -- so only a read-back can catch it
    with zipfile.ZipFile(io.BytesIO(bad)) as zf:
        assert zf.namelist() == [_NAME]
    with pytest.raises(CorruptArchive, match="note.md"):
        write_validated_archive(bad, tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_bytes_that_are_not_a_zip_at_all_are_refused_and_nothing_is_written(tmp_path):
    with pytest.raises(zipfile.BadZipFile):
        write_validated_archive(b"UEsDBBQ this is not an archive", tmp_path)
    assert list(tmp_path.iterdir()) == []
