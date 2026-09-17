"""Deterministic screenshot + DOM harness for Breadth Data Charts (DC-2 §3.2).

⛔⛔ WHAT MAKES A SHOT EVIDENCE. A golden captured against a live backend re-records
itself every day and proves nothing — it is a rail whose fixture is a moving reference,
which is the defect this programme was still paying for on 2026-09-17. Every input here
is pinned, and the harness REFUSES rather than guesses when one of them is not:

  * the DATA is a fixture served by route interception — no backend, no network;
  * the CLOCK is frozen, because the tab's default window is built from `todayET()`
    and an unfrozen clock rots every golden at the next midnight;
  * the FLAGS are injected on `/api/auth/me`, so the matrix drives the real runtime
    gate rather than a test-only prop;
  * the TREE is identified by hash — see "server identity" below.

⛔ A PORT ASSIGNMENT IS NOT A SERVER IDENTITY. This box has had four listeners on one
port, and `bind()` succeeding proves nothing on Windows while `connect()` to an unbound
loopback port TIMES OUT rather than being refused — so timing can never establish
identity either. This harness therefore (a) refuses a port that already answers,
(b) takes an OS-assigned port, and (c) after boot fetches `/index.html` and requires its
sha256 to equal the sha256 of `app/dist/index.html` ON DISK. That is stronger than a
nonce: it binds the screenshots to THIS BUILD of THIS TREE, not merely to "a server we
started". A mismatch is a hard exit, never a warning.

⛔ IT DOES NOT BUILD FOR YOU. A harness that silently rebuilds hides which tree it shot.
If `app/dist` is missing or stale, it says so and names the command.

Usage:
    python tools/breadth_charts_shots.py --capture         # write shots/ + dom/
    python tools/breadth_charts_shots.py --check           # compare against goldens
    python tools/breadth_charts_shots.py --update-goldens  # deliberate, reviewable act
    python tools/breadth_charts_shots.py --self-check      # prove the differ can fail
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
APP = REPO / "app"
DIST = APP / "dist"
OUT = REPO / "docs" / "breadth-data-charts" / "shots"
GOLDEN = REPO / "docs" / "breadth-data-charts" / "shots-golden"

# ── The pinned inputs ────────────────────────────────────────────────────────────────
#: Frozen instant. ⛔ A real date, chosen once and never "refreshed": the tab computes its
#: default window from today, so moving this moves every golden.
FROZEN_ISO = "2026-09-15T14:30:00.000Z"
#: The session the fixture ends on, in ET terms, consistent with FROZEN_ISO.
FIXTURE_TO = "2026-09-15"

#: Viewports. 1280 is the desktop the audit's evidence shots were taken at; 380 is a
#: phone NARROWER than the 640 breakpoint, so the touch branch is genuinely exercised.
VIEWPORTS = {"1280": (1280, 900), "380": (380, 800)}

#: Spans. "365" is what the tab asks for today; "max" is what V2-3's long history opens.
SPANS = {"365": 365, "max": 4530}

#: Flag states. ⛔ These drive the REAL runtime gate through the auth payload, so a shot
#: labelled `v22` is evidence about the flag a member's flip actually sets.
FLAG_STATES = {
    "off": {"breadth_dc_v2_2_enabled": False, "breadth_dc_v2_3_enabled": False},
    "v22": {"breadth_dc_v2_2_enabled": True, "breadth_dc_v2_3_enabled": False},
    "v23": {"breadth_dc_v2_2_enabled": False, "breadth_dc_v2_3_enabled": True},
    "both": {"breadth_dc_v2_2_enabled": True, "breadth_dc_v2_3_enabled": True},
}

#: The keys the fixture serves. `universe_count` is present ON PURPOSE: V2-3's era note is
#: computed from it client-side, so a fixture without it cannot exercise that path at all.
FIXTURE_KEYS = [
    "breadth_score", "pct_above_50sma", "adv_decline", "hvc_52w",
    "aaii_bulls", "new_52w_highs", "universe_count", "qqq_close",
]


# ── Fixture ──────────────────────────────────────────────────────────────────────────
def _fixture(span_sessions: int) -> dict:
    """A deterministic series. ⛔ No RNG without a fixed seed and no clock read.

    Shaped to exercise the honest-state paths rather than to look tidy:
      * `aaii_bulls` is WEEKLY — null except every 5th session, so a renderer that draws
        it as a daily line (A-28/A-10) is visibly wrong rather than subtly wrong;
      * `hvc_52w` is a SPARSE spike count, mostly 0 — the A-28 bars case;
      * `qqq_close` is absent before 2026-01-02, which is exactly A-39's condition;
      * `universe_count` grows with the CALENDAR, so the era note (>20 % end to end)
        fires on the long span and must NOT fire on the short one — the harness has to
        be able to tell those apart or it cannot test the condition at all.
    """
    import datetime as dt

    end = dt.date.fromisoformat(FIXTURE_TO)
    # Sessions, not calendar days: weekends are skipped so the x-axis is realistic.
    dates: list[str] = []
    d = end
    while len(dates) < span_sessions:
        if d.weekday() < 5:
            dates.append(d.isoformat())
        d -= dt.timedelta(days=1)
    dates.reverse()

    n = len(dates)
    series: dict[str, list] = {}
    series["breadth_score"] = [round(50 + 30 * ((i * 7) % 100) / 100.0, 2) for i in range(n)]
    series["pct_above_50sma"] = [round(20 + 60 * ((i * 13) % 100) / 100.0, 2) for i in range(n)]
    # signed daily net — the A-28 "bars" case, and the reason a shared axis is a lie
    series["adv_decline"] = [((i * 37) % 1200) - 600 for i in range(n)]
    # sparse spike counts: mostly zero, occasionally large
    series["hvc_52w"] = [(0 if i % 11 else (i % 23) + 1) for i in range(n)]
    # WEEKLY survey: a reading every 5th session, null elsewhere
    series["aaii_bulls"] = [round(25 + (i % 50), 2) if i % 5 == 0 else None for i in range(n)]
    series["new_52w_highs"] = [(i * 17) % 400 for i in range(n)]
    # ⛔⛔ UNIVERSE GROWTH IS A FUNCTION OF THE DATE, NOT OF THE SPAN'S INDEX.
    # Written first as `i / (n - 1)`, which grew 74 % on EVERY span — so the era note
    # (>20 % end to end) would have fired on all of them and the harness could not tell
    # "fires correctly" from "always fires". A fixture that cannot distinguish is not a
    # rail. Anchored to the calendar instead: ~8 % over a year, ~74 % over seventeen.
    _EPOCH, _NOW = dt.date(2009, 5, 6), dt.date(2026, 9, 15)
    _total_days = (_NOW - _EPOCH).days
    series["universe_count"] = [
        1521 + int((2648 - 1521) * ((dt.date.fromisoformat(d) - _EPOCH).days / _total_days))
        for d in dates
    ]
    # ⛔ A-39: absent before 2026-01-02, so FTD markers cannot exist there
    series["qqq_close"] = [None if dates[i] < "2026-01-02" else round(400 + (i % 60), 2)
                           for i in range(n)]

    # Reconstructed sessions: the first 40 % of the span, per the audit's 191-of-365 shape.
    reconstructed = dates[: int(n * 0.4)]

    return {
        "from": dates[0],
        "to": dates[-1],
        "sessions": n,
        "keys": FIXTURE_KEYS,
        "series": series,
        "reconstructed": reconstructed,
        "missing": [],
        "sampling": "lttb" if n > 1000 else None,
    }


def _auth_payload(flags: dict) -> dict:
    """A signed-in member. ⛔ role `free`, never admin: an admin payload would make the
    `admin` preview value indistinguishable from `true` and every shot would be the
    owner's view rather than a member's."""
    # ⛔ `email_verified` IS LOAD-BEARING AND ITS ABSENCE COST 16 WRONG SHOTS.
    # `AuthGuard.jsx:105` bounces an unverified non-admin to "Verify your email", so the
    # first capture run photographed that screen sixteen times, wrote sixteen PNGs and
    # exited 0. ⭐ Nothing in the run said otherwise — the shots were byte-identical
    # within a viewport, which is what finally gave it away. That is why `_assert_landed`
    # below exists: a harness must refuse to save a picture of a page it did not reach.
    return {
        "user": {"id": "shots-fixture", "email": "shots@fixture.invalid",
                 "display_name": "Fixture", "role": "free", "created_at": None,
                 "email_verified": True},
        "plan": "pro",
        "trial": {"active": False, "days_left": 0},
        "paid_equiv": True,
        "billing": {"annual_available": False},
        "hub_preview_enabled": False,
        "research_technical_tab_enabled": False,
        "s7_filing_watch_enabled": False,
        **flags,
    }


# ── Server identity ──────────────────────────────────────────────────────────────────
def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _port_is_quiet(port: int, timeout: float = 0.6) -> bool:
    """⛔ CONNECT, never bind. A second bind on 127.0.0.1 is permitted on Windows while
    another process holds 0.0.0.0, so a successful bind says nothing about who will
    answer. A successful connect is proof somebody is there."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return False
    except OSError:
        return True


