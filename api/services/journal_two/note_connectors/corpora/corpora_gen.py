"""Messy real-world connector corpora -- Plan A Task 14 (spec §10).

── Why this exists ──────────────────────────────────────────────────────────

The 9/5 certification of the Notion and Obsidian connectors ran on small, tidy fixtures,
and that is why link, URL and image defects reached members. These corpora are the
opposite: a deliberately messy Notion workspace (`notion_messy.json`) and a messy Obsidian
vault (`obsidian_messy/`), each exercising every construct connector fidelity Plan A fixed.

── What this module does ────────────────────────────────────────────────────

It runs the REAL engine end to end -- never a second, hand-rolled converter:

  * Notion: `engine.sync_source` with the real `NotionProvider`, whose client is an
    `httpx.AsyncClient` on `httpx.MockTransport` serving the dump (`base._resolve_host` is
    patched to a public address, so the SSRF guard runs on every hop and no DNS lookup or
    socket is ever made; since Task 15 `no_network()` enforces that rather than assuming
    it). Two members: `u-notion` (two passes) and `u-capped` (one pass,
    under a small per-member media cap, so the cap is reached in the middle of a note).
  * Obsidian: the vault's markdown is pushed through the real staging door
    (`obsidian_staging.ingest_batch`), then `engine.sync_source` runs the real
    `ObsidianProvider`, its hotlinks served by the same kind of mock transport.
  * Evernote (Plan E Task 9): `engine.sync_source` with the real `EvernoteProvider` and the
    real `EvernoteMcpClient` over `EvernoteAccount`, a mock of the hosted MCP server, its token
    endpoint and `storage.googleapis.com`, serving the synthetic `evernote_live_messy.json`
    (measured key names only). Three full passes; see `_run_evernote`.

Between pass 1 and pass 2 the member edits one note in UCT (`member_edits`), the remote
changes it too, and a target that pass 1 could not find appears. The stored notes (body,
title, import key, tags, pending flags, and whether pass 2 touched `updated_at`) are written
to `app/src/pages/journal-2-0/lib/importer/__fixtures__/connector_corpora/<corpus>.json`.
`test_connector_corpora.py` re-runs this and compares byte for byte, then asserts each
construct on the stored document; `connectorCorpora.dom.test.js` mounts every stored body
in the real editor.

── Determinism ──────────────────────────────────────────────────────────────

Every byte written is the engine's own output. Nothing is normalised after the fact. Two
inputs are pinned instead, so the output is the same on every run:
  * `notes.uuid` is replaced, for the run only, by a counter-seeded UUID source, so note ids
    and uploaded-file names are fixed (the engine is sequential: the order is fixed too);
  * media bodies are built from seeded specs (`_media_body`).
Converted images (HEIC/TIFF/BMP/AVIF to JPEG, a downscaled photo) are content-addressed:
their URLs carry a hash of Pillow's encoder output, so a Pillow upgrade that changes the
encoder's bytes moves those URLs. Regenerate and commit when that happens; the structural
assertions in the rail do not depend on the bytes.

Media sizes are scaled down so the corpus stays small and fast: for the run the inline-image
cap is `IMAGE_MAX_BYTES_FOR_RUN` (not 5 MB) and the source cap `MEDIA_SOURCE_MAX_BYTES_FOR_RUN`
(not 25 MB). A "12 MB photo" is therefore a photo over the run's inline cap, an "oversize
file" one over the run's source cap. The decompression bomb is a PNG header declaring a
30000 x 30000 canvas: Pillow refuses it from the header, so no pixel is ever allocated.

Runnable directly:
    python -m api.services.journal_two.note_connectors.corpora.corpora_gen
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import io
import json
import os
import pathlib
import random
import struct
import tempfile
import uuid
import zlib
from typing import Any, Iterator

import httpx

_HERE = pathlib.Path(__file__).resolve().parent
NOTION_DUMP = _HERE / "notion_messy.json"
OBSIDIAN_DIR = _HERE / "obsidian_messy"
EVERNOTE_DUMP = _HERE / "evernote_live_messy.json"

# corpora -> note_connectors -> journal_two -> services -> api -> <repo root>
_REPO_ROOT = _HERE.parents[4]
FIXTURES_OUT_DIR = (_REPO_ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "importer"
                    / "__fixtures__" / "connector_corpora")
HEIC_FIXTURE = _REPO_ROOT / "tests" / "fixtures" / "media" / "rotated_32x16_orient6.heic"

#: The run's media caps (see the module docstring): small, so the corpus is small and fast.
IMAGE_MAX_BYTES_FOR_RUN = 50_000
MEDIA_SOURCE_MAX_BYTES_FOR_RUN = 300_000
#: The run's database query page cap, so a database that never ends is truncated quickly.
DATA_SOURCE_PAGES_FOR_RUN = 2

#: Every host resolves here for the run: a public address, so the SSRF guard passes it and
#: refuses only what the corpus aims at a private address on purpose.
PUBLIC_TEST_ADDRESS = "142.250.0.1"

CORPORA = ("notion_messy", "obsidian_messy", "evernote_live_messy")


# ── media bodies, built in memory from seeded specs ─────────────────────────────

def _noise_rgb(w: int, h: int, seed: int):
    from PIL import Image
    rnd = random.Random(seed)
    small = Image.frombytes("RGB", (max(1, w // 8), max(1, h // 8)),
                            bytes(rnd.randrange(256) for _ in range(max(1, w // 8) * max(1, h // 8) * 3)))
    smooth = small.resize((w, h), Image.BICUBIC)
    grain = Image.frombytes("RGB", (w, h), bytes(rnd.randrange(256) for _ in range(w * h * 3)))
    return Image.blend(smooth, grain, 0.25)


def _encode(im, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    im.save(buf, fmt, **kw)
    return buf.getvalue()


def _bomb_png(w: int, h: int) -> bytes:
    """A PNG whose header declares a w x h 1-bit canvas. Pillow raises
    `DecompressionBombError` on the header alone (over twice `MAX_IMAGE_PIXELS`)."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    ihdr = struct.pack(">IIBBBBB", w, h, 1, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00" * 64)) + chunk(b"IEND", b"")


