# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:33:55`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts5; identity = 67d7d2163a274cf396e9aa4f2a174aa7
- `2026-10-03 21:34:52`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:35:19`  **shutdown** — C:\data, 62 db files — CLEAN