class Preview:
    """`vite preview` over `app/dist`, identified by the hash of the tree it serves."""

    def __init__(self) -> None:
        self.port = _free_port()
        self.proc: subprocess.Popen | None = None

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def __enter__(self) -> "Preview":
        index = DIST / "index.html"
        if not index.is_file():
            sys.exit("app/dist/index.html is absent — build it first:\n"
                     "    cd app && npm run build\n"
                     "(this harness does not build for you: a harness that rebuilds "
                     "silently hides which tree it shot)")
        self.expect_sha = _sha(index.read_bytes())

        if not _port_is_quiet(self.port):
            sys.exit(f"port {self.port} already answers — refusing to squat on another "
                     f"process (it may be another workstream's server)")

        # ⛔ `--host 127.0.0.1` IS LOAD-BEARING, and it cost a debugging round.
        # Vite's default binds `localhost`, which on this box resolves to IPv6 `::1`
        # ONLY — a connect to 127.0.0.1 then never completes, so the harness sat through
        # its full 60 s wait and reported "vite preview never answered" while vite was
        # running perfectly and printing its URL. ⭐ The two halves must name the SAME
        # address: the occupancy check, the readiness fetch and the browser all use v4,
        # so "quiet" and "answering" are claims about one socket rather than two.
        self.proc = subprocess.Popen(
            ["npx", "vite", "preview", "--port", str(self.port),
             "--strictPort", "--host", "127.0.0.1"],
            cwd=str(APP), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            shell=(os.name == "nt"),
        )
        deadline = time.time() + 60
        served = None
        while time.time() < deadline:
            if self.proc.poll() is not None:
                out = (self.proc.stdout.read() or b"").decode("utf-8", "replace")
                sys.exit(f"vite preview exited early:\n{out[-2000:]}")
            try:
                with urllib.request.urlopen(self.base + "/index.html", timeout=2) as r:
                    served = r.read()
                break
            except (urllib.error.URLError, OSError, TimeoutError):
                time.sleep(0.4)
        if served is None:
            self.stop()
            sys.exit("vite preview never answered within 60 s")

        got = _sha(served)
        if got != self.expect_sha:
            self.stop()
            sys.exit("⛔ SERVER IDENTITY MISMATCH — the thing answering on this port is "
                     "not the dist in this worktree.\n"
                     f"   served sha256 {got}\n   on-disk sha256 {self.expect_sha}\n"
                     "Refusing to capture: a shot of somebody else's build is worse than "
                     "no shot, because it looks like evidence.")
        print(f"[identity] preview on {self.base} serving THIS tree "
              f"(index.html sha256 {got[:16]}…)")
        return self

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def __exit__(self, *exc) -> None:
        self.stop()