def _media_body(spec: dict[str, Any]) -> bytes:
    kind = spec["kind"]
    if kind == "text":
        return spec["text"].encode("utf-8")
    if kind == "filler":
        prefix = bytes.fromhex(spec["prefix_hex"]) if "prefix_hex" in spec else spec["prefix"].encode("latin-1")
        return prefix + b"\x00" * (spec["size"] - len(prefix))
    if kind == "heic_fixture":
        return HEIC_FIXTURE.read_bytes()
    if kind == "bomb_png":
        return _bomb_png(spec["w"], spec["h"])
    im = _noise_rgb(spec["w"], spec["h"], spec["seed"])
    if kind == "png":
        return _encode(im, "PNG")
    if kind == "jpeg":
        kw: dict[str, Any] = {"quality": spec.get("quality", 90)}
        if spec.get("exif_orientation"):
            from PIL import Image
            exif = Image.Exif()
            exif[0x0112] = spec["exif_orientation"]
            kw["exif"] = exif.tobytes()
        return _encode(im, "JPEG", **kw)
    if kind == "tiff":
        return _encode(im, "TIFF")
    if kind == "bmp":
        return _encode(im, "BMP")
    if kind == "avif":
        return _encode(im, "AVIF", quality=80)
    raise ValueError(f"unknown media spec kind {kind!r}")


class MediaServer:
    """Serves a corpus's `media` table: `{logical url: {status, content_type?, location?, body?}}`.
    A request is matched on its LOGICAL url (scheme, the Host header, path and query), since an
    http hop connects to the checked address and carries the name in `Host`."""

    def __init__(self, table: dict[str, dict[str, Any]]):
        self.table = table
        self._bodies: dict[str, bytes] = {}
        self.requests: list[str] = []

    def body_of(self, url: str) -> bytes:
        if url not in self._bodies:
            self._bodies[url] = _media_body(self.table[url]["body"])
        return self._bodies[url]

    def respond(self, request: httpx.Request) -> httpx.Response:
        assert "authorization" not in {k.lower() for k in request.headers.keys()}, \
            "a credential must never ride on a media request"
        logical = f"{request.url.scheme}://{request.headers['host']}{request.url.raw_path.decode()}"
        self.requests.append(logical)
        spec = self.table.get(logical)
        if spec is None:
            return httpx.Response(404)
        status = spec["status"]
        if status in (301, 302, 303, 307, 308):
            return httpx.Response(status, headers={"location": spec["location"]})
        if status != 200:
            return httpx.Response(status, content=b"denied")
        return httpx.Response(200, content=self.body_of(logical),
                              headers={"content-type": spec.get("content_type", "application/octet-stream")})


# ── the Notion workspace, served ──────────────────────────────────────────────────

class NotionWorkspace:
    """`api.notion.com` for the dump in `notion_messy.json`, per member (by bearer token) and
    per pass (`self.pass_no`)."""

    def __init__(self, dump: dict[str, Any], media: MediaServer):
        self.dump = dump
        self.media = media
        self.pass_no = 0
        self.member_by_token = {m["token"]: name for name, m in dump["members"].items()}

    def _page(self, page_id: str) -> dict[str, Any] | None:
        if self.pass_no >= 1 and page_id in self.dump.get("pages_pass2", {}):
            return self.dump["pages_pass2"][page_id]
        return self.dump["pages"].get(page_id)

    def _children(self, block_id: str) -> list[dict[str, Any]]:
        if self.pass_no >= 1 and block_id in self.dump.get("children_pass2", {}):
            return self.dump["children_pass2"][block_id]
        return self.dump["children"].get(block_id, [])

    def _rows(self, database_id: str) -> list[dict[str, Any]]:
        db = self.dump["databases"][database_id]
        if "rows" in db:
            return db["rows"]
        gen = db["generated_rows"]
        stamp = "2026-10-20T10:00:00.000Z"
        return [{"object": "page", "id": gen["id"].format(n), "created_time": stamp, "last_edited_time": stamp,
                 "properties": {"Name": {"id": "title", "type": "title", "title": [{
                     "type": "text", "text": {"content": gen["title"].format(n=n), "link": None},
                     "annotations": {}, "plain_text": gen["title"].format(n=n), "href": None}]}}}
                for n in range(1, gen["count"] + 1)]

    def respond(self, request: httpx.Request) -> httpx.Response:
        if request.url.host != "api.notion.com":
            return self.media.respond(request)
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        member = self.dump["members"].get(self.member_by_token.get(token, ""))
        if member is None:
            return httpx.Response(401, json={"message": "unauthorized"})
        path, method = request.url.path, request.method
        if path == "/v1/users/me":
            return httpx.Response(200, json={"id": "bot-1", "name": "Corpus"})
        if path == "/v1/search" and method == "POST":
            body = json.loads(request.content or b"{}")
            if (body.get("filter") or {}).get("in_trash"):
                results = [self._page(pid) for pid in member.get("trash", [])]
            else:
                ids = member["passes"][min(self.pass_no, len(member["passes"]) - 1)]
                results = sorted((self._page(pid) for pid in ids),
                                 key=lambda p: (p["last_edited_time"], p["id"]), reverse=True)
            return httpx.Response(200, json={"results": results, "has_more": False, "next_cursor": None})
        parts = path.split("/")
        if path.startswith("/v1/pages/") and method == "GET":
            page = self._page(parts[3])
            return httpx.Response(200, json=page) if page else httpx.Response(404, json={"code": "object_not_found"})
        if path.startswith("/v1/blocks/") and path.endswith("/children"):
            return httpx.Response(200, json={"results": self._children(parts[3]), "has_more": False,
                                             "next_cursor": None})
        if path.startswith("/v1/blocks/"):
            block = self.dump["blocks"].get(parts[3])
            return httpx.Response(200, json=block) if block else httpx.Response(404, json={"code": "object_not_found"})
        if path.startswith("/v1/databases/"):
            return httpx.Response(200, json={"id": parts[3], "data_sources": [{"id": parts[3]}]})
        if path.startswith("/v1/data_sources/") and path.endswith("/query"):
            db_id = parts[3]
            rows = self._rows(db_id)
            if self.dump["databases"][db_id].get("never_ends"):
                cursor = int((json.loads(request.content or b"{}")).get("start_cursor") or 0)
                row = rows[cursor % len(rows)]
                return httpx.Response(200, json={"results": [row], "has_more": True, "next_cursor": str(cursor + 1)})
            return httpx.Response(200, json={"results": rows, "has_more": False, "next_cursor": None})
        return httpx.Response(404, json={"code": "object_not_found"})


