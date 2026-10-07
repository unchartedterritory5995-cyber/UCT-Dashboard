# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 21:27:35`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4charts4; identity = 17cc98241b1f73bbbe4432b5519f08e5
- `2026-10-03 21:28:57`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 21:29:14`  **shutdown** — C:\data, 62 db files — CLEAN
