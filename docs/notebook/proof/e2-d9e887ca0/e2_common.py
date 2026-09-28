"""Shared plumbing for lane 10E-2's three sandbox instruments (cross-tenant probe, keyboard
walk, UCT captures). Nothing here judges anything; each instrument owns its verdict.

* A PORT IS NOT AN IDENTITY: `require_identity` asks `scripts/sandbox_identity.verify` (the
  launcher's own helper) before one request is sent, and exits 3 when it cannot prove it.
* Accounts are the perf harness's sandbox-local test identity (`ADMIN_EMAIL`/`ADMIN_PW`,
  imported, never retyped) plus two e2 members provisioned the same way the harness does
  (sign up or sign in; comp; verify email; then /api/auth/me must say paid-equivalent).
"""
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "scripts"))
import notebook_perf_harness as h  # noqa: E402
import sandbox_identity  # noqa: E402

ADMIN_EMAIL, PW = h.ADMIN_EMAIL, h.ADMIN_PW
MEMBER_A = "e2-member-a@local.dev"
MEMBER_B = "e2-member-b@local.dev"
INTRO_DIALOG_SEL = '[role="dialog"][aria-label*="ntro"], [data-testid="intro-overlay"]'


def ready_record(scratch: Path) -> dict:
    return json.loads((Path(scratch) / "sandbox-ready.json").read_text(encoding="utf-8"))


def require_identity(base: str, integrity_log: str) -> str:
    v = sandbox_identity.verify(base, integrity_log)
    if not v.ok:
        print("REFUSED: " + v.sentence, flush=True)
        raise SystemExit(3)
    print("SANDBOX IDENTITY: " + v.sentence, flush=True)
    return v.nonce


def signup_or_login(req, base, email, pw, name, window_s=61.0, tries=3):
    def ask(path, data):
        r = None
        for i in range(tries):
            r = req.post(base + path, data=data)
            if r.status != 429:
                return r
            if i + 1 < tries:
                time.sleep(window_s)
        return r
    r = ask("/api/auth/signup", {"email": email, "password": pw, "display_name": name})
    if r.status in (200, 201):
        return r
    return ask("/api/auth/login", {"email": email, "password": pw})


def provision(admin_req, member_req, base, email, name) -> dict:
    """Sign the member in, comp + verify through the admin, and return /api/auth/me."""
    signup_or_login(member_req, base, email, PW, name)
    c = admin_req.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    v = admin_req.post(base + "/api/auth/admin/verify-email", data={"email": email})
    me = member_req.get(base + "/api/auth/me").json()
    me["_comp_status"], me["_verify_status"] = c.status, v.status
    return me


def dismiss_intro(pg, appear_timeout=2500, detach_timeout=6000):
    """The Welcome intro plays once per tab; Escape finishes it (IntroAnimation.jsx)."""
    try:
        pg.get_by_role("button", name="Skip intro").first.wait_for(state="visible", timeout=appear_timeout)
    except Exception:  # noqa: BLE001 -- it never appeared this tab
        return False
    try:
        pg.keyboard.press("Escape")
        pg.get_by_role("button", name="Skip intro").first.wait_for(state="detached", timeout=detach_timeout)
        return True
    except Exception:  # noqa: BLE001
        try:
            pg.get_by_role("button", name="Skip intro").first.click(timeout=1500)
        except Exception:  # noqa: BLE001
            pass
        return False
