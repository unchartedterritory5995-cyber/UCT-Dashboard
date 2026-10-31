# -*- coding: utf-8 -*-
"""triage.py - the indicator support loop's local triage tool (Phase B).

Run by a person or a Claude session on this PC. Spec: docs/pine/support-loop/PHASE-B.md.

    python tools/support_loop/triage.py digest [--refresh] [--json]
    python tools/support_loop/triage.py gap ta.alma [--kind name-unknown] [--cache DIR] [--ref REF.json]
    python tools/support_loop/triage.py report <32-hex id> [--cache DIR] [--no-status]
    python tools/support_loop/triage.py mark-fixed --gap ta.alma [--force]
    python tools/support_loop/triage.py mark-fixed --report <id> [--report <id> ...] [--wontfix]
    python tools/support_loop/triage.py purge [--closed | <id>]

Server: --url (or UCT_SUPPORT_LOOP_URL), default http://127.0.0.1:8000. Credential:
the PUSH_SECRET bearer from this shell's environment (never a sign-in, never printed).
--digest-file reads a saved digest instead of the server (offline triage of a gap).

Every packet is written under the gitignored work directory (.support-loop-work/);
a report's packet, source and door output live in reports/<id>/ and are deleted
when the report is closed (mark-fixed / purge). Nothing here prints member source.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Optional

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from tools.support_loop import door as door_mod  # noqa: E402
from tools.support_loop import packet as packet_mod  # noqa: E402
from tools.support_loop import similar as sim_mod  # noqa: E402
from tools.support_loop import workdir  # noqa: E402
from tools.support_loop.client import ClientError, SupportLoopClient  # noqa: E402

BUILTINS = json.loads((REPO / "app/src/components/chart/supportLoop/pineBuiltins.json")
                      .read_text(encoding="utf-8"))["names"]
DOOR_MANIFEST = REPO / "app/src/components/chart/supportLoop/doorNameCoverage.json"



def _unknown_name_guards() -> tuple:
    """``doorCoverage.js::UNKNOWN_NAME_GUARDS``, READ from the source, never re-typed:
    the member's gap kind and this tool's must be the same classification."""
    import re
    src = (REPO / "app/src/components/chart/engine/ast/doorCoverage.js").read_text(encoding="utf-8")
    m = re.search(r"UNKNOWN_NAME_GUARDS\s*=\s*Object\.freeze\(\[(.*?)\]\)", src, re.S)
    if not m:
        raise RuntimeError("doorCoverage.js: UNKNOWN_NAME_GUARDS unreadable")
    return tuple(re.findall(r"'([^']+)'", m.group(1)))


UNKNOWN_NAME_GUARDS = _unknown_name_guards()


def master_sha() -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short=10", "HEAD"],
                              capture_output=True, text=True, timeout=20).stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def door_manifest() -> dict:
    try:
        return json.loads(DOOR_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def probe_script(expr: str) -> str:
    return f'//@version=5\nindicator("support-loop repro")\nplot({expr})\n'


def reference_example(ref: Optional[Path], name: str) -> Optional[str]:
    """TradingView's OWN example for the item, when it is a whole script."""
    if not ref or not Path(ref).exists():
        return None
    import re
    data = json.loads(Path(ref).read_text(encoding="utf-8"))
    for coll in ("functions", "variables", "constants", "methods", "keywords", "types"):
        for e in data.get(coll) or []:
            if e.get("name") != name:
                continue
            for ex in e.get("examples") or []:
                if isinstance(ex, str) and re.search(r"^\s*(indicator|study)\s*\(", ex, re.M):
                    return ex
    return None


def demand_for(digest: Optional[dict], name: str, kind: Optional[str]) -> dict:
    out: dict[str, Any] = {"members": None, "reports": []}
    if not digest:
        return out
    out["window_days"] = digest.get("window_days")
    for g in (digest.get("gaps") or {}).get("open") or []:
        if g["name"] == name and (kind is None or g["kind"] == kind):
            out.update({k: g.get(k) for k in ("members", "hits", "first_day", "last_day", "kind")})
            break
    out["reports"] = [r["id"] for r in (digest.get("reports") or {}).get("open") or []
                      if any(x.get("name") == name for x in r.get("gaps") or [])]
    return out


