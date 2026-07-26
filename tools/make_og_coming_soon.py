"""Render the pre-launch social card -> app/public/og-coming-soon.png (1200x630).

The COMING SOON page's own metadata points here while VITE_COMING_SOON=1 (see
the transformIndexHtml plugin in app/vite.config.js); the original og-image.png
is left untouched for launch.

Rendered through Playwright rather than drawn with Pillow so it uses the real
brand face (Instrument Sans) and the same curve geometry as the live page —
a hand-drawn approximation drifts from the page it is supposed to preview.

Re-run after changing the launch date:
    python tools/make_og_coming_soon.py --date "September 5, 2026"
"""

import argparse
import pathlib
import sys

OUT = pathlib.Path(__file__).resolve().parents[1] / "app" / "public" / "og-coming-soon.png"

# Same viewBox + geometry as app/src/pages/ComingSoon.jsx. Keep in sync — this
# card is a preview of that page, so a divergent curve is a bug.
PAST_D = (
    "M -30 776 C 96 772, 196 764, 292 758 S 424 748, 500 762 "
    "C 570 774, 646 744, 726 710 C 806 676, 856 616, 916 556 "
    "S 1016 462, 1068 430 C 1106 408, 1122 368, 1140 330"
)
AHEAD_D = "M 1140 330 C 1214 276, 1268 268, 1338 224 S 1418 190, 1450 176"

HTML = """<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1200px; height:630px; overflow:hidden; }}
  body {{
    position:relative; background:#0e0f0d;
    font-family:'Instrument Sans',sans-serif; color:#b6b09d;
  }}
  .grid {{
    position:absolute; inset:0;
    background-image:
      repeating-linear-gradient(0deg,  rgba(201,168,76,.055) 0 1px, transparent 1px 68px),
      repeating-linear-gradient(90deg, rgba(201,168,76,.055) 0 1px, transparent 1px 68px);
    -webkit-mask-image:radial-gradient(ellipse 80% 70% at 50% 45%, #000 30%, transparent 100%);
  }}
  svg {{ position:absolute; inset:0; width:100%; height:100%; }}
  .vig {{
    position:absolute; inset:0;
    background:radial-gradient(ellipse 120% 90% at 28% 42%, transparent 38%, rgba(6,7,6,.66) 100%);
  }}
  .wrap {{ position:absolute; inset:0; padding:56px 64px; display:flex; flex-direction:column; }}
  .brand {{ display:flex; align-items:center; gap:11px; }}
  .cmark {{ font-size:20px; color:#c9a84c; line-height:1; }}
  .bname {{
    font-size:13px; font-weight:600; letter-spacing:3px;
    text-transform:uppercase; color:#8c8674;
  }}
  .body {{ flex:1; display:flex; flex-direction:column; justify-content:center; }}
  .eyebrow {{
    font-size:16px; font-weight:600; letter-spacing:6.5px;
    text-transform:uppercase; color:#c9a84c; margin-bottom:20px;
  }}
  h1 {{
    font-size:118px; font-weight:700; line-height:.9; letter-spacing:11px;
    text-transform:uppercase; color:#f0ead8;
  }}
  h1 .s {{ display:block; color:#c9a84c; margin-left:.09em; }}
  .tag {{
    margin-top:30px; padding-left:16px; border-left:3px solid rgba(201,168,76,.6);
    font-size:22px; font-weight:500; color:#e0dac8;
  }}
  .foot {{ display:flex; align-items:baseline; gap:14px; }}
  .date {{
    font-size:19px; font-weight:700; letter-spacing:3.4px;
    text-transform:uppercase; color:#c9a84c;
  }}
  .dsub {{
    font-size:14px; font-weight:500; letter-spacing:2.6px;
    text-transform:uppercase; color:rgba(201,168,76,.55);
  }}
  .mk {{ position:absolute; }}
  .dot {{
    position:absolute; width:13px; height:13px; border-radius:50%;
    background:#c9a84c; transform:translate(-50%,-50%);
    box-shadow:0 0 20px 4px rgba(201,168,76,.8);
  }}
  .halo {{
    position:absolute; width:40px; height:40px; border-radius:50%;
    border:1.5px solid rgba(201,168,76,.5); transform:translate(-50%,-50%);
  }}
  .dia {{
    position:absolute; width:15px; height:15px; background:#c9a84c;
    transform:translate(-50%,-50%) rotate(45deg);
    box-shadow:0 0 22px 5px rgba(201,168,76,.65);
  }}
</style></head>
<body>
  <div class="grid"></div>
  <svg viewBox="0 0 1600 800" preserveAspectRatio="none">
    <defs>
      <linearGradient id="f" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#c9a84c" stop-opacity="0"/>
        <stop offset="100%" stop-color="#c9a84c" stop-opacity=".11"/>
      </linearGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
        <stop offset="14%" stop-color="#fff" stop-opacity="1"/>
        <stop offset="44%" stop-color="#fff" stop-opacity="1"/>
        <stop offset="66%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <mask id="m"><rect width="1600" height="800" fill="url(#fade)"/></mask>
    </defs>
    <path d="{past} L 1140 800 L -30 800 Z" fill="url(#f)" mask="url(#m)"/>
    <path d="{past}"  fill="none" stroke="#c9a84c" stroke-width="2.4" stroke-linecap="round" opacity=".5"/>
    <path d="{ahead}" fill="none" stroke="#c9a84c" stroke-width="1.9" stroke-linecap="round"
          stroke-dasharray="9 12" opacity=".42"/>
  </svg>
  <div class="vig"></div>

  <div class="mk"><span class="dot" style="left:855px;top:260px"></span>
                  <span class="halo" style="left:855px;top:260px"></span>
                  <span class="dia"  style="left:1088px;top:139px"></span></div>

  <div class="wrap">
    <div class="brand"><span class="cmark">&#8853;</span><span class="bname">Uncharted Territory</span></div>
    <div class="body">
      <div class="eyebrow">UCT Intelligence</div>
      <h1>Coming<span class="s">Soon</span></h1>
      <div class="tag">Navigate the market, effectively.</div>
    </div>
    <div class="foot"><span class="date">{date}</span><span class="dsub">Founder access open</span></div>
  </div>
</body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="September 5, 2026",
                    help="launch date shown on the card")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed — pip install playwright && playwright install chromium")
        return 1

    html = HTML.format(past=PAST_D, ahead=AHEAD_D, date=args.date)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        # deviceScaleFactor=1 -> exactly 1200x630, the size declared in the meta tags.
        page = browser.new_page(viewport={"width": 1200, "height": 630},
                                device_scale_factor=1)
        page.set_content(html, wait_until="networkidle")
        page.evaluate("() => document.fonts.ready")   # no FOUT in the render
        page.wait_for_timeout(400)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT))
        browser.close()

    print(f"wrote {OUT}  ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
