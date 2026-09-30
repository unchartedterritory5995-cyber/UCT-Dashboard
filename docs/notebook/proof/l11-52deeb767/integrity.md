# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 02:57:54`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\l11walk-data; identity = 31318f1dc350b5174b47c21506b6ba57
- `2026-09-30 02:58:38`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 03:00:30`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 05:14:05`  **shutdown** — C:\data, 62 db files — CLEAN