def _case(label: str, row: dict, *, script: Optional[str] = None, path: Optional[str] = None) -> dict:
    return {"label": label, "script": script, "path": path, "attached": row.get("attached"),
            "clean": row.get("clean"), "stuck": row.get("stuck"), "walls": door_mod.walls(row)}


# ─── gap ────────────────────────────────────────────────────────────────────

def triage_gap(name: str, *, kind: Optional[str] = None, digest: Optional[dict] = None,
               cache: Optional[Path] = None, ref: Optional[Path] = None,
               runner: Optional[Callable[..., int]] = None, sample_scripts: int = 3) -> Path:
    if name not in BUILTINS:
        raise SystemExit(f"{name!r} is not in pineBuiltins.json; a gap name is always a Pine built-in")
    d = workdir.gap_dir(name)
    workdir.check_root()
    cmap = sim_mod.load_map()
    manifest = door_manifest()
    dstatus = ((manifest.get("names") or {}).get(name) or {}).get("status")
    items, labels = [], {}
    probes = [("repro-call", probe_script(f"{name}(close, 14)")), ("repro-value", probe_script(name))]
    ex = reference_example(ref, name)
    if ex:
        probes.insert(0, ("tradingview-example", ex))
    for key, text in probes:
        p = workdir.write_gap_file(name, f"{key}.pine", text)
        items.append({"key": key, "path": str(p), "cap": 8})
        labels[key] = ("TradingView's own reference example" if key == "tradingview-example"
                       else f"Minimal repro `{key}`", text, None)
    sim = sim_mod.similar(label=name, name=name, cmap=cmap, cache=cache)
    paths = {}
    for b in sim["blocked_sample"]:
        if len(paths) >= sample_scripts:
            break
        pop, slug = str(b["key"]).split(":", 1)
        p = (REPO / "corpus" / "committed" / f"{slug}.pine") if pop == "committed" else (
            Path(cache) / pop / f"{slug}.pine" if cache else None)
        if p and p.exists():
            paths[b["key"]] = p
    for k, p in paths.items():
        items.append({"key": k, "path": str(p), "cap": 8})
        labels[k] = (f"Sample script `{k}` (blocked by this wall)", None, str(p))
    rows = door_mod.run_door(items, d / "door", runner=runner)
    cases = [_case(labels[i["key"]][0], rows[i["key"]], script=labels[i["key"]][1], path=labels[i["key"]][2])
             for i in items]
    guard = None
    for c in cases:
        for w in c["walls"]:
            if w.get("token") == name:
                guard = w.get("guard")
                break
        if guard:
            break
    if kind is None:
        kind = "name-unknown" if guard in UNKNOWN_NAME_GUARDS else "call-unmapped"
    demand = demand_for(digest, name, kind)
    text = packet_mod.render(
        title=f"`{name}` ({kind})", kind=kind, name=name, guard=guard,
        capability=sim_mod.capability_of(guard), reference=sim_mod.reference_link(cmap, name),
        demand=demand, repro={"cases": cases}, sim=sim, master_sha=master_sha(), door_status=dstatus)
    pk = workdir.write_gap_file(name, "PACKET.md", text)
    workdir.write_gap_file(name, "links.json", json.dumps({"name": name, "kind": kind,
                                                           "reports": demand["reports"]}, indent=1))
    return pk


# ─── report ─────────────────────────────────────────────────────────────────

