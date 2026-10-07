# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 06:29:56`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\final-q; identity = fe2cc019ae4f2bbb31c5942ecdd0f526
- `2026-10-07 06:31:20`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 06:33:19`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:11:28`  **shutdown** — C:\data, 62 db files — CLEAN
