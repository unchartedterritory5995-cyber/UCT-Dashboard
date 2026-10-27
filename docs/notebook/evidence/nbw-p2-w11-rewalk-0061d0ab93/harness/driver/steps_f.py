"""W11.0: before the first step of every boot -- identity, auth/me payload, the campaign's library probe, boot log."""
import os, urllib.request
from ui import *
from ev import Inconclusive, add_boot


def w11_0(S, b, base, vp, kbd=False):
    clock = os.environ.get("WALK_CLOCK") == "1"
    want_pid = int(os.environ["WALK_PID"])
    want_instant = os.environ.get("WALK_INSTANT", "")
    off = os.environ.get("WALK_W11") == "0"
    ident = json.loads(urllib.request.urlopen(base + "/__uct_sandbox_identity", timeout=10).read())
    S.saw("identity", json.dumps({k: v for k, v in ident.items() if k != "clock_shift"} | {"clock_shift": {k: v for k, v in ident["clock_shift"].items() if k != "unshiftable_tables"}}))
    ok_id = S.check("identity data_dir = the walk data dir", os.path.normcase(ident["data_dir"]) == os.path.normcase(str(WALK)), ident["data_dir"])
    ok_pid = S.check(f"identity pid = the recorded PID {want_pid}", ident["pid"] == want_pid, ident["pid"])
    ok_in = S.check(f"identity clock_shift.instant = the mode's instant {want_instant}", ident["clock_shift"]["instant"] == want_instant,
                    ident["clock_shift"]["instant"])
    if not (ok_id and ok_pid and ok_in):
        raise Inconclusive("identity not proved: nothing is driven on this boot")
    s, me = api(A[vp], "/api/auth/me", base=base, clock=clock)
    S.check("GET /api/auth/me as A answers 200", s == 200, s)
    S.check("A is paid-equivalent (paid_equiv true, plan pro, comped)", me.get("paid_equiv") is True and me.get("plan") == "pro", json.dumps({k: me.get(k) for k in ("paid_equiv", "plan", "subscription")}))
    for w in ("w8", "w9", "w10", "w11"):
        exp = not (off and w == "w11")
        S.check(f"notebook_widgets_{w}_enabled is {exp}", me.get(f"notebook_widgets_{w}_enabled") is exp, me.get(f"notebook_widgets_{w}_enabled"))
    S.check("notebook_style_library_enabled is true", me.get("notebook_style_library_enabled") is True, me.get("notebook_style_library_enabled"))
    s, _ = api(A[vp], "/api/j2/template-gallery/library", base=base, clock=clock)
    S.check(f"GET /api/j2/template-gallery/library answers {404 if off else 200}", s == (404 if off else 200), s)
    logs = [p for p in os.environ.get("WALK_BOOTLOG", "").split(";") if p]
    txt = "".join(Path(p).read_text(encoding="utf-8", errors="replace") for p in logs)
    S.check("boot log: '[startup] notebook routine reminders registered' present", "[startup] notebook routine reminders registered" in txt, "")
    S.check("boot log: no 'SHARED-ROOT WRITE BLOCKED'", "SHARED-ROOT WRITE BLOCKED" not in txt, "")
    sn = [l for l in txt.splitlines() if "SHIFTED NOW" in l or l.startswith("[sbx] flags:")]
    S.saw("boot log lines", "\n".join(x[:3000] for x in sn))
    add_boot({"mode": S.d["mode"], "vp": vp, "pid": ident["pid"], "identity_nonce": ident["identity"], "data_dir": ident["data_dir"],
              "instant": ident["clock_shift"]["instant"], "now_et": ident["clock_shift"]["now_et"], "started_at": ident["started_at"],
              "flags": next((l for l in txt.splitlines() if l.startswith("[sbx] flags:")), "")[len("[sbx] flags: "):],
              "logs": [os.path.basename(p) for p in logs], "checked": time.strftime("%Y-%m-%dT%H:%M:%S")})


