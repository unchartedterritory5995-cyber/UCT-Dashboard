"""Market Intelligence — LOCAL real-value review of Slice 2 event studies.

    python tools/market_intel_review.py [--data-dir C:/data] [--econ-db PATH] [--cot-db PATH]
                                        [--out-dir DIR] [--only econ,cot,...]

WHAT IT DOES
  Runs a fixed set of historical studies against UCT's REAL local stores through the exact Slice 2
  code path (event_study.run → event_study_answer.answer) and checks invariants on each, including a
  real-data NO-LOOK-AHEAD check: the world is truncated at several cutoffs (econ by vintage time,
  COT by public day) and every event before a cutoff must be identical with and without the future.

⛔ WHERE THE VALUES GO — read before running
  * Every value-bearing result (answers, tables, event lists, returns) is written ONLY to a local file
    in --out-dir (default %LOCALAPPDATA%/uct-mi-review, outside every repo, synced folder and log).
  * The console gets ONLY: the output path, each study's status, event COUNTS, public dates, and
    PASS/FAIL. Nothing printed is a market value. It is therefore safe to run where the console is
    read by an AI assistant — but the OUTPUT FILE IS NOT: never paste it, attach it, open it inside an
    AI tool, or commit it. It holds licensed market data (UCT owner rule: market values never go to
    Anthropic or any model).
  * A human reviews the file locally.

SAFETY RAILS (enforced in-process, not by convention)
  * Network: every socket connect outside loopback raises. No provider, model or cloud read.
  * Stores are opened READ-ONLY: every sqlite3.connect becomes `file:...?mode=ro&immutable=1`
    (cot_service would otherwise set WAL mode on open). A write raises.
  * File writes outside --out-dir raise (breadth's series cache, dirty markers, warm writes…).
  * Econ / fundamentals / market cap production (R2) sources are refused by the adapters themselves.
  * Exit code 1 if any invariant fails.
"""
from __future__ import annotations

import argparse
import builtins
import datetime as _dt
import json
import math
import os
import socket
import sqlite3
import sys
import traceback

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── rails ─────────────────────────────────────────────────────────────────────

def _install_network_guard() -> None:
    real = socket.socket.connect

    def guard(self, addr):
        if isinstance(addr, tuple) and addr and addr[0] in ("127.0.0.1", "::1", "localhost"):
            return real(self, addr)
        raise RuntimeError("network attempt blocked by market_intel_review")
    socket.socket.connect = guard
    socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("network attempt blocked"))


def _install_readonly_sqlite() -> None:
    real = sqlite3.connect

    def ro(database, *a, **k):
        db = os.fspath(database)
        if db == ":memory:" or db.startswith("file:"):
            return real(database, *a, **k)
        if not os.path.exists(db):
            raise sqlite3.OperationalError(f"review: no store at {db} (never created)")
        k.pop("uri", None)
        uri = "file:" + os.path.abspath(db).replace("\\", "/") + "?mode=ro&immutable=1"
        return real(uri, *a, uri=True, **k)
    sqlite3.connect = ro


def _install_write_guard(out_dir: str) -> None:
    allowed = os.path.abspath(out_dir)
    real_open = builtins.open

    def inside(p) -> bool:
        try:
            return os.path.abspath(os.fspath(p)).startswith(allowed)
        except TypeError:
            return False

    def guarded_open(file, mode="r", *a, **k):
        if any(ch in mode for ch in "wax+") and not isinstance(file, int) and not inside(file):
            raise PermissionError(f"review: write blocked outside the output dir: {file}")
        return real_open(file, mode, *a, **k)
    builtins.open = guarded_open
    for name in ("replace", "rename", "remove", "unlink", "makedirs", "mkdir", "rmdir"):
        real = getattr(os, name)

        def wrap(*a, _real=real, _name=name, **k):
            if not inside(a[0] if a else ""):
                raise PermissionError(f"review: os.{_name} blocked outside the output dir")
            return _real(*a, **k)
        setattr(os, name, wrap)


# ── checks ────────────────────────────────────────────────────────────────────

class Report:
    def __init__(self):
        self.fails = 0
        self.not_reviewed: list[str] = []
        self.sections: list[str] = []

    def check(self, name: str, ok: bool) -> None:
        self.fails += 0 if ok else 1
        print(("PASS " if ok else "FAIL ") + name)          # names carry counts/dates only

    def add(self, title: str, body: str) -> None:
        self.sections.append(f"## {title}\n\n{body}\n")


