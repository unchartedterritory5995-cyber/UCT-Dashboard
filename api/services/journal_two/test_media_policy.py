"""Plan A Task 8: ONE media policy for every server path (spec I-1..I-4, the Q2 cap).

Inputs are built with Pillow in the test; no binary fixtures. The bombs are HEADERS that
claim a huge canvas, never a huge allocation.
"""
from __future__ import annotations

import io
import os
import struct
import zlib

import pytest
from PIL import Image

from api.services.journal_two import media_policy
from api.services.journal_two.media_policy import MediaRejected, normalize_media, sniff_mime

try:
    import pi_heif  # noqa: F401
    _has_pi_heif = True
except ImportError:
    _has_pi_heif = False


def _img_bytes(fmt: str, size=(8, 6), mode="RGB", color=(200, 30, 30), **save) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, fmt, **save)
    return buf.getvalue()


PNG = _img_bytes("PNG")
JPEG = _img_bytes("JPEG")


def _noise_jpeg(w: int, h: int, *, quality=95, exif=None) -> bytes:
    im = Image.frombytes("RGB", (w, h), os.urandom(w * h * 3))
    buf = io.BytesIO()
    kw = {"quality": quality}
    if exif is not None:
        kw["exif"] = exif
    im.save(buf, "JPEG", **kw)
    return buf.getvalue()


def _orientation_exif(value: int) -> bytes:
    ex = Image.Exif()
    ex[0x0112] = value
    return ex.tobytes()


def _decoded(result) -> Image.Image:
    im = Image.open(io.BytesIO(result.data))
    im.load()
    return im


# ── sniffing ─────────────────────────────────────────────────────────────────

def test_declared_mime_parameters_and_binary_octet_stream_are_ignored_in_favour_of_bytes():
    assert normalize_media(PNG, "image/png; charset=binary", "x").mime == "image/png"
    assert normalize_media(PNG, "binary/octet-stream", "quote.ashx").kind == "image"
    # magic bytes beat a declared type that lies the other way too
    assert normalize_media(JPEG, "image/png", "x.png").mime == "image/jpeg"


def test_sniff_falls_back_declared_then_extension_then_octet_stream():
    assert sniff_mime(b"a,b,c", "text/csv; charset=utf-8", "x") == "text/csv"
    assert sniff_mime(b"a,b,c", "binary/octet-stream", "data.csv") == "text/csv"
    assert sniff_mime(b"a,b,c", None, "noext") == "application/octet-stream"
    # a container's magic is refined, never overruled, by a declared subtype of it
    assert sniff_mime(b"PK\x03\x04rest", None, "deck.pptx") == (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation")


def test_nameless_web_clip_image_is_typed_from_content():
    r = normalize_media(JPEG, "", "clip-image")
    assert (r.kind, r.mime) == ("image", "image/jpeg")
    assert r.data == JPEG          # passthrough: bytes untouched


def test_a_declared_image_the_bytes_do_not_confirm_is_kept_as_a_file():
    r = normalize_media(b"\x89PNG-ish" * 64, "image/png", "x.bin")
    assert r.kind == "file" and r.mime == "application/octet-stream"


# ── conversion ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fmt", ["TIFF", "BMP", "AVIF"])
def test_tiff_bmp_avif_convert_to_inline_images_without_originals(fmt):
    r = normalize_media(_img_bytes(fmt), None, f"scan.{fmt.lower()}")
    assert r.kind == "image" and r.mime == "image/jpeg" and r.original is None
    assert r.filename == "scan.jpg"
    assert _decoded(r).size == (8, 6)


def test_conversion_keeps_alpha_as_png():
    r = normalize_media(_img_bytes("TIFF", mode="RGBA", color=(1, 2, 3, 0)), None, "a.tif")
    assert r.mime == "image/png" and _decoded(r).mode == "RGBA"


@pytest.mark.skipif(not _has_pi_heif, reason="pi_heif is not installed (Plan A Task 7)")
def test_heic_converts_and_keeps_the_original_as_a_file():
    import pi_heif
    pi_heif.register_heif_opener()
    heic = _img_bytes("HEIF")
    r = normalize_media(heic, "image/heic", "IMG.heic")
    assert r.kind == "image" and r.mime == "image/jpeg" and r.filename == "IMG.jpg"
    assert r.original is not None
    assert (r.original.kind, r.original.mime, r.original.filename) == ("file", "image/heic", "IMG.heic")
    assert r.original.data == heic


@pytest.mark.skipif(_has_pi_heif, reason="only meaningful while pi_heif is absent")
def test_heic_without_a_decoder_is_a_visible_unsupported_notice_never_a_crash():
    fake_heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64
    assert sniff_mime(fake_heic, None, "IMG.heic") == "image/heic"
    with pytest.raises(MediaRejected) as e:
        normalize_media(fake_heic, "image/heic", "IMG.heic")
    assert e.value.reason == "unsupported"
    assert e.value.marker_text == "IMG.heic can't be shown here"


def test_oversize_photo_is_downscaled_under_5mb():
    big = _noise_jpeg(3000, 2500)
    assert len(big) > media_policy.IMAGE_MAX_BYTES     # the premise: a real oversize photo
    r = normalize_media(big, "image/jpeg", "photo.jpg")
    assert r.kind == "image" and r.mime == "image/jpeg" and r.original is None
    assert len(r.data) <= 5 * 1024 * 1024
    assert max(_decoded(r).size) <= 3000


def test_conversion_applies_exif_orientation(monkeypatch):
    """A rotated photo must never land sideways after a conversion or a downscale."""
    # conversion: a TIFF carrying Orientation=6 (rotate 90 CW), stored 400x200
    im = Image.new("RGB", (400, 200), (10, 200, 10))
    buf = io.BytesIO()
    im.save(buf, "TIFF", exif=_orientation_exif(6))
    r = normalize_media(buf.getvalue(), None, "rot.tif")
    assert _decoded(r).size == (200, 400)
    # downscale: a JPEG over the inline cap, same orientation
    monkeypatch.setattr(media_policy, "IMAGE_MAX_BYTES", 20_000)
    jpg = _noise_jpeg(400, 200, exif=_orientation_exif(6))
    assert len(jpg) > 20_000
    r2 = normalize_media(jpg, "image/jpeg", "rot.jpg")
    out = _decoded(r2)
    assert out.size[0] < out.size[1], out.size            # portrait, as the camera meant it
    assert out.getexif().get(0x0112) in (None, 1)          # nothing left to rotate it again


def test_animated_gif_over_the_cap_keeps_its_first_frame_and_the_original(monkeypatch):
    frames = [Image.frombytes("RGB", (64, 64), os.urandom(64 * 64 * 3)) for _ in range(4)]
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:])
    gif = buf.getvalue()
    monkeypatch.setattr(media_policy, "IMAGE_MAX_BYTES", len(gif) - 1)
    r = normalize_media(gif, "image/gif", "loop.gif")
    assert r.kind == "image" and len(r.data) < len(gif)
    assert r.original is not None and r.original.kind == "file" and r.original.data == gif


