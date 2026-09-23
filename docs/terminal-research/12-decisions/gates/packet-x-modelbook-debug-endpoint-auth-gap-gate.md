---
id: PACKET-X
title: Two zero-auth debug routes in api/routers/modelbook.py — an unauthenticated, repeatable LLM-cost trigger — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET X — the modelbook debug-endpoint auth gap

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  314278988
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs
> `api/routers/modelbook.py`'s `debug-index-drawings` / `debug-desc` routes.
> **Non-collision:** grepped both worktrees (`terminal-research` and `s7-price-level`) for
> `PACKET-X` and `packet-x-` before writing this file. The only hit in either worktree is
> inside `packet-z`'s own non-collision paragraph, which itself records that `packet-x` was
> found to be *"a disposable test fixture inside `tools/sign_gate.py`'s own self-check, not a
> claimed letter"* — and `tools/sign_gate.py:603` confirms that literally: a synthetic
> `["---", "id: packet-x", "---", "", "# PACKET X", ...]` fixture used only to exercise the
> signing tool's own parser. No real packet has ever claimed the letter X. Re-checked directly
> against the current gates directory listing (`A–T`, `V`, `W`, `Z` taken; `U`, `X`, `Y` free) —
> **X is genuinely free**, and this file claims it.

⛔ **MINIMAL PRODUCT CODE.** CP1 is a two-line diff: add one already-imported dependency
(`require_admin`, imported at `api/routers/modelbook.py:42-44` and already used by nine other
routes in this same file) to two function signatures. No new import, no new dependency
function, no behavior change to any other route.

---

## 1 · The finding, re-verified fresh against current source (not trusted at face value)

**Fresh grep, today, of every route decorator in `api/routers/modelbook.py`** (currently 2,137
lines, HEAD `76ef96c06` on `feat/s7-price-level`): every one of the ~34 `@router.*` routes in
the file carries `_user: dict = Depends(require_paid)` or `_admin: dict = Depends(require_admin)`
— **except exactly two**:

```python
@router.get("/debug-index-drawings")
def debug_index_drawings(symbol: str = Query("^IXIC")):
```
(`modelbook.py:790-791`) and
```python
@router.get("/debug-desc/{sym}")
def debug_desc(sym: str, year: int = Query(default=0)):
```
(`modelbook.py:811-812`). Neither carries a `Depends(...)` of any kind — not `require_paid`,
not `require_admin`, not even the plain `get_current_user` session check. This is a genuine
anomaly in this file, not its norm: `require_paid` (defined in this same file, `:51-61`) gates
every read, `require_admin` gates every write and every other diagnostic/generation action —
including `POST /stock/{stock_id}/descriptions/generate` (`:330-331`,
`_admin: dict = Depends(require_admin)`), the ordinary, already-admin-gated way to trigger this
exact LLM description pass. Both routes are mounted at `/api/modelbook/debug-index-drawings`
and `/api/modelbook/debug-desc/{sym}` — under the `/api/modelbook/*` prefix members already hit
daily for Model Book reads — and both URLs are guessable from the router's own file (which is
public in this repo) without any credential at all.

**This file's own header already documents one prior incident of exactly this defect class**
(`modelbook.py:6-19`): as of 2026-08-09, twelve reads were found gated with a session check
(`get_current_user`) instead of a paid-plan check, so "a free registration read the entire
library with a `curl`" — fixed by converting all twelve to `require_paid`. **`debug_index_drawings`
and `debug_desc` were added 2026-06-06** (`git blame modelbook.py:790` → `de7cdad200`; `:811` →
`5a37b912b2`), **before** that 2026-08-09 hardening pass, and they carry a *different* defect
shape than the one that pass searched for and fixed — wrong-tier auth (`get_current_user`
instead of `require_paid`) versus no auth at all (zero `Depends`). That is the most likely
reason a pass that closed twelve wrong-tier holes did not also catch these two zero-tier ones:
grepping for `get_current_user` would not have surfaced a route with no dependency at all.

### `debug_desc` invokes the real, paid LLM description path — traced, not assumed

