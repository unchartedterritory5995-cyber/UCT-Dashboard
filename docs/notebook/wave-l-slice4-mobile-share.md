# Wave L Slice 4 — the mobile share door

**Date:** 2026-09-08 · Entry checkpoint §7 slice 4 ("Mobile — Web Share Target,
real manifest, phone-width certification").

**Exit standard (§23-shaped):** *a member reading anything on their phone can
hand it to UCT from the system share sheet, choose where it goes, and have it
land in the Notebook with provenance intact — including when their session has
lapsed.*

**Met**, and certified at 390px in a real browser against the fail-closed
sandbox. The residuals are named in §9.

---

## 1. The decision that shaped everything: `method: "GET"`

A Web Share Target can be `GET` or `POST`. `POST` is the richer form — it can
carry files — and it is delivered to the page **through a service worker `fetch`
handler**. It cannot work without one.

`app/public/sw.js` is a deliberate **kill switch**, dated 2026-04-26. The
previous worker was cache-first over all static assets, so browsers served stale
JS/CSS bundles indefinitely after every Railway redeploy — shipped code was
invisible to existing members until they cleared site data by hand. The current
worker installs, deletes every cache the old one made, unregisters itself, and
carries **no fetch handler**, with a comment saying so.

So choosing `POST` here would mean reintroducing a fetch handler, and that outage
class with it, to gain nothing this door needs: `title`, `text` and `url` ride a
query string perfectly well.

⛔ **The method and the worker are ONE decision, and the rail asserts them
together** (`shareTarget.contract.test.js`). Asserted separately, someone could
satisfy each in turn and walk the pair apart. Asserted together, "make it POST"
fails in one place that explains why. Both halves are mutation-checked: flipping
the manifest to POST goes red, and adding a `fetch` listener to `sw.js` goes red.

---

## 2. Modelling: which of the three capture kinds is a share?

Slice 2's corrected invariant is **one shell, three write paths** — external
source (`capture.js`), internal UCT object (`captureTargets.js`), member thought
(`thoughtCapture.js`). A share is not automatically any of them, because the
share sheet does not tell us what the member meant.

| Payload | Kind | Why |
|---|---|---|
| A `url`, or a link inside `text` | **source** | There is something to cite. `text` minus the link is material *from* that source, which is a `passage` — byte-for-byte the object a PDF excerpt already is. |
| Text with no link at all | **thought**, prefilled | There is **no citable source**, so no document can exist: the web write path requires a URL and refuses without one. |

⛔ **The second row is not a claim that the member wrote it.** It is the door
declining to decide. The dialog offers both readings and the member's own Save
settles provenance — the identical ruling Slice 2b made for typed text that looks
like a link (`looksLikeUrl` **offers**, never switches). Silently filing a
URL-less share as a source would manufacture provenance; silently asserting the
member authored it would be the mirror lie. Only the member can answer, so only
the member is asked.

⭐ **This forced one small contract extension.** `CaptureDialog` picks its mode
from `initial.url || initial.passage`, so prefilling a URL-less share into
`passage` would open **source** mode and then block on a missing URL — the member
would see their own words quoted back at them above an error asking for a source
they do not have. Doors may now prefill `initial.thought`.

---

## 3. ⛔ The `url` field is usually empty, and that is the majority case

Chrome-on-Android sharing a page fills `url`. A great many apps — news readers,
Reddit, X, most messaging apps — put the link **inside `text`** and send no `url`
at all. A door reading only `url` opens blank for most real shares and looks
broken.

`extractUrls` finds http(s) links in the text; an explicit `url` always wins
(the sending app naming its own link beats our inference). Trailing sentence
punctuation is trimmed, but `)` is **not** — it is legal and common inside real
URLs. A bare domain with no scheme is ignored rather than guessed at, because
guessing a scheme invents a source the member never gave us.

A "passage" identical to the title is dropped: share sheets routinely send both,
and keeping it would fabricate a quotation the member never selected.

---

## 4. ⛔ The share must survive sign-in — the defect this slice is really about

`AuthGuard` redirects an unauthenticated visitor with `<Navigate to="/login"
replace />` and **keeps no record of where they were going**. On a phone that has
not opened UCT in weeks — precisely this door's population — that means: share an
article, sign in, land on the dashboard, article gone. Nothing throws and nothing
logs. `App.jsx` already records this same class being fixed once for
`/calendar?earnings=NVDA`.

So `/journal/share` is registered **outside `AuthGuard`** (like Slice 3's
`/journal/capture-connect`) and owns its own signed-out case, with the payload on
**two independent carriers** because each alone has a real failure mode:

- `sessionStorage` (`uct.pendingShare.v1`), written **before any auth decision is
  rendered** — writing it only on the signed-in path would lose it in exactly the
  case it exists for. Consumed **exactly once** by `CaptureHost`; a share left in
  storage reopens the dialog on every mount and becomes a capture the member
  cannot dismiss.
- `?next=` on the sign-in link, which survives blocked storage. `Login.jsx`'s
  `safeNextPath` refuses anything not starting with a single `/`, so it cannot
  become an open redirect; the page asserts that itself rather than relying on
  the guard catching it.

**It is not a hole.** The page mints nothing and reads nothing — it parses a
query string the member's own share sheet produced. Every write that follows is
the session-authenticated `POST /api/j2/capture` (or `/api/j2/notes`) that 401s
without a cookie.

A **free** member gets a sentence, not a bounce: Notebook is paid, so forwarding
them would hand AuthGuard's redirect to Morning Wire with a capture dialog
opening over a page they cannot save from. A **5xx** holds the splash rather than
reading as signed-out — AuthGuard's own R2 ruling, for the same reason plus one
more: a blip must not discard a share behind a sign-in screen nobody needed.

---

## 5. Installability, because the door is gated on it

The share sheet only offers UCT once the PWA is installed. The manifest gained
`id`, `scope`, and a real icon set; `tools/gen_pwa_icons.py` renders them from
the brand master so nobody has to regenerate four binaries by hand.

⭐ **The maskable icon is a different picture, on purpose.** Android composites a
maskable icon under a launcher-chosen shape and may crop outside the inner 80%
safe zone, so a full-bleed mark loses its edges; the maskable variant paints the
brand ground and scales the mark to 62% of the canvas. Shipping one file as both
`any` and `maskable` guarantees one of the two is wrong. The rail reads the PNG
**IHDR header** rather than trusting the manifest's `sizes` string.

---

## 6. ⛔⛔ The intro animation was covering the door — and the audit said it was fine

The first phone-audit run reported **zero findings**. The screenshot showed the
9.3-second cinematic intro filling all 390px of the share card.

Every DOM measurement was *correct*. The heading was right, the sign-in `href`
carried the payload, horizontal overflow was 0, no tap target was under 44px —
and the member could not see or touch any of it. **A probe that reads the DOM
cannot see occlusion.**

Two things came out of it:

1. **The product fix.** `App.jsx` already had an intro exclusion list carrying
   exactly this reasoning ("landing page must see it immediately, not a 9-second
   brand film"). `/journal/share` and `/journal/capture-connect` were added to
   it. Both are reached from **outside the app shell** to do exactly one thing,
   both are full page loads so the intro plays every time, and one of them opens
   inside a small `launchWebAuthFlow` OS window. A share sheet capture whose
   whole objective is "in seconds" cannot open with a 9.3s film.
   ⚰️ The capture-connect case shipped in Slice 3 and nobody saw it.
2. **The harness fix.** `share_target_phone_audit.py` now asks
   `document.elementFromPoint` what a **finger** would land on, for the card, its
   action, and the dialog. Proven by running it against the pre-fix build, where
   it names `div._revealScene_…` three times — a rail nobody has seen fail is not
   a rail.

⭐ It also stopped waiting on `[role="dialog"]`: **the intro carries that role
too**, so the bare selector returns whichever comes first in the document and the
probe would measure the brand film while reporting on capture. The wait and the
scope now name a field only the capture dialog renders.

---

## 7. What the certification actually proves

`python tools/local_backend_sandbox.py --port 8077` +
`python tools/share_target_phone_audit.py --base http://localhost:8077` — real
Chromium, 390×844, `is_mobile` + `has_touch`, **0 findings**, four screenshots in
`tools/share_phone_out/`.

| State | Proven |
|---|---|
| signed out | card renders, no horizontal overflow, no sub-44px target, not occluded; sign-in link carries the whole share back as a same-site `?next=` |
| signed in, link **inside text** | link extracted, title placed, remainder quoted as the passage |
| signed in, explicit `url` | the explicit link wins |
| signed in, **no url** | opens the Quick thought box, and `passage` is empty — a url-less share is never filed as a quotation |

⛔ **Why this is not a unit test.** jsdom lays nothing out — every box is 0×0, so
a 12px tap target measures identically to a 44px one, and nothing can be occluded
because nothing is painted. The component tests prove the LOGIC; only a real
engine at a real width proves the layout.

---

## 8. Rails

| File | Fails when |
|---|---|
| `lib/shareTarget.test.js` | the parse/route/kind/persistence rules move (18 cases, payload-shaped, not parser-shaped) |
| `shareTarget.contract.test.js` | the manifest and the module disagree; POST returns; a `fetch` handler returns; icons are missing or the wrong size; the route leaves its position relative to `AuthGuard` |
| `components/notebook/ShareTargetPage.test.jsx` | any of the four auth states loses the payload |
| `components/notebook/CaptureHost.test.jsx` | the handoff stops opening the dialog, opens the wrong mode, or stops being once-only |
| `tools/share_target_phone_audit.py` | the door is occluded, overflows, or its fields arrive wrong at 390px |

**Six mutation checks, all via `tools/mutation_check.py`, all byte-identical
restore:** manifest → POST · a `fetch` handler in `sw.js` · param names drift ·
url-less share prefills `passage` · payload persisted only when signed in · the
route moved inside `AuthGuard` (fails **by name**).

⭐ **`app/src/testing/routeNesting.js` is new, and it replaced a broken idiom.**
Route nesting was asserted by comparing `APP_SRC.indexOf('<AuthGuard')` against a
route's offset. That probe breaks the moment a route is added with a comment
saying it sits "OUTSIDE `<AuthGuard/>`" — `indexOf` finds the **prose**. It had
already silently inverted `formulaLibrary.route.test.jsx`'s control assertion
since Slice 3, in a suite outside that slice's test scope, so the file was red
against correct code for a day. Both rails now share one AST helper that answers
the real question (nesting, which survives reordering) and distinguishes
*outside the guard* from *not registered at all*.

---

## 9. Honest limits

- **No real device.** Certified in Chromium at a phone viewport. Whether a given
  Android build offers UCT in its share sheet depends on that build's install
  criteria; the manifest now meets the documented ones, and that is a different
  claim from "seen working on a handset". Slice 5 or a real phone closes it.
- **iOS gets nothing from this.** Web Share Target is not implemented in Safari.
  iOS members' door remains the in-app capture of Slice 2. Not built, not
  claimed.
- **`start_url` is `/dashboard`, which is paid-only.** Pre-existing, untouched: a
  free member installing the PWA lands on a bounce. Out of this slice's scope and
  worth a decision.
- **Files are not accepted.** A `GET` share target cannot carry them; images and
  PDFs from a share sheet would need the `POST` form and therefore §1's service
  worker. Recorded as a rights-and-outage question, not an oversight.
- **Not built:** multi-item shares, a share-sheet destination shortcut
  (`share_target` cannot prefill a ticker), offline queueing.
