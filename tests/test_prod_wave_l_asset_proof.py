"""`tools/prod_wave_l_asset_proof.py` must read the real bytes of a compressed chunk.

Hashed JS and CSS are now served as Brotli, and Cloudflare can hand back an encoded
copy from its cache. A proof that reads the encoded bytes as text finds no marker in
any chunk, and "absent" is exactly what it would wrongly report. The tool is asked
over real HTTP, by a local server that records what it was sent.
"""
from __future__ import annotations

import gzip
import http.server
import importlib.util
import sys
import threading
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TEXT = b"export const marker = 'not the whole article';\n" * 20


def load_tool():
    spec = importlib.util.spec_from_file_location(
        "prod_wave_l_asset_proof", REPO / "tools" / "prod_wave_l_asset_proof.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def serve():
    """serve(body, encoding) -> (url, the headers of the request it received)."""
    servers = []

    def start(body: bytes, encoding: str | None):
        received: dict[str, str] = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                received.update({k.lower(): v for k, v in self.headers.items()})
                self.send_response(200)
                if encoding:
                    self.send_header("Content-Encoding", encoding)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return f"http://127.0.0.1:{server.server_address[1]}/assets/a-1.js", received

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()


def test_it_asks_for_brotli_and_decodes_it(serve):
    brotli = pytest.importorskip("brotli")
    url, received = serve(brotli.compress(TEXT), "br")
    assert load_tool().fetch(url) == TEXT
    assert received["accept-encoding"] == "br"


def test_it_decodes_gzip(serve):
    url, _ = serve(gzip.compress(TEXT), "gzip")
    assert load_tool().fetch(url) == TEXT


def test_a_plain_answer_is_returned_as_it_came(serve):
    url, _ = serve(TEXT, None)
    assert load_tool().fetch(url) == TEXT


def test_an_unknown_encoding_is_an_error_not_garbage(serve):
    url, _ = serve(b"\x28\xb5\x2f\xfd", "zstd")
    with pytest.raises(ValueError, match="zstd"):
        load_tool().fetch(url)


def test_with_no_brotli_package_it_refuses_rather_than_reporting_absence(monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "brotli", None)
    # A closed local port, NEVER the default --base: that default is production.
    monkeypatch.setattr(sys, "argv", ["prod_wave_l_asset_proof.py", "--base", "http://127.0.0.1:9"])
    assert load_tool().main() == 2
    assert "brotli" in capsys.readouterr().err
