# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 09:45:29`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h4-walk-data-1; identity = 61db4dd8339a4a10386dd8c8cfc1c61f
- `2026-10-03 09:49:26`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 09:51:02`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-03 09:51:22`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
