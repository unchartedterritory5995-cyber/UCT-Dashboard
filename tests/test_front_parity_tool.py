"""`tools/front_parity.py`: the comparison tool must be able to give each of its answers.

The tool decides whether member traffic may be sent to the front door, so a tool that can
only say "identical" is worse than no tool. Its own `--self-check` starts real local
servers and requires: 0 for two identical origins, 1 for a single differing header (with
the path and field named), and 2, never 0 or 1, for an unreachable origin, an origin
answering 502 mid-run, a server that booted seconds ago, and a shell with no assets.

The last three of those are in the tool because the first real runs hit them: the live
origin "differed" from itself by 95 comparisons during a restart, by 5 because a gzip
stream carries a timestamp, and stopped answering 60 seconds after a boot.
"""
from __future__ import annotations

import gzip
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _tool():
    spec = importlib.util.spec_from_file_location("front_parity", os.path.join(ROOT, "tools", "front_parity.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_self_check_passes():
    lines = []
    assert _tool().self_check(out=lines.append) == 0, "\n".join(lines)
    assert sum(1 for ln in lines if ln.strip().startswith("ok")) >= 8, lines
    assert not [ln for ln in lines if "FAIL" in ln], lines


def test_gateway_statuses_are_never_a_verdict():
    assert set(_tool().GATEWAY_STATUSES) == {502, 503, 504}


def test_the_compared_and_ignored_headers_do_not_overlap():
    tool = _tool()
    assert not set(tool.COMPARED) & set(tool.IGNORED)
    for must in ("cache-control", "content-type", "content-encoding", "vary", "link", "x-robots-tag"):
        assert must in tool.COMPARED, must


def test_two_gzip_streams_of_one_answer_hash_the_same(monkeypatch):
    """gzip embeds a timestamp: the same answer compressed twice is two byte strings."""
    tool = _tool()
    payload = b'{"rows": [1, 2, 3]}' * 50
    streams = [gzip.compress(payload, mtime=1), gzip.compress(payload, mtime=2)]
    assert streams[0] != streams[1]

    class _Resp:
        status = 200

        def __init__(self, body):
            self._body = body
            self.headers = {"Content-Encoding": "gzip", "Content-Type": "application/json"}

        def read(self):
            return self._body

    hashes = []
    for body in streams:
        monkeypatch.setattr(tool._OPENER, "open", lambda req, timeout=None, _b=body: _Resp(_b))
        hashes.append(tool.fetch("http://x", "/api/x", "gzip", False)[2])
    assert hashes[0] == hashes[1]