# ── the run's patches (no pytest here: a plain ExitStack) ─────────────────────────

class _SeqUuid:
    """`uuid` with a counter-seeded `uuid4`, for `notes.py` only and for the run only."""

    def __init__(self) -> None:
        self.n = 0

    def uuid4(self) -> uuid.UUID:
        self.n += 1
        return uuid.UUID(bytes=hashlib.sha256(f"corpus-uuid-{self.n}".encode()).digest()[:16], version=4)

    def __getattr__(self, name: str) -> Any:
        return getattr(uuid, name)


class _NoLimit:
    async def acquire(self) -> None:
        return None


async def _no_sleep(_seconds: float) -> None:
    return None


async def _public_address(_host: str) -> list[str]:
    return [PUBLIC_TEST_ADDRESS]


# ── the network guard (Plan A Task 15) ───────────────────────────────────────────────
#
# ⛔ `PUBLIC_TEST_ADDRESS` is a REAL Google address. Every hop is meant to land on a
# `MockTransport`, but nothing used to PROVE it: one client built without the mock transport
# would have sent a member-shaped request to Google, and the run would still have produced
# plausible output (a `fetch_failed` notice is a legal corpus outcome). So the whole run sits
# inside `no_network()`, which refuses, and RECORDS, every outbound door this process has:
# a socket connect, `socket.create_connection`, a DNS lookup, and httpx's two DEFAULT
# transports (a `MockTransport` is neither, so the corpus's own traffic is untouched).
# Loopback stays open: on Windows asyncio's own self-pipe is a socketpair made by a
# loopback connect. Recorded as well as raised, because the engine turns most failures into
# a notice: `LAST_RUN_REFUSED` must be empty after a run (`test_connector_corpora.py`).

class NetworkRefused(RuntimeError):
    """An outbound connection attempted inside `no_network()`."""


#: Every refusal of the last `build()`, as `"<door> <target>"`. Empty is the only pass.
LAST_RUN_REFUSED: list[str] = []

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"})


def _is_loopback(host: Any) -> bool:
    if not isinstance(host, str):
        return False
    return host.lower() in _LOOPBACK_HOSTS or host.startswith("127.")


@contextlib.contextmanager
def no_network(refused: list[str]) -> Iterator[list[str]]:
    import socket

    def refuse(door: str, target: Any) -> None:
        refused.append(f"{door} {target}")
        raise NetworkRefused(f"connector corpora: no network ({door} {target})")

    def guarded_connect(original: Any, door: str) -> Any:
        def connect(self: Any, address: Any, *args: Any, **kwargs: Any) -> Any:
            host = address[0] if isinstance(address, tuple) and address else address
            if not _is_loopback(host):
                refuse(door, address)
            return original(self, address, *args, **kwargs)
        return connect

    def create_connection(address: Any, *args: Any, **kwargs: Any) -> Any:
        if not _is_loopback(address[0] if isinstance(address, tuple) and address else address):
            refuse("socket.create_connection", address)
        return original_create_connection(address, *args, **kwargs)

    def getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if host is not None and not _is_loopback(host):
            refuse("socket.getaddrinfo", host)
        return original_getaddrinfo(host, *args, **kwargs)

    def sync_transport(self: Any, request: httpx.Request) -> Any:
        refuse("httpx.HTTPTransport", request.url)

    async def async_transport(self: Any, request: httpx.Request) -> Any:
        refuse("httpx.AsyncHTTPTransport", request.url)

    original_create_connection = socket.create_connection
    original_getaddrinfo = socket.getaddrinfo
    patches = [
        (socket.socket, "connect", guarded_connect(socket.socket.connect, "socket.connect")),
        (socket.socket, "connect_ex", guarded_connect(socket.socket.connect_ex, "socket.connect_ex")),
        (socket, "create_connection", create_connection),
        (socket, "getaddrinfo", getaddrinfo),
        (httpx.HTTPTransport, "handle_request", sync_transport),
        (httpx.AsyncHTTPTransport, "handle_async_request", async_transport),
    ]
    saved = [(obj, name, getattr(obj, name)) for obj, name, _ in patches]
    try:
        for obj, name, value in patches:
            setattr(obj, name, value)
        yield refused
    finally:
        for obj, name, value in saved:
            setattr(obj, name, value)


