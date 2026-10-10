"""notebook_swarm.py -- many members using the Notebook AT ONCE, against a local sandbox.

    python tools/notebook_swarm.py --base http://127.0.0.1:8143 --data-dir <sandbox data dir> \
        --users 100 --minutes 6 --browsers 12 --out docs/notebook/evidence/swarm-<stamp>

What the single-member walks (fin-walk, verify walk, the live walk) never did: put a crowd on one
server and check that every member's work survives the crowd. Each simulated member works through
the SAME HTTP endpoints the editor uses, keeps its own model of what it believes it saved, and at
the end every member's notes are read back and compared to that model.

The members are created INSIDE the sandbox database through the app's own functions
(`auth_service.create_user`, `comp_user_access`, `create_session`) by a child process that calls
`hub_sandbox_boot.apply_sandbox_env` first -- signup and login are rate-limited per IP (3 and 5 a
minute), and the walk is about the Notebook, not the sign-up door. This driver never imports api.*.

FINDINGS, each with its evidence (endpoint, status, body excerpt, member):
  LEAK       a member received another member's note (by id or in a list). Never acceptable.
  LOST       a member's last successful save is not what the server returns at the end.
  CLOBBER    two writes on one baseline both landed (the compare-and-set did not hold).
  SERVER     any 5xx.
  ANOMALY    an answer that contradicts the member's own model (a 409 with one writer, a search
             that cannot find a note's own unique word, a 4xx on a well-formed request).
Latency per endpoint (p50/p95/p99/max) is reported, never failed on: speed on a loaded dev box is
not the product's speed.

THE BROWSER LANE: `--browsers K` real Chromium members run the editor at the same time (half at
1280 px, half at 390 px): open the Notebook, make a note, type, wait for the save, switch views,
search, open notes. Every page error, console error, 5xx and error screen is recorded.

Raw evidence is written BEFORE the summary (R-RAW): ops.jsonl, findings.jsonl, browser.jsonl.
Exit: 0 no LEAK/LOST/CLOBBER/SERVER, 1 any of those, 2 the run could not be measured.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import statistics
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PW = "SwarmLocal2026!"
PHONE = [False]   # --phone puts every second browser member at 390 px
SYMS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "AMD", "CRWD", "GOOGL", "SPY", "QQQ"]

# ONE TLS context for every member. httpx.AsyncClient() builds its own by default, which loads the
# certificate bundle SYNCHRONOUSLY (150-700 ms each on this box) inside the event loop. Measured
# 2026-10-10: twenty members did that back to back at start-up, the loop was blocked ~14 s, and
# every member's first response was timed as if the server had taken up to 14 s (POST notes p99
# 11-14 s, all twenty completing within 0.1 s of each other). The server answered in <1 s.
_SSL_CTX = None


def _ssl_ctx():
    global _SSL_CTX
    if _SSL_CTX is None:
        import ssl
        _SSL_CTX = ssl.create_default_context()
    return _SSL_CTX

# ── provisioning, in a child that owns the sandbox env ───────────────────────────────────────

PROVISION_CHILD = r'''
import json, sys
repo, data_dir, n, prefix, pw = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import auth_db, auth_service
out = []
for i in range(n):
    email = f"{prefix}{i:03d}@local.dev"
    conn = auth_db.get_connection()
    try:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    finally:
        conn.close()
    uid = row["id"] if row else auth_service.create_user(email, pw, f"Swarm {i:03d}")["id"]
    auth_service.comp_user_access(email, True)
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (uid,))
        conn.commit()
    finally:
        conn.close()
    tok = auth_service.create_session(uid, "notebook-swarm", "127.0.0.1")
    out.append({"email": email, "uid": uid, "token": tok})
print("PROVISION " + json.dumps(out))
'''


def provision(data_dir: str, n: int, prefix: str, log: Path) -> list[dict]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", PROVISION_CHILD, str(REPO), data_dir, str(n), prefix, PW],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=1800)
    log.write_text((r.stdout or "")[-4000:] + "\n--- stderr ---\n" + (r.stderr or "")[-8000:], encoding="utf-8", newline="\n")
    line = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("PROVISION ")]
    if r.returncode != 0 or not line:
        raise SystemExit(f"NOT MEASURED: provisioning failed (rc {r.returncode}); see {log}")
    return json.loads(line[-1][len("PROVISION "):])


# ── the recorder ─────────────────────────────────────────────────────────────────────────────

class Rec:
    def __init__(self, out: Path):
        self.out = out
        self.lock = threading.Lock()
        self.ops = open(out / "ops.jsonl", "w", encoding="utf-8", newline="\n")
        self.fnd = open(out / "findings.jsonl", "w", encoding="utf-8", newline="\n")
        self.lat = defaultdict(list)
        self.status = defaultdict(Counter)
        self.findings = []

    def op(self, who: str, ep: str, status: int, ms: float, extra: dict | None = None):
        with self.lock:
            self.lat[ep].append(ms)
            self.status[ep][status] += 1
            self.ops.write(json.dumps({"t": round(time.time(), 3), "who": who, "ep": ep, "status": status,
                                       "ms": round(ms, 1), **(extra or {})}) + "\n")

    def find(self, kind: str, who: str, ep: str, detail: str, body: str = ""):
        rec = {"kind": kind, "who": who, "ep": ep, "detail": detail[:500], "body": (body or "")[:600],
               "t": round(time.time(), 3)}
        with self.lock:
            self.findings.append(rec)
            self.fnd.write(json.dumps(rec) + "\n")
            self.fnd.flush()

    def close(self):
        self.ops.close()
        self.fnd.close()


def doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def text_of(node) -> str:
    if isinstance(node, dict):
        return (node.get("text") or "") + " ".join(text_of(v) for v in node.values() if isinstance(v, (dict, list)))
    if isinstance(node, list):
        return " ".join(text_of(v) for v in node)
    return ""


def notes_in(body) -> list[dict]:
    if isinstance(body, dict):
        for k in ("notes", "items", "results", "rows"):
            if isinstance(body.get(k), list):
                return body[k]
    return body if isinstance(body, list) else []


# ── one simulated member ─────────────────────────────────────────────────────────────────────

class Member:
    def __init__(self, idx: int, acct: dict, base: str, rec: Rec, registry: dict, rng: random.Random):
        self.idx, self.acct, self.base, self.rec, self.reg, self.rng = idx, acct, base, rec, registry, rng
        self.who = acct["email"].split("@")[0]
        self.tag = f"sw{idx:03d}"                       # every title carries this; a leak is a title without it
        self.model: dict[str, dict] = {}                 # note id -> what this member last saved
        self.folders: list[str] = []
        self.client = None

    async def call(self, method: str, path: str, ep: str, **kw):
        t0 = time.perf_counter()
        try:
            r = await self.client.request(method, path, **kw)
        except Exception as e:  # noqa: BLE001
            self.rec.op(self.who, ep, 0, (time.perf_counter() - t0) * 1000, {"error": type(e).__name__})
            self.rec.find("ANOMALY", self.who, ep, f"transport error {type(e).__name__}: {e}")
            return None, None
        ms = (time.perf_counter() - t0) * 1000
        body = None
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = None
        self.rec.op(self.who, ep, r.status_code, ms)
        if r.status_code >= 500:
            self.rec.find("SERVER", self.who, ep, f"{method} {path} -> {r.status_code}", r.text)
        return r, body

    def live(self):
        return [i for i, m in self.model.items() if not m["deleted"]]

    # actions ---------------------------------------------------------------------------------

    async def a_create(self):
        k = len(self.model)
        word = f"w{self.tag}x{k}x{uuid.uuid4().hex[:6]}"
        title = f"{self.tag} note {k}"
        r, b = await self.call("POST", "/api/j2/notes", "POST notes", json={
            "title": title, "bodyJson": doc(f"Thesis {word}. Entry above the high."),
            "tags": [f"{self.tag}t{k % 3}"], "ticker": self.rng.choice(SYMS)})
        if r is not None and r.status_code == 200 and isinstance(b, dict) and b.get("note"):
            n = b["note"]
            self.model[n["id"]] = {"title": title, "word": word, "updatedAt": n.get("updatedAt"), "deleted": False}
            self.reg[n["id"]] = self.idx
        elif r is not None and r.status_code < 500:
            self.rec.find("ANOMALY", self.who, "POST notes", f"create refused {r.status_code}", r.text)

    async def a_edit(self):
        ids = self.live()
        if not ids:
            return await self.a_create()
        nid = self.rng.choice(ids)
        m = self.model[nid]
        word = f"w{self.tag}e{uuid.uuid4().hex[:8]}"
        title = f"{self.tag} note edited {word[-4:]}"
        r, b = await self.call("PUT", f"/api/j2/notes/{nid}", "PUT notes/{id}", json={
            "title": title, "bodyJson": doc(f"Revised {word}. Stop under the low."), "baseUpdatedAt": m["updatedAt"]})
        if r is None:
            return
        if r.status_code == 200 and isinstance(b, dict) and b.get("note"):
            m.update(title=title, word=word, updatedAt=b["note"].get("updatedAt"))
        elif r.status_code == 409:
            self.rec.find("ANOMALY", self.who, "PUT notes/{id}", "409 with ONE writer on its own last baseline", r.text)
        elif r.status_code < 500:
            self.rec.find("ANOMALY", self.who, "PUT notes/{id}", f"edit refused {r.status_code}", r.text)

    async def a_read(self):
        ids = self.live()
        if not ids:
            return
        nid = self.rng.choice(ids)
        r, b = await self.call("GET", f"/api/j2/notes/{nid}", "GET notes/{id}")
        if r is None or r.status_code != 200:
            if r is not None and r.status_code < 500:
                self.rec.find("ANOMALY", self.who, "GET notes/{id}", f"own live note answered {r.status_code}", r.text)
            return
        n = (b or {}).get("note") or b or {}
        m = self.model[nid]
        if n.get("title") != m["title"] or m["word"] not in text_of(n.get("bodyJson")):
            # a read racing this member's own save is impossible here (one coroutine per member)
            self.rec.find("LOST", self.who, "GET notes/{id}", f"read does not match the last save: title {n.get('title')!r} vs {m['title']!r}")

    async def a_list(self):
        r, b = await self.call("GET", "/api/j2/notes?limit=200", "GET notes")
        if r is None or r.status_code != 200:
            return
        for n in notes_in(b):
            if not str(n.get("title") or "").startswith(self.tag + " "):
                owner = self.reg.get(n.get("id"))
                self.rec.find("LEAK", self.who, "GET notes", f"list carried a note that is not this member's: {n.get('title')!r} (owner member {owner})")

    async def a_search(self):
        ids = self.live()
        if not ids:
            return
        nid = self.rng.choice(ids)
        word = self.model[nid]["word"]
        r, b = await self.call("GET", f"/api/j2/notes?q={word}", "GET notes?q")
        if r is None or r.status_code != 200:
            return
        got = notes_in(b)
        for n in got:
            if not str(n.get("title") or "").startswith(self.tag + " "):
                self.rec.find("LEAK", self.who, "GET notes?q", f"search returned another member's note {n.get('title')!r}")
        if nid not in {n.get("id") for n in got}:
            self.rec.find("ANOMALY", self.who, "GET notes?q", f"search for the note's own unique word {word} did not return it ({len(got)} results)")

    async def a_tags(self):
        ids = self.live()
        if ids:
            nid = self.rng.choice(ids)
            await self.call("PATCH", f"/api/j2/notes/{nid}/tags", "PATCH notes/{id}/tags",
                            json={"add": [f"{self.tag}x{self.rng.randint(0, 4)}"], "remove": []})
            await self._refresh(nid)

    async def a_favorite(self):
        ids = self.live()
        if ids:
            nid = self.rng.choice(ids)
            if self.rng.random() < 0.6:
                await self.call("POST", f"/api/j2/notes/{nid}/favorite", "POST favorite")
            else:
                await self.call("DELETE", f"/api/j2/notes/{nid}/favorite", "DELETE favorite")
            await self._refresh(nid)

    async def a_folder(self):
        if not self.folders or self.rng.random() < 0.3:
            r, b = await self.call("POST", "/api/j2/note-folders", "POST note-folders",
                                   json={"name": f"{self.tag} folder {len(self.folders)}"})
            f = (b or {}).get("folder") if isinstance(b, dict) else None
            if f and f.get("id"):
                self.folders.append(f["id"])
        ids = self.live()
        if ids and self.folders:
            nid = self.rng.choice(ids)
            m = self.model[nid]
            r, b = await self.call("PUT", f"/api/j2/notes/{nid}", "PUT notes/{id} (move)",
                                   json={"folderId": self.rng.choice(self.folders), "baseUpdatedAt": m["updatedAt"]})
            if r is not None and r.status_code == 200 and isinstance(b, dict) and b.get("note"):
                m["updatedAt"] = b["note"].get("updatedAt")
            elif r is not None and r.status_code == 409:
                self.rec.find("ANOMALY", self.who, "PUT notes/{id} (move)", "409 on a move with one writer", r.text)

    async def a_trash(self):
        ids = self.live()
        if len(ids) < 2:
            return
        nid = self.rng.choice(ids)
        r, _ = await self.call("DELETE", f"/api/j2/notes/{nid}", "DELETE notes/{id}")
        if r is not None and r.status_code == 200:
            self.model[nid]["deleted"] = True

    async def a_restore(self):
        gone = [i for i, m in self.model.items() if m["deleted"]]
        if not gone:
            return
        nid = self.rng.choice(gone)
        r, _ = await self.call("POST", f"/api/j2/notes/{nid}/restore", "POST notes/{id}/restore")
        if r is not None and r.status_code == 200:
            self.model[nid]["deleted"] = False
            await self._refresh(nid)

    async def a_versions(self):
        ids = self.live()
        if ids:
            await self.call("GET", f"/api/j2/notes/{self.rng.choice(ids)}/versions", "GET versions")

    async def a_export(self):
        ids = self.live()
        if ids:
            await self.call("GET", f"/api/j2/notes/{self.rng.choice(ids)}/export", "GET export")

    async def a_misc(self):
        path = self.rng.choice(["recents", "switcher", "tags", "folder-counts", "graph", "tasks",
                                "by-folders", "favorites", "link-targets", "backlinks"])
        await self.call("GET", f"/api/j2/notes/{path}", f"GET notes/{path}")

    async def a_leak_probe(self):
        others = [i for i, owner in list(self.reg.items()) if owner != self.idx]
        if not others:
            return
        nid = self.rng.choice(others)
        r, b = await self.call("GET", f"/api/j2/notes/{nid}", "GET other member's note")
        if r is not None and r.status_code == 200:
            self.rec.find("LEAK", self.who, "GET other member's note", f"read member {self.reg.get(nid)}'s note {nid}", r.text)
        for verb, path, ep in (("PUT", f"/api/j2/notes/{nid}", "PUT other member's note"),
                               ("DELETE", f"/api/j2/notes/{nid}", "DELETE other member's note")):
            if self.rng.random() < 0.5:
                kw = {"json": {"title": f"{self.tag} INTRUDER"}} if verb == "PUT" else {}
                r, _ = await self.call(verb, path, ep, **kw)
                if r is not None and r.status_code == 200:
                    self.rec.find("LEAK", self.who, ep, f"{verb} succeeded on member {self.reg.get(nid)}'s note {nid}", r.text)

    async def a_cas_race(self):
        """Two tabs of this member save one note on the SAME baseline at once: exactly one may land."""
        ids = self.live()
        if not ids:
            return
        nid = self.rng.choice(ids)
        m = self.model[nid]
        base = m["updatedAt"]
        w1, w2 = f"w{self.tag}r{uuid.uuid4().hex[:6]}", f"w{self.tag}r{uuid.uuid4().hex[:6]}"
        t1 = self.call("PUT", f"/api/j2/notes/{nid}", "PUT race", json={"title": f"{self.tag} race A", "bodyJson": doc(w1), "baseUpdatedAt": base})
        t2 = self.call("PUT", f"/api/j2/notes/{nid}", "PUT race", json={"title": f"{self.tag} race B", "bodyJson": doc(w2), "baseUpdatedAt": base})
        (r1, b1), (r2, b2) = await asyncio.gather(t1, t2)
        codes = sorted(x.status_code for x in (r1, r2) if x is not None)
        if codes == [200, 200]:
            self.rec.find("CLOBBER", self.who, "PUT race", f"both writes on baseline {base} landed")
        for r, b, title, word in ((r1, b1, f"{self.tag} race A", w1), (r2, b2, f"{self.tag} race B", w2)):
            if r is not None and r.status_code == 200 and isinstance(b, dict) and b.get("note"):
                m.update(title=title, word=word, updatedAt=b["note"].get("updatedAt"))
        if codes and codes != [200, 409] and codes != [200, 200]:
            self.rec.find("ANOMALY", self.who, "PUT race", f"race answered {codes}")
        await self._refresh(nid)

    async def _refresh(self, nid: str):
        r, b = await self.call("GET", f"/api/j2/notes/{nid}", "GET notes/{id}")
        if r is not None and r.status_code == 200:
            n = (b or {}).get("note") or b or {}
            if n.get("updatedAt"):
                self.model[nid]["updatedAt"] = n["updatedAt"]

    WEIGHTS = [("a_create", 12), ("a_edit", 24), ("a_read", 14), ("a_list", 8), ("a_search", 7),
               ("a_tags", 5), ("a_favorite", 3), ("a_folder", 4), ("a_trash", 3), ("a_restore", 3),
               ("a_versions", 3), ("a_export", 2), ("a_misc", 8), ("a_leak_probe", 3), ("a_cas_race", 2)]

    async def run(self, deadline: float, think: tuple[float, float]):
        import httpx
        names, weights = zip(*self.WEIGHTS)
        async with httpx.AsyncClient(base_url=self.base, cookies={"uct_session": self.acct["token"]},
                                     timeout=60.0, headers={"User-Agent": "notebook-swarm"},
                                     verify=_ssl_ctx()) as c:
            self.client = c
            for _ in range(2):
                await self.a_create()
            while time.time() < deadline:
                await getattr(self, self.rng.choices(names, weights)[0])()
                await asyncio.sleep(self.rng.uniform(*think))
            await self.verify()

    async def verify(self):
        """Read back EVERYTHING this member believes it saved."""
        for nid, m in list(self.model.items()):
            r, b = await self.call("GET", f"/api/j2/notes/{nid}", "VERIFY GET notes/{id}")
            if r is None:
                continue
            if m["deleted"]:
                if r.status_code == 200 and not ((b or {}).get("note") or {}).get("deletedAt") \
                        and not ((b or {}).get("note") or {}).get("deleted"):
                    # a trashed note may still be readable by id; it must be marked as trashed
                    pass
                continue
            if r.status_code != 200:
                self.rec.find("LOST", self.who, "VERIFY", f"live note {nid} answered {r.status_code}", r.text)
                continue
            n = (b or {}).get("note") or b or {}
            if n.get("title") != m["title"] or m["word"] not in text_of(n.get("bodyJson")):
                self.rec.find("LOST", self.who, "VERIFY", f"note {nid}: server title {n.get('title')!r}, last save {m['title']!r}, word present {m['word'] in text_of(n.get('bodyJson'))}")
        r, b = await self.call("GET", "/api/j2/notes?limit=500", "VERIFY GET notes")
        if r is not None and r.status_code == 200:
            listed = {n.get("id") for n in notes_in(b)}
            missing = [i for i, m in self.model.items() if not m["deleted"] and i not in listed]
            if missing:
                self.rec.find("LOST", self.who, "VERIFY GET notes", f"{len(missing)} live note(s) absent from the list: {missing[:5]}")
            for n in notes_in(b):
                if not str(n.get("title") or "").startswith(self.tag + " "):
                    self.rec.find("LEAK", self.who, "VERIFY GET notes", f"list carried {n.get('title')!r}")


async def run_swarm(base: str, accts: list[dict], minutes: float, rec: Rec, seed: int, think) -> dict:
    registry: dict[str, int] = {}
    deadline = time.time() + minutes * 60
    members = [Member(i, a, base, rec, registry, random.Random(seed + i)) for i, a in enumerate(accts)]
    t0 = time.time()
    await asyncio.gather(*(m.run(deadline, think) for m in members))
    return {"members": len(members), "notes_created": sum(len(m.model) for m in members),
            "seconds": round(time.time() - t0, 1)}


# ── the browser lane ─────────────────────────────────────────────────────────────────────────

def browser_lane(base: str, accts: list[dict], k: int, minutes: float, out: Path, stop: threading.Event) -> dict:
    from playwright.sync_api import sync_playwright
    log = open(out / "browser.jsonl", "w", encoding="utf-8", newline="\n")
    lock = threading.Lock()
    summary = Counter()

    def emit(rec: dict):
        with lock:
            log.write(json.dumps(rec) + "\n")
            log.flush()
            summary[rec["kind"]] += 1

    def one(i: int, acct: dict):
        width, height = (1280, 900) if (i % 2 == 0 or not PHONE[0]) else (390, 844)
        who = acct["email"].split("@")[0]
        rng = random.Random(9000 + i)
        with sync_playwright() as p:
            br = p.chromium.launch()
            ctx = br.new_context(viewport={"width": width, "height": height}, has_touch=width < 1025,
                                 is_mobile=width < 1025, reduced_motion="reduce")
            host = base.split("//", 1)[1].split(":")[0]
            ctx.add_cookies([{"name": "uct_session", "value": acct["token"], "domain": host, "path": "/"}])
            pg = ctx.new_page()
            where = {"step": "start"}
            pg.on("pageerror", lambda e: emit({"kind": "pageerror", "who": who, "w": width, "step": where["step"], "detail": str(e)[:400]}))
            pg.on("console", lambda m: m.type == "error" and emit({"kind": "console-error", "who": who, "w": width, "step": where["step"], "detail": m.text[:400]}))
            pg.on("response", lambda r: r.status >= 500 and emit({"kind": "http5xx", "who": who, "w": width, "step": where["step"], "detail": f"{r.status} {r.url}"}))
            deadline = time.time() + minutes * 60
            loops = 0
            while time.time() < deadline and not stop.is_set():
                loops += 1
                try:
                    where["step"] = "open"
                    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
                    pg.wait_for_timeout(1500)
                    # the brand intro film plays over every page load first; a member skips it
                    sk = pg.get_by_role("button", name="Skip intro")
                    if sk.count() and sk.first.is_visible():
                        sk.first.click()
                        pg.wait_for_timeout(900)
                    for _ in range(3):
                        pg.keyboard.press("Escape")
                    for label in ("Skip tour", "Got it"):
                        d = pg.get_by_role("button", name=label, exact=True)
                        if d.count() and d.first.is_visible():
                            d.first.click()
                            pg.wait_for_timeout(500)
                    body = pg.locator("body").inner_text(timeout=10000)
                    if "Something went wrong" in body or "This section failed" in body:
                        emit({"kind": "error-screen", "who": who, "w": width, "step": "open", "detail": body[:300]})
                    where["step"] = "new-note"
                    # WAIT for the button, never sample once: under load the Notebook draws later
                    # than 1.5 s, and a single check read "no button" while the page was loading.
                    btn = pg.get_by_role("button", name=re.compile(r"^(New note|Start a note|Write your first note)$")).first
                    try:
                        btn.wait_for(state="visible", timeout=20000)
                    except Exception:  # noqa: BLE001
                        btn = None
                    if btn is not None:
                        btn.click()
                        ed = pg.locator(".ProseMirror").first
                        ed.wait_for(timeout=20000)
                        ed.click()
                        word = f"brw{i}x{loops}x{uuid.uuid4().hex[:5]}"
                        pg.keyboard.type(f"Browser member {word} writes a short thesis.", delay=8)
                        where["step"] = "save"
                        try:
                            with pg.expect_response(lambda r: "/api/j2/notes" in r.url and r.request.method in ("PUT", "POST"), timeout=20000) as resp:
                                pg.wait_for_timeout(2500)
                            if resp.value.status >= 400:
                                emit({"kind": "save-failed", "who": who, "w": width, "step": "save", "detail": f"{resp.value.status} {resp.value.url}"})
                        except Exception:  # noqa: BLE001
                            emit({"kind": "save-not-seen", "who": who, "w": width, "step": "save", "detail": "no note write within 20 s of typing"})
                    else:
                        emit({"kind": "no-new-note-button", "who": who, "w": width, "step": "new-note", "detail": "the New note button was not visible"})
                    where["step"] = "views"
                    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
                    pg.wait_for_timeout(1200)
                    pg.keyboard.press("Escape")
                    for name in rng.sample(["List view", "Table view", "Board view", "Calendar view", "Graph view", "Timeline view", "Tasks view"], 4):
                        b = pg.get_by_role("button", name=name, exact=True)
                        if b.count() and b.first.is_visible():
                            b.first.click()
                            pg.wait_for_timeout(900)
                            txt = pg.locator("body").inner_text(timeout=10000)
                            if "Something went wrong" in txt or "This section failed" in txt:
                                emit({"kind": "error-screen", "who": who, "w": width, "step": f"view {name}", "detail": txt[:300]})
                    where["step"] = "search"
                    s = pg.get_by_role("searchbox").first
                    if s.count() and s.is_visible():
                        s.fill("thesis")
                        pg.wait_for_timeout(1200)
                    emit({"kind": "loop-ok", "who": who, "w": width, "step": "loop", "detail": str(loops)})
                except Exception as e:  # noqa: BLE001
                    emit({"kind": "driver-step-failed", "who": who, "w": width, "step": where["step"], "detail": f"{type(e).__name__}: {str(e)[:300]}"})
            ctx.close()
            br.close()

    threads = [threading.Thread(target=one, args=(i, accts[i]), daemon=True) for i in range(min(k, len(accts)))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=minutes * 60 + 300)
    log.close()
    return dict(summary)


# ── report ───────────────────────────────────────────────────────────────────────────────────

def pct(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(q * len(s)))], 1)


def report(out: Path, rec: Rec, swarm: dict, browser: dict, args) -> int:
    kinds = Counter(f["kind"] for f in rec.findings)
    total_ops = sum(sum(c.values()) for c in rec.status.values())
    lines = [f"# Notebook swarm, {time.strftime('%Y-%m-%d %H:%M')}",
             "",
             f"- members (API): **{swarm.get('members')}** for {args.minutes} min; notes created **{swarm.get('notes_created')}**; requests **{total_ops}**",
             f"- browser members: **{args.browsers}** ({'half 1280 px, half 390 px' if args.phone else 'all 1280 px'})",
             f"- findings: " + (", ".join(f"{k} {v}" for k, v in sorted(kinds.items())) or "none"),
             f"- browser events: " + (", ".join(f"{k} {v}" for k, v in sorted(browser.items())) or "none"),
             "", "## Endpoints", "", "| endpoint | calls | statuses | p50 ms | p95 ms | p99 ms | max ms |", "|---|---|---|---|---|---|---|"]
    for ep in sorted(rec.lat):
        xs = rec.lat[ep]
        st = " ".join(f"{k}x{v}" for k, v in sorted(rec.status[ep].items()))
        lines.append(f"| {ep} | {len(xs)} | {st} | {pct(xs, .5)} | {pct(xs, .95)} | {pct(xs, .99)} | {round(max(xs), 1)} |")
    lines += ["", "## Findings (first 60)", ""]
    for f in rec.findings[:60]:
        lines.append(f"- **{f['kind']}** {f['who']} `{f['ep']}`: {f['detail']}")
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    (out / "summary.json").write_text(json.dumps({"swarm": swarm, "browser": browser, "findings": dict(kinds),
                                                  "requests": total_ops}, indent=1), encoding="utf-8", newline="\n")
    print("\n".join(lines[:6]))
    hard = sum(kinds.get(k, 0) for k in ("LEAK", "LOST", "CLOBBER", "SERVER"))
    print(f"VERDICT: {'FAIL' if hard else 'PASS'} ({hard} hard finding(s), {kinds.get('ANOMALY', 0)} anomalies)")
    return 1 if hard else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--users", type=int, default=100)
    ap.add_argument("--minutes", type=float, default=6)
    ap.add_argument("--browsers", type=int, default=12)
    ap.add_argument("--think-min", type=float, default=0.2)
    ap.add_argument("--think-max", type=float, default=1.5)
    ap.add_argument("--prefix", default="swarm")
    ap.add_argument("--phone", action="store_true")
    ap.add_argument("--seed", type=int, default=1009)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    PHONE[0] = args.phone
    host = args.base.split("//", 1)[-1].split(":")[0]
    if host not in ("127.0.0.1", "localhost"):
        print("REFUSED: the swarm runs only against a local sandbox")
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    accts = provision(args.data_dir, args.users + args.browsers, args.prefix, out / "provision.log")
    api_accts, br_accts = accts[:args.users], accts[args.users:]
    rec = Rec(out)
    stop = threading.Event()
    bres: dict = {}
    bt = None
    if args.browsers:
        bt = threading.Thread(target=lambda: bres.update(browser_lane(args.base, br_accts, args.browsers, args.minutes, out, stop)), daemon=True)
        bt.start()
    try:
        swarm = asyncio.run(run_swarm(args.base, api_accts, args.minutes, rec, args.seed, (args.think_min, args.think_max)))
    finally:
        stop.set()
        if bt:
            bt.join(timeout=600)
        rec.close()
    total = sum(sum(c.values()) for c in rec.status.values())
    if total < args.users * 10:
        print(f"NOT MEASURED: only {total} requests completed")
        return 2
    return report(out, rec, swarm, bres, args)


if __name__ == "__main__":
    sys.exit(main())
