# T-12 — pre-launch authenticated Notebook smoke

> ⚖️ **AUTOMATED PER CHARTER AMENDMENT 2026-09-13.** The owner delegates execution; the owner reviews the evidence. Every step below was driven through the member's own control with pointer and keyboard — **no scripted `fetch` stands in for any step.** Where a control could not be driven, the step is **INCONCLUSIVE with the limitation named**, never a pass.

Run 2026-09-26T23-01-37Z · origin `http://127.0.0.1:8213`

> ⛔ **SANDBOX RUN — `certifying: false`.** A local sandbox, not production. It answers questions about the code (the F-5 409 trace, the typing-burst rail); it is not T-12 evidence and must never be filed as a pass of C-7.

## Identities

| identity | what it is |
|---|---|
| `sandbox-member` | `w10c-t12@local.dev` on a LOCAL sandbox, comped and verified through the app's own admin door, in a FRESH browser context |

## Results

### sandbox-member

| step | what it asks | verdict | evidence |
|---|---|---|---|
| 0 | Sign in and mark the run | **PASS** | signed in through the normal form, account `18995c99-1329-4972-8eb6-9fecffacfa3e` (credentials typed into the product's own inputs; never logged)<br>screenshots: `2026-09-26T23-01-37Z_sandbox-member_0_before.png` → `2026-09-26T23-01-37Z_sandbox-member_0_after.png`<br>calls: `GET /api/auth/preferences → 401 · body: {"detail":"Not authenticated"}`<br>`GET /api/auth/me → 401 · body: {"detail":"Not authenticated"}`<br>`GET /api/j2/accounts → 401 · body: {"detail":"Not authenticated"}`<br>`GET /api/j2/settings → 401 · body: {"detail":"Not authenticated"}`<br>`POST /api/auth/login → 200`<br>`GET /api/auth/avatar/18995c99-1329-4972-8eb6-9fecffacfa3e → 200`<br>`POST /api/auth/track → 200`<br>`GET /api/j2/accounts/_all_/coach/weekly-reviews → 200`<br>`GET /api/j2/positions → 200`<br>`GET /api/j2/options?status=open → 200`<br>`GET /api/j2/broker/performance?period=1W → 200`<br>`GET /api/j2/broker/status → 200`<br>`GET /api/auth/me → 200` |
| 1 | Reach the Notebook the way a member does | **PASS** | reached `/journal/notebook` by clicking Journal then Notebook; search box present: **False**<br>screenshots: `2026-09-26T23-01-37Z_sandbox-member_1_before.png` → `2026-09-26T23-01-37Z_sandbox-member_1_after.png`<br>calls: `GET /api/auth/preferences → 200`<br>`GET /api/auth/me → 200`<br>`GET /api/auth/avatar/18995c99-1329-4972-8eb6-9fecffacfa3e → 200`<br>`POST /api/auth/track → 200`<br>`GET /api/j2/accounts → 200`<br>`GET /api/j2/settings → 200`<br>`GET /api/j2/accounts/_all_/coach/weekly-reviews → 200`<br>`GET /api/j2/positions → 200`<br>`GET /api/j2/options?status=open → 200`<br>`GET /api/j2/broker/performance?period=1W → 200`<br>`GET /api/j2/broker/status → 200`<br>`GET /api/j2/accounts/b057c81e-df70-4dd8-8a70-368580633cfa/settings → 200`<br>`GET /api/j2/accounts/b057c81e-df70-4dd8-8a70-368580633cfa/coach/weekly-rev → 200`<br>`POST /api/auth/track → 200` |
| 2 | Create a note | **PASS** | note `a48ef01c17ad4952b6d2ad8e93194658` created from the Notebook's own control, titled **T-12 smoke 2026-09-26**, tagged `t12-smoke`, editor present: **True**<br>screenshots: `2026-09-26T23-01-37Z_sandbox-member_2_before.png` → `2026-09-26T23-01-37Z_sandbox-member_2_after.png`<br>calls: `POST /api/j2/notes → 200`<br>`GET /api/j2/notes?sort=title → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658 → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/documents → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/excerpts → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/trade-ref/resolve → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/properties → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/thesis-summary → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/facts → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/evidence-candidates → 200`<br>`GET /api/j2/inbox → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/backlinks → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/related-from → 200`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658/unlinked-mentions → 200` |
| 3 | Type, and confirm it actually saved | **PASS** | the sentence is present after a hard reload, character for character; `Save failed` seen: **False**, `Reconnecting…` seen: **False**; typing-burst rail PASS — 3 PUT(s), **1 409(s), all settled**, no conflicted copy<br>screenshots: `2026-09-26T23-01-37Z_sandbox-member_3_before.png` → `2026-09-26T23-01-37Z_sandbox-member_3_after.png`<br>calls: `PUT /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658 → 409 · body: {"detail":"note changed — refresh and retry"}`<br>`GET /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658 → 200`<br>`PUT /api/j2/notes/a48ef01c17ad4952b6d2ad8e93194658 → 200`<br>`GET /api/auth/preferences → 200`<br>`GET /api/auth/me → 200`<br>`GET /api/auth/avatar/18995c99-1329-4972-8eb6-9fecffacfa3e → 200`<br>`POST /api/auth/track → 200`<br>`GET /api/j2/accounts → 200`<br>`GET /api/j2/accounts/b057c81e-df70-4dd8-8a70-368580633cfa/settings → 200`<br>`GET /api/j2/accounts/comparison → 200`<br>`GET /api/j2/note-folders → 200`<br>`GET /api/j2/notes/folder-counts → 200`<br>`GET /api/j2/notes?folder_id=__unfiled__&sort=updated&limit=1 → 200`<br>`GET /api/j2/notes?sort=updated&limit=1&deleted=true → 200` |

**Console errors:** 11 — error: Failed to load resource: the server responded with a status of 401 (Unauthorized); error: Failed to load resource: the server responded with a status of 401 (Unauthorized); error: Failed to load resource: the server responded with a status of 401 (Unauthorized); error: Failed to load resource: the server responded with a status of 401 (Unauthorized); error: Failed to load resource: the server responded with a status of 401 (Unauthorized)

#### Typing-burst rail (step 3): **PASS**

- PUTs to the note: 3 · 409s: **1** · unsettled 409s: **0** · conflicted copies: **0** · sentence after reload: **True**

| # | status | sent keys | sent baseUpdatedAt | answer's updatedAt | detail |
|---|---|---|---|---|---|
| 0 | 200 | `baseUpdatedAt, bodyJson, title` | `2026-09-26T23:02:16.097808+00:00` | `2026-09-26T23:02:21.537571+00:00` |  |
| 1 | 409 | `baseUpdatedAt, bodyJson` | `2026-09-26T23:02:21.537571+00:00` | `None` | {"detail":"note changed — refresh and retry"} |
| 2 | 200 | `baseUpdatedAt, bodyJson` | `2026-09-26T23:02:22.301266+00:00` | `2026-09-26T23:02:25.240661+00:00` |  |

## Verdict

- **sandbox-member** — 4 step(s): 4 PASS, 0 FAIL, 0 INCONCLUSIVE/OPEN.

⛔ **C-7 flips TRUE only when every step passes on BOTH identities.** Any INCONCLUSIVE or OPEN step means the gate has not been exercised, and a gate that was not exercised is not a gate that passed.