def triage_report(client, report_id: str, *, cache: Optional[Path] = None,
                  runner: Optional[Callable[..., int]] = None, set_status: bool = True) -> Path:
    r = client.report(report_id)
    rid = r["id"]
    src = workdir.write_report_file(rid, "source.pine", r.get("source") or "")
    if r.get("note"):
        workdir.write_report_file(rid, "note.txt", r["note"])
    rows = door_mod.run_door([{"key": "report", "path": str(src), "cap": 8}],
                             workdir.report_dir(rid) / "door", runner=runner)
    row = rows["report"]
    cmap = sim_mod.load_map()
    names = sim_mod.item_names(cmap)
    ws = door_mod.walls(row)
    named = [w for w in ws if w.get("token") in BUILTINS]
    main = named[0] if named else (ws[0] if ws else {})
    name = main.get("token") if main.get("token") in BUILTINS else None
    guard = main.get("guard")
    label = sim_mod.wall_label(main.get("token"), guard, names) if main else "[none]"
    sim = sim_mod.similar(label=label, name=name, cmap=cmap, cache=cache)
    kind = ("name-unknown" if guard in UNKNOWN_NAME_GUARDS else "call-unmapped") if main else "none"
    case = _case("The member's script (source.pine in this directory)", row, path=str(src))
    others = [f"`{w.get('token') or w.get('guard')}`" for w in ws if w is not main]
    demand = {"members": None, "reports": [rid]}
    text = packet_mod.render(
        title=f"report `{rid}`" + (f": `{name}`" if name else ""), kind=kind, name=name, guard=guard,
        capability=sim_mod.capability_of(guard), reference=sim_mod.reference_link(cmap, name) if name else None,
        demand=demand, repro={"cases": [case]}, sim=sim, master_sha=master_sha(),
        report={k: r.get(k) for k in ("id", "status", "source_bytes", "symbol", "timeframe",
                                      "same_script_reports", "translator_version")},
        door_status=((door_manifest().get("names") or {}).get(name) or {}).get("status") if name else None)
    if r.get("note"):
        text += "\n## The member's note (verbatim; member content)\n\n> " + r["note"].replace("\n", "\n> ") + "\n"
    if r.get("gaps"):
        text += "\n## Gaps the member's browser logged\n\n" + "\n".join(
            f"- `{g.get('name')}` ({g.get('kind')})" for g in r["gaps"]) + "\n"
    if others:
        text += "\n## Other walls in this script\n\n" + ", ".join(others) + "\n"
    if not ws and row.get("clean"):
        text += ("\n## No wall\n\nThe door accepts this script cleanly on this build. If the member says it "
                 "looks different, this is a PARITY question: capture it (Parity capture above) and compare.\n")
    pk = workdir.write_report_file(rid, "PACKET.md", text)
    if set_status and r.get("status") == "new":
        client.set_status(rid, "triaged")
    return pk


# ─── lifecycle ──────────────────────────────────────────────────────────────

def mark_fixed(client, *, gap: Optional[str] = None, reports: Optional[list[str]] = None,
               status: str = "fixed", force: bool = False) -> list[str]:
    ids = list(reports or [])
    if gap:
        dg = client.digest(refresh=True)
        fixed = {g["name"] for g in (dg.get("gaps") or {}).get("fixed_on_master") or []}
        if gap not in fixed and not force:
            raise SystemExit(f"`{gap}` is not fixed on the server's build yet (digest door manifest "
                             f"{dg.get('door_manifest', {}).get('sha')}). Deploy first, or --force.")
        ids += [r["id"] for r in (dg.get("reports") or {}).get("open") or []
                if any(x.get("name") == gap for x in r.get("gaps") or [])]
        lk = workdir.gap_dir(gap) / "links.json"
        if lk.exists():
            ids += json.loads(lk.read_text(encoding="utf-8")).get("reports") or []
    done = []
    for rid in dict.fromkeys(ids):
        client.set_status(rid, status)
        workdir.purge_report(rid)
        done.append(rid)
    return done


def purge(client, *, report_id: Optional[str] = None, closed: bool = False) -> list[str]:
    if report_id:
        return [report_id] if workdir.purge_report(report_id) else []
    out = []
    if closed:
        open_ids = {r["id"] for r in client.reports()}
        for rid in workdir.open_report_ids():
            if rid not in open_ids:          # fixed, wontfix, withdrawn or expired
                workdir.purge_report(rid)
                out.append(rid)
    return out


