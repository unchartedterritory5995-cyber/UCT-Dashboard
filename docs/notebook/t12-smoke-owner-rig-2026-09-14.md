# T-12 — pre-launch authenticated Notebook smoke

> ⚖️ **AUTOMATED PER CHARTER AMENDMENT 2026-09-13.** The owner delegates execution; the owner reviews the evidence. Every step below was driven through the member's own control with pointer and keyboard — **no scripted `fetch` stands in for any step.** Where a control could not be driven, the step is **INCONCLUSIVE with the limitation named**, never a pass.

Run 2026-09-14T07-03-18Z · origin `https://uctintelligence.com`

## Identities

| identity | what it is |
|---|---|
| `owner-rig` | the rig profile, signed in as the owner account (a 30-day session) |

## Results

### owner-rig

| step | what it asks | verdict | evidence |
|---|---|---|---|
| 0 | Sign in and mark the run | **PASS** | already signed in on the rig profile, account `7a6d0299-fd98-4017-b8dc-51b849d1ab1d` (a 30-day session, nothing typed)<br>screenshots: `2026-09-14T07-03-18Z_owner-rig_0_before.png` → `2026-09-14T07-03-18Z_owner-rig_0_after.png`<br>calls: `GET /api/auth/me → 200` |
| 1 | Reach the Notebook the way a member does | **PASS** | reached `/journal/notebook` by clicking Journal then Notebook; search box present: **False**<br>screenshots: `2026-09-14T07-03-18Z_owner-rig_1_before.png` → `2026-09-14T07-03-18Z_owner-rig_1_after.png`<br>calls: `GET /api/auth/preferences → 200`<br>`GET /api/auth/me → 200`<br>`GET /api/auth/avatar/7a6d0299-fd98-4017-b8dc-51b849d1ab1d → 200`<br>`POST /api/auth/track → 200`<br>`GET /api/j2/accounts → 200`<br>`GET /api/j2/accounts/127f2b51-ca36-4bf8-a719-7bcd344531a2/settings → 200`<br>`GET /api/j2/positions → 200`<br>`GET /api/j2/options?status=open → 200`<br>`GET /api/j2/broker/performance?period=1W → 200`<br>`GET /api/j2/broker/status → 200`<br>`GET /api/j2/broker/option-marks → 200`<br>`POST /api/auth/track → 200`<br>`GET /api/j2/accounts/comparison → 200`<br>`GET /api/j2/positions?account_id=127f2b51-ca36-4bf8-a719-7bcd344531a2 → 200` |
| 2 | Create a note | **FAIL** | no new-note control findable: {'ok': False, 'why': 'no new-note control in the Notebook surface', 'seen': ['UCT\nINTELLIGENCE', 'Search\n⌘K', 'UCT Terminal', 'Charts', 'Morning Wire', 'Dashboard', 'AI Search', 'UCT 20', 'Breadth', 'Screener', 'Options Flow', 'Flow Record', 'Live Flow', 'Model Book', 'The Desk', 'Journal\n9+', 'Community\n9+', 'TSDR Trading\nADMIN', 'Admin', 'Settings', 'Support', 'Website', '9+', 'Today', 'Trades', 'Calendar', 'Notebook', 'Insights', 'Compass', 'Log Trade']}<br>screenshots: `2026-09-14T07-03-18Z_owner-rig_2_before.png` → `2026-09-14T07-03-18Z_owner-rig_2_after.png`<br>calls: — |
| 3 | Type, and confirm it actually saved | **FAIL** | no editor body to type into<br>screenshots: `2026-09-14T07-03-18Z_owner-rig_3_before.png` → `2026-09-14T07-03-18Z_owner-rig_3_after.png`<br>calls: — |
| STOP | run halted | **FAIL** | step 3 is the one step whose failure ends the run unconditionally<br>screenshots: `` → ``<br>calls: — |

**Console errors:** 2 — error: Failed to load resource: the server responded with a status of 401 (); error: Failed to load resource: the server responded with a status of 401 ()

## Verdict

- **owner-rig** — 5 step(s): 2 PASS, 3 FAIL, 0 INCONCLUSIVE/OPEN. ⛔ FAIL at step(s) 2, 3, STOP.

⛔ **C-7 flips TRUE only when every step passes on BOTH identities.** Any INCONCLUSIVE or OPEN step means the gate has not been exercised, and a gate that was not exercised is not a gate that passed.

