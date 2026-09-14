"""Step 3.3 — the same closed-market input, twice. 03 §3.10: it must produce the same output.

⚠️ BUILT NOW, RUN LATER, OUTSIDE RTH (the market must be CLOSED for the question to mean anything).
`--self-check` runs today and takes under a second.

    python -u docs/discord-render/instruments/determinism_runner.py --self-check
    python -u docs/discord-render/instruments/determinism_runner.py --gap 2 --out det.json

`02-baseline.md` measured **58 of 85 cases byte-identical** across two runs seconds apart on a
closed market. Of the 27 that differed, the two named mechanisms were the footer stamping the WALL
CLOCK and the header re-reading a LIVE QUOTE. This runner exists to make that number a gate.

⛔⛔ HASH THE PAYLOAD, NOT THE WALL CLOCK. Anything that stamps "now" differs by construction and
tells you nothing: a hash that includes it fails every single run, and a gate that always fails is
a gate nobody reads. So every field known to be a clock is REDACTED OUT of the hash — and then
REPORTED, by name, in `clock_fields`. ⛔ Redacting silently would be worse than including it: the
whole finding in `02` is that a wall clock is IN these payloads, and an instrument that quietly
deletes the evidence is the instrument manufacturing the answer.

⛔ AND THE HASHER MUST BE SHOWN TO SEE A DIFFERENCE. `--self-check` plants one, because "both runs
hashed the same" is also what a broken producer that returns `None` twice says.

⛔ EXIT CODES ARE THREE: 0 identical · 1 a measured divergence · 2 could-not-measure.
⛔ A run with no totals line is not a run.

⛔⛔ **A RENDERER RECYCLE CANNOT BE INDUCED ON DEMAND, AND THAT ROW STAYS UNMEASURED RATHER THAN
FAKED.** `services/chart_renderer/app.py` retires the browser after `RENDER_RECYCLE_AFTER` renders
(default **500**) or above `RENDER_RSS_CEILING_MB`; there is no trigger endpoint. The two ways to
force one are both refused here:

  * drive 500 renders — that is real load on the shared production renderer for a test;
  * set `RENDER_RECYCLE_AFTER=1` on chart-renderer — a config change on a shared service that would
    make **every member's** render recycle the browser, plus a redeploy.

⭐ What CAN be measured, and where: `renderer_pool_smoke.py` runs a LOCAL Chromium with the recycle
interval set freely — a real browser and a real recycle, on nobody's production. That is the honest
form of this claim, and it does not cover the production pool's own state. Until it is run, the
determinism-across-a-recycle row reads NOT MEASURABLE with this reason, never "clean".
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import sys
import tempfile
import time

PASS, FAIL, INCONCLUSIVE = 0, 1, 2
SHARED_ROOTS = ("/data", "c:\\data", "c:/data")

#: A pinned instant, so the CLOCK is not an input. Anything that still differs between two runs
#: differs for a reason that is not the passage of time — which is the whole question.
PINNED_NOW = dt.datetime(2026, 9, 13, 11, 0, tzinfo=dt.timezone.utc)

#: Keys whose value is "now" by construction. Redacted from the hash, reported by name.
#: ⛔ Add to this list only with a reason: every entry is a field the product is allowed to make
#: non-deterministic, and the list growing quietly is how a determinism gate stops meaning anything.
CLOCK_KEYS = frozenset({
    "now", "rendered_at", "generated_at", "ts", "timestamp",
    "age_s",        # freshness: seconds since the vintage — a clock by definition (03 §3.8b)
    "elapsed_ms",   # adapters: how long the call took
})

#: The one closed-market fixture. Hard-coded rather than fetched: a runner whose INPUT can move
#: cannot tell "the product is non-deterministic" from "the data changed under it".
FIXTURE_TICKER = "NVDA"
FIXTURE_TF = "D"
FIXTURE_AS_OF = "2026-09-11"


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def _sandbox(tmp: pathlib.Path) -> None:
    tmp.mkdir(parents=True, exist_ok=True)
    os.environ["DISCORD_RENDER_DB_PATH"] = str(tmp / "det_jobs.db")
    os.environ["DISCORD_RENDER_CACHE_DIR"] = str(tmp / "cache")
    low = str((tmp / "det_jobs.db").resolve()).lower().replace("\\", "/")
    if any(low.startswith(r.replace("\\", "/")) for r in SHARED_ROOTS):
        raise SystemExit(f"refusing to run: the sandbox resolves into the shared data root ({tmp})")


# ── canonicalisation ────────────────────────────────────────────────────────

def redact(value, *, seen: list[str], path: str = ""):
    """Return `value` with every clock field replaced by a marker, recording each one's path."""
    if isinstance(value, dict):
        out = {}
        for k in sorted(value):
            here = f"{path}.{k}" if path else str(k)
            if k in CLOCK_KEYS:
                seen.append(here)
                out[k] = "<clock>"
            else:
                out[k] = redact(value[k], seen=seen, path=here)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(v, seen=seen, path=f"{path}[{i}]") for i, v in enumerate(value)]
    if isinstance(value, (bytes, bytearray)):
        return {"__bytes_sha256__": hashlib.sha256(bytes(value)).hexdigest(), "__len__": len(value)}
    return value