@contextlib.contextmanager
def _run_environment(work_dir: pathlib.Path) -> Iterator[dict[str, Any]]:
    from api.services import auth_db
    from api.services.journal_two import media_policy, notes as notes_svc
    from api.services.journal_two.db import ensure_schema
    from api.services.journal_two.note_connectors.providers import base, notion as notion_mod

    with contextlib.ExitStack() as stack:
        def patch(obj: Any, name: str, value: Any) -> None:
            old = getattr(obj, name)
            setattr(obj, name, value)
            stack.callback(setattr, obj, name, old)

        def setenv(key: str, value: str) -> None:
            old = os.environ.get(key)
            os.environ[key] = value
            stack.callback(lambda: os.environ.__setitem__(key, old) if old is not None else os.environ.pop(key, None))

        setenv("NOTE_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"connector-corpora-fixed-key-0001").decode())
        setenv("NOTION_CLIENT_ID", "corpus-client")
        setenv("NOTION_CLIENT_SECRET", "corpus-secret")
        setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")
        # The messy vault's corpus pins the attachment layer ON (final review I3 made the
        # master switch default OFF; the OFF conversion is pinned by the provider's tests).
        setenv("NOTE_SYNC_OBSIDIAN_ATTACHMENTS_ENABLED", "1")
        setenv("PUSH_SECRET", "corpus-push-secret")
        setenv("EVERNOTE_CLIENT_ID", "corpus-evernote-client")
        patch(auth_db, "_DB_PATH", str(work_dir / "auth.db"))
        patch(notes_svc, "_ATTACHMENT_ROOT", work_dir / "att")
        patch(notes_svc, "uuid", _SeqUuid())
        patch(media_policy, "IMAGE_MAX_BYTES", IMAGE_MAX_BYTES_FOR_RUN)
        patch(media_policy, "MEDIA_SOURCE_MAX_BYTES", MEDIA_SOURCE_MAX_BYTES_FOR_RUN)
        patch(notion_mod, "_MAX_DATA_SOURCE_PAGES", DATA_SOURCE_PAGES_FOR_RUN)
        patch(base, "_resolve_host", _public_address)
        auth_db.init_db()
        conn = auth_db.get_connection()
        try:
            ensure_schema(conn)
        finally:
            conn.close()
        yield {"patch": patch, "attachment_root": work_dir / "att"}


# ── reading back what the engine stored ───────────────────────────────────────────

def _stored_notes(user_id: str) -> list[dict[str, Any]]:
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT id, title, import_key, tags, body_json, import_media_pending, import_links_pending, "
            "updated_at FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL", (user_id,)).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "title": r["title"], "importKey": r["import_key"],
            "tags": sorted(json.loads(r["tags"]) if r["tags"] else []),
            "importMediaPending": r["import_media_pending"], "importLinksPending": r["import_links_pending"],
            "bodyJson": json.loads(r["body_json"]) if r["body_json"] else None,
            "_updatedAt": r["updated_at"],
        })
    return out


def _snapshot(user_id: str) -> dict[str, str]:
    return {n["id"]: n["_updatedAt"] for n in _stored_notes(user_id)}


def _member_result(user_id: str, passes: list[dict[str, Any]], before_last: dict[str, str]) -> dict[str, Any]:
    notes = []
    for n in sorted(_stored_notes(user_id), key=lambda n: (n["importKey"] or "", n["title"], n["id"])):
        updated_at = n.pop("_updatedAt")
        n["updatedInLastPass"] = n["id"] not in before_last or before_last[n["id"]] != updated_at
        notes.append(n)
    return {"passes": passes, "notes": notes}


def _pass_summary(result: dict[str, Any]) -> dict[str, Any]:
    keys = ("status", "created", "updated", "skipped", "mediaUploaded", "conflicts")
    return {k: result.get(k) for k in keys}


