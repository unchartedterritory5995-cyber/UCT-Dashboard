Link-protocol allowlist coverage beyond the golden fixture's https +
import-link cases: an `http://` (not `https://`) link, which the implemented
policy still keeps as a real link mark (the app's `protocols: ['https']`
config APPENDS to tiptap-link's hardcoded default allow-list rather than
replacing it — see `mddoc.py::_LINK_ALLOWED_PROTOCOLS`).

Plain http link: [legacy vendor doc](http://example.com/legacy-notes).

Mailto is in the same default allow-list: [email the desk](mailto:desk@example.com).
