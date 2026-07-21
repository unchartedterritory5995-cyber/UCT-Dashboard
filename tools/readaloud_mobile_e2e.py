"""End-to-end phone-viewport test of Read Aloud against the REAL built app.

Runs the actual React bundle (real AudioPlayerBar, real useReadAloud, real CSS)
in Chromium at a phone viewport, with every /api/* call stubbed so no paid
account or live backend is needed. Covers the two failures this fix series was
about, on mobile:

  A. the Stop control is on screen and actually tappable while playing
  B. Stop pressed during the slow /tts/prepare leg never starts audio afterwards

Prereq:  cd app && npm run build     (this serves app/dist)
Run:     python tools/readaloud_mobile_e2e.py
Exit:    0 = pass, 1 = failure (prints what and where)
"""
import asyncio
import functools
import http.server
import io
import json
import pathlib
import socketserver
import struct
import sys
import threading
import wave

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / "app" / "dist"
VIEWPORT = {"width": 390, "height": 844}       # iPhone 12/13/14
TAB_BAR_H = 44
PREPARE_DELAY_MS = 3000                        # mimic a cold TTS synthesis


def silent_wav(seconds=30, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 0) * rate * seconds)
    return buf.getvalue()


RUNDOWN_HTML = """
<section class="rd-seg"><h2>THE TAPE</h2>
<p>Rally attempt day one. The tape is constructive but the structure is broken.</p></section>
<section class="rd-seg"><h2>THE SETUPS</h2>
<p>Memory and semis lead. Size cut to match the regime.</p></section>
"""

ME = {
    "user": {"id": "u1", "email": "t@t.dev", "display_name": "Test",
             "role": "admin", "email_verified": True},
    "plan": "pro",
    "subscription": {"status": "active"},
    "trial": None,
    "billing": {"annual_available": False},
}


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_head(self):
        path = self.translate_path(self.path)
        if not pathlib.Path(path).exists() or pathlib.Path(path).is_dir():
            self.path = "/index.html"          # SPA fallback
        return super().send_head()


def serve(directory):
    handler = functools.partial(SPAHandler, directory=str(directory))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def make_router(audio, state):
    async def route(r):
        url = r.request.url

        async def js(obj, status=200):
            await r.fulfill(status=status, content_type="application/json",
                            body=json.dumps(obj))

        if "/api/auth/me" in url:
            return await js(ME)
        if "/api/rundown" in url:
            return await js({"date": "2026-07-21", "html": RUNDOWN_HTML})
        if "/api/voice/settings" in url:
            return await js({"enabled": True, "voice": "alloy", "speed": 1.0,
                             "proactive_speak": False})
        if "/api/voice/tts/prepare" in url:
            state["prepare_calls"] += 1
            if state["slow_prepare"]:
                # asyncio.sleep, NOT time.sleep — a blocking sleep here stalls
                # Playwright's driver, so the test could not click Stop until
                # prepare had already resolved and the race went untested.
                await asyncio.sleep(PREPARE_DELAY_MS / 1000)
            return await js({"token": "tok"})
        if "/api/voice/tts/stream" in url:
            state["stream_calls"] += 1
            return await r.fulfill(status=200, content_type="audio/wav", body=audio,
                                   headers={"Accept-Ranges": "bytes",
                                            "Content-Length": str(len(audio))})
        if "/api/catalysts" in url:
            return await js({"catalysts": [], "sector_contexts": []})
        if "/api/" in url:
            # Default to an ARRAY: several tiles spread the response directly
            # (`[...(data || [])]`), which throws on a bare object.
            return await js([])
        return await r.continue_()
    return route


async def geometry(page):
    return await page.evaluate("""() => {
        const bar = document.querySelector('[aria-label="Audio playback"]');
        if (!bar) return null;
        const stop = [...bar.querySelectorAll('button')]
            .find(b => b.getAttribute('aria-label') === 'Stop');
        if (!stop) return {barOnly: true};
        const b = bar.getBoundingClientRect(), s = stop.getBoundingClientRect();
        const el = document.elementFromPoint(s.x + s.width / 2, s.y + s.height / 2);
        const hitBtn = el && el.closest('button');
        return {
            bar: {x: b.x, y: b.y, w: b.width, h: b.height},
            stop: {x: s.x, y: s.y, w: s.width, h: s.height},
            hit: hitBtn ? hitBtn.getAttribute('aria-label') : (el ? el.tagName : 'nothing'),
        };
    }""")