# ─── CLI ────────────────────────────────────────────────────────────────────

def _print_digest(d: dict) -> None:
    print(f"digest {d['day']} (window {d['window_days']}d, door manifest {d['door_manifest']['sha']}, "
          f"build {d.get('translator_version')})")
    for g in d["gaps"]["open"]:
        print(f"  {g['rank']:>3}. {g['name']:<34} {g['kind']:<14} members={g['members']:<4} hits={g['hits']}"
              f"  door={g['door_status']}")
    print(f"  open gaps: {d['gaps']['open_total']}   fixed on master (dropped): "
          f"{', '.join(g['name'] for g in d['gaps']['fixed_on_master']) or 'none'}")
    if d["gaps"].get("unlisted"):
        print(f"  unnamed gaps: {d['gaps']['unlisted']['members']} member(s)")
    c = d["reports"]["counts"]
    print(f"  reports: {c.get('new', 0)} new, {c.get('triaged', 0)} triaged")
    for r in d["reports"]["open"]:
        print(f"    {r['id']} {r['status']:<8} {r['created_at']} gaps="
              f"{','.join(g['name'] for g in r['gaps']) or '-'} same_script={r['same_script_reports']}")


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url")
    ap.add_argument("--digest-file", type=Path)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("digest"); p.add_argument("--refresh", action="store_true"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("gap"); p.add_argument("name"); p.add_argument("--kind", choices=("name-unknown", "call-unmapped"))
    p.add_argument("--cache", type=Path); p.add_argument("--ref", type=Path)
    p = sub.add_parser("report"); p.add_argument("id"); p.add_argument("--cache", type=Path)
    p.add_argument("--no-status", action="store_true")
    p = sub.add_parser("mark-fixed"); p.add_argument("--gap"); p.add_argument("--report", action="append", default=[])
    p.add_argument("--wontfix", action="store_true"); p.add_argument("--force", action="store_true")
    p = sub.add_parser("purge"); p.add_argument("id", nargs="?"); p.add_argument("--closed", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "gap":
            dg = json.loads(a.digest_file.read_text(encoding="utf-8")) if a.digest_file else None
            if dg is None:
                try:
                    dg = SupportLoopClient(a.url).digest()
                except ClientError as e:
                    print(f"(no digest: {e}; triaging by name only)")
            pk = triage_gap(a.name, kind=a.kind, digest=dg, cache=a.cache, ref=a.ref)
            print(f"packet: {pk}")
            return 0
        if a.cmd == "purge" and a.id:
            print(f"purged: {a.id}" if workdir.purge_report(a.id) else f"nothing kept for {a.id}")
            return 0
        if a.cmd == "digest" and a.digest_file:
            d = json.loads(a.digest_file.read_text(encoding="utf-8"))
        else:
            client = SupportLoopClient(a.url)
            if a.cmd == "digest":
                d = client.digest(refresh=a.refresh)
            elif a.cmd == "report":
                pk = triage_report(client, a.id, cache=a.cache, set_status=not a.no_status)
                print(f"packet (member content, temporary): {pk}")
                return 0
            elif a.cmd == "mark-fixed":
                if not a.gap and not a.report:
                    ap.error("mark-fixed needs --gap or --report")
                done = mark_fixed(client, gap=a.gap, reports=a.report,
                                  status="wontfix" if a.wontfix else "fixed", force=a.force)
                print(f"closed {len(done)} report(s), work directories purged: {', '.join(done) or 'none'}")
                return 0
            elif a.cmd == "purge":
                done = purge(client, report_id=a.id, closed=a.closed)
                print(f"purged {len(done)}: {', '.join(done) or 'none'}")
                return 0
        if a.json:
            print(json.dumps(d, indent=1))
        else:
            _print_digest(d)
        return 0
    except (ClientError, workdir.WorkdirError, door_mod.DoorError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
