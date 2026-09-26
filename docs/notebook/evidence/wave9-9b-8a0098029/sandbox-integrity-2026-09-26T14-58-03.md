# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 14:58:08`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\e5af7430-5c97-49c2-9846-4da28941d38c\scratchpad\w9B\sbx-data; identity = d716422d739dc937e0e95145f9a2aa54
- `2026-09-26 14:58:47`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 15:00:29`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-09-26 15:00:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
