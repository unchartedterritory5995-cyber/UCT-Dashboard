# -*- coding: utf-8 -*-
"""Does a colour helper reach a plot() colour argument anywhere in the corpus?

Check 1 said Clouds' plots carry NO colour at all, so the colour fold is not
triggered BY CLOUDS. This asks the wider question the owner's step 3 is really
about: is `color.new` / `color.t` / `color.rgb` / `color.from_gradient` feeding a
plot() colour anywhere in the 327, or only fill/bgcolor — i.e. is a plan-time
colour fold worth building on the definition lane at all?

The distinction that matters is WHICH CALL consumes the colour:
  plot(...)                 -> this lane draws it; a dropped alpha is a visual lie
  fill / bgcolor / bar-paint -> chart-only today, noted with its line

⛔ Comments and string literals are stripped before matching, and the stripper
carries its own control (this repo has six recorded instances of a literal-hunting
check matching its own prose).
"""
import io
import os
import re
import sys

ROOT = 'C:/Users/Patrick/uct-worktrees/indicator-r0r1'
DIRS = [
    os.path.join(ROOT, 'corpus/committed'),
    os.path.join(ROOT, 'tests/fixtures/pine_oos'),
    os.path.join(ROOT, 'tests/fixtures/member'),
]

COLOUR_HELPERS = ('color.new', 'color.t', 'color.rgb', 'color.from_gradient')


def strip_pine(src):
    """Remove `//` comments and string literals, preserving line count."""
    out = []
    for line in src.split('\n'):
        res, i, n, quote = [], 0, len(line), None
        while i < n:
            ch = line[i]
            if quote:
                if ch == quote:
                    quote = None
                res.append(' ')
                i += 1
                continue
            if ch in '"\'':
                quote = ch
                res.append(' ')
                i += 1
                continue
            if ch == '/' and i + 1 < n and line[i + 1] == '/':
                break
            res.append(ch)
            i += 1
        out.append(''.join(res))
    return '\n'.join(out)


def call_args(text, start):
    """Return the argument text of a call whose '(' follows index `start`."""
    i = text.find('(', start)
    if i < 0:
        return ''
    depth, j = 0, i
    while j < len(text):
        if text[j] == '(':
            depth += 1
        elif text[j] == ')':
            depth -= 1
            if depth == 0:
                return text[i + 1:j]
        j += 1
    return text[i + 1:]


# ── the stripper's own control ──────────────────────────────────────────────
PROBE = '\n'.join([
    '// color.new(a, 50) in a comment',
    'x = "color.new(a, 50) in a string"',
    'plot(close, color=color.new(red, 50))',
])
assert strip_pine(PROBE).count('color.new') == 1, 'stripper control: expected exactly 1'

files = []
for d in DIRS:
    if not os.path.isdir(d):
        continue
    for name in sorted(os.listdir(d)):
        if name.endswith('.pine') or name.endswith('.txt'):
            files.append(os.path.join(d, name))

PLOT_CALL = re.compile(r'\bplot\s*\(')
FILLISH = re.compile(r'\b(fill|bgcolor|barcolor|plotshape|plotchar|plotcandle|hline)\s*\(')

plot_colour, fillish_colour, any_helper, total = [], [], [], 0
for path in files:
    total += 1
    src = strip_pine(io.open(path, encoding='utf-8', errors='replace').read())
    if not any(h in src for h in COLOUR_HELPERS):
        continue
    any_helper.append(path)
    hit_plot = False
    for m in PLOT_CALL.finditer(src):
        args = call_args(src, m.start())
        if any(h in args for h in COLOUR_HELPERS):
            hit_plot = True
            break
    if hit_plot:
        plot_colour.append(path)
    hit_fill = False
    for m in FILLISH.finditer(src):
        args = call_args(src, m.start())
        if any(h in args for h in COLOUR_HELPERS):
            hit_fill = True
            break
    if hit_fill:
        fillish_colour.append(path)

w = sys.stdout.buffer.write
w(('files scanned                              : %d\n' % total).encode())
w(('use a colour helper at all                 : %d\n' % len(any_helper)).encode())
w(('helper INSIDE a plot() call                : %d\n' % len(plot_colour)).encode())
w(('helper inside fill/bgcolor/barcolor/shape  : %d\n' % len(fillish_colour)).encode())
w(b'\nplot()-colour scripts:\n')
for p in plot_colour[:40]:
    w(('  %s\n' % os.path.basename(p)).encode('utf-8', 'replace'))
