# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:39:02`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts6; identity = e431cb37780cc5b217e0e66f81b11542
- `2026-10-03 21:40:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:41:02`  **shutdown** — C:\data, 62 db files — CLEAN
