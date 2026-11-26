# TradingView multi-slot capture

Approved by the owner and the TRADINGVIEW coordinator on 2026-11-26. Code: `tools/vendor_harness/batch_capture.py`
(`run --cdp --slot`, `_launch_cdp`, `Driver.slot_identity`) and `tools/vendor_harness/tv_slots.py` (the locks and the
broker). Rails: `tests/test_vendor_batch_capture.py`, the section headed "the capture SLOTS".

## The layouts

| slot | layout id | name | hours | studies |
|---|---|---|---|---|
| A | `01f1AcIj` | UCT CAPTURE RIG — no studies (the rig) | extended | 0 |
| B | `SLOTBxxx` | UCT CAPTURE SLOT B — no studies | extended | 0 |
| C | `SLOTCxxx` | UCT CAPTURE SLOT C — no studies | extended | 0 |
| (regular rows) | `MyS1vKSg` | UCT CAPTURE RIG REGULAR HOURS — no studies | regular | 0 |

B and C were made once, on 2026-11-26, with the layout menu's "Make a copy…" from the empty rig. The menu has no
"Save layout as". Neither copy has been saved since. The ids are `SLOT_B_LAYOUT_ID` and `SLOT_C_LAYOUT_ID` in
`batch_capture.py`.

Regular-hours rows still run one at a time on `MyS1vKSg`, on the path without `--cdp`. There are no regular-hours
twins of B and C. Add them only if regular rows start to queue behind each other often.

## The design

- **One browser.** The broker (`tv_slots.py broker serve`, started by `ensure_broker`) launches Chrome through
  Playwright on the existing capture profile (`%LOCALAPPDATA%/uct-capture-profile/tradingview`). It uses the same
  options as `_launch`, plus `--remote-debugging-port=9333` on 127.0.0.1. It closes after 90 s with no slot claim. It
  closes at once if an exclusive holder is waiting and no slot job runs. It never creates, deletes or replaces the
  profile, never signs out and never clears cookies.
- **Three windows.** A slot job connects over CDP and opens its own window with `Target.createTarget` and
  `newWindow: true`. It never uses a tab in another slot's window: Chrome hides and throttles background tabs, and the
  visibility gate (`_gate`, v2.1) is kept. The job puts its window on its slot's layout and runs the unchanged
  `Driver`. At the end it closes its own window only, never the browser.
- **Identity, before any write.** The proof refuses every row by name (GATE_FAILED) and touches nothing if any of
  these fails:
  - the account is signed in (`layout_access`);
  - the page's URL, and TradingView's own `layoutId()`, name the slot's layout. This is also checked per row;
  - a settled read shows 0 studies on the layout;
  - each row's session reads as its slot layout's hours at the row's resolution (`check_row_session`). This applies
    even to a row that names no session.
- **Provenance.** `result.provenance.slot` and the capture's `page.slot` record `slot`, `layoutId`, `cdpTargetId`,
  `cdpWindowId`, `brokerPid` and `browserPid`. The schema does not constrain `page`, so `verify_capture.mjs` accepts
  them unchanged. A capture made without `--cdp` has no `page.slot`, and its bytes are unchanged.
- **Load.** A slot job needs at least 3 GB of free RAM. It checks at launch and before every row, and stops itself
  below that. At most three slot jobs run at once, one per slot. A solo heavy_lock job excludes every slot. ⚠️ heavy_lock
  lets at most 2 `--shared` members run together, so a third slot job runs only inside a hold another job already has.
- **Slot jobs never save.** `--clean-save` with `--cdp` is refused, and so are `repair` and sign-in. All of those are
  exclusive tv.lock jobs on the path without `--cdp`. A slot layout left dirty is repaired with
  `batch_capture.py repair --layout <id>` under the exclusive lock.

## The locks

All lock files live in tv.lock's directory, and every one is taken inside heavy_lock. Take heavy_lock first: the
reverse order deadlocked for 81 minutes on 2026-11-26.

| file | meaning |
|---|---|
| `tv.lock` | The whole-browser lock. It is held either by one exclusive holder (clean-save, repair, sign-in, or any tool that knows nothing of slots) or by the group of running slot jobs, in which case its text starts with `shared-slots`. A slot-unaware tool creates the file with O_EXCL and waits while it exists, so it waits for every slot job to finish, and no slot job starts while it holds the file. |
| `tv.shared.d/<pid>-<slot>` | One shared claim per slot job. It names the wrapper's pid and the batch child's pid, and it lives while either process does. The last claim to leave removes a shared `tv.lock`. |
| `tv.exclusive.want` | Written by a slot-aware exclusive taker (`TvLocks.take_exclusive`, used by `tv_run.py`). While it exists, no new slot claim is made. The taker waits for `tv.shared.d` to empty, takes `tv.lock`, then waits for the broker's browser to close so the profile is free. |
| `tvslotA.lock` / `tvslotB.lock` / `tvslotC.lock` | Which job drives which slot. |
| `tv.meta.lock`, `tvbroker.lock`, `tvbroker.json` | Short mutexes, and the broker's state. |

A claim is reclaimed only when every pid it names is dead.

## Running

```
python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --shared --label "TV slot: <what>" --timeout 7200 -- \
    python <tv.lock dir>/tv_run_slot.py RUN_DIR LOG [--slot A|B|C] [extra batch_wide run args]
```

`tv_run.py` is the single path. It is unchanged in use, and it takes `tv.lock` the slot-aware way once its worktree
has `tv_slots.py`.

## The live A/B (2026-11-26)

The test was Fred RS (`docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`, sha `caa94fe3…`) on AMEX:SPY 1D, on a
US market holiday. It ran on slot A alone, then on slots B and C in parallel. The comparison leaves out only
`capturedAtUTC`, the date-stamped `id`, the receipt, and the page block's `url` and `slot` (where the capture ran). The
result is in the PR that added this file.
