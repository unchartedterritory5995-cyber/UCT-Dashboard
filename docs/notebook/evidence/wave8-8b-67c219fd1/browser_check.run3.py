"""Wave 8 lane 8B -- the REAL-BROWSER check (owner rule P-1).

PRECONDITION: a census-pinned sandbox from THIS worktree's tip, booted by
`scripts/hub_sandbox_boot.py --data-dir 'C:\\data-8b' --port 8202 --test-email share8b@local.dev`
with J2_SHARE_LINKS_ENABLED=1 and NOTEBOOK_PUBLISH_ENABLED=1 in ITS environment only, and
app/dist rebuilt from the tip. Pointed at: http://localhost:8202 (and nothing else).

Writes every step's result + screenshots to the evidence dir given as argv[1] BEFORE any summary
is computed (R-RAW): steps.jsonl is appended step by step, then summary.json at the end.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8202"
DATA_DIR = Path(r"C:\data-8b")
EMAIL, PASSWORD = "share8b@local.dev", "Share8bLocal2026!"
EVID = Path(sys.argv[1])
EVID.mkdir(parents=True, exist_ok=True)
STEPS = EVID / "steps.jsonl"
PUBLIC_HEADER_KEYS = ("cache-control", "x-robots-tag", "referrer-policy")
NEUTRAL = "A market-data item is not shown on public pages."
SECRET_TITLE = "Private sibling note 8b"
ASK_Q = "What did the answer say 8b?"
ASK_A = "An Ask answer the public must not see."
FOLDER = "Weekly plans 8b " + time.strftime("%H%M%S")


def step(name: str, ok: bool, **data) -> bool:
    rec = {"step": name, "ok": bool(ok), "t": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **data}
    with STEPS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, default=str) + "\n")
    print(("PASS " if ok else "FAIL ") + name, flush=True)
    return ok


def shot(page, name: str) -> str:
    p = EVID / f"{name}.png"
    page.screenshot(path=str(p), full_page=True)
    return p.name


AXE_URL = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"


def axe(page, selector: str) -> dict:
    """axe-core in the REAL browser, scoped to `selector`. 8A's jsdom harness
    (a11y/axeHarness.js) is not in this worktree and axe-core is not installed, so the
    library is loaded from cdnjs into the page for this check only (never shipped)."""
    try:
        if not page.evaluate("() => typeof window.axe !== 'undefined'"):
            page.add_script_tag(url=AXE_URL)
        res = page.evaluate(
            """async (sel) => {
                const r = await window.axe.run(document.querySelector(sel) || document,
                  { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
                return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact,
                           nodes: v.nodes.map(n => n.target.join(' ')).slice(0, 5) })),
                         passes: r.passes.length }
            }""", selector)
        return {"ran": True, **res}
    except Exception as e:  # noqa: BLE001 -- recorded, never a silent pass
        return {"ran": False, "error": str(e)[:300]}


def skip_intro(page) -> None:
    """The app's cinematic intro plays on every full page load, public pages included; a
    screenshot taken under it shows the intro, not the page. Press its own Skip."""
    try:
        btn = page.get_by_role("button", name="Skip")
        if btn.count():
            btn.first.click(timeout=3000)
    except Exception:  # noqa: BLE001 -- no intro on this load
        pass
    page.wait_for_timeout(900)


def headers_of(resp) -> dict:
    h = resp.headers if resp else {}
    return {k: h.get(k) for k in PUBLIC_HEADER_KEYS}


def main() -> int:
    ident = json.loads(urllib.request.urlopen(f"{BASE}/__uct_sandbox_identity", timeout=10).read())
    step("sandbox identity answers", bool(ident.get("identity")), identity=ident)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        owner = browser.new_context(viewport={"width": 1280, "height": 900})
        owner.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
        req = owner.request
        r = req.post(f"{BASE}/api/auth/signup", data={"email": EMAIL, "password": PASSWORD, "display_name": "Share Eightb"})
        step("owner signup", r.status in (200, 400, 409), status=r.status, body=r.text()[:300])
        r = req.post(f"{BASE}/api/auth/login", data={"email": EMAIL, "password": PASSWORD})
        step("owner login", r.ok, status=r.status)
        me = req.get(f"{BASE}/api/auth/me").json()
        step("owner payload carries both gates ON", me.get("j2_share_links_enabled") is True
             and me.get("notebook_publish_enabled") is True,
             flags={k: me.get(k) for k in ("j2_share_links_enabled", "notebook_publish_enabled")},
             role=me.get("role"), plan=me.get("plan"))

        # ── the owner's notes ──
        def mk(payload):
            rr = req.post(f"{BASE}/api/j2/notes", data=payload)
            return rr.json()["note"]
        folder = req.post(f"{BASE}/api/j2/note-folders", data={"name": FOLDER}).json()["folder"]
        sibling = mk({"title": SECRET_TITLE, "bodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "sibling body"}]}]}})
        body = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "The public thesis, in the member's words."}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "See "},
                                              {"type": "noteLink", "attrs": {"noteId": sibling["id"]}}]},
            {"type": "askInsert", "attrs": {"insertedAt": "2026-09-25T10:00:00Z", "scope": "notebook", "question": ASK_Q},
             "content": [{"type": "paragraph", "content": [{"type": "text", "text": ASK_A}]}]},
            {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "chart", "mode": "snapshot",
                                              "capturedAt": "2026-09-01T12:00:00Z", "params": {"symbol": "AMD", "tf": "D"},
                                              "tradeRef": "trade-secret-8b", "searchText": "[chart: AMD D]"}},
            {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "fundamentals", "mode": "snapshot",
                                              "capturedAt": "2026-09-01T12:00:00Z",
                                              "params": {"symbol": "AAPL", "view": "quarterly"}}},
        ]}
        main_note = mk({"title": "Published thesis 8b", "subtitle": "public subtitle", "tags": ["secret-tag-8b"],
                        "ticker": "ZZ8B", "folderId": folder["id"], "bodyJson": body})
        member2 = mk({"title": "Folder sibling 8b", "folderId": folder["id"], "bodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Back to "},
                                              {"type": "noteLink", "attrs": {"noteId": main_note["id"]}}]}]}})
        step("owner notes created", bool(main_note.get("id") and member2.get("id")),
             note=main_note["id"], folder=folder["id"])

        # ── the owner's Share door, in the editor ──
        page = owner.new_page()
        page.goto(f"{BASE}/journal/notebook?note={main_note['id']}")
        page.wait_for_selector(".ProseMirror", timeout=60000)
        skip_intro(page)
        share_btn = page.get_by_role("button", name="Share", exact=True)
        share_btn.wait_for(timeout=30000)
        step("editor shows Share for a paid member with the gates on", share_btn.is_visible())
        share_btn.click()
        dialog = page.get_by_role("dialog", name="Share this note")
        dialog.get_by_role("button", name="Create link").wait_for(timeout=30000)
        shot(page, "01-owner-share-popover-closed")
        dialog.get_by_label("Link stops working").select_option("7")
        dialog.get_by_role("button", name="Create link").click()
        dialog.get_by_text("Share link created and copied.").wait_for(timeout=30000)
        share_url = dialog.get_by_label("Share link address").input_value()
        token = share_url.rstrip("/").split("/")[-1]
        dialog.get_by_role("button", name="Publish this note").click()
        dialog.get_by_text("Published. Page link copied.").wait_for(timeout=30000)
        pub_url = dialog.get_by_label("Published page address").input_value()
        dialog.get_by_role("button", name=f'Publish folder "{FOLDER}"').click()
        dialog.get_by_text(f'Published "{FOLDER}". Page link copied.').wait_for(timeout=30000)
        folder_url = dialog.get_by_label(f"Published folder address, {FOLDER}").input_value()
        shot(page, "02-owner-share-popover-all-created")
        step("owner minted a 7-day link, published the note and the folder",
             bool(token and "/p/" in pub_url and "/p/" in folder_url),
             share_url=share_url, pub_url=pub_url, folder_url=folder_url,
             popover_text=dialog.inner_text()[:2000])
        a = axe(page, "[role=dialog]")
        step("axe: the Share popover (every section open)", a.get("ran") and not a.get("violations"), axe=a)

        page.goto(f"{BASE}/settings?section=connections")  # the card lives in Connections (Settings.jsx)
        skip_intro(page)
        page.get_by_role("region", name="Sharing & publishing").wait_for(timeout=60000)
        card = page.get_by_role("region", name="Sharing & publishing")
        card.get_by_role("list", name="Your share links and published pages").wait_for(timeout=30000)
        card.scroll_into_view_if_needed()
        shot(page, "03-owner-settings-sharing-card")
        step("Settings lists the link and both pages", "Published thesis 8b" in card.inner_text()
             and FOLDER in card.inner_text(), card_text=card.inner_text()[:2000])
        page.evaluate("() => { const r = [...document.querySelectorAll('[role=region]')].find(x => x.getAttribute('aria-label') === 'Sharing & publishing'); if (r) r.setAttribute('data-axe-target', '1') }")
        a = axe(page, "[data-axe-target='1']")
        step("axe: Settings -> Sharing & publishing", a.get("ran") and not a.get("violations"), axe=a)

        # ── a STRANGER (signed out, fresh context) ──
        stranger = browser.new_context(viewport={"width": 1280, "height": 900})
        sp = stranger.new_page()
        responses = []
        sp.on("response", lambda resp: responses.append(resp))

        def open_public(url, testid, name):
            responses.clear()
            resp = sp.goto(url)
            sp.wait_for_selector(f"[data-testid='{testid}']", timeout=60000)
            skip_intro(sp)
            api = [x for x in responses if "/api/j2/shared/" in x.url or "/api/j2/published/" in x.url]
            text = sp.inner_text("body")
            metas = sp.evaluate("""() => ({robots: document.querySelector('meta[name=robots]')?.content,
                                         referrer: document.querySelector('meta[name=referrer]')?.content})""")
            return {"html_headers": headers_of(resp), "html_status": resp.status if resp else None,
                    "api": [{"url": x.url, "status": x.status, "headers": headers_of(x)} for x in api],
                    "requests": sorted({x.url.replace(BASE, "") for x in responses if "/api/" in x.url}),
                    "text": text, "meta": metas, "shot": shot(sp, name)}

        def leaks(text, share=False):
            # A SHARE link keeps an Ask answer by design (G-064; NODE_POLICY askInsert share=keep);
            # a PUBLISHED page never carries one. Everything else is forbidden on both.
            banned = (SECRET_TITLE, ASK_Q, main_note["id"], sibling["id"], "secret-tag-8b",
                      "ZZ8B", "trade-secret-8b", EMAIL, "Share Eightb") + (() if share else (ASK_A,))
            return [s for s in banned if s in text]

        o = open_public(share_url, "shared-note", "10-stranger-share-link")
        step("stranger reads the share link", "The public thesis" in o["text"] and not leaks(o["text"], share=True)
             and NEUTRAL in o["text"] and "linked note" in o["text"] and ASK_A in o["text"],
             leaks=leaks(o["text"], share=True), **{k: v for k, v in o.items() if k != "text"}, text=o["text"][:3000])
        a = axe(sp, "body")
        step("axe: the shared note page", a.get("ran") and not a.get("violations"), axe=a)
        o = open_public(pub_url, "published-page", "11-stranger-published-note")
        step("stranger reads the published note", "The public thesis" in o["text"] and not leaks(o["text"])
             and NEUTRAL in o["text"], leaks=leaks(o["text"]), **{k: v for k, v in o.items() if k != "text"},
             text=o["text"][:3000])
        a = axe(sp, "body")
        step("axe: the published note page", a.get("ran") and not a.get("violations"), axe=a)
        o = open_public(folder_url, "published-page", "12-stranger-published-folder-index")
        step("stranger reads the folder index", FOLDER in o["text"] and "Published thesis 8b" in o["text"]
             and "Folder sibling 8b" in o["text"] and not leaks(o["text"]),
             leaks=leaks(o["text"]), **{k: v for k, v in o.items() if k != "text"}, text=o["text"][:3000])
        a = axe(sp, "body")
        step("axe: the published folder index", a.get("ran") and not a.get("violations"), axe=a)
        sp.get_by_role("link", name="Folder sibling 8b").click()
        sp.wait_for_selector("[data-testid='published-page'] .ProseMirror", timeout=60000)
        sp.wait_for_timeout(500)
        t = sp.inner_text("body")
        link = sp.get_by_role("link", name="Published thesis 8b")
        step("a folder note links to its sibling's PUBLIC page and back to the folder",
             link.count() > 0 and "/p/" in (link.first.get_attribute("href") or "") and not leaks(t),
             href=link.first.get_attribute("href") if link.count() else None, shot=shot(sp, "13-stranger-folder-member"),
             text=t[:2000])

        # images + API headers straight from the public API
        api_share = stranger.request.get(f"{BASE}/api/j2/shared/{token}")
        step("public API JSON carries the three headers", all(api_share.headers.get(k) for k in PUBLIC_HEADER_KEYS),
             status=api_share.status, headers={k: api_share.headers.get(k) for k in PUBLIC_HEADER_KEYS},
             keys=sorted(api_share.json().get("note", {}).keys()))

        # ── revoke, then the stranger reloads ──
        rr = req.delete(f"{BASE}/api/j2/notes/{main_note['id']}/share")
        o = open_public(share_url, "shared-note-gone", "20-stranger-after-revoke")
        step("after revoke the share link is gone", rr.json() == {"revoked": True}
             and "no longer available" in o["text"], meta=o["meta"], api=o["api"])

        # ── an expired link reads as unavailable (short expiry via the SANDBOX db) ──
        rr = req.post(f"{BASE}/api/j2/notes/{main_note['id']}/share", data={"expiresInDays": 7})
        token2 = rr.json()["share"]["token"]
        live2 = stranger.request.get(f"{BASE}/api/j2/shared/{token2}").status
        con = sqlite3.connect(str(DATA_DIR / "auth.db"))
        con.execute("UPDATE j2_note_shares SET expires_at = '2000-01-01T00:00:00.000000+00:00' WHERE token = ?", (token2,))
        con.commit()
        con.close()
        o = open_public(f"{BASE}/share/n/{token2}", "shared-note-gone", "21-stranger-expired-link")
        step("an expired link reads as unavailable", live2 == 200 and "no longer available" in o["text"],
             live_before=live2, api=o["api"])

        # ── unpublish: the page is gone ──
        slug = pub_url.rstrip("/").split("/")[-1]
        req.delete(f"{BASE}/api/j2/publish/{slug}")
        o = open_public(pub_url, "published-page-gone", "22-stranger-after-unpublish")
        step("after unpublish the published page is gone", "no longer available" in o["text"], api=o["api"])

        # ── a burst past the rate limit gets 429 ──
        codes = []
        for i in range(62):
            x = stranger.request.get(f"{BASE}/api/j2/shared/burst-token-{i:03d}",
                                     headers={"CF-Connecting-IP": "203.0.113.99"})
            codes.append(x.status)
            if x.status == 429:
                over = x
                break
        step("a burst past 60/min gets 429 with a sentence and the public headers",
             codes[-1] == 429 and codes.count(404) == 60,
             codes_tail=codes[-3:], count=len(codes),
             other_ip_status=stranger.request.get(f"{BASE}/api/j2/shared/burst-token-x",
                                                  headers={"CF-Connecting-IP": "198.51.100.42"}).status,
             detail=over.json().get("detail") if codes[-1] == 429 else None,
             headers={k: over.headers.get(k) for k in PUBLIC_HEADER_KEYS} if codes[-1] == 429 else None)

        # ── phone width: the popover is a bottom sheet with 44px controls ──
        phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        phone.request.post(f"{BASE}/api/auth/login", data={"email": EMAIL, "password": PASSWORD})
        pp = phone.new_page()
        pp.goto(f"{BASE}/journal/notebook?note={member2['id']}")
        pp.wait_for_selector(".ProseMirror", timeout=60000)
        skip_intro(pp)
        b = pp.get_by_role("button", name="Share", exact=True)
        b.wait_for(timeout=30000)
        b.click()
        d = pp.get_by_role("dialog", name="Share this note")
        d.get_by_role("button", name="Create link").wait_for(timeout=30000)
        heights = pp.evaluate("""() => [...document.querySelectorAll('[role=dialog] button, [role=dialog] select')]
            .map(el => ({text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40),
                         h: Math.round(el.getBoundingClientRect().height)}))""")
        step("on a phone every popover control is at least 44px tall",
             all(h["h"] >= 44 for h in heights if h["h"] > 0), heights=heights, shot=shot(pp, "30-phone-share-sheet"))
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