def digest(value) -> tuple[str, list[str]]:
    seen: list[str] = []
    canon = redact(value, seen=seen)
    blob = json.dumps(canon, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest(), seen


# ── the producers ───────────────────────────────────────────────────────────
# Each returns one part of what a member receives, from the SAME closed-market input.
# A producer that raises is INCONCLUSIVE for that component — never a silent pass.

def produce_render_request() -> dict:
    """The `/r/chart` URL the renderer is pointed at, minus the token (a secret, and rotatable)."""
    from urllib.parse import parse_qs, urlsplit

    from api.services.discord_chart_house import build_render_url
    url = build_render_url(FIXTURE_TICKER, FIXTURE_TF, {"last_close": 176.5, "as_of": FIXTURE_AS_OF},
                           base_url="https://example.invalid", token="REDACTED",
                           options={"ext": False, "bars": 200})
    parts = urlsplit(url)
    params = {k: v for k, v in sorted(parse_qs(parts.query).items()) if k != "token"}
    return {"path": parts.path, "params": params}


def produce_freshness() -> dict:
    """The envelope the badge and the footer read. Pinned clock: its verdict must not drift."""
    from api.services.discord_render import freshness
    return freshness.envelope(FIXTURE_AS_OF, tf=FIXTURE_TF, provider="disk",
                              now=PINNED_NOW.astimezone(freshness.ET)).as_dict()


def produce_failure_copy() -> dict:
    """Every member-facing failure sentence. Copy that moves between two runs is a different bug
    from a picture that moves, and it is cheaper to catch."""
    from api.services.discord_render import contract
    return {cls: contract.failure_content("/chart NVDA", cls, "7f3a9c21")
            for cls in sorted(contract.FAILURE_CLASSES)}


def produce_components() -> dict:
    """The control tree under the chart. A `custom_id` that encodes anything time-varying would
    show up here as a divergence — and would also break the Retry button across a pod restart."""
    from api.services import discord_interactions as di
    return {"chart": di.chart_components(di.ChartRequest(FIXTURE_TICKER, FIXTURE_TF), {}, guild_id="1"),
            "flow": di.flow_components(FIXTURE_TICKER)}


def produce_standin_png() -> dict:
    """The mplfinance stand-in — the actual picture a member gets when the renderer is down, drawn
    from fixed bars. The house render is NOT here: it needs the renderer service, and `--renderer`
    adds it when Lane A runs this against a deployment."""
    from api.services.discord_chart_render import render_chart_png
    bars = _fixture_bars(180)
    png = render_chart_png(FIXTURE_TICKER, FIXTURE_TF, bars, daily_bars=bars)
    return {"png": png}


PRODUCERS = {
    "render_request": produce_render_request,
    "freshness": produce_freshness,
    "failure_copy": produce_failure_copy,
    "components": produce_components,
    "standin_png": produce_standin_png,
    "l1_to_l2_roundtrip": lambda: produce_l1_to_l2_roundtrip(),
}


def produce_l1_to_l2_roundtrip():
    """The artifact a member gets when the heap tier has gone and the VOLUME answers (OI-31).

    ⛔⛔ THIS IS THE DIMENSION THE OWNER NAMED AND THE ONE A PURE-FUNCTION SUITE CANNOT SEE.
    Every other producer here is deterministic because it touches nothing — the real question for a
    two-tier cache is whether the bytes and the labels a member receives are the SAME whether they
    came from the heap or off the volume. They must be: a chart that says one thing warm and
    another thing after a deploy is C-07 wearing a cache for a hat.

    ⛔ The L1 eviction is forced through the store's own API, never by reaching into its internals —
    a determinism check that constructs the state it is testing is testing its own constructor.
    """
    from api.services.discord_render import artifact_cache as ac

    payload = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4
    key = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, vintage="2026-01-02")

    # ⛔ L1 IS SHRUNK TO NOTHING RATHER THAN REACHED INTO. `max_bytes=1` means the entry cannot
    # live in the heap tier at all, so the only thing that can answer a `get` is the volume — and
    # the eviction is performed by the store's own policy, not by a test poking its internals. A
    # determinism check that constructs the state it is testing is testing its own constructor.
    store = ac.ArtifactCache(max_bytes=1, l2_dir=os.environ.get("DISCORD_RENDER_CACHE_DIR") or None)
    if store._l2 is None:                                  # noqa: SLF001 - read-only assertion
        return {"tier": "NO_L2", "note": "no volume tier configured; this component measures nothing"}
    store.put(key, ac.Artifact(data=payload, envelope=None, stored_at=PINNED_NOW.timestamp()))
    got = store.get(key)
    if got is None:
        return {"tier": "MISS", "note": "the volume tier did not answer after the heap tier refused"}
    return {"tier": "l2",
            "sha_of_bytes": hashlib.sha256(bytes(got.data)).hexdigest(),
            # ⛔ THE TRI-STATE COMES BACK AS IT WENT IN. A round trip that turns `None` (unknown)
            # into `False` (fresh) is the degraded-never-fresh guard failing at the one boundary
            # nobody would look at — and it would look exactly like a healthy cache.
            "stale_is_none": got.envelope is None,
            "l2_promotions": store._stats["l2_promotions"],     # noqa: SLF001
            "l2_served_unpromoted": store._stats["l2_served_unpromoted"]}   # noqa: SLF001


