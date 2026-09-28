"""Lane 10E-2 -- the UCT half of the design review (clause 6a, R-14): each Notebook surface at
390 / 820 / 1200, hands-on in the census-pinned sandbox, READ ONLY (it signs in as the walk
account and changes nothing). Viewport screenshots, plus per shot the measured facts a picture
cannot be trusted for: page-level horizontal overflow, targets under 24 px (and 44 px on the
touch widths), and the visible headings.

    python uct_captures.py <scratch-dir-of-e2_sandbox> <out-dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parents[2] / "evidence" / "a11y-second-review-2026-09-27"))
import e2_common as C  # noqa: E402
import kbd_lib as K  # noqa: E402
import keyboard_walk as W  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

WIDTHS = [(390, 844, True), (820, 1180, True), (1200, 800, False)]
HEADS_JS = "() => Array.from(document.querySelectorAll('h1,h2')).filter(h => h.getBoundingClientRect().width > 0).map(h => h.textContent.trim().slice(0, 50)).slice(0, 6)"


def main() -> int:
    scratch, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    ready = C.ready_record(scratch)
    base = ready["base"]
    C.require_identity(base, ready["integrity_log"])
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        probe = b.new_context()
        C.signup_or_login(probe.request, base, W.WALK_EMAIL, C.PW, "kbd walker")
        notes = probe.request.get(base + "/api/j2/notes?limit=50").json().get("notes") or []
        alpha = next((n["id"] for n in notes if n.get("title") == "Alpha thesis NVDA"), None)
        pubs = probe.request.get(base + "/api/j2/publish").json()
        slug = next((x.get("slug") for x in (pubs.get("publications") or []) if x.get("slug")), None)
        probe.close()
        for vw, vh, touch in WIDTHS:
            ctx = b.new_context(viewport={"width": vw, "height": vh}, has_touch=touch, is_mobile=touch and vw < 700)
            C.signup_or_login(ctx.request, base, W.WALK_EMAIL, C.PW, "kbd walker")
            pg = ctx.new_page()
            shots = [("list", "/journal/notebook?view=all", None),
                     ("board", "/journal/notebook?view=all", "board view"),
                     ("graph", "/journal/notebook?view=all", "graph view"),
                     ("editor", f"/journal/notebook?note={alpha}", None)]
            if slug:
                shots.append(("published", f"/p/{slug}", None))
            for name, suffix, mode in shots:
                W.open_notebook(pg, base, suffix, wait_ms=3500)
                if mode:
                    W.focus_top(pg)
                    ok, n, _, _ = K.tab_until(pg, K.name_has(mode), max_presses=140)
                    if ok:
                        K.press(pg, "Enter", 2500)
                    W.focus_top(pg)
                fname = f"uct-{name}-{vw}.png"
                pg.screenshot(path=str(out / fname))
                ov = K.overflow(pg)
                row = {"surface": name, "width": vw, "touch": touch, "shot": fname,
                       "overflow_px": ov["docScrollW"] - ov["docClientW"],
                       "targets_lt_24": len(K.small_targets(pg, 24)),
                       "targets_lt_44": len(K.small_targets(pg, 44)) if touch else None,
                       "headings": pg.evaluate(HEADS_JS)}
                rows.append(row)
                print(json.dumps(row), flush=True)
            ctx.close()
        b.close()
    (out / "uct-captures.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
