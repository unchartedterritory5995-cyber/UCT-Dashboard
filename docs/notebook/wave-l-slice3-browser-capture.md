# Wave L Slice 3 — UCT Browser Capture

**Option B, built and proven.** A scoped, revocable, member-bound capture
credential; a first-party authorization handshake; a Chromium MV3 extension that
is a DOOR into the existing contract. No second backend, no second rights model,
no second provenance model, no second destination system, no second duplicate
model.

The auth boundary document that preceded this (`wave-l-slice3-extension-auth-boundary.md`)
stated the three blockers and the three options. This records what was built and
what it was measured against.

---

## 1. The credential

`api/services/journal_two/capture_auth.py` owns it. Every property the ruling
demanded, and where it lives:

| Property | How |
|---|---|
| **Member-bound** | `j2_capture_tokens.user_id`; the resolver produces exactly one `user_id` and the client never supplies one |
| **Capture-only** | two scopes, `notebook:capture:write` + `notebook:capture:destinations:read`, granted as a frozen literal — a client does not choose its own authority |
| **Revocable independently** | one row, `revoked_at`, checked server-side per request |
| **Finite-lived** | absolute 30-day expiry; **use does not extend it** |
| **Opaque / high entropy** | `secrets.token_urlsafe(32)` = 256 bits, no claims encoded |
| **Useless for normal APIs** | reached only via `require_capture_scope`, which `get_current_user` knows nothing about |
| **Checked server-side** | on every request, by digest lookup |

⭐ **The TTL is derived, not picked.** The session cookie this credential is
strictly weaker than is `max_age=30 days`. A capture token that outlived the
session would be the longest-lived member credential in the system, which
inverts the point. So 30 days is the ceiling, and it is what is used.
`test_the_ttl_never_outlives_the_session_it_is_weaker_than` fails if the session
TTL moves, rather than letting a derived number silently stop being derived.

⛔ **Only a SHA-256 digest is stored.** Lookup is *by* digest, so there is no
comparison of a raw secret against a stored one anywhere — which makes the
timing question moot rather than merely handled. A database leak yields digests
of 256-bit random strings.

⛔ **The named trap, refused.** The calendar export token is
`hmac(PUSH_SECRET, user_id)` — its own comment says *"Stable per user (no TTL)"*.
Copying it would have produced a derived, never-expiring, non-revocable **write**
credential whose revocation means rotating `PUSH_SECRET` and breaking every
member's calendar subscription. It is named in the module docstring and railed
(`test_the_calendar_export_token_cannot_authorize_capture`) so nobody "reuses
the existing pattern" later on the grounds that it exists.

---

## 2. The handshake

```
extension  → chrome.identity.launchWebAuthFlow opens
             /journal/capture-connect as a TOP-LEVEL first-party navigation
             (a SameSite=Lax cookie rides top-level navigations; it is
              subrequests it refuses — so no second login, no password)
member     → sees what is granted and what is not, clicks Connect
page       → POST /api/j2/capture/authorize   (same-origin, session-authed)
server     → single-use code, 120s, bound to member + client + redirect
page       → redirect to the extension's own chromiumapp.org URL,
             code in the URL FRAGMENT
extension  → POST /api/j2/capture/token       (code → scoped bearer)
server     → the code is spent; a replay is refused
```

⭐ **The code travels in the fragment.** A fragment is never sent to a server,
never lands in an access log, and is not carried in a Referer. The bearer never
appears in a URL at all.

⛔ **The code is consumed by a conditional UPDATE** (`WHERE consumed_at IS NULL`),
not a read-then-write. Two simultaneous exchanges cannot both win: a replay is
refused because the row is already spent, not because we happened to look first.

⛔ **One refusal message for "unknown", "already used" and "expired"** — a caller
learns nothing about which, and nothing here is worth a distinguishable answer.
Railed.

### CSRF / confused deputy — TWO independent barriers

Neither depends on the other, which is the point of having both.

1. `/authorize` is a POST authenticated by the `SameSite=Lax` session cookie,
   which a browser does not attach to a cross-site POST. **A hostile page cannot
   make this call as the member at all.**
2. The code is minted BOUND to a redirect that must be a `chromiumapp.org`
   extension origin (and, with `CAPTURE_EXTENSION_IDS` set, one of ours). A code
   obtained some other way still cannot be steered to a web page.

---

## 3. Destination discovery — the widening that was refused (§18)

**Measured, not assumed.** `/api/j2/notes/recents` — the endpoint the in-app
picker already uses — returns `_row_to_note_summary`, which carries **`bodyPlain`:
the note's actual research text**, plus subtitle, tags, properties, hero image
and folder. Granting the extension that endpoint would have handed it a rolling
window of the member's own writing to satisfy a dropdown that renders a title,
and it would have looked identical from the outside.

