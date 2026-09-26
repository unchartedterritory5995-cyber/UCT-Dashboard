# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 16:20:56`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\e5af7430-5c97-49c2-9846-4da28941d38c\scratchpad\w9A\sbx-exp7b; identity = 673f766b69988c7108394d05edfdc0f8
- `2026-09-26 16:21:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 16:21:56`  **shutdown** — C:\data, 62 db files — CLEAN
