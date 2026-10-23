# At-rest key rotation (BROKER_ENCRYPTION_KEY, NOTE_ENCRYPTION_KEY)

Why: Railway leaked customer env vars on 2026-10-21, including the two Fernet
keys that encrypt member secrets at rest in SQLite on the web pod. This runbook
moves every stored secret onto a NEW key without losing any of it.

Code: `api/services/crypto_box.py` (per-family `<BASE>_ACTIVE_VERSION`) and
`tools/reencrypt_at_rest.py`. Tests: `tests/test_crypto_box_rotation.py`,
`tests/test_reencrypt_at_rest.py`. The code is a no-op until you set the env
vars below: with none of them set, the module is byte-for-byte the old one
(proved by a test against a frozen copy of the old module).

Do the two families one at a time (broker first, then note), or together.
They are independent: rotating one never touches the other.

## What is encrypted, and where

| Family | Key env | Database (prod) | Table.column | Written by |
|---|---|---|---|---|
| broker | `BROKER_ENCRYPTION_KEY` | `/data/auth.db` | `j2_broker_users.user_secret_enc` (SnapTrade userSecret) | `api/services/journal_two/broker/connections.py:41` |
| broker | `BROKER_ENCRYPTION_KEY` | `/data/auth.db` | `user_totp.secret_encrypted` (2FA TOTP seed) | `api/services/totp_service.py:150` |
| broker | `BROKER_ENCRYPTION_KEY` | `/data/alert_taxonomy.db` | `alert_webhooks.secret_enc` (member webhook signing secret) | `api/services/alert_taxonomy/outbound_webhooks.py:231` |
| note | `NOTE_ENCRYPTION_KEY` | `/data/auth.db` | `j2_note_connectors.token_enc` (Notion/Dropbox/MS Graph/Roam/Craft tokens, JSON) | `api/services/journal_two/note_connectors/connections.py:60` |
| note | `NOTE_ENCRYPTION_KEY` | `/data/auth.db` | `j2_obsidian_devices.token_enc` (Obsidian device secret) | `api/services/journal_two/note_connectors/obsidian_link.py:317` |
| private | `WISDOM_PRIVATE_KEY` | `/data/wisdom_private.db` | `wisdom_private_positions.value_enc` | `api/services/wisdom/core/private.py:109` (key unset in prod: no rows, nothing to do) |

The tool also runs a census of every other column in those databases and
refuses to `--apply` if it finds a crypto-box-looking value it does not know.

One more use of the broker key that is not a column: the 2FA login challenge
token is an HMAC keyed from `BROKER_ENCRYPTION_KEY` (`totp_service.py:322`).
With the leaked key an attacker could mint a challenge for any 2FA member and
skip the password step (the TOTP code is still needed). Changing
`BROKER_ENCRYPTION_KEY` closes that the moment it deploys. Side effect: anyone
mid-login (5-minute window) has to start the login again.

## Env vars you will set (per family)

| | broker | note |
|---|---|---|
| OLD key, renamed | `BROKER_ENCRYPTION_KEYS_V1` | `NOTE_ENCRYPTION_KEYS_V1` |
| NEW key | `BROKER_ENCRYPTION_KEY` | `NOTE_ENCRYPTION_KEY` |
| switch | `BROKER_ENCRYPTION_ACTIVE_VERSION=v2` | `NOTE_ENCRYPTION_ACTIVE_VERSION=v2` |

Note the plural `KEYS` in the `_V1` name. A malformed `ACTIVE_VERSION` (anything
but `v2`, `v3`, ...) fails closed: encryption refuses and `is_configured()` is
false. It never silently falls back to v1.

## Steps

0. **Find every service that holds the keys.** In the Railway dashboard, open
   the Variables tab for each service (web, worker, cron monitor, flow-worker, and
   any others) and note which have `BROKER_ENCRYPTION_KEY` / `NOTE_ENCRYPTION_KEY`.
   Every service on that list gets the same three variables in step 2. Copy the
   current (old) values into your password manager now. They are the only way
   to read existing rows and pre-rotation backups.

