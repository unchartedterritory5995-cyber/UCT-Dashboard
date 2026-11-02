"""ONE media policy for every server path that stores a member's image or file (Plan A Task 8,
spec I-1..I-4, §15 Q2).

Every image or file that arrives -- through a connector sync (`note_connectors/engine.py`) or
the member's own upload (`POST /notes/{id}/images`, `/attachments`) -- goes through:

    normalize_media(data, declared_mime, filename) -> MediaResult      (decide)
    store_media(user_id, note_id, result, budget=MediaBudget...)        (store, under the cap)

and anything refused is a named `MediaRejected(reason, marker_text)`: the engine turns it into
an `importNotice`, the doors into a 400 `{"detail": marker_text, "reason": reason}`. Never a
500, never a stored web page.

What `normalize_media` decides (each value pinned by `test_media_policy.py`):
  * empty => `unsupported`; over `MEDIA_SOURCE_MAX_BYTES` (25 MB) => `too_large`.
  * the type is SNIFFED (`sniff_mime`): magic bytes win over a declared type and a filename.
    A sniffed web page (HTML / XHTML) or script is `unsupported`: a web page is never stored.
  * PNG/JPEG/GIF/WebP <= `IMAGE_MAX_BYTES` (5 MB): an inline image, bytes untouched.
  * HEIC/HEIF => JPEG (PNG if alpha), keeping the HEIC as `original` (a file; Q2: the source is
    lossy and the member may want it). Without `pi_heif` installed => `unsupported` (a visible
    notice, never a crash). TIFF/BMP/AVIF => JPEG/PNG, no original.
  * any raster still over 5 MB => EXIF orientation applied, longest edge 4096 px, JPEG q=85 (PNG
    with alpha), the edge shrunk x0.75 up to 4 times until it fits, else `too_large`. No
    original kept, except an animated GIF/WebP: its first frame is the image and the animation
    is kept as a file.
  * a canvas over `MAX_DECODE_PIXELS` is `too_large` before a pixel is decoded (checked on
    the header's size), Pillow's own bomb error likewise; at most `DECODE_CONCURRENCY`
    decodes run at once, and a big JPEG decodes at a reduced DCT scale (`draft`).
  * `normalize_file` is the FILE-INTENT path (`/attachments`, a connector's file chip): sniff,
    refuse web pages/scripts and oversize, keep the bytes as a file -- never decoded.
  * SVG => a file (no rasteriser in the stack; never inline). Everything else => a file.
  * an image TYPE the bytes do not confirm (a declared `image/png` with no PNG signature) is a
    file typed `application/octet-stream`: only magic bytes make something an inline image.

The per-member cap (Q2): `MEMBER_IMPORT_MEDIA_CAP_BYTES` (env `NOTE_IMPORT_MEDIA_CAP_BYTES`,
default 2 GB), read as a module global at call time. Usage is `member_media_bytes(user_id)`: a
scan of that member's attachment tree (no attachment-row table exists). It is never run per
file: `MediaBudget.for_member` reads it through a 60 s in-process memo, one budget serves a whole
sync pass or upload request, and what a budget reserves is added to the memo, so a burst of
uploads scans the tree once.
"""
from __future__ import annotations

import errno
import io
import os
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from api.services.journal_two import import_notice
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.attachment_root import read_candidates
from api.services.journal_two.notes_quota import NoteQuotaExceeded

#: Imported, never retyped: the inline-image cap and the largest source this policy reads.
IMAGE_MAX_BYTES = notes_svc._MAX_IMAGE_BYTES
MEDIA_SOURCE_MAX_BYTES = notes_svc._MAX_FILE_BYTES

#: Q2: a member's imported + uploaded media stops at this many bytes. Module global, read at call
#: time (a test or an operator override moves it without a restart of the reader).
MEMBER_IMPORT_MEDIA_CAP_BYTES = int(os.environ.get("NOTE_IMPORT_MEDIA_CAP_BYTES", 2 * 1024 ** 3))

