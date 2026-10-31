# Backup encryption (UCTBK1): every backup that leaves `web` is encrypted

**Why this exists:** on 2026-10-21 Railway leaked customer environment variables. Our R2 backup
credentials (`DATA_SYNC_*`) were among them, and three enabled backup rails were uploading
**unencrypted** member data to R2. From this change on, every backup object is encrypted to a
**public** key. Only an **offline private key** can read it, and that key is never stored on
Railway. If Railway's variables leak again, R2 included, the attacker gets ciphertext.

## What changed

| Rail | Prod state | Object written now | Legacy object (still read) |
|---|---|---|---|
| `api/services/authdb_backup.py` (auth.db, every 6 h + nightly) | ENABLED | `authdb/backup/<UTC ts>.db.gz.enc` | `authdb/backup/<UTC ts>.db.gz` |
| `api/services/store_backup.py` (community, layouts, ... nightly) | ENABLED | `store_backups/<store>/<ts>.db.gz.enc` + `<ts>.manifest.json.enc` | `.db.gz` + `.manifest.json` |
| `api/j2_attachments_backup.py` (J2 image tree, nightly) | ENABLED | `j2_attachment_backups/j2-attachments-<date>.tar.gz.enc` | `.tar.gz` |
| `api/flow_backup.py` (flow.db, nightly) | off | `flow_backups/flow-<date>.db.gz.enc` | `.db.gz` |

- New module `api/services/backup_crypto.py`. Each file gets a fresh random 256-bit data key.
  The file is encrypted with AES-256-GCM in 1 MiB chunks, so memory stays flat however big the
  file is. The data key is wrapped with RSA-OAEP(SHA-256) under a 4096-bit (or larger) RSA public key.
  The header starts with the magic `UCTBK1`.
  - Each chunk's nonce is built from a counter.
  - Each chunk's associated data covers the whole header, the chunk counter and a final-chunk
    flag. That catches tampering, reordered or dropped chunks, truncation, and trailing bytes.
  - A failed decrypt never leaves a partial plaintext file behind.
- The store manifests are encrypted too, because table names and row counts come from member data.
- **Not encrypted:** the account-deletion tombstones (`authdb/tombstones/<user_id>.json`). They
  hold a member id and a timestamp and nothing else. The restore drill must be able to read
  them so it can replay erasures (ruling R-9).
- `authdb/archive/` (`tools/archive_authdb_backup.py`) copies whichever object is newest on the
  server side. Once encrypted backups exist, it archives an encrypted one.

## The variables

| Variable | Where | What |
|---|---|---|
| `BACKUP_PUBLIC_KEY` | Railway `web` (and `flow-worker` if flow backups are ever armed there) | The **public** key: base64 of the PEM on one line, as the keypair tool prints it. Raw PEM, or PEM with literal `\n` escapes, is accepted too. |
| `BACKUP_PRIVATE_KEY_PATH` | the owner's machine **only** | Path to the private PEM. The restore tools use it when `--private-key` is not given. |
| `BACKUP_PRIVATE_KEY_PASSPHRASE` | the owner's machine **only**, optional | Only needed if the private key was generated with `--passphrase-env`. |

The rails refuse:
- a value that holds a **PRIVATE** key (and if one was ever pasted, treat it as leaked);
- a key that is not RSA;
- an RSA key below 4096 bits.

## Generate the keypair (owner, once)

On the owner's machine, **outside the repo**:

```
python tools/gen_backup_keypair.py --out D:\offline\uct-backup-private.pem
# optional: encrypt the PEM itself
set UCT_KEY_PASS=...   &&   python tools/gen_backup_keypair.py --out D:\offline\uct-backup-private.pem --passphrase-env UCT_KEY_PASS
```

- stdout gets **one line**, the base64 public key. Set it as `BACKUP_PUBLIC_KEY` on Railway `web`.
- The private key goes to `--out`, and nothing prints it.
- The tool refuses to overwrite an existing file. The old private key may be the only thing
  that can read backups already in R2.
- The tool refuses any path inside the repository.

## Where the private key lives

- On the owner's machine, at the `--out` path, and as a copy in the owner's password manager
  (as a secure note or attachment). Two places, both offline from Railway.
- **NEVER** on Railway, never in the repo, never in a Discord/Slack message, a ticket or an AI chat.
- If the private key is lost, every encrypted backup in R2 is unreadable. That is the trade
  we chose. Keep the password-manager copy current.
- **Rotation:** generate a new pair and set the new `BACKUP_PUBLIC_KEY`. **Keep the old private
  key** until the last object encrypted to it has aged out (about 14 days, see below).

## Restore

Every restore tool decrypts automatically when it is given the private key. Legacy plaintext
objects still restore with no key at all.

```
# auth.db (+ the attachments half)
python tools/authdb_restore_drill.py --private-key D:\offline\uct-backup-private.pem
python tools/authdb_restore_drill.py --private-key ... --write-restored C:\restore\auth.db

# member stores
python tools/store_restore.py --rehearse --private-key D:\offline\uct-backup-private.pem
python tools/store_restore.py --restore store_backups/community/<ts>.db.gz.enc --to <path> --private-key ...

# or, instead of --private-key on every call:
setx BACKUP_PRIVATE_KEY_PATH D:\offline\uct-backup-private.pem
```

For a hand-downloaded `.enc` file (flow.db, an attachments tarball) with no tool of its own:

```
python -c "from api.services import backup_crypto as b; b.decrypt_file('flow-2026-10-22.db.gz.enc', 'flow-2026-10-22.db.gz', open(r'D:\offline\uct-backup-private.pem','rb').read())"
```

### Member stores that hold deleted members' data: the tombstone replay