1. **Generate the new keys on your own machine**, one per family, and never
   reuse one across families:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
   Store them in the password manager next to the old ones. Use the dashboard
   raw editor rather than a shell, so no key ends up in shell history.

2. **Stage all three variables together, on every service from step 0.**
   `BROKER_ENCRYPTION_KEYS_V1=<old>`, `BROKER_ENCRYPTION_KEY=<new>`,
   `BROKER_ENCRYPTION_ACTIVE_VERSION=v2`. Setting a variable on Railway only
   stages it. Nothing changes until the deploy in step 3, so all three take
   effect at once.

3. **Deploy** (a redeploy of each service from step 0; the rotation code must
   already be on master). Check `/api/health` and confirm the uptime reset on
   each service. Right after the deploy:
   - new writes are `v2:` under the new key
   - old `v1:` rows read through `..._KEYS_V1`
   - members notice nothing

4. **Dry run on the web pod** (`railway ssh --service web`, then):
   `/opt/venv/bin/python tools/reencrypt_at_rest.py --family broker`
   It opens the databases read-only and prints, per table.column, the row count,
   how many are already on the active version, how many it would convert, and
   whether each one decrypts. To go ahead you need:
   - `failures=0`
   - `unknown-columns=0`
   - no `WARNING ... not found in ANY scanned database` line

   If `user_totp` or `alert_webhooks` really does not exist on the pod (the
   feature never ran), that warning is expected, and step 5 needs
   `--allow-missing-tables`.

5. **Apply:**
   `/opt/venv/bin/python tools/reencrypt_at_rest.py --family broker --apply`
   It re-runs the full scan and refuses, with zero writes, if anything is off.
   Then it converts each table in one transaction and verifies every rewritten
   value decrypts to the identical plaintext before it commits. The last line
   must read: `post-apply: ... still-to-convert=0 active-failures=0`, exit 0.
   The run is short and streams rows, so it is not a heavy job, but avoid
   running it during a deploy.

6. **Verify:**
   - Run the dry run from step 4 again. It must print `to-convert=0` and show
     every row under `active ok`.
   - Run `--apply` again. It must print `nothing to convert ... no-op`, which
     proves the tool is idempotent.
   - Smoke-test the product: a 2FA login, a broker sync (Journal 2.0, broker
     tab), and one test webhook delivery if any webhooks exist.
   - For the note family: one connector sync and one Obsidian push.

7. Repeat steps 2-6 with `--family note` and the `NOTE_*` variables, or do both
   families in the same step 2 and deploy.

8. **Much later, remove `..._KEYS_V1`.** Do this only when all of these hold:
   - (a) step 6 has passed and a soak of at least 7 days has gone by
   - (b) every auth.db backup taken before step 5 has aged out. R2 keeps the
     newest `AUTHDB_BACKUP_KEEP` (default 14). Or accept that restoring one
     needs the old key from your password manager.
   - (c) a final dry run shows `v1=0` everywhere

   Remove it with an empty value (`""`) on every service, then deploy. Keep the
   old key in the password manager. It is compromised, so never set it as an
   active key again, but it is the only key for old backups.

## What breaks if you skip or reorder a step

