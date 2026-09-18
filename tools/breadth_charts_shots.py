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
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

# ⛔⛔ THE FAILURE PATH WAS THE UNTESTED PATH. This console is cp1252, and the REGRESSION
# header is the one line that carries a non-ASCII marker — so the tool crashed with a
# UnicodeEncodeError at exactly the moment it had something important to say, after
# printing the harmless "EXPECTED" section perfectly. A checker that dies on its own bad
# news reports "crash" where it meant "V1 moved".
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # a pipe that cannot be reconfigured
        pass

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

    # ⛔⛔ `dates` IS PART OF THE CONTRACT AND WAS MISSING FROM THE FIRST VERSION.
    # `docs/breadth/api-series.md:38-43`: the response carries `dates` ascending, each
    # date once, every `series` column the same length, and `sessions == len(dates)`.
    # `useBreadthSeries` reads `data.dates` and falls back to EMPTY — so the omission did
    # not throw. It produced a shell rendering against an empty x-axis, and the shots
    # looked fine. ⭐ A fixture that does not obey the contract it stands in for tests the
    # product against a shape the server never sends; `test_the_fixture_obeys_the_series_contract`
    # is the rail, and it is the reason this was caught before V2-2 drew against it.
    return {
        "from": dates[0],
        "to": dates[-1],
        "sessions": n,
        "dates": dates,
        "keys": FIXTURE_KEYS,
        "series": series,
        "reconstructed": reconstructed,
        "missing": [],
    }
    # ⛔⛔ `sampling` WAS NEVER IN THE CONTRACT. `docs/breadth/api-series.md`'s documented
    # response has no such field -- D-035 explicitly DEFERRED server-side downsampling
    # (30ms cold-read cost, 33x under the 1s trigger) and named PAYLOAD SIZE, not a
    # sampling flag, as the thing to watch if the decision is revisited. A fixture
    # carrying a field the real endpoint never sends tests the client against a shape
    # that will never arrive -- the same class of defect as the missing `dates` key,
    # just in the other direction (an EXTRA field instead of a missing one).


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



#: ⛔⛔ THE CAPTURED DOM IS NOT BYTE-STABLE UNTIL IT IS NORMALISED. Measured: only 4 of 16
#: captures matched across two full runs of the SAME build. The volatile parts are not
#: product facts — React's `useId` values, UIcon's gradient counter (which counts UP per
#: render), and ECharts' per-instance ids — and `flagOff.golden.test.jsx` already
#: normalises exactly these for exactly this reason. The same list is applied here rather
#: than a second, drifting one.
#:
#: ⛔ ONLY THESE, AND NOTHING ELSE. A normaliser that erases too much is a golden that
#: cannot fail — `test_the_dom_normaliser_keeps_the_product` is the rail on that.
_DOM_SUBS = (
    # ⛔ KEEPS THE ATTRIBUTE NAME, replaces only its VALUE. Written first through a
    # shell heredoc that ate the backreferences and collapsed the whole match to
    # `<ID>`, deleting `id=` itself. A normaliser that erases the attribute erases the
    # product, and every golden would then have matched every other golden -- the
    # cannot-fail shape, arrived at by a quoting accident rather than a decision.
    (re.compile(r'(\b(?:id|for|aria-controls|aria-labelledby|aria-describedby|name)=")[^"]*(")'),
     r"\1<ID>\2"),
    (re.compile(r"url\(#[^)]*\)"), "url(#<ID>)"),
    (re.compile(r"«[^»]*»"), "<ID>"),
    (re.compile(r'_echarts_instance_="[^"]*"'), '_echarts_instance_="<ID>"'),
    (re.compile(r'data-zr-dom-id="[^"]*"'), 'data-zr-dom-id="<ID>"'),
)


def normalise_dom(html: str) -> str:
    """Strip the non-product volatility from a captured DOM. See `_DOM_SUBS`."""
    for pattern, repl in _DOM_SUBS:
        html = pattern.sub(repl, html)
    return html


