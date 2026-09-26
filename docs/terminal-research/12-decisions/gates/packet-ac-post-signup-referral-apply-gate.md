---
id: PACKET-AC
title: apply_referral() is fully built and correct, but no member who signed up without a referral link has any way to apply one afterward — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET AC — post-signup referral-code apply gap

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  1839b8c60
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs `Settings.jsx`'s
> `ReferralSection` or `POST /api/auth/apply-referral`. **Non-collision:** grepped
> `docs/terminal-research/12-decisions/gates/` (every `packet-*` file, both single- and
> double-letter forms) and the full `s7-price-level` checkout for `PACKET-[A-Z]` and
> `packet-[a-z]{2}-` immediately before writing this file. Every single letter A–Z is taken
> (confirmed by directory listing: `a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t,
> u, v, w, x, y, z` all present). No double-letter packet exists yet anywhere in either
> worktree — `packet-a[a-z]-` and `packet-a[a-z]` matched nothing except one unrelated prose
> mention of `PACKET-A` inside `packet-w`'s own text. **AA, AB and AC are all genuinely free**
> at this check. This packet deliberately claims **AC rather than AA** — the dispatching
> instructions explicitly named AA and AB as the letters sibling agents were expected to reach
> for first ("sibling agents just took AA and AB"), so taking AC instead of racing them for AA
> minimizes the chance of two concurrently-working agents claiming the same filename before
> either pushes. Re-confirmed with `git fetch origin terminal-research` immediately before this
> write: local `terminal-research` was up to date with `origin/terminal-research`, working tree
> clean, no new packet commits had landed.

⛔ **ZERO BACKEND CODE.** CP1 is a frontend-only addition inside `Settings.jsx`'s existing
`ReferralSection` component: one controlled text input, one submit button, one `fetch()` call to
an endpoint that already exists, is already correct, and is not touched. No change to
`api/routers/auth.py`, `api/services/auth_service.py`, or any database schema.

---

## 1 · The finding, re-verified fresh against current source (not trusted at face value)

**Fresh read, today, HEAD `76ef96c06` on `feat/s7-price-level`.**

`POST /api/auth/apply-referral` is real, mounted, and requires a logged-in session:

```python
@router.post("/apply-referral")
def apply_referral_endpoint(req: ApplyReferralRequest, user: dict = Depends(get_current_user)):
    """Apply a referral code for the current user."""
    ok = apply_referral(user["id"], req.code.strip().upper())
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid referral code")
    return {"ok": True}
```
(`api/routers/auth.py:1441-1447`), with `class ApplyReferralRequest(BaseModel): code: str`
(`:1437-1438`). Request shape is a single JSON field, `{"code": "<string>"}`; response shape on
success is `{"ok": true}`; on an unrecognized/already-fully-used code, a `400` with
`detail: "Invalid referral code"`.

