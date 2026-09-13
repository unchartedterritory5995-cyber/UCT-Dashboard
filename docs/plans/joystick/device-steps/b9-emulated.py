"""B9 auto-hide — EMULATED evidence. Playwright, has_touch + is_mobile.

⛔ EMULATED — NOT DEVICE EVIDENCE (CLAUDE.md). Touch emulation satisfies the product's own gate
genuinely — `useHubActive` requires `(max-width:1023px) and (pointer:coarse)` and it is met, not
patched — but no emulator resolves `env(safe-area-inset-*)` and none raises a real soft keyboard.

WHAT EACH ROW MEASURES

  A (per engine, hub mounted)
    E1  pad visible with nothing focused
    E2  focus a text input   -> pad HIDDEN          <- the §8 behaviour B9 adds
    E3  blur                 -> pad restored
    E4  visualViewport.height UNCHANGED across E2   <- the CONTROL, and the point

    E4 is what makes this decisive rather than merely descriptive. `useKeyboardVisible` — the
    pre-B9 mechanism — infers a keyboard from a >150px visualViewport height drop. If the height
    never moved while the pad hid, then the OLD path could not have hidden it and the hide is
    demonstrably the new hook's.

  B (per engine, visualViewport deleted before mount)
    E5  hub-root ABSENT — expected, and recorded rather than passed.
    `useHubActive.js:81` returns false when `window.visualViewport` is undefined, so on such a
    browser the hub never renders and auto-hide is moot. This row exists to pin that floor, not to
    claim a behaviour.
"""
import argparse, json, sys, datetime
from playwright.sync_api import sync_playwright

PAD = '[data-testid="hub-root"]'

def hidden(page):
    return page.eval_on_selector(PAD, "el => el.hasAttribute('hidden')")

def login_and_open(page, base, email, password):
    r = page.request.post(f'{base}/api/auth/login', data={'email': email, 'password': password})
    if not r.ok:
        raise RuntimeError(f'login {r.status}: {r.text()[:120]}')
    page.goto(f'{base}/morning-wire', wait_until='domcontentloaded', timeout=45000)

def row_mounted(pw, engine, base, email, password):
    b = getattr(pw, engine).launch()
    ctx = b.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                        device_scale_factor=3)
    page = ctx.new_page()
    out = {'engine': engine, 'row': 'A — hub mounted, visualViewport present'}
    try:
        login_and_open(page, base, email, password)
        page.wait_for_selector(PAD, timeout=20000)
        out['E1_visible_nothing_focused'] = (hidden(page) is False)

        vv_before = page.evaluate("() => window.visualViewport && window.visualViewport.height")
        page.evaluate("""() => {
          const i = document.createElement('input');
          i.type = 'text'; i.id = '__b9_probe';
          document.body.appendChild(i);
        }""")
        page.eval_on_selector('#__b9_probe', 'el => el.focus()')
        page.wait_for_timeout(200)
        out['E2_hidden_while_focused'] = (hidden(page) is True)
        vv_during = page.evaluate("() => window.visualViewport && window.visualViewport.height")

        page.eval_on_selector('#__b9_probe', 'el => el.blur()')
        page.wait_for_timeout(200)
        out['E3_restored_after_blur'] = (hidden(page) is False)

        out['visualViewport_height_before'] = vv_before
        out['visualViewport_height_during_focus'] = vv_during
        out['E4_control_viewport_did_not_move'] = (vv_before == vv_during)
        out['ok'] = all(out[k] for k in ('E1_visible_nothing_focused', 'E2_hidden_while_focused',
                                         'E3_restored_after_blur', 'E4_control_viewport_did_not_move'))
    except Exception as e:
        out['error'] = f'{type(e).__name__}: {str(e).splitlines()[0][:140]}'
        out['ok'] = False
    finally:
        ctx.close(); b.close()
    return out

def row_no_vv(pw, engine, base, email, password):
    b = getattr(pw, engine).launch()
    ctx = b.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                        device_scale_factor=3)
    ctx.add_init_script("try { delete window.visualViewport } catch (e) {}")
    page = ctx.new_page()
    out = {'engine': engine, 'row': 'B — visualViewport deleted before mount'}
    try:
        login_and_open(page, base, email, password)
        page.wait_for_timeout(2500)
        present = page.evaluate(f"() => !!document.querySelector('{PAD}')")
        out['vv_seen_by_page'] = page.evaluate("() => !!window.visualViewport")
        out['E5_hub_absent_as_the_floor_requires'] = (present is False)
        out['ok'] = (out['E5_hub_absent_as_the_floor_requires'] is True
                     and out['vv_seen_by_page'] is False)
    except Exception as e:
        out['error'] = f'{type(e).__name__}: {str(e).splitlines()[0][:140]}'
        out['ok'] = False
    finally:
        ctx.close(); b.close()
    return out

def main():
    ap = argparse.ArgumentParser()
    for f in ('base', 'email', 'password', 'out'):
        ap.add_argument(f'--{f}', required=True)
    a = ap.parse_args()
    rows = []
    with sync_playwright() as pw:
        for engine in ('chromium', 'webkit'):
            if not hasattr(pw, engine):
                rows.append({'engine': engine, 'ok': False, 'error': 'engine not installed'})
                continue
            rows.append(row_mounted(pw, engine, a.base, a.email, a.password))
            rows.append(row_no_vv(pw, engine, a.base, a.email, a.password))
    doc = {'label': 'EMULATED - NOT DEVICE EVIDENCE',
           'at': datetime.datetime.now().isoformat(timespec='seconds'),
           'base': a.base, 'viewport': '393x852 has_touch is_mobile device_scale_factor 3',
           'route': '/morning-wire', 'rows': rows}
    open(a.out, 'w', encoding='utf-8').write(json.dumps(doc, indent=2))
    for r in rows:
        print(' ', r.get('engine'), '|', r.get('row', '?'), '->',
              'PASS' if r.get('ok') else 'FAIL', r.get('error', ''))
    sys.exit(0 if all(r.get('ok') for r in rows) else 1)

if __name__ == '__main__':
    main()