So `capture_destinations.py` returns exactly `{id, label, ticker}` — derived from
the actual consumer (`CaptureDialog.jsx`'s picker reads `r.id` and `r.title`; the
destination row renders the ticker). A rail asserts the projection keys, and a
second rail asserts that the recents projection **would** have leaked, so if that
ever stops being true the decision gets re-derived rather than inherited.

A note's title is not its content — but it is not nothing either, and it is the
smallest thing that can answer "where am I saving this?". That trade is stated
rather than buried.

---

## 4. Blast radius (§8) — derived from the app, never typed

`require_capture_scope` is a dependency a route must opt into **by name**.
Teaching `get_current_user` to accept the bearer would have made it a site-wide
credential in one line, with nothing in the diff saying so.

`test_the_extension_credential_reaches_ONLY_the_browser_capture_surfaces` walks
the REAL app's resolved dependency graph for a marker attribute and asserts the
set is exactly:

```
/api/j2/capture               notebook:capture:write
/api/j2/capture/destinations  notebook:capture:destinations:read
```

A route that opts in tomorrow is covered the day it lands. There is no
hand-typed allowlist to drift.

**And the behavioural half, on the wire:** the same token is refused by
`/api/j2/notes`, `/api/j2/notes/recents`, `/api/auth/me`, `/api/j2/accounts`,
`/api/watchlists`, and `/api/j2/capture/connections` — that last one deliberately,
because a credential that could enumerate or revoke credentials would be
self-managing, and managing connections is an account operation.

### Mutation-checked, both directions

| Mutation | Result |
|---|---|
| `get_current_user` widened to accept the capture bearer | **RED** — `test_an_extension_token_is_refused_by_an_unrelated_endpoint` |
| scope enforcement removed from `require_capture_scope` | **RED** — `test_a_wrong_scope_credential_is_refused_with_a_DIFFERENT_answer` |

Both via `tools/mutation_check.py`, byte-exact restore verified by hash.

---

## 5. What the real browser proved (§20)

`tools/capture_extension_audit.py` loads the **actual unpacked extension** into
**actual Chromium** against the fail-closed sandbox. **28/28 steps, PASS.**

⭐ **The dev build differs from the shipped one in exactly two values**, and the
audit diffs every file byte-for-byte to prove it before it starts: `API_BASE` and
the single host permission. So everything proven here about permissions, CSP and
page access is a fact about the artifact that ships.

Proven, in order: not connected → the popup asks to connect · nothing stored
before connecting · the first-party page appears and is approved · a scoped
credential is stored · its scopes are capture-only · it is not the session ·
`chrome.storage.local` holds that key and nothing else · the injected read
returns the member's selection · and returns nothing hidden, from a form, or
from the page body · a passage saves · a link saves · a repeat reuses the same
document · the same passage re-saved reports already-saved · **full_page is
refused (422) even from the extension** · an oversized passage is refused ·
**the same token is refused by an unrelated endpoint (401)** · the member revokes
it from UCT · the next capture fails closed · **it says reconnect, not 401** ·
the popup shows the reconnect state · reconnect completes · capture works again.

### ⭐ The CORS answer, from observation rather than memory (§10)

**No preflight was issued.** Chromium's host permission exempts the extension's
own cross-origin request, so the global wildcard CORS middleware was never
involved. **`allow_credentials` was not enabled, no origins were enumerated, and
the global middleware was not touched** — the narrowest working network policy
turned out to be *no change at all*. The request log in
`tools/capture_extension_out/report.json` is the evidence; the audit records
`preflightObserved` on every run rather than asserting it, so a future Chromium
change shows up as a changed fact instead of a broken test.

### Anti-vacuity

Fewer than 20 steps is itself a finding — a run that fell over early can never
read as a pass.

---

## 6. Permissions (§11) — four, each justified

| Permission | Why it is necessary |
|---|---|
| `activeTab` | the current tab, only on explicit invocation — preferable to permanent all-sites access |
| `storage` | `chrome.storage.local` for the scoped credential |
| `identity` | `launchWebAuthFlow`, the first-party handshake |
| `scripting` | reading the member's own selection from the active tab |

**One host permission**, `https://uctintelligence.com/*`. No `<all_urls>`, no
`tabs`, no `history`, no clipboard, no background page, no `cookies`, no
optional permissions, **no declared content scripts at all** (a declared content
script runs whether or not the member invoked anything). Strict extension CSP,
no remote script, no `eval`, no inline handlers, no secret in source.

⛔ **`contextMenus` was considered and dropped.** A right-click door is a
convenience the popup and the keyboard shortcut already cover, and the ruling's
direction is fewer permissions. Recorded as deferred, not as missing.