`store_restore.py --restore` of a store named in `account_tombstones.STORE_REPLAYS` (today
`user_definitions`, the saved indicators) **replays every account-deletion tombstone on the
restored copy before it is renamed in**, then checkpoints the copy's WAL so the deletes travel
with the main file. The tombstones come from the off-site store (the backups' bucket, while
`AUTHDB_BACKUP_ENABLED=1` and `DATA_SYNC_*` are set). If that list cannot be read, the restore
is **refused** and the live store is left exactly as it was.

**Disaster overrides (deliberate, loud, and recorded).** Use only when the bucket itself is gone
or unreachable and the store must come back now:

```
# 1. a LOCAL copy of the tombstone list: a directory copy of authdb/tombstones/ from the bucket,
#    or a JSON file of ids (["<id>", ...] or {"<id>": "<deleted_at>"})
python tools/store_restore.py --restore <obj> --to <path> --replace --tombstones-file D:\offline\tombstones
# 2. the live auth.db's own tombstone table (read-only), alone or with 1.
python tools/store_restore.py --restore <obj> --to <path> --replace --auth-db /data/auth.db
# 3. nothing can be read at all: restore UNREPLAYED
python tools/store_restore.py --restore <obj> --to <path> --replace --allow-unreplayed
```

In every override case the off-site list was not read, so the tool prints a `!!` banner, the
member ids in the restored copy as **UNVERIFIED**, and writes
`<store>.tombstone-replay-pending.json` beside the store. **Do not delete that marker.** The live
tombstone sweep (`api/services/tombstone_sweep.py`, on the web pod every 6 h and 10 min after
boot; kill switch `TOMBSTONE_SWEEP_ENABLED=0`) sees it, reads the off-site list once the bucket
answers, replays it on the live store, and renames the marker to
`...pending.retired-<stamp>.json`. Until then the sweep reports the marker as pending. With
`--allow-unreplayed` a deleted member's saved indicators ARE live again until that sweep runs,
which is why it is a disaster-only flag. The sweep also replays every tombstone in the live
auth.db on each run, whether or not a marker exists.

⛔ Stop every writer of the store first (the web process holds it open). On Windows an open
handle also makes the move-aside of the old file fail.

What the restore tools report:

| Situation | Verdict |
|---|---|
| Encrypted object, no key | **INCONCLUSIVE** (an unknown is never a pass) |
| Wrong key, tampered or truncated object | **FAIL** |
| Legacy plaintext object | handled exactly as before |

⛔ **The weekly scheduled drill** (`tools/restore_drill_weekly.cmd`, `UCT-AuthDB-Restore-Drill`)
runs with the owner's environment. Once the first encrypted backup lands it reports
INCONCLUSIVE until `BACKUP_PRIVATE_KEY_PATH` is set there (`setx`).

## How the legacy plaintext objects age out

No code deletes legacy objects early. Each rail's retention now orders legacy and `.enc`
objects **together by timestamp**, so the plaintext copies fall off through the existing rules:

| Rail | Retention rule | Plaintext gone after |
|---|---|---|
| auth.db | newest `AUTHDB_BACKUP_KEEP` (14) objects | about 3 to 4 days (≈5 backups a day) |
| store backups | newest `STORE_BACKUP_KEEP` (14) per store | 14 nights |
| J2 attachments | older than `J2_ATTACHMENT_BACKUP_RETAIN_DAYS` (14), newest 3 always kept | about 14 days |
| flow.db | same rule as attachments | about 14 days, if it is ever armed |

**Exception:** `authdb/archive/` is never pruned, so any plaintext archive copy there stays
until someone deletes it by hand. That is an owner decision, outside this change.

The leaked credentials can still read the plaintext objects until they age out. **Rotating the
R2 access keys is the step that actually closes the leak** (see Owner actions).

## Fail-closed: what it looks like

If a rail is enabled but `BACKUP_PUBLIC_KEY` is missing or invalid:
- it uploads **nothing** (there is no plaintext fallback);
- it logs **one** ERROR line per run;
- it returns its normal nothing-done value;
- it never raises into the scheduler.

```
ERROR api.services.authdb_backup: [authdb_backup] FAIL-CLOSED: BACKUP_PUBLIC_KEY is not set -- refusing to upload an unencrypted backup; nothing uploaded (set BACKUP_PUBLIC_KEY; docs/runbooks/backup-encryption.md)
ERROR api.services.store_backup: [store_backup] FAIL-CLOSED: BACKUP_PUBLIC_KEY is RSA-2048; RSA-4096 or larger is required -- refusing ...
ERROR api.j2_attachments_backup: [j2-attach-backup] FAIL-CLOSED: BACKUP_PUBLIC_KEY holds a PRIVATE key; ...
```

Downstream signals that also go red, which is intended:
- the J2 fidelity pulse's "last DB backup Nh ago" line;
- `store_backup.stale_stores` / `store_restore.py --list`;
- the drill's freshness checks.

All of them go red after the usual window, because no new object lands.

## Owner actions

1. Generate the keypair (above). Store the private key offline and in the password manager.
2. Set `BACKUP_PUBLIC_KEY` on Railway `web`. Until it is set, the three enabled rails upload nothing.
3. **Rotate the R2 credentials** (`DATA_SYNC_ACCESS_KEY` / `DATA_SYNC_SECRET_KEY`). The leaked
   ones can still read the legacy plaintext objects until those age out.
4. Run `setx BACKUP_PRIVATE_KEY_PATH <path>` on the machine that runs the weekly restore drill.
5. After the first night, check that one object of each kind lands, then run:
   ```
   python tools/authdb_restore_drill.py --private-key <path>
   python tools/store_restore.py --rehearse --private-key <path>
   ```
