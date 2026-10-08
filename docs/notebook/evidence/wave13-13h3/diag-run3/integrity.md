# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 05:04:14`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h3-diag-data3; identity = b1d443d409ff328ad746dedbd34fecb8
- `2026-10-03 05:04:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:06:25`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:06:50`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
