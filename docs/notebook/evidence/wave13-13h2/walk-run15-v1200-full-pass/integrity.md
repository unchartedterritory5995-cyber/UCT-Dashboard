# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 00:19:03`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-15; identity = fe5ed81b167dca22507d64c5dab500c0
- `2026-10-03 00:20:19`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 00:22:15`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 00:23:14`  **shutdown** — C:\data, 62 db files — CLEAN
