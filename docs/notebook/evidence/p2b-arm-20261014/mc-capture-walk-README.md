# Market-context "Capture now", flag-on browser walk (P2b lane B concern 2)

Production, flag on, synthetic smoke account, headless Playwright in its own context
(never the owner's Chrome, no OS keys). Script: `mc_capture_walk.py` (this directory).
Each run made one note and soft-deleted it through the product's DELETE (`still_listed: false`).

| run | verdict | why |
|---|---|---|
| `mc-capture-walk-r1/` | FAIL, instrument | the cinematic intro was still up at 390 (`mc-390.png` shows "Welcome, Smoke."); the hit test landed on an intro pill. The wire filter watched PUT/PATCH on one URL shape. |
| `mc-capture-walk-r2/` | FAIL, instrument | intro dismissed with `mobile_audit._dismiss_intro` (it raises if the overlay stays); 390 checks PASS. The wire check waited with `time.sleep`, which does not pump Playwright's sync event loop, so the PUT reached the list only later. The raw `wire` list shows GET market-context 200 -> PUT note 200 -> POST images 200 -> PUT note 200. |
| `mc-capture-walk/` | **PASS, 12/12** | waits use `page.wait_for_timeout`. Tap target 44 px at 390 and uncovered; focus lands on the button inside the node view; the note PUT lands 200; the server copy is captured (no `uncaptured`/`reason`, `capturedAt` set); after reload no Capture now and no budget sentence; no page errors. |

Cosmetic observations (screenshots `mc-1280-before.png`, `mc-1280-reloaded.png`), filed, not blocking:
- F-EMBED-HEADER-OVERLAP: the embed header's "‹" and "··· More" controls sit over the "MARKET CONTEXT" label.
- F-CAPTURE-AFFORDANCE: "Capture now" renders as bold text with no visible button outline at 1280.