# ── files ────────────────────────────────────────────────────────────────────

def test_svg_is_a_downloadable_file_never_an_image():
    svg = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'
    r = normalize_media(svg, "image/svg+xml", "logo.svg")
    assert (r.kind, r.mime) == ("file", "image/svg+xml")


@pytest.mark.parametrize("data,declared,name,mime", [
    (b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 32, None, "clip.mp4", "video/mp4"),
    (b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\x00" * 32, None, "clip.mov", "video/quicktime"),
    (b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 32, None, "a.wav", "audio/wav"),
    (b"PK\x03\x04" + b"\x00" * 64,
     "application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx",
     "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    (b"PK\x03\x04" + b"\x00" * 64, "application/zip", "bundle.zip", "application/zip"),
])
def test_video_audio_office_zip_are_kept_as_files(data, declared, name, mime):
    r = normalize_media(data, declared, name)
    assert (r.kind, r.mime, r.data, r.filename) == ("file", mime, data, name)


# ── refusals ─────────────────────────────────────────────────────────────────

def _bomb_tiff(width=200_000, height=200_000) -> bytes:
    """A little-endian TIFF whose IFD claims a 40-gigapixel greyscale canvas. ~150 bytes."""
    entries = [(256, 4, 1, width), (257, 4, 1, height), (258, 3, 1, 8), (259, 3, 1, 1),
               (262, 3, 1, 1), (273, 4, 1, 8), (278, 4, 1, height), (279, 4, 1, 1)]
    ifd = struct.pack("<H", len(entries))
    for tag, typ, count, value in entries:
        ifd += struct.pack("<HHII", tag, typ, count, value)
    ifd += struct.pack("<I", 0)
    head = b"II*\x00" + struct.pack("<I", 16) + b"\x00" * 8
    return head + ifd


def _bomb_png(width=100_000, height=100_000) -> bytes:
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00")) + chunk(b"IEND", b"")


DISGUISED_HTML = b"<!DOCTYPE html>\n<html><body><script>alert(document.cookie)</script></body></html>"


def test_bomb_and_disguised_html_are_rejected_not_stored():
    for bomb, name in ((_bomb_tiff(), "scan.tif"), (_bomb_png(), "shot.png")):
        assert len(bomb) < 1024
        with pytest.raises(MediaRejected) as e:
            normalize_media(bomb, "image/png", name)
        assert e.value.reason == "too_large", name
    for html in (DISGUISED_HTML, b"  <html xmlns='http://www.w3.org/1999/xhtml'><p>x</p></html>"):
        with pytest.raises(MediaRejected) as e:
            normalize_media(html, "image/png", "chart.png")
        assert e.value.reason == "unsupported"
        assert e.value.marker_text == "chart.png can't be shown here"
    with pytest.raises(MediaRejected) as e:
        normalize_media(b"alert(1)", "application/javascript", "x.js")
    assert e.value.reason == "unsupported"


def test_over_25mb_is_too_large():
    with pytest.raises(MediaRejected) as e:
        normalize_media(b"\x00" * (25 * 1024 * 1024 + 1), "application/zip", "huge.zip")
    assert e.value.reason == "too_large"
    assert e.value.marker_text == "huge.zip is too large to copy (limit 25 MB)"


def test_empty_is_unsupported():
    with pytest.raises(MediaRejected) as e:
        normalize_media(b"", "image/png", "x.png")
    assert e.value.reason == "unsupported"


def test_a_downscale_that_cannot_fit_is_too_large(monkeypatch):
    monkeypatch.setattr(media_policy, "IMAGE_MAX_BYTES", 200)
    with pytest.raises(MediaRejected) as e:
        normalize_media(_noise_jpeg(600, 600), "image/jpeg", "p.jpg")
    assert e.value.reason == "too_large"


def test_media_rejected_carries_reason_and_marker_text():
    e = MediaRejected("storage_limit", "x")
    assert (e.reason, e.marker_text) == ("storage_limit", "x")


# ── the per-member cap ───────────────────────────────────────────────────────

@pytest.fixture
def att_root(tmp_path, monkeypatch):
    from api.services.journal_two import notes as notes_svc
    root = tmp_path / "att"
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", root)
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    media_policy._USAGE_MEMO.clear()
    return root


def test_member_media_bytes_sums_only_that_members_tree(att_root):
    (att_root / "u1" / "notes" / "n1" / "inline").mkdir(parents=True)
    (att_root / "u1" / "notes" / "n1" / "inline" / "a.png").write_bytes(b"x" * 100)
    (att_root / "u1" / "notes" / "n2" / "file").mkdir(parents=True)
    (att_root / "u1" / "notes" / "n2" / "file" / "b.bin").write_bytes(b"x" * 50)
    (att_root / "u2" / "notes" / "n9" / "file").mkdir(parents=True)
    (att_root / "u2" / "notes" / "n9" / "file" / "c.bin").write_bytes(b"x" * 999)
    assert media_policy.member_media_bytes("u1") == 150
    assert media_policy.member_media_bytes("nobody") == 0


def test_the_cap_is_read_at_call_time_and_reserve_refuses_past_it(att_root, monkeypatch):
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 100)
    b = media_policy.MediaBudget.for_member("u1")
    assert b.reserve(60) is True
    assert b.reserve(40) is True           # exactly at the cap is allowed
    assert b.reserve(1) is False


def test_the_default_cap_is_2_gb_and_the_env_overrides_it():
    """In a fresh interpreter: reloading the module here would swap `MediaRejected` under
    every other test's `pytest.raises`."""
    import subprocess
    import sys
    code = ("from api.services.journal_two import media_policy as m; "
            "print(m.MEMBER_IMPORT_MEDIA_CAP_BYTES)")
    env = {k: v for k, v in os.environ.items() if k != "NOTE_IMPORT_MEDIA_CAP_BYTES"}
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    out = subprocess.run([sys.executable, "-c", code], env=env, cwd=root, capture_output=True, text=True)
    assert out.stdout.strip() == str(2 * 1024 ** 3), out.stderr[-2000:]
    env["NOTE_IMPORT_MEDIA_CAP_BYTES"] = "12345"
    out = subprocess.run([sys.executable, "-c", code], env=env, cwd=root, capture_output=True, text=True)
    assert out.stdout.strip() == "12345", out.stderr[-2000:]


def test_a_budget_burst_scans_the_tree_once(att_root, monkeypatch):
    calls = []
    real = media_policy.member_media_bytes
    monkeypatch.setattr(media_policy, "member_media_bytes", lambda u: calls.append(u) or real(u))
    for _ in range(5):
        media_policy.MediaBudget.for_member("u1").reserve(10)
    assert calls == ["u1"]
    # and what a budget reserved is remembered by the next one
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 55)
    assert media_policy.MediaBudget.for_member("u1").reserve(5) is True
    assert media_policy.MediaBudget.for_member("u1").reserve(1) is False


