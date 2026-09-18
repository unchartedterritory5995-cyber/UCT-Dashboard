# OI-13 — the render-token rotation runbook

**Written 2026-09-15 (D-11, Part 4.3). ✅ COMPLETE 2026-09-18, owner-directed.** All 7 steps
below ran across two sessions spanning the deliberate delay this doc's own R24 caution called
for: steps 1-3 (dual tokens on Railway) and step 4 (Morning Wire's local `.env`) landed before
today; step 5's functional proof (a live `/chart` render + Morning Wire's own successful
07:35 ET run, fingerprint-matched) and steps 6-7 (clearing `*_PREVIOUS`, re-running the 11×4
control against 22.5 MB of REAL captured log content) closed it today. Full account:
`D14-LOG.md`, entries `08:33 ET` and `08:52 ET`. C-13 is CLOSED in `01-failure-forensics.md`.
Left below verbatim as the record of what the runbook actually required — read it before ever
rotating this credential again.

~~NOT STARTED — deliberately.~~ R24 says: if any step cannot complete inside one window, STOP
before setting anything. Reading the source first turned up three facts that make the rotation
a different shape than the directive assumed, and one of them puts a step outside this session
entirely.

---

## What the source actually says

| claim in D-11 §4 | what the code says |
|---|---|
| "set it on **both** services (web and chart-renderer)" | ⛔ **WRONG — there is only ONE service to set.** `api/routers/render_panels.py:70`, verbatim: *"chart-renderer is not in this path at all (OI-19): it navigates to whatever URL it is handed and validates nothing."* `CHART_RENDERER_SECRET` and `RENDER_ADMIN_TOKEN` on chart-renderer are different credentials for different jobs. |
| "a half-rotation is an outage" | ⚠️ **Already solved in code.** `_accepted_tokens()` (`render_panels.py:60-72`) honours `CHART_RENDER_TOKEN` **and** `CHART_RENDER_TOKEN_PREVIOUS` while a rotation is in flight, precisely so no sender is refused mid-rotation. |
| implied: the senders are the two Railway services | ⛔ **There are at least four senders, and one is not on Railway.** |

### The variable

**`CHART_RENDER_TOKEN`**, on **`web`** only. Read at request time in
`render_panels.py:76` (`_check_token`) — so no rebuild is needed for the *receiving* side.

⭐ **It fails CLOSED on a missing current token**: `if not want or not any(...)` — "a lone
PREVIOUS must never hold the gate open". Comparison is `hmac.compare_digest` over each
accepted value, so it stays constant-time.

### The senders — this is why it is not a one-window job

From `_accepted_tokens()`'s own docstring: *"the token is also baked into the frontend
bundle at build time, so a rotation spans a rebuild and several senders (the Discord chart
path, `/buzz`, and Morning Wire on the owner's PC)."*

1. `api/services/discord_chart_house.py:298` — the Discord chart path (reads env, web)
2. `api/services/buzz_image.py:244` — `/buzz` board render (reads env, web)
3. **the frontend bundle** — baked at BUILD time, so it needs a rebuild/redeploy
4. ⛔ **Morning Wire, on the owner's PC** — a sender this session cannot reach

**Item 4 is why the rotation was not started.** A rotation that updates Railway and not the
owner's local engine leaves the morning wire refused at `/r/*` the next time it renders,
and the failure would land at 07:35 ET on a weekday.

---

## The runbook — D-12's first change, and it is SAFE because of dual acceptance

⭐ **The dual-token design means this is NOT an atomic operation and must not be treated as
one.** The old token keeps working throughout; nothing is ever refused mid-flight.

1. **[session, one tap]** Generate the new value INSIDE the pod. Never printed, never
   logged, never in a report or a commit.
2. **[session, one tap]** `CHART_RENDER_TOKEN_PREVIOUS` := the CURRENT value of
   `CHART_RENDER_TOKEN`, on `web`. Redeploy, verify presence-and-length only. From this
   moment both tokens are accepted and the rotation cannot break a sender.
3. **[session, one tap]** `CHART_RENDER_TOKEN` := the NEW value, on `web`. Redeploy. Web's
   own senders (Discord chart path, `/buzz`) now use it; the frontend bundle rebuilds with
   it on the same deploy.
4. **[owner, KEYBOARD]** Update the new value in Morning Wire's `.env` on the owner's PC.
   ⛔ This is the one step no session can do, and the reason the whole thing is not a
   session action.
5. **FUNCTIONAL PROOF, both senders:** a real `/chart` in `#render-smoke` by browser (the
   Discord path) and one morning-wire render (the PC path). A presence check is not proof
   that two sides agree on a value.
6. **[session]** Once every sender holds the new value, CLEAR
   `CHART_RENDER_TOKEN_PREVIOUS`. ⛔ *"An uncleared previous is not a rotation, it is two
   live tokens."* This step is the rotation; skipping it means nothing was rotated.
7. **[session]** Re-run C-13's 11×4 control against the LIVE log path. Zero occurrences of
   the NEW value in any encoding, and the OLD value must not appear either. Only then does
   the C-13 row move off 🟡.

## Abort

Steps 2 and 3 are individually reversible: re-set the variable to its prior value and
redeploy. Because dual acceptance is live from step 2 onward, an abort at any point leaves
every sender working. ⛔ The one irreversible-ish moment is step 6 — clear PREVIOUS only
after step 5 has proven BOTH senders.

## Blast radius if it goes wrong

`/r/chart`, `/r/buzz` and the morning-wire render return **403** and the Discord chart
path, the buzz board and the wire stop producing images. No member data is touched. The
recovery is one variable.