def invariants(rep: Report, tag: str, r: dict) -> None:
    ev, cov, cnt = r["events"], r["coverage"], r["counts"]
    rep.check(f"{tag}: event dates ascending & unique", [e["event_date"] for e in ev] == sorted({e["event_date"] for e in ev}))
    rep.check(f"{tag}: events inside the study window",
              all(cov["study_start"] <= e["event_date"] <= cov["study_end"] for e in ev))
    rep.check(f"{tag}: entry never before the event", all(e["entry_date"] >= e["event_date"] for e in ev))
    rep.check(f"{tag}: every return finite or excluded",
              all(x["return"] is None or math.isfinite(x["return"]) for e in ev for x in e["returns"]))
    rep.check(f"{tag}: exits after entry", all(x["exit_date"] is None or x["exit_date"] > e["entry_date"]
                                              for e in ev for x in e["returns"]))
    rep.check(f"{tag}: no completed window ends after the last stored close",
              all(x["outcome"] != "ok" or x["exit_date"] <= cov["price_last"] for e in ev for x in e["returns"]))
    for h in r["horizons"]:
        rep.check(f"{tag}: {h['label']} completed + open + missing == events ({cnt['events_used']})",
                  h.get("n", 0) + h["incomplete"] + h["missing_price"] == cnt["events_used"])


def _events_before(r: dict, day: str) -> list:
    return [(e["event_date"], e["entry_date"], e["condition_values"]) for e in r.get("events") or []
            if e["event_date"] <= day]


def future_invariance(rep: Report, tag: str, request: dict, truncate, cutoffs: list[str]) -> None:
    """Real-data no-look-ahead: `truncate(day)` is a context manager that hides everything published
    after `day`'s close. Events up to `day` must not change."""
    from api.services.market_intel import event_study as es
    whole = es.run(request, deadline_s=600)
    if whole.get("status") != "ok":
        rep.check(f"{tag}: look-ahead check ran (status {whole.get('status')}/{whole.get('reason')})", False)
        return
    for day in cutoffs:
        with truncate(day):
            then = es.run(request, deadline_s=600)
        if then.get("status") != "ok":
            rep.check(f"{tag}: cutoff {day} — nothing earlier was an event ({then.get('reason')})",
                      _events_before(whole, day) == [])
            continue
        same = _events_before(whole, day) == _events_before(then, day)
        rep.check(f"{tag}: cutoff {day} — {len(_events_before(whole, day))} earlier events unchanged by the future", same)


# ── the review ────────────────────────────────────────────────────────────────