def r1(S, b, base, vp, kbd=False):
    """R1 (W11-R73/R75): adopt-tool works, and a database another writer holds past the timeout answers 503 busy,
    never 500. The holder here is THIS walker: a BEGIN IMMEDIATE on the sandbox auth.db (sandbox data only, rolled
    back, nothing written), held while the member's adopt-tool and Helpful requests run."""
    import sqlite3, threading
    from steps_b import names
    n = names(vp)
    pid = "P14"
    s, gl = api(pid, "/api/j2/template-gallery", base=base)
    rows = gl.get("templates", []) if isinstance(gl, dict) else []
    rt = next((r for r in rows if r.get("title") == n["routine"] and r.get("itemType") == "routine"), None)
    tk = next((r for r in rows if r.get("title") == n["tracker"] and r.get("itemType") == "tracker"), None)
    if not rt or not tk:
        raise Inconclusive(f"no listed routine/tracker {n['routine']!r}/{n['tracker']!r} to adopt")
    s0, r0 = api(pid, f"/api/j2/template-gallery/{rt['id']}/adopt-tool", {}, base=base)
    S.saw("control: adopt-tool with no other writer", f"{s0} {json.dumps(r0)[:300]}")
    S.check("control: adopt-tool works (200) with no other writer", s0 == 200, s0)
    db = WALK / "auth.db"
    hold = sqlite3.connect(str(db), timeout=1, isolation_level=None)
    res = {}
    try:
        hold.execute("BEGIN IMMEDIATE")
        t0 = time.time()
        def go(key, path):
            res[key] = api(pid, path, {}, base=base) + (round(time.time() - t0, 2),)
        th = [threading.Thread(target=go, args=("adopt", f"/api/j2/template-gallery/{tk['id']}/adopt-tool")),
              threading.Thread(target=go, args=("helpful", f"/api/j2/template-gallery/{tk['id']}/helpful"))]
        for t in th:
            t.start()
        for t in th:
            t.join(60)
        held = round(time.time() - t0, 2)
    finally:
        hold.execute("ROLLBACK")
        hold.close()
    S.saw("busy: answers while this walker held auth.db (BEGIN IMMEDIATE)", json.dumps({k: [v[0], str(v[1])[:300], v[2]] for k, v in res.items()} | {"held_s": held}))
    for k, v in res.items():
        S.check(f"busy {k}: never a 500", v[0] != 500, v[0])
        if k != "adopt" and v[0] != 503:
            S.note(f"{k} under the held lock answered {v[0]} (not a write that reached the lock): {str(v[1])[:200]}")
            continue
        busy = v[0] == 503 and isinstance(v[1], (str, dict)) and "busy" in json.dumps(v[1])
        S.check(f"busy {k}: answers 503 busy (the house sentence) while another writer holds the database", busy, f"{v[0]} {str(v[1])[:200]}")
    s2, r2 = api(pid, f"/api/j2/template-gallery/{tk['id']}/adopt-tool", {}, base=base)
    S.check("after the writer lets go, the same adopt-tool works (200)", s2 == 200, f"{s2} {str(r2)[:200]}")
    s3, tr = api(pid, "/api/j2/trackers", base=base)
    k = len([t for t in tr.get("trackers", []) if t["name"] == n["tracker"]])
    S.check("the busy adopt wrote nothing: exactly one copy of the tracker after the retry", k == 1, k)


def putprobe(S, b, base, vp, kbd=False):
    """Extra (W11.12 follow-up): does OPENING a note made from Pre-market prep write it? P46, a member no other step
    uses for templates. Use -> wait 15 s -> reload -> wait 15 s; every note PUT is captured with its body, and the
    stored body is diffed before/after each."""
    import difflib
    pid = "P46"
    c = S.ctx("P46", Ctx(b, base, vp, pid))
    pg = c.page
    bodies = []
    pg.on("request", lambda r: r.method in ("PUT", "PATCH") and "/api/j2/notes/" in r.url and bodies.append(
        {"t": time.strftime("%H:%M:%S"), "m": r.method, "u": r.url[-60:], "body": (r.post_data or "")[:200000]}))
    sheet, lib = open_picker(c)
    det = library_detail(c, lib, "Pre-market prep")
    click(c, det.get_by_role("button", name="Use this template"))
    ad = adopt_sheet(pg)
    cr = ad.get_by_text(re.compile(r"^Create .* from the template$"))
    for i in range(cr.count()):
        cr.nth(i).click()
    click(c, ad.get_by_role("button", name="Use", exact=True))
    nid = wait_note(pg)
    after_use(S, c, "PUTPROBE")
    n0 = note_of(pid, nid, base)
    def diff(a, b_):
        x = json.dumps(a, indent=0, sort_keys=True).splitlines(); y = json.dumps(b_, indent=0, sort_keys=True).splitlines()
        return [l for l in difflib.unified_diff(x, y, lineterm="", n=0) if not l.startswith(("---", "+++", "@@"))]
    pg.wait_for_timeout(15000)
    n1 = note_of(pid, nid, base)
    S.saw("first open: note PUTs (method, time, url)", json.dumps([{k: v for k, v in x.items() if k != "body"} for x in bodies]))
    S.saw("first open: stored body diff (created -> after 15 s)", json.dumps(diff(n0.get("bodyJson"), n1.get("bodyJson")))[:3000])
    k1 = len(bodies)
    S.check("opening the new note (first open, 15 s) sends no note PUT", k1 == 0, k1)
    pg.reload(wait_until="domcontentloaded")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    pg.wait_for_timeout(15000)
    n2 = note_of(pid, nid, base)
    S.saw("reload: note PUTs", json.dumps([{k: v for k, v in x.items() if k != "body"} for x in bodies[k1:]]))
    S.saw("reload: stored body diff", json.dumps(diff(n1.get("bodyJson"), n2.get("bodyJson")))[:3000])
    S.check("re-opening it (reload, 15 s) sends no note PUT", len(bodies) == k1, len(bodies) - k1)
    S.saw("block kinds created / after", json.dumps([[x.get("type") for x in (n.get("bodyJson") or {}).get("content", [])] for n in (n0, n2)]))
    S.shot(pg, "main")