| Mistake | Effect | Fix |
|---|---|---|
| New `..._KEY` and `ACTIVE_VERSION=v2` set, `..._KEYS_V1` NOT set | Every v1 row is unreadable. 2FA members cannot log in (the code check returns false), broker sync errors, webhooks fail, and note connectors get flipped to `broken` in the DB (a durable status the member must clear by reconnecting). | Set `..._KEYS_V1=<old>` and redeploy right away. The tool refuses (`no key configured for v1`, exit 3) and writes nothing. |
| New `..._KEY` set, `ACTIVE_VERSION` forgotten | Nothing breaks, but nothing is rotated: while v1 is active, `..._KEYS_V1` wins, so new writes still use the OLD (leaked) key. | Set `ACTIVE_VERSION=v2` and deploy. `--apply` refuses with exit 2 until you do. |
| `ACTIVE_VERSION=v2` but `..._KEY` still the old value | "v2" rows under the leaked key. | The tool refuses (`SAME key`, exit 2). Set a new key. |
| Variables set on web but not on worker or another service | That service keeps writing v1 rows with the old key. They stay readable (V1=old), but the leaked key stays in use. | Set them on every service from step 0. A later dry run shows the new v1 rows, and `--apply` converts them. |
| `--apply` before the deploy | The running code has no v2 yet. | The tool refuses: active is still v1 (exit 2). |
| `..._KEYS_V1` removed before `--apply` | Same as the first row. | Put it back. |
| `..._KEYS_V1` removed, then a pre-rotation backup restored | The restored rows are v1 and unreadable. | Set `..._KEYS_V1=<old>` from the password manager, then re-run step 5 on the restored DB. |

## Rollback

- **Before step 5 (only the env vars have changed).** v2 rows may already
  exist, so set `..._KEYS_V2=<new key>` FIRST. Then set `ACTIVE_VERSION` to `""`
  (or `v1`) and deploy. Every row reads:
  - v1 through `..._KEYS_V1`
  - v2 through `..._KEYS_V2`

  This is proved by `test_env_rollback_needs_the_v2_key_pinned`.
- **After step 5.** Same as above. All rows are v2 and read through
  `..._KEYS_V2`. Do not put the old key back as `..._KEY` without `..._KEYS_V2`
  set, or every v2 row stops reading.
- **Reverting the code commit.** The old module hard-codes v1 and has never
  heard of `ACTIVE_VERSION`. Set `..._KEYS_V2=<new key>` BEFORE the revert
  deploys, and the old code reads every row (proved by
  `test_code_rollback_to_legacy_module_reads_v2_rows_with_s_v2`). New writes
  then go to v1 under `..._KEYS_V1` (the old key), so roll forward again soon.
- The tool itself: each table commits only after its read-back verifies. If
  apply stops partway, the tables already committed are valid v2. Fix the
  cause and re-run; it carries on with whatever is still v1.

## Do members need to act?

**Rotation alone needs nothing from members.** The tool re-wraps the same
plaintext, so these all keep working unchanged:
- TOTP seeds
- SnapTrade userSecrets
- webhook signing secrets
- connector tokens
- Obsidian device secrets

The open question is whether the CIPHERTEXT also left the box. A leaked key
only matters to someone who also has the rows. Find out whether the leak
included the R2 credentials that `authdb_backup.py` uploads with (the
`data_sync` / `DATA_SYNC_*` credentials), and whether `AUTHDB_BACKUP_ENABLED`
was on. If yes, assume an attacker could have downloaded an auth.db backup and
decrypted every secret in it. Rotating keys does not undo that. Per secret:

- **SnapTrade userSecret.** The consumer key has already been rotated, and a
  userSecret is useless without it, so no relink is needed. Optional hardening:
  call SnapTrade's per-user secret reset server-side. No member action.
- **TOTP seeds (exfiltration plausible).** An attacker with the seed has the
  member's second factor and still needs the password. Ask 2FA members to
  disable and re-enable 2FA, which issues a new seed. Without exfiltration
  evidence there is no action. The challenge-forgery risk above is closed by
  the key change alone.
- **Webhook signing secrets (exfiltration plausible).** An attacker could
  forge signed deliveries to a member's endpoint. Ask webhook owners to revoke
  and recreate (at most 3 per member).
- **Note connector tokens (exfiltration plausible).** Notion, Dropbox and MS
  Graph refresh tokens also need the OAuth client secrets, which were probably
  in the same env leak, so rotate those client secrets at each provider.
  Roam graph tokens and Craft capability URLs can only be revoked by the
  member. Ask Roam and Craft users to regenerate and reconnect.
- **Obsidian device secrets (exfiltration plausible).** These let a holder push
  into the member's Obsidian staging. Ask members to re-pair, which rotates the
  secret.
