"""Wave Q1 — the harness must know WHICH SERVER answered.

⚰️ The incident these rails exist for: port 8099 held FOUR listeners. Three were
Wave Q throwaway static servers; the fourth was another workstream's hub sandbox
on `0.0.0.0:8099`. Windows allowed every bind without an error, the local probe
fetches came back empty, and from the outside that was indistinguishable from a
browser that could not run the probe.

⛔ So the property under test is a REFUSAL, and every rail here carries the
control that shows the same setup succeeds when the server really is ours.
"""
from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from tools.q1_probe_server import (
    IDENTITY_PATH,
    KIND,
    SLOW_IDENTITY_PATH,
    PortAlreadyOwned,
    ProbeServer,
    free_port,
    port_has_a_listener,
    verify_identity,
)


# ── a stranger on the port: the hub sandbox's stand-in ──────────────────────
class _StrangerHandler(BaseHTTPRequestHandler):
    def log_message(self, *_a):
        pass

    def do_GET(self):  # noqa: N802
        # It answers 200 on the identity path — that is the whole trap. A
        # reachable server is not the right server.
        body = json.dumps({"kind": "some-other-service", "nonce": "not-ours"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class _Stranger:
    def __init__(self):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _StrangerHandler)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture()
def stranger():
    s = _Stranger()
    yield s
    s.stop()


# ── the control, first: a server we started proves it is ours ───────────────
def test_a_probe_server_can_prove_it_is_the_one_answering():
    with ProbeServer() as server:
        ok, reason, payload = verify_identity(server.url, server.nonce)
        assert ok, reason
        assert payload["kind"] == KIND
        assert payload["nonce"] == server.nonce
        assert payload["run_id"] == server.run_id
        # and it serves the probe page it exists to serve
        import urllib.request

        html = urllib.request.urlopen(f"{server.url}/q1-probe.html", timeout=5).read().decode()
        assert "Wave Q1 browser probe" in html


def test_the_url_the_browser_gets_is_the_url_that_was_verified():
    # ⛔ Verifying one URL and handing the browser another is the same defect
    # wearing a different hat.
    with ProbeServer() as server:
        assert server.url.endswith(f":{server.port}")
        ok, _, payload = verify_identity(server.url, server.nonce)
        assert ok and payload["pid"]


# ── ⛔ THE WRONG SERVER ─────────────────────────────────────────────────────
def test_a_stranger_answering_200_is_REFUSED(stranger):
    # This is the incident, reproduced without creating a real collision
    # against anybody's running service.
    ok, reason, payload = verify_identity(stranger.url, "the-nonce-we-minted")
    assert ok is False
    assert reason == "SERVER_IDENTITY_MISMATCH"
    assert payload["kind"] == "some-other-service"


def test_a_right_shaped_answer_with_the_WRONG_NONCE_is_refused():
    # ⭐ The sharper case: a previous run's own probe server, still up. Same
    # `kind`, same everything — except the nonce, which is minted per run.
    with ProbeServer() as older_run:
        ok, reason, _ = verify_identity(older_run.url, "a-different-runs-nonce")
        assert ok is False
        assert reason == "SERVER_IDENTITY_MISMATCH"
        # …and the control: its OWN nonce is accepted.
        ok2, _, _ = verify_identity(older_run.url, older_run.nonce)
        assert ok2 is True


def test_nothing_listening_never_reads_as_the_WRONG_SERVER():
    """⚰️ A platform fact this rail discovered rather than assumed.

    On this Windows box, connecting to an unbound loopback port does NOT get
    refused — the packets are dropped and the connect TIMES OUT. So "nothing is
    there" and "something is slow" are the SAME observation at the socket layer,
    and no amount of timing will separate them.

    ⛔ Which is exactly why identity cannot be inferred and has to be asked for.
    What this rail pins is the part that must hold on every platform: an absent
    server is never reported as the wrong server, and the harness fails closed
    either way.
    """
    port = free_port()
    ok, reason, payload = verify_identity(f"http://127.0.0.1:{port}", "whatever", timeout=2.0)
    assert ok is False
    assert reason in ("SERVER_UNREACHABLE", "TRANSPORT_TIMEOUT")
    assert reason != "SERVER_IDENTITY_MISMATCH"
    assert payload is None


# ── ⛔ PORT OWNERSHIP ───────────────────────────────────────────────────────
def test_the_harness_refuses_to_bind_beside_an_existing_listener(stranger):
    with pytest.raises(PortAlreadyOwned) as e:
        ProbeServer(port=stranger.port).start()
    assert "already has a listener" in str(e.value)
    # ⛔ And it did not kill anything: the incumbent is still answering.
    assert port_has_a_listener(stranger.port)


def test_port_has_a_listener_connects_rather_than_binding(stranger):
    # ⭐ The distinction that matters on Windows: a bind can succeed beside a
    # stranger, a connect cannot lie about one being there.
    assert port_has_a_listener(stranger.port) is True
    assert port_has_a_listener(free_port()) is False


def test_an_os_assigned_port_is_used_when_none_is_given():
    with ProbeServer() as a, ProbeServer() as b:
        assert a.port != b.port
        # both provable, independently
        assert verify_identity(a.url, a.nonce)[0]
        assert verify_identity(b.url, b.nonce)[0]


# ── ⛔ SLOW IS NOT WRONG ────────────────────────────────────────────────────
def test_a_slow_server_still_proves_its_identity_given_time():
    with ProbeServer() as server:
        t0 = time.time()
        ok, reason, payload = verify_identity(
            server.url, server.nonce, timeout=10.0, path=f"{SLOW_IDENTITY_PATH}?ms=900"
        )
        assert ok is True, reason
        assert payload["delayedMs"] == 900
        assert time.time() - t0 >= 0.8


def test_a_slow_server_that_runs_out_of_time_is_a_TIMEOUT_not_a_mismatch():
    # ⛔ The classification the Firefox/WebKit misreading needed and did not
    # have. A server that is merely slow must never be reported as the wrong
    # server, and never as a browser that cannot do the work.
    with ProbeServer() as server:
        ok, reason, _ = verify_identity(
            server.url, server.nonce, timeout=0.4, path=f"{SLOW_IDENTITY_PATH}?ms=2500"
        )
        assert ok is False
        assert reason == "TRANSPORT_TIMEOUT"


def test_the_slow_endpoint_is_bounded():
    from tools.q1_probe_server import MAX_SLOW_MS

    assert MAX_SLOW_MS <= 30_000


# ── the identity payload is machine-readable and per-run ───────────────────
def test_identity_carries_what_a_reader_needs_to_chase_it():
    with ProbeServer() as server:
        payload = json.loads(
            __import__("urllib.request", fromlist=["request"]).urlopen(
                server.url + IDENTITY_PATH, timeout=5
            ).read().decode()
        )
        for field in ("kind", "run_id", "nonce", "pid", "started_at", "root"):
            assert field in payload, field
        assert payload["pid"] > 0


def test_two_runs_never_share_a_nonce():
    seen = {ProbeServer().nonce for _ in range(25)}
    assert len(seen) == 25


def test_the_served_root_cannot_be_escaped():
    with ProbeServer() as server:
        import urllib.error
        import urllib.request

        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(f"{server.url}/../../package.json", timeout=5)
        assert e.value.code in (403, 404)
