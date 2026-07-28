"""Render the pre-launch social card -> app/public/og-coming-soon.png (1200x630).

The COMING SOON page's own metadata points here while VITE_COMING_SOON=1 (see
the transformIndexHtml plugin in app/vite.config.js); the original og-image.png
is left untouched for launch.

Rendered through Playwright rather than drawn with Pillow so it uses the real
brand face (Instrument Sans) and the same curve geometry as the live page —
a hand-drawn approximation drifts from the page it is supposed to preview.

Re-run after changing the launch date:
    python tools/make_og_coming_soon.py --date "September 5, 2026"

⚠️ THEN BUMP `?v=` IN THE `IMAGE` CONSTANT IN app/vite.config.js. The route
serves this with max-age=86400, so Cloudflare keeps handing out the previous
card for a day after deploy, and X/Discord/iMessage cache their own copy for
much longer. They all key on the full URL — bumping the query string is the
only thing that reliably makes the new card appear.
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

# The Uncharted Territory mark. Same vector trace as
# app/src/components/brand/UTMark.jsx — keep the three copies (that file, this
# one, app/public/favicon.svg) in sync; UTMark.jsx holds the measurements and
# the reasoning. Parameterised on colour so the card can state it twice: the
# real bull/bear logo in the lockup, and a gold restatement as the chart's
# compass rose.
MARK_POINT = "M 50 1.75 Q 51.8 22 53.6 28 L 46.4 28 Q 48.2 22 50 1.75 Z"


def mark_svg(bull: str, bear: str, size: int) -> str:
    """Inline SVG for the mark at `size` px, in the given bull/bear colours."""
    points = "".join(
        f'<path d="{MARK_POINT}" fill="{bull if rot in (0, 180) else bear}"'
        + (f' transform="rotate({rot} 50 50)"' if rot else "")
        + "/>"
        for rot in (0, 90, 180, 270)
    )
    return f"""<svg width="{size}" height="{size}" viewBox="0 0 100 100">
  <g fill="none" stroke-width="11">
    <path d="M 77.43 48.08 A 27.5 27.5 0 0 1 57.12 76.56" stroke="{bear}"/>
    <path d="M 52.4 77.4 A 27.5 27.5 0 0 1 23.57 57.58" stroke="{bull}"/>
    <path d="M 22.7 53.35 A 27.5 27.5 0 0 1 42.88 23.44" stroke="{bear}"/>
    <path d="M 48.08 22.57 A 27.5 27.5 0 0 1 76.68 43.35" stroke="{bull}"/>
  </g>
  {points}
  <rect x="48.75" y="30" width="2.5" height="20.6" fill="{bull}"/>
  <rect x="48.75" y="50.6" width="2.5" height="20.4" fill="{bear}"/>
  <path d="M 42.9 33.5 L 57.1 33.5 L 42.9 67.7 Z" fill="{bull}"/>
  <path d="M 57.1 33.5 L 57.1 67.7 L 42.9 67.7 Z" fill="{bear}"/>
</svg>"""

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
  /* Scoped to the curve on purpose. As a bare `svg` selector this also caught
     the brand mark and the rose and blew both up to full-bleed. */
  svg.curve {{ position:absolute; inset:0; width:100%; height:100%; }}
  .vig {{
    position:absolute; inset:0;
    background:radial-gradient(ellipse 120% 90% at 28% 42%, transparent 38%, rgba(6,7,6,.66) 100%);
  }}
  .wrap {{ position:absolute; inset:0; padding:56px 64px; display:flex; flex-direction:column; }}
  .brand {{ display:flex; align-items:center; gap:12px; }}
  .cmark {{ display:block; line-height:0; }}
  .cmark svg {{ display:block; }}
  /* Stacked two-up, matching the lockup on the page itself. */
  .bname {{
    display:flex; flex-direction:column; gap:1px;
    font-size:12.5px; font-weight:700; line-height:1.05; letter-spacing:3.6px;
    text-transform:uppercase; white-space:nowrap;
  }}
  .bname .t {{ color:#8c8674; }}
  .bname .b {{ color:#c9a84c; }}
  /* The chart's compass rose, in the open quarter below the course — the same
     move the live page makes, so the card previews the page instead of
     diverging from it. */
  .rose {{
    position:absolute; right:74px; bottom:64px;
    width:212px; height:212px; opacity:.13; line-height:0;
  }}
  .rose svg {{ display:block; width:100%; height:100%; }}
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
  <svg class="curve" viewBox="0 0 1600 800" preserveAspectRatio="none">
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
  <div class="rose">{rose}</div>
  <div class="vig"></div>

  <div class="mk"><span class="dot" style="left:855px;top:260px"></span>
                  <span class="halo" style="left:855px;top:260px"></span>
                  <span class="dia"  style="left:1088px;top:139px"></span></div>

  <div class="wrap">
    <div class="brand"><span class="cmark">{mark}</span>
      <span class="bname"><span class="t">Uncharted</span><span class="b">Territory</span></span></div>
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

    html = HTML.format(
        past=PAST_D,
        ahead=AHEAD_D,
        date=args.date,
        mark=mark_svg("#67DB44", "#E23E23", 30),   # the real logo, in the lockup
        rose=mark_svg("#d6ba69", "#9a7a2c", 212),  # gold restatement, as the rose
    )

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
