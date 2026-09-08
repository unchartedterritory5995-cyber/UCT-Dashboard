"""Wave L Slice 4 — phone-width certification for the mobile share door.

⛔ WHY NOT `tools/mobile_audit.py`. That harness logs in and sweeps routes. Two
of this door's three states are only reachable SIGNED OUT, which a harness that
authenticates first can never render — it would load `/journal/share`, follow the
authenticated path, measure the Notebook behind it and report a clean pass for a
screen it never saw. Same vacuous shape `capture_phone_audit.py` was split out
for in Slice 2.

⛔ AND WHY NOT A UNIT TEST. jsdom lays nothing out: every box is 0×0, so a tap
target that is 12px on a real phone measures identically to one that is 44px
(`lesson_a_green_suite_can_hide_a_layout_regression`). The component test beside
this proves the LOGIC; only a real engine at a real width proves the layout.

Run against the FAIL-CLOSED sandbox, never a live backend:

    python tools/local_backend_sandbox.py --port 8077        # terminal 1
    python tools/share_target_phone_audit.py --base http://localhost:8077

Exits non-zero on any finding. Writes tools/share_phone_out/report.json plus a
screenshot per state — a number without a picture has been wrong here before.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.parse

OUT_DIR = pathlib.Path(__file__).parent / "share_phone_out"

# 390 is the width this program's mobile lessons are written at.
PHONE = {"width": 390, "height": 844}

# A payload shaped like a real Android share from a news reader: the link lives
# inside `text`, and `url` is empty. That is the majority case, and the one a
# door reading only `url` gets wrong.
SHARE_IN_TEXT = {"title": "Fed holds rates steady", "text": "Powell signals patience https://wsj.com/x"}
SHARE_EXPLICIT = {"title": "Fed holds", "text": "Powell signals patience", "url": "https://wsj.com/x"}

# ⛔ The intro animation also carries role="dialog", so a bare `[role="dialog"]`
# wait is satisfied by the brand film and the probe measures the wrong element.
# Wait on something only the capture dialog renders.
CAPTURE_DIALOG_SEL = ('[data-testid="capture-destination-picker"], '
                      '[data-testid="capture-destination"]')

MEASURE_JS = """
() => {
// ⛔⛔ THE CHECK THAT WAS MISSING, and its absence let this harness report a
// clean phone pass over a screen the member could not see or touch. Every
// measurement below it reads the DOM, and the DOM is right even when something
// is painted on top of it: on 2026-09-08 the 9.3s intro animation covered all
// 390px of the signed-out card and the audit returned ZERO findings.
// `document.elementFromPoint` asks the compositor what a FINGER would land on,
// which is the only question that answers "can a member use this".
const occludedBy = (el) => {
  if (!el) return 'element missing';
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return 'zero-sized';
  const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  if (!hit) return 'nothing hit-testable at its centre';
  if (el.contains(hit) || hit.contains(el)) return null;   // the member reaches it
  const who = hit.closest('[role],[class]') || hit;
  return `${who.tagName.toLowerCase()}`
    + (who.getAttribute('role') ? `[role=${who.getAttribute('role')}]` : '')
    + (who.className && typeof who.className === 'string'
        ? `.${who.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : '');
};
  const doc = document.documentElement;
  const card = document.querySelector('h1')?.closest('div');
  const small = [];
  const scope = card || document.body;
  for (const el of scope.querySelectorAll('button, input, textarea, select, a[href]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;            // genuinely hidden
    if (r.width < 44 || r.height < 44) {
      small.push({
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }
  const signin = document.querySelector('[data-testid="share-signin"]');
  return {
    found: true,
    // What a finger actually lands on, for the card and for its one action.
    cardOccludedBy: occludedBy(card),
    signinOccludedBy: occludedBy(signin),
    heading: (document.querySelector('h1')?.textContent || '').trim(),
    // The #1 objective mobile bug, measured rather than eyeballed.
    overflowX: doc.scrollWidth - doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    smallTargets: small,
    signinHref: signin ? signin.getAttribute('href') : null,
    // ⛔ The address bar AFTER the page has carried the payload. The shared
    // text must not still be sitting here for the next person who picks up
    // the phone, or in a Back press.
    locationSearch: window.location.search,
    dialogOpen: !!document.querySelector('[role="dialog"]'),
    sourceUrl: document.querySelector('#\\\\:r0\\\\:, input[type=url]')?.value || null,
  };
}
"""

DIALOG_JS = """
() => {
// ⛔⛔ THE CHECK THAT WAS MISSING, and its absence let this harness report a
// clean phone pass over a screen the member could not see or touch. Every
// measurement below it reads the DOM, and the DOM is right even when something
// is painted on top of it: on 2026-09-08 the 9.3s intro animation covered all
// 390px of the signed-out card and the audit returned ZERO findings.
// `document.elementFromPoint` asks the compositor what a FINGER would land on,
// which is the only question that answers "can a member use this".
const occludedBy = (el) => {
  if (!el) return 'element missing';
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return 'zero-sized';
  const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  if (!hit) return 'nothing hit-testable at its centre';
  if (el.contains(hit) || hit.contains(el)) return null;   // the member reaches it
  const who = hit.closest('[role],[class]') || hit;
  return `${who.tagName.toLowerCase()}`
    + (who.getAttribute('role') ? `[role=${who.getAttribute('role')}]` : '')
    + (who.className && typeof who.className === 'string'
        ? `.${who.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : '');
};
  // ⛔ SCOPED BY A FIELD THE CAPTURE DIALOG OWNS, never by `[role="dialog"]`
  // alone — the intro animation carries that role too, so the bare selector
  // returns whichever comes first in the document and the probe would measure
  // the brand film while reporting on capture.
  const dlg = [...document.querySelectorAll('[role="dialog"]')]
    .find((d) => d.querySelector('[data-testid="capture-destination-picker"], [data-testid="capture-destination"]'));
  if (!dlg) return { found: false };
  const byLabel = (t) => {
    for (const l of dlg.querySelectorAll('label')) {
      if (l.textContent.trim() === t) {
        const c = l.getAttribute('for');
        return c ? dlg.querySelector(`#${CSS.escape(c)}`) : null;
      }
    }
    return null;
  };
  const doc = document.documentElement;
  const small = [];
  for (const el of dlg.querySelectorAll('button, input, textarea, select, a[href]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.width < 44 || r.height < 44) {
      small.push({ tag: el.tagName.toLowerCase(),
                   name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
                   w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  return {
    found: true,
    dialogOccludedBy: occludedBy(dlg),
    locationSearch: window.location.search,
    overflowX: doc.scrollWidth - doc.clientWidth,
    url: byLabel('Source link')?.value ?? null,
    title: byLabel('Source title')?.value ?? null,
    passage: byLabel('Selected passage')?.value ?? null,
    thought: byLabel('Quick thought')?.value ?? null,
    smallTargets: small,
  };
}
"""


def share_url(base: str, payload: dict) -> str:
    return f"{base}/journal/share?{urllib.parse.urlencode(payload)}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    OUT_DIR.mkdir(exist_ok=True)
    findings: list[str] = []
    report: dict = {"base": args.base, "viewport": PHONE, "states": {}}

    def record(name: str, data: dict) -> None:
        report["states"][name] = data
        if data.get("overflowX", 0) > 0:
            findings.append(f"{name}: horizontal overflow {data['overflowX']}px "
                            f"({data.get('scrollWidth')} > {data.get('clientWidth')})")
        for key in ("cardOccludedBy", "signinOccludedBy", "dialogOccludedBy"):
            covered = data.get(key)
            if covered:
                what = key.replace("OccludedBy", "")
                findings.append(f"{name}: the {what} is covered by {covered} — "
                                "measured correctly in the DOM and unusable on the screen")
        # ⛔⛔ PRIVACY GATE (2026-09-08). GET puts the member's shared prose in
        # the request target; the least we owe them is that it does not LINGER
        # in the address bar, in history, or get duplicated into a second URL.
        left = data.get("locationSearch")
        if left:
            findings.append(f"{name}: the shared text is still in the address bar "
                            f"({left[:60]}…) — Back would resurrect it")
        href = data.get("signinHref")
        if href:
            for leak in ("wsj.com", "Powell", "signals", "patience"):
                if leak in href:
                    findings.append(f"{name}: the sign-in link carries the shared "
                                    f"payload ({leak!r} in ?next=)")
                    break
        for t in data.get("smallTargets", []):
            findings.append(f"{name}: tap target {t['w']}x{t['h']} — {t['tag']} \"{t['name']}\"")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ── SIGNED OUT. Only reachable without a session, which is the whole
        #    reason this harness does not log in first.
        ctx = browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True,
                                  device_scale_factor=3)
        page = ctx.new_page()
        page.goto(share_url(args.base, SHARE_IN_TEXT), wait_until="networkidle")
        page.wait_for_selector('[data-testid="share-signin"]', timeout=15000)
        out = page.evaluate(MEASURE_JS)
        record("signed_out", out)
        page.screenshot(path=str(OUT_DIR / "signed_out.png"), full_page=True)

        href = out.get("signinHref") or ""
        # ⚰️ THIS BLOCK USED TO REQUIRE THE DEFECT. Written before the privacy
        # gate, it asserted the shared payload WAS present in `?next=`, so it
        # would fail the moment that leak was fixed — the same shape as
        # `FolderSidebar.test.jsx` asserting the raw-error `alert()` it existed
        # to prevent. Keep the intent (the member comes back to the share door),
        # change the mechanism (they come back to the ROUTE; the payload travels
        # in-process and never through a URL).
        if "/login?next=" not in href:
            findings.append(f"signed_out: sign-in link does not carry ?next= ({href!r})")
        else:
            nxt = urllib.parse.unquote(href.split("next=", 1)[1])
            if nxt != "/journal/share":
                findings.append(f"signed_out: ?next= should be the bare share route, got {nxt!r}")
        ctx.close()

        # ── SIGNED IN. The share must reach the dialog with its fields filled.
        ctx = browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True,
                                  device_scale_factor=3)
        r = ctx.request.post(f"{args.base}/api/auth/login",
                             data={"email": args.email, "password": args.password})
        if not r.ok:
            print(f"login failed ({r.status}) — seed the sandbox account first", file=sys.stderr)
            return 2
        page = ctx.new_page()

        # The url-in-text case: the door must find the link and quote the rest.
        page.goto(share_url(args.base, SHARE_IN_TEXT), wait_until="networkidle")
        page.wait_for_selector(CAPTURE_DIALOG_SEL, timeout=15000)
        dlg = page.evaluate(DIALOG_JS)
        if not dlg.get("found"):
            findings.append("signed_in_url_in_text: no capture dialog found")
        record("signed_in_url_in_text", dlg)
        page.screenshot(path=str(OUT_DIR / "signed_in_url_in_text.png"), full_page=True)
        if dlg.get("url") != "https://wsj.com/x":
            findings.append(f"signed_in_url_in_text: source link is {dlg.get('url')!r}, "
                            "expected the link extracted from the shared text")
        if dlg.get("passage") != "Powell signals patience":
            findings.append(f"signed_in_url_in_text: passage is {dlg.get('passage')!r}")

        # The explicit-url case.
        page.goto(share_url(args.base, SHARE_EXPLICIT), wait_until="networkidle")
        page.wait_for_selector(CAPTURE_DIALOG_SEL, timeout=15000)
        dlg = page.evaluate(DIALOG_JS)
        record("signed_in_explicit_url", dlg)
        page.screenshot(path=str(OUT_DIR / "signed_in_explicit_url.png"), full_page=True)
        if dlg.get("url") != "https://wsj.com/x":
            findings.append(f"signed_in_explicit_url: source link is {dlg.get('url')!r}")

        # A share with no link at all must open the THOUGHT box — never a
        # quotation, because there is no source to cite.
        page.goto(share_url(args.base, {"text": "margins normalize by Q3"}),
                  wait_until="networkidle")
        page.wait_for_selector(CAPTURE_DIALOG_SEL, timeout=15000)
        dlg = page.evaluate(DIALOG_JS)
        record("signed_in_no_url", dlg)
        page.screenshot(path=str(OUT_DIR / "signed_in_no_url.png"), full_page=True)
        if dlg.get("thought") != "margins normalize by Q3":
            findings.append(f"signed_in_no_url: quick thought is {dlg.get('thought')!r}")
        if dlg.get("passage"):
            findings.append("signed_in_no_url: a url-less share was filed as a PASSAGE — "
                            "that asserts provenance nobody established")
        ctx.close()
        browser.close()

    report["findings"] = findings
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    for f in findings:
        print(f"FINDING {f}")
    print(f"\n{len(findings)} finding(s); report + screenshots in {OUT_DIR}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
