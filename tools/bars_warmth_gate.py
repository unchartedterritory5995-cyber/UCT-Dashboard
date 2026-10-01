"""CARD 16's p95 gate — a runner that CANNOT be taken under invalid conditions.

⛔⛔ WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL. On 2026-09-26 the gate was taken
by hand: `tools/bars_warmth_audit.py` against production returned tf=D p95 **271 ms**
(over the bar) and tf=5 **82 ms**. Then `/api/health` was checked and answered **502**
— a deploy was mid-swap, so *"a pod ≥ 300 s old"* could not be established — and it
was a **Saturday**, so clause 2's RTH tier alarm was inapplicable and a cold weekend
cache is not representative of what a member waits for. **Real numbers, invalid
conditions.** The daily timeframe would have been recorded as a FAIL, and the only
thing that stopped it was checking the pod AFTERWARDS rather than before.

⭐ SO THE PRECONDITIONS ARE CHECKED FIRST AND THE RUN REFUSES, rather than measuring
and caveating. A caveat is a sentence somebody drops when they quote the number; a
refusal has no number to quote.

────────────────────────────────────────────────────────────────────────────────
THE GATE — `docs/terminal-research/10-roadmap/roadmap.md` §2.3 clause 2, verbatim:

    "A p95 prints for both timeframes on a pod >= 300 s old — CARD 16's replacement
    gate (p95 <= 250 ms per timeframe), with the tier mix reported BESIDE it and
    never as pass/fail, and the one tier alarm kept: any `fetch`/`miss` share above
    ~10 % on intraday during RTH."

THREE PRECONDITIONS, EACH WITH ITS OWN REFUSAL AND ITS OWN MESSAGE:

1. **Pod settled** — `/api/health` returns 200 AND `uptime_seconds >= 300`.
   ⚠️ Cloudflare 1010-blocks non-browser UAs, so a browser `User-Agent` is sent.
   ⛔ A 502 or any non-200 is a REFUSAL, not a retry loop. An UNREADABLE health
   endpoint is its own problem and is never laundered into a pod age.
2. **RTH** — weekday, inside the regular session, HALF-DAYS INCLUDED. ⛔ Derived
   from the product's own clock (see `SESSION_AUTHORITY`), never re-implemented.
3. **Both timeframes produce a computable p95.** ⛔ NOT COMPUTABLE is never a PASS
   and never a FAIL. That distinction is the entire reason `bars_warmth_audit.py`
   was fixed: it previously printed nothing on daily and the next line — the COLD
   p50/max — was read as the p95.

EXIT CODES — and collapsing any two is the defect this repo names most often:

    0  WITHIN        measured, and inside the bar on every timeframe.
    1  OVER          measured, and over the bar on at least one timeframe.
    2  INCONCLUSIVE  a precondition failed, or a p95 was not computable. NOT a pass
                     and NOT a product failure. "We could not compute it" and
                     "the product is slow" are different facts to whoever reads this.

⭐ Same three-code vocabulary as `tools/postdeploy_client_smoke.py`, deliberately.

────────────────────────────────────────────────────────────────────────────────
⛔ WHAT THIS FILE DOES NOT DO

* **It does not measure anything itself.** `tools/bars_warmth_audit.py` is the
  instrument and it is correct; this WRAPS it. The buckets (`WARM` /
  `STALE_SERVED` / `COLD`), the percentile helper (`pct_of`, whose arithmetic is
  pinned for continuity with numbers already in the record) and the per-symbol
  probe (`_serve_layer`) are all IMPORTED from it. A second copy of any of them
  would be a second authority over one value.
* **It does not let the tier mix decide.** `verdict()` takes ONLY the p95 per
  timeframe — the tier mix is not in its argument list, so "never as pass/fail" is
  a property of the signature rather than a promise in a comment.
* **It does not fall back to a hand-rolled market clock.** An undrivable authority
  is INCONCLUSIVE, never a silent 09:30-16:00 guess: that guess reads a 13:00 ET
  half-day as a full session, which is precisely the bug the product's own clock
  had until 2026-09-10.

Usage
-----
    python tools/bars_warmth_gate.py
    python tools/bars_warmth_gate.py --n 40 --tf D,5
    python tools/bars_warmth_gate.py --self-check    # prove every refusal can FIRE
"""
from __future__ import annotations
import os as _uct_os  # noqa: E402
import sys as _uct_sys  # noqa: E402
_uct_repo_root = _uct_os.path.dirname(_uct_os.path.dirname(_uct_os.path.abspath(__file__)))
if _uct_repo_root not in _uct_sys.path:
    _uct_sys.path.insert(0, _uct_repo_root)
import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import

import argparse
import math
import datetime as _dt
import importlib.util
import json
import pathlib
import sys
import urllib.request
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_HERE = pathlib.Path(__file__).resolve().parent
_ROOT = _HERE.parent

