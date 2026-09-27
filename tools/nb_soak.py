"""The 30-day soak — the daily roll-up, the standing dashboard, and the alerts.

    python nb_soak.py                       # roll up, write the dashboard, send due alerts
    python nb_soak.py --dry-run             # roll up and print; write nothing, send nothing
    python nb_soak.py --no-alerts           # write the dashboard, send nothing

Wave 9, lane 9C (rulings D-9C1..D-9C5). The soak's EVIDENCE is written by other
instruments; this file only READS it and says what it adds up to:

  the soak's own observation log   `tools/nb_observe.py`, one Q1 row / 2 h   NB_OBSERVE_LOG
  the soak sidecar                 one JSON line / 2 h (C6)                 NB_SOAK_SAMPLES
  every Sunday verdict             `tools/nb_gate.py` outputs, archived     NB_SOAK_VERDICTS
  the mini-canary rows             `window_check.py`, THE WINDOW-WATCH LOG   NB_RESUME_DOC
  the restore-drill reports        `authdb_restore_drill.py --report`       NB_SOAK_DRILLS
  the owner's rulings              a markdown file the owner writes         NB_SOAK_RULED
  incident files                   one file per member-reported problem     NB_SOAK_INCIDENTS
  the repo checkout                to compare the running copies against    NB_SOAK_REPO

⛔⛔ IT RUNS FROM A COPY OUTSIDE EVERY WORKTREE (like `nb_gate.py`), so every
input is a path by argument or environment variable — never a path derived from
where this file sits in a repo. Its outputs (`soak-dashboard.md`, the alert state)
go beside the observation log.

⛔⛔ THE VERDICT IS ONE OF THREE WORDS, AND TWO OF THEM NEED A REASON.
  PASS          the exposure floor is met (D-9C1), the window is complete, there
                is no CONFIRMED or UNRESOLVED loss, every Sunday verdict is KEEP
                or a written FOREIGN ruling (D-9C5), every week's restore drill
                passed, and every fork is attributed.
  FAIL          a CONFIRMED or UNRESOLVED loss (UNRESOLVED counts as loss), or a
                REVERT Sunday verdict nobody has ruled on.
  INCONCLUSIVE  everything else, with every reason named. A soak over zero
                members is INCONCLUSIVE from day one: "zero data loss" over
                nobody is vacuous, and PASS is never the default.

⛔⛔ UNOBSERVED TIME EXTENDS THE WINDOW. A SKIPPED row, a heartbeat gap, a
signed-out rig or an interval no soak read covers is not a clean interval — it
is listed, and the window's end moves out by its length.

⛔ PAGING POLICY (D-9C3): an alert is sent only for a data-integrity signal, a
heartbeat gap, DRIFT, or a verdict change — NEVER for speed, which is reported
against the budgets and labelled "field: network + device". Each alert goes out
at most once per signal per ET day; the memory of what was sent is a small file
beside the log, not process memory, because this runs once a day and forgets.
The Discord webhook is a LOCAL environment variable (NB_SOAK_DISCORD_WEBHOOK);
blank means a desktop notification through `window_check.notify`, and the
dashboard says "alerts: desktop only".
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request
from zoneinfo import ZoneInfo

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = pathlib.Path(__file__).resolve().parent
ET = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
# The sampler and the gate stamp "ET" with a FIXED -04:00 (`nb_observe.et_now`,
# `nb_gate.main`), whatever the season. Their stamps are read back with the same
# offset, so a stamp means the instant its writer meant. ET DAYS (exposure,
# Sundays, rulings) use the real zone.
STAMP_TZ = dt.timezone(dt.timedelta(hours=-4))

WINDOW_DAYS = 30
INTERVAL = dt.timedelta(hours=2)
GAP_TOLERANCE = dt.timedelta(minutes=20)
PRESERVED_CONFLICTS = 3          # nb_gate's round-3 evidence set: historical, never new
FLOOR = {"organic_identities": 5, "note_edit_days": 100, "active_days": 20}   # D-9C1
COPIES = ("nb_observe.py", "nb_gate.py", "window_check.py", "nb_soak.py")
WEBHOOK_ENV = "NB_SOAK_DISCORD_WEBHOOK"
LOSS_CLASSES = ("CONFIRMED LOSS", "RECOVERED", "NOT LOSS", "UNRESOLVED")

_ROW_AT = re.compile(r"^20\d\d-\d\d-\d\d \d\d:\d\d ET$")
_CANARY_HEAD = re.compile(r"^### (.+?) \u2014 \*\*(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ)\*\*", re.M)
_RULING = re.compile(
    r"^\s*[-*]\s*(VERDICT|FORK|CANARY)\s+(\d{4}-\d{2}-\d{2})\s*:\s*(FOREIGN|ATTRIBUTED|RULED)\b",
    re.I | re.M)


# ─────────────────────────────────────────────────────────────────────────────
# small helpers
# ─────────────────────────────────────────────────────────────────────────────

def parse_iso(value) -> dt.datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        t = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)


def parse_et_stamp(value: str) -> dt.datetime | None:
    """`YYYY-MM-DD HH:MM ET`, as the sampler and the gate write it."""
    try:
        return dt.datetime.strptime(value.strip(), "%Y-%m-%d %H:%M ET").replace(
            tzinfo=STAMP_TZ).astimezone(UTC)
    except (ValueError, AttributeError):
        return None


def et_day(t: dt.datetime) -> dt.date:
    return t.astimezone(ET).date()


def fmt(t: dt.datetime | None) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC") if t else "—"


def days(td: dt.timedelta) -> float:
    return round(td.total_seconds() / 86400.0, 2)


def merge(intervals: list) -> list:
    """Union of `(start, end, why)` intervals; the reasons of merged pieces join."""
    out: list = []
    for a, b, why in sorted((i for i in intervals if i[1] > i[0]), key=lambda i: i[0]):
        if out and a <= out[-1][1]:
            pa, pb, pw = out[-1]
            out[-1] = (pa, max(pb, b), pw if why in pw else f"{pw}; {why}")
        else:
            out.append((a, b, why))
    return out


def clip(intervals: list, lo: dt.datetime, hi: dt.datetime) -> list:
    return [(max(a, lo), min(b, hi), w) for a, b, w in intervals if min(b, hi) > max(a, lo)]


def total(intervals: list) -> dt.timedelta:
    return sum((b - a for a, b, _ in intervals), dt.timedelta())


# ─────────────────────────────────────────────────────────────────────────────
# readers — PURE: text in, records out
# ─────────────────────────────────────────────────────────────────────────────

def parse_q1_rows(text: str) -> list[dict]:
    """The sampler's rows: `{at, skipped, conflicts, flag}`. Columns are found BY
    NAME from the header block each row sits under (the gate's own rule)."""
    rows, cols = [], None
    for line in (text or "").splitlines():
        if not line.startswith("|") or line.startswith("|---"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if "at (ET)" in line:
            cols = [c.lower() for c in cells]
            continue
        if not cells or not _ROW_AT.match(cells[0]):
            continue
        at = parse_et_stamp(cells[0])
        if at is None:
            continue
        conflicts = None
        if cols:
            idx = next((i for i, c in enumerate(cols) if c.startswith("sync-conflict")), None)
            if idx is not None and idx < len(cells):
                try:
                    conflicts = int(cells[idx])
                except ValueError:
                    conflicts = None
        rows.append({"at": at, "skipped": "SKIPPED" in line, "conflicts": conflicts,
                     "flag": cells[-1] if cells else ""})
    rows.sort(key=lambda r: r["at"])
    return rows


def parse_samples(text: str) -> tuple[list[dict], int]:
    """Sidecar lines as dicts with parsed interval bounds; plus unreadable lines."""
    out, bad = [], 0
    for ln in (text or "").splitlines():
        if not ln.strip():
            continue
        try:
            rec = json.loads(ln)
        except ValueError:
            bad += 1
            continue
        iv = rec.get("interval") if isinstance(rec, dict) else None
        since = parse_iso((iv or {}).get("since"))
        until = parse_iso((iv or {}).get("until"))
        if not isinstance(rec, dict) or since is None or until is None:
            bad += 1
            continue
        rec["_since"], rec["_until"] = since, until
        rec["_ok"] = not rec.get("skipped") and isinstance(rec.get("figures"), dict)
        out.append(rec)
    out.sort(key=lambda r: r["_until"])
    return out, bad


def parse_verdict(text: str) -> dict:
    """One Sunday verdict file: `{at, verdict}` (either may be None)."""
    m = re.search(r"^VERDICT:\s*\*\*(.+?)\*\*", text or "", re.M)
    a = re.search(r"^at:\s*(20\d\d-\d\d-\d\d \d\d:\d\d ET)", text or "", re.M)
    return {"verdict": m.group(1).strip() if m else None,
            "at": parse_et_stamp(a.group(1)) if a else None}


def classify_verdict(verdict: str | None) -> str:
    """`keep` · `keep_no_exposure` · `incomplete` · `revert` · `unreadable`."""
    v = (verdict or "").strip()
    if v.startswith("KEEP"):
        return "keep_no_exposure" if "no independent member exposure" in v else "keep"
    if v.startswith("INCOMPLETE"):
        return "incomplete"
    if v.startswith("REVERT"):
        return "revert"
    return "unreadable"


def parse_canary_doc(text: str) -> dict:
    """Mini-canary rows (`{label, at, state, outbox}`) and a standing SIGN-IN."""
    text = text or ""
    rows = []
    heads = list(_CANARY_HEAD.finditer(text))
    for i, h in enumerate(heads):
        body = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        at = parse_iso(h.group(2))
        mini = re.search(r"\|\s*\*\*mini-canary\*\*\s*\|([^\n]*)", body)
        cell = mini.group(1) if mini else ""
        state = ("finding" if "NEW FINDING" in cell else
                 "green" if "steps green" in cell else
                 "suspended" if "\u26d4" in cell else "not run")
        ob = re.search(r"queue settled[^|]*\|[^|]*outbox\s+\*\*(\d+)\*\*", body)
        rows.append({"label": h.group(1).strip(), "at": at, "state": state,
                     "outbox": int(ob.group(1)) if ob else None})
    signin = None
    if "\u26d4 SIGN-IN REQUIRED" in text:
        f = re.search(r"\| first seen \| \*\*(.+?)\*\* \|", text)
        last = re.search(r"\| last seen \| \*\*(.+?)\*\* \|", text)
        signin = {"first": parse_iso(f.group(1)) if f else None,
                  "last": parse_iso(last.group(1)) if last else None}
    return {"rows": rows, "signin": signin}


def parse_drill(text: str) -> dict | None:
    """`# auth.db restore drill - PASS|FAIL` + `- run at: <iso>`."""
    m = re.search(r"^# auth\.db restore drill - (PASS|FAIL)", text or "", re.M)
    a = re.search(r"^- run at:\s*(\S+)", text or "", re.M)
    if not m:
        return None
    return {"result": m.group(1), "at": parse_iso(a.group(1)) if a else None}


def parse_rulings(text: str) -> dict:
    """`{"VERDICT": {date: word}, "FORK": {...}, "CANARY": {...}}` from lines like
    `- VERDICT 2026-10-11: FOREIGN — why` / `- FORK 2026-10-08: ATTRIBUTED — why`."""
    out: dict = {"VERDICT": {}, "FORK": {}, "CANARY": {}}
    for m in _RULING.finditer(text or ""):
        out[m.group(1).upper()][m.group(2)] = m.group(3).upper()
    return out


def parse_incident(text: str, name: str) -> dict:
    """`class:` one of LOSS_CLASSES; a missing or unknown class is UNRESOLVED —
    an incident nobody has triaged counts as loss until somebody does."""
    c = re.search(r"^class:\s*(.+?)\s*$", text or "", re.M | re.I)
    o = re.search(r"^opened:\s*(\d{4}-\d{2}-\d{2})", text or "", re.M | re.I)
    cls = c.group(1).strip().upper() if c else ""
    return {"name": name, "class": cls if cls in LOSS_CLASSES else "UNRESOLVED",
            "opened": o.group(1) if o else None,
            "declared": bool(c) and cls in LOSS_CLASSES}


def drift_line(name: str, copy_bytes: bytes | None, repo_bytes: bytes | None) -> dict:
    """DRIFT when the running copy's CONTENT differs from the repo's. Line endings
    alone are not drift (the copies were taken from a CRLF checkout); both raw
    sha256 are printed, because those are the numbers anyone will re-measure."""
    if copy_bytes is None:
        return {"name": name, "state": "not deployed", "copy": None, "repo": None}
    if repo_bytes is None:
        return {"name": name, "state": "not in repo", "copy": None, "repo": None}
    raw_c, raw_r = hashlib.sha256(copy_bytes).hexdigest(), hashlib.sha256(repo_bytes).hexdigest()
    same = copy_bytes.replace(b"\r", b"") == repo_bytes.replace(b"\r", b"")
    return {"name": name, "state": "equal" if same else "DRIFT", "copy": raw_c, "repo": raw_r}


# ─────────────────────────────────────────────────────────────────────────────
# the roll-up — PURE
# ─────────────────────────────────────────────────────────────────────────────

def unobserved_intervals(start, now, rows, samples, signin) -> list:
    """Every interval inside `[start, now]` the soak did NOT observe."""
    horizon = now - INTERVAL - GAP_TOLERANCE      # time before this is expected covered
    ivs = []
    rows = [r for r in rows if start - INTERVAL < r["at"] <= now]
    if not rows:
        if horizon > start:
            ivs.append((start, now, "no observation row at all"))
    else:
        if rows[0]["at"] - INTERVAL > start + GAP_TOLERANCE:
            ivs.append((start, rows[0]["at"] - INTERVAL, "no observation row before the first"))
        prev = None
        for r in rows:
            if r["skipped"]:
                ivs.append((r["at"] - INTERVAL, r["at"], f"SKIPPED row {fmt(r['at'])}"))
            if prev is not None and r["at"] - prev["at"] > INTERVAL + GAP_TOLERANCE:
                ivs.append((prev["at"], r["at"] - INTERVAL,
                            f"heartbeat gap: no row between {fmt(prev['at'])} and {fmt(r['at'])}"))
            prev = r
        if horizon > rows[-1]["at"]:
            ivs.append((rows[-1]["at"], now, f"heartbeat gap: no row since {fmt(rows[-1]['at'])}"))
    # the server read: time no SUCCESSFUL sidecar interval covers
    covered = merge([(s["_since"], s["_until"], "read") for s in samples if s["_ok"]])
    cursor = start
    for a, b, _ in covered:
        if a > cursor + GAP_TOLERANCE:
            ivs.append((cursor, a, "no soak read covers this interval"))
        cursor = max(cursor, b)
    if horizon > cursor + GAP_TOLERANCE:
        ivs.append((cursor, now, "no soak read covers this interval (latest read failing or absent)"))
    if signin and signin.get("first"):
        ivs.append((signin["first"], now, "the rig is signed out (SIGN-IN REQUIRED standing)"))
    return merge(clip(ivs, start, now))


def window(start, now, unobserved) -> dict:
    lost = total(unobserved)
    end = start + dt.timedelta(days=WINDOW_DAYS) + lost
    upto = min(now, end)
    return {"start": start, "nominal_end": start + dt.timedelta(days=WINDOW_DAYS), "end": end,
            "complete": now >= end, "unobserved": unobserved, "unobserved_total": lost,
            "elapsed": upto - start, "observed": (upto - start) - lost}


def exposure(start, end, samples) -> dict:
    """Per ET day, the LARGEST figure any sample reported (each is a lower
    bound; see notebook_soak.py). Identities: the newest cumulative read."""
    first, last = et_day(start), et_day(end)
    edits: dict = {}
    ids_by_day: dict = {}
    for s in samples:
        if not s["_ok"]:
            continue
        ex = s["figures"].get("exposure") or {}
        for d, n in ((ex.get("note_edits_by_day") or {}).get("organic") or {}).items():
            if isinstance(n, int) and first.isoformat() <= d <= last.isoformat():
                edits[d] = max(edits.get(d, 0), n)
        for d, n in ((ex.get("identities_editing_by_day") or {}).get("organic") or {}).items():
            if isinstance(n, int) and first.isoformat() <= d <= last.isoformat():
                ids_by_day[d] = max(ids_by_day.get(d, 0), n)
    cum = next((s["cumulative"] for s in reversed(samples)
                if s["_ok"] and isinstance(s.get("cumulative"), dict)
                and not s["cumulative"].get("skipped")), None)
    if cum and isinstance((cum.get("identities_editing") or {}).get("organic"), int):
        ids, basis = cum["identities_editing"]["organic"], "exact, from the soak's first minute"
        if cum.get("clamped") or parse_iso(cum.get("since")) != start:
            basis = f"from {cum.get('since')} (not the soak start) — a lower bound"
    else:
        ids = max(ids_by_day.values(), default=0)
        basis = "lower bound: the largest single day (no cumulative read — set NB_SOAK_START)"
    return {"by_day": dict(sorted(edits.items())), "note_edit_days": sum(edits.values()),
            "active_days": sum(1 for n in edits.values() if n > 0),
            "organic_identities": ids, "identities_basis": basis}


def signals(start, now, end, samples, rows, canary, rulings) -> dict:
    """Integrity signals by population, summed over successful sidecar intervals
    inside the window."""
    upto = min(now, end)
    pops = ("organic", "synthetic", "rig_owner", "unknown_internal", "unresolved")
    sf = {p: {} for p in pops}
    forks_events = {p: 0 for p in pops}
    blocked = {p: 0 for p in pops}
    copies_off = {p: 0 for p in pops}
    copies_conn = {p: 0 for p in pops}
    errors = {p: 0 for p in pops}
    anonymous = 0
    fork_days: dict = {}
    day_events: dict = {}
    day_copies: dict = {}
    for s in samples:
        if not s["_ok"] or s["_until"] <= start or s["_since"] >= upto:
            continue
        f = s["figures"]
        day = et_day(s["_until"] - dt.timedelta(seconds=1)).isoformat()
        ev = f.get("events") or {}
        for p in pops:
            cell = (ev.get("save_failed") or {}).get(p) or {}
            for reason, n in (cell.get("by_reason") or {}).items():
                if n:
                    sf[p][reason] = sf[p].get(reason, 0) + n
            forks_events[p] += int(((ev.get("conflict_forked") or {}).get(p) or {}).get("events") or 0)
            blocked[p] += int(((ev.get("notebook_blocked_no_baseline") or {}).get(p) or {}).get("events") or 0)
            cc = f.get("conflicted_copies") or {}
            copies_off[p] += int((cc.get("offline_layer") or {}).get(p) or 0)
            copies_conn[p] += int((cc.get("connector") or {}).get(p) or 0)
            errors[p] += int((((f.get("client_errors") or {}).get("by_population") or {}).get(p) or {}).get("errors") or 0)
        anonymous += int((f.get("client_errors") or {}).get("anonymous_errors") or 0)
        day_events[day] = day_events.get(day, 0) + int(
            ((ev.get("conflict_forked") or {}).get("organic") or {}).get("events") or 0)
        day_copies[day] = day_copies.get(day, 0) + int(
            ((f.get("conflicted_copies") or {}).get("offline_layer") or {}).get("organic") or 0)
    # ⛔ ONE FORK WRITES BOTH a conflicted copy AND a `conflict_forked` event (the browser
    # check's run 2 read "2 fork(s)" off one of each). Their SUM counts every fork twice; the
    # larger of the two, per ET day, is the best lower bound — and taken per DAY, not per
    # interval, because the event can land in the read after the one that saw the copy.
    for d in sorted(set(day_events) | set(day_copies)):
        n_fork = max(day_events.get(d, 0), day_copies.get(d, 0))
        if n_fork:
            fork_days[d] = n_fork
    # trigger 2's own reading: the rig account's sync-conflict count ROSE
    peak = PRESERVED_CONFLICTS
    for r in rows:
        if r["skipped"] or r["conflicts"] is None or not (start <= r["at"] <= upto):
            continue
        if r["conflicts"] > peak:
            d = et_day(r["at"]).isoformat()
            fork_days[d] = fork_days.get(d, 0) + (r["conflicts"] - peak)
            peak = r["conflicts"]
    unattributed = {d: n for d, n in sorted(fork_days.items())
                    if rulings["FORK"].get(d) != "ATTRIBUTED"}
    canary_rows = [c for c in canary["rows"] if c["at"] and start <= c["at"] <= upto]
    unsettled = [c for c in canary_rows if (c["outbox"] or 0) > 0
                 and rulings["CANARY"].get(et_day(c["at"]).isoformat()) != "RULED"]
    findings = [c for c in canary_rows if c["state"] == "finding"
                and rulings["CANARY"].get(et_day(c["at"]).isoformat()) != "RULED"]
    return {"save_failed": sf, "conflict_forked": forks_events, "blocked": blocked,
            "conflicted_copies_offline": copies_off, "conflicted_copies_connector": copies_conn,
            "client_errors": errors, "anonymous_errors": anonymous,
            "fork_days": dict(sorted(fork_days.items())), "unattributed_forks": unattributed,
            "canary_runs": len(canary_rows), "canary_unsettled": unsettled,
            "canary_findings": findings}


def sunday_verdicts(start, now, end, verdicts, rulings) -> dict:
    """Each Sunday's verdict inside the window, classified; and the Sundays
    that should have one and do not. Two files for one ET day (the archived
    copy and the gate's current file, or a re-run) count ONCE: the latest."""
    by_day: dict = {}
    for v in verdicts:
        if v["at"] is None or not (start <= v["at"] <= max(now, start)):
            continue
        d = et_day(v["at"]).isoformat()
        if d not in by_day or v["at"] > by_day[d]["at"]:
            by_day[d] = v
    inside, seen = [], set()
    for d, v in by_day.items():
        cls = classify_verdict(v["verdict"])
        ruled = rulings["VERDICT"].get(d) == "FOREIGN"
        inside.append({**v, "day": d, "class": cls, "ruled_foreign": ruled})
        seen.add(d)
    missing = []
    d = et_day(start)
    last = et_day(min(now, end))
    while d <= last:
        if d.weekday() == 6:
            due = dt.datetime.combine(d, dt.time(18, 30), tzinfo=ET)
            if start <= due <= now and d.isoformat() not in seen:
                missing.append(d.isoformat())
        d += dt.timedelta(days=1)
    return {"verdicts": sorted(inside, key=lambda x: x["at"]), "missing": missing}


def drill_weeks(start, now, end, drills) -> list:
    """Each fully elapsed 7-day block of the window, and whether a drill PASSED in it."""
    out = []
    k = 0
    upto = min(now, end)
    while start + dt.timedelta(days=7 * (k + 1)) <= upto:
        a, b = start + dt.timedelta(days=7 * k), start + dt.timedelta(days=7 * (k + 1))
        runs = [x for x in drills if x and x["at"] and a <= x["at"] < b]
        out.append({"week": k + 1, "from": a, "to": b,
                    "passed": any(x["result"] == "PASS" for x in runs),
                    "failed": any(x["result"] == "FAIL" for x in runs), "runs": len(runs)})
        k += 1
    return out


def speed_report(samples, budgets: dict | None) -> dict:
    """Field speed vs the plan's budgets. REPORTED, never an alert (D-9C3)."""
    src, basis = None, None
    for s in reversed(samples):
        if s["_ok"] and isinstance(s.get("cumulative"), dict) and isinstance(s["cumulative"].get("speed"), dict):
            src, basis = s["cumulative"]["speed"], "whole soak (cumulative read)"
            break
    if src is None:
        for s in reversed(samples):
            if s["_ok"] and isinstance(s["figures"].get("speed"), dict):
                src, basis = s["figures"]["speed"], "latest 2-hour interval only"
                break
    b = budgets or {}
    limits = {"note_open_ms": (b.get("editor") or {}).get("open_p95_ms_max"),
              "search_used": (b.get("search") or {}).get("p95_ms_max"),
              "ask_used": None}
    rows = []
    for ev, limit in limits.items():
        cell = (((src or {}).get(ev) or {}).get("by_population") or {}).get("organic") or {}
        p95 = cell.get("p95_ms")
        rows.append({"event": ev, "n": cell.get("n", 0), "p50": cell.get("p50_ms"), "p95": p95,
                     "budget": limit,
                     "over": bool(limit is not None and isinstance(p95, (int, float)) and p95 > limit),
                     "capped": bool(((src or {}).get(ev) or {}).get("capped"))})
    return {"basis": basis or "no successful read yet", "rows": rows,
            "label": "field: network + device"}


def build_facts(*, start, start_sha, now, q1_text, samples_text, verdict_texts, canary_text,
                drill_texts, ruled_text, incident_texts, drift, budgets, heartbeat) -> dict:
    # Evidence stamped after `now` cannot be evidence about this run's window
    # (a clock step, or a fixture): read only what had happened by now.
    rows = [r for r in parse_q1_rows(q1_text) if r["at"] <= now]
    samples, bad_lines = parse_samples(samples_text)
    samples = [s for s in samples if s["_until"] <= now]
    canary = parse_canary_doc(canary_text)
    rulings = parse_rulings(ruled_text)
    unobs = unobserved_intervals(start, now, rows, samples, canary["signin"])
    win = window(start, now, unobs)
    latest = samples[-1] if samples else None
    return {
        "now": now, "start_sha": start_sha, "window": win,
        "rows": len([r for r in rows if r["at"] >= start]),
        "samples": len([s for s in samples if s["_until"] > start]),
        "bad_sample_lines": bad_lines,
        "latest_sample": latest,
        "exposure": exposure(start, win["end"], samples),
        "signals": signals(start, now, win["end"], samples, rows, canary, rulings),
        "sundays": sunday_verdicts(start, now, win["end"],
                                   [parse_verdict(t) for t in verdict_texts], rulings),
        "drills": drill_weeks(start, now, win["end"], [parse_drill(t) for t in drill_texts]),
        "incidents": [parse_incident(t, n) for n, t in incident_texts],
        "drift": drift, "speed": speed_report(samples, budgets),
        "config_served": ((latest or {}).get("figures") or {}).get("config_served")
        if latest and latest.get("_ok") else None,
        "signin": canary["signin"], "heartbeat": heartbeat,
    }


def verdict(facts) -> tuple[str, list, list]:
    """`(word, fail_reasons, inconclusive_reasons)`."""
    fail, inc = [], []
    for i in facts["incidents"]:
        if i["class"] == "CONFIRMED LOSS":
            fail.append(f"CONFIRMED LOSS: incident `{i['name']}`")
        elif i["class"] == "UNRESOLVED":
            fail.append(f"UNRESOLVED incident `{i['name']}` counts as loss until it is triaged")
    for v in facts["sundays"]["verdicts"]:
        if v["class"] == "revert" and not v["ruled_foreign"]:
            fail.append(f"Sunday {v['day']} verdict is REVERT and no FOREIGN ruling names it")
        elif v["class"] == "keep_no_exposure":
            inc.append(f"Sunday {v['day']} is KEEP with no independent member exposure")
        elif v["class"] == "incomplete":
            inc.append(f"Sunday {v['day']} verdict is INCOMPLETE (rows the gate could not read)")
        elif v["class"] == "unreadable":
            inc.append(f"Sunday {v['day']} verdict could not be read")
    for d in facts["sundays"]["missing"]:
        inc.append(f"no Sunday verdict for {d}")
    ex = facts["exposure"]
    if ex["organic_identities"] < FLOOR["organic_identities"]:
        inc.append(f"exposure floor: {ex['organic_identities']} organic identities of "
                   f"{FLOOR['organic_identities']} ({ex['identities_basis']})")
    if ex["note_edit_days"] < FLOOR["note_edit_days"]:
        inc.append(f"exposure floor: {ex['note_edit_days']} organic note-edit-days of {FLOOR['note_edit_days']}")
    if ex["active_days"] < FLOOR["active_days"]:
        inc.append(f"exposure floor: {ex['active_days']} active days of {FLOOR['active_days']}")
    sig = facts["signals"]
    for d, n in sig["unattributed_forks"].items():
        inc.append(f"{n} fork(s) on {d} not attributed (add `- FORK {d}: ATTRIBUTED — why`)")
    for c in sig["canary_unsettled"]:
        inc.append(f"mini-canary {c['label']} @ {fmt(c['at'])} left outbox {c['outbox']} (trigger 3)")
    for c in sig["canary_findings"]:
        inc.append(f"mini-canary {c['label']} @ {fmt(c['at'])} wrote a NEW FINDING — triage it")
    for w in facts["drills"]:
        if not w["passed"]:
            inc.append(f"restore drill week {w['week']}: "
                       + ("FAILED and no passing run" if w["failed"] else "no drill report"))
    win = facts["window"]
    if not win["complete"]:
        left = win["end"] - facts["now"]
        inc.append(f"window open: {days(left)} day(s) to go (ends {fmt(win['end'])})")
    if facts["samples"] == 0:
        inc.append("no soak read has ever succeeded (is the admin read deployed?)")
    if fail:
        return "FAIL", fail, inc
    if inc:
        return "INCONCLUSIVE", fail, inc
    return "PASS", fail, inc


def alerts(facts, word: str, previous: str | None) -> list:
    """`[(key, text)]` — integrity, heartbeat, DRIFT and verdict change. NEVER
    speed (D-9C3): the speed report is not even read here."""
    out = []
    sig = facts["signals"]
    for p, n in sig["blocked"].items():
        if n:
            out.append((f"integrity:blocked:{p}", f"{n} blocked-baseline event(s), {p}"))
    for d, n in sig["unattributed_forks"].items():
        out.append((f"integrity:fork:{d}", f"{n} unattributed fork(s) on {d}"))
    if sig["client_errors"].get("organic"):
        out.append(("integrity:client-errors:organic",
                    f"{sig['client_errors']['organic']} Notebook-page client error(s) from organic members"))
    for c in sig["canary_unsettled"]:
        out.append((f"integrity:outbox:{c['label']}@{fmt(c['at'])}",
                    f"mini-canary {c['label']} left outbox {c['outbox']} at its settle step"))
    for c in sig["canary_findings"]:
        out.append((f"integrity:finding:{c['label']}@{fmt(c['at'])}",
                    f"mini-canary {c['label']} wrote a NEW FINDING"))
    for i in facts["incidents"]:
        if i["class"] in ("CONFIRMED LOSS", "UNRESOLVED"):
            out.append((f"integrity:incident:{i['name']}", f"incident {i['name']}: {i['class']}"))
    win = facts["window"]
    for a, b, why in win["unobserved"]:
        if b >= facts["now"] - dt.timedelta(minutes=1):
            out.append((f"heartbeat:{why.split(':')[0]}", f"UNOBSERVED since {fmt(a)}: {why}"))
    hb = facts.get("heartbeat")
    if hb and hb.get("problem"):
        out.append(("heartbeat:scheduled-task", hb["problem"]))
    for d in facts["drift"]:
        if d["state"] == "DRIFT":
            out.append((f"drift:{d['name']}", f"DRIFT {d['name']}: copy {d['copy'][:12]} != repo {d['repo'][:12]}"))
    if previous and previous != word:
        out.append((f"verdict:{previous}->{word}", f"soak verdict changed {previous} -> {word}"))
    return out


def due(alert_list: list, state: dict, today: str) -> tuple[list, dict]:
    """Each alert at most once per signal per ET day."""
    sent = dict(state.get("sent") or {})
    out = []
    for key, text in alert_list:
        if sent.get(key) == today:
            continue
        sent[key] = today
        out.append((key, text))
    return out, {**state, "sent": sent}


# ─────────────────────────────────────────────────────────────────────────────
# rendering — PURE
# ─────────────────────────────────────────────────────────────────────────────

def render_dashboard(facts, word, fail, inc, alerts_mode: str) -> str:
    win, ex, sig = facts["window"], facts["exposure"], facts["signals"]
    L = [f"# Notebook 30-day soak — dashboard", "",
         f"VERDICT: **{word}**", "",
         f"- generated: {fmt(facts['now'])}",
         f"- window: {fmt(win['start'])} → {fmt(win['end'])} "
         f"(30 days + {days(win['unobserved_total'])} unobserved) · production SHA at start: "
         f"`{facts['start_sha'] or 'NOT RECORDED'}`",
         f"- days observed: {days(win['observed'])} · unobserved: {days(win['unobserved_total'])} · "
         f"elapsed: {days(win['elapsed'])}",
         f"- observation rows: {facts['rows']} · soak reads: {facts['samples']}"
         + (f" · unreadable sidecar lines: {facts['bad_sample_lines']}" if facts["bad_sample_lines"] else ""),
         f"- alerts: {alerts_mode}", ""]
    if fail:
        L += ["## Why this is FAIL", ""] + [f"- {r}" for r in fail] + [""]
    if inc:
        L += ["## Why this is not a PASS" if not fail else "## Also open", ""] + [f"- {r}" for r in inc] + [""]
    L += ["## Exposure floor (D-9C1)", "",
          "| measure | now | floor |", "|---|---|---|",
          f"| organic identities | {ex['organic_identities']} | {FLOOR['organic_identities']} |",
          f"| organic note-edit-days | {ex['note_edit_days']} | {FLOOR['note_edit_days']} |",
          f"| active days | {ex['active_days']} | {FLOOR['active_days']} |", "",
          f"Identities: {ex['identities_basis']}. A day's note edits are the largest figure any "
          "two-hour read reported for it (`j2_notes.updated_at` keeps only a note's last edit, "
          "so each read is a lower bound).", ""]
    L += ["## Integrity signals, by population", "",
          "| signal | organic | synthetic | rig/owner | unknown internal | unresolved |",
          "|---|---|---|---|---|---|"]
    pops = ("organic", "synthetic", "rig_owner", "unknown_internal", "unresolved")

    def rowof(name, d):
        return f"| {name} | " + " | ".join(str(d.get(p, 0)) for p in pops) + " |"
    L.append(rowof("conflict_forked events", sig["conflict_forked"]))
    L.append(rowof("offline-layer conflicted copies", sig["conflicted_copies_offline"]))
    L.append(rowof("connector conflicted copies (lower bound)", sig["conflicted_copies_connector"]))
    L.append(rowof("blocked-baseline events", sig["blocked"]))
    L.append(rowof("Notebook-page client errors", sig["client_errors"]))
    L.append(rowof("save_failed (all reasons)",
                   {p: sum(v.values()) for p, v in sig["save_failed"].items()}))
    L += ["", f"Anonymous Notebook-page client errors: {sig['anonymous_errors']}. "
          f"Mini-canary runs in the window: {sig['canary_runs']}.", ""]
    if sig["fork_days"]:
        L += ["Forks by ET day (the larger of organic conflict events and offline copies — one fork "
              "writes both — plus trigger-2 rises): "
              + ", ".join(f"{d}: {n}" + (" (attributed)" if d not in sig["unattributed_forks"] else "")
                          for d, n in sig["fork_days"].items()), ""]
    cs = facts.get("config_served")
    L += ["## Config served (latest read, by identity)", "",
          ("none read yet" if not isinstance(cs, dict) else
           " · ".join(f"{p} {cs.get(p, '0/0')}" for p in pops)), ""]
    sp = facts["speed"]
    L += [f"## Field speed — {sp['label']} (reported, never paged)", "",
          f"Basis: {sp['basis']}.", "",
          "| event | n | p50 ms | p95 ms | budget p95 ms | |", "|---|---|---|---|---|---|"]
    for r in sp["rows"]:
        L.append(f"| {r['event']} | {r['n']} | {r['p50'] if r['p50'] is not None else '—'} | "
                 f"{r['p95'] if r['p95'] is not None else '—'} | "
                 f"{r['budget'] if r['budget'] is not None else 'no budget set'} | "
                 f"{'over budget' if r['over'] else ''}{' · capped read' if r['capped'] else ''} |")
    L += ["", "## Sunday verdicts", ""]
    if not facts["sundays"]["verdicts"] and not facts["sundays"]["missing"]:
        L.append("none due yet")
    for v in facts["sundays"]["verdicts"]:
        L.append(f"- {v['day']}: `{v['verdict']}`" + (" — ruled FOREIGN" if v["ruled_foreign"] else ""))
    for d in facts["sundays"]["missing"]:
        L.append(f"- {d}: NO VERDICT FILE")
    L += ["", "## Restore drills (one PASS per 7-day block)", ""]
    if not facts["drills"]:
        L.append("no full week elapsed yet")
    for w in facts["drills"]:
        L.append(f"- week {w['week']} ({fmt(w['from'])} → {fmt(w['to'])}): "
                 + ("PASS" if w["passed"] else ("FAIL" if w["failed"] else "no report")))
    L += ["", "## Incidents", ""]
    if not facts["incidents"]:
        L.append("none filed")
    for i in facts["incidents"]:
        L.append(f"- `{i['name']}` — {i['class']}" + ("" if i["declared"] else " (no `class:` line: counted UNRESOLVED)"))
    L += ["", "## Unobserved intervals (each extends the window)", ""]
    if not win["unobserved"]:
        L.append("none")
    for a, b, why in win["unobserved"]:
        L.append(f"- {fmt(a)} → {fmt(b)} ({days(b - a)} d): {why}")
    L += ["", "## Heartbeats", ""]
    hb = facts.get("heartbeat") or {}
    L.append(f"- scheduled task: {hb.get('text', 'not checked')}")
    L.append(f"- rig sign-in: " + ("SIGN-IN REQUIRED since " + fmt(facts['signin'].get('first'))
                                   if facts.get("signin") else "no standing SIGN-IN REQUIRED row"))
    ls = facts.get("latest_sample")
    L.append("- admin read (C5): " + ("never read" if not ls else
                                        (f"OK at {fmt(ls['_until'])}" if ls["_ok"]
                                         else f"FAILING — {ls.get('skipped')}")))
    L += ["", "## Running copies vs the repo", ""]
    for d in facts["drift"]:
        if d["state"] in ("equal", "DRIFT"):
            L.append(f"- {'**DRIFT**' if d['state'] == 'DRIFT' else 'equal'} `{d['name']}` — copy "
                     f"`{d['copy'][:12]}` · repo `{d['repo'][:12]}`")
        else:
            L.append(f"- `{d['name']}` — {d['state']}")
    L.append("")
    return "\n".join(L)


def stdout_line(facts, word, fail, inc, n_alerts) -> str:
    win, ex = facts["window"], facts["exposure"]
    drift = sum(1 for d in facts["drift"] if d["state"] == "DRIFT")
    return (f"{fmt(facts['now'])} soak {word} · day {days(win['elapsed'])}/{WINDOW_DAYS} "
            f"(+{days(win['unobserved_total'])} unobserved) · organic {ex['organic_identities']}/"
            f"{FLOOR['organic_identities']} · edit-days {ex['note_edit_days']}/{FLOOR['note_edit_days']} · "
            f"active {ex['active_days']}/{FLOOR['active_days']} · reasons {len(fail) + len(inc)} · "
            f"alerts {n_alerts} · drift {drift}")


# ─────────────────────────────────────────────────────────────────────────────
# the edges: files, the scheduled task, delivery
# ─────────────────────────────────────────────────────────────────────────────

def _read(path) -> str:
    try:
        return pathlib.Path(path).read_text(encoding="utf-8", errors="replace") if path else ""
    except OSError:
        return ""


def _files(spec: str | None) -> list:
    """A directory (every file in it), a glob, or one file."""
    if not spec:
        return []
    p = pathlib.Path(spec)
    if p.is_dir():
        return sorted(x for x in p.iterdir() if x.is_file())
    if any(ch in spec for ch in "*?["):
        return sorted(pathlib.Path(x) for x in __import__("glob").glob(spec))
    return [p] if p.is_file() else []


def scheduled_task(name: str = "UCT-WaveQ1-Observe", now=None) -> dict:
    """Task Scheduler is the only signal that the sampler RAN at all."""
    try:
        out = subprocess.run(["schtasks", "/Query", "/TN", name, "/FO", "LIST", "/V"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace",
                             timeout=60).stdout
    except Exception as e:  # noqa: BLE001
        return {"text": f"could not query ({type(e).__name__})", "problem": f"schtasks unreadable: {type(e).__name__}"}
    last = re.search(r"Last Run Time:\s*(.+)", out)
    res = re.search(r"Last Result:\s*(.+)", out)
    text = f"Last Run Time {last.group(1).strip() if last else 'UNREADABLE'} | Last Result {res.group(1).strip() if res else 'UNREADABLE'}"
    problem = None if (res and res.group(1).strip() == "0") else f"scheduled task: {text}"
    return {"text": text, "problem": problem}


def send(items: list, webhook: str, notify=None, post=None) -> int:
    """Discord when a webhook is set; otherwise the desktop balloon."""
    if not items:
        return 0
    body = "\n".join(f"- {t}" for _, t in items)[:1900]
    if webhook:
        post = post or _post
        post(webhook, {"content": "**UCT Notebook soak**\n" + body})
    else:
        if notify is None:
            sys.path.insert(0, str(HERE))
            import window_check  # noqa: E402  — the copy beside this file
            notify = window_check.notify
        notify("UCT Notebook soak", body[:250])
    return len(items)


def _post(url: str, payload: dict) -> None:
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "uct-nb-soak/1"}, method="POST")
    urllib.request.urlopen(req, timeout=20).read()


def archive_verdict(current: pathlib.Path, into: pathlib.Path) -> pathlib.Path | None:
    """Keep this week's Sunday verdict. `nb_gate.py` OVERWRITES one file
    (NB_GATE_VERDICT) every run, so without a copy the soak would only ever see
    the newest Sunday. The copy is named by the verdict's own `at:` date and is
    NEVER overwritten: an identical copy is left alone, a different verdict for
    the same day (a re-run) gets its own file beside it."""
    if not current.is_file():
        return None
    raw = current.read_bytes()
    v = parse_verdict(raw.decode("utf-8", errors="replace"))
    if v["at"] is None:
        return None
    stamp = v["at"].astimezone(STAMP_TZ)
    into.mkdir(parents=True, exist_ok=True)
    for name in (f"soak-gate-verdict-{stamp:%Y-%m-%d}.md", f"soak-gate-verdict-{stamp:%Y-%m-%d-%H%M}.md"):
        target = into / name
        if target.exists():
            if target.read_bytes() == raw:
                return target
            continue
        target.write_bytes(raw)
        return target
    return None


def _atomic_write(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def main(argv=None, now: dt.datetime | None = None) -> int:
    env = os.environ.get
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", default=env("NB_OBSERVE_LOG", ""))
    ap.add_argument("--samples", default=env("NB_SOAK_SAMPLES", ""))
    ap.add_argument("--verdicts", default=env("NB_SOAK_VERDICTS", ""))
    # the gate's CURRENT verdict file — the same variable nb_gate.py writes to
    ap.add_argument("--verdict-current", default=env("NB_GATE_VERDICT", ""))
    ap.add_argument("--canary-doc", default=env("NB_RESUME_DOC", ""))
    ap.add_argument("--drills", default=env("NB_SOAK_DRILLS", ""))
    ap.add_argument("--ruled", default=env("NB_SOAK_RULED", ""))
    ap.add_argument("--incidents", default=env("NB_SOAK_INCIDENTS", ""))
    ap.add_argument("--repo", default=env("NB_SOAK_REPO", "") or env("NB_GATE_REPO", ""))
    ap.add_argument("--copies", default=env("NB_SOAK_COPIES", "") or str(HERE))
    ap.add_argument("--start", default=env("NB_SOAK_START", ""))
    ap.add_argument("--start-sha", default=env("NB_SOAK_START_SHA", ""))
    ap.add_argument("--out", default=env("NB_SOAK_DASHBOARD", ""))
    ap.add_argument("--state", default=env("NB_SOAK_ALERT_STATE", ""))
    ap.add_argument("--no-schtasks", action="store_true")
    ap.add_argument("--no-alerts", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    if not a.log:
        print("STOP: no observation log (NB_OBSERVE_LOG / --log) — nothing to roll up")
        return 2
    log = pathlib.Path(a.log)
    start = parse_iso(a.start)
    if start is None:
        print("STOP: no soak start (NB_SOAK_START / --start, ISO UTC) — the window has no first minute")
        return 2
    now = now or dt.datetime.now(UTC)
    samples_path = pathlib.Path(a.samples) if a.samples else log.parent / "soak-samples.jsonl"
    out = pathlib.Path(a.out) if a.out else log.parent / "soak-dashboard.md"
    state_path = pathlib.Path(a.state) if a.state else log.parent / "soak-alert-state.json"

    repo = pathlib.Path(a.repo) if a.repo else None
    drift = []
    for name in COPIES:
        cp = pathlib.Path(a.copies) / name
        rp = (repo / "tools" / name) if repo else None
        drift.append(drift_line(name, cp.read_bytes() if cp.is_file() else None,
                                rp.read_bytes() if rp and rp.is_file() else None)
                     if repo else {"name": name, "state": "not checked (no repo given)",
                                   "copy": None, "repo": None})
    # The archive is a DIRECTORY (a glob or a single file cannot be archived into).
    if (a.verdict_current and a.verdicts and not a.dry_run
            and not any(ch in a.verdicts for ch in "*?[") and not pathlib.Path(a.verdicts).is_file()):
        archive_verdict(pathlib.Path(a.verdict_current), pathlib.Path(a.verdicts))
    verdict_files = _files(a.verdicts) + ([pathlib.Path(a.verdict_current)]
                                          if a.verdict_current and pathlib.Path(a.verdict_current).is_file()
                                          else [])
    budgets = None
    if repo and (repo / "docs" / "notebook" / "perf-budgets.json").is_file():
        budgets = json.loads(_read(repo / "docs" / "notebook" / "perf-budgets.json"))

    facts = build_facts(
        start=start, start_sha=a.start_sha, now=now,
        q1_text=_read(log), samples_text=_read(samples_path),
        verdict_texts=[_read(p) for p in verdict_files],
        canary_text=_read(a.canary_doc), drill_texts=[_read(p) for p in _files(a.drills)],
        ruled_text=_read(a.ruled),
        incident_texts=[(p.name, _read(p)) for p in _files(a.incidents)],
        drift=drift, budgets=budgets,
        heartbeat=None if a.no_schtasks else scheduled_task(now=now))
    word, fail, inc = verdict(facts)
    try:
        state = json.loads(_read(state_path) or "{}")
    except ValueError:
        state = {}
    webhook = (env(WEBHOOK_ENV, "") or "").strip()
    mode = "Discord webhook (local env var)" if webhook else "desktop only"
    if a.no_alerts or a.dry_run:
        mode += " — SUPPRESSED this run"
    items, new_state = due(alerts(facts, word, state.get("last_verdict")), state,
                           et_day(now).isoformat())
    board = render_dashboard(facts, word, fail, inc, mode)
    if a.dry_run:
        print(board)
        print(stdout_line(facts, word, fail, inc, len(items)))
        return 0
    _atomic_write(out, board)
    if not a.no_alerts:
        try:
            send(items, webhook)
        except Exception as e:  # noqa: BLE001
            # ⛔ An alert that did not go out is NOT recorded as sent: the state
            # file is left alone, so the next run tries again.
            print(f"alerts NOT sent: {type(e).__name__}: {e}")
            print(stdout_line(facts, word, fail, inc, 0))
            return 1
        new_state["last_verdict"] = word
        _atomic_write(state_path, json.dumps(new_state, indent=1, sort_keys=True) + "\n")
    print(stdout_line(facts, word, fail, inc, 0 if a.no_alerts else len(items)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