`debug_desc`'s body (`modelbook.py:811-860`) does two separate things on every unauthenticated
GET, and both cost real Anthropic spend:

1. **Lines 840-851** — a direct, ad-hoc `client.messages.create(model=_DESC_MODEL, max_tokens=700,
   temperature=0.7, ...)` call, built from `_desc_messages(sym.upper(), company, y, None)`
   (`:845`) — **the exact same prompt-builder function** (`_desc_messages`, `:648-700`) that the
   real, member-facing description-generation path uses. Its own docstring says so explicitly:
   *"Extracted so the debug endpoint can exercise the EXACT same prompt"* (`:649-650`).
   ⛔ **This call has NO `_DESC_ENABLED` check** — the module-level kill switch
   (`MODELBOOK_DESC_ENABLED`, `:626`, default `"1"`) is checked inside `_generate_descriptions`
   (`:709-710`) but **not** at this call site. If an owner set `MODELBOOK_DESC_ENABLED=0` to shut
   off the LLM-cost feature in production, this direct call would still fire on every hit, as
   long as `ANTHROPIC_API_KEY` is configured — the debug route bypasses the feature's own kill
   switch.
2. **Line 859** — `out["generate_result"] = _generate_descriptions(sym.upper(), company, y, None)`
   — a call to **the actual production function** (`:703-766`) that the real per-stock
   description pipeline calls (`_gen_desc_async` → `_generate_descriptions`, the same function
   `_needs_desc`-gated auto-generation and the admin `POST .../descriptions/generate` endpoint
   both use). This function itself retries **up to 4 times** on a transient failure or unparsable
   reply (`:736-751`, `for attempt in range(4): ... msg = client.messages.create(...)`), each
   retry a separate billed Anthropic call.

**Net: one unauthenticated `GET /api/modelbook/debug-desc/{sym}` can trigger up to five separate
`client.messages.create()` calls to Claude** (one direct + up to four inside the retry loop),
repeatable on demand, per guessed symbol, per request — with the direct call reachable even when
the feature's own kill switch is off.

### No visible rate limit — checked, not assumed

The app has a real, wired-up rate limiter: `api/main.py` imports `slowapi`'s `_rate_limit_exceeded_handler`
and `RateLimitExceeded` (`:41-42`), imports the shared `limiter` (`:44`), and registers it on the
app (`app.state.limiter = limiter` / `app.add_exception_handler(RateLimitExceeded, ...)`,
`:7966-7967`). **`api/routers/modelbook.py` never imports or references `limiter` anywhere in the
file** (grepped) — no route in this router, debug or otherwise, carries a `@limiter.limit(...)`
decorator. So there is no per-route throttle on these two endpoints, and no auth to fall back on
either.

## 2 · Frontend caller check — zero, confirmed by grep

`grep -rn "debug-index-drawings\|debug_index_drawings\|debug-desc\|debug_desc" --include="*.jsx"
--include="*.js"` across all of `app/src`: **no matches.** A repo-wide re-check (`.py`, `.md`,
`.jsx`, `.js`, whole tree, not just `app/src`) for the same four strings outside
`api/routers/modelbook.py` itself: **also no matches** — no test file, no tool script, no runbook,
no doc references either route anywhere in this repository. Both routes' own docstrings say
what they are: `debug_index_drawings` — *"Diagnostic (no auth): dump the raw global index-pane
annotations so we can see the stored point-time format"* (`:792-793`); `debug_desc` — *"Diagnostic
(no auth): show exactly what the description LLM returns for a ticker, so we can see why a
summary won't generate"* (`:813-815`). Both docstrings **assert "no auth" as a stated, intentional
property**, not an oversight caught mid-edit — which is exactly why this is a gap and not a
draft-in-progress: they are genuinely dev-only tools, used interactively by a developer with a
terminal, with no legitimate reason for public reach and no code path that depends on them being
reachable without a session.

## 3 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | Gate both `GET /api/modelbook/debug-index-drawings` and `GET /api/modelbook/debug-desc/{sym}` behind `require_admin` — the same dependency this file already uses for every other diagnostic/generation/write action (e.g. `:331`, `:2046`), matching the file's own established convention. Plus first-ever test coverage of both routes (currently zero). | none | **XS** — a two-line signature diff + one new test file |