# ── Capture ──────────────────────────────────────────────────────────────────────────
def _install_routes(page, span: int, flags: dict) -> None:
    payload = _auth_payload(flags)
    fixture = _fixture(span)

    def handle(route, request):
        url = request.url
        if "/api/auth/me" in url or "/api/auth/login" in url:
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps(payload))
        if "/api/breadth-monitor/series" in url:
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps(fixture))
        if "/api/breadth-monitor" in url:
            # V1's shape: one row per session with the metrics as columns. Same numbers
            # as the /series fixture, so a flag-off shot and a flag-on shot are drawing
            # the SAME data and any difference between them is the product, not the feed.
            dates = _dates_of(fixture)
            rows = [{"date": d, **{k: v[i] for k, v in fixture["series"].items()}}
                    for i, d in enumerate(dates)]
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"rows": rows}))
        if "/api/" in url:
            # ⛔ Everything else answers EMPTY rather than passing through. A shot that
            # silently reached the real internet is not deterministic.
            return route.fulfill(status=200, content_type="application/json", body="{}")
        return route.continue_()

    page.route("**/*", handle)


def _open_data_charts(page) -> None:
    """Click through to the Data Charts tab.

    ⛔⛔ `?tab=charts` DOES NOT WORK, AND THAT IS A FINDING, NOT A HARNESS DETAIL.
    `Breadth.jsx:562` seeds `activeTab` from the VIEWPORT — `overview` at ≤640px,
    `breadth` (Monitor) otherwise — and never reads a `tab` query param. The V2-1
    roadmap row lists "`?tab=charts`" as delivered scope; it is not delivered, which
    `00-profile.md` had already marked "❓ not seen" and this run confirms from a real
    browser. Recorded in the spec; there is no deep link to the surface today.

    ⭐ CLICK, NEVER NAVIGATE — the same rule the post-deploy smoke learned the hard
    way: a full load rebuilds the world and hides in-app transition defects.
    """
    tab = page.get_by_role("button", name="Data Charts", exact=True)
    tab.first.click(timeout=10000)
    page.wait_for_timeout(400)


