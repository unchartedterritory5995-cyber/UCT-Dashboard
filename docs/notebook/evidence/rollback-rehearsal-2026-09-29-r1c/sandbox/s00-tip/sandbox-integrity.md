# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 14:32:22`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10r1c; identity = 00647b6b42ee9870720ae00690feefaa
- `2026-09-29 14:34:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 14:35:54`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 14:36:04`  **shutdown** — C:\data, 62 db files — CLEAN