def test_store_media_refuses_with_storage_limit_and_counts_the_original(att_root, monkeypatch):
    original = media_policy.MediaResult(kind="file", mime="image/heic", data=b"h" * 300, filename="IMG.heic")
    result = media_policy.MediaResult(kind="image", mime="image/png", data=PNG, filename="IMG.png",
                                      original=original)
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", len(PNG) + 299)
    with pytest.raises(MediaRejected) as e:
        media_policy.store_media("u1", "n1", result, budget=media_policy.MediaBudget.for_member("u1"))
    assert e.value.reason == "storage_limit"
    assert not att_root.exists() or not any(p.is_file() for p in att_root.rglob("*"))

    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", len(PNG) + 300)
    stored = media_policy.store_media("u1", "n1", result, budget=media_policy.MediaBudget.for_member("u1"))
    assert stored.kind == "image" and stored.url.endswith(".png") and stored.size == len(PNG)
    assert (stored.width, stored.height) == (8, 6)
    assert stored.original.kind == "file" and stored.original.name == "IMG.heic"
    assert stored.original.url.endswith(".heic")


def test_as_file_prefers_the_original_then_the_source_bytes():
    orig = media_policy.MediaResult(kind="file", mime="image/heic", data=b"h", filename="a.heic")
    conv = media_policy.MediaResult(kind="image", mime="image/jpeg", data=b"j", filename="a.jpg", original=orig)
    assert media_policy.as_file(conv) is orig
    plain = media_policy.MediaResult(kind="image", mime="image/png", data=PNG, filename="a.png")
    assert media_policy.as_file(plain).kind == "file" and media_policy.as_file(plain).data == PNG
    tiff = _img_bytes("TIFF")
    converted = normalize_media(tiff, None, "s.tif")
    kept = media_policy.as_file(converted, source=tiff, source_name="s.tif")
    assert (kept.kind, kept.mime, kept.data, kept.filename) == ("file", "image/tiff", tiff, "s.tif")