def _assert_landed(page, case: str, flags: dict) -> None:
    """⛔⛔ REFUSE TO PHOTOGRAPH A PAGE WE DID NOT REACH.

    The first run of this harness saved sixteen screenshots of "Verify your email" and
    exited 0. Every individual step had worked; nothing had a reason to complain. A
    capture that cannot fail is not evidence, it is decoration — so the landing is
    asserted, and asserted AGAINST THE FLAG STATE, which makes each shot double as proof
    that the runtime gate behaves in a real browser rather than only in jsdom.

    ⛔ It asserts the SHOWN element, not merely a present one: `hidden`, `display:none`
    and a zero box all mean the member cannot see it.
    """
    expect_v2 = flags["breadth_dc_v2_2_enabled"] or flags["breadth_dc_v2_3_enabled"]
    shown = page.evaluate(
        """() => {
            const vis = el => {
                if (!el) return false
                if (el.hidden) return false
                const s = getComputedStyle(el)
                if (s.display === 'none' || s.visibility === 'hidden') return false
                const r = el.getBoundingClientRect()
                return r.width > 0 && r.height > 0
            }
            const v2 = document.querySelector('[data-testid="breadth-charts-v2"]')
            // V1 draws with ECharts, which mounts a <canvas>.
            const v1 = document.querySelector('main canvas, #root canvas')
            return { v2: vis(v2), v1: vis(v1),
                     text: (document.body.innerText || '').slice(0, 300) }
        }"""
    )
    want, got = ("V2 shell" if expect_v2 else "V1 chart"), shown
    ok = shown["v2"] if expect_v2 else shown["v1"]
    if not ok:
        raise RuntimeError(
            f"{case}: expected the {want} to be SHOWN and it is not "
            f"(v2={shown['v2']} v1={shown['v1']}).\n"
            f"  what is actually on screen: {got['text']!r}\n"
            "  Refusing to save this shot — a screenshot of the wrong page is worse "
            "than no screenshot, because it looks like evidence."
        )
    # ⭐ And the other one must be ABSENT: the gate swaps the tree, it does not stack.
    other = shown["v1"] if expect_v2 else shown["v2"]
    if other:
        raise RuntimeError(f"{case}: both V1 and V2 are on screen — the gate is "
                           f"rendering both branches, not choosing one")