All of the above is railed in `extensionBoundary.test.js` — **AST, not grep** —
and re-verified against the manifest Chromium actually parsed.

⚰️ **The rail caught itself first.** Its initial text-based half went red on
`auth.js`'s own docstring — the one explaining that `chrome.cookies` is
deliberately NOT used. That is the exact false-positive class this program
documents, committed inside a rail written to prevent it. It now blanks comments
before any text check, keeping string literals (`'uct_session'` as a literal
would be real).

---

## 7. Page access (§12)

`readSelection` in `popup.js` is the **entire** page-access surface: one
expression, injected on invocation. A rail parses it and asserts the member
expressions inside are exactly `getSelection` and `toString` — if that list
grows, the extension started reading the page, which is a rights decision, not a
refactor. A second rail bans `querySelectorAll`, `innerHTML`, `documentElement`,
`forms` and `cookie` anywhere in the extension's code.

The real-browser run confirms it: the audit page carries a hidden div and a form
input both marked `MUST-NOT-BE-READ`, and neither appears in what came back.

---

## 8. Two defects this slice found in already-shipped code

### ⚠️ The confirmation named the kind from the wrong authority — FIXED

Found by the real-browser run. Save a passage from an article, then save the
**link** from the same article into the same note. The document is correctly
still `web_passage`, and both doors read `captureType` as "what I just did" — so
a member who saved a link was told **"Saved passage to…"**.

This is the same category error Slice 2 fixed once: that fix swapped one wrong
authority for another. `captureType` describes what the **document** now holds;
the tier describes what the **request** did, and only one of them answers "what
did I just do". Fixed in `captureConfirmation` (the shared client boundary, which
now takes the requested tier), in the extension popup, and railed both ways.
Duplicate-ness is still the server's answer and is still never computed by a UI.

### ⚠️ The Slice 2 convergence rail matched by substring — FIXED

It fired on `/api/j2/capture/authorize` and called the authorization page a door
bypassing `capture.js`. Correct detection, wrong classification: those routes
perform no capture. The invariant is about the **one write path per semantic
kind**, so the matcher now respects path segments — a literal followed by `/` is
a different endpoint and always was. A query string still counts, so
`/api/j2/capture?x=1` stays caught, and both directions are railed.

---

## 9. Browser target (§21)

**Chromium-first: Chrome and Edge, Manifest V3.** Firefox and Safari are
**unbuilt compatibility work**, and no parity is claimed for either. Firefox
differs on MV3 background scripting and uses a different identity redirect
origin; Safari needs a native app wrapper and a separate distribution path.
Browser-specific assumptions are isolated in `lib/config.js` and `lib/auth.js`
so a later port is a port, not a rewrite of capture semantics.

---

## 10. Honest limits

- **An extension compromise can steal this token.** The security property is
  DAMAGE CONTAINMENT, not secrecy: the ceiling is authorized external Notebook
  capture for that one member, until expiry or revocation — no note reads, no
  account access, no session. Stated in the module docstring, not only here.
- **"Forget this connection" in the popup is local only.** It clears the
  extension's copy; the credential stays valid server-side. Revoking for real is
  Settings → Browser Capture → Disconnect. Both surfaces say so, because a
  revoke that quietly did not revoke is worse than no button.
- **`CAPTURE_EXTENSION_IDS` is unset by default**, which means any well-formed
  `chromiumapp.org` id may complete the handshake — correct for development and
  for an unlisted extension whose id is not yet fixed, since the redirect can
  still only reach an extension and never a web page. **Set it in production
  once the published id exists.**
- **The audit reads the selection with host permission, not with `activeTab`'s
  invocation grant**, because it drives the extension page directly rather than
  through a real toolbar click. The article is served from the sandbox origin so
  no all-sites grant is needed. The permission set is proven; the specific
  activeTab grant path is not, and is not claimed.
- **`last_used_at` is written at most every 5 minutes**, deliberately — an
  unthrottled per-request write on an auth path is the 524 outage class.
- **Not built:** context-menu capture, capturing into a *new* note from the
  extension, multi-select passages, offline queueing. None are in the exit
  standard.

---

## 11. Exit standard (§23)

> A member reading external research in Chromium can select useful text, invoke
> UCT, see the correct source and destination, save, and remain on the page —
> with provenance intact and without giving the extension possession of their
> full UCT account session.

**Met.** The popup opens over the page and never navigates away from it; the
source title and domain are shown before saving; the destination is a picker over
the member's own recent notes; the passage and annotation survive a failure and a
forced reconnect; and the extension holds a capture-only credential that is
refused by every other endpoint in the app — proven on the wire, in Chromium.
