"""UCT Agent — the CUMULATIVE cross-run evaluation ledger (Wave 1 A-03; owner mandate 2026-11-02).

The owner approved $21 of paid evaluation IN TOTAL, across every worker, session and tool. The per-run
`--max-usd` ceilings do not sum across runs; this file does. Every paid tool (agent_eval_run,
agent_live_batch, agent_latency_probe, agent_live_chain) RESERVES the worst case of a call here BEFORE
the call and SETTLES it from the provider's usage after — the same protocol as the production ledger
(api/services/uct_agent/budget.py), on one shared SQLite file.

  python tools/agent_eval_ledger.py status            # cumulative reserved / settled / remaining + per-run rows
  python tools/agent_eval_ledger.py release <id> --confirm "<why>"   # the OWNER drops a crashed run's reservation

THE LEDGER IS ONE FILE per machine: C:/UCT/agent-eval-ledger.db on Windows, /var/lib/uct-agent-eval/agent-eval-ledger.db
on POSIX (the directory is created; if it cannot be, or is not writable, every reservation is refused — there is NO
fallback path, not HOME, not the repo, so no worktree or session can start a ledger of its own). The
UCT_AGENT_EVAL_LEDGER override exists for the test suite only: it is honoured under pytest (PYTEST_CURRENT_TEST) and
refused anywhere else, so it can never relocate the cap file to a fresh $21.
THE CAP = min(CUMULATIVE_CAP_USD, the owner-edited sibling file `agent-eval-cap.json` {"cap_usd": 21.0}).
Raising it needs BOTH a code change and the file; the file alone can only lower it. A missing or
unreadable file, or an unreachable ledger, REFUSES every reservation (fail closed). No environment variable
raises the cap.

RESERVE (BEGIN IMMEDIATE): reserved (open) + settled (actual) + this call's worst case ≤ cap, else
LedgerRefused — two processes racing for the last cents cannot both get them. The worst case of a
Messages call = every UTF-8 byte of the request as ONE token, + FRAMING_TOKENS, all billed as a 5-minute
CACHE WRITE at the model's rate, + the full `max_tokens` of output (thinking tokens are output tokens).
SETTLE: the actual cost from usage — input, cache_creation, cache_read, output — at the VERIFIED prices
(the dearer of tools/agent_eval_prices.json and narrative_cost_guard.estimate_cost, so a disagreement
between the two tables can only over-count). Missing usage, a timeout or any other exception settles AT
THE WORST CASE. RELEASE only on `anthropic.APIStatusError` (an HTTP error status: nothing generated,
nothing billed). A reservation a crashed run never settled keeps counting until the owner releases it by
hand with `release --confirm`; nothing releases it automatically.

Rows are content-free: run id, tool, model, a key FINGERPRINT (sha256[:8] — never the key), token counts
and dollars. Perplexity / web research is NOT metered here and must stay stubbed in every eval tool
(`stub_research`); a run whose research is live is refused (`require_research_stubbed`).
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import PurePosixPath, PureWindowsPath

HERE = os.path.dirname(os.path.abspath(__file__))
#: The mandate's number, in code. NOT an environment variable: an override is an increase waiting to happen.
CUMULATIVE_CAP_USD = 21.0
LEDGER_ENV = "UCT_AGENT_EVAL_LEDGER"                   # tests only (see under_pytest)
WINDOWS_LEDGER = r"C:\UCT\agent-eval-ledger.db"                      # THE ledger, for every worker and session on this machine
POSIX_LEDGER = "/var/lib/uct-agent-eval/agent-eval-ledger.db"        # the CI / Linux equivalent (writable or refused)
CAP_FILE_NAME = "agent-eval-cap.json"


def pinned_ledger() -> str:
    """The ONE pinned location for this platform (the only place the resolver branches)."""
    return WINDOWS_LEDGER if os.name == "nt" else POSIX_LEDGER


def _pure(p: str):
    """A pure path of THIS platform's flavour (never a concrete Path: the parent of a pinned path is computed the same
    way on every runner, and a Windows pinned path never has an empty dirname on POSIX)."""
    return PureWindowsPath(p) if os.name == "nt" else PurePosixPath(p)
EVAL_KEY_ENV = "UCT_AGENT_EVAL_API_KEY"
PROD_KEY_ENV = "ANTHROPIC_API_KEY"
PRICES_FILE = os.path.join(HERE, "agent_eval_prices.json")
#: Provider framing a request's bytes do not show (as budget.py): generous, it only makes the reservation larger.
FRAMING_TOKENS = 4000
HAIKU_55_TIER_TOKENS = 100_000


class LedgerRefused(Exception):
    """No paid call may be made. `.reason` ∈ cap | cap_file | unavailable | key | research."""

    def __init__(self, reason: str, sentence: str):
        super().__init__(sentence)
        self.reason = reason


# ── where the ledger lives ──────────────────────────────────────────────────────────────────────
def under_pytest() -> bool:
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


def ledger_path() -> str:
    """The one pinned ledger file. The env override is honoured ONLY under pytest (a test's scratch ledger); anywhere
    else it is refused outright — a relocated ledger would come with a relocated cap file. No fallback: a machine
    where the pinned directory cannot be created makes no paid call."""
    p = os.environ.get(LEDGER_ENV, "").strip()
    if p:
        if not under_pytest():
            raise LedgerRefused("unavailable", f"{LEDGER_ENV} is honoured only under pytest; the ledger is {pinned_ledger()} — no paid call")
        return p
    pinned = _pure(pinned_ledger())
    d = str(pinned.parent)
    try:
        os.makedirs(d, exist_ok=True)
    except OSError as e:
        raise LedgerRefused("unavailable", f"the ledger directory {d} cannot be created ({type(e).__name__}); no paid call")
    if not os.access(d, os.W_OK):
        raise LedgerRefused("unavailable", f"the ledger directory {d} is not writable; no paid call")
    return str(pinned)


def cap_file_path(path: str | None = None) -> str:
    return str(_pure(path or ledger_path()).parent / CAP_FILE_NAME)


def read_cap(path: str | None = None) -> float:
    """min(the code constant, the owner's file). The file MUST exist and hold a positive cap_usd."""
    f = cap_file_path(path)
    try:
        with open(f, encoding="utf-8") as fh:
            v = float(json.load(fh)["cap_usd"])
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise LedgerRefused("cap_file", f"the cap file {f} is missing or unreadable ({type(e).__name__}); no paid call")
    if not v > 0:
        raise LedgerRefused("cap_file", f"the cap file {f} holds no positive cap_usd; no paid call")
    return min(CUMULATIVE_CAP_USD, v)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS eval_spend (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL,
  tool          TEXT NOT NULL,
  model         TEXT,
  key_fp        TEXT,
  status        TEXT NOT NULL,            -- reserved | settled | released
  reserved_usd  REAL NOT NULL,
  actual_usd    REAL NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  cache_write   INTEGER NOT NULL DEFAULT 0,
  outcome       TEXT,                     -- ok | no_usage | worst_case | provider_error | owner_release
  note          TEXT,
  created_at    INTEGER NOT NULL,
  settled_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_eval_spend_status ON eval_spend(status);
"""


_READY: set[str] = set()          # paths whose schema this process has already ensured


def _connect(path: str | None = None) -> sqlite3.Connection:
    p = path or ledger_path()
    d = os.path.dirname(os.path.abspath(p))
    if d:
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(p, timeout=30.0, isolation_level=None)
    conn.execute("PRAGMA busy_timeout=30000")
    if os.path.abspath(p) not in _READY:
        # WAL is persistent in the file: set once; a race on the pragma is harmless (the next writer sets it).
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError:
            pass
        # the schema under the WRITE lock first (BEGIN IMMEDIATE): a deferred CREATE TABLE that must upgrade a read
        # lock while another writer holds the file returns SQLITE_BUSY at once, without waiting on busy_timeout
        for attempt in range(20):
            try:
                conn.execute("BEGIN IMMEDIATE")
                for stmt in _SCHEMA.strip().split(";"):
                    if stmt.strip():
                        conn.execute(stmt)
                conn.execute("COMMIT")
                break
            except sqlite3.OperationalError:
                try:
                    conn.execute("ROLLBACK")
                except sqlite3.OperationalError:
                    pass
                if attempt == 19:
                    raise
                time.sleep(0.05 * (attempt + 1))
        _READY.add(os.path.abspath(p))
    return conn


# ── prices ──────────────────────────────────────────────────────────────────────────────────────
def _prices() -> dict:
    with open(PRICES_FILE, encoding="utf-8") as f:
        return json.load(f)


def rates_for(model: str, prompt_tokens: int = 0) -> dict:
    """{input, cache_write, cache_read, output} $/MTok for `model`, from the verified table; the Haiku 5.5
    >100K tier when the prompt is over it. An unpriced model is refused (never guessed)."""
    p = _prices()
    if not p.get("verified"):
        raise LedgerRefused("unavailable", "tools/agent_eval_prices.json is not marked verified; no paid call")
    row = (p.get("models") or {}).get(model)
    if not row:
        raise LedgerRefused("unavailable", f"no verified price for {model}; no paid call")
    if prompt_tokens > HAIKU_55_TIER_TOKENS and row.get("over_100k"):
        row = {**row, **row["over_100k"]}
    return {"input": float(row["input"]), "cache_write": float(row["cache_write_5m"]),
            "cache_read": float(row["cache_read"]), "output": float(row["output"])}


def cost_usd(model: str, *, input: int = 0, output: int = 0, cache_read: int = 0, cache_write: int = 0) -> float:
    """The DEARER of the verified table and the server's estimator (narrative_cost_guard), so a disagreement
    between the two can only over-count. Thinking tokens are inside `output` (usage.output_tokens)."""
    r = rates_for(model, input + cache_read + cache_write)
    table = (input * r["input"] + cache_write * r["cache_write"] + cache_read * r["cache_read"] + output * r["output"]) / 1e6
    try:
        from api.services import narrative_cost_guard
        server = float(narrative_cost_guard.estimate_cost(model, input, output, cache_read_tokens=cache_read,
                                                           cache_creation_tokens=cache_write))
    except Exception:  # noqa: BLE001 -- the table alone when the server package is not importable
        server = 0.0
    return round(max(table, server), 8)


def request_bytes(kwargs: dict) -> int:
    body = {k: kwargs.get(k) for k in ("system", "messages", "output_config", "tools", "tool_choice")}
    return len(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))


def worst_case_usd(kwargs: dict) -> float:
    """Every request byte as a token + framing, ALL as a 5-minute cache write, + max_tokens of output."""
    model = str(kwargs.get("model") or "")
    return cost_usd(model, cache_write=request_bytes(kwargs) + FRAMING_TOKENS, output=int(kwargs.get("max_tokens") or 0))


def usage_tokens(resp) -> dict | None:
    u = getattr(resp, "usage", None)
    if u is None:
        return None
    return {"input": int(getattr(u, "input_tokens", 0) or 0), "output": int(getattr(u, "output_tokens", 0) or 0),
            "cache_read": int(getattr(u, "cache_read_input_tokens", 0) or 0),
            "cache_write": int(getattr(u, "cache_creation_input_tokens", 0) or 0)}


# ── the key ─────────────────────────────────────────────────────────────────────────────────────
def key_fingerprint(key: str | None) -> str | None:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:8] if key else None


def eval_key() -> str:
    """The SEPARATE evaluation key, or LedgerRefused. Never the production key, never printed."""
    k = os.environ.get(EVAL_KEY_ENV, "").strip()
    if not k:
        raise LedgerRefused("key", f"{EVAL_KEY_ENV} is not set (the production {PROD_KEY_ENV} is never used for evaluation)")
    if k == os.environ.get(PROD_KEY_ENV, "").strip():
        raise LedgerRefused("key", f"{EVAL_KEY_ENV} equals {PROD_KEY_ENV}: that is the production key, refused")
    return k


# ── research must stay off ──────────────────────────────────────────────────────────────────────
def stub_research(turn_module) -> None:
    """Research (Perplexity) is a second paid provider outside this ledger: every eval tool stubs it."""
    def _stub(*_a, **_k):
        return {"answer": "research unavailable right now", "citations": [], "note": "research disabled for evaluation"}
    _stub._eval_stub = True
    turn_module._research = _stub
    turn_module._record_cost = lambda _resp: 0.0


def require_research_stubbed(turn_module) -> None:
    if not getattr(getattr(turn_module, "_research", None), "_eval_stub", False):
        raise LedgerRefused("research", "web research is not stubbed in this process; no paid call")


def check_model(client, model: str) -> str:
    """The FREE models lookup on the EVAL key before any spend: the model must exist on that account (the owner's
    workspace spend limit applies to it). The result is printed; a failure refuses the run. `client` must have
    been built with max_retries=0 (every eval client is)."""
    if getattr(client, "max_retries", 0) != 0:
        raise LedgerRefused("unavailable", "the eval client must be built with max_retries=0")
    try:
        info = client.models.retrieve(model)
    except Exception as e:  # noqa: BLE001
        raise LedgerRefused("unavailable", f"model {model} is not available on the eval account ({type(e).__name__}); no paid call")
    name = str(getattr(info, "display_name", None) or getattr(info, "id", None) or model)
    print(f"eval account: model {model} available ({name})")
    return name


# ── reserve / settle / release ──────────────────────────────────────────────────────────────────
class Ledger:
    def __init__(self, path: str | None = None, *, readonly: bool = False):
        """`path`: a test's scratch ledger (pytest only) or, with `readonly=True`, a file to REPORT on (never to reserve
        against: the report tool). Anything else is the pinned ledger."""
        if path and not readonly and not under_pytest():
            raise LedgerRefused("unavailable", f"an explicit ledger path is honoured only under pytest; the ledger is {pinned_ledger()}")
        self.path = path or ledger_path()
        self.readonly = readonly

    def _conn(self):
        return contextlib.closing(_connect(self.path))

    def cap(self) -> float:
        return read_cap(self.path)

    def committed(self) -> tuple[float, float]:
        """(open reservations, settled actuals), cumulative, all time."""
        with self._conn() as c:
            r = c.execute("SELECT COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE 0 END),0),"
                          " COALESCE(SUM(CASE status WHEN 'settled' THEN actual_usd ELSE 0 END),0) FROM eval_spend").fetchone()
        return float(r[0] or 0), float(r[1] or 0)

    def remaining(self) -> float:
        a, b = self.committed()
        return max(0.0, self.cap() - a - b)

    def reserve(self, run_id: str, worst_case_usd: float, *, tool: str = "", model: str | None = None,
                key_fp: str | None = None) -> int:
        """Admit one paid call or raise LedgerRefused. BEGIN IMMEDIATE: the sum and the insert are one transaction."""
        if self.readonly:
            raise LedgerRefused("unavailable", "a read-only ledger handle (the report) never reserves")
        cap = self.cap()                                   # the file is read every time: lowering it takes effect at once
        worst = round(float(worst_case_usd), 6)
        if worst <= 0:
            raise LedgerRefused("unavailable", "a reservation needs a positive worst case")
        try:
            with self._conn() as c:
                c.execute("BEGIN IMMEDIATE")
                try:
                    r = c.execute("SELECT COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd"
                                  " WHEN 'settled' THEN actual_usd ELSE 0 END),0) FROM eval_spend").fetchone()
                    committed = float(r[0] or 0)
                    if round(committed + worst, 6) > round(cap, 6):
                        c.execute("ROLLBACK")
                        raise LedgerRefused("cap", f"${committed:.4f} committed + worst ${worst:.4f} would pass the cumulative cap ${cap:.2f}")
                    cur = c.execute("INSERT INTO eval_spend (run_id, tool, model, key_fp, status, reserved_usd, created_at)"
                                    " VALUES (?,?,?,?,'reserved',?,?)", (str(run_id), str(tool), model, key_fp, worst, int(time.time())))
                    c.execute("COMMIT")
                    return int(cur.lastrowid)
                except LedgerRefused:
                    raise
                except Exception:
                    c.execute("ROLLBACK")
                    raise
        except LedgerRefused:
            raise
        except Exception as e:  # noqa: BLE001 -- fail closed
            raise LedgerRefused("unavailable", f"the ledger could not be written ({type(e).__name__}); no paid call")

    def settle(self, reservation_id: int, actual_usd: float | None = None, usage: dict | None = None,
               *, model: str | None = None, outcome: str = "ok") -> float:
        """Replace a reservation with what was spent: `actual_usd`, else the cost of `usage` at the verified prices,
        else (nothing known) the worst case. Returns the dollars now counted. Never raises into a run: a failed
        settle leaves the row RESERVED, which keeps counting at its worst case."""
        t = usage or {}
        try:
            with self._conn() as c:
                c.execute("BEGIN IMMEDIATE")
                row = c.execute("SELECT reserved_usd, status, model FROM eval_spend WHERE id = ?", (int(reservation_id),)).fetchone()
                if not row or row[1] != "reserved":
                    c.execute("ROLLBACK")
                    return 0.0
                reserved = float(row[0])
                if actual_usd is None and usage is not None:
                    actual_usd = cost_usd(str(model or row[2] or ""), **t)
                if actual_usd is None:
                    charged, outcome = reserved, ("no_usage" if outcome == "ok" else outcome)
                else:
                    charged = float(actual_usd)
                    if charged > reserved:
                        # the bound was wrong: the real figure is kept (never hidden) and flagged
                        outcome = "over_worst_case"
                c.execute("UPDATE eval_spend SET status='settled', actual_usd=?, input_tokens=?, output_tokens=?, cache_read=?,"
                          " cache_write=?, outcome=?, settled_at=? WHERE id = ?",
                          (round(charged, 6), int(t.get("input", 0)), int(t.get("output", 0)), int(t.get("cache_read", 0)),
                           int(t.get("cache_write", 0)), outcome, int(time.time()), int(reservation_id)))
                c.execute("COMMIT")
                return charged
        except Exception:  # noqa: BLE001
            return 0.0

    def release(self, reservation_id: int, *, outcome: str = "provider_error", note: str | None = None) -> bool:
        """Drop a reservation: ONLY for a provider error response (nothing billed) or the owner's explicit release."""
        try:
            with self._conn() as c:
                c.execute("BEGIN IMMEDIATE")
                n = c.execute("UPDATE eval_spend SET status='released', actual_usd=0, outcome=?, note=?, settled_at=?"
                              " WHERE id = ? AND status = 'reserved'", (outcome, note, int(time.time()), int(reservation_id))).rowcount
                c.execute("COMMIT")
                return n == 1
        except Exception:  # noqa: BLE001 -- the row stays reserved: over-counts, never under-counts
            return False

    def guarded_call(self, run_id: str, fn, kwargs: dict, *, tool: str, key_fp: str | None = None, per_run_cap=None):
        """ONE metered Messages call: reserve its worst case, call, settle from usage. `per_run_cap(worst) -> str|None`
        may refuse the call for a run-level reason (the run's own --max-usd) before anything is reserved. Only an
        `anthropic.APIStatusError` releases; any other exception settles at the worst case and is re-raised."""
        model = str(kwargs.get("model") or "")
        worst = worst_case_usd(kwargs)
        if per_run_cap is not None:
            why = per_run_cap(worst)
            if why:
                raise LedgerRefused("run_cap", why)
        rid = self.reserve(run_id, worst, tool=tool, model=model, key_fp=key_fp)
        try:
            resp = fn(**kwargs)
        except Exception as e:
            if _is_provider_error_response(e):
                self.release(rid)
            else:
                self.settle(rid, None, None, model=model, outcome="worst_case")
            raise
        self.settle(rid, None, usage_tokens(resp), model=model)
        return resp, worst

    def rows(self, limit: int = 200) -> list[dict]:
        with self._conn() as c:
            cur = c.execute("SELECT id, run_id, tool, model, key_fp, status, reserved_usd, actual_usd, input_tokens, output_tokens,"
                            " cache_read, cache_write, outcome, created_at, settled_at FROM eval_spend ORDER BY id DESC LIMIT ?", (int(limit),))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]

    def status(self) -> dict:
        try:
            cap = self.cap()
        except LedgerRefused as e:
            cap = None
            cap_err = str(e)
        else:
            cap_err = None
        reserved, settled = self.committed()
        by_run: dict[str, dict] = {}
        for r in self.rows(100000):
            b = by_run.setdefault(r["run_id"], {"run_id": r["run_id"], "tool": r["tool"], "calls": 0, "open": 0, "reserved_usd": 0.0,
                                                "settled_usd": 0.0, "key_fp": r["key_fp"], "models": set()})
            b["calls"] += 1
            if r["status"] == "reserved":
                b["open"] += 1
                b["reserved_usd"] += float(r["reserved_usd"])
            elif r["status"] == "settled":
                b["settled_usd"] += float(r["actual_usd"])
            if r["model"]:
                b["models"].add(r["model"])
        runs = [{**b, "models": sorted(b["models"]), "reserved_usd": round(b["reserved_usd"], 6), "settled_usd": round(b["settled_usd"], 6)}
                for b in by_run.values()]
        return {"ledger": self.path, "cap_usd": cap, "cap_error": cap_err, "code_cap_usd": CUMULATIVE_CAP_USD,
                "reserved_usd": round(reserved, 6), "settled_usd": round(settled, 6),
                "committed_usd": round(reserved + settled, 6),
                "remaining_usd": None if cap is None else round(max(0.0, cap - reserved - settled), 6), "runs": runs}


def _is_provider_error_response(e: BaseException) -> bool:
    """An HTTP error status from the provider (nothing generated, nothing billed). A timeout or a dropped
    connection is NOT one: the call may have run, so it is charged at the worst case."""
    try:
        import anthropic
        return isinstance(e, anthropic.APIStatusError)
    except Exception:  # noqa: BLE001
        return False


def preflight(turn_module, *, max_usd: float | None, run_cap_required: bool = True) -> tuple[Ledger, str, str]:
    """Everything a paid run needs before its first call: the eval key (separate from production), a per-run
    ceiling, research stubbed (`turn_module` None = a tool whose model calls run in a child process that carries no
    research key), and the ledger + cap file readable. Returns (ledger, key, key_fp)."""
    if run_cap_required and (max_usd is None or max_usd <= 0):
        raise LedgerRefused("run_cap", "--run needs an explicit --max-usd ceiling")
    key = eval_key()
    if turn_module is not None:
        require_research_stubbed(turn_module)
    led = Ledger()
    cap = led.cap()
    if max_usd is not None and max_usd > cap:
        raise LedgerRefused("run_cap", f"--max-usd {max_usd:.2f} is over the cumulative cap ${cap:.2f}")
    rem = led.remaining()
    if max_usd is not None and max_usd > rem:
        raise LedgerRefused("cap", f"--max-usd {max_usd:.2f} is over what the cumulative ledger has left (${rem:.4f})")
    return led, key, key_fingerprint(key)


# ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
def print_status(led: Ledger) -> None:
    s = led.status()
    print(f"ledger  {s['ledger']}")
    cap = f"${s['cap_usd']:.2f} (code {s['code_cap_usd']:.2f})" if s["cap_usd"] is not None else f"UNREADABLE: {s['cap_error']}"
    print(f"cap     {cap}")
    print(f"settled ${s['settled_usd']:.4f}   reserved (open) ${s['reserved_usd']:.4f}   committed ${s['committed_usd']:.4f}"
          f"   remaining {('$%.4f' % s['remaining_usd']) if s['remaining_usd'] is not None else 'n/a'}")
    print("run_id | tool | key_fp | models | calls | open | reserved_usd | settled_usd")
    for r in sorted(s["runs"], key=lambda x: x["run_id"]):
        print(f"{r['run_id']} | {r['tool']} | {r['key_fp']} | {','.join(r['models'])} | {r['calls']} | {r['open']} | {r['reserved_usd']:.4f} | {r['settled_usd']:.4f}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("status")
    rel = sub.add_parser("release")
    rel.add_argument("id", type=int)
    rel.add_argument("--confirm", default=None, help="the owner's reason; required")
    a = ap.parse_args(argv)
    led = Ledger()
    if a.cmd == "release":
        if not a.confirm:
            print("refused: release needs --confirm \"<why>\" (the owner's explicit decision; never automatic)")
            return 2
        ok = led.release(a.id, outcome="owner_release", note=a.confirm[:200])
        print("released" if ok else "nothing to release (not an open reservation)")
        return 0 if ok else 1
    print_status(led)
    return 0


if __name__ == "__main__":
    sys.exit(main())