# ── CARD 16's bar and clause 2's floors. Each is quoted from the clause above. ──
#: CARD 16's replacement gate: p95 <= 250 ms per timeframe.
P95_BAR_MS = 250.0
#: Clause 2's "on a pod >= 300 s old".
POD_FLOOR_S = 300.0
#: Clause 2's "any fetch/miss share above ~10 % on intraday during RTH".
TIER_ALARM_SHARE = 0.10
#: The timeframes the tier alarm is about. ⛔ A MEMBERSHIP TEST, not `not in (D,W,M)`:
#: a timeframe added tomorrow must be named before it can arm an alarm.
INTRADAY_TFS = frozenset({"1", "5", "15", "30", "60"})
#: The two layers clause 2's alarm names. They are a SUBSET of the audit's COLD set —
#: `inflight-wait`, `disk` and `unknown` are also waits, and the clause does not name
#: them. Asserted against the audit's own set by the rail rather than assumed.
ALARM_LAYERS = frozenset({"fetch", "miss"})

#: ⛔ THREE NAMED CODES, so collapsing two of them is a VISIBLE EDIT to this block
#: rather than a `return 1` somewhere in a branch.
#: The fewest no-wait samples over which a p95 is not simply the maximum:
#: 5% of n must be at least one sample. DERIVED from the quantile, never typed.
#: ⚰️ 2026-09-30 RTH: the gate exited 0 WITHIN on no-wait n = 2 (D) and n = 1 (5)
#: -- a "p95" of two samples is their larger one. It refused an EMPTY set only.
P95_Q = 0.95
MIN_NOWAIT_N = math.ceil(1.0 / (1.0 - P95_Q) - 1e-9)

EXIT_WITHIN = 0
EXIT_OVER = 1
EXIT_INCONCLUSIVE = 2

#: The product's own RTH predicate. It returns `None` INSIDE the regular session of a
#: trading day and `"closed"` otherwise; both ends are derived (the open from
#: `bars_fetch.bucket_60_et_unix_seconds`, the close from the day's OWN length), and
#: the trading-day test reads `api.services.nyse_calendar` — the dependency-free leaf
#: that owns the NYSE full-closure and 13:00 ET half-day sets, and the only authority
#: over those dates in this repo.
#:
#: ⚠️ WHY THIS ONE. There are at least four other "is the market open" functions in
#: `api/**` — `bars_fetch._is_market_open`, `bars_liveness.is_market_open`,
#: `main._is_rth_now`, `confluence_flow._is_rth` — and NONE of them is half-day aware:
#: every one hard-codes a 16:00 close and would report the market open until 16:00 on
#: 2026-11-27 and 2026-12-24. `_live_session_state` is the only Python function that
#: gets weekend, full closure and half-day right in one answer.
SESSION_AUTHORITY = "api.services.screener.scan_evaluator._live_session_state"

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

#: The claim a dying run leaves behind. ⛔ IT IS A PREFIX MATCH FOR READERS: a run
#: that dies mid-flight must leave an explicit INCOMPLETE, because a previous run's
#: file left on disk reads exactly like a current pass (Phase 2 device run 2, whose
#: Pixel 8 threw before the code that writes its result).
CLAIM_STATUS = "**status: INCOMPLETE — the run did not finish.**"

_AUDIT_MEMO: list = []


def _et():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