#: How long a member's scanned usage is trusted before the tree is walked again.
USAGE_MEMO_TTL_S = 60.0

#: The longest edge a downscale starts from, the JPEG quality, and the shrink schedule.
DOWNSCALE_MAX_EDGE = 4096
DOWNSCALE_JPEG_QUALITY = 85
DOWNSCALE_STEP = 0.75
DOWNSCALE_MAX_SHRINKS = 4

#: Fix round 1, I1: the largest canvas this server will DECODE (convert or downscale), checked
#: on `im.size` right after `Image.open`, before a pixel is loaded. ~150 MB per RGB copy at the
#: ceiling. An explicit check, not Pillow's warning (a process-global warnings filter is not
#: thread-safe). A passthrough image is never decoded here and is bounded only by Pillow's own
#: `DecompressionBombError`.
MAX_DECODE_PIXELS = 50_000_000

#: Fix round 1, I1: at most this many decodes at once in the process, shared by the upload doors
#: and the connector engine (both reach `_raster`). Each holds up to a few copies of a
#: `MAX_DECODE_PIXELS` canvas, so this bounds the box's decode memory, not just one request's.
DECODE_CONCURRENCY = 2
_DECODE_SLOTS = threading.BoundedSemaphore(DECODE_CONCURRENCY)

#: Fix round 1, M1: what an upload door says when the member's cap refuses a file. The import
#: notice's sentence promises a retry "once space frees up"; nothing retries an editor upload.
UPLOAD_STORAGE_LIMIT_SENTENCE = (
    "Not uploaded: you've reached the storage limit for images and files in your notebook.")


@dataclass(frozen=True)
class MediaResult:
    kind: Literal["image", "file"]
    mime: str
    data: bytes
    filename: str
    original: "MediaResult | None" = None


@dataclass(frozen=True)
class StoredMedia:
    kind: str
    url: str
    name: str
    size: int
    mime: str
    width: int | None
    height: int | None
    original: "StoredMedia | None" = None


class MediaRejected(Exception):
    """A refusal with a named reason (`import_notice.SERVER_REASONS`) and the sentence a member
    reads for it. Raised by `normalize_media` and `store_media`; never a 500."""

    def __init__(self, reason: str, marker_text: str):
        super().__init__(marker_text)
        self.reason = reason
        self.marker_text = marker_text


def rejection(reason: str, filename: str | None) -> MediaRejected:
    """The refusal a DOOR answers with (an upload, the member media-fetch door).
    A `fetch_failed` from here is said in its final form ("Couldn't copy X"): a door
    retries nothing, and the engine builds its own notice (with attempts) from the reason."""
    attempts = import_notice.MEDIA_RETRY_MAX_ATTEMPTS if reason == "fetch_failed" else 0
    return MediaRejected(reason, import_notice.marker_text(reason, filename or None, attempts=attempts))


_reject = rejection


# ── sniffing ─────────────────────────────────────────────────────────────────

_OCTET = "application/octet-stream"
_ZIP = "application/zip"
_OLE = "application/x-ole-storage"

_PASSTHROUGH = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
_HEIF = frozenset({"image/heic", "image/heif"})
_CONVERT = _HEIF | {"image/tiff", "image/bmp", "image/avif"}
_RASTER = _PASSTHROUGH | _CONVERT
_SVG = "image/svg+xml"

#: A web page or a script: never stored, whatever it is called.
_WEB_PAGE_MIMES = frozenset({
    "text/html", "application/xhtml+xml", "text/javascript", "application/javascript",
    "application/x-javascript", "application/ecmascript", "text/ecmascript",
})

_MIME_BY_EXT = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".tif": "image/tiff",
    ".tiff": "image/tiff", ".bmp": "image/bmp", ".avif": "image/avif", ".svg": _SVG,
    ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv", ".md": "text/markdown",
    ".json": "application/json", ".rtf": "application/rtf", ".zip": _ZIP,
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".doc": "application/msword", ".xls": "application/vnd.ms-excel",
    ".ppt": "application/vnd.ms-powerpoint", ".epub": "application/epub+zip",
    ".key": "application/vnd.apple.keynote",
    ".html": "text/html", ".htm": "text/html", ".xhtml": "application/xhtml+xml",
    ".js": "text/javascript", ".mjs": "text/javascript",
}

