# Wave Q2 — decisions for the owner

One per line. Answer in one pass when the Q1 window closes; nothing here needs
answering before then. **My recommendation is stated first so a "yes to all"
is a real option.**

| # | decision | recommendation | why |
|---|---|---|---|
| 1 | Does Q2 start at all when the window closes, or does the Notebook pause? | **START** | Q1 shipped clean; the offline layer is live and quiet. Momentum is cheaper than a cold restart. |
| 2 | All three slices, or A only first? | **A ONLY FIRST** | Offline read is the slice members will actually notice. B and C are both larger and neither is urgent. |
| 3 | Slice order if all three: A→B→C, or A→C→B? | **A → B → C** | C is the only slice with an invisible failure mode; it should ship last, behind a kill switch. |
| 4 | Read-cache bound: 50 notes / 25 MB, or larger? | **50 / 25 MB** | The origin quota is shared with ~550 MB of chart bars. Start small; raising a cap is easy, reclaiming a member's disk is not. |
| 5 | Is cache refresh leader-only? | **YES** | N tabs refreshing the same notes is N× the requests for one member, and the leader already exists. |
| 6 | Do thesis / evidence / review stay read-only offline? | **YES, unchanged** | They are dated claims. An offline edit to a dated claim creates a record whose date is false. |
| 7 | Runtime kill switch: build before A, before C, or not at all? | **BEFORE C** | A and B fail visibly and recoverably. C writes hundreds of MB against a shared quota and can break the charts — that is the first failure a member can't see coming. |
| 8 | Does "keep mine" archive or delete the other copy? | **ARCHIVE** | Never-clobber is the invariant Q1 paid four deploys for. A new surface must not become the exception. |
| 9 | Attachment pinning: explicit only, or auto-pin recently viewed? | **EXPLICIT ONLY** | Auto-pinning spends a member's disk without being asked. |
| 10 | Does Q2 get its own 7-day observation window per slice, or one at the end? | **PER SLICE** | Q1's window is what made the flip safe to judge. Three slices sharing one window means three changes and one signal. |
| 11 | Extend `q1_flag_default_sweep.py` to all three constants before any Q2 code? | **YES** | One constant with four blind spots was expensive. Three constants unaudited would be worse. |
| 12 | Does the Q1 canary keep running through Q2, or retire at window close? | **KEEP RUNNING** | It is the only thing that exercises a real outbox end-to-end, and it is the only source for the "stuck >5 min" trigger. |

## ⛔ Not decisions — already settled, do not reopen

- **Single writer**: decided and REVERSED. The coordination machinery is what makes the member path rebase.
- **The property rail (old §A)**: VOID. There was no product defect to reproduce.
- **Service worker**: a standing charter DO-NOT-BUILD. Q2-A is an IndexedDB read cache, not a shell cache.
- **Local-first**: never. The model is server-authoritative with a durable offline working copy, and it must never be marketed otherwise.
