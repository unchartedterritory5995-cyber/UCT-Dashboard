# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:14:39`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts; identity = 4d17eb9541ec25e9ae4eac97ace58414
- `2026-10-03 21:15:59`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:16:26`  **shutdown** — C:\data, 62 db files — CLEAN
