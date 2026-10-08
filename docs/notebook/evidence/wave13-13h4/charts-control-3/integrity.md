# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:24:26`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts3; identity = 4ed6d074616e4eeeab9aee7986414723
- `2026-10-03 21:25:48`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:26:03`  **shutdown** — C:\data, 62 db files — CLEAN
