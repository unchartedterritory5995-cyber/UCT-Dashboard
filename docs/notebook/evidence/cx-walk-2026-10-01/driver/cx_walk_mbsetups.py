"""List MU 2025 setups in the sandbox over HTTP. Never imports api.*."""
import sys
from playwright.sync_api import sync_playwright
assert not any(m == 'api' or m.startswith('api.') for m in sys.modules)
B = 'http://127.0.0.1:8547'
with sync_playwright() as p:
    m = p.request.new_context()
    print('login', m.post(B + '/api/auth/login', data={'email': 'cxwalk@local.dev', 'password': 'LocalTest2026!'}).status)
    st = m.get(B + '/api/modelbook/stocks?year=2025').json()['stocks']
    mu = next(s for s in st if s['symbol'] == 'MU')
    d = m.get(B + f'/api/modelbook/stock/{mu["id"]}').json()
    for s in d.get('setups', []):
        print(s['id'], s['setup_type'], s['label_date'], s.get('notes'))
