"""Hashed JS and CSS are served from build-time Brotli and gzip files.

Every test but the last two talks to the real StaticFiles subclass over a real ASGI
client, against a temporary dist. The sidecar bytes are deliberately NOT valid Brotli
or gzip: `iter_raw` reads what went on the wire, so the assertion is "these exact
bytes were sent", and no client-side decoder can hide a wrong file.
"""
from __future__ import annotations

import ast
import os
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.testclient import TestClient

from api.services.static_assets import ImmutableStaticFiles

REPO = Path(__file__).resolve().parents[1]
JS = "app-abc123.js"
PLAIN = b"console.log('the plain bytes of a hashed chunk');" * 40
BR = b"BROTLI-SIDECAR-BYTES" * 3
# Over the runtime GZip middleware's minimum_size (1000), so it would act on this.
GZ = b"GZIP-SIDECAR-BYTES-LONGER" * 50
CACHE = "public, max-age=31536000, immutable, no-transform"


@pytest.fixture()
def assets(tmp_path):
    """<tmp>/dist/assets, with one fully precompressed chunk and decoys outside it."""
    d = tmp_path / "dist" / "assets"
    d.mkdir(parents=True)
    (d / JS).write_bytes(PLAIN)
    (d / f"{JS}.br").write_bytes(BR)
    (d / f"{JS}.gz").write_bytes(GZ)
    for outside in (tmp_path / "dist", tmp_path):
        (outside / "secret.js").write_bytes(b"OUTSIDE-PLAIN")
        (outside / "secret.js.br").write_bytes(b"OUTSIDE-BROTLI")
    return d


@pytest.fixture()
def client(assets):
    app = Starlette(routes=[Mount("/assets", app=ImmutableStaticFiles(directory=str(assets)))])
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def fetch(client, name=JS, method="GET", **headers):
    """(response, the bytes on the wire). `Accept-Encoding` is always set explicitly,
    because httpx would otherwise send its own default."""
    wire = {k.replace("_", "-"): v for k, v in headers.items()}
    wire.setdefault("accept-encoding", "identity")
    with client.stream(method, f"/assets/{name}", headers=wire) as r:
        return r, b"".join(r.iter_raw())


# ── negotiation ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("accept, coding, body", [
    ("br, gzip", "br", BR),
    ("gzip, deflate, br, zstd", "br", BR),
    ("BR", "br", BR),
    ("gzip", "gzip", GZ),
    ("gzip;q=1.0, br;q=0.5", "gzip", GZ),
    ("br;q=0, gzip", "gzip", GZ),
    ("*", "br", BR),
    ("gzip;q=0, *", "br", BR),
])
def test_the_client_gets_the_coding_it_prefers(client, accept, coding, body):
    r, wire = fetch(client, accept_encoding=accept)
    assert r.status_code == 200
    assert r.headers["content-encoding"] == coding
    assert wire == body
    assert r.headers["content-length"] == str(len(body))


@pytest.mark.parametrize("accept", [
    "identity", "", "deflate", "zstd", "br;q=0, gzip;q=0", "*;q=0", "br;q=banana",
])
def test_a_client_accepting_neither_gets_the_plain_file(client, accept):
    r, wire = fetch(client, accept_encoding=accept)
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert wire == PLAIN
    assert r.headers["content-length"] == str(len(PLAIN))


@pytest.mark.parametrize("accept", ["br", "gzip", "identity"])
def test_every_representation_keeps_the_cache_contract(client, accept):
    r, _ = fetch(client, accept_encoding=accept)
    assert r.headers["cache-control"] == CACHE
    assert r.headers["vary"] == "Accept-Encoding"


def test_an_encoded_response_keeps_the_javascript_type(client):
    plain, _ = fetch(client)
    encoded, _ = fetch(client, accept_encoding="br")
    assert "javascript" in plain.headers["content-type"]
    assert encoded.headers["content-type"] == plain.headers["content-type"]


def test_css_is_served_precompressed_too(client, assets):
    (assets / "app-1.css").write_bytes(b"body{color:red}" * 50)
    (assets / "app-1.css.br").write_bytes(BR)
    r, wire = fetch(client, "app-1.css", accept_encoding="br")
    assert r.headers["content-encoding"] == "br"
    assert "text/css" in r.headers["content-type"]
    assert wire == BR


