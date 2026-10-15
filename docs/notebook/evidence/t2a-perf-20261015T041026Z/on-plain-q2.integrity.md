# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 03:12:24`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-plain-q2; identity = 496f011ce9cd665469873e2f972192dc
- `2026-10-15 03:13:05`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 03:13:26`  **shutdown** — C:\data, 62 db files — CLEAN