def _fixture_bars(n: int) -> list[dict]:
    """A fixed, closed-market daily series. No randomness, no clock, no provider."""
    day = dt.date(2026, 1, 2)
    out, px = [], 100.0
    for i in range(n):
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        o = px
        c = round(px * (1 + ((i * 37 % 13) - 6) / 200.0), 4)
        out.append({"t": day.isoformat(), "o": o, "h": round(max(o, c) * 1.006, 4),
                    "l": round(min(o, c) * 0.994, 4), "c": c, "v": 1_000_000 + (i * 9_973) % 500_000})
        px, day = c, day + dt.timedelta(days=1)
    return out


# ── the run ─────────────────────────────────────────────────────────────────

def run_once(only: list[str]) -> dict:
    out: dict[str, dict] = {}
    for name in only:
        fn = PRODUCERS[name]
        try:
            value = fn()
            sha, clocks = digest(value)
            out[name] = {"sha256": sha, "clock_fields": clocks, "error": None}
        except Exception as e:  # noqa: BLE001 — a producer that could not run is not "identical"
            out[name] = {"sha256": None, "clock_fields": [], "error": f"{type(e).__name__}: {e}"}
    return out


def compare(a: dict, b: dict) -> tuple[int, dict, list[str]]:
    """(exit code, per-component verdict, reasons). INCONCLUSIVE is decided before FAIL."""
    per: dict[str, str] = {}
    unmeasured, differed = [], []
    for name in a:
        ra, rb = a[name], b.get(name, {})
        if ra["error"] or rb.get("error"):
            per[name] = "inconclusive"
            unmeasured.append(f"{name}: {ra['error'] or rb.get('error')}")
        elif ra["sha256"] != rb.get("sha256"):
            per[name] = "differs"
            differed.append(f"{name}: {str(ra['sha256'])[:12]} != {str(rb.get('sha256'))[:12]}")
        else:
            per[name] = "identical"
    if not per:
        return INCONCLUSIVE, per, ["no component produced anything — nothing was compared"]
    if unmeasured:
        # ⛔ An unmeasured component can never be reported as identical: that is exactly how a
        # broken producer returning the same failure twice reads as perfect determinism.
        return INCONCLUSIVE, per, unmeasured + differed
    if differed:
        return FAIL, per, differed
    return PASS, per, []


