# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 16:06:48`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\e5af7430-5c97-49c2-9846-4da28941d38c\scratchpad\w9A\sbx-run4; identity = 8244e542e21860a70a1f96bd67b40a3f
- `2026-09-26 16:07:27`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 16:09:20`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 16:11:31`  **shutdown** — C:\data, 62 db files — CLEAN
