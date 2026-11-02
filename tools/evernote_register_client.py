"""Register the Evernote OAuth client ONCE, at deploy (Plan E Task 2).

    python tools/evernote_register_client.py

Posts the dynamic-client-registration body the probe used to Evernote's auth server and prints
the new `client_id` and the redirect URI it was registered with. The owner then sets it on `web`:

    railway variables --service web --set EVERNOTE_CLIENT_ID=<client_id>

The client is PUBLIC (`token_endpoint_auth_method: none`, no secret), so the id is not
sensitive. Writes nothing to disk and needs no Evernote account.

REFUSES (exit 2, no request sent) unless the redirect URI is the production callback, and
REFUSES (exit 2, no id printed) when Evernote's reply does not echo the requested redirect URIs and
`token_endpoint_auth_method: none`.
`oauth._redirect_uri` honours `EVERNOTE_REDIRECT_URI` and `DASHBOARD_URL`, so a run on a box with
either set would otherwise register a client whose redirect production can never answer.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH → a sandbox)
from api.services.journal_two.note_connectors import evernote_oauth  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    redirect_uri = evernote_oauth._redirect_uri()
    print(f"redirect_uri: {redirect_uri}")
    if redirect_uri != evernote_oauth.PRODUCTION_CALLBACK:
        print(
            f"REFUSED: the redirect URI is not the production callback "
            f"({evernote_oauth.PRODUCTION_CALLBACK}). Unset EVERNOTE_REDIRECT_URI and "
            f"DASHBOARD_URL and run again.",
            file=sys.stderr,
        )
        return 2
    try:
        registration = asyncio.run(evernote_oauth.register_client(redirect_uri))
    except evernote_oauth.RegistrationMismatch as exc:
        # Evernote registered something other than what was asked: do not hand over the id.
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    print(f"registered redirect_uris: {registration.get('redirect_uris')}")
    print(f"token_endpoint_auth_method: {registration.get('token_endpoint_auth_method')}")
    print(f"client_id: {registration['client_id']}")
    print("Set it on web: railway variables --service web --set "
          f"EVERNOTE_CLIENT_ID={registration['client_id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
