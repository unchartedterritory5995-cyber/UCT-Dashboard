# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 22:14:15`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk-dev\c2; identity = 10093ae1663cbb21aa48c7041f068ef6
- `2026-10-06 22:14:55`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 22:16:48`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 06:28:47`  **shutdown** — C:\data, 62 db files — **1 FILE(S) CHANGED**

| | file | detail |
|---|---|---|
| CHANGED | `bars.db` | 3235098624 -> 3235119104 bytes; sha256 32da72f8f742 -> 13f5a2e21afc |