def _dates_of(fixture: dict) -> list[str]:
    import datetime as dt
    end = dt.date.fromisoformat(fixture["to"])
    n = fixture["sessions"]
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= dt.timedelta(days=1)
    out.reverse()
    return out


def capture(into: pathlib.Path) -> dict:
    from playwright.sync_api import sync_playwright
    # ⭐ ONE AUTHORITY for dismissing the intro — see the call site.
    sys.path.insert(0, str(REPO))
    from tools.mobile_audit import _dismiss_intro  # noqa: PLC0415

    into.mkdir(parents=True, exist_ok=True)
    (into / "dom").mkdir(exist_ok=True)
    manifest: dict = {"frozen_at": FROZEN_ISO, "cases": {}}

    with Preview() as prev, sync_playwright() as p:
        browser = p.chromium.launch()
        for flag_name, flags in FLAG_STATES.items():
            for span_name, span in SPANS.items():
                for vp_name, (w, h) in VIEWPORTS.items():
                    case = f"{flag_name}__{span_name}__{vp_name}"
                    ctx = browser.new_context(viewport={"width": w, "height": h},
                                              device_scale_factor=1,
                                              reduced_motion="reduce")
                    page = ctx.new_page()
                    # ⛔ FREEZE THE CLOCK BEFORE THE FIRST SCRIPT RUNS.
                    page.clock.install(time=FROZEN_ISO)
                    _install_routes(page, span, flags)
                    t0 = time.time()
                    page.goto(prev.base + "/breadth?tab=charts", wait_until="networkidle")
                    # ⛔ The cinematic intro plays on EVERY page load and would otherwise
                    # BE the screenshot. Reusing `mobile_audit._dismiss_intro` rather than
                    # writing a second one: that function carries a recorded incident
                    # (the reduced-motion branch has no Skip button, so the obvious
                    # implementation fails silently) and a second copy would drift.
                    _dismiss_intro(page)
                    _open_data_charts(page)
                    # Settle: the gate lands when /api/auth/me resolves, so the tree can
                    # swap from V1 to V2 AFTER first paint.
                    page.wait_for_timeout(600)
                    _assert_landed(page, case, flags)
                    elapsed_ms = int((time.time() - t0) * 1000)

                    png = into / f"{case}.png"
                    page.screenshot(path=str(png), full_page=False)
                    dom = page.evaluate(
                        "() => (document.querySelector('[data-testid=\"breadth-charts-v2\"]')"
                        " || document.querySelector('main') || document.body).outerHTML")
                    (into / "dom" / f"{case}.html").write_text(dom, encoding="utf-8",
                                                              newline="")
                    manifest["cases"][case] = {
                        "png_sha256": _sha(png.read_bytes()),
                        "dom_sha256": _sha(dom.encode("utf-8")),
                        "load_ms": elapsed_ms,
                        "viewport": [w, h],
                        "span_sessions": span,
                        "flags": flags,
                    }
                    print(f"[shot] {case}  {elapsed_ms} ms")
                    ctx.close()
        browser.close()

    (into / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n",
                                        encoding="utf-8", newline="")
    return manifest


# ── Compare ──────────────────────────────────────────────────────────────────────────
def pixel_diff(a: pathlib.Path, b: pathlib.Path) -> int:
    """Number of differing pixels. ⛔ Not a boolean: "how different" is the fact a
    reviewer needs, and a boolean cannot tell a re-render from a redesign."""
    from PIL import Image, ImageChops
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if ia.size != ib.size:
        return -1
    raw = ImageChops.difference(ia, ib).tobytes()
    # Three bytes per pixel; a pixel differs if ANY channel does.
    return sum(1 for i in range(0, len(raw), 3) if raw[i] or raw[i + 1] or raw[i + 2])