def audit_module(loader=None):
    """`tools/bars_warmth_audit.py`, loaded BY PATH and memoised.

    ⛔ It is a script in `tools/`, not a package module, so it cannot be imported by
    name — the same recipe `tests/test_bars_warmth_audit_buckets.py` uses.
    `loader` is late-bound so a test can hand in a stand-in.
    """
    if loader is not None:
        return loader()
    if _AUDIT_MEMO:
        return _AUDIT_MEMO[0]
    path = _HERE / "bars_warmth_audit.py"
    spec = importlib.util.spec_from_file_location("bars_warmth_audit", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _AUDIT_MEMO.append(mod)
    return mod


# ────────────────────────────────────────────────────────────────────────────────
# PRECONDITION 1 — the pod is settled
# ────────────────────────────────────────────────────────────────────────────────

def read_health(base: str, urlopen_fn=None) -> dict:
    """`{status, uptime_seconds, error}` from `/api/health`. Never raises.

    ⚠️ A BROWSER `User-Agent` IS NOT OPTIONAL: Cloudflare 1010-blocks non-browser
    UAs against this origin, and a 1010 is indistinguishable from a sick pod unless
    you know to look. Recorded in CLAUDE.md.

    ⛔ `urlopen_fn` is late-bound — a default argument would be captured at import
    and `monkeypatch.setattr` on this module would reach nothing.
    """
    urlopen_fn = urlopen_fn or urllib.request.urlopen
    try:
        req = urllib.request.Request(f"{base.rstrip('/')}/api/health",
                                     headers={"User-Agent": _UA})
        with urlopen_fn(req, timeout=15) as r:      # noqa: S310 — the base is ours
            status = int(getattr(r, "status", None) or r.getcode())
            body = json.load(r)
        age = body.get("uptime_seconds") if isinstance(body, dict) else None
        return {"status": status, "uptime_seconds": age, "error": None}
    except Exception as e:                          # noqa: BLE001
        # A non-200 arrives here as an HTTPError on most paths; keep its code when
        # there is one, because "502" and "unreachable" are different refusals.
        status = getattr(e, "code", None)
        return {"status": int(status) if isinstance(status, int) else None,
                "uptime_seconds": None,
                "error": f"{type(e).__name__}: {e}"}


def pod_settled_refusal(health, floor_s: float = POD_FLOOR_S):
    """The INCONCLUSIVE text when the pod is not settled, else `None`. Pure."""
    health = health or {}
    status = health.get("status")
    if status is None:
        return ("INCONCLUSIVE — `/api/health` could not be read "
                f"({health.get('error') or 'no response'}). ⛔ An unreadable health "
                "endpoint is its own problem and is NEVER laundered into a pod age: "
                "'unknown' and 'settled' are different facts.")
    if int(status) != 200:
        return (f"INCONCLUSIVE — `/api/health` answered **{int(status)}**, not 200. A "
                "502 means a deploy is mid-swap, so clause 2's 'a pod >= "
                f"{float(floor_s):.0f} s old' cannot be established at all. ⛔ This is "
                "a REFUSAL, not a retry loop — the runner does not poll a swapping pod "
                "until it likes the answer, because the pod it eventually measures "
                "would not be the pod it started against.")
    age = health.get("uptime_seconds")
    if isinstance(age, bool) or not isinstance(age, (int, float)):
        return ("INCONCLUSIVE — `/api/health` answered 200 but carried no numeric "
                f"`uptime_seconds` (got {age!r}). The floor cannot be checked, so the "
                "pod's age is UNKNOWN — which is not the same as settled.")
    if float(age) < float(floor_s):
        return (f"INCONCLUSIVE — the pod is **{float(age):.0f} s old**, under clause 2's "
                f"floor of {float(floor_s):.0f} s. A reading this early measures the "
                "BOOT — cold caches, warm-on-boot still running — not the product a "
                f"member gets. Re-run in {float(floor_s) - float(age):.0f} s.")
    return None


# ────────────────────────────────────────────────────────────────────────────────
# PRECONDITION 2 — RTH, from the product's own clock
# ────────────────────────────────────────────────────────────────────────────────

def pin_shared_data_root(census_fn=None, mkdtemp_fn=None, environ=None) -> str:
    """Apply conftest's AST-derived census pins to a scratch root.

    ⛔⛔ CALLED BEFORE THE FIRST `api.**` IMPORT AND NEVER AFTER. Those paths are
    captured at MODULE IMPORT, so a pin set afterwards reaches nothing — and `/data`
    is a REAL DIRECTORY on this box (`C:\\data`), holding the owner's live files. The
    census is applied whole rather than a hand-picked var: setting `DATA_DIR` alone
    was measured writing two live databases in 2026-09-12, because 71 of the 72 path
    vars do not resolve through it.

    Returns the scratch root it pinned to. Raises if the census is unavailable — a
    tool that cannot pin does not import `api.**`.
    """
    import os
    import tempfile
    environ = environ if environ is not None else os.environ
    if census_fn is None:
        if str(_ROOT) not in sys.path:
            sys.path.insert(0, str(_ROOT))
        import conftest
        census_fn = conftest.shared_data_root_census
    mkdtemp_fn = mkdtemp_fn or (lambda: tempfile.mkdtemp(prefix="uct_warmth_gate_"))
    sandbox = mkdtemp_fn()
    _literals, pins, _unpinnable = census_fn()
    for env, literal in pins.items():
        environ[env] = literal.replace("/data", sandbox)
    return sandbox


def resolve_session_fn(pin_fn=None, import_fn=None):
    """`(session_fn, authority_name)` — the PRODUCT'S OWN RTH predicate.

    ⛔ Both seams are late-bound (see the default-argument note on `read_health`).
    ⛔ It RAISES rather than returning a stand-in: the caller turns that into an
    INCONCLUSIVE naming the missing authority. A fallback clock here would be the
    second authority this whole file is written to avoid.
    """
    pin_fn = pin_fn or pin_shared_data_root
    pin_fn()
    if import_fn is not None:
        return import_fn(), SESSION_AUTHORITY
    from api.services.screener import scan_evaluator
    return scan_evaluator._live_session_state, SESSION_AUTHORITY


def rth_refusal(now_et, session_fn=None, authority: str = SESSION_AUTHORITY,
                resolve_fn=None):
    """The INCONCLUSIVE text when `now_et` is outside RTH, else `None`.

    ⚠️ THE PREDICATE'S POLARITY IS THE PRODUCT'S, NOT INVERTED HERE: it answers
    `None` INSIDE the session and a string (`"closed"`) outside it. Re-spelling that
    as a boolean is how a wrapper starts disagreeing with the thing it wraps.
    """
    if session_fn is None:
        resolve_fn = resolve_fn or resolve_session_fn
        try:
            session_fn, authority = resolve_fn()
        except Exception as e:                      # noqa: BLE001
            return ("INCONCLUSIVE — the product's own market clock "
                    f"(`{SESSION_AUTHORITY}`) could not be loaded "
                    f"({type(e).__name__}: {e}). ⛔ NOT falling back to a hand-rolled "
                    "weekday + 09:30-16:00 test: that reads a 13:00 ET half-day as a "
                    "full session, which is the exact bug the product's own clock "
                    "carried until 2026-09-10. An undrivable authority is "
                    "INCONCLUSIVE, never a silent fallback.")
    state = session_fn(now_et)
    if state is None:
        return None
    return (f"INCONCLUSIVE — {now_et:%A %Y-%m-%d %H:%M} ET is **not inside regular "
            f"trading hours** (the clock says `{state}`), per `{authority}`, which "
            "reads the NYSE calendar: weekends, full closures, and 13:00 ET "
            "half-days. Clause 2's tier alarm is only meaningful during RTH, and a "
            "weekend or holiday cache is not representative of what a member waits "
            "for. ⛔ NOT a pass and NOT a failure — the gate was not taken.")


# ────────────────────────────────────────────────────────────────────────────────
# THE MEASUREMENT — every number comes from the instrument
# ────────────────────────────────────────────────────────────────────────────────

def sample_timeframe(base: str, tf: str, n: int, bars: int, audit=None, client=None):
    """`[(layer, wall_ms), ...]` for one timeframe, via the INSTRUMENT'S OWN probe.

    ⛔ `audit._serve_layer`, `audit._universe` and `audit._stratified` — not a
    reimplementation. The stratified spread is load-bearing: the deep long tail is
    where cold lives, and sampling the megacaps at the top of the file measures a
    different product.
    """
    audit = audit or audit_module()
    import httpx
    sample = audit._stratified(audit._universe(), n)
    own = client is None
    if own:
        client = httpx.Client(headers={"User-Agent": _UA}, follow_redirects=True)
    try:
        # ⛔ Pay connection setup (DNS/TLS/CDN) OUTSIDE the timed sample. Measured
        # 2026-09-30: an unwarmed first read took 1,120 ms wall for 73.5 ms of
        # server time, and one such sample moves a 40-sample p95. Best effort --
        # a failed warm-up leaves the sample to say what it measured.
        try:
            client.get(f"{base}/api/health", timeout=20)
        except Exception:
            pass
        out = []
        for sym in sample:
            t = audit._serve_timing(base, sym, tf, bars, client)
            out.append((t["layer"], t["wall"], t["server_ms"]))
        return out
    finally:
        if own:
            client.close()


def tier_alarm(tf: str, layers, in_rth: bool, audit=None):
    """Clause 2's ONE tier alarm, or `None`. Pure.

    ⛔ IT IS REPORTED, NEVER AN INPUT TO `verdict()`. Clause 2 says the tier mix is
    reported BESIDE the p95 and never as pass/fail; the alarm is the one part of the
    mix the clause keeps, and keeping it means SAYING it, not failing on it. A pass
    bought by serving stale data is not a pass — and a reader who can see the mix
    beside the number can tell.
    """
    if tf not in INTRADAY_TFS or not in_rth:
        return None
    total = sum(Counter(layers).values())
    if not total:
        return None
    share = sum(v for k, v in Counter(layers).items() if k in ALARM_LAYERS) / total
    if share <= TIER_ALARM_SHARE:
        return None
    return (f"⚠️ TIER ALARM — `fetch`/`miss` share is **{share * 100:.0f}%** on "
            f"intraday (tf={tf}) during RTH, over clause 2's ~"
            f"{TIER_ALARM_SHARE * 100:.0f}% line. ⛔ REPORTED, NOT a pass/fail input: "
            "it does not move the exit code.")


def timeframe_result(tf: str, samples, in_rth: bool = True, audit=None) -> dict:
    """One timeframe's whole answer, from `[(layer, wall_ms), ...]`. Pure, no network.

    ⛔ The p95 population is WARM + STALE_SERVED — everyone who did NOT wait — which
    is the population the instrument computes its own no-wait p95 over. Folding
    `stale-swr` into COLD is what emptied the daily set and left CARD 16's bar
    uncomputable while a cold p50/max was recorded as a p95 pass.
    """
    audit = audit or audit_module()
    layers: Counter = Counter()
    nowait: list = []
    waited: list = []
    server: list = []
    for sample in samples or []:
        layer, wall = sample[0], sample[1]
        srv = sample[2] if len(sample) > 2 else None
        layers[layer] += 1
        if layer in audit.WARM or layer in audit.STALE_SERVED:
            nowait.append(float(wall))
            if srv is not None:
                server.append(float(srv))
        else:
            waited.append(float(wall))
    total = sum(layers.values())
    res = {
        "tf": tf,
        "intraday": tf in INTRADAY_TFS,
        "n": total,
        "layers": dict(layers),
        "warm": sum(v for k, v in layers.items() if k in audit.WARM),
        "stale_served": sum(v for k, v in layers.items() if k in audit.STALE_SERVED),
        "waited": len(waited),
        "nowait_n": len(nowait),
        "p95_ms": None,
        "p50_ms": None,
        "waited_p95_ms": None,
        # ⭐ BESIDE the verdict, never in it: the server's own time for the same
        # no-wait reads. 2026-09-30 needed this to tell the network from the product.
        "server_p95_ms": None,
        "not_computable": None,
        "bar_ms": P95_BAR_MS,
        "tier_alarm": tier_alarm(tf, layers, in_rth, audit=audit),
    }
    if not nowait:
        res["not_computable"] = (
            f"NOT COMPUTABLE on tf={tf} — "
            + (f"all {total} sampled reads WAITED" if total
               else "the sample was EMPTY")
            + ", so the no-wait population the gate is computed over is empty. "
              "⛔ This is neither a PASS nor a FAIL. Do NOT read the waited-read "
              "latency below as a p95: that substitution is the recorded defect "
              "this runner exists to make impossible.")
        return res
    if len(nowait) < MIN_NOWAIT_N:
        res["not_computable"] = (
            f"NOT COMPUTABLE on tf={tf} — only {len(nowait)} of {total} reads did "
            f"not wait; a p95 needs at least {MIN_NOWAIT_N} or it is just the "
            f"slowest of a handful. ⛔ Neither a PASS nor a FAIL.")
        return res
    ordered = sorted(nowait)
    res["p50_ms"] = float(audit.pct_of(ordered, 0.50))
    res["p95_ms"] = float(audit.pct_of(ordered, 0.95))
    res["waited_p95_ms"] = (float(audit.pct_of(sorted(waited), 0.95))
                            if waited else None)
    res["server_p95_ms"] = float(audit.pct_of(sorted(server), 0.95)) if server else None
    return res


def verdict(p95_by_tf):
    """`(exit_code, reason)` from `[(tf, p95_ms | None), ...]`.

    ⛔⛔ ITS ONLY INPUT IS THE p95 PER TIMEFRAME. The tier mix is not in the argument
    list, so "the tier mix is never a pass/fail input" is a property of this
    signature — not a promise in a comment somebody can quietly stop keeping.

    ⛔⛔ AND THE THREE CODES ARE THREE ANSWERS. NOT COMPUTABLE returns
    `EXIT_INCONCLUSIVE`, never `EXIT_OVER`: "we could not compute it" and "the
    product is over the bar" are different facts, and collapsing them is what makes
    a gate read as a product failure on a night nothing was measured.
    """
    rows = list(p95_by_tf or [])
    if not rows:
        return EXIT_INCONCLUSIVE, ("INCONCLUSIVE — no timeframe produced a result at "
                                   "all, so there is nothing to compare to the bar.")
    missing = [tf for tf, p95 in rows if p95 is None]
    if missing:
        return EXIT_INCONCLUSIVE, (
            "INCONCLUSIVE — no p95 was computable on "
            + ", ".join(f"tf={tf}" for tf in missing)
            + f" (of {len(rows)} timeframe(s) sampled). Clause 2 requires a p95 for "
              "BOTH timeframes, and an uncomputable one is neither within the bar "
              "nor over it.")
    over = [(tf, p95) for tf, p95 in rows if p95 > P95_BAR_MS]
    if over:
        return EXIT_OVER, (
            "OVER THE BAR — "
            + ", ".join(f"tf={tf} p95 {p95:.0f} ms > {P95_BAR_MS:.0f} ms"
                        for tf, p95 in over)
            + ". Measured under valid conditions, so this IS a product reading.")
    return EXIT_WITHIN, (
        "WITHIN THE BAR — "
        + ", ".join(f"tf={tf} p95 {p95:.0f} ms <= {P95_BAR_MS:.0f} ms"
                    for tf, p95 in rows)
        + ". Measured under valid conditions.")


# ────────────────────────────────────────────────────────────────────────────────
# THE ARTIFACT — claimed before the run, overwritten only with a real result
# ────────────────────────────────────────────────────────────────────────────────

def evidence_path(now_utc=None, root=None) -> pathlib.Path:
    """`<evidence>/<YYYY-MM-DD>-card16-p95-gate-<HHMM>Z/results.md`.

    The sibling convention under `docs/terminal-research/10-roadmap/evidence/` is one
    directory per run holding `results.md`.
    """
    now_utc = now_utc or _dt.datetime.now(_dt.timezone.utc)
    base = (pathlib.Path(root) if root is not None
            else _ROOT / "docs" / "terminal-research" / "10-roadmap" / "evidence")
    return (base / f"{now_utc:%Y-%m-%d}-card16-p95-gate-{now_utc:%H%M}Z"
            / "results.md")


def write_lf(path: pathlib.Path, lines) -> None:
    """Write `lines` joined with LF. ⛔ BYTES, not text mode: text mode on Windows
    translates `\\n` to CRLF, and a repo file written with the wrong endings turns a
    two-line edit into a nine-hundred-line diff (R-2)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))


def claim_lines(header) -> list:
    """The placeholder body. It NAMES THE INTENDED RUN, so a reader of a dead run's
    file can see what was attempted and that it did not finish."""
    return list(header) + ["", CLAIM_STATUS, "",
                           "This file was claimed BEFORE the measurement started and "
                           "has not been overwritten, so the run did not reach its "
                           "verdict. ⛔ It is not a result. A previous run's file left "
                           "on disk reads exactly like a current pass, which is why "
                           "the claim happens first."]


def header_lines(base, tfs, n, now_et, now_utc) -> list:
    return [
        f"# CARD 16 p95 gate — {now_utc:%Y-%m-%d %H:%M}Z "
        f"({now_et:%H:%M} ET, {now_et:%A})",
        "",
        f"Runner: `tools/bars_warmth_gate.py`. Instrument: "
        f"`tools/bars_warmth_audit.py` (unmodified — the buckets, the percentile and "
        f"the per-symbol probe are imported from it).",
        "",
        f"* gate: `docs/terminal-research/10-roadmap/roadmap.md` §2.3 clause 2 — "
        f"p95 <= {P95_BAR_MS:.0f} ms per timeframe",
        f"* origin: `{base}`",
        f"* timeframes: {', '.join(tfs)} · sample: {n} symbols per timeframe",
        f"* pod floor: {POD_FLOOR_S:.0f} s · tier alarm: `fetch`/`miss` > "
        f"~{TIER_ALARM_SHARE * 100:.0f}% on intraday during RTH",
        f"* market-hours authority: `{SESSION_AUTHORITY}`",
        f"* ET at start: {now_et:%Y-%m-%d %H:%M:%S} ({now_et:%Z}, UTC{now_et:%z})",
    ]


def refusal_lines(header, refusals, health) -> list:
    out = list(header) + [
        "", "**status: REFUSED — INCONCLUSIVE (exit 2). Nothing was measured.**", "",
        f"`uptime_seconds` as read: {health.get('uptime_seconds')!r} · "
        f"`/api/health` status: {health.get('status')!r}", "",
        "## Preconditions that refused", "",
    ]
    for r in refusals:
        out += [f"* {r}", ""]
    out += ["⛔ No p95 was taken. A reading under these conditions would be real "
            "numbers under invalid conditions — which is worthless for the gate and "
            "worse than nothing, because it is quotable."]
    return out


def result_lines(header, results, code, reason, health) -> list:
    label = {EXIT_WITHIN: "WITHIN THE BAR (exit 0)",
             EXIT_OVER: "OVER THE BAR (exit 1)",
             EXIT_INCONCLUSIVE: "INCONCLUSIVE (exit 2)"}[code]
    out = list(header) + [
        "", f"**status: {label}**", "", reason, "",
        f"Validity evidence carried by this result: pod `uptime_seconds` = "
        f"**{health.get('uptime_seconds')}** (floor {POD_FLOOR_S:.0f} s), "
        f"`/api/health` = **{health.get('status')}**, and the ET stamp in the title. "
        "A recorded number without these is not a recorded gate reading.",
        "", "## The p95, the bar, and which side of it", "",
        "| tf | p95 | bar | side | p50 | no-wait n | sampled | server p95 (beside, not an input) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        if r["p95_ms"] is None:
            out.append(f"| {r['tf']} | NOT COMPUTABLE | {P95_BAR_MS:.0f} ms | "
                       f"neither | — | {r['nowait_n']} | {r['n']} | — |")
        else:
            side = "WITHIN" if r["p95_ms"] <= P95_BAR_MS else "OVER"
            out.append(f"| {r['tf']} | {r['p95_ms']:.0f} ms | {P95_BAR_MS:.0f} ms | "
                       f"{side} | {r['p50_ms']:.0f} ms | {r['nowait_n']} | {r['n']} | "
                       + (f"{r['server_p95_ms']:.0f} ms |" if r.get("server_p95_ms") is not None
                          else "not reported |"))
    out += ["", "## Tier mix — BESIDE the numbers, never a pass/fail input", "",
            "⛔ Clause 2 says so explicitly, because a pass bought by serving stale "
            "data is not a pass. `verdict()` cannot see any of this: its only "
            "argument is the p95 per timeframe.", "",
            "| tf | warm | stale-served | waited | layers |",
            "|---|---|---|---|---|"]
    for r in results:
        out.append(f"| {r['tf']} | {r['warm']}/{r['n']} | {r['stale_served']}/{r['n']} "
                   f"| {r['waited']}/{r['n']} | `{r['layers']}` |")
    alarms = [r["tier_alarm"] for r in results if r["tier_alarm"]]
    out += ["", "## The one tier alarm", ""]
    out += ([f"* {a}" for a in alarms] if alarms else
            [f"* No alarm: no intraday timeframe exceeded ~"
             f"{TIER_ALARM_SHARE * 100:.0f}% `fetch`/`miss` during RTH."])
    for r in results:
        if r["not_computable"]:
            out += ["", f"⛔ {r['not_computable']}"]
    return out


# ────────────────────────────────────────────────────────────────────────────────

def say(msg: str) -> None:
    print(msg, flush=True)


def self_check() -> int:
    """Rule 14 — prove every refusal can FIRE, and that a valid run still PASSES.

    ⛔ No network and no clock: the health read and the session predicate are both
    handed in. A gate nobody has seen fail is not a gate; a gate that refuses
    everything is not one either, which is why the passing control is here.
    """
    bad = 0

    def case(name, ok):
        nonlocal bad
        say(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    et = _et()
    rth = _dt.datetime(2026, 9, 23, 12, 0, tzinfo=et)          # Wednesday noon
    weekend = _dt.datetime(2026, 9, 26, 12, 0, tzinfo=et)      # Saturday noon
    holiday = _dt.datetime(2026, 9, 7, 14, 30, tzinfo=et)      # Labor Day, mid-afternoon
    half_open = _dt.datetime(2026, 11, 27, 12, 0, tzinfo=et)   # half-day, before 13:00
    half_shut = _dt.datetime(2026, 11, 27, 14, 0, tzinfo=et)   # half-day, after 13:00

    case("⛔ a 502 REFUSES (and says it is not a retry loop)",
         (lambda r: r is not None and "502" in r and "retry loop" in r)(
             pod_settled_refusal({"status": 502, "uptime_seconds": None})))
    case("⛔ uptime 120 s REFUSES, naming both numbers",
         (lambda r: r is not None and "120 s old" in r and "300 s" in r)(
             pod_settled_refusal({"status": 200, "uptime_seconds": 120})))
    case("⛔ an UNREADABLE health read REFUSES and is not laundered into an age",
         (lambda r: r is not None and "laundered" in r)(
             pod_settled_refusal({"status": None, "uptime_seconds": None,
                                  "error": "URLError: timed out"})))
    case("⭐ CONTROL — 200 and uptime 300 s passes, so the floor has an edge",
         pod_settled_refusal({"status": 200, "uptime_seconds": 300}) is None
         and pod_settled_refusal({"status": 200, "uptime_seconds": 299}) is not None)

    try:
        session_fn, _auth = resolve_session_fn()
        clock_ok = True
    except Exception as e:                                      # noqa: BLE001
        say(f"  ⚠️  the product clock could not be loaded here ({type(e).__name__}: "
            f"{e}); the clock cases below are SKIPPED, not passed")
        session_fn, clock_ok = None, False
    if clock_ok:
        case("⛔ a WEEKEND refuses", rth_refusal(weekend, session_fn=session_fn) is not None)
        case("⛔ a HOLIDAY mid-afternoon refuses (a weekday clock would pass it)",
             rth_refusal(holiday, session_fn=session_fn) is not None)
        case("⭐ a 13:00 ET HALF-DAY is RTH before its close",
             rth_refusal(half_open, session_fn=session_fn) is None)
        case("⛔ ...and NOT RTH after it",
             rth_refusal(half_shut, session_fn=session_fn) is not None)
        case("⭐ CONTROL — an ordinary weekday noon is RTH",
             rth_refusal(rth, session_fn=session_fn) is None)
    case("⛔ an UNDRIVABLE clock is INCONCLUSIVE, never a hand-rolled fallback",
         (lambda r: r is not None and "never a silent fallback" in r)(
             rth_refusal(rth, resolve_fn=lambda: (_ for _ in ()).throw(
                 ImportError("no api package here")))))

    warm = [("mem", 40.0)] * 19 + [("sqlite", 90.0)]
    slow = [("mem", 400.0)] * 20
    allwait = [("fetch", 900.0)] * 20
    case("⭐ CONTROL — a fully valid warm sample is WITHIN and exits 0",
         verdict([("D", timeframe_result("D", warm)["p95_ms"]),
                  ("5", timeframe_result("5", warm)["p95_ms"])])[0] == EXIT_WITHIN)
    case("⛔ an over-bar sample is OVER and exits 1",
         verdict([("D", timeframe_result("D", slow)["p95_ms"])])[0] == EXIT_OVER)
    case("⛔ an all-waited timeframe is NOT COMPUTABLE",
         timeframe_result("D", allwait)["p95_ms"] is None
         and "NOT COMPUTABLE" in timeframe_result("D", allwait)["not_computable"])
    case("⛔⛔ ...and NOT COMPUTABLE exits 2, never 1",
         verdict([("D", None), ("5", 80.0)])[0] == EXIT_INCONCLUSIVE)
    case("⛔⛔ ...and the three codes are three different numbers",
         len({EXIT_WITHIN, EXIT_OVER, EXIT_INCONCLUSIVE}) == 3)
    case("⛔ the tier mix cannot reach the verdict — a dreadful mix still exits 0",
         verdict([("5", timeframe_result(
             "5", [("stale-swr", 40.0)] * 20)["p95_ms"])])[0] == EXIT_WITHIN)
    case("⛔ the tier ALARM fires on a bad intraday mix during RTH",
         tier_alarm("5", Counter({"mem": 17, "fetch": 3}), True) is not None)
    case("⭐ CONTROL — and stays quiet at or under the line, and off intraday",
         tier_alarm("5", Counter({"mem": 18, "fetch": 2}), True) is None
         and tier_alarm("D", Counter({"mem": 1, "fetch": 19}), True) is None)
    case("⛔ the claim names itself INCOMPLETE",
         CLAIM_STATUS.startswith("**status: INCOMPLETE")
         and any("INCOMPLETE" in ln for ln in claim_lines(["# x"])))

    say("self-check: " + ("PASS" if not bad else f"FAIL ({bad})"))
    return 0 if not bad else 1


def main(argv=None, health_fn=None, clock_fn=None, session_fn=None,
         sample_fn=None, evidence_root=None) -> int:
    """⛔ EVERY SEAM IS LATE-BOUND (resolved in the body, defaulted to `None`). A
    default argument is evaluated once at import, so `monkeypatch.setattr` on this
    module would reach nothing — a defect that cost this repo a real run."""
    ap = argparse.ArgumentParser(description="CARD 16's p95 gate, with preconditions.")
    ap.add_argument("--base", default=None,
                    help="origin to measure (default $WARMTH_BASE or production)")
    ap.add_argument("--n", type=int, default=40, help="symbols sampled per timeframe")
    ap.add_argument("--tf", default="D,5", help="timeframes, comma separated")
    ap.add_argument("--bars-d", type=int, default=300)
    ap.add_argument("--bars-i", type=int, default=240)
    ap.add_argument("--evidence-root", default=None,
                    help="where the run's artifact directory is created")
    ap.add_argument("--self-check", action="store_true",
                    help="prove every refusal can fire, without a network or a clock")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    import os
    health_fn = health_fn or read_health
    clock_fn = clock_fn or (lambda: _dt.datetime.now(_et()))
    sample_fn = sample_fn or sample_timeframe
    base = a.base or os.environ.get("WARMTH_BASE", "https://uctintelligence.com")
    tfs = [t.strip() for t in a.tf.split(",") if t.strip()]

    now_et = clock_fn()
    now_utc = now_et.astimezone(_dt.timezone.utc)
    header = header_lines(base, tfs, a.n, now_et, now_utc)
    out = evidence_path(now_utc, evidence_root
                        if evidence_root is not None else a.evidence_root)

    # ⛔⛔ CLAIM THE ARTIFACT BEFORE ANYTHING IS MEASURED.
    write_lf(out, claim_lines(header))
    for line in header:
        say(line)
    say(f"\nartifact claimed → {out}\n")

    # ── PRECONDITIONS FIRST. All of them, so the refusal is complete rather than
    #    whichever one happened to be checked first.
    health = health_fn(base)
    refusals = [r for r in (pod_settled_refusal(health),
                            rth_refusal(now_et, session_fn=session_fn)) if r]
    if refusals:
        say("── PRECONDITIONS ──")
        for r in refusals:
            say(f"  {r}\n")
        write_lf(out, refusal_lines(header, refusals, health))
        say(f"recorded → {out}")
        say(f"\nVERDICT: INCONCLUSIVE — the gate was NOT taken. GATE EXIT: "
            f"{EXIT_INCONCLUSIVE}")
        return EXIT_INCONCLUSIVE
    say("── PRECONDITIONS ──")
    say(f"  ok   /api/health 200, uptime_seconds={health.get('uptime_seconds')} "
        f"(floor {POD_FLOOR_S:.0f} s)")
    say(f"  ok   {now_et:%A %H:%M} ET is inside RTH per `{SESSION_AUTHORITY}`\n")

    say("── MEASURING ──")
    results = []
    for tf in tfs:
        bars = a.bars_d if tf not in INTRADAY_TFS else a.bars_i
        samples = sample_fn(base, tf, a.n, bars)
        r = timeframe_result(tf, samples, in_rth=True)
        results.append(r)
        if r["p95_ms"] is None:
            say(f"  tf={tf:<3} NOT COMPUTABLE (no-wait n={r['nowait_n']} of {r['n']}, "
                f"minimum {MIN_NOWAIT_N})")
        else:
            say(f"  tf={tf:<3} p95={r['p95_ms']:.0f}ms p50={r['p50_ms']:.0f}ms "
                f"(no-wait n={r['nowait_n']} of {r['n']}) "
                f"warm={r['warm']} stale-served={r['stale_served']} "
                f"waited={r['waited']} | server p95="
                + (f"{r['server_p95_ms']:.0f}ms" if r.get("server_p95_ms") is not None
                   else "not reported"))
        if r["tier_alarm"]:
            say(f"       {r['tier_alarm']}")

    code, reason = verdict([(r["tf"], r["p95_ms"]) for r in results])
    write_lf(out, result_lines(header, results, code, reason, health))
    say(f"\n{reason}")
    say(f"recorded → {out}")
    label = {EXIT_WITHIN: "WITHIN", EXIT_OVER: "OVER",
             EXIT_INCONCLUSIVE: "INCONCLUSIVE"}[code]
    say(f"\nVERDICT: {label}. GATE EXIT: {code}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
