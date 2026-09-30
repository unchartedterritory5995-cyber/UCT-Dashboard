# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 22:24:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\wk3-geo-data; identity = 783b6565d6c9c7e0f8425f254f30fa70
- `2026-09-29 22:26:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 22:27:58`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 22:38:43`  **shutdown** — C:\data, 62 db files — CLEAN
