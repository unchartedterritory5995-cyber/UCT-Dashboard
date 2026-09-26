# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 15:30:28`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\e5af7430-5c97-49c2-9846-4da28941d38c\scratchpad\w9B\sbx-data; identity = f4d580b6acae69986900c0638b0e412d
- `2026-09-26 15:31:06`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 15:32:58`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 15:44:38`  **shutdown** — C:\data, 62 db files — CLEAN
