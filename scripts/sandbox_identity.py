"""Who is answering on that port? The hub sandbox launcher's identity marker.

Wave 7 whole-branch fix, tooling review M-3.

⛔ A PORT ASSIGNMENT IS NOT A SERVER IDENTITY (CLAUDE.md, the 8077 / 8099 incidents). A tool
pointed at `--base` signed up accounts, comped them and seeded notes through WHATEVER answered
that port. A stale non-sandbox backend -- CLAUDE.md's own mobile-audit recipe,
`uvicorn api.main:app --port 8077`, resolves every path to C:\\data -- would have taken those
writes into the owner's live auth.db, while the tool read some other sandbox's clean
integrity log and reported nothing wrong.

So the launcher (`scripts/hub_sandbox_boot.py`) mints a per-run NONCE before it serves
anything, writes it into its integrity log's pre-boot checkpoint (`log_extra`), and serves it
at `IDENTITY_PATH` through an ASGI wrapper around the app (`wrap_app`; nothing under `api/`
changes). A `--base` client reads the nonce from the integrity log it was handed AND from the
server, and writes nothing unless the two are the same: then the server it is about to write
through IS the sandbox that writes that log. This is `tools/q1_probe_server.py`'s idiom (a
nonce minted before anything binds, served at a well-known path, recognised by the caller),
applied to the launcher.

⭐ Importable by any `--base` tool -- the editor perf harness uses it, and the wave-7 walk can:

    sys.path.insert(0, str(REPO / "scripts"))
    import sandbox_identity
    verdict = sandbox_identity.verify(base, integrity_log)
    if not verdict.ok:
        print("REFUSED: " + verdict.sentence)      # and write nothing

Stdlib only; imports nothing from `api`, touches no path of its own.
"""
from __future__ import annotations

import json
import re
import secrets
import urllib.error
import urllib.request
from pathlib import Path
from typing import NamedTuple

KIND = "uct-hub-sandbox"
IDENTITY_PATH = "/__uct_sandbox_identity"
_NONCE_RE = re.compile(r"\bidentity = ([0-9a-f]{32})\b")


def mint() -> str:
    """A fresh per-run nonce: 128 random bits, hex."""
    return secrets.token_hex(16)


def log_extra(sandbox: str, nonce: str) -> str:
    """The pre-boot checkpoint's detail line (`data_root_snapshot.append_log(extra=...)`)."""
    return f"sandbox = {sandbox}; identity = {nonce}"


def payload(nonce: str, *, data_dir: str, integrity_log: str, pid: int, started_at: str) -> dict:
    """What `IDENTITY_PATH` answers."""
    return {"kind": KIND, "identity": nonce, "data_dir": data_dir,
            "integrity_log": integrity_log, "pid": pid, "started_at": started_at}


def wrap_app(inner, body: dict):
    """An ASGI app that answers `IDENTITY_PATH` (GET or HEAD) with `body` as JSON and hands every
    other scope -- the app's own routes and its lifespan alike -- to `inner` untouched."""
    raw = json.dumps(body).encode("utf-8")
    headers = [(b"content-type", b"application/json"), (b"cache-control", b"no-store"),
               (b"content-length", str(len(raw)).encode("ascii"))]

    async def app(scope, receive, send):
        if scope.get("type") == "http" and scope.get("path") == IDENTITY_PATH:
            await send({"type": "http.response.start", "status": 200, "headers": headers})
            await send({"type": "http.response.body",
                        "body": b"" if scope.get("method") == "HEAD" else raw})
            return
        await inner(scope, receive, send)

    return app


def identity_from_log(path) -> tuple[str | None, str]:
    """`(nonce, "")`, or `(None, why)`: the identity the launcher wrote into this integrity log."""
    if not path or not Path(path).is_file():
        return None, f"the integrity log {str(path)!r} does not exist"
    found = sorted(set(_NONCE_RE.findall(Path(path).read_text(encoding="utf-8", errors="replace"))))
    if not found:
        return None, (f"the integrity log {str(path)!r} names no sandbox identity (a launcher older "
                      "than the marker, or not a hub sandbox launcher's log)")
    if len(found) > 1:
        return None, (f"the integrity log {str(path)!r} names {len(found)} different identities -- "
                      "it is not one run's log")
    return found[0], ""


def fetch_identity(base: str, timeout: float = 5.0) -> tuple[dict | None, str]:
    """`(marker, "")` from `base + IDENTITY_PATH`, or `(None, why)`."""
    url = base.rstrip("/") + IDENTITY_PATH
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            status, body = r.status, r.read(65536)
    except urllib.error.HTTPError as e:
        return None, f"GET {IDENTITY_PATH} answered HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 -- refused, timed out, reset: all "not proven"
        return None, f"GET {IDENTITY_PATH} failed ({type(e).__name__}: {e})"
    try:
        data = json.loads(body.decode("utf-8"))
    except ValueError:
        return None, (f"GET {IDENTITY_PATH} answered HTTP {status} with a body that is not JSON (the "
                      "web app's SPA fallback answers any unknown GET with a 200 page)")
    if not isinstance(data, dict) or data.get("kind") != KIND:
        return None, f"GET {IDENTITY_PATH} answered HTTP {status} without the hub sandbox marker"
    return data, ""


class Verdict(NamedTuple):
    ok: bool
    sentence: str
    nonce: str | None


def verify(base: str, integrity_log, timeout: float = 5.0) -> Verdict:
    """Is the server at `base` the sandbox that writes `integrity_log`? Both halves are read;
    a mismatch, an absence or an error on either is NOT PROVEN, and the sentence names what
    was checked. Never raises."""
    nonce, why = identity_from_log(integrity_log)
    if nonce is None:
        return Verdict(False, f"{base} was not proven to be this run's sandbox: {why}. Nothing was "
                              "written.", None)
    data, why = fetch_identity(base, timeout)
    if data is None:
        return Verdict(False, f"{base} did not prove it is the sandbox that writes {integrity_log} "
                              f"(identity {nonce[:12]}...): {why}. A server that answers /api/health is "
                              "not therefore that sandbox. Nothing was written.", nonce)
    got = str(data.get("identity"))
    if got != nonce:
        return Verdict(False, f"{base} is a hub sandbox, but not the one that writes {integrity_log}: it "
                              f"answers identity {got[:12]}... and the log names {nonce[:12]}... (its own "
                              f"log is {data.get('integrity_log')}). Nothing was written.", nonce)
    return Verdict(True, f"{base} proved it is the sandbox that writes {integrity_log} (identity "
                         f"{nonce[:12]}..., data dir {data.get('data_dir')})", nonce)
