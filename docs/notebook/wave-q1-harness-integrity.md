# Wave Q1 — harness integrity: a port is not an identity

> **The gate this closes:** before any local or tunnelled certification run, the
> harness must be able to PROVE which server answered. It could not, and nobody
> noticed until the probe fetches came back empty and looked like a browser
> limitation.

---

## The incident

Port **8099** had **four listeners**:

| PID | what | bound | since |
|---|---|---|---|
| 39360 | `scripts/hub_sandbox_boot.py --data-dir C:\data-hubtest --port 8099` | `0.0.0.0:8099` | ~00:02 |
| 14280 | `python -m http.server 8099 --bind 127.0.0.1` (Wave Q) | `127.0.0.1:8099` | 09:57:00 |
| 37828 | `python -m http.server 8099 --bind 127.0.0.1` (Wave Q) | `127.0.0.1:8099` | 09:57:10 |
| 36920 | `python -m http.server 8099 --bind 127.0.0.1` (Wave Q) | `127.0.0.1:8099` | 10:04:23 |

The hub sandbox was there first and belongs to another workstream. Wave Q bound
three more servers on the same port, **and Windows allowed every one of them
without an obvious bind failure.** Requests to `127.0.0.1:8099` could be answered
by any listener; the local probe fetches came back empty, which from the outside
is indistinguishable from a browser that cannot run the probe.

This is the failure class CLAUDE.md already records against port 8077 — *"a
concurrent session bound a second server… the phones drove the wrong server
through the tunnel for the rest of the run… That run is void."* I read that rule
as being about **8077** and did not check whether **8099** was owned. It was.

⛔ **The lesson is not a port number.** `bind()` succeeding proves nothing on
Windows. **A PORT ASSIGNMENT IS NOT A SERVER IDENTITY.**

### What was NOT affected

Nothing in the §32 browser matrix. Every certified row was measured against
`https://uctintelligence.com`; the local server was only ever a shake-out. The
hub sandbox was not stopped, restarted, repurposed or modified — only Wave Q's
own three PIDs were stopped, and it was still answering `/api/health` with
`ok`, uptime 42,972 s and its own `wire_date: 2026-01-02` afterwards.

---

## What now exists

**`tools/q1_probe_server.py`** — a probe server that can prove it is the one
answering:

- **Pre-bind ownership check.** It CONNECTS to the port first. A successful
  connect proves somebody is there; on Windows a successful *bind* proves
  nothing. If anyone answers, it raises `PortAlreadyOwned` and stops. ⛔ It never
  kills the incumbent — that server may not be ours, and a port is not something
  we are entitled to take.
- **OS-assigned port by default.** No hard-coded 8099, and no swap to another
  hard-coded number either. An ephemeral port narrows the odds; it settles
  nothing on its own.
- **A nonce minted BEFORE anything binds**, served at `/__uct_probe_identity`
  with `{kind, run_id, nonce, pid, started_at, root}`.
- **Post-bind self-verification.** `start()` does not return a URL until that
  exact nonce has come back from it.
- **`/__uct_probe_slow_identity?ms=N`** — the same payload after a bounded delay,
  so a runner can prove it separates *slow* from *wrong* from *absent*.

**`app/public/q1-probe.html`** — the browser refuses too. Given `?expect=<nonce>`
it verifies before measuring anything; on a mismatch it disables Run, prints
`SERVER_IDENTITY_MISMATCH`, and emits **no metrics at all**. Without `?expect=`
(production, https, the app's own origin) the origin is the identity.

**`tools/q1_browser_probe_run.py`** — seven outcomes, and infrastructure never
collapses into "the browser cannot do it":

```
HARNESS_ARTIFACT_INVALID   our page rendered but did not compile
SERVER_IDENTITY_MISMATCH   somebody else answered
SERVER_UNREACHABLE         nothing answered
TRANSPORT_TIMEOUT          slow, not wrong
BROWSER_API_UNSUPPORTED    a real browser limit
BROWSER_TEST_FAILED        it ran, and it failed
PASS
```

`--serve` starts a verified local server and runs against it. `--self-check`
runs the three controls below. Results from `--serve` are written as
`local-<label>.json` with `"certifying": false`, so a shake-out **cannot
overwrite production evidence** — which it did once, before this existed.

---

## The controls, and they are load-bearing

`python tools/q1_browser_probe_run.py --self-check`:

```
A right server   : identityOk=True runnable=True
B wrong server   : identityOk=False runDisabled=True outcome=SERVER_IDENTITY_MISMATCH emittedNoMetrics=True
C slow server    : ok=True reason=OK delayedMs=1200
C impatient      : ok=False reason=TRANSPORT_TIMEOUT
```

⭐ **B is the historical failure, and it is mutation-proved**: delete the nonce
comparison in the page and the self-check goes red. A wrong server can no longer
silently produce plausible numbers.

`tests/test_q1_probe_harness.py` (14 rails) covers the rest: a stranger
answering 200 is refused; a *previous run's own probe server* is refused on its
stale nonce (with its own nonce accepted, as the control); the harness refuses to
bind beside a listener and does not kill it; slow-but-correct is accepted; slow
past the deadline is `TRANSPORT_TIMEOUT`; two runs never share a nonce. Both the
identity comparison and the connect-based ownership check are mutation-proved.

⚰️ **A platform fact these rails discovered rather than assumed:** on this
Windows box, connecting to an *unbound* loopback port does not get refused — the
packets are dropped and the connect times out. "Nothing is there" and "something
is slow" are the same observation at the socket layer. Which is precisely why
identity has to be asked for rather than inferred from timing.

---

## The order that must hold

1. **ARTIFACT EXECUTABLE** — the probe's script compiled (`window.__q1Run` is a
   function). A page can render perfectly and have failed to compile; that
   already happened once and read as a browser limitation.
2. **SERVER IDENTITY CORRECT** — the nonce came back.
3. **only then, INTERPRET THE BROWSER RESULT.**

---

## Routed, not fixed (§22)

The hub sandbox currently owns `0.0.0.0:8099` and stayed healthy throughout.
Its owner may want an exclusive-bind guard, an identity endpoint of its own, or a
launcher check — **that is their call, not Wave Q's.** Nothing about it was
changed here.
