# INVALID: deadclick-only re-run at `4dfc5e447` (L11 + WK6)

- **What happened:** the control failed before any surface was measured:
  `[INVALID] deadclick control: plant-poller: got 'NOT-SEEN', must be 'IN-WINDOW'`.
- **Why:** WK6's `quiesce()` ends the click window after 120 ms without DOM mutations. It ignores network activity. The planted poller fetches every 200 ms, so no request lands inside the shortened window.
- **The same flaw affects real controls:** a click whose visible effect waits on a server reply would read DEAD.
- **How the run ended:** the controller killed it after the INVALID control (05:38). There was no graceful shutdown, so `integrity.md` was not written.
- **Shared data root:** checked by hand. 0 of the 62 main `.db` files under `C:\data` were written after 05:35.
- **Status:** raw `run.json` and `deadclick.json` are kept as-is. This run carries no product verdict.