# ── fallback ──────────────────────────────────────────────────────────────────

def test_a_missing_br_falls_back_to_gzip(client, assets):
    (assets / f"{JS}.br").unlink()
    r, wire = fetch(client, accept_encoding="br, gzip")
    assert r.headers["content-encoding"] == "gzip"
    assert wire == GZ


def test_missing_sidecars_fall_back_to_the_plain_file(client, assets):
    (assets / f"{JS}.br").unlink()
    (assets / f"{JS}.gz").unlink()
    r, wire = fetch(client, accept_encoding="br, gzip")
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert wire == PLAIN
    assert r.headers["vary"] == "Accept-Encoding"
    assert r.headers["cache-control"] == CACHE


def test_an_empty_sidecar_is_treated_as_missing(client, assets):
    (assets / f"{JS}.br").write_bytes(b"")
    r, wire = fetch(client, accept_encoding="br")
    assert "content-encoding" not in r.headers
    assert wire == PLAIN


def test_a_sidecar_with_no_plain_file_is_a_404(client, assets):
    (assets / JS).unlink()
    r, _ = fetch(client, accept_encoding="br")
    assert r.status_code == 404


@pytest.mark.parametrize("value", ["0", "false", "No", " 0 "])
def test_the_kill_switch_restores_plain_serving(client, monkeypatch, value):
    monkeypatch.setenv("PRECOMPRESSED_ASSETS_ENABLED", value)
    r, wire = fetch(client, accept_encoding="br, gzip")
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert "vary" not in r.headers
    assert wire == PLAIN
    assert r.headers["content-length"] == str(len(PLAIN))
    assert r.headers["accept-ranges"] == "bytes"
    assert r.headers["cache-control"] == CACHE


@pytest.mark.parametrize("value", [None, "1", "", "garbage"])
def test_the_kill_switch_defaults_to_on(client, monkeypatch, value):
    if value is None:
        monkeypatch.delenv("PRECOMPRESSED_ASSETS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("PRECOMPRESSED_ASSETS_ENABLED", value)
    r, wire = fetch(client, accept_encoding="br")
    assert r.headers["content-encoding"] == "br"
    assert wire == BR


def test_the_kill_switch_also_gives_plain_304s(client, monkeypatch):
    monkeypatch.setenv("PRECOMPRESSED_ASSETS_ENABLED", "0")
    first, _ = fetch(client, accept_encoding="br")
    r, _ = fetch(client, accept_encoding="br", if_none_match=first.headers["etag"])
    assert r.status_code == 304
    assert r.headers["etag"] == first.headers["etag"]
    assert "-br" not in r.headers["etag"]


def test_the_kill_switch_is_read_per_request(client, monkeypatch):
    monkeypatch.setenv("PRECOMPRESSED_ASSETS_ENABLED", "0")
    assert "content-encoding" not in fetch(client, accept_encoding="br")[0].headers
    monkeypatch.setenv("PRECOMPRESSED_ASSETS_ENABLED", "1")
    assert fetch(client, accept_encoding="br")[0].headers["content-encoding"] == "br"


def test_a_font_has_no_negotiation_and_keeps_its_caching(client, assets):
    (assets / "brand-v4.woff2").write_bytes(b"wOF2" * 100)
    (assets / "brand-v4.woff2.br").write_bytes(BR)
    r, wire = fetch(client, "brand-v4.woff2", accept_encoding="br, gzip")
    assert "content-encoding" not in r.headers
    assert "vary" not in r.headers
    assert wire == b"wOF2" * 100
    assert r.headers["cache-control"] == CACHE


# ── HEAD ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("accept, coding, size", [
    ("br", "br", len(BR)), ("gzip", "gzip", len(GZ)), ("identity", None, len(PLAIN)),
])
def test_head_answers_like_get_with_no_body(client, accept, coding, size):
    r, wire = fetch(client, method="HEAD", accept_encoding=accept)
    assert r.status_code == 200
    assert wire == b""
    assert r.headers.get("content-encoding") == coding
    assert r.headers["content-length"] == str(size)
    assert r.headers["vary"] == "Accept-Encoding"
    assert r.headers["cache-control"] == CACHE