def _study(rep: Report, tag: str, request: dict) -> dict | None:
    from api.services.market_intel import event_study as es, event_study_answer as esa
    r = es.run(request, deadline_s=600)
    out = esa.answer(r)
    st = r.get("status")
    if st != "ok":
        rep.not_reviewed.append(f"{tag} ({r.get('reason')})")
    print(f"     {tag}: status={st}" + (f" reason={r.get('reason')}" if st != "ok" else
                                         f" events={r['counts']['events_used']}"
                                         f" window={r['coverage']['study_start']}..{r['coverage']['study_end']}"))
    body = ["```json", json.dumps({"request": request}, indent=1), "```", "", out["text"], ""]
    if out.get("table"):
        cols = out["table"]["columns"]
        body.append("| " + " | ".join(c["label"] for c in cols) + " |")
        body.append("|" + "---|" * len(cols))
        for row in out["table"]["rows"]:
            body.append("| " + " | ".join(str(row.get(c["key"], "")) for c in cols) + " |")
    if st == "ok":
        body += ["", f"Caveats: {out.get('caveats')}", "", "Events (first 60):", ""]
        for e in r["events"][:60]:
            rets = ", ".join(f"{x['horizon']}: {x['outcome']}" + ("" if x["return"] is None else f" {x['return'] * 100:+.2f}%")
                             for x in e["returns"])
            body.append(f"- {e['event_date']} entry {e['entry_date']} cond {e['condition_values']} → {rets}")
        body += ["", "Diagnostics:", "```json", json.dumps(r.get("diagnostics"), indent=1, default=str), "```"]
        invariants(rep, tag, r)
    rep.add(tag, "\n".join(body))
    return r if st == "ok" else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=os.environ.get("DATA_DIR", "C:/data"))
    ap.add_argument("--econ-db", default=os.environ.get("ECON_DB_PATH"))
    ap.add_argument("--cot-db", default=os.environ.get("COT_DB_PATH"))
    ap.add_argument("--out-dir", default=os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "uct-mi-review"))
    ap.add_argument("--only", default="breadth,technical,econ,cot,compound")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # Windows consoles default to cp1252
    only = set(a.only.split(","))

    os.makedirs(a.out_dir, exist_ok=True)
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = os.path.join(a.out_dir, f"mi-review-{stamp}.md")
    os.environ["DATA_DIR"] = a.data_dir
    os.environ["ECON_SERVING_SOURCE"] = "db"
    if a.econ_db:
        os.environ["ECON_DB_PATH"] = a.econ_db
    if a.cot_db:
        os.environ["COT_DB_PATH"] = a.cot_db
    _install_network_guard()
    _install_readonly_sqlite()
    _install_write_guard(a.out_dir)
    sys.path.insert(0, REPO)

    import contextlib
    from api.services.market_intel import event_study as _es
    # every invariant (and the look-ahead comparison) must see EVERY event, not the latest 60 the
    # member-facing result lists (the first real run compared capped lists and misread it as a defect)
    _es.MAX_EVENTS_LISTED = 10 ** 9
    rep = Report()
    print(f"market_intel_review: values → {out_path} (LOCAL ONLY — never paste into an AI tool)")

    def guarded(tag, fn):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 -- a failed section is a FAIL, the review continues
            rep.check(f"{tag}: ran without error ({type(exc).__name__})", False)
            rep.add(f"{tag} — error", "```\n" + traceback.format_exc() + "\n```")

    if "breadth" in only:
        guarded("breadth", lambda: _study(rep, "breadth NASDAQ %>50SMA < 20 → QQQ", {
            "condition": {"series": {"kind": "breadth", "universe": "nasdaq", "metric": "pct_above_50sma"},
                          "op": "below", "threshold": 20},
            "symbol": "QQQ", "horizons": [{"sessions": 5}, {"sessions": 21}, {"months": 3}]}))

    if "technical" in only:
        guarded("technical", lambda: _study(rep, "technical QQQ RSI14 < 30 → QQQ", {
            "condition": {"series": {"kind": "technical", "symbol": "QQQ", "indicator": "rsi", "period": 14},
                          "op": "below", "threshold": 30},
            "symbol": "QQQ", "horizons": [{"sessions": 5}, {"months": 3}]}))

    if "econ" in only:
        def econ():
            from api.services.econ import publish as P
            from api.services.market_intel import series_adapters as sa
            for tag, req in [
                ("econ CPI YoY change < 0 → QQQ", {"condition": {"series": {"kind": "econ", "symbol": "USCPIYOY"},
                 "op": "below", "threshold": 0, "transform": "change"}, "symbol": "QQQ",
                 "horizons": [{"sessions": 1}, {"sessions": 21}], "episodes": "all", "start": "2000-01-01"}),
                ("econ UNRATE crosses above 5 → SPY", {"condition": {"series": {"kind": "econ", "symbol": "USUNRATE"},
                 "op": "cross_above", "threshold": 5}, "symbol": "SPY", "horizons": [{"sessions": 63}, {"months": 12}]}),
                ("econ every CPI release → QQQ", {"condition": {"series": {"kind": "econ", "symbol": "USCPI"},
                 "op": "on_release"}, "symbol": "QQQ", "horizons": [{"sessions": 1}, {"sessions": 5}],
                 "start": "2001-01-01"}),
            ]:
                _study(rep, tag, req)
            real = P.build_vintages_payload

            @contextlib.contextmanager
            def cut(day):
                end = sa_end(day)
                def known_by(st, sym):
                    doc = real(st, sym)
                    return {**doc, "rows": [r for r in doc["rows"] if r[2] <= end]}
                P.build_vintages_payload = known_by
                try:
                    yield
                finally:
                    P.build_vintages_payload = real

            def sa_end(day):
                from api.services import session_calendar as sc
                return int(_dt.datetime.fromisoformat(day).replace(hour=16, tzinfo=sc.ET).timestamp())
            cuts = ["2008-09-15", "2015-06-30", "2020-03-31", "2023-12-29"]
            future_invariance(rep, "econ look-ahead (CPI YoY change<0, vintage cutoffs)",
                              {"condition": {"series": {"kind": "econ", "symbol": "USCPIYOY"}, "op": "below",
                                             "threshold": 0, "transform": "change"}, "symbol": "QQQ",
                               "horizons": [{"sessions": 1}], "episodes": "all"}, cut, cuts)
            # PIT: every row is dated at/after its vintage's release session
            from api.services.econ import serving as S
            st = S._open_db()
            try:
                vrows = real(st, "USCPIYOY")["rows"]
            finally:
                st.close()
            rows, prof = sa.econ_pit_rows(vrows)
            first_known = {}
            for ps, pe, t, v, pit, rid in vrows:
                first_known.setdefault(sa.session_of(t), True)
            rep.check(f"econ: {len(rows)} PIT rows, each on a session some vintage was released",
                      all(d in first_known for d, _ in rows))
            print(f"     econ USCPIYOY pit classes {prof}")
        guarded("econ", econ)

    if "cot" in only:
        def cot():
            from api.services import cot_service
            from api.services.market_indicators import cot_release, registry as reg, series as ser
            if not os.path.exists(cot_service.DB_PATH):
                rep.check(f"cot: local store present at {cot_service.DB_PATH}", False)
                return
            row = reg.resolve("COT:GC:LARGE")
            obs = ser.cot_observations(row) if row else []
            rep.check(f"cot: GC large-spec history read ({len(obs)} weekly reports)", len(obs) > 500)
            # publication-date handling: public day is a weekday, ≥ 3 days after the Tuesday as-of
            # (normally the Friday), and the gap is bounded except at known shutdown catch-ups
            lag = [(_dt.date.fromisoformat(o["t"]) - _dt.date.fromisoformat(o["asof"])).days for o in obs]
            rep.check("cot: every public day is a weekday", all(_dt.date.fromisoformat(o["t"]).weekday() < 5 for o in obs))
            rep.check("cot: no report is public before 3 days after its as-of Tuesday", all(x >= 3 for x in lag))
            late = sorted({o["asof"][:7] for o, x in zip(obs, lag) if x > 7})
            print(f"     cot: {sum(1 for x in lag if x <= 7)} reports public within a week; "
                  f"{sum(1 for x in lag if x > 7)} later (months: {', '.join(late[:20])})")
            years: dict[str, int] = {}
            for o in obs:
                years[o["asof"][:4]] = years.get(o["asof"][:4], 0) + 1
            this_year = str(_dt.date.today().year)
            odd = {y: n for y, n in years.items() if not 50 <= n <= 53 and y not in (min(years), this_year)}
            print(f"     cot: years {min(years)}–{max(years)}; years with unusual report counts: {odd}")
            rep.check("cot: reports ordered by public day", [o["t"] for o in obs] == sorted(o["t"] for o in obs))
            req = {"condition": {"series": {"kind": "cot", "market": "GC", "group": "large_spec"},
                                 "op": "cross_below", "threshold": 0}, "symbol": "GLD",
                   "horizons": [{"sessions": 21}, {"months": 3}]}
            _study(rep, "cot GC large-spec net crosses below 0 → GLD", req)
            _study(rep, "cot every GC report → GLD", {"condition": {"series": {"kind": "cot", "market": "GC",
                   "group": "large_spec"}, "op": "on_release"}, "symbol": "GLD", "horizons": [{"sessions": 1}]})
            real = ser.cot_observations

            @contextlib.contextmanager
            def cut(day):
                ser.cot_observations = lambda r: [o for o in real(r) if o["t"] <= day]
                try:
                    yield
                finally:
                    ser.cot_observations = real
            future_invariance(rep, "cot look-ahead (GC cross_below 0, public-day cutoffs)",
                              {**req, "horizons": [{"sessions": 1}], "episodes": "all"}, cut,
                              # inside the 2018-19 and 2025 shutdown lapses, and two ordinary weeks
                              ["2019-01-25", "2021-06-25", "2024-06-28", "2025-10-31"])
            _ = cot_release
        guarded("cot", cot)

    if "compound" in only:
        guarded("compound", lambda: _study(rep, "compound QQQ RSI14 < 35 AND CPI YoY change < 0 → QQQ", {
            "condition": {"all": [
                {"series": {"kind": "technical", "symbol": "QQQ", "indicator": "rsi", "period": 14}, "op": "below", "threshold": 35},
                {"series": {"kind": "econ", "symbol": "USCPIYOY"}, "op": "below", "threshold": 0, "transform": "change"}]},
            "symbol": "QQQ", "horizons": [{"sessions": 21}], "episodes": "first"}))

    head = (f"# Market Intelligence real-value review — {stamp}\n\n⛔ LOCAL ONLY. Licensed market data. "
            f"Never paste into an AI tool, attach, or commit.\n\nInvariant failures: {rep.fails}\n"
            f"Not reviewed (unavailable here): {rep.not_reviewed}\n\n")
    with builtins.open(out_path, "w", encoding="utf-8") as f:
        f.write(head + "\n".join(rep.sections))
    for nr in rep.not_reviewed:
        print(f"NOT REVIEWED: {nr}")
    print(f"FAILED INVARIANTS: {rep.fails}; NOT REVIEWED: {len(rep.not_reviewed)}   (values written to {out_path})")
    return 1 if rep.fails else 0


if __name__ == "__main__":
    sys.exit(main())
