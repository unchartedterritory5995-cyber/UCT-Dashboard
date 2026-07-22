"""Live browser E2E for the single-stock ETF switcher (spec §8 Playwright pass).

Drives the REAL built bundle (app/dist served by the backend) against a REAL
local backend — no route stubs, real /api/single-stock-etfs + /api/bars data.

    python tools/ssetf_e2e_check.py [--base http://localhost:8077] [--headed]

Env: SSETF_E2E_EMAIL / SSETF_E2E_PASSWORD (default mobtest@local.dev recipe).
Screenshots land in .superpowers/sdd/t10-*.png (override --outdir).

Phases:
  A  wide chart — type NBIS -> pill renders (STOCK/2X up/2X down/caret) ->
     click 2X up -> chart swaps to best_long with painted bars -> caret panel
     rows liquidity-desc with a star on each side's best -> click a NON-best
     row -> LONG seat lights -> STOCK returns to NBIS.
  B  prefs-driven narrow bottom-row widget — segments fold away below the
     ~480px container query, caret survives, tfBar height unchanged, panel
     opens UPWARD fully on-screen.
  C  sunrise ("TSDR — Sunset") theme via the Open-layout UI toggle — the
     pill's directional tint tokens swap to the light-theme palette.
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SSETF_E2E_BASE", "http://localhost:8077")
EMAIL = os.environ.get("SSETF_E2E_EMAIL", "mobtest@local.dev")
PASSWORD = os.environ.get("SSETF_E2E_PASSWORD", "LocalTest2026!")

LAYOUT_WIDE = {"widgets": [
    {"id": "t10-chart", "type": "chart", "color": "A", "x": 0, "y": 0, "w": 24, "h": 20,
     "opts": {"tf": "D"}}], "cols": 24}
# Narrow (6/24 cols ~ 300px < 480px container query) + bottom row (y14 h6 of
# 20 rows) so the panel has too little room below the caret and must flip up.
LAYOUT_NARROW_BOTTOM = {"widgets": [
    {"id": "t10-fill", "type": "watchlist", "color": "B", "x": 0, "y": 0, "w": 24, "h": 14, "opts": {}},
    {"id": "t10-nchart", "type": "chart", "color": "A", "x": 18, "y": 14, "w": 6, "h": 6,
     "opts": {"tf": "D"}}], "cols": 24}

RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))
    return bool(cond)


def dismiss_intro(page):
    """The cinematic intro plays on every page LOAD — skip it. Also dismiss
    the voice orb's first-run "Meet Compass" bubble: it is pointer-active
    (~224x119 above the orb) and eats clicks on the bottom-right quadrant
    until "Got it" is pressed."""
    for _ in range(3):
        try:
            skip = page.query_selector('[aria-label="Skip intro"]')
            if skip:
                skip.click()
            else:
                page.keyboard.press("Escape")
            page.wait_for_timeout(400)
            if not page.query_selector('[aria-label="Skip intro"]'):
                break
        except Exception:
            pass
    try:
        got_it = page.locator('button:has-text("Got it")')
        if got_it.count():
            got_it.first.click(timeout=2000)
            page.wait_for_timeout(200)
    except Exception:
        pass


def set_pref(ctx, key, value):
    r = ctx.request.post(f"{BASE}/api/auth/preferences",
                         data={"key": key, "value": value})
    assert r.ok, f"set_pref {key}: HTTP {r.status}"


def painted_pixels(page):
    return page.evaluate("""() => {
      let best = 0;
      for (const c of document.querySelectorAll('canvas')) {
        if (c.width < 200) continue;
        try {
          const ctx = c.getContext('2d');
          if (!ctx) continue;
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 97 * 4) {
            if (d[i + 3] > 0 && (d[i] > 25 || d[i + 1] > 25 || d[i + 2] > 25)) n++;
          }
          best = Math.max(best, n);
        } catch (e) {}
      }
      return best;
    }""")


def badge_text(page):
    return page.evaluate(
        """() => { const el = document.querySelector('[class*="labelText"]');
                   return el ? el.textContent : ''; }""")


def wait_badge(page, syms, timeout=20000):
    """Wait for the SymbolSearch badge to show any candidate. The badge shows
    the raw ticker first, then flips to the resolved company/fund NAME once
    ticker-meta lands (instantly when cached) — so callers pass both."""
    if isinstance(syms, str):
        syms = [syms]
    page.wait_for_function(
        """cands => { const el = document.querySelector('[class*="labelText"]');
                      if (!el) return false;
                      const t = el.textContent.toUpperCase();
                      return cands.some(c => t.includes(c.toUpperCase())); }""",
        arg=syms, timeout=timeout)


def pill(page):
    return page.locator('[class*="LeverageInverse"], [class*="pill_"]').first


def seg_buttons(page):
    return page.locator('[class*="segBtn"]')


def caret(page):
    return page.locator('[class*="caretBtn"]').first


def open_panel(page):
    try:
        caret(page).click(timeout=5000)
    except Exception:
        # Fallback for the voice orb's "Meet Compass" first-run bubble (a
        # pointer-active overlay above the orb) if it re-appears mid-run —
        # phase B verifies PANEL GEOMETRY; the bubble is not this feature's.
        caret(page).dispatch_event("click")
    page.wait_for_selector('[role="menu"][aria-label*="single-stock ETFs"]', timeout=5000)
    return page.locator('[role="menu"][aria-label*="single-stock ETFs"]')


def panel_tickers(page):
    return page.locator('[role="menu"] [class*="rowTicker"]').all_inner_texts()


def type_symbol(page, body_locator, sym, alts=()):
    """Click-to-focus a chart widget, then type-to-search (the real user flow).
    NOTE: seeding charts_workspace_groups via the prefs API does NOT reach a
    cold ChartsWorkspace mount (useState initializer only) — the chart falls
    back to SPY — so every phase drives the symbol through the UI. The click
    lands upper-left-of-center: the voice orb's fixed _orbCluster_ overlay
    intercepts pointer events near the bottom-right corner of the viewport."""
    box = body_locator.bounding_box()
    # Click the widget's BOTTOM-LEFT: (a) in a very narrow widget the tfBar
    # wraps to ~130px (pre-existing TF-button wrap — clicks near the top hit
    # toolbar buttons, not the chart), and (b) the voice orb's first-run
    # "Meet Compass" bubble (~224x119 pointer-active overlay above the orb)
    # covers the bottom-RIGHT quadrant until dismissed (see dismiss_intro).
    body_locator.click(position={"x": 60, "y": box["height"] - 50})
    page.wait_for_timeout(200)
    page.keyboard.type(sym, delay=90)
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    wait_badge(page, [sym, *alts])


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--outdir", default=os.path.join(".superpowers", "sdd"))
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    BASE = args.base
    os.makedirs(args.outdir, exist_ok=True)
    shot = lambda name: page.screenshot(path=os.path.join(args.outdir, name))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        r = ctx.request.post(f"{BASE}/api/auth/login",
                             data={"email": EMAIL, "password": PASSWORD})
        assert r.ok, f"login failed: HTTP {r.status}"

        fam = ctx.request.get(f"{BASE}/api/single-stock-etfs/NBIS").json()
        assert fam.get("best_long"), "NBIS family empty — run the rebuild first"
        best_long, best_short = fam["best_long"], fam["best_short"]
        long_order = [x["ticker"] for x in fam["long"]]
        short_order = [x["ticker"] for x in fam["short"]]
        non_best_long = next(t for t in long_order if t != best_long)
        name_of = {x["ticker"]: x["name"] for x in fam["long"] + fam["short"]}
        tsla = ctx.request.get(f"{BASE}/api/single-stock-etfs/TSLA").json()

        # ── Phase A: wide chart, full interaction pass ──────────────────────
        set_pref(ctx, "charts_workspace_layout", json.dumps(LAYOUT_WIDE))
        set_pref(ctx, "charts_workspace_groups", json.dumps({"A": "AAPL"}))
        set_pref(ctx, "charts_theme", "default")
        # The shared local test account may carry a Multi-Chart grid session
        # (grid cells bypass WidgetHost -> no widgetBody) — force workspace mode.
        set_pref(ctx, "multichart_state", json.dumps({"mode": "workspace"}))
        page = ctx.new_page()
        page.goto(f"{BASE}/charts")
        dismiss_intro(page)
        page.wait_for_selector('[class*="tfBar_"]', timeout=20000)

        # Type NBIS into the chart widget (click-to-focus + type-to-search)
        type_symbol(page, page.locator('[class*="widgetBody"]').first, "NBIS", ["Nebius"])

        page.wait_for_selector('button:has-text("STOCK")', timeout=20000)
        segs = seg_buttons(page)
        check("A1 pill renders STOCK/up/down segments + caret",
              segs.count() == 3 and caret(page).is_visible(),
              f"segs={segs.count()}")
        seg_texts = segs.all_inner_texts()
        check("A2 segment labels carry the live factor",
              any("2X" in t and "↑" in t for t in seg_texts)
              and any("2X" in t and "↓" in t for t in seg_texts), str(seg_texts))
        stock_cls = segs.nth(0).get_attribute("class") or ""
        check("A3 STOCK seat active on the underlying", "segStockActive" in stock_cls)
        tfbar_h = page.evaluate(
            """() => document.querySelector('[class*="tfBar_"]').clientHeight""")
        shot("t10-1-pill-stock.png")

        # 2X up -> best_long
        segs.nth(1).click()
        wait_badge(page, [best_long, name_of[best_long]])
        page.wait_for_function(
            "() => document.querySelectorAll('canvas').length >= 1", timeout=15000)
        page.wait_for_timeout(2500)  # let bars land + paint
        px = painted_pixels(page)
        # The badge shows the raw ticker first, then flips to the resolved
        # fund NAME once ticker-meta lands — accept either as the DOM proof.
        best_long_name = next(x["name"] for x in fam["long"] if x["ticker"] == best_long)
        badge = badge_text(page)
        check(f"A4 2X-up charts best_long ({best_long}) with painted bars",
              (best_long in badge.upper() or badge.strip() == best_long_name) and px > 50,
              f"painted={px} badge={badge!r}")
        long_cls = seg_buttons(page).nth(1).get_attribute("class") or ""
        check("A5 LONG seat lights on the best-long ETF", "segLongActive" in long_cls)
        shot("t10-2-best-long.png")

        # Caret panel: liquidity-desc rows + stars on each side's best
        open_panel(page)
        ticks = panel_tickers(page)
        check("A6 panel rows are liquidity-desc (API order)",
              ticks == long_order + short_order, f"{ticks}")
        stars = page.locator('[role="menu"] button', has_text="★").all_inner_texts()
        check("A7 star on each side's most liquid",
              len(stars) == 2 and any(best_long in s for s in stars)
              and any(best_short in s for s in stars))
        shot("t10-3-panel.png")

        # Non-best pick -> LONG seat stays lit on a non-best member
        page.locator('[role="menu"] button', has_text=non_best_long).click()
        wait_badge(page, [non_best_long, name_of[non_best_long]])
        long_cls = seg_buttons(page).nth(1).get_attribute("class") or ""
        check(f"A8 non-best pick ({non_best_long}) charts + LONG seat lit",
              "segLongActive" in long_cls)
        shot("t10-4-nonbest-long.png")

        # STOCK returns to the underlying
        seg_buttons(page).nth(0).click()
        wait_badge(page, ["NBIS", "Nebius"])
        badge = badge_text(page).upper()
        check("A9 STOCK returns to NBIS", "NBIS" in badge or "NEBIUS" in badge, badge)

        # ── Phase B: narrow bottom-row widget ───────────────────────────────
        set_pref(ctx, "charts_workspace_layout", json.dumps(LAYOUT_NARROW_BOTTOM))
        page.goto(f"{BASE}/charts")
        dismiss_intro(page)
        page.wait_for_selector('[class*="tfBar_"]', timeout=20000)
        # Find the NARROW chart widget body (<480px container) and chart TSLA
        # in it through the real type-to-search flow.
        bodies = page.locator('[class*="widgetBody"]')
        narrow = None
        for i in range(bodies.count()):
            box = bodies.nth(i).bounding_box()
            if box and box["width"] < 480 and box["y"] > 300:
                narrow = bodies.nth(i)
                break
        assert narrow is not None, "no narrow bottom widget found"
        nbox = narrow.bounding_box()
        check("B0 chart container is below the 480px query",
              nbox["width"] < 480, f"width={nbox['width']:.0f}px")
        # tfBar height BEFORE the control exists (chart starts on SPY = no
        # family, control renders null) — the honest §2.1 baseline is the
        # SAME width without vs with the collapsed control.
        tfbar_before = narrow.evaluate(
            """el => el.querySelector('[class*="tfBar_"]').clientHeight""")
        type_symbol(page, narrow, "TSLA", ["Tesla"])
        page.wait_for_selector('[class*="caretBtn"]', timeout=20000)

        segs = seg_buttons(page)
        hidden = all(not segs.nth(i).is_visible() for i in range(segs.count()))
        check("B1 below ~480px container: segments hidden, caret survives",
              hidden and caret(page).is_visible(), f"segs={segs.count()}")
        tfbar_after = narrow.evaluate(
            """el => el.querySelector('[class*="tfBar_"]').clientHeight""")
        check("B2 tfBar height unchanged when the collapsed control mounts",
              abs(tfbar_after - tfbar_before) <= 1,
              f"before={tfbar_before}px after={tfbar_after}px (wide baseline={tfbar_h}px)")
        shot("t10-5-narrow-caret.png")

        panel = open_panel(page)
        pbox = panel.bounding_box()
        cbox = caret(page).bounding_box()
        vh = 900
        check("B3 bottom-row panel opens UPWARD",
              pbox["y"] + pbox["height"] <= cbox["y"] + 2,
              f"panel_bottom={pbox['y'] + pbox['height']:.0f} caret_top={cbox['y']:.0f}")
        check("B4 panel fully on-screen",
              pbox["y"] >= 4 and pbox["y"] + pbox["height"] <= vh - 4,
              f"top={pbox['y']:.0f} bottom={pbox['y'] + pbox['height']:.0f} vh={vh}")
        ticks = panel_tickers(page)
        tsla_order = [x["ticker"] for x in tsla["long"]] + [x["ticker"] for x in tsla["short"]]
        check("B5 no rows clipped (all family rows present)",
              ticks == tsla_order, f"{len(ticks)}/{len(tsla_order)} rows")
        shot("t10-6-bottom-panel-up.png")
        page.keyboard.press("Escape")

        # ── Phase C: sunrise theme tint swap (UI-reachable toggle) ──────────
        set_pref(ctx, "charts_workspace_layout", json.dumps(LAYOUT_WIDE))
        page.goto(f"{BASE}/charts")
        dismiss_intro(page)
        page.wait_for_selector('[class*="tfBar_"]', timeout=20000)
        type_symbol(page, page.locator('[class*="widgetBody"]').first, "NBIS", ["Nebius"])
        page.wait_for_selector('button:has-text("STOCK")', timeout=20000)
        up_default = page.evaluate(
            """() => getComputedStyle(document.querySelector('[class*="pill_"]'))
                       .getPropertyValue('--li-up').trim()""")
        page.locator('button:has-text("Open layout")').click()
        page.locator('button:has-text("TSDR")').click()
        page.wait_for_function(
            """() => document.querySelector('[data-charts-theme="sunrise"]') !== null""",
            timeout=5000)
        up_sunrise = page.evaluate(
            """() => getComputedStyle(document.querySelector('[class*="pill_"]'))
                       .getPropertyValue('--li-up').trim()""")
        check("C1 sunrise theme swaps the pill tint tokens",
              up_default != up_sunrise and up_sunrise != "",
              f"default={up_default} sunrise={up_sunrise}")
        seg_buttons(page).nth(1).click()   # light the LONG seat for the shot
        page.wait_for_timeout(1500)
        shot("t10-7-sunrise.png")
        set_pref(ctx, "charts_theme", "default")

        browser.close()

    fails = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} checks passed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