# ── fix round 1 ──────────────────────────────────────────────────────────────

def test_a_canvas_over_the_decode_ceiling_is_too_large_before_any_decode(monkeypatch):
    """I1: an explicit size check on the header, not Pillow's (thread-unsafe) warning."""
    from PIL import ImageFile
    loads = []
    real_load = ImageFile.ImageFile.load
    monkeypatch.setattr(ImageFile.ImageFile, "load", lambda self: loads.append(1) or real_load(self))
    monkeypatch.setattr(media_policy, "MAX_DECODE_PIXELS", 40 * 40 - 1)
    with pytest.raises(MediaRejected) as e:
        normalize_media(_img_bytes("TIFF", size=(40, 40)), None, "big.tif")
    assert e.value.reason == "too_large"
    assert loads == []                                   # refused on the header alone
    monkeypatch.setattr(media_policy, "MAX_DECODE_PIXELS", 40 * 40)
    assert normalize_media(_img_bytes("TIFF", size=(40, 40)), None, "ok.tif").kind == "image"


def test_the_default_decode_ceiling_is_50_megapixels():
    assert media_policy.MAX_DECODE_PIXELS == 50_000_000


def test_at_most_two_decodes_run_at_once(monkeypatch):
    """I1: one process-wide semaphore, shared by the doors and the engine (both reach here)."""
    import threading
    import time as _time
    active, peak, lock = [0], [0], threading.Lock()
    real_encode = media_policy._encode

    def slow_encode(im, alpha):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        _time.sleep(0.05)
        try:
            return real_encode(im, alpha)
        finally:
            with lock:
                active[0] -= 1

    monkeypatch.setattr(media_policy, "_encode", slow_encode)
    tiff = _img_bytes("TIFF")
    threads = [threading.Thread(target=normalize_media, args=(tiff, None, f"{i}.tif")) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak[0] == media_policy.DECODE_CONCURRENCY == 2


def test_a_big_jpeg_is_decoded_at_a_reduced_scale(monkeypatch):
    """I1: `draft` asks libjpeg for a reduced DCT scale before the load."""
    from PIL import JpegImagePlugin
    sizes = []
    real_draft = JpegImagePlugin.JpegImageFile.draft

    def spy(self, mode, size):
        sizes.append(size)
        return real_draft(self, mode, size)

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "draft", spy)
    monkeypatch.setattr(media_policy, "IMAGE_MAX_BYTES", 1_000)
    monkeypatch.setattr(media_policy, "DOWNSCALE_MAX_EDGE", 100)
    r = normalize_media(_noise_jpeg(800, 200), "image/jpeg", "wide.jpg")
    assert sizes and max(sizes[0]) <= 101
    assert max(_decoded(r).size) <= 100


