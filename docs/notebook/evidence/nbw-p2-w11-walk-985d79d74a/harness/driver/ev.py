"""Evidence: walk.json + steps/<vp>-<id>.json + <vp>/<id>-<surface>.png, rewritten after every step (R-RAW)."""
import json, os, re, time, traceback, contextlib
from pathlib import Path
from common import *

TIP = "985d79d74a"
EVD = Path(os.environ["WALK_EVD"]) if os.environ.get("WALK_EVD") else SBX / "evidence" / f"nbw-p2-w11-walk-{TIP}"
EVD.mkdir(parents=True, exist_ok=True)
WALKJSON = EVD / "walk.json"


class Inconclusive(Exception):
    pass


def _load():
    if WALKJSON.exists():
        return json.loads(WALKJSON.read_text(encoding="utf-8"))
    return {"tip": TIP, "branch": "feat/notebook-widgets-p2", "boots": [], "steps": {}, "defects": []}


def _save(w):
    tmp = WALKJSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(w, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, WALKJSON)


def add_boot(info):
    w = _load(); w["boots"].append(info); _save(w)


def sid_(step):
    return step.replace(".", "_")


class Step:
    def __init__(self, vp, step, title, mode="ON"):
        self.d = {"viewport": vp, "step": step, "title": title, "mode": mode, "checks": [], "rendered": [],
                  "verdict": None, "notes": [], "events": {}, "metrics": {}, "screenshots": [], "requests_note_put": 0,
                  "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
        self.vp, self.step = vp, step
        self.ctxs = {}
        self.inconclusive = None
        self.defects = []
        # merge with an earlier part of the same step (clock days, ON->OFF->ON)
        w = _load()
        prev = w["steps"].get(f"{vp}-{step}")
        if prev and prev.get("partial"):
            for k in ("checks", "rendered", "notes", "screenshots"):
                self.d[k] = prev.get(k, []) + self.d[k]
            self.d["metrics"] = prev.get("metrics", {})
            self.d["events"] = prev.get("events", {})
            self.d["requests_note_put"] = prev.get("requests_note_put", 0)
            self.d["mode"] = prev.get("mode", mode) + "+" + mode

    def ctx(self, name, c):
        self.ctxs[name] = c
        return c

    def check(self, what, ok, read=""):
        self.d["checks"].append({"what": what, "ok": bool(ok), "read": str(read)[:700]})
        print(f"    [{time.strftime('%H:%M:%S')}] {'ok ' if ok else 'NO '} {what[:110]}", flush=True)
        return bool(ok)

    def saw(self, what, text):
        print(f"    [{time.strftime('%H:%M:%S')}] saw {what[:80]}", flush=True)
        self.d["rendered"].append({"what": what, "text": str(text)[:1500]})

    def note(self, t):
        self.d["notes"].append(t)

    def shot(self, pg, surface):
        p = EVD / self.vp / f"{sid_(self.step)}-{surface}.png"
        p.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.suppress(Exception):
            pg.screenshot(path=str(p), full_page=False, timeout=15000)
            rel = str(p.relative_to(EVD)).replace("\\", "/")
            if rel not in self.d["screenshots"]:
                self.d["screenshots"].append(rel)
            return rel
        return None

    def measure(self, pg, surface, scope=None, touch=None, page_axe=True):
        """axe on the open sheet (scope) and the whole page; tap floor on the touch tier; overflow."""
        m = {}
        try:
            m["overflow"] = overflow(pg)
        except Exception as e:  # noqa: BLE001
            m["overflow"] = {"error": str(e)[:200]}
        try:   # R3/R4 (W11-R76/R77): no raw {{block:...}} placeholder anywhere in the DOM (text or attributes)
            m["raw_block"] = pg.evaluate(r"""() => { const h = document.documentElement.outerHTML; const out = []; const re = /\{\{block:[^}]{0,60}\}\}/g; let x; while ((x = re.exec(h)) && out.length < 12) out.push(x[0]); return out }""")
        except Exception as e:  # noqa: BLE001
            m["raw_block"] = {"error": str(e)[:200]}
        sel = scope
        if scope == "dialog":
            sel = mark_dialog(pg)
        if sel:
            try:
                m["axe_sheet"] = axe(pg, sel)
            except Exception as e:  # noqa: BLE001
                m["axe_sheet"] = {"error": str(e)[:200]}
        if page_axe:
            try:
                m["axe_page"] = axe(pg, None)
            except Exception as e:  # noqa: BLE001
                m["axe_page"] = {"error": str(e)[:200]}
        if touch:
            try:
                t = tap(pg, sel)
                t["pointerCoarse"] = pg.evaluate("() => matchMedia('(pointer: coarse)').matches")
                m["tap"] = t
            except Exception as e:  # noqa: BLE001
                m["tap"] = {"error": str(e)[:200]}
        self.d["metrics"][surface] = m
        return m

    def defect(self, selector, expected, saw, severity, screenshot=None, kind="expectation"):
        self.defects.append({"viewport": self.vp, "step": self.step, "selector": selector, "expected": expected,
                             "saw": str(saw)[:800], "screenshot": screenshot or (self.d["screenshots"][-1] if self.d["screenshots"] else None),
                             "severity": severity, "kind": kind})

    def findings(self):
        out = []
        for surf, m in self.d["metrics"].items():
            for key in ("axe_sheet", "axe_page"):
                for v in (m.get(key) or {}).get("violations") or []:
                    if v.get("impact") in ("serious", "critical"):
                        out.append({"kind": f"axe:{v['impact']}", "surface": surf, "scope": key, "id": v["id"],
                                    "detail": f"{v['id']}: {v['help']} ({v['nodes']} nodes) {v['targets'][:3]} -- {v.get('summary','')[:220]}"})
            rb = m.get("raw_block")
            if isinstance(rb, list) and rb:
                out.append({"kind": "raw-block", "surface": surf, "detail": json.dumps(rb)})
            ov = m.get("overflow") or {}
            if ov.get("horizontal"):
                out.append({"kind": "overflow", "surface": surf, "detail": json.dumps(ov)[:400]})
            t = m.get("tap") or {}
            for s in t.get("small") or []:
                if not s.get("offscreen") and not s.get("covered"):
                    out.append({"kind": "tap", "surface": surf, "detail": json.dumps(s, ensure_ascii=False)})
        for name, evs in self.d["events"].items():
            for e in evs:
                if "http" in e and e["http"] == 401 and "/api/auth/me" in e.get("url", "") and name.startswith("anon"):
                    continue
                out.append({"kind": "event", "page": name, "detail": json.dumps(e, ensure_ascii=False)[:400]})
        return out

    def finish(self, partial=False):
        for name, c in self.ctxs.items():
            self.d["events"].setdefault(name, [])
            self.d["events"][name] = self.d["events"][name] + [e for e in c.events if e not in self.d["events"][name]]
            self.d["requests_note_put"] += 0
        self.d["findings"] = self.findings()
        if self.inconclusive:
            self.d["verdict"] = "INCONCLUSIVE"
            self.d["notes"].append("INCONCLUSIVE: " + self.inconclusive)
        elif not self.d["checks"]:
            self.d["verdict"] = "INCONCLUSIVE"
            self.d["notes"].append("INCONCLUSIVE: no check was made")
        elif any(not c["ok"] for c in self.d["checks"]) or any(f["kind"] != "event" for f in self.d["findings"]):
            self.d["verdict"] = "FAIL"
        else:
            self.d["verdict"] = "PASS"
        self.d["partial"] = partial
        self.d["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        (EVD / "steps").mkdir(exist_ok=True)
        p = EVD / "steps" / f"{self.vp}-{sid_(self.step)}.json"
        p.write_text(json.dumps(self.d, indent=1, ensure_ascii=False), encoding="utf-8")
        w = _load()
        w["steps"][f"{self.vp}-{self.step}"] = self.d
        key = lambda d: (d["viewport"], d["step"], d["selector"], d["expected"])
        have = {key(d) for d in w["defects"]}
        for d in self.defects:
            if key(d) not in have:
                w["defects"].append(d)
        _save(w)
        for c in list(self.ctxs.values()):
            c.close()
        print(f"[{self.vp} {self.step}] {self.d['verdict']}  checks {sum(c['ok'] for c in self.d['checks'])}/{len(self.d['checks'])}"
              f"  findings {len(self.d['findings'])}" + (f"  ({self.inconclusive})" if self.inconclusive else ""), flush=True)
        for c in self.d["checks"]:
            if not c["ok"]:
                print("   x", c["what"], "|", c["read"][:200], flush=True)
        for f in self.d["findings"][:8]:
            print("   !", f["kind"], f.get("surface", f.get("page")), f["detail"][:200], flush=True)


def mark_dialog(pg):
    return pg.evaluate("""() => {
      document.querySelectorAll('[data-walk-scope]').forEach(e => e.removeAttribute('data-walk-scope'));
      const ds = [...document.querySelectorAll('[role=dialog]')].filter(d => { const b = d.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(d).visibility !== 'hidden' });
      if (!ds.length) return null;
      ds[ds.length - 1].setAttribute('data-walk-scope', '1');
      return '[data-walk-scope="1"]';
    }""")


def run(step_obj, fn, *a, **kw):
    try:
        fn(step_obj, *a, **kw)
    except Inconclusive as e:
        step_obj.inconclusive = str(e)
    except Exception as e:  # noqa: BLE001
        step_obj.inconclusive = f"driver error: {type(e).__name__}: {str(e)[:400]}"
        step_obj.d["notes"].append(traceback.format_exc()[-1500:])
    return step_obj