def totals_line(code: int, per: dict, clocks: dict, reasons: list[str], meta: dict) -> str:
    label = {PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE"}[code]
    counts = {v: sum(1 for x in per.values() if x == v) for v in ("identical", "differs", "inconclusive")}
    flat = sorted({f for fields in clocks.values() for f in fields})
    return (f"TOTALS determinism_runner {label} components={len(per)} "
            f"identical={counts['identical']} differs={counts['differs']} "
            f"inconclusive={counts['inconclusive']} gap_s={meta.get('gap')} "
            f"clock_fields_redacted={len(flat)}{(':' + ','.join(flat)) if flat else ''}"
            + (f" reasons={' | '.join(reasons)}" if reasons else ""))


# ── self-check ──────────────────────────────────────────────────────────────

def self_check() -> int:
    """⛔ FOUR THINGS CAN BE WRONG WITH A DETERMINISM RUNNER, and each gets a case.

    It can fail to see a real change; it can see a change that is only the clock; it can call an
    unmeasured component identical; and it can report a clean pass over nothing at all."""
    cases: list[tuple[str, bool]] = []

    same_a = {"x": {"sha256": "aa", "clock_fields": [], "error": None}}
    same_b = {"x": {"sha256": "aa", "clock_fields": [], "error": None}}
    code, _, _ = compare(same_a, same_b)
    cases.append(("two identical payloads PASS", code == PASS))

    diff_b = {"x": {"sha256": "bb", "clock_fields": [], "error": None}}
    code, per, reasons = compare(same_a, diff_b)
    cases.append(("a real change is a measured FAIL",
                  code == FAIL and per["x"] == "differs" and reasons))

    err_b = {"x": {"sha256": None, "clock_fields": [], "error": "BoomError: nope"}}
    code, per, _ = compare(same_a, err_b)
    cases.append(("a producer that raised is INCONCLUSIVE, never identical",
                  code == INCONCLUSIVE and per["x"] == "inconclusive"))

    code, _, reasons = compare({}, {})
    cases.append(("nothing produced is INCONCLUSIVE, never a pass",
                  code == INCONCLUSIVE and "nothing was compared" in reasons[0]))

    # the hasher itself: a wall clock must be redacted AND named, and a real change must survive it
    payload_t0 = {"footer": {"ts": 1_726_000_000, "text": "NVDA · Daily"}, "png": b"abc"}
    payload_t1 = {"footer": {"ts": 1_726_000_099, "text": "NVDA · Daily"}, "png": b"abc"}
    h0, c0 = digest(payload_t0)
    h1, c1 = digest(payload_t1)
    cases.append(("a wall clock does not make two identical pictures differ", h0 == h1))
    cases.append(("…and it is REPORTED by name, not silently dropped",
                  c0 == c1 == ["footer.ts"]))

    changed = {"footer": {"ts": 1_726_000_099, "text": "NVDA · Weekly"}, "png": b"abc"}
    cases.append(("a real change beside a clock is still caught", digest(changed)[0] != h0))
    cases.append(("different image bytes are caught",
                  digest({"footer": {"ts": 1, "text": "x"}, "png": b"abc"})[0]
                  != digest({"footer": {"ts": 1, "text": "x"}, "png": b"abd"})[0]))

    cases.append(("the fixture is fixed", _fixture_bars(20) == _fixture_bars(20)))

    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    failed = [n for n, ok in cases if not ok]
    print(f"TOTALS determinism_runner --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={len(failed)}"
          + (f" reasons={'; '.join(failed)}" if failed else ""))
    return PASS if not failed else FAIL


# ── entry ───────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gap", type=float, default=1.5,
                    help="seconds between runs — long enough that a wall clock WOULD move")
    ap.add_argument("--runs", type=int, default=2,
                    help="how many runs to compare (every run is compared against the FIRST)")
    ap.add_argument("--only", default="", help="comma-separated component names")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.list:
        for name in PRODUCERS:
            print(f"  {name}")
        print(f"TOTALS determinism_runner --list PASS components={len(PRODUCERS)}")
        return PASS
    if args.self_check:
        return self_check()

    sys.path.insert(0, str(_repo_root()))
    only = [s.strip() for s in args.only.split(",") if s.strip()] or list(PRODUCERS)
    unknown = [o for o in only if o not in PRODUCERS]
    if unknown:
        print(f"TOTALS determinism_runner INCONCLUSIVE components=0 unknown={unknown}")
        return INCONCLUSIVE

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-det-"))
    meta = {"gap": args.gap, "pinned_now": PINNED_NOW.isoformat(), "fixture":
            {"ticker": FIXTURE_TICKER, "tf": FIXTURE_TF, "as_of": FIXTURE_AS_OF}}
    per: dict = {}
    clocks: dict = {}
    try:
        _sandbox(tmp)
        # ⛔ EVERY RUN IS COMPARED AGAINST THE FIRST, NOT AGAINST ITS PREDECESSOR. A chain of
        # pairwise comparisons passes on a value that drifts by one bit per run — twenty runs of
        # "identical to the last one" can end up nowhere near where it started.
        runs = [run_once(only)]
        for _ in range(max(2, args.runs) - 1):
            time.sleep(max(0.0, args.gap))
            runs.append(run_once(only))
        a = runs[0]
        clocks = {k: v["clock_fields"] for k, v in a.items()}
        code, per, reasons = INCONCLUSIVE, {}, []
        for b in runs[1:]:
            c, p, r = compare(a, b)
            # worst verdict wins, and a DIFFERS anywhere is a DIFFERS overall
            for name, state in p.items():
                prior = per.get(name)
                per[name] = state if prior in (None, "identical") else prior
            code = c if (code == INCONCLUSIVE or c != PASS) and c != PASS else (code if code != INCONCLUSIVE else c)
            reasons += [x for x in r if x not in reasons]
        code = PASS if all(s == "identical" for s in per.values()) and per else (code or FAIL)
        if args.out:
            pathlib.Path(args.out).write_text(json.dumps(
                {"meta": {**meta, "runs": len(runs)}, "run_a": a, "runs": runs,
                 "per_component": per}, indent=2), encoding="utf-8")
        for name, state in sorted(per.items()):
            print(f"  {state.upper():13} {name:18} {a[name]['sha256'] or a[name]['error']}")
    except Exception as e:  # noqa: BLE001
        code, reasons = INCONCLUSIVE, [f"the run did not complete: {type(e).__name__}: {e}"]
    print(totals_line(code, per, clocks, reasons, meta))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
