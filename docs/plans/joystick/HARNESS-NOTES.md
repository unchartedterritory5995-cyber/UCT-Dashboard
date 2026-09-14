# Device-harness notes — the smoke account, and the traps that cost runs

Operational notes for anyone driving a real-device session. Owner rulings are marked ⛔.

---

## ⛔ THE STANDING RESET — step 0 AND the final step of every device run

> **Run `python tools/smoke_reset.py` before the session and again after it.**
> Owner ruling, 2026-09-13.

The control state is:

| | |
|---|---|
| `joystick_hub` | **unset** |
| `coachMarkSeen` | unset |
| `handedness` | `right` |
| `traceGestures` | `false` |
| notes · flags · positions | none |

The last three follow from the first: with `joystick_hub` unset, every field falls to its
default, and `right` / `false` *are* the defaults. The script verifies all of it by
read-back and exits non-zero if the account is not a control. `--self-check` proves the
verifier can fail (it discriminates 0 / 2 / 1 on clean / stored-enabled / sibling-key-lost).

### Why this exists — the two explanations that got conflated

⚰️ **2026-09-13.** The §3.2 dry run found the smoke account carrying a stored
`{"enabled":true, ..., "coachMarkSeen":true}` left behind by an earlier run. The hub was
visible, and there were **two** available explanations for that — *the account is admin*
and *the account has an explicit stored `true`* — with no way to tell them apart from the
device. A run in that state cannot speak to the rollout rule at all.

> ⭐ **With the reset applied, at stage 1 the hub is visible ONLY because the account is
> admin.** That is the entire point. Record it that way in every evidence file, so the two
> explanations can never again be conflated.

From here on the smoke account exercises the **unset-default path** at each stage — which
is the path the stage ladder actually decides, and the one `unsetDefault()` owns.

⛔ This does **not** make the account a member. It is promoted to admin at login from
`ADMIN_EMAILS` (`auth.py:253`) and there is no path to demote it. The *member* default
stays **verified by test only** — `useHubSettings.test.jsx` (unset non-admin → enabled at
stage 2) and `exposureGate.test.js`'s digest-pinned stage row.

### ⛔ "Unset" is written as `{}` — deliberately, and here is why

**There is no product path to delete a preference key.** `POST /api/auth/preferences` is an
UPSERT (`set_user_preference`, one TEXT column). `delete_user_preference` **does exist** in
`api/services/auth_service.py:1571` — and is imported into `api/routers/auth.py:75` and
bound to **no route and no caller**. A dead export; recorded 2026-09-13, not this
programme's to wire.

`{}` is the reachable equivalent, and it is equivalent for the only consumer that decides:

```js
// useHubSettings.js
const storedEnabled = stored && typeof stored === 'object' ? stored.enabled : undefined
```

`{}` is an object whose `.enabled` is `undefined`, so `storedEnabled` is `undefined`,
`everChose` (`typeof storedEnabled === 'boolean'`) is **false**, and `unsetDefault()`
decides — the same answer the resolver gives for an absent key. The card's own comment
lists the absent key and several empty forms as the *same* "never chosen" state.

⚠️ If a `DELETE /api/auth/preferences/{key}` route is ever wired, switch this script to it
and delete this paragraph — do not leave two ways to mean "unset".

---

## Credentials

`SMOKE_EMAIL` / `SMOKE_PASSWORD`. ⚠️ **On the operator box these are at User scope and are
absent from the process environment** — a script reading `os.environ` alone fails with a
message that looks like the credentials do not exist. Set them on the process first:

```powershell
$env:SMOKE_EMAIL     = [Environment]::GetEnvironmentVariable('SMOKE_EMAIL','User')
$env:SMOKE_PASSWORD  = [Environment]::GetEnvironmentVariable('SMOKE_PASSWORD','User')
```

⛔ Presence only, never values. Never echo them, never commit them, never type a password
into a mirrored phone.

---

## ⚠️ `curl` cannot reach production from the Bash tool on this box

Measured 2026-09-13: two probes of `https://uctintelligence.com/api/health` returned
`http_code=000` after a 25 s timeout — **which reads exactly like an outage**. Python
`urllib` with a browser UA got HTTP 200 immediately, twice, with a rising uptime.

**Use Python for production probes here.** And remember the standing rule: one probe
during a deploy swap is not a verdict — re-probe before concluding anything.

---

## Driving a BrowserStack Live mirror

- **Open the Live session FIRST, mint the login link SECOND.** The token lives 2 minutes.
- **Verify the typed URL before pressing go.** A mistyped URL on a mirror once ran a Google
  search for a live token. The fragment protects the server log, not a search box.
- ⛔ **Never `ctrl+a` on the mirror** — it types a literal "a".
- **Map the mirror once, then tap by computation.** Derive from two known control centres:
  at a 1600×1180 window with DevTools **closed** it measured
  `screen_x = 476 + 0.914·css_x`, `screen_y = 97 + 0.914·css_y`, and held to ~3 px for a
  whole session. Blind-tapping a small mirror is how the wrong control gets pressed.
- **Safari Web Inspector attaches without reloading the device tab** (a console history
  survived one attach cycle and was cleared on the next — the *tab* is what must not
  reload). Its console evaluates in the device's page, so it is the read path for
  `data-hub-trace` and for any DOM measurement.
- **In-page scrolling fights momentum and re-anchors.** Use
  `el.scrollIntoView({block:'center'})` from the console and then read
  `getBoundingClientRect()`; it is deterministic where scrolling is not.
- ⛔ **A Live session dies on inactivity. Device work and a local gate are SERIALISED** —
  starting a six-shard gate mid-session cost a device session on 2026-09-12.

---

## ⛔ PRESENT IS NOT SHOWING

`HubRoot` keeps its container in the DOM and sets the HTML `hidden` attribute, so a
`querySelector` presence check answers *"did React render the container"*, never *"can a
member see it"*. `offsetParent === null` is not the signal either — the hub is
`position: fixed`.

Measure **`hidden` absent + computed `display` ≠ none + visibility visible + a non-zero
box**. A rendered screenshot is stronger evidence than either.

---

## ⚠️ Instruments that produced false readings (all three read as product defects first)

1. **`/api/auth/preferences` returns each value as a JSON STRING.** `j.joystick_hub.enabled`
   is `undefined` by construction — which reads as a missing key. Parse it first.
2. **A process probe matched its own command line.** A sweep for `--shard` / `gate_shards`
   counted the bash wrappers *carrying the probe*, reporting 7 concurrent gates and FOREIGN
   shard workers — the OOM-sweep signature — when exactly one gate was running. Scope on
   process `Name` plus a specific path fragment.
3. **A PR "Files tab" scrape harvested path-like tokens from the diff CONTENT**, including
   every test path listed inside a gate manifest. Parse `diff --git` lines from the raw
   `.diff` instead; it is unambiguous.

⭐ All three are the same shape: **an instrument reporting a property of itself as a
property of what it measured.** Add a control that proves the instrument could have seen
the other answer.
