tip under test: af0b7ffeea (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 18:28:14`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk-r\c2; identity = f0e1f3cbacdee9ee515ad3e4c9dab9e3
- `2026-10-07 18:28:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 18:30:37`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 18:31:05`  **shutdown** — C:\data, 62 db files — CLEAN