# ── Range: always the plain bytes, because an offset into a compressed stream is
#    not an offset into the file ──────────────────────────────────────────────

@pytest.mark.parametrize("accept", ["br, gzip", "gzip", "identity"])
def test_a_range_request_gets_plain_bytes(client, accept):
    r, wire = fetch(client, accept_encoding=accept, range="bytes=0-9")
    assert r.status_code == 206
    assert "content-encoding" not in r.headers
    assert wire == PLAIN[:10]
    assert r.headers["content-range"] == f"bytes 0-9/{len(PLAIN)}"
    assert r.headers["content-length"] == "10"
    assert r.headers["vary"] == "Accept-Encoding"
    assert r.headers["cache-control"] == CACHE


def test_an_encoded_response_does_not_advertise_ranges(client):
    encoded, _ = fetch(client, accept_encoding="br")
    plain, _ = fetch(client)
    assert "accept-ranges" not in encoded.headers
    assert plain.headers["accept-ranges"] == "bytes"


def test_if_range_with_the_encoded_etag_restarts_with_the_whole_plain_file(client):
    """A resume that names the Brotli representation must not be answered with a
    slice of a different representation."""
    first, _ = fetch(client, accept_encoding="br")
    r, wire = fetch(client, accept_encoding="br", range="bytes=0-9", if_range=first.headers["etag"])
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert wire == PLAIN


def test_an_unsatisfiable_range_is_a_416(client):
    r, _ = fetch(client, accept_encoding="br", range=f"bytes={len(PLAIN) + 5}-")
    assert r.status_code == 416


# ── ETag and 304 ──────────────────────────────────────────────────────────────

def test_each_representation_has_its_own_etag(client):
    tags = {fetch(client, accept_encoding=a)[0].headers["etag"] for a in ("br", "gzip", "identity")}
    assert len(tags) == 3


def test_two_sidecars_with_identical_stats_still_have_distinct_etags(client, assets):
    br, gz = assets / f"{JS}.br", assets / f"{JS}.gz"
    gz.write_bytes(b"x" * len(BR))
    st = br.stat()
    os.utime(gz, ns=(st.st_atime_ns, st.st_mtime_ns))
    assert fetch(client, accept_encoding="br")[0].headers["etag"] != \
        fetch(client, accept_encoding="gzip")[0].headers["etag"]


@pytest.mark.parametrize("accept", ["br", "gzip", "identity"])
def test_a_matching_etag_is_a_304_that_keeps_the_contract(client, accept):
    first, _ = fetch(client, accept_encoding=accept)
    r, wire = fetch(client, accept_encoding=accept, if_none_match=first.headers["etag"])
    assert r.status_code == 304
    assert wire == b""
    assert r.headers["etag"] == first.headers["etag"]
    assert r.headers["cache-control"] == CACHE
    assert r.headers["vary"] == "Accept-Encoding"


def test_a_weakened_etag_still_matches(client):
    first, _ = fetch(client, accept_encoding="br")
    r, _ = fetch(client, accept_encoding="br", if_none_match="W/" + first.headers["etag"])
    assert r.status_code == 304


def test_an_etag_for_another_coding_is_not_a_304(client):
    br, _ = fetch(client, accept_encoding="br")
    r, wire = fetch(client, accept_encoding="gzip", if_none_match=br.headers["etag"])
    assert r.status_code == 200
    assert r.headers["content-encoding"] == "gzip"
    assert wire == GZ


# ── paths ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", [f"{JS}.br", f"{JS}.gz"])
def test_a_sidecar_cannot_be_fetched_by_name(client, name):
    """It would go out as compressed bytes with no Content-Encoding."""
    r, wire = fetch(client, name, accept_encoding="br, gzip")
    assert r.status_code == 404
    assert BR not in wire and GZ not in wire


