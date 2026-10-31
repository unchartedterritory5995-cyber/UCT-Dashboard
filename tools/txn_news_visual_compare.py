"""Visual comparison: the News (Trade Exchange) widget vs Watchlist and Theme Tracker.

Drives ``app/news-compare-harness.html`` (synthetic data only, every write refused)
in headless Chromium and writes, to ``--out``:
  * one screenshot per scenario (dark, light, a theme applied to all widgets,
    compact density);
  * ``metrics.json`` + ``metrics.md``: computed styles of the equivalent chrome in
    each widget -- header row, search row, list row, symbol text -- so "matches"
    is a measurement, not an opinion.

    python tools/txn_news_visual_compare.py --base http://127.0.0.1:5841 --out <dir>
"""
from __future__ import annotations

import argparse
import json
import pathlib

from playwright.sync_api import sync_playwright

SCENARIOS = {
    "dark": "?theme=dark",
    "light": "?theme=light",
    "applied-theme": "?theme=dark&apply=midnight-navy",
    "compact": "?theme=dark&density=compact",
    "light-compact": "?theme=light&density=compact",
    "light-applied-theme": "?theme=light&apply=midnight-navy",
    "responsive-300": "?theme=dark&width=300",
    "responsive-250": "?theme=dark&width=250",
    "responsive-160": "?theme=dark&width=160",
}

# Interactive captures on the News pane (dark): the SHARED settings panel, the
# SHARED colour picker it opens, and the alerts popover.
NEWS = '[data-pane="tradeExchangeNews"]'


# The equivalent element in each widget, by CSS-module class fragment.
PROBES = {
    "header row": {"watchlist": '[class*="pickHeader"]', "themes": '[class*="periodBar"]',
                   "tradeExchangeNews": '[class*="_bar_"]'},
    "search row": {"watchlist": '[class*="searchBar"], [class*="pickSearch"]',
                   "themes": '[class*="searchBar"]', "tradeExchangeNews": '[class*="searchBar"]'},
    "search input": {"watchlist": 'input[type="text"], input:not([type])', "themes": '[class*="searchInput"]',
                     "tradeExchangeNews": '[class*="searchInput"]'},
    "list row": {"watchlist": '[class*="listRow"]', "themes": '[class*="themeRow"], [class*="stockRow"]',
                 "tradeExchangeNews": '[data-seq]'},
    "symbol text": {"watchlist": '[class*="rowSym"]', "themes": '[class*="themeName"], [class*="stockSym"], [class*="sym"]',
                    "tradeExchangeNews": '[class*="_sym_"]'},
    "icon button": {"watchlist": '[class*="wlActionBtn"]', "themes": '[class*="settingsBtn"]',
                    "tradeExchangeNews": '[class*="iconBtn"]'},
}
PROPS = ["height", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "paddingTop", "paddingRight",
         "paddingBottom", "paddingLeft", "borderBottomWidth", "borderBottomColor", "color", "backgroundColor"]

JS = """([probes, props]) => {
  const out = {}
  for (const [name, bySel] of Object.entries(probes)) {
    out[name] = {}
    for (const [pane, sel] of Object.entries(bySel)) {
      const root = document.querySelector(`[data-pane="${pane}"]`)
      const el = root && root.querySelector(sel)
      if (!el) { out[name][pane] = null; continue }
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const row = { height: `${Math.round(r.height)}px` }
      for (const p of props) if (p !== 'height') row[p] = cs[p]
      out[name][pane] = row
    }
  }
  return out
}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1060, "height": 640}, device_scale_factor=1)
        logs = []
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error",) else None)
        for name, qs in SCENARIOS.items():
            page.goto(f"{args.base}/news-compare-harness.html{qs}")
            page.wait_for_selector('[data-pane="tradeExchangeNews"] [data-seq]', timeout=30000)
            page.wait_for_timeout(1800)                     # let the scripted live headline land
            page.mouse.move(5, 5)
            page.screenshot(path=str(out / f"{name}.png"))
            if name == "dark":
                page.wait_for_timeout(200)
            results[name] = page.evaluate(JS, [PROBES, PROPS])
            results[name]["_blocked_writes"] = page.evaluate("window.__newsHarnessBlocked || []")
        page.goto(f"{args.base}/news-compare-harness.html?theme=dark")
        page.wait_for_selector(f"{NEWS} [data-seq]", timeout=30000)
        page.click(f'{NEWS} [aria-label="News widget settings"]')
        page.wait_for_timeout(400)
        page.screenshot(path=str(out / "settings-panel.png"))
        page.click('button[title="Tickers"]')
        page.wait_for_timeout(400)
        page.screenshot(path=str(out / "color-picker.png"))
        page.keyboard.press("Escape")
        page.goto(f"{args.base}/news-compare-harness.html?theme=dark")
        page.wait_for_selector(f"{NEWS} [data-seq]", timeout=30000)
        page.click(f'{NEWS} [aria-label="News alerts"]')
        page.wait_for_timeout(400)
        page.screenshot(path=str(out / "alerts-popover.png"))
        page.goto(f"{args.base}/news-compare-harness.html?theme=dark")
        page.wait_for_selector(f"{NEWS} [data-seq]", timeout=30000)
        page.hover(f"{NEWS} [data-seq]:nth-child(3)")
        page.wait_for_timeout(200)
        results["hover"] = page.evaluate("""() => {
          const r = document.querySelectorAll('[data-pane="tradeExchangeNews"] [data-seq]')[2]
          return getComputedStyle(r).backgroundColor }""")
        browser.close()
    (out / "metrics.json").write_text(json.dumps({"results": results, "console_errors": logs[:50]}, indent=2))
    lines = ["# News vs Watchlist vs Theme Tracker — computed styles (dark scenario)", ""]
    dark = results["dark"]
    for probe, panes in dark.items():
        if probe.startswith("_"):
            continue
        lines.append(f"## {probe}")
        lines.append("| property | Watchlist | Theme Tracker | News |")
        lines.append("|---|---|---|---|")
        for p in PROPS:
            vals = [(panes.get(k) or {}).get(p, "—") if panes.get(k) else "(not found)"
                    for k in ("watchlist", "themes", "tradeExchangeNews")]
            lines.append(f"| {p} | " + " | ".join(str(v) for v in vals) + " |")
        lines.append("")
    lines.append(f"Writes refused by the harness: {dark.get('_blocked_writes')}")
    (out / "metrics.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {len(SCENARIOS) + 3} screenshots + metrics to {out}")
    print(f"console errors: {len(logs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
