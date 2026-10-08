# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:19:14`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts2; identity = 280afff194014ac3a2d0a76b9ad4ebb5
- `2026-10-03 21:20:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:21:07`  **shutdown** — C:\data, 62 db files — CLEAN
