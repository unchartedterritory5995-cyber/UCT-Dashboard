"""Lane CX walk probe: provision the two accounts and ask the sandbox, over HTTP only, what
data it holds for the three surfaces. ⛔ Never imports api.*."""
import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8547'
ADMIN = ('hubtest@local.dev', 'LocalTest2026!')
MEMBER = ('cxwalk@local.dev', 'LocalTest2026!')
step = sys.argv[1] if len(sys.argv) > 1 else 'status'


def login(req, email, pw, name):
    r = req.post(BASE + '/api/auth/signup', data={'email': email, 'password': pw, 'display_name': name})
    if r.status not in (200, 201):
        r = req.post(BASE + '/api/auth/login', data={'email': email, 'password': pw})
    return r.status


with sync_playwright() as p:
    a = p.request.new_context()
    m = p.request.new_context()
    print('admin', login(a, *ADMIN, 'hubtest'), 'member', login(m, *MEMBER, 'cxwalk'))
    if step == 'provision':
        print('comp', a.post(BASE + '/api/auth/admin/comp-access', data={'email': MEMBER[0], 'action': 'grant'}).status)
        print('verify', a.post(BASE + '/api/auth/admin/verify-email', data={'email': MEMBER[0]}).status)
        print('me', json.dumps(m.get(BASE + '/api/auth/me').json())[:300])
    elif step == 'cot-refresh':
        print(a.post(BASE + '/api/cot/refresh').text())
    elif step == 'screener-refresh':
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
        print(a.post(BASE + f'/api/screener/refresh?max_tickers={n}').text())
    elif step == 'bars':
        import time as _tt
        for t in sys.argv[2].split(','):
            for _try in range(4):
                r = m.get(BASE + f'/api/bars/{t}?tf=D&bars=400')
                if r.status != 503:
                    break
                _tt.sleep(4)
            try:
                n = len((r.json() or {}).get('bars') or [])
            except Exception:  # noqa: BLE001
                n = -1
            print(t, r.status, n)
    elif step == 'status':
        print('cot', json.dumps(m.get(BASE + '/api/cot/status').json())[:300])
        print('screener', m.get(BASE + '/api/screener/status').text()[:600])
        r = m.post(BASE + '/api/screener/scan', data={'filters': [], 'page': 1, 'page_size': 5})
        print('scan', r.status, r.text()[:400])
        print('mb years', m.get(BASE + '/api/modelbook/years').text()[:200])