def check(shots: pathlib.Path, goldens: pathlib.Path) -> int:
    """Compare shots to goldens, and SAY WHICH KIND of difference each one is.

    ⛔⛔ THE FLAG-OFF SHOTS CARRY AN INVARIANT THE OTHERS DO NOT. `off__*` is V1 — the
    shipped product every member sees today — and it must not move by one pixel while
    V2-2 and V2-3 are built behind a dark flag. A change there is a REGRESSION and the
    exit code says so.

    ⭐ A change in `v22__*`/`v23__*`/`both__*` is the increments being BUILT: expected,
    reviewable, and not a failure. Reporting both as one red is how a rail gets muted
    inside a week (`lesson_a_guard_that_tests_the_adjacent_thing`) — a checker that
    cries wolf on the intended change trains everyone to pass `--update-goldens`
    without looking, which is precisely how a real V1 regression would then slip
    through.
    """
    if not goldens.is_dir():
        sys.exit(f"no goldens at {goldens} — capture and review them first, then "
                 f"--update-goldens")
    regressions, expected = [], []
    for png in sorted(shots.glob("*.png")):
        g = goldens / png.name
        bucket = regressions if png.name.startswith("off__") else expected
        if not g.is_file():
            bucket.append(f"{png.name}: NEW, no golden")
            continue
        d = pixel_diff(png, g)
        if d == -1:
            bucket.append(f"{png.name}: SIZE changed")
        elif d:
            bucket.append(f"{png.name}: {d} px differ")
    for g in sorted(goldens.glob("*.png")):
        if not (shots / g.name).is_file():
            regressions.append(f"{g.name}: golden has no shot — a case disappeared")

    if expected:
        print("EXPECTED (the dark increments changing — review, then --update-goldens):")
        for b in expected:
            print("  " + b)
    if regressions:
        print()
        print("⛔ REGRESSION — the flag-OFF surface is what members see TODAY:")
        for b in regressions:
            print("  " + b)
        return 1
    if not expected:
        print(f"all {len(list(goldens.glob('*.png')))} shots match their goldens")
    else:
        print("\nflag-OFF surface unchanged — V1 is intact")
    return 0


def self_check() -> int:
    """⛔ PROVE THE DIFFER CAN FAIL. A comparison nobody has seen go red is not a rail —
    and a 1-pixel change is the smallest real regression, so that is the control."""
    from PIL import Image
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        t = pathlib.Path(td)
        a, b = t / "a.png", t / "b.png"
        img = Image.new("RGB", (40, 30), (12, 34, 56))
        img.save(a)
        img2 = img.copy()
        img2.putpixel((20, 15), (12, 34, 57))   # ONE pixel, ONE channel, by ONE
        img2.save(b)

        one = pixel_diff(a, b)
        same = pixel_diff(a, a)
        resized = t / "c.png"
        Image.new("RGB", (41, 30), (12, 34, 56)).save(resized)
        sized = pixel_diff(a, resized)

    ok = (one == 1 and same == 0 and sized == -1)
    print(f"  identical images        -> {same} px      (want 0)")
    print(f"  ONE pixel, ONE channel  -> {one} px      (want 1)")
    print(f"  different size          -> {sized}       (want -1)")
    print("SELF-CHECK PASS" if ok else "SELF-CHECK FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--capture", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--update-goldens", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()

    if a.self_check:
        return self_check()
    if a.capture or a.check or a.update_goldens:
        m = capture(OUT)
        slow = {k: v["load_ms"] for k, v in m["cases"].items() if v["load_ms"] > 8000}
        if slow:
            print("⚠️ PERF: cases over 8 s to settle (recorded, not yet a gate — the "
                  "threshold must be derived before it can refuse):")
            for k, v in slow.items():
                print(f"    {k}: {v} ms")
        if a.update_goldens:
            GOLDEN.mkdir(parents=True, exist_ok=True)
            for f in list(OUT.glob("*.png")) + [OUT / "manifest.json"]:
                (GOLDEN / f.name).write_bytes(f.read_bytes())
            print(f"goldens updated from {OUT} — REVIEW THE DIFF BEFORE COMMITTING")
            return 0
        if a.check:
            return check(OUT, GOLDEN)
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