#: A container's magic says "zip" or "OLE"; a declared type or extension inside that family
#: is more specific and is kept (a .pptx IS a zip). Anything outside the family loses to magic.
_REFINES = {
    _ZIP: frozenset({
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/epub+zip", "application/vnd.apple.keynote",
        "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.presentation", "application/x-zip-compressed",
    }),
    _OLE: frozenset({"application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"}),
}


def _ftyp(data: bytes) -> str:
    """An ISO-BMFF file (`....ftyp`) read from its major and compatible brands."""
    try:
        box = int.from_bytes(data[0:4], "big")
    except ValueError:
        box = 16
    end = max(16, min(box, 64, len(data)))
    brands = {data[8:12]} | {data[i:i + 4] for i in range(16, end - 3, 4)}
    if brands & {b"avif", b"avis"}:
        return "image/avif"
    if brands & {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis"}:
        return "image/heic"
    if brands & {b"mif1", b"msf1"}:
        return "image/heif"
    major = data[8:12]
    if major == b"qt  ":
        return "video/quicktime"
    if major in (b"M4A ", b"M4B "):
        return "audio/mp4"
    if major.startswith(b"3g"):
        return "video/3gpp"
    return "video/mp4"


def _skip_prolog(head: str) -> str:
    """`head` past whitespace, an `<?xml ...?>` declaration and `<!-- -->` comments."""
    text = head.lstrip()
    for _ in range(16):
        if text.startswith("<?xml"):
            end = text.find("?>")
        elif text.startswith("<!--"):
            end = text.find("-->")
        else:
            return text
        if end < 0:
            return ""
        text = text[end + (2 if text.startswith("<?") else 3):].lstrip()
    return text


_HTML_OPENERS = ("<!doctype html", "<html", "<head", "<body", "<script", "<iframe", "<frameset")


def _magic(data: bytes) -> str | None:
    """The type the bytes themselves say, or None when they say nothing."""
    h = data[:64]
    if h.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if h.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if h[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if h[:4] == b"RIFF":
        return {b"WEBP": "image/webp", b"WAVE": "audio/wav", b"AVI ": "video/x-msvideo"}.get(h[8:12])
    if h[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if h[:2] == b"BM" and len(h) >= 14 and h[6:10] == b"\x00\x00\x00\x00":
        return "image/bmp"
    if h[4:8] == b"ftyp":
        return _ftyp(data)
    if h.startswith(b"%PDF-"):
        return "application/pdf"
    if h[:4] in (b"PK\x03\x04", b"PK\x05\x06"):
        return _ZIP
    if h.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return _OLE
    if h.startswith(b"OggS"):
        return "audio/ogg"
    if h.startswith(b"fLaC"):
        return "audio/flac"
    if h.startswith(b"ID3") or h[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if h.startswith(b"\x1aE\xdf\xa3"):
        return "video/webm"
    head = data[:1024]
    for bom in (b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff"):
        if head.startswith(bom):
            head = head[len(bom):].replace(b"\x00", b"")
            break
    text = _skip_prolog(head.decode("latin-1").lower())
    if text.startswith("<svg"):
        return _SVG
    if text.startswith(_HTML_OPENERS):
        return "text/html"
    return None


def _declared(value: str | None) -> str | None:
    """A declared Content-Type without parameters; `binary/octet-stream` is octet-stream."""
    if not isinstance(value, str):
        return None
    mime = value.split(";", 1)[0].strip().lower()
    if mime == "binary/octet-stream":
        mime = _OCTET
    return mime or None


def extension_mime(filename: str | None) -> str | None:
    """The type a file NAME claims, from the one extension table (`_MIME_BY_EXT`), or None.
    Public for callers that must decide image versus file before any bytes exist (the Notion
    converter's database file cells, Plan A Task 12); the bytes are still sniffed later."""
    if not isinstance(filename, str):
        return None
    return _MIME_BY_EXT.get(os.path.splitext(filename.strip())[1].lower())


def _sniff(data: bytes, declared_mime: str | None, filename: str | None) -> tuple[str, bool]:
    """`(mime, confirmed)`: the ONE decision `sniff_mime` and `normalize_media` both read;
    `confirmed` is True when the bytes themselves named the type."""
    declared = _declared(declared_mime)
    ext = extension_mime(filename)
    magic = _magic(data)
    if magic is not None:
        family = _REFINES.get(magic, frozenset())
        for hint in (declared, ext):
            if hint in family:
                return hint, True
        return magic, True
    if declared and declared != _OCTET:
        return declared, False
    return ext or _OCTET, False


def sniff_mime(data: bytes, declared_mime: str | None, filename: str | None) -> str:
    """Magic bytes win; else the declared MIME (parameters stripped, `binary/octet-stream` read as
    `application/octet-stream`); else the extension; else `application/octet-stream`. A container
    the magic names (zip, OLE) keeps a declared/extension type from inside its own family."""
    return _sniff(data, declared_mime, filename)[0]


# ── deciding ─────────────────────────────────────────────────────────────────

_HEIF_READY: bool | None = None


def _heif_available() -> bool:
    """`pi_heif` is optional (Plan A Task 7 installs it). Imported lazily, registered once."""
    global _HEIF_READY
    if _HEIF_READY is None:
        try:
            import pi_heif  # type: ignore[import-not-found]
            pi_heif.register_heif_opener()
            _HEIF_READY = True
        except Exception:  # noqa: BLE001 -- absent or broken: HEIC reads as unsupported
            _HEIF_READY = False
    return _HEIF_READY


def _renamed(filename: str, ext: str) -> str:
    base = os.path.splitext(filename)[0] if filename else ""
    return (base or "image") + ext


def _has_alpha(im) -> bool:
    return im.mode in ("RGBA", "LA", "PA", "RGBa", "La") or (
        im.mode == "P" and "transparency" in im.info)


def _encode(im, alpha: bool) -> bytes:
    buf = io.BytesIO()
    if alpha:
        im.save(buf, "PNG")
    else:
        im.save(buf, "JPEG", quality=DOWNSCALE_JPEG_QUALITY)
    return buf.getvalue()


def _fit(im, edge: int):
    from PIL import Image
    w, h = im.size
    longest = max(w, h)
    if longest <= edge:
        return im
    scale = edge / longest
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def _raster(data: bytes, mime: str, filename: str) -> MediaResult:
    """An image whose magic bytes are a raster type. See the module docstring."""
    from PIL import Image, ImageOps

    if mime in _HEIF and not _heif_available():
        raise _reject("unsupported", filename)
    cap = IMAGE_MAX_BYTES
    try:
        # Opening reads the header only. Pillow's own DecompressionBombError (a canvas past
        # twice its MAX_IMAGE_PIXELS) is caught below as `too_large`.
        im = Image.open(io.BytesIO(data))
        if mime in _PASSTHROUGH and len(data) <= cap:
            return MediaResult(kind="image", mime=mime, data=data, filename=filename)
        width, height = im.size
    except Image.DecompressionBombError:
        raise _reject("too_large", filename) from None
    except Exception:  # noqa: BLE001 -- a raster signature that does not open
        raise _reject("unsupported", filename) from None
    # I1: the decode ceiling, on the header's size, before a pixel is loaded.
    if width * height > MAX_DECODE_PIXELS:
        raise _reject("too_large", filename)
    with _DECODE_SLOTS:
        try:
            animated = bool(getattr(im, "is_animated", False))
            if animated:
                im.seek(0)
            if im.format == "JPEG" and max(width, height) > DOWNSCALE_MAX_EDGE:
                # I1: decode at the smallest DCT scale that still covers the first target
                # edge, so a big JPEG is never held at full size.
                scale = DOWNSCALE_MAX_EDGE / max(width, height)
                im.draft("RGB", (max(1, int(width * scale) + 1), max(1, int(height * scale) + 1)))
            im = ImageOps.exif_transpose(im)          # loads; the encode below drops EXIF
            alpha = _has_alpha(im)
            im = im.convert("RGBA" if alpha else "RGB")
            out_mime, ext = ("image/png", ".png") if alpha else ("image/jpeg", ".jpg")
            out = None
            if mime in _CONVERT or animated:
                full = _encode(im, alpha)
                out = full if len(full) <= cap else None
            edge = min(DOWNSCALE_MAX_EDGE, max(im.size))
            for _ in range(DOWNSCALE_MAX_SHRINKS + 1):
                if out is not None:
                    break
                candidate = _encode(_fit(im, edge), alpha)
                if len(candidate) <= cap:
                    out = candidate
                edge = max(1, int(edge * DOWNSCALE_STEP))
        except Image.DecompressionBombError:
            raise _reject("too_large", filename) from None
        except MemoryError:
            raise _reject("too_large", filename) from None
        except Exception:  # noqa: BLE001 -- a raster signature that does not decode
            raise _reject("unsupported", filename) from None
    if out is None:
        raise _reject("too_large", filename)
    original = None
    if mime in _HEIF or animated:
        source_ext = {"image/heic": ".heic", "image/heif": ".heif", "image/gif": ".gif",
                      "image/webp": ".webp"}.get(mime, "")
        original = MediaResult(kind="file", mime=mime, data=data, filename=filename or "image" + source_ext)
    return MediaResult(kind="image", mime=out_mime, data=out, filename=_renamed(filename, ext),
                       original=original)


def _screen(data: bytes, declared_mime: str | None, filename: str | None) -> tuple[str, str, bool]:
    """The refusals EVERY path shares: empty, over the source cap, a web page or script.
    Returns `(name, mime, confirmed)`."""
    name = os.path.basename((filename or "").replace("\\", "/")).strip()
    if not data:
        raise _reject("unsupported", name)
    if len(data) > MEDIA_SOURCE_MAX_BYTES:
        raise _reject("too_large", name)
    mime, confirmed = _sniff(data, declared_mime, name)
    if mime in _WEB_PAGE_MIMES:
        raise _reject("unsupported", name)
    return name, mime, confirmed


def normalize_file(data: bytes, declared_mime: str | None, filename: str | None) -> MediaResult:
    """Fix round 1, I5: the FILE-INTENT decision (`/attachments`, a connector item listed as a
    file). The member attaches these bytes; nothing is decoded, converted or downscaled, so an
    image that is huge, corrupt, or a HEIC with no decoder is still kept as the file it is.
    Only the shared refusals apply (empty, over 25 MB, a web page/script). An image type the
    bytes do not confirm is typed `application/octet-stream`, as in `normalize_media`."""
    name, mime, confirmed = _screen(data, declared_mime, filename)
    if mime in _RASTER and not confirmed:
        mime = _OCTET
    return MediaResult(kind="file", mime=mime, data=data, filename=name)


def normalize_media(data: bytes, declared_mime: str | None, filename: str | None) -> MediaResult:
    """What this server will store for `data`, or `MediaRejected`. See the module docstring."""
    name, mime, confirmed = _screen(data, declared_mime, filename)
    if mime in _RASTER:
        if confirmed:
            return _raster(data, mime, name)
        mime = _OCTET          # an image type the bytes do not confirm is never inline
    return MediaResult(kind="file", mime=mime, data=data, filename=name)


def as_file(result: MediaResult, *, source: bytes | None = None,
            source_name: str | None = None) -> MediaResult:
    """The file form of a result, for a door or placeholder that means "attach this file"
    (an image sent there is never re-routed inline): the kept `original` when there is one;
    else, when `source` is given and the image was converted or downscaled, the member's bytes
    as they came; else the result itself as a file."""
    if result.original is not None:
        return result.original
    if source is not None and result.kind == "image" and result.data != source:
        name = source_name if source_name is not None else result.filename
        return MediaResult(kind="file", mime=sniff_mime(source, None, name), data=source, filename=name)
    return replace(result, kind="file")


# ── the per-member cap ───────────────────────────────────────────────────────

_USAGE_MEMO: dict[tuple[str, str], tuple[float, int]] = {}
_USAGE_LOCK = threading.Lock()


def _safe_segment(value: str) -> bool:
    return bool(value) and "/" not in value and "\\" not in value and not value.startswith(".")


def member_media_bytes(user_id: str) -> int:
    """Total size of the files under the member's attachment directory, in the write root and
    every read root (`attachment_root.read_candidates`), via `os.scandir` recursion. A whole-tree
    walk of ONE member: call it through `MediaBudget.for_member` (memoised), never per file."""
    if not isinstance(user_id, str) or not _safe_segment(user_id):
        return 0
    seen: set[str] = set()
    total = 0
    for base in [Path(notes_svc._ATTACHMENT_ROOT) / user_id, *read_candidates(Path(user_id))]:
        key = os.path.normcase(os.path.abspath(base))
        if key in seen:
            continue
        seen.add(key)
        stack = [str(base)]
        while stack:
            try:
                with os.scandir(stack.pop()) as it:
                    for entry in it:
                        try:
                            if entry.is_dir(follow_symlinks=False):
                                stack.append(entry.path)
                            elif entry.is_file(follow_symlinks=False):
                                total += entry.stat(follow_symlinks=False).st_size
                        except OSError:
                            continue
            except OSError:
                continue
    return total


def _memo_key(user_id: str) -> tuple[str, str]:
    return (str(notes_svc._ATTACHMENT_ROOT), user_id)


def _memo_usage(user_id: str) -> int:
    key = _memo_key(user_id)
    now = time.monotonic()
    with _USAGE_LOCK:
        hit = _USAGE_MEMO.get(key)
        if hit is not None and now - hit[0] < USAGE_MEMO_TTL_S:
            return hit[1]
    used = member_media_bytes(user_id)
    with _USAGE_LOCK:
        _USAGE_MEMO[key] = (now, used)
    return used


def _memo_reserve(user_id: str, nbytes: int) -> bool:
    """Fix round 1, I3: the ONE check-and-add of a member's usage, atomic under `_USAGE_LOCK`
    against the SHARED memo entry, so concurrent uploads and an engine pass all reserve from
    the same running total and can never together pass the cap. A missing entry (never read,
    or cleared) is filled by a scan first, outside the lock, then the check is retried."""
    key = _memo_key(user_id)
    for _ in range(2):
        with _USAGE_LOCK:
            hit = _USAGE_MEMO.get(key)
            if hit is not None:
                if hit[1] + nbytes > MEMBER_IMPORT_MEDIA_CAP_BYTES:
                    return False
                _USAGE_MEMO[key] = (hit[0], hit[1] + nbytes)
                return True
        _memo_usage(user_id)
    return False


def _memo_release(user_id: str, nbytes: int) -> None:
    key = _memo_key(user_id)
    with _USAGE_LOCK:
        hit = _USAGE_MEMO.get(key)
        if hit is not None:
            _USAGE_MEMO[key] = (hit[0], max(0, hit[1] - nbytes))


class MediaBudget:
    """A member's room under `MEMBER_IMPORT_MEDIA_CAP_BYTES`, for one sync pass or one upload
    request. `reserve` before writing; a refusal is a `storage_limit`. Every budget for the
    same member reads and reserves against ONE shared running total (the usage memo), so an
    engine pass sees the uploads made during it and N concurrent uploads cannot each take the
    remaining room."""

    def __init__(self, user_id: str):
        self.user_id = user_id

    @classmethod
    def for_member(cls, user_id: str) -> "MediaBudget":
        _memo_usage(user_id)          # one memoised scan; refreshed after USAGE_MEMO_TTL_S
        return cls(user_id)

    @property
    def used(self) -> int:
        with _USAGE_LOCK:
            hit = _USAGE_MEMO.get(_memo_key(self.user_id))
        return hit[1] if hit is not None else _memo_usage(self.user_id)

    def under_cap(self) -> bool:
        return self.used < MEMBER_IMPORT_MEDIA_CAP_BYTES

    def reserve(self, nbytes: int) -> bool:
        return _memo_reserve(self.user_id, max(0, int(nbytes)))

    def release(self, nbytes: int) -> None:
        _memo_release(self.user_id, max(0, int(nbytes)))


def _store_one(user_id: str, note_id: str, r: MediaResult) -> StoredMedia:
    if r.kind == "image":
        saved = notes_svc.save_note_image_bytes(user_id, note_id, r.data, r.filename, r.mime, kind="inline")
        return StoredMedia(kind="image", url=saved["url"], name=r.filename, size=len(r.data),
                           mime=r.mime, width=saved.get("width"), height=saved.get("height"))
    saved = notes_svc.save_note_attachment_bytes(user_id, note_id, r.data, r.filename, r.mime,
                                                 trusted_mime=True)
    return StoredMedia(kind="file", url=saved["url"], name=saved["name"], size=len(r.data),
                       mime=r.mime, width=None, height=None)


def _remove_stored(user_id: str, note_id: str, stored: StoredMedia) -> None:
    """Delete a file this call just wrote (never one another note may share: only a
    uuid-named `file`, see `store_media`). Best effort: the attachment GC is the backstop."""
    parts = stored.url.rsplit("/", 2)
    if len(parts) != 3:
        return
    path = notes_svc.serve_note_image_path(user_id, note_id, parts[1], parts[2])
    try:
        if path is not None:
            path.unlink()
    except OSError:
        pass


def store_media(user_id: str, note_id: str, result: MediaResult, *, budget: MediaBudget) -> StoredMedia:
    """Store a decided result (and its original) under the member's cap. Raises
    `MediaRejected("storage_limit")` when the budget refuses (the original counts too) or the
    volume has no headroom (`NoteQuotaExceeded`, or a disk-full `OSError`);
    `MediaRejected("unsupported")` for any other save refusal; `MediaRejected("fetch_failed")`
    for any other disk error (never a 500).

    Fix round 1, M4: the ORIGINAL is written first. It is a uuid-named file no other note
    shares, so if the primary then fails it is deleted, and the budget released: no file
    outlives a refusal. (The primary is never deleted on a later failure: an inline image is
    content-addressed and may be the same file another ref of this note already uses.)

    Final review I1(a): an inline image whose content-addressed file is ALREADY on disk is a
    no-op write (`notes.note_image_target`, the path the save itself uses), so it reserves
    nothing: a re-import of unchanged media never counts the same bytes twice."""
    primary_is_new = not (result.kind == "image" and notes_svc.note_image_target(
        user_id, note_id, result.data, result.mime).is_file())
    need = ((len(result.data) if primary_is_new else 0)
            + (len(result.original.data) if result.original is not None else 0))
    if not budget.reserve(need):
        raise _reject("storage_limit", result.filename)
    original = None
    try:
        if result.original is not None:
            original = _store_one(user_id, note_id, result.original)
        primary = _store_one(user_id, note_id, result)
    except (notes_svc.NoteValidationError, OSError) as e:
        budget.release(need)
        if original is not None:
            _remove_stored(user_id, note_id, original)
        if isinstance(e, OSError):
            reason = "storage_limit" if e.errno == errno.ENOSPC else "fetch_failed"
        else:
            reason = "storage_limit" if isinstance(e.__cause__, NoteQuotaExceeded) else "unsupported"
        raise _reject(reason, result.filename) from e
    return replace(primary, original=original)