def _member_edit(user_id: str, import_key: str, text: str) -> None:
    from api.services.journal_two import notes as notes_svc
    note = next(n for n in _stored_notes(user_id) if n["importKey"] == import_key)
    notes_svc.update_note(user_id, note["id"], {"bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}})


# ── the two corpora ───────────────────────────────────────────────────────────────

async def _run_notion(env: dict[str, Any]) -> dict[str, Any]:
    from api.services.journal_two import media_policy
    from api.services.journal_two.note_connectors import connections, engine
    from api.services.journal_two.note_connectors.providers.notion import NotionProvider

    dump = json.loads(NOTION_DUMP.read_text(encoding="utf-8"))
    media = MediaServer(dump["media"])
    workspace = NotionWorkspace(dump, media)
    transport = httpx.MockTransport(workspace.respond)
    env["patch"](engine, "_provider_factory", lambda name, source=None: NotionProvider(
        client=httpx.AsyncClient(transport=transport), rate_limiter=_NoLimit(), sleep_fn=_no_sleep))

    sources = {}
    for user_id, member in sorted(dump["members"].items()):
        connections.upsert_connector(user_id, "notion", {"accessToken": member["token"]}, account_label="Acme")
        sources[user_id] = connections.create_source(user_id, "notion", "workspace", display_name="Acme")

    passes: dict[str, list] = {u: [] for u in dump["members"]}
    before_last: dict[str, dict[str, str]] = {u: {} for u in dump["members"]}
    n_passes = max(len(m["passes"]) for m in dump["members"].values())
    for pass_no in range(n_passes):
        workspace.pass_no = pass_no
        for user_id, member in sorted(dump["members"].items()):
            if pass_no >= len(member["passes"]):
                continue
            if pass_no == len(member["passes"]) - 1:
                before_last[user_id] = _snapshot(user_id)
            cap = member.get("media_cap")
            old_cap = media_policy.MEMBER_IMPORT_MEDIA_CAP_BYTES
            if cap:
                media_policy.MEMBER_IMPORT_MEDIA_CAP_BYTES = (
                    sum(len(media.body_of(u)) for u in cap["fits"]) + cap["slack"])
            try:
                result = await engine.sync_source(sources[user_id]["id"], full=True, manual=True)
            finally:
                media_policy.MEMBER_IMPORT_MEDIA_CAP_BYTES = old_cap
            passes[user_id].append(_pass_summary(result))
            if pass_no == 0:
                for page_id, text in (member.get("member_edits") or {}).items():
                    _member_edit(user_id, f"notion:{page_id}", text)
    return {"corpus": "notion_messy",
            "members": {u: _member_result(u, passes[u], before_last[u]) for u in sorted(dump["members"])}}


def _vault_files(pass_dir: pathlib.Path) -> dict[str, str]:
    out = {}
    for path in sorted(pass_dir.rglob("*.md")):
        out[path.relative_to(pass_dir).as_posix()] = path.read_text(encoding="utf-8")
    return out


async def _run_obsidian(env: dict[str, Any]) -> dict[str, Any]:
    from api.services import auth_db
    from api.services.journal_two.note_connectors import connections, engine, obsidian_staging
    from api.services.journal_two.note_connectors.providers.obsidian import ObsidianProvider

    corpus = json.loads((OBSIDIAN_DIR / "corpus.json").read_text(encoding="utf-8"))
    user_id, vault_id = corpus["user"], corpus["vault_id"]
    media = MediaServer(corpus["media"])
    transport = httpx.MockTransport(media.respond)
    env["patch"](engine, "_provider_factory", lambda name, source=None: ObsidianProvider(
        user_id=user_id, vault_id=vault_id, client=httpx.AsyncClient(transport=transport)))

    conn = auth_db.get_connection()
    try:
        # The device row the plugin's redeem writes: its label is the vault's NAME, which an
        # `obsidian://open?vault=<name>` deep link is matched against.
        conn.execute("INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc, label, created_at) "
                     "VALUES (?, ?, ?, 'enc', ?, '2026-10-20T00:00:00Z')",
                     (f"dev-{vault_id}", user_id, vault_id, corpus["label"]))
        conn.commit()
    finally:
        conn.close()
    connections.upsert_connector(user_id, "obsidian", {}, account_label=corpus["label"])
    source = connections.create_source(user_id, "obsidian", vault_id, display_name=corpus["label"])

    known: list[str] = []
    passes = []
    before_last: dict[str, str] = {}
    for pass_no, spec in enumerate(corpus["passes"]):
        files = _vault_files(OBSIDIAN_DIR / spec["dir"])
        known = sorted({*known, *files})
        notes = [{"vault_path": p, "content_hash": hashlib.sha256(body.encode()).hexdigest(),
                  "body_md": body, "updated_at": f"2026-10-2{pass_no}T10:00:00Z"} for p, body in files.items()]
        obsidian_staging.ingest_batch(user_id=user_id, vault_id=vault_id, notes=notes, manifest=known, final=True)
        if pass_no == len(corpus["passes"]) - 1:
            before_last = _snapshot(user_id)
        result = await engine.sync_source(source["id"], full=spec["full"], manual=True)
        passes.append(_pass_summary(result))
        if pass_no == 0:
            for path, text in (corpus.get("member_edits") or {}).items():
                _member_edit(user_id, f"obsidian:{vault_id}/{path}", text)
    return {"corpus": "obsidian_messy", "members": {user_id: _member_result(user_id, passes, before_last)}}


# ── the Evernote account, served (Plan E Task 9) ──────────────────────────────────────

EVERNOTE_SESSION_ID = "corpus-mcp-session"
_GCS_HOST = "storage.googleapis.com"
_GCS_PREFIX = "/en-corpus/"


class EvernoteAccount:
    """Evernote's hosted MCP server, its token endpoint and its attachment storage for the dump in
    `evernote_live_messy.json`, per pass (`self.pass_no`). Every MCP payload uses the MEASURED key
    names (`docs/notebook-connectors/evernote-mcp-probe.md`). The token check is real: after the
    refresh rotates `at-1` to `at-2`, `at-1` gets a 401, so a pass that used stale credentials
    would cost a second refresh, which the rail counts."""

    def __init__(self, dump: dict[str, Any], media: MediaServer):
        self.dump = dump
        self.media = media
        self.pass_no = 0
        self.valid_access = dump["oauth"]["accessToken"]
        self.valid_refresh = dump["oauth"]["refreshToken"]
        #: Every `tools/call` name that reached the wire, in order (the server's own record).
        self.wire_tool_calls: list[str] = []
        #: The refresh token each refresh POST carried.
        self.refresh_posts: list[str] = []
        #: Per pass, the note ids `get_note` was asked for (Task 9 fix round 1, M2).
        self.get_note_calls: list[list[str]] = []
        self._attachment_calls: dict[str, int] = {}
        self._downloads: dict[str, int] = {}
        self._bodies: dict[str, bytes] = {}

    # -- the dump, as the server sees it this pass
    def _note_spec(self, guid: str) -> dict[str, Any]:
        if self.pass_no >= 1 and guid in self.dump.get("notes_pass2", {}):
            return self.dump["notes_pass2"][guid]
        return self.dump["notes"][guid]

    def _resource_body(self, md5: str) -> bytes:
        if md5 not in self._bodies:
            self._bodies[md5] = _media_body(self.dump["resources"][md5]["body"])
        return self._bodies[md5]

    def _resource_size(self, md5: str) -> int:
        spec = self.dump["resources"][md5]
        return spec.get("declaredSizeBytes") or len(self._resource_body(md5))

    def _get_note(self, guid: str) -> dict[str, Any]:
        spec = self._note_spec(guid)
        content = spec.get("content")
        if content is None:
            rep = spec["content_repeat"]
            content = ("<?xml version=\"1.0\" encoding=\"UTF-8\"?><en-note>"
                       + "".join(rep["line"].format(n=n) for n in range(1, rep["count"] + 1)) + "</en-note>")
        resources = None
        if spec.get("resources") is not None:
            resources = [{"id": f"res-{md5[:8]}", "hash": md5, "mime": self.dump["resources"][md5]["mime"],
                          "name": self.dump["resources"][md5]["name"], "sizeBytes": self._resource_size(md5)}
                         for md5 in spec["resources"]]
        return {"id": guid, "title": spec["title"], "version": 1 + self.pass_no, "updateSequenceNumber": 100,
                "notebookId": spec["notebookId"], "content": content, "created": spec["created"],
                "updated": spec["updated"], "active": True, "deleted": None, "tasks": [],
                "tags": spec.get("tags"), "resources": resources, "attributes": spec.get("attributes")}

    @staticmethod
    def _iso_of(value: Any) -> str:
        if isinstance(value, (int, float)):
            from datetime import datetime, timezone
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return value

    def _hit(self, guid: str) -> dict[str, Any]:
        spec = self._note_spec(guid)
        hit = {"noteId": guid, "title": spec["title"], "snippet": None,
               "createdAt": self._iso_of(spec["created"]), "updatedAt": self._iso_of(spec["updated"]),
               "score": None}
        hit.update(spec.get("hit") or {})
        return hit

    def _search_notes(self, args: dict[str, Any]) -> dict[str, Any]:
        listing = self.dump["passes"][self.pass_no]
        ids = listing["trash"] if args.get("query") == "intrash:true" else listing["active"]
        hits = sorted((self._hit(g) for g in ids),
                      key=lambda h: (self._iso_of(self._note_spec(h["noteId"])["updated"]), h["noteId"]),
                      reverse=True)
        start, size = int(args.get("startIndex") or 0), int(args.get("maxResults") or 100)
        return {"hits": hits[start:start + size], "totalResultCount": len(hits), "startIndex": start,
                "isLastPage": start + size >= len(hits)}

    def _get_attachment(self, args: dict[str, Any]) -> dict[str, Any]:
        md5 = args["hash"]
        spec = self.dump["resources"][md5]
        n = self._attachment_calls[md5] = self._attachment_calls.get(md5, 0) + 1
        # A fresh pre-signed URL on every call, as the real server mints one.
        return {"downloadUrl": f"https://{_GCS_HOST}{_GCS_PREFIX}{md5}?X-Goog-Signature=sig{n}",
                "expiresAt": 1790000000000, "noteId": args["noteId"], "resourceGuid": f"res-{md5[:8]}",
                "hash": md5, "mimeType": spec["mime"], "filename": spec["name"],
                "sizeBytes": self._resource_size(md5)}

    def _tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if name == "search_notes":
            return self._search_notes(args)
        if name == "get_note":
            self.get_note_calls[self.pass_no].append(args["noteId"])
            return self._get_note(args["noteId"])
        if name == "search_notebooks":
            hits = self.dump["notebooks"]
            return {"hits": hits, "totalResultCount": len(hits), "startIndex": 0, "isLastPage": True}
        if name == "search_tags":
            hits = self.dump["tags"]
            return {"hits": hits, "totalResultCount": len(hits), "startIndex": 0, "isLastPage": True}
        if name == "get_attachment":
            return self._get_attachment(args)
        raise AssertionError(f"the corpus server has no tool {name!r}")

    # -- the three hosts
    def _mcp(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != f"Bearer {self.valid_access}":
            return httpx.Response(401, json={"error": "invalid_token"})
        msg = json.loads(request.content)
        if "id" not in msg:
            return httpx.Response(202)
        if msg["method"] == "initialize":
            return httpx.Response(200, headers={"mcp-session-id": EVERNOTE_SESSION_ID}, json={
                "jsonrpc": "2.0", "id": msg["id"], "result": {
                    "protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                    "serverInfo": {"name": "corpus-evernote", "version": "1"}}})
        assert msg["method"] == "tools/call", msg["method"]
        name = msg["params"]["name"]
        self.wire_tool_calls.append(name)
        sc = self._tool(name, msg["params"].get("arguments") or {})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": msg["id"], "result": {
            "content": [{"type": "text", "text": "ok"}], "structuredContent": sc}})

    def _token(self, request: httpx.Request) -> httpx.Response:
        from urllib.parse import parse_qs
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        self.refresh_posts.append(form.get("refresh_token", ""))
        if form.get("grant_type") != "refresh_token" or form.get("refresh_token") != self.valid_refresh:
            return httpx.Response(400, json={"error": "invalid_grant"})
        rotated = self.dump["oauth"]["rotateTo"]
        self.valid_access, self.valid_refresh = rotated["access_token"], rotated["refresh_token"]
        return httpx.Response(200, json=rotated)

    def _storage(self, request: httpx.Request) -> httpx.Response:
        assert "authorization" not in {k.lower() for k in request.headers.keys()}, \
            "a credential must never ride on an attachment download"
        md5 = request.url.path[len(_GCS_PREFIX):]
        spec = self.dump["resources"].get(md5)
        if spec is None or not request.url.path.startswith(_GCS_PREFIX):
            return httpx.Response(404)
        n = self._downloads[md5] = self._downloads.get(md5, 0) + 1
        if spec.get("redirect"):
            return httpx.Response(302, headers={"location": spec["redirect"]})
        statuses = spec.get("downloads") or [200]
        status = statuses[min(n, len(statuses)) - 1]
        if status != 200:
            return httpx.Response(status, content=b"<Error><Code>ExpiredToken</Code></Error>")
        return httpx.Response(200, content=self._resource_body(md5), headers={"content-type": spec["mime"]})

    def respond(self, request: httpx.Request) -> httpx.Response:
        host = request.headers.get("host") or request.url.host
        if host == "mcp.evernote.com":
            return self._mcp(request)
        if host == "accounts.evernote.com" and request.url.path == "/auth/token":
            return self._token(request)
        if host == _GCS_HOST:
            return self._storage(request)
        return self.media.respond(request)


def _folder_paths(user_id: str) -> dict[str, list[str]]:
    """`{note id: [folder names, root first]}` for the member's stored notes."""
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        folders = {r["id"]: (r["name"], r["parent_id"]) for r in conn.execute(
            "SELECT id, name, parent_id FROM j2_note_folders WHERE user_id = ?", (user_id,))}
        notes = conn.execute("SELECT id, folder_id FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL",
                             (user_id,)).fetchall()
    finally:
        conn.close()
    out: dict[str, list[str]] = {}
    for note in notes:
        path, at = [], note["folder_id"]
        while at and at in folders and len(path) < 50:
            path.insert(0, folders[at][0])
            at = folders[at][1]
        out[note["id"]] = path
    return out


def _sync_log(source_id: str) -> list[dict[str, Any]]:
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        rows = conn.execute("SELECT failures_json FROM j2_note_sync_log WHERE source_id = ? ORDER BY rowid",
                            (source_id,)).fetchall()
    finally:
        conn.close()
    return [json.loads(r["failures_json"]) if r["failures_json"] else [] for r in rows]


async def _run_evernote(env: dict[str, Any], dump: dict[str, Any] | None = None) -> dict[str, Any]:
    """The real `EvernoteProvider` and the real `EvernoteMcpClient` (its read-only allow-list, its
    401 hook) over `EvernoteAccount`; the real refresh (`evernote_oauth`, CAS swap) whose one POST
    goes to the same mock. Three scheduler full passes, then a member's removal-check pass: pass 2
    sees the member's edits, a remote edit, a trashed note, a purged note, a new link target and an
    expired access token; passes 3 and 4 see no remote change. Per pass: the counts, `adopted`, `sourceDeleted`, the engine's failure strings
    and the sync log's `failures_json`. Per note: which passes created or moved its `updated_at`.
    `dump` (default: the committed one) lets a rail run a variant DERIVED from it
    (`build_evernote_variant`)."""
    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import connections, engine, evernote_oauth
    from api.services.journal_two.note_connectors.evernote_mcp import EvernoteMcpClient
    from api.services.journal_two.note_connectors.providers.evernote import EvernoteProvider

    if dump is None:
        dump = json.loads(EVERNOTE_DUMP.read_text(encoding="utf-8"))
    user_id = dump["user"]
    account = EvernoteAccount(dump, MediaServer(dump["media"]))
    transport = httpx.MockTransport(account.respond)
    clients: list[Any] = []

    real_post_refresh = evernote_oauth._post_refresh

    def post_refresh(refresh_token: str, cid: str, client: Any) -> dict[str, Any]:
        # The real POST, through a client on the corpus transport (the default one is refused).
        with httpx.Client(transport=transport) as http:
            return real_post_refresh(refresh_token, cid, client or http)

    env["patch"](evernote_oauth, "_post_refresh", post_refresh)
    # Passes run seconds apart; the strike gap (which needs MEMBER_FULL_PASS_MIN_INTERVAL_S
    # between full passes before a miss counts) would otherwise stop every strike.
    env["patch"](engine, "MEMBER_FULL_PASS_MIN_INTERVAL_S", 0)

    def build_provider(_name: str, source: dict[str, Any] | None = None) -> Any:
        provider = EvernoteProvider(user_id=(source or {}).get("userId"),
                                    http=httpx.AsyncClient(transport=transport),
                                    mcp_factory=lambda creds: mcp(creds, provider))
        return provider

    def mcp(creds: dict[str, Any], provider: Any) -> Any:
        client = EvernoteMcpClient(creds["accessToken"], http=httpx.AsyncClient(transport=transport),
                                   on_unauthorized=provider._on_unauthorized, sleep=_no_sleep)
        clients.append(client)
        return client

    env["patch"](engine, "_provider_factory", build_provider)

    for seed in dump["enex_seed"]:  # notes a member imported earlier from an .enex export
        notes_svc.import_confirm(user_id, {"source": "evernote", "destFolderId": None, "notes": [{
            "importKey": seed["importKey"], "title": seed["title"], "tags": [], "folderPath": seed["folderPath"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": seed["text"]}]}]},
            "createdAt": seed["createdAt"], "updatedAt": seed["updatedAt"]}]})

    oauth_spec = dump["oauth"]
    connections.upsert_connector(user_id, "evernote", {
        "accessToken": oauth_spec["accessToken"], "refreshToken": oauth_spec["refreshToken"],
        "expiresAt": "2099-01-01T00:00:00+00:00", "clientId": oauth_spec["clientId"]}, account_label="Evernote")
    source = connections.create_source(user_id, "evernote", "account", display_name="Evernote")

    passes = []
    moved: dict[str, list[int]] = {}
    before_last: dict[str, str] = {}
    for pass_no, spec in enumerate(dump["passes"]):
        account.pass_no = pass_no
        account.get_note_calls.append([])
        if pass_no == oauth_spec["expireBeforePass"]:
            stored = connections.get_token(user_id, "evernote")
            assert connections.swap_token_if_unchanged(user_id, "evernote", stored["refreshToken"],
                                                       {**stored, "expiresAt": "2000-01-01T00:00:00+00:00"})
        before = _snapshot(user_id)
        if pass_no == len(dump["passes"]) - 1:
            before_last = before
        # A `member` pass is a member's "Sync now" with the removal check (fix round 1, M2):
        # an incremental pass with a complete listing, never a media-retry pass.
        member = bool(spec.get("member"))
        result = await engine.sync_source(source["id"], full=True, manual=True, member=member)
        for note_id, stamp in _snapshot(user_id).items():
            if before.get(note_id) != stamp:
                moved.setdefault(note_id, []).append(pass_no + 1)
        passes.append({**_pass_summary(result), "adopted": result.get("adopted"),
                       "sourceDeleted": result.get("sourceDeleted"), "failures": result.get("failures"),
                       **({"removalCheckRan": (result.get("removalCheck") or {}).get("ran")} if member else {})})
        if pass_no == 0:
            for guid, text in (dump.get("member_edits") or {}).items():
                _member_edit(user_id, f"evernote:guid:{guid}", text)
    for summary, failures_json in zip(passes, _sync_log(source["id"])):
        summary["failuresJson"] = failures_json
    for client in clients:
        await client._http.aclose()

    member = _member_result(user_id, passes, before_last)
    folder_paths = _folder_paths(user_id)
    for n in member["notes"]:
        n["updatedInPasses"] = moved.get(n["id"], [])
        n["folderPath"] = folder_paths.get(n["id"], [])
    stored = connections.get_token(user_id, "evernote") or {}
    return {"corpus": "evernote_live_messy", "members": {user_id: member},
            "toolCalls": [name for c in clients for name in c.tool_calls],
            "wireToolCalls": account.wire_tool_calls,
            "getNoteByPass": account.get_note_calls,
            "oauth": {"refreshPosts": account.refresh_posts, "storedRefreshToken": stored.get("refreshToken"),
                      "storedAccessToken": stored.get("accessToken")}}


async def _run_all(work_dir: pathlib.Path) -> dict[str, dict[str, Any]]:
    out = {}
    for name, runner in (("notion_messy", _run_notion), ("obsidian_messy", _run_obsidian),
                         ("evernote_live_messy", _run_evernote)):
        corpus_dir = work_dir / name
        corpus_dir.mkdir(parents=True, exist_ok=True)
        with _run_environment(corpus_dir) as env:
            out[name] = await runner(env)
    return out


def build(work_dir: pathlib.Path) -> dict[str, dict[str, Any]]:
    """Runs both corpora through the real engine under `work_dir` (a fresh database and
    attachment root per corpus: `<work_dir>/<corpus>/auth.db`, `<work_dir>/<corpus>/att`).
    Returns `{corpus: stored result}`. The files stay under `work_dir` for the rail to read.
    The whole run, event loop included, is inside `no_network()`; its refusals are left in
    `LAST_RUN_REFUSED`."""
    LAST_RUN_REFUSED.clear()
    with no_network(LAST_RUN_REFUSED):
        return asyncio.run(_run_all(pathlib.Path(work_dir)))


def build_evernote_variant(work_dir: pathlib.Path, dump: dict[str, Any]) -> dict[str, Any]:
    """The Evernote corpus alone over `dump` (a variant derived from the committed dump), under
    `no_network()` like `build()`. Its refusals are left in `LAST_RUN_REFUSED`."""
    async def run() -> dict[str, Any]:
        corpus_dir = pathlib.Path(work_dir) / "evernote_variant"
        corpus_dir.mkdir(parents=True, exist_ok=True)
        with _run_environment(corpus_dir) as env:
            return await _run_evernote(env, dump)

    LAST_RUN_REFUSED.clear()
    with no_network(LAST_RUN_REFUSED):
        return asyncio.run(run())


def render(result: dict[str, Any]) -> str:
    return json.dumps(result, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def generate(out_dir: pathlib.Path = FIXTURES_OUT_DIR) -> list[pathlib.Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    # ignore_cleanup_errors: on Windows a SQLite handle the app keeps open can outlive the run.
    with tempfile.TemporaryDirectory(prefix="connector-corpora-", ignore_cleanup_errors=True) as tmp:
        results = build(pathlib.Path(tmp))
        if LAST_RUN_REFUSED:
            raise NetworkRefused(f"the run tried to reach the network: {LAST_RUN_REFUSED}")
        for name, result in results.items():
            path = out_dir / f"{name}.json"
            _write_atomically(path, render(result))
            written.append(path)
    return written


def _write_atomically(path: pathlib.Path, text: str) -> None:
    """Encode to a temp file beside `path`, then `os.replace` (Task 15): `write_text` opens
    with "w", which TRUNCATES the committed fixture before a byte of the new one is written,
    so a failure mid-write would leave a half fixture for the byte rail to compare against."""
    data = text.encode("utf-8")  # an encoding failure raises before anything is touched
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp_name, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp_name)
        raise


if __name__ == "__main__":
    for written_path in generate():
        print(f"wrote {written_path}")
