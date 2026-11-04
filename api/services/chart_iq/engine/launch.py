# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
def adr(b, k, n=20):
    w = b[max(0, k - n):k + 1]
    return sum((x['h'] / x['l'] - 1 for x in w)) / max(1, len(w))

def launch_bases(b, look=220, min_len=15, tight_len=8, max_len=70, run_min=0.25, keep=2):
    n = len(b)
    out = []
    e = n - 2
    stop = max(30, n - look)
    while e > stop:
        bo = e + 1
        if bo >= n:
            e -= 1
            continue
        tol = max(0.15, min(0.35, 4.5 * adr(b, e)))
        hi, lo = (b[e]['h'], b[e]['l'])
        s = e
        while s - 1 > stop and e - (s - 1) < max_len:
            h2, l2 = (max(hi, b[s - 1]['h']), min(lo, b[s - 1]['l']))
            if h2 / l2 - 1 > tol:
                break
            hi, lo, s = (h2, l2, s - 1)
        ln = e - s + 1
        cl = sorted((x['c'] for x in b[s:e + 1]))
        top = cl[int(0.9 * (len(cl) - 1))]
        ok = (ln >= min_len or (ln >= tight_len and hi / lo - 1 <= 0.12)) and b[bo]['c'] > top and (b[bo]['c'] > b[e]['c']) and (max((x['h'] for x in b[bo:min(n, bo + 40)])) >= top * (1 + run_min)) and (b[-1]['c'] >= top * 0.97)
        if ok:
            out.append({'s': s, 'e': e, 'top': round(top, 4), 'low': round(lo, 4), 'bo': bo, 'run': round(max((x['h'] for x in b[bo:min(n, bo + 40)])) / top - 1, 3)})
            if len(out) >= keep:
                break
            e = s - 1
        else:
            e -= 1
    return out
