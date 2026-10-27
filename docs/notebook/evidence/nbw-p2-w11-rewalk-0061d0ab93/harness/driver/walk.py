import argparse, sys, faulthandler
faulthandler.dump_traceback_later(1200, repeat=True)
print('walk start', flush=True)
from playwright.sync_api import sync_playwright
from ev import Step, run
import steps_a

TITLES = {
    "W11.1": "Template library -> Pre-market prep -> Preview",
    "W11.2": "Use -> create the routine -> tick -> reload",
    "W11.3": "Use Pre-market prep again",
    "W11.4": "[CLK-SUN] Night-before prep on Sunday 21:00 ET",
    "W11.5": "[CLK-SAT] Weekend swing review on Saturday",
    "W11.6": "Setup study: suggested, then brand-new",
    "W11.7": "Template share -> review -> adopt with pick-yours",
    "W11.8": "Share a widget, a routine and a tracker from My tools",
    "W11.9": "[CLK-D1,D2,D3] Helpful after three ET days",
    "W11.10": "My tools -> Templates management",
    "W11.11": "Share and publish the template-made note; open logged out",
    "W11.12": "[W11OFF, then ON] Flag off and back",
    "W11.13": "390 with the keyboard open",
    "W11.14": "Keyboard only",
    "W11.15": "Themes: dark, light, OLED",
    "W11.16": "Reduced motion",
    "W11.17": "Chips and doors",
    "FDEF": "F-DEF-1 retests", "D2": "D2 first open of a template-made note writes only the self-archive fallback (PUTPROBE)", "D3": "D3 routine block has no overflow", "D4": "D4 gallery card buttons >= 44x44 on touch", "D5": "D5 no scrollable-region-focusable", "D6": "D6 the page behind an open Sheet is inert; no top-bar contrast finding", "VID": "R80/R82 floating video and TickerPopup sheets", "ENF": "editorNormalForm: a member-template note opens with zero PUTs", "PD1": "PD-1 Login button contrast and tap size", "PD2": "PD-2 builder summary on an empty range", "PD3": "PD-3 Toast Dismiss tap size", "W11.0": "Boot identity, flags and probes", "R8": "R8 chips follow the library group", "PUTPROBE": "Does opening a template-made note write it (W11.12 follow-up)",
    "FDEF2": "F-DEF-1 retests (P14, P46 at 1200)",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8151")
    ap.add_argument("--mode", default="ON")
    ap.add_argument("--vp", default="1200,820,390")
    ap.add_argument("--steps", required=True)
    ap.add_argument("--partial", action="store_true")
    a = ap.parse_args()
    mods = {}
    for m in ("steps_a", "steps_b", "steps_c", "steps_d", "steps_e", "steps_f", "steps_g"):
        try:
            mods[m] = __import__(m)
        except ImportError:
            pass
    with sync_playwright() as p:
        b = p.chromium.launch()
        for vp in a.vp.split(","):
            for sid in a.steps.split(","):
                fn = None
                for m in mods.values():
                    fn = fn or getattr(m, sid.lower().replace(".", "_").replace("w11_", "w11_"), None)
                if fn is None:
                    print("no driver for", sid); continue
                S = Step(vp, sid, TITLES.get(sid, sid), a.mode)
                run(S, fn, b, a.base, vp)
                S.finish(partial=a.partial)
        b.close()


if __name__ == "__main__":
    main()
