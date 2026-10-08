# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 04:21:12`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13e2-data3; identity = adaf1bb44e4b3b0b0b36e02f05a13a66
- `2026-10-03 04:21:53`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:23:49`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:24:00`  **shutdown** — C:\data, 62 db files — CLEAN
