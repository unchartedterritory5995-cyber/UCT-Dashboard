# Wave L Slice 3 — the browser-extension auth boundary

**STOPPED HERE FOR A DECISION**, per the slice instruction: *"If browser-extension
security constraints require a different token/session bridge, stop at that
architecture boundary and prove…"*. They do. Nothing has been built.

## The extension cannot reuse the session as it stands — three independent blockers

Each verified in code, not assumed.

**1. The session cookie is `SameSite=Lax`** (`api/routers/auth.py::_set_session_cookie`):
```python
key="uct_session", httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=30 days
```
Lax cookies are not sent on cross-site subrequests. A `fetch` from a
`chrome-extension://` context — top-level page, service worker, or an embedded
iframe whose top-level is the extension — is cross-site. The cookie is not sent.

**2. CORS is `allow_origins=["*"]` with no `allow_credentials`** (`api/main.py:6968`).
Even if the cookie could be sent, a browser refuses a credentialed cross-origin
response under a wildcard origin. And `allow_credentials=True` alongside `"*"` is
invalid per the CORS spec — enabling it would mean enumerating origins, i.e.
changing a global middleware for every route in the app.

**3. `get_current_user` accepts a cookie and nothing else**
(`api/middleware/auth_middleware.py:17`):
```python
def get_current_user(uct_session: Optional[str] = Cookie(None)) -> dict:
```
There is no header, bearer, PAT or API-key path to reuse anywhere in the app.
`PUSH_SECRET` bearer exists for machine routes, but it is a shared secret with no
member binding — unusable for member auth, and not a candidate.

## ⛔ The obvious "reuse existing prior art" answer is a trap

There IS a non-cookie credential in this codebase — the calendar export token,
`hmac(PUSH_SECRET, user_id)`, with the in-file note *"Stable per user (no TTL) so
webcal…"*. Reusing that shape for capture would be a mistake:

- **no expiry** — it is derived, so it lives as long as the user id
- **no revocation** — revoking means rotating `PUSH_SECRET`, which breaks every
  member's calendar subscription at once
- **no per-member rotation** — it is a pure function of `user_id`
- it protects a **read-only feed**; capture is a **write** path

A derived, non-revocable, never-expiring write credential is strictly worse than
the cookie it replaces. Named here so this doesn't get "reused" later on the
grounds that the pattern already exists.

## The three real options

### A — `chrome.cookies` permission: read `uct_session` and attach it

**Recommend against.** It requires the `cookies` permission plus host permission,
and it deliberately defeats `httpOnly` — the entire purpose of which is that no
script can read the session. It hands a **30-day, full-privilege** session token
to extension JavaScript. Any compromise of the extension is total account
takeover for a month, with no scope limit and no revocation short of logging the
member out everywhere. Fast to build; the worst security posture on offer.

### B — a scoped capture token (recommended)

A purpose-built credential, minted first-party, proving each property the slice
instruction demands:

| Property | Design |
|---|---|
| **Scope** | capture only — `POST /api/j2/capture` and the destination list. Not a session; cannot read notes, cannot touch settings, cannot authenticate the SPA |
| **Storage** | `chrome.storage.local` — extension-private, not reachable from any page |
| **Expiry** | fixed TTL (90 days proposed), re-minted from Settings |
| **Revocation** | a real row, listed and revocable in UCT Settings, checked server-side per request — revoking one member's extension affects nobody else |
| **Tenant binding** | the row carries `user_id`; the endpoint resolves the member from the token, so tenant isolation stays exactly where Slice 1 put it — server-side, before any lookup |
| **No credentials in logs** | the capture route already logs no question/source text (Wave K rail); the same rail extends to the token |
| **Permissions** | `activeTab` + `storage` + host permission for **one** host. No all-sites, no tabs, no history, no clipboard, no background page |

Transport is `Authorization: Bearer` — a header, so `SameSite` never applies and
the existing wildcard CORS is sufficient (`allow_headers=["*"]` already permits
it). **No change to the global CORS middleware, no change to the session cookie,
no second login.**

**This is a new auth surface**, which is why it is a decision and not an
implementation detail.

### C — complete capture in a first-party UCT window

No new auth surface at all: the extension opens a real uctintelligence.com
popup, which is same-site and authenticates normally. Costs the thing Slice 3
exists for — the member leaves the page they are reading — and the step count
lands at or worse than the copy-paste flow the extension is meant to beat.

## Browser target — stated, not implied

**Chromium-first: Chrome and Edge, Manifest V3.** Firefox differs on MV3 details
and background scripting; Safari needs a native app wrapper and a separate
distribution path. Neither is in scope, and parity will not be claimed for
anything not actually built and certified. Browser-specific assumptions get
isolated behind one module so a later port is a port, not a rewrite.

## What is NOT in question

Rights, provenance, coverage, duplicates and tenant isolation stay exactly where
they are — server-side, behind `POST /api/j2/capture`. The extension is a door.
Whichever option is chosen, `full_page` still refuses, the 8k passage ceiling
still holds, domain and canonical identity stay server-derived, and a member
selecting an entire article hits the same boundary as every other door. DOM
access must not become a way around any of that.

## The decision needed

**A, B, or C.** I recommend **B**, and will not build an auth surface without an
explicit ruling.