@pytest.mark.parametrize("target, reaches", [
    ("..%2Fsecret.js", "../secret.js"),
    ("..%2F..%2Fsecret.js", "../../secret.js"),
    ("%2e%2e%2Fsecret.js", "../secret.js"),
    ("a%2F..%2F..%2Fsecret.js", "../secret.js"),
    ("..%2Fsecret.js.br", "../secret.js.br"),
])
@pytest.mark.parametrize("accept", ["br, gzip", "identity"])
def test_traversal_never_serves_a_file_outside_the_mount(assets, target, reaches, accept):
    """Percent-encoded, because a client collapses a literal `..` before sending and the
    request would never reach the mount. The spy proves this one did."""
    reached = []

    class Spy(ImmutableStaticFiles):
        async def get_response(self, path, scope):
            reached.append(path.replace(os.sep, "/"))
            return await super().get_response(path, scope)

    app = Starlette(routes=[Mount("/assets", app=Spy(directory=str(assets)))])
    with TestClient(app, raise_server_exceptions=False) as c:
        r, wire = fetch(c, target, accept_encoding=accept)
    assert reached == [reaches]
    assert r.status_code == 404
    assert b"OUTSIDE" not in wire


def test_a_null_byte_is_a_404(client):
    r, wire = fetch(client, f"{JS}%00.br", accept_encoding="br")
    assert r.status_code == 404
    assert wire != BR


def _symlink_or_skip(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target)
    except OSError as e:
        pytest.skip(f"symlinks unavailable here: {e}")


def test_a_sidecar_symlink_out_of_the_mount_is_ignored(client, assets, tmp_path):
    (assets / f"{JS}.br").unlink()
    _symlink_or_skip(assets / f"{JS}.br", tmp_path / "secret.js.br")
    r, wire = fetch(client, accept_encoding="br")
    assert b"OUTSIDE" not in wire
    assert wire == PLAIN


def test_a_directory_named_like_a_sidecar_is_ignored(client, assets):
    (assets / f"{JS}.br").unlink()
    (assets / f"{JS}.br").mkdir()
    r, wire = fetch(client, accept_encoding="br")
    assert "content-encoding" not in r.headers
    assert wire == PLAIN


def test_a_post_is_still_refused(client):
    r = client.post(f"/assets/{JS}")
    assert r.status_code == 405


def test_a_missing_file_is_a_404(client):
    r, _ = fetch(client, "nope-1.js", accept_encoding="br")
    assert r.status_code == 404


# ── the real app ──────────────────────────────────────────────────────────────

def _behind_the_real_gzip(assets):
    from api.main import _GZipSkipSSE

    inner = Starlette(routes=[Mount("/assets", app=ImmutableStaticFiles(directory=str(assets)))])
    return TestClient(_GZipSkipSSE(inner, minimum_size=1000, compresslevel=5))


def test_the_real_gzip_middleware_passes_a_sidecar_through(assets):
    assert len(GZ) >= 1000
    with _behind_the_real_gzip(assets) as c:
        r, wire = fetch(c, accept_encoding="gzip")
    assert r.headers["content-encoding"] == "gzip"
    assert wire == GZ


def test_a_plain_fallback_is_not_gzipped_at_runtime(assets):
    """The case the /assets exemption actually decides. Starlette's GZip already leaves a
    response alone when it carries Content-Encoding, so only an UNencoded response can
    show the exemption is gone, and runtime gzip of these files is the truncation 0e62823
    removed."""
    (assets / f"{JS}.br").unlink()
    (assets / f"{JS}.gz").unlink()
    assert len(PLAIN) >= 1000
    with _behind_the_real_gzip(assets) as c:
        r, wire = fetch(c, accept_encoding="gzip")
    assert "content-encoding" not in r.headers
    assert wire == PLAIN


def test_main_mounts_this_class_on_assets():
    tree = ast.parse((REPO / "api" / "main.py").read_text(encoding="utf-8"))
    imported = [
        alias for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
        and node.module == "api.services.static_assets" for alias in node.names
    ]
    assert [(a.name, a.asname) for a in imported] == [("ImmutableStaticFiles", "_ImmutableStaticFiles")]
    mounts = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        and node.func.attr == "mount" and node.args
        and isinstance(node.args[0], ast.Constant) and node.args[0].value == "/assets"
    ]
    assert len(mounts) == 1
    assert mounts[0].args[1].func.id == "_ImmutableStaticFiles"