def _stable_screenshot(page, path: pathlib.Path, case: str,
                       tries: int = 8, settle_ms: int = 250) -> None:
    """Screenshot only once the page has stopped moving.

    ⛔⛔ THE HARNESS WAS NONDETERMINISTIC AND IT WAS CAUGHT BY ITS OWN CHECKER. Goldens
    were recorded and re-checked SECONDS later against the same tree and the same build:
    4 px at 1280 and 13 px at 380 on several cases. Nothing had changed — the page was
    simply still settling when the shutter opened.

    ⭐ THAT IS THE WORST KIND OF FLAKE, because it does not fail. It produces goldens
    that disagree by a handful of pixels on every run, and a checker that reds on every
    run is muted within a week — after which the V1 regression it exists to catch ships
    unnoticed. A rail that cries wolf is worse than no rail.

    So stability is ENFORCED, not assumed: shoot repeatedly until two CONSECUTIVE frames
    are byte-identical, and REFUSE if that never happens. `animations="disabled"` freezes
    CSS animations and transitions (the app plays a cinematic intro and the shell fades
    in); `caret="hide"` removes the blinking text caret, which is a real source of
    one-pixel churn.

    ⛔ It raises rather than saving the last frame. A shot that could not be stabilised is
    not evidence about the product — it is evidence about the harness, and saving it
    would launder one into the other.
    """
    prev = None
    for attempt in range(tries):
        page.wait_for_timeout(settle_ms)
        shot = page.screenshot(animations="disabled", caret="hide")
        if prev is not None and shot == prev:
            path.write_bytes(shot)
            return
        prev = shot
    raise RuntimeError(
        f"{case}: the page never stopped changing — {tries} frames, no two consecutive "
        f"frames identical. Refusing to record a golden that would flap on every run.")


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
            const v2el = document.querySelector('[data-testid="breadth-charts-v2"]')
            // ⛔⛔ "A CANVAS EXISTS" IS A PROXY FOR "V1 IS RENDERING", AND IT BROKE THE
            // DAY V2 STARTED DRAWING. Both render with ECharts, so both mount a
            // <canvas>; this check then reported "both branches on screen" for a gate
            // that was working perfectly. That is the kind-2 failure in this harness's
            // own instrument — the rule says read what you MEAN, so: a V1 canvas is one
            // that is NOT inside the V2 subtree.
            const canvases = [...document.querySelectorAll('#root canvas')]
            const v1el = canvases.find(c => !(v2el && v2el.contains(c))) || null
            return { v2: vis(v2el), v1: vis(v1el),
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
        # ⛔⛔ DETERMINISTIC TEXT RASTERISATION, OR THE GOLDENS FLAP.
        # Measured: re-checking goldens recorded SECONDS earlier from the same build
        # produced 4 px at 1280 and 13 px at 380. The diff was never layout — every
        # differing pixel was a grey level off by exactly ONE (17 vs 16, 27 vs 26) inside
        # a small text region. That is Chromium's font antialiasing, which varies per
        # launch unless it is pinned.
        #
        # ⭐ THE CAUSE IS FIXED RATHER THAN TOLERATED. A per-pixel tolerance would have
        # hidden it, and would also have blinded the differ to the one-pixel change its
        # own self-check exists to prove it can see. A rail you soften to stop it
        # complaining is a rail you have retired.
        browser = p.chromium.launch(args=[
            "--font-render-hinting=none",
            "--disable-lcd-text",
            "--disable-font-subpixel-positioning",
            "--force-color-profile=srgb",
            "--disable-skia-runtime-opts",
        ])
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
                    _stable_screenshot(page, png, case)
                    dom = page.evaluate(
                        "() => (document.querySelector('[data-testid=\"breadth-charts-v2\"]')"
                        " || document.querySelector('main') || document.body).outerHTML")
                    dom = normalise_dom(dom)
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
#: Grey levels of per-launch rasterisation noise to ignore. ⛔ MEASURED, NOT GUESSED.
#:
#: Goldens re-checked SECONDS after recording, same build, same tree, differed by 4 px at
#: 1280 and 13 px at 380. Every differing pixel was off by exactly ONE level on each
#: channel (17 vs 16, 27 vs 26, 33 vs 32). Cropping the disputed region identified it: the
#: Breadth TAB BAR's rounded gold pill, i.e. the antialiased edge of a rounded rect.
#: Chromium rasterises that marginally differently per launch and the usual determinism
#: flags (`--font-render-hinting=none`, `--disable-lcd-text`,
#: `--disable-font-subpixel-positioning`, `--force-color-profile=srgb`) did NOT remove it.
#:
#: ⭐ The alternative was worse. Left unbounded, every run reports a handful of differing
#: pixels, the checker is red on every run, and a rail that cries wolf is muted within a
#: week — after which the V1 regression it exists to catch ships unnoticed.
#:
#: ⛔ 1, AND NOT A PIXEL MORE. This must never grow to "make the check pass": a real
#: regression moves geometry or changes a colour materially, and `--self-check` proves a
#: TWO-level change on a single pixel is still caught.
ANTIALIAS_TOLERANCE = 1


def pixel_diff(a: pathlib.Path, b: pathlib.Path, tol: int = ANTIALIAS_TOLERANCE) -> int:
    """Pixels differing by MORE than `tol` on any channel.

    ⛔ Not a boolean: "how different" is the fact a reviewer needs, and a boolean cannot
    tell a re-render from a redesign. `-1` means the images are different sizes, which is
    a different kind of fact again and must not be counted as "some pixels".
    """
    from PIL import Image, ImageChops
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if ia.size != ib.size:
        return -1
    raw = ImageChops.difference(ia, ib).tobytes()
    # Three bytes per pixel; a pixel counts if ANY channel exceeds the tolerance.
    return sum(1 for i in range(0, len(raw), 3)
               if raw[i] > tol or raw[i + 1] > tol or raw[i + 2] > tol)


#: Run-to-run PNG noise on the SAME build, measured 2026-09-17 across several full runs:
#: `v22__max__1280` 32 px, `off__365__1280` 17 px, a few cases 13 or 4, most 0. Every
#: instance was the same shape — a narrow vertical strip over the y-axis LABEL column, or
#: a few pixels of the tab bar's rounded pill, rasterised at a different subpixel offset
#: per browser launch. Max channel delta 15; most were 1.
#:
#: ⚰️ I FIRST WROTE THAT THE FLAG-OFF CASES WERE "DETERMINISTIC AT ZERO" AND HELD THEM TO
#: ZERO. That was a conclusion from ONE sample in which they happened to come back clean;
#: the very next run moved `off__365__1280` by 17 px, twice. Two points do not establish a
#: rate, and one point does not establish determinism. The budget applies to EVERY case.
#:
#: ⛔ THIS IS A LABEL, NOT A LICENCE, and it is not what protects V1. Exactness lives in
#: the normalised DOM, which IS byte-stable (16/16 across two full runs, measured after it
#: was 4/16 un-normalised). Pixels decide "does this look different to a human"; bytes
#: decide "did the structure move". Raising this number to quiet a red is how the rail
#: dies — if pixels move past it, look at the crop before touching this.
PNG_NOISE_BUDGET = 64


def _dom_of(root: pathlib.Path, name: str) -> str | None:
    p = root / "dom" / (name[:-4] + ".html")
    return p.read_text(encoding="utf-8") if p.is_file() else None


def check(shots: pathlib.Path, goldens: pathlib.Path) -> int:
    """Compare shots to goldens, and SAY WHICH KIND of difference each one is.

    ⛔⛔ THE FLAG-OFF CASES CARRY AN INVARIANT THE OTHERS DO NOT. `off__*` is V1 — the
    shipped product every member sees today — and it must not move while V2-2 and V2-3
    are built behind a dark flag. It is held to an EXACT normalised DOM, and to the same
    measured pixel budget as everything else. A change there is a REGRESSION and the exit
    code says so.

    ⭐ A change in `v22__*`/`v23__*`/`both__*` is the increments being BUILT: expected,
    reviewable, not a failure. Reporting both as one red is how a rail gets muted inside a
    week — and a muted rail is how the V1 regression it exists to catch would then ship.

    ⭐ THE DOM IS THE PRECISE RAIL; THE PNG IS FOR HUMAN EYES. The captured DOM is
    normalised (React ids, UIcon gradient counter, ECharts instance ids) and is then
    byte-stable 16/16 across full runs — measured, after it was 4/16 without. Pixels
    cannot be made that stable here, so structure is judged by bytes and appearance by
    pixels, each where it is trustworthy.
    """
    if not goldens.is_dir():
        sys.exit(f"no goldens at {goldens} — capture and review them first, then "
                 f"--update-goldens")
    regressions, expected, noise = [], [], []
    for png in sorted(shots.glob("*.png")):
        g = goldens / png.name
        is_off = png.name.startswith("off__")
        bucket = regressions if is_off else expected
        if not g.is_file():
            bucket.append(f"{png.name}: NEW, no golden")
            continue

        d = pixel_diff(png, g)
        if d == -1:
            bucket.append(f"{png.name}: SIZE changed")
        elif d:
            # ⛔ The SAME budget for every case, flag-off included. See PNG_NOISE_BUDGET:
            # holding `off__*` to zero was a claim from a single clean sample and the next
            # run disproved it. The DOM comparison below is what keeps V1 exact.
            if d <= PNG_NOISE_BUDGET:
                noise.append(f"{png.name}: {d} px (within the measured noise floor)")
            else:
                bucket.append(f"{png.name}: {d} px differ")

        a, b = _dom_of(shots, png.name), _dom_of(goldens, png.name)
        if a is not None and b is not None and a != b:
            bucket.append(f"{png.name}: DOM changed (normalised)")

    for g in sorted(goldens.glob("*.png")):
        if not (shots / g.name).is_file():
            regressions.append(f"{g.name}: golden has no shot — a case disappeared")

    if noise:
        print("noise only (no product change):")
        for b in noise:
            print("  " + b)
    if expected:
        print("EXPECTED (the dark increments changing — review, then --update-goldens):")
        for b in expected:
            print("  " + b)
    if regressions:
        print()
        print("REGRESSION — the flag-OFF surface is what members see TODAY:")
        for b in regressions:
            print("  " + b)
        return 1
    if not expected:
        print(f"all {len(list(goldens.glob('*.png')))} shots match their goldens")
    else:
        print("\nflag-OFF surface unchanged — V1 is intact")
    return 0


def self_check() -> int:
    """⛔ PROVE THE DIFFER CAN FAIL, AND PROVE ITS TOLERANCE IS BOUNDED.

    A comparison nobody has seen go red is not a rail. And a tolerance nobody has seen
    REFUSE to absorb a change is just a blindfold with a comment — so this checks both
    directions: the antialias noise is absorbed, and one level past it is caught.
    """
    from PIL import Image
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        t = pathlib.Path(td)
        base = Image.new("RGB", (40, 30), (12, 34, 56))
        a = t / "a.png"; base.save(a)

        # every pixel off by exactly the tolerance -> absorbed
        noisy = Image.new("RGB", (40, 30),
                          (12 + ANTIALIAS_TOLERANCE, 34 + ANTIALIAS_TOLERANCE,
                           56 + ANTIALIAS_TOLERANCE))
        n = t / "noise.png"; noisy.save(n)

        # ONE pixel, ONE channel, ONE level PAST the tolerance -> caught
        m = base.copy()
        m.putpixel((20, 15), (12, 34, 56 + ANTIALIAS_TOLERANCE + 1))
        b = t / "b.png"; m.save(b)

        c = t / "c.png"; Image.new("RGB", (41, 30), (12, 34, 56)).save(c)

        same = pixel_diff(a, a)
        absorbed = pixel_diff(a, n)
        caught = pixel_diff(a, b)
        sized = pixel_diff(a, c)

    ok = (same == 0 and absorbed == 0 and caught == 1 and sized == -1)
    print(f"  identical images                  -> {same} px      (want 0)")
    print(f"  every pixel off by {ANTIALIAS_TOLERANCE} (the noise)   -> {absorbed} px      (want 0)")
    print(f"  ONE pixel, {ANTIALIAS_TOLERANCE + 1} levels (a real change) -> {caught} px      (want 1)")
    print(f"  different size                    -> {sized}       (want -1)")
    print("SELF-CHECK PASS" if ok else "SELF-CHECK FAIL")
    return 0 if ok else 1



# ── The LTTB threshold sweep (DC-2 §3.4) ─────────────────────────────────────────────
#: Point counts to sweep. Spans the range between "what the tab asks for today" (365) and
#: "everything stored" (~4,530), with enough intermediate steps to see WHERE the curve
#: bends rather than only that its ends differ.
MEASURE_SPANS = (365, 750, 1500, 2250, 3000, 3750, 4530)

#: Repeats per span. ⛔ One sample per span cannot separate a trend from a hiccup, and this
#: session has already published one conclusion drawn from a single clean run.
MEASURE_REPEATS = 3


def measure_render() -> int:
    """Time the V2 chart's first settled paint against point count, at the PHONE viewport.

    ⛔ THE PHONE IS THE MEASUREMENT THAT MATTERS. A desktop has the headroom to hide the
    problem, and the audit's own long-history item is about opening seventeen years of
    history to a reader who is most likely holding a phone. Measuring at 1280 and shipping
    a threshold for 380 would be a proxy — the failure kind this programme keeps finding.

    ⭐ It reports the MEDIAN of `MEASURE_REPEATS` runs per span, and the raw values beside
    it, so a reader can see the spread rather than trusting a single number.
    """
    from playwright.sync_api import sync_playwright
    sys.path.insert(0, str(REPO))
    from tools.mobile_audit import _dismiss_intro  # noqa: PLC0415

    w, h = VIEWPORTS["380"]
    flags = FLAG_STATES["both"]
    rows = []

    with Preview() as prev, sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--font-render-hinting=none", "--disable-lcd-text",
            "--disable-font-subpixel-positioning", "--force-color-profile=srgb",
            "--disable-skia-runtime-opts",
        ])
        for span in MEASURE_SPANS:
            samples = []
            for _ in range(MEASURE_REPEATS):
                ctx = browser.new_context(viewport={"width": w, "height": h},
                                          device_scale_factor=1, reduced_motion="reduce")
                page = ctx.new_page()
                page.clock.install(time=FROZEN_ISO)
                _install_routes(page, span, flags)
                page.goto(prev.base + "/breadth?tab=charts", wait_until="networkidle")
                _dismiss_intro(page)
                t0 = time.time()
                _open_data_charts(page)
                # Settle on the CHART, not on a timer: wait for the canvas the chart draws
                # into, then for two identical frames, which is the same definition of
                # "finished" the screenshots use.
                page.wait_for_selector('[data-testid="breadth-charts-v2"] canvas',
                                       timeout=30000)
                prev_frame = None
                for _ in range(40):
                    page.wait_for_timeout(100)
                    frame = page.screenshot(animations="disabled", caret="hide")
                    if prev_frame is not None and frame == prev_frame:
                        break
                    prev_frame = frame
                paint_ms = int((time.time() - t0) * 1000)

                # ⛔⛔ FIRST PAINT IS NOT USABILITY, AND A DISPATCH THAT NEVER LANDS IS
                # NOT A MEASUREMENT. This was first written as
                # `window.echarts.getInstanceByDom(el).dispatchAction({type:'dataZoom'})`.
                # `echarts-for-react` does NOT put echarts on `window`, so the instance
                # was never reached, the action never ran, and every "zoom_ms" printed was
                # the settle loop's own floor (~180-240 ms) — a confident number
                # describing nothing. Verified by capturing `reached` and comparing pixels,
                # which is the check that should have been there first.
                #
                # So: drive the wheel over the chart, which `dataZoom: {type:'inside'}`
                # handles, and REQUIRE the pixels to move. A zoom that changes nothing is
                # reported as a failure rather than as a fast zoom.
                # ⛔⛔ DEAD CENTER LANDS IN THE INTER-PANEL GAP, NOT ON A GRID.
                # `gridFor`'s defaults (top=6, bottom=14, gap=4) put a 4%-high gap between
                # the two panels the D-052 default produces, and with weights 1.25:1 that
                # gap sits at 48.2%-52.2% of the canvas -- straddling the 50% midpoint a
                # "click the center" probe reaches for. A wheel event there has no grid to
                # act on and nothing moves, which looked exactly like a broken zoom rather
                # than a badly-aimed one. Verified against 6 other heights before
                # concluding this, not assumed from one failure.
                box = page.locator('[data-testid="breadth-charts-v2"] canvas').bounding_box()
                before = page.screenshot(animations="disabled", caret="hide")
                t1 = time.time()
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.25)
                page.mouse.wheel(0, -600)
                zprev = None
                for _ in range(40):
                    page.wait_for_timeout(50)
                    zf = page.screenshot(animations="disabled", caret="hide")
                    if zprev is not None and zf == zprev:
                        break
                    zprev = zf
                zoom_ms = int((time.time() - t1) * 1000)
                after = page.screenshot(animations="disabled", caret="hide")
                if after == before:
                    raise RuntimeError(
                        f"{span} points: the wheel-zoom changed NOTHING on screen. "
                        "Refusing to report a settle time for an interaction that did not "
                        "happen — that is how the previous version of this measurement "
                        "produced numbers for a no-op.")

                samples.append((paint_ms, zoom_ms))
                ctx.close()
            paints = sorted(x[0] for x in samples)
            zooms = sorted(x[1] for x in samples)
            med_p, med_z = paints[len(paints) // 2], zooms[len(zooms) // 2]
            rows.append((span, med_p, med_z, paints, zooms))
            print(f"[measure] {span:5d} points   paint {med_p:5d} ms {paints}"
                  f"   zoom {med_z:5d} ms {zooms}")
        browser.close()

    print()
    print("span     paint_ms   zoom_ms")
    for span, med_p, med_z, _, _ in rows:
        print(f"{span:5d}    {med_p:7d}   {med_z:7d}")
    bp, bz = rows[0][1], rows[0][2]
    print()
    print(f"baseline at {rows[0][0]} points: paint {bp} ms, zoom {bz} ms")
    for span, med_p, med_z, _, _ in rows[1:]:
        print(f"  {span:5d} points: paint {med_p / bp:4.2f}x   zoom {med_z / bz:4.2f}x")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--capture", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--update-goldens", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--measure-render", action="store_true",
                    help="sweep point count vs settle time at the phone viewport")
    a = ap.parse_args()

    if a.self_check:
        return self_check()
    if a.measure_render:
        return measure_render()
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
            # ⛔ The DOM is the PRECISE rail — a golden set without it silently
            # degrades to pixels only, and `_dom_of` would return None on both
            # sides, which compares equal. A rail that passes by having nothing
            # to compare is the vacuity this repo keeps paying for.
            (GOLDEN / "dom").mkdir(exist_ok=True)
            for f in (OUT / "dom").glob("*.html"):
                (GOLDEN / "dom" / f.name).write_bytes(f.read_bytes())
            print(f"goldens updated from {OUT} — REVIEW THE DIFF BEFORE COMMITTING")
            return 0
        if a.check:
            return check(OUT, GOLDEN)
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