def test_concurrent_reservations_cannot_exceed_the_cap(att_root, monkeypatch):
    """I3: every budget for a member reserves from ONE running total, atomically."""
    import threading
    import time as _time

    class SlowCap(int):
        """Widens any read-compare-write window: `used + n > cap` calls this first."""
        def __lt__(self, other):
            _time.sleep(0.01)
            return int.__lt__(self, other)

    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", SlowCap(100))
    budgets = [media_policy.MediaBudget.for_member("u1") for _ in range(20)]
    assert sum(b.reserve(10) for b in budgets) == 10          # taken before any reserve, still 10
    media_policy._USAGE_MEMO.clear()
    results, start = [], threading.Barrier(20)

    def go():
        b = media_policy.MediaBudget.for_member("u1")
        start.wait()
        results.append(b.reserve(10))

    threads = [threading.Thread(target=go) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == 10
    assert media_policy.MediaBudget.for_member("u1").used == 100


def test_a_budget_sees_reservations_made_after_it_was_read(att_root, monkeypatch):
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 100)
    engine_pass = media_policy.MediaBudget.for_member("u1")
    assert engine_pass.reserve(50) is True                    # the pass has already reserved
    media_policy.MediaBudget.for_member("u1").reserve(50)    # an upload during the pass
    assert engine_pass.under_cap() is False and engine_pass.reserve(1) is False


@pytest.mark.parametrize("data,name,mime", [
    (b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64, "IMG.heic", "image/heic"),
    (b"\x89PNG\r\n\x1a\n" + b"corrupt" * 10, "broken.png", "image/png"),
    (None, "photo.jpg", "image/jpeg"),
])
def test_file_intent_never_decodes(data, name, mime, monkeypatch):
    """I5: an attached image is kept as the member's bytes: oversize, corrupt or HEIC alike."""
    if data is None:
        monkeypatch.setattr(media_policy, "IMAGE_MAX_BYTES", 100)
        data = _noise_jpeg(64, 64)
    monkeypatch.setattr(media_policy, "_raster", lambda *a: pytest.fail("decoded"))
    r = media_policy.normalize_file(data, mime, name)
    assert (r.kind, r.mime, r.data, r.filename) == ("file", mime, data, name)


def test_file_intent_keeps_the_shared_refusals():
    with pytest.raises(MediaRejected) as e:
        media_policy.normalize_file(DISGUISED_HTML, "text/plain", "notes.txt")
    assert e.value.reason == "unsupported"
    with pytest.raises(MediaRejected) as e:
        media_policy.normalize_file(b"\x00" * (25 * 1024 * 1024 + 1), None, "big.zip")
    assert e.value.reason == "too_large"
    assert media_policy.normalize_file(b"\x89PNG-ish", "image/png", "x").mime == "application/octet-stream"


def _heic_like_result():
    original = media_policy.MediaResult(kind="file", mime="image/heic", data=b"h" * 300, filename="IMG.heic")
    return media_policy.MediaResult(kind="image", mime="image/png", data=PNG, filename="IMG.png",
                                    original=original)


def test_a_primary_that_fails_after_the_original_leaves_no_file_and_no_reservation(att_root, monkeypatch):
    """M4: no file outlives a refusal, and a disk error is a named refusal, never a 500."""
    from api.services.journal_two import notes as notes_svc

    def disk_error(*a, **k):
        raise OSError(5, "I/O error")

    monkeypatch.setattr(notes_svc, "save_note_image_bytes", disk_error)
    budget = media_policy.MediaBudget.for_member("u1")
    with pytest.raises(MediaRejected) as e:
        media_policy.store_media("u1", "n1", _heic_like_result(), budget=budget)
    assert e.value.reason == "fetch_failed" and e.value.marker_text == "Couldn't copy IMG.png"
    assert not any(p.is_file() for p in att_root.rglob("*"))   # the original was removed
    assert budget.used == 0


def test_a_full_disk_reads_storage_limit(att_root, monkeypatch):
    import errno as _errno
    from api.services.journal_two import notes as notes_svc

    def full(*a, **k):
        raise OSError(_errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(notes_svc, "save_note_attachment_bytes", full)
    with pytest.raises(MediaRejected) as e:
        media_policy.store_media("u1", "n1", _heic_like_result(),
                                 budget=media_policy.MediaBudget.for_member("u1"))
    assert e.value.reason == "storage_limit"
