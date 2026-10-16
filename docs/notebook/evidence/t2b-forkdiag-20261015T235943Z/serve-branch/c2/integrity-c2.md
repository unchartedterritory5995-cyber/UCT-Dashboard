tip under test: e7af2f560f (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 19:08:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-forkdiag-branch\c2; identity = 5ce0a891e0ab59b2dd78fa229da9ecf6
- `2026-10-15 19:09:15`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 19:11:09`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 19:29:55`  **shutdown** — C:\data, 62 db files — CLEAN