**The underlying service function, `apply_referral(referred_user_id, code)`
(`api/services/auth_service.py:1221-1254`), is correct for its one job** — it looks up the
`referrals` row for that code (`referral_code TEXT UNIQUE NOT NULL`, `auth_db.py:195-204`) with
`status = 'pending'`, and on a match sets `referred_user_id` + flips `status` to `'completed'`.
**No restriction of the shape the task brief anticipated actually exists in the model**: there is
no `already has a referrer` field anywhere — not on the `users` row, not in `get_referral_stats`'s
return shape (`code`, `total_referrals`, `successful_referrals` — all describe the CURRENT user's
own outbound code, i.e. how many people signed up *under* them, never who referred *them*), and
`apply_referral` itself does not check whether `referred_user_id` already has a completed row from
a different code. The gating condition named in the task brief ("only if you have no referrer
yet") is not how this backend models referrals today, so CP1 below does not attempt to
reconstruct one — it shows the input unconditionally, which is the only design consistent with
what the API actually enforces.

One corollary worth recording precisely rather than silently working around: **calling this
endpoint twice with the SAME already-completed code is not defended.** The `not row` branch
(`auth_service.py:1230-1245`) attempts a second `INSERT` carrying the same `referral_code` value
into a column declared `UNIQUE`; that `INSERT` is not wrapped in its own `try/except`, so a repeat
application of an exhausted code would raise an unhandled `sqlite3.IntegrityError` inside
`apply_referral`, which `apply_referral_endpoint` also does not catch — an unhandled exception
there is a `500`, not the intended `400`. This is a real, narrow edge case (it requires literally
resubmitting a code that has already been fully consumed), it is **not** part of what CP1 changes
or fixes, and it is recorded here only so a future reader does not re-derive "fully built and
correct" as an unqualified fact. **Explicitly out of scope for this packet** — no backend file is
touched by CP1.

**The only live caller of `apply_referral()` today is the inline signup flow.** `SignupRequest`
carries an optional `referral_code: str = None` (`api/routers/auth.py:95-99`); the signup handler
applies it inline, best-effort:

```python
if req.referral_code:
    try:
        apply_referral(user["id"], req.referral_code.strip().upper())
    except Exception as e:
        print(f"[signup] Failed to apply referral code: {e}")
```
(`api/routers/auth.py:291-296`). The frontend wires this from a `?ref=` query param on the signup
URL: `Signup.jsx:9` — `const referralCode = searchParams.get('ref') || ''` — passed into
`AuthContext.jsx`'s `signup(email, password, displayName, referralCode)`, which builds the request
body: `if (referralCode) body.referral_code = referralCode` (`AuthContext.jsx:189-191`).

**A member who signs up via the plain `/signup` URL (no `?ref=` in it) never has `referral_code`
set on that request at all** — `req.referral_code` is `None`, the `if req.referral_code:` guard at
`auth.py:291` is never entered, and `apply_referral()` is never called for that account. Nothing
in the product today gives that member a second chance.

## 2 · Frontend caller check for `apply-referral` — zero, confirmed by grep

Case-insensitive grep across the whole `s7-price-level` checkout for all three spellings named in
the task brief:

```
apply-referral    → 2 hits, both in api/routers/auth.py (the route decorator + its own docstring)
applyReferral     → 0 hits, anywhere
apply_referral    → hits only in api/routers/auth.py (import + call site) and
                     api/services/auth_service.py (the function definition + its own docstring)
```

**No `.jsx`/`.js` file anywhere in `app/src` references `apply-referral`, `applyReferral`, or
`apply_referral` in any form.** The endpoint is real, mounted, and reachable by any authenticated
`POST` — it simply has no button, no input, no caller anywhere in the shipped frontend.

## 3 · `ReferralSection` — current layout, read in full

`Settings.jsx:778-821` (`ReferralSection`, no props) is display-only:

```jsx
function ReferralSection() {
  const [referral, setReferral] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/auth/my-referral')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setReferral(d) })
      .catch(() => {})
  }, [])
  // ... handleCopy() copies the share link to the clipboard ...

  if (!referral) return null

  return (
    <TileCard icon="link" title="Referral Program">
      <div className={styles.section}>
        <p className={styles.hint} style={{ marginBottom: 12 }}>
          Share your link and earn rewards when friends subscribe.
        </p>
        <div className={styles.referralLinkBox}>
          <span className={styles.referralLink}>
            uctintelligence.com/signup?ref={referral.code}
          </span>
          <button className={styles.copyBtn} onClick={handleCopy}>…Copy</button>
        </div>
        <div className={styles.row} style={{ marginTop: 12 }}>
          <span className={styles.rowLabel}>Successful Referrals</span>
          <span className={styles.rowValue}>{referral.successful_referrals || 0}</span>
        </div>
      </div>
    </TileCard>
  )
}
```

It calls `GET /api/auth/my-referral` (`auth.py:1430-1434`, `get_referral_stats(user["id"])`) and
renders the member's own code, share link, copy button, and successful-referral count. **There is
no input anywhere in this component, in this file, or on any other page, for a member to type in
someone else's code.** `ReferralSection` is mounted from the `'referral'` card
(`Settings.jsx:2301`, `card('referral', <ReferralSection />)`), under the `'billing'` section
(`Settings.jsx:1545`, "Plan & Billing"), searchable via `Settings.jsx:1563`'s keyword entry
(`"referral invite share friends rewards link"`).

**Existing CSS classes already give the exact visual shape CP1 needs, unmodified**
(`Settings.module.css`): `.referralLinkBox` (`:337-341`, flex row) + `.referralLink` (`:342`, the
text slot) + `.copyBtn` (`:343-347`, the gold action button) are the box-plus-button pair already
used two lines above the insertion point; `.hint` (`:355`) is the existing one-line explainer
style already used at the top of this same component; `.row` / `.rowLabel` / `.rowValue`
(`:272-275`) are the existing labeled-stat-row style already used for "Successful Referrals"
directly below where CP1's new row would sit. No new CSS class is required.

## 4 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | Add a "Have a referral code?" input + submit control to `ReferralSection` in `Settings.jsx`, wired to the already-existing, already-correct `POST /api/auth/apply-referral`. No backend change. | none | **XS** — one component, no new file, no new CSS class |

### CP1 — exactly what changes

- **New local state** in `ReferralSection`: a controlled text value for the code being typed, a
  submit-in-flight flag, and an inline result message (success or the server's `detail` string on
  a `400`).
- **New markup**, inserted directly below the existing "Successful Referrals" `.row`
  (`Settings.jsx:812-817`), inside the same `<div className={styles.section}>`: a short `.hint`
  line ("Have a referral code? Enter it here."), a `.referralLinkBox`-styled row containing one
  `<input type="text">` (placeholder e.g. `ENTER CODE`, uppercased on change to match the
  backend's `req.code.strip().upper()` normalization so the member sees what will actually be
  sent) and one `.copyBtn`-styled `<button>` (label "Apply", disabled while empty or while a
  submission is in flight).
- **Submit handler**: `POST /api/auth/apply-referral` with `{ code: <trimmed, non-empty value> }`.
  On `200`, clear the input and show a brief success message (e.g. "Code applied."). On `400`,
  surface the response's `detail` (e.g. "Invalid referral code") inline, without clearing the
  input, so the member can correct a typo. On a network/other error, a generic inline failure
  message — never a thrown/unhandled promise.
- **No gating condition on whether to show the input.** Per §1, the backend has no field
  indicating "this member already has a referrer," so CP1 does not invent a client-side one. The
  control is visible unconditionally, exactly to any member for whom `ReferralSection` currently
  renders (i.e., anyone with a resolved `/api/auth/my-referral` response).
- **No optimistic mutation of `referral.successful_referrals`.** Applying someone ELSE's code
  never changes what `/api/auth/my-referral` reports about the CURRENT user's own outbound code —
  those are two different, non-overlapping numbers (§1) — so CP1 does not attempt to bump any
  number on success; the inline message is the only feedback.
- **No new endpoint, no new hook file, no new CSS module class.** The three existing classes
  named in §3 cover the full visual shape.

### Explicitly deferred, NOT authorized by this line

- Any backend change to `apply_referral()`, `ApplyReferralRequest`, or the `referrals` table
  schema — including the narrow double-apply `IntegrityError`→`500` edge case noted in §1. Real,
  but a separate, independently-approvable finding from "there is no UI at all."
- Reconstructing a durable "already applied a referral" flag (new column, new preference key, or
  otherwise) so the input can hide itself permanently after one successful use. The backend does
  not model this today (§1); adding it would be new backend surface area, which this packet's CP1
  deliberately excludes.
- Any change to the inline signup flow, `Signup.jsx`'s `?ref=` handling, or `AuthContext.jsx`'s
  `signup()` — those already work correctly for the case they cover (a referral link followed at
  signup time) and are unrelated to the retroactive-apply gap this packet closes.
- Any reward/incentive-copy change ("earn rewards when friends subscribe" is existing copy on the
  outbound side and is untouched).

### MUST-BUILD, exactly

1. Add the controlled input + submit button described above to `ReferralSection`
   (`Settings.jsx:778-821`), reusing `.referralLinkBox` / `.referralLink`-equivalent input styling
   / `.copyBtn` / `.hint` / `.row` — no new CSS.
2. Wire the submit handler to `POST /api/auth/apply-referral` with `{code}`, handling `200` /
   `400` / network-error as described above.
3. New test coverage (frontend): a test rendering `ReferralSection` (mocking `/api/auth/my-referral`
   already the way any existing Settings test would) that types a code, submits, and asserts (a) a
   success response clears the input and shows a success message, and (b) a `400` response leaves
   the typed value in place and surfaces the server's `detail` string.
4. Mutation-proof at build time: temporarily break the submit handler's fetch URL/method and
   confirm the new test goes red; restore it and confirm green.

### Risk

**Very low.** CP1 adds one new, additive UI control calling an endpoint that already exists,
already requires a login session (`Depends(get_current_user)`), and already validates its input
server-side (`400` on an invalid code). No existing behavior on this page or this endpoint
changes; the only new thing a member can do is something the backend has silently supported since
before this packet was written.
