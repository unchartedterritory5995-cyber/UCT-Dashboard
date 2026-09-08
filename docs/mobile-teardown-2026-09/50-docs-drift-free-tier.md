# Documentation drift — CLAUDE.md free-tier list vs actual auth behaviour

**Filed separately on purpose.** This is a documentation/configuration drift item, not a mobile
parity finding. It must not enter the parity backlog.

---

## The claim

`CLAUDE.md`, in the *Auth & User System* section:

> **Free tier**: Dashboard, Breadth, Charts, Options Flow, Journal, Model Book accessible without payment

## The actual behaviour

`origin/master:app/src/components/AuthGuard.jsx`, line 112:

```js
// Keep in sync with FREE_PAGES in NavBar.jsx + MoreSheet.jsx.
const FREE_PAGES = ['/morning-wire']
// Where to bounce a non-paid user who hits a locked page. MUST be a free page.
const FREE_HOME = '/morning-wire'
```

and line 165:

```js
const isFreePage = FREE_PAGES.some(p => location.pathname.startsWith(p))
// isPaid = admin OR pro/premium/lifetime (single source of truth in AuthContext)
if (!isPaid && !isFreePage) {
  return <Navigate to={FREE_HOME} replace />
}
```

**Measured consequence:** a newly created free account is redirected off `/charts` to
`/morning-wire`. Confirmed indirectly in this session — the sandbox account only reached `/charts`
because `tools/e2e_sandbox_launcher.py` sets `ADMIN_EMAILS`, making it `role: admin` and therefore
`paid_equiv: true`.

Two narrower routes are also carved out below `FREE_PAGES` and are easy to misread as "free":
`/research/*` falls through unconditionally, and `/calendar` bounces a non-paid user to
`/research/:sym` when the URL carries a valid ticker.

## Likely source of truth

`AuthGuard.jsx` is the enforcing authority. The comment on line 111 names two others that must
agree — `NavBar.jsx` and `MoreSheet.jsx` — so the real source of truth is **three hand-synced
copies of one list**, which is the drift class this repo documents repeatedly (the writer-index
`FOUR`, the COT router's "4 routes", the setup catalog's "24"). CLAUDE.md is a fourth copy, and it
is the one that has drifted furthest.

There is also a plausible history here: the doc's list matches the *older* policy the same file
describes — *"Signup flow does NOT redirect to Stripe — users land directly on dashboard"* — and a
later line records `/live-flow` and `/live-massive` being de-listed from free on 2026-07-19. So the
free tier was narrowed and CLAUDE.md was not updated with it.

## Why it mattered here

It decided a method choice. The owner authorised creating a dedicated research account rather than
using their own. Had the doc been trusted, that account would have been created and would have
bounced straight off the only surface under study; the fix would have required an `ADMIN_EMAILS`
change or a subscription row on production, both explicitly forbidden. Checking the code first
avoided creating a useless account and a production change.

## Recommended correction

1. Change the CLAUDE.md line to name **Morning Wire only**, and stop enumerating the rest:

   > **Free tier**: `/morning-wire` only — measure `FREE_PAGES` in `AuthGuard.jsx`, do not quote
   > this line. `/research/*` falls through separately, and `/calendar` redirects a non-paid user
   > to `/research/:sym` when the URL carries a valid ticker.

2. Better, and consistent with how this repo has fixed the same defect elsewhere: **derive it**.
   `AuthGuard.jsx`, `NavBar.jsx` and `MoreSheet.jsx` should import one exported `FREE_PAGES`
   constant rather than each declaring its own, with a test asserting the three agree. The
   `reachable.test.js` / `registry.test.js` precedent is exactly this shape.

⚠️ Not edited during the research pass, per instruction — recorded only.

---

## Drift #2 — the Charts Hub V2 section describes a deleted component and the wrong storage tier

**Found by the P9 pass, 2026-09-07.** Evidence row: `lanes/uct-p9-workspace.jsonl` →
`UCT-P9-DOCDRIFT`.

**CLAUDE.md, "Charts Hub V2" says:**

> *Mobile (<640px) bypasses RGL entirely → `ChartsWorkspace.jsx` renders **`MobileWorkspace`**
> (ticker persists to `localStorage['charts_mobile_sym']`).*

**Measured against `origin/master`:**

| the doc says | reality |
|---|---|
| `MobileWorkspace` is the phone branch | **No file of that name exists** anywhere under `app/src`. The phone branch is `app/src/pages/charts/mobile/MobileChartsApp.jsx` (`ChartsWorkspace.jsx:22,2077`) |
| the phone ticker persists to `localStorage['charts_mobile_sym']` | The phone ticker goes through `useWorkspace().setGroupSym` into the **server-backed** `charts_workspace_groups` (`MobileChartsApp.jsx:54,104,155`) |
| — | `charts_mobile_sym` is still written, but only by `components/mobile/TickerHubSheet.jsx:57` and `pages/AiSearchPage.jsx:323` — different surfaces entirely |

**Why it matters beyond tidiness.** The doc's version of the phone shell is **device-local** (a
localStorage ticker). The real one is **server-shared** (a preference the desktop board reads).
An engineer reasoning about blast radius from the doc would conclude that changing the symbol on
a phone is contained — and it is not: it moves the desktop board. That is precisely the question
P9 exists to answer, answered wrongly, in the first document a new engineer reads.

⚰️ **Note the shape.** CLAUDE.md's own *"DOCUMENTED BUT UNREACHABLE"* table already corrected an
earlier version of this line (`MobileChartFallback` → `MobileWorkspace`). **The table was
updated and the section it points at then drifted again** — the second-authority-over-one-value
defect the file warns about, committed against the correction itself.

**Not this study's to fix.** Recorded so the owner can, with the measurement attached.

---

## Drift #3 — this study's own artifacts drifted the same way

Recorded here because the lesson is identical and pretending otherwise would be dishonest.
`30-uct-vs-tradingview-parity-matrix.md` stated *"UCT's equivalent sheet is eleven rows"* and
built its central "door count" framing on the eleven, after `UCT-NAV-0005` had established on
real hardware that the widget band is **account-dependent** and must be quoted as *"five chart
actions plus a per-account widget list, not as a fixed eleven."* The same document carried
*"20 drawing tools"* against a roster of **18**, and *"~5 of 20 visible"* against its own device
capture showing **3**.

⭐ **A hand-typed count beside the list it describes** — the defect CLAUDE.md names four separate
times (the writer index's FOUR, the COT router's "4 routes", the setup catalog's "24", the
widget-type enumeration) — reappeared inside the research artifact auditing it. The remedy
applied: `ledger/PARITY_COMPARISONS_V2.jsonl` is the only place a comparison count exists, and
every number in `80-parity-distribution-and-root-causes.md` is generated from it.