async def audio_state(page):
    return await page.evaluate("""() => {
        const a = document.querySelector('audio');
        return a ? {paused: a.paused, t: a.currentTime, src: a.getAttribute('src')} : null;
    }""")


async def main():
    if not (DIST / "index.html").exists():
        print(f"dist not built — run: cd app && npm run build   ({DIST})")
        return 1

    audio = silent_wav()
    state = {"slow_prepare": False, "prepare_calls": 0, "stream_calls": 0}
    fails = []
    httpd, port = serve(DIST)

    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = await browser.new_context(viewport=VIEWPORT, is_mobile=True, has_touch=True,
                                  reduced_motion="reduce")
        page = await ctx.new_page()
        await page.route("**/*", make_router(audio, state))
        await page.goto(f"http://127.0.0.1:{port}/morning-wire")

        # Skip the cinematic intro, then wait for the paid-only Read Aloud button.
        await page.keyboard.press("Escape")
        try:
            await page.wait_for_selector('button[aria-label="Read aloud"]', timeout=20000)
        except Exception:
            print("FAIL: Read aloud button never appeared (auth/rundown stub wrong?)")
            await browser.close(); httpd.shutdown()
            return 1

        # ---- A: playing on a phone — Stop must be reachable -------------------
        await page.click('button[aria-label="Read aloud"]')
        await page.wait_for_selector('[aria-label="Audio playback"]', timeout=15000)
        await page.wait_for_timeout(2500)
        g = await geometry(page)
        w, h = VIEWPORT["width"], VIEWPORT["height"]
        if not g or g.get("barOnly"):
            fails.append("A: player bar or Stop button missing while playing")
        else:
            s = g["stop"]
            if s["x"] < 0 or s["x"] + s["w"] > w + 0.5:
                fails.append(f"A: STOP OFF-SCREEN — x={s['x']:.0f} right={s['x']+s['w']:.0f} vw={w}")
            if g["bar"]["y"] + g["bar"]["h"] > h - TAB_BAR_H + 0.5:
                fails.append(f"A: bar overlaps the {TAB_BAR_H}px tab bar")
            if g["hit"] != "Stop":
                fails.append(f"A: tap at Stop centre hits '{g['hit']}'")
            if s["w"] < 44 or s["h"] < 44:
                fails.append(f"A: Stop tap target {s['w']:.0f}x{s['h']:.0f} under 44px")

        # It must actually stop.
        await page.click('[aria-label="Audio playback"] button[aria-label="Stop"]')
        await page.wait_for_timeout(1200)
        a = await audio_state(page)
        if a and not a["paused"]:
            fails.append("A: audio still playing after Stop")
        if a and a["src"]:
            fails.append(f"A: src not cleared after Stop ({a['src']!r})")

        # ---- B: the original bug, on a phone ---------------------------------
        state["slow_prepare"] = True
        before = state["stream_calls"]
        await page.click('button[aria-label="Read aloud"]')
        await page.wait_for_selector('[aria-label="Audio playback"]', timeout=5000)
        g2 = await geometry(page)
        if not g2 or g2.get("barOnly"):
            fails.append("B: no Stop control during prepare — nothing to cancel with")
        await page.click('[aria-label="Audio playback"] button[aria-label="Stop"]')
        await page.wait_for_timeout(PREPARE_DELAY_MS + 3000)   # let the prepare land
        a2 = await audio_state(page)
        if a2 and (not a2["paused"] or a2["t"] > 0.05):
            fails.append(f"B: audio started AFTER Stop — paused={a2['paused']} t={a2['t']:.2f}")
        if state["stream_calls"] > before:
            fails.append("B: stream was fetched after Stop (cancelled read still played)")
        if await page.query_selector('[aria-label="Audio playback"]'):
            fails.append("B: player bar still visible after Stop")

        await browser.close()
    httpd.shutdown()

    print(f"viewport {VIEWPORT['width']}x{VIEWPORT['height']} · "
          f"prepare={state['prepare_calls']} stream={state['stream_calls']}")
    for f in fails:
        print("  FAIL " + f)
    if fails:
        print(f"\n{len(fails)} failure(s)")
        return 1
    print("  ok   Stop reachable + tappable while playing on a phone")
    print("  ok   Stop during prepare never starts audio")
    print("\nall checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