Both routes stay reachable to an admin exactly as they are today — same response shape, same
behavior, same diagnostic value for a developer who is signed in as an admin. Nothing about
`_generate_descriptions`, `_desc_messages`, the retry loop, the kill switch, or the LLM call
itself changes. This packet closes the *reach*, not the mechanism.

### CP1 — exactly what changes

- `api/routers/modelbook.py:791` — `debug_index_drawings(symbol: str = Query("^IXIC"))` →
  `debug_index_drawings(symbol: str = Query("^IXIC"), _admin: dict = Depends(require_admin))`.
- `api/routers/modelbook.py:812` — `debug_desc(sym: str, year: int = Query(default=0))` →
  `debug_desc(sym: str, year: int = Query(default=0), _admin: dict = Depends(require_admin))`.
- **No new import** — `require_admin` is already imported at the top of this file (`:42-44`)
  and already in scope.
- **`require_admin` is `require_admin`, never `require_paid`** — these are dev-only debug tools,
  not a member-facing feature; gating them behind a paid plan would still let any paying member
  guess the URL and trigger the LLM calls. `require_admin` (`api/middleware/auth_middleware.py:75-79`,
  `role != "admin"` → 403) matches this file's own convention for admin-only diagnostic tooling
  exactly (`:331`, `:2046`, `:2068`, and every write route in the file).
- **New test file**, following the existing pattern in `tests/test_modelbook_appearances_endpoint.py`
  (isolated DB via `monkeypatch`, `app.dependency_overrides` on `get_current_user` /
  `get_current_user_with_plan`, a `client_as(user)` fixture): asserts an anonymous caller is
  refused (401/403) on both routes, a non-admin logged-in member (`role != "admin"`) is refused
  with 403 on both routes, and an admin caller (`role == "admin"`) still gets the existing
  response shape on both routes. This is the routes' first test coverage of any kind.

### MUST-BUILD, exactly

1. Add `_admin: dict = Depends(require_admin)` to `debug_index_drawings`'s signature.
2. Add `_admin: dict = Depends(require_admin)` to `debug_desc`'s signature.
3. New test file (e.g. `tests/test_modelbook_debug_routes_auth.py`): anonymous → 401/403 on both
   routes; non-admin member → 403 on both routes; admin → 200 with the existing response shape on
   both routes (mock or stub the Anthropic client for the admin case so the test does not make a
   real network call).
4. Mutation-proof at build time: temporarily remove one `Depends(require_admin)` and confirm the
   corresponding anonymous/non-admin test goes red; restore it and confirm green.

### Explicitly deferred, NOT authorized by this line

- Deleting either route. They may still be useful to a signed-in admin for exactly the diagnostic
  purpose their docstrings describe; this packet does not judge whether they should exist, only
  who may reach them.
- Adding a `@limiter.limit(...)` rate limit to either route. Once both are admin-only, the
  no-rate-limit finding stops being a public-cost-abuse vector (an admin who wants to hammer their
  own LLM budget can already do so through the ordinary admin-gated generation endpoint); a rate
  limit for admin self-throttling is a separate, much lower-priority decision.
- Wiring `_DESC_ENABLED` into `debug_desc`'s direct `client.messages.create()` call at `:840-851`
  so it respects the same kill switch `_generate_descriptions` does. Real and worth fixing, but a
  second, independent defect from the auth gap this packet closes — noted here so it is not lost,
  not bundled in to keep this checkpoint's diff minimal.
- Any change to `_generate_descriptions`, `_desc_messages`, the four-attempt retry loop, or
  `MODELBOOK_DESC_ENABLED`'s default.

### Risk

**Very low.** Both routes are debug-only with zero frontend callers and zero existing test
coverage (confirmed by grep, §2) — nothing member-facing depends on either being reachable
without a session. The only behavior change is: an admin can still call both exactly as before;
anyone else now gets a 401/403 instead of a 200 that (in `debug_desc`'s case) silently spent real
Anthropic tokens on their behalf.
