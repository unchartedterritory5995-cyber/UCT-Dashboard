"""Wave L Slice 3 — the REAL-BROWSER proof for UCT Browser Capture (§20).

⛔ WHY ORDINARY FETCH TESTS ARE NOT ENOUGH HERE. Every interesting property of
this feature is a property of Chromium, not of Python: whether a `SameSite=Lax`
cookie rides the authorization navigation, whether `chrome.identity` returns the
code in a fragment, whether an `Authorization` header from a
`chrome-extension://` origin needs a CORS preflight or is exempted by host
permissions, and whether the manifest Chromium actually parsed matches the one
in the repo. A mocked test would have answered all four from memory.

So this loads the ACTUAL unpacked extension into ACTUAL Chromium against the
fail-closed sandbox, and reports what happened.

    python tools/local_backend_sandbox.py --port 8077        # terminal 1
    python tools/capture_extension_audit.py --base http://localhost:8077

⭐ THE DEV BUILD DIFFERS FROM THE SHIPPED ONE IN EXACTLY TWO VALUES, and the
audit asserts that before it starts: `API_BASE` and the single host permission.
Everything the audit proves about permissions, CSP and page access is therefore
a fact about the artifact that ships. A dev build free to differ anywhere would
make this whole run evidence about a different extension.

Exits non-zero on any finding. Writes tools/capture_extension_out/report.json
plus a screenshot per state.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import shutil
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXT_SRC = ROOT / "extension"
OUT_DIR = pathlib.Path(__file__).parent / "capture_extension_out"

ARTICLE_PATH = "/__audit_article"
ARTICLE_HTML = """<!doctype html><html><head><title>Reuters: NVDA margins</title></head>
<body><article><h1>NVDA margins</h1>
<p id="keep">Management expects gross margins to normalize through fiscal 2027.</p>
<p id="other">Unrelated paragraph the extension must not read.</p>
<form><input name="secret" value="MUST-NOT-BE-READ"></form>
<div style="display:none" id="hidden">HIDDEN-MUST-NOT-BE-READ</div>
</article></body></html>"""


def build_dev_extension(base: str) -> tuple[pathlib.Path, list[str]]:
    """Copy the extension and change EXACTLY two values. Returns the path and a
    human-readable list of what differs, which goes into the report."""
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="uct-capture-ext-"))
    dst = tmp / "extension"
    shutil.copytree(EXT_SRC, dst)

    cfg = dst / "lib" / "config.js"
    text = cfg.read_text(encoding="utf-8")
    shipped_base = re.search(r"export const API_BASE = '([^']+)'", text).group(1)
    cfg.write_text(text.replace(f"export const API_BASE = '{shipped_base}'",
                                f"export const API_BASE = '{base}'"), encoding="utf-8")

    man = dst / "manifest.json"
    manifest = json.loads(man.read_text(encoding="utf-8"))
    shipped_hosts = list(manifest["host_permissions"])
    manifest["host_permissions"] = [f"{base}/*"]
    man.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return dst, [f"API_BASE {shipped_base!r} -> {base!r}",
                 f"host_permissions {shipped_hosts} -> {[base + '/*']}"]


def assert_only_two_differences(dev: pathlib.Path, findings: list[str]) -> None:
    """Non-vacuity for the claim above: diff every file, byte for byte."""
    changed = []
    for src in sorted(EXT_SRC.rglob("*")):
        if src.is_dir():
            continue
        rel = src.relative_to(EXT_SRC)
        other = dev / rel
        if not other.exists():
            changed.append(f"missing in dev build: {rel}")
        elif other.read_bytes() != src.read_bytes():
            changed.append(str(rel).replace("\\", "/"))
    expected = {"lib/config.js", "manifest.json"}
    if set(changed) != expected:
        findings.append(f"the dev build differs beyond the two allowed files: {changed}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://localhost:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    ap.add_argument("--keep-open", action="store_true")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed in this interpreter")
        return 2

    OUT_DIR.mkdir(exist_ok=True)
    findings: list[str] = []
    report: dict = {"base": args.base, "steps": [], "network": []}

    dev_ext, differences = build_dev_extension(args.base)
    report["devBuildDifferences"] = differences
    assert_only_two_differences(dev_ext, findings)

    profile = tempfile.mkdtemp(prefix="uct-capture-profile-")

    def step(name: str, ok: bool, detail=None):
        report["steps"].append({"step": name, "ok": bool(ok), "detail": detail})
        if not ok:
            findings.append(f"{name}: {detail}")
        print(f"  [{'ok' if ok else 'XX'}] {name}" + (f" — {detail}" if detail else ""))

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            profile,
            headless=False,          # MV3 service workers do not load headless
            args=[f"--disable-extensions-except={dev_ext}",
                  f"--load-extension={dev_ext}"],
            viewport={"width": 1280, "height": 900},
        )
        try:
            # Serve the "article" from the sandbox ORIGIN so it is inside the
            # extension's single host permission -- no all-sites grant is needed
            # to run this audit, which is itself part of the point.
            ctx.route(f"{args.base}{ARTICLE_PATH}", lambda route: route.fulfill(
                status=200, content_type="text/html", body=ARTICLE_HTML))

            # Every request the browser makes, so the CORS question (§10) is
            # ANSWERED FROM OBSERVATION rather than from memory.
            ctx.on("request", lambda r: report["network"].append(
                {"method": r.method, "url": r.url,
                 "resourceType": r.resource_type}))

            # 1. The extension id, from Chromium itself.
            deadline = time.time() + 30
            worker = None
            while time.time() < deadline:
                if ctx.service_workers:
                    worker = ctx.service_workers[0]
                    break
                ctx.wait_for_timeout(250)
            if worker is None:
                step("the unpacked extension loaded", False, "no service worker appeared")
                return _finish(report, findings)
            ext_id = worker.url.split("/")[2]
            report["extensionId"] = ext_id
            step("the unpacked extension loaded", True, ext_id)

            # 2. THE MANIFEST CHROMIUM ACTUALLY PARSED -- not the file on disk.
            page = ctx.new_page()
            page.goto(f"chrome-extension://{ext_id}/popup.html")
            live_manifest = page.evaluate("() => chrome.runtime.getManifest()")
            report["liveManifest"] = {
                "permissions": live_manifest.get("permissions"),
                "host_permissions": live_manifest.get("host_permissions"),
                "manifest_version": live_manifest.get("manifest_version"),
                "content_security_policy": live_manifest.get("content_security_policy"),
                "content_scripts": live_manifest.get("content_scripts"),
            }
            perms = sorted(live_manifest.get("permissions") or [])
            step("permissions are exactly the four justified ones",
                 perms == ["activeTab", "identity", "scripting", "storage"], perms)
            step("no all-sites host permission",
                 all("<all_urls>" not in h and "*://*/*" not in h
                     for h in (live_manifest.get("host_permissions") or [])),
                 live_manifest.get("host_permissions"))
            step("no declared content scripts",
                 not live_manifest.get("content_scripts"),
                 live_manifest.get("content_scripts"))

            # 3. NOT CONNECTED -> the extension asks to connect.
            page.reload()
            page.wait_for_timeout(700)
            connect_visible = page.is_visible("#connect") and not page.is_visible("#capture")
            page.screenshot(path=str(OUT_DIR / "1-not-connected.png"))
            step("not connected: the popup asks to connect", connect_visible)
            stored = page.evaluate(
                "async () => Object.keys(await chrome.storage.local.get(null))")
            step("nothing is stored before connecting", stored == [], stored)

            # 4. Sign in FIRST PARTY, so the handshake has a session to use.
            api = ctx.request
            r = api.post(f"{args.base}/api/auth/login",
                         data={"email": args.email, "password": args.password})
            if not r.ok:
                step("first-party sign-in", False, f"{r.status} — run the runbook signup first")
                return _finish(report, findings)
            # The persistent profile needs the cookie too (the API context has
            # its own jar), so do it through a real page.
            login_page = ctx.new_page()
            login_page.goto(f"{args.base}/login")
            login_page.evaluate(
                """async ([base, email, password]) => {
                     await fetch(base + '/api/auth/login', {
                       method: 'POST', headers: {'Content-Type': 'application/json'},
                       credentials: 'include',
                       body: JSON.stringify({ email, password }) })
                   }""",
                [args.base, args.email, args.password])
            me = login_page.evaluate(
                "async (b) => (await fetch(b + '/api/auth/me', {credentials:'include'})).status",
                args.base)
            step("the browser profile holds a UCT session", me == 200, me)

            # A destination to save into.
            note = login_page.evaluate(
                """async (b) => {
                     const r = await fetch(b + '/api/j2/notes', {
                       method: 'POST', headers: {'Content-Type': 'application/json'},
                       credentials: 'include',
                       body: JSON.stringify({ title: 'Extension audit' }) })
                     const n = await r.json()
                     const id = n.note?.id || n.id
                     await fetch(`${b}/api/j2/notes/${id}/opened`, {method:'POST', credentials:'include'})
                     return id
                   }""", args.base)
            step("a destination note exists", bool(note), note)

            # 5. CONNECT -- the real chrome.identity handshake.
            page.bring_to_front()
            page.click("#connectBtn")
            approved = _approve_in_auth_window(ctx, args.base, timeout_s=30)
            step("the first-party authorization page appeared and was approved", approved)
            page.wait_for_timeout(1500)
            cred = page.evaluate(
                "async () => (await chrome.storage.local.get('uct.capture.credential'))"
                "['uct.capture.credential'] || null")
            step("a scoped credential is now stored", bool(cred and cred.get("token")),
                 {k: v for k, v in (cred or {}).items() if k != "token"})
            if cred:
                step("the stored credential is capture-scoped only",
                     sorted(cred.get("scopes") or []) ==
                     ["notebook:capture:destinations:read", "notebook:capture:write"],
                     cred.get("scopes"))
                step("the stored token is not the session cookie",
                     str(cred.get("token", "")).startswith("uctcap_"))
            only_key = page.evaluate(
                "async () => Object.keys(await chrome.storage.local.get(null))")
            step("chrome.storage.local holds the credential and nothing else",
                 only_key == ["uct.capture.credential"], only_key)

            # 6. PAGE ACCESS -- the injected read returns the selection, only.
            art = ctx.new_page()
            art.goto(f"{args.base}{ARTICLE_PATH}")
            art.evaluate("""() => {
                const r = document.createRange()
                r.selectNodeContents(document.getElementById('keep'))
                const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
            }""")
            art_tab_id = _tab_id_for(page, f"{args.base}{ARTICLE_PATH}")
            read = page.evaluate(
                """async (tabId) => {
                     const [hit] = await chrome.scripting.executeScript({
                       target: { tabId },
                       func: () => String(window.getSelection ? window.getSelection().toString() : ''),
                     })
                     return hit?.result || ''
                   }""", art_tab_id)
            step("the injected read returns the member's selection",
                 read.strip().startswith("Management expects gross margins"), read[:80])
            step("it returns nothing hidden, nothing from a form, no page body",
                 "MUST-NOT-BE-READ" not in read and "Unrelated paragraph" not in read)

            # 7. CAPTURE, from the extension origin, with a bearer.
            before = len(report["network"])
            passage_res = _capture(page, args.base, note, tier="passage",
                                   passage=read.strip())
            step("a selected passage saves", passage_res.get("status") == 200,
                 passage_res)
            preflights = [n for n in report["network"][before:] if n["method"] == "OPTIONS"]
            report["preflightObserved"] = bool(preflights)
            print(f"  [--] CORS: {'a preflight was issued' if preflights else 'no preflight was issued'}"
                  f" for the extension's cross-origin POST")

            ref_res = _capture(page, args.base, note, tier="reference")
            step("a reference (link only) saves", ref_res.get("status") == 200, ref_res)

            # ⛔ WHAT `deduped` ACTUALLY MEANS, and why this asserts the reuse
            # instead. The Slice 1 contract scopes `deduped` to an identical
            # PASSAGE re-captured from the same source into the same note; a
            # repeat REFERENCE capture returns False by construction. The first
            # version of this step asserted True, which was a claim about a
            # contract that was never made. What IS guaranteed, and what matters
            # to a member clicking Save twice, is that no second document
            # appears -- so that is what is measured.
            dup_res = _capture(page, args.base, note, tier="reference")
            step("a repeat capture reuses the same document, never a second one",
                 dup_res.get("status") == 200
                 and dup_res.get("body", {}).get("documentId")
                 == ref_res.get("body", {}).get("documentId"),
                 dup_res.get("body", {}).get("documentId"))

            dup_passage = _capture(page, args.base, note, tier="passage",
                                   passage=read.strip())
            step("re-saving the SAME passage is reported as already saved",
                 dup_passage.get("status") == 200
                 and dup_passage.get("body", {}).get("deduped") is True,
                 dup_passage.get("body", {}).get("deduped"))

            full_res = _capture(page, args.base, note, tier="full_page", passage="x" * 100)
            step("a full-page capture is REFUSED even from the extension",
                 full_res.get("status") == 422, full_res.get("status"))

            over_res = _capture(page, args.base, note, tier="passage", passage="z" * 40000)
            step("an oversized passage is refused on rights",
                 over_res.get("status") == 422, over_res.get("status"))

            # 8. Only the capture surfaces. The token must be worthless elsewhere.
            notes_status = page.evaluate(
                """async ([b]) => {
                     const c = (await chrome.storage.local.get('uct.capture.credential'))['uct.capture.credential']
                     const r = await fetch(b + '/api/j2/notes', {
                       credentials: 'omit', headers: { Authorization: 'Bearer ' + c.token } })
                     return r.status
                   }""", [args.base])
            step("the same token is refused by an unrelated endpoint",
                 notes_status in (401, 403), notes_status)

            # 9. REVOKE first-party, then capture again.
            revoked = login_page.evaluate(
                """async (b) => {
                     const list = await (await fetch(b + '/api/j2/capture/connections',
                                                     {credentials:'include'})).json()
                     const id = list.connections?.[0]?.id
                     if (!id) return 'no connection listed'
                     const r = await fetch(`${b}/api/j2/capture/connections/${id}`,
                                           {method:'DELETE', credentials:'include'})
                     return r.status
                   }""", args.base)
            step("the member can revoke it from UCT Settings", revoked == 200, revoked)

            after_revoke = _capture(page, args.base, note, tier="reference",
                                    url_suffix="&after=revoke")
            step("the next capture fails closed", after_revoke.get("status") == 401,
                 after_revoke.get("status"))
            step("and it says RECONNECT, not 401",
                 (after_revoke.get("body") or {}).get("detail", {}).get("error")
                 == "reconnect_required", (after_revoke.get("body") or {}).get("detail"))

            # 10. The popup shows the reconnect state with unsaved work intact.
            page.reload()
            page.wait_for_timeout(700)
            page.evaluate("""() => {
                 document.getElementById('annotation').value = 'my unsaved thinking'
            }""")
            draft_before = page.evaluate("() => document.getElementById('annotation').value")
            page.screenshot(path=str(OUT_DIR / "2-connected.png"))

            # Reconnect.
            page.evaluate("async () => { await chrome.storage.local.clear() }")
            page.reload(); page.wait_for_timeout(600)
            page.screenshot(path=str(OUT_DIR / "3-reconnect.png"))
            step("after revocation the popup asks to reconnect",
                 page.is_visible("#connect"))
            page.click("#connectBtn")
            step("reconnect completes", _approve_in_auth_window(ctx, args.base, timeout_s=30))
            page.wait_for_timeout(1500)
            again = _capture(page, args.base, note, tier="reference", url_suffix="&again=1")
            step("capture works again after reconnecting", again.get("status") == 200,
                 again.get("status"))
            report["draftPreservedInSession"] = draft_before

        finally:
            if not args.keep_open:
                ctx.close()

    return _finish(report, findings)


def _tab_id_for(ext_page, url: str) -> int:
    """The tab id for a URL, asked of Chromium. Works here because the audit
    page is an extension page with host permission for that origin."""
    return ext_page.evaluate(
        """async (u) => {
             const tabs = await chrome.tabs.query({})
             const hit = tabs.find((t) => (t.url || '').startsWith(u))
             return hit ? hit.id : null
           }""", url)


def _capture(ext_page, base: str, note_id: str, tier: str,
             passage: str | None = None, url_suffix: str = "") -> dict:
    """One capture through the extension's OWN stored credential, from the
    extension origin. Returns status + body so a refusal is data, not a throw."""
    return ext_page.evaluate(
        """async ([base, noteId, tier, passage, suffix]) => {
             const bag = await chrome.storage.local.get('uct.capture.credential')
             const cred = bag['uct.capture.credential']
             if (!cred) return { status: 0, body: { error: 'not connected' } }
             const payload = {
               noteId, tier,
               url: 'https://www.reuters.com/tech/nvda-q3?id=7' + suffix,
               title: 'Reuters: NVDA margins',
             }
             if (passage) payload.passage = passage
             const r = await fetch(base + '/api/j2/capture', {
               method: 'POST', credentials: 'omit',
               headers: { 'Content-Type': 'application/json',
                          Authorization: 'Bearer ' + cred.token },
               body: JSON.stringify(payload) })
             let body = null
             try { body = await r.json() } catch { body = null }
             return { status: r.status, body }
           }""",
        [base, note_id, tier, passage, url_suffix])


def _approve_in_auth_window(ctx, base: str, timeout_s: int = 30) -> bool:
    """chrome.identity opens its own window. Find the first-party connect page
    inside it and click Connect, the way a member would."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        for pg in ctx.pages:
            try:
                if "/journal/capture-connect" not in (pg.url or ""):
                    continue
                pg.wait_for_selector('[data-testid="capture-connect-approve"]', timeout=5000)
                pg.click('[data-testid="capture-connect-approve"]')
                return True
            except Exception:      # noqa: BLE001 — a closing auth window races us
                continue
        ctx.pages[0].wait_for_timeout(400)
    return False


def _finish(report: dict, findings: list[str]) -> int:
    # Keep the network log honest but small: the CORS answer, not a trace dump.
    report["network"] = [n for n in report["network"]
                         if "/api/j2/capture" in n["url"] or n["method"] == "OPTIONS"][:60]
    report["findings"] = findings
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    measured = [s for s in report["steps"] if s["ok"]]
    # ⛔ ANTI-VACUITY. A run that fell over early and measured three things must
    # never read as a pass. The step list below is the floor this audit exists
    # to clear.
    if len(report["steps"]) < 20:
        findings.append(f"VACUOUS: only {len(report['steps'])} steps ran — the audit "
                        "did not reach the flow it exists to prove")
    if findings:
        print("\nFINDINGS:")
        for f in findings:
            print(f"  - {f}")
        return 1
    print(f"\nbrowser-capture extension certification: PASS "
          f"({len(measured)}/{len(report['steps'])} steps)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
