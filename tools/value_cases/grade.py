"""Hold an answer of the Create Indicator door to the independent calculation of what was asked.

Three kinds of case, one evidence tier:
  * lane "formula": the door answers with a patch of formulas (graded by value, below);
  * lane "script": the door answers with a script (graded by value through the browser engine: not in this module yet);
  * lane "wall": the request cannot be served, and the right answer REFUSES and NAMES THE WALL in plain words. A
    refusal that names nothing is not right, and neither is a build.

`grade(case_id, answer)` evaluates every formula the answer holds (each output, each condition of a colour state
or a marker) with the SERVER'S OWN interpreter on the built market, and compares each with the readings of
`rules.rules(case_id)`. The answer is right when every named thing of the rule is equalled by one formula on
every bar both have a value, and no formula holds an absurd number.

The interpreter is the product's (that is the point: it is what a member's chart computes); the rule is not.
"""
import hashlib
import math

from api.services import ast_interpret, call_expansions

from . import rules as _rules
from .market import INTRADAY, INTRADAY_OTHER, OTHER, STOCK

NAN = float('nan')


def _ok(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


def _num(v):
    return 1.0 if v is True else 0.0 if v is False else (float(v) if _ok(v) else NAN)


def trees_of(answer):
    """Every formula of what the door built: [(name, tree)], and the inputs' defaults."""
    out, inputs = [], {}
    for op in (answer or {}).get('ops') or []:
        for inp in op.get('inputs') or []:
            # the door writes a setting's name as `key` (an older shape wrote `name`): both are read
            if isinstance(inp, dict) and (inp.get('key') or inp.get('name')):
                inputs[inp.get('key') or inp['name']] = inp.get('default')
        for o in op.get('outputs') or ([op['output']] if isinstance(op.get('output'), dict) else []):
            if isinstance(o, dict) and o.get('tree') is not None:
                out.append((f"output {o.get('key')}", o['tree']))
        if isinstance(op.get('tree'), dict):
            out.append((f"{op['op']} {op.get('key') or op.get('output') or ''}".strip(), op['tree']))
        for s in op.get('states') or []:
            if isinstance(s, dict) and s.get('when') is not None:
                out.append((f"{op.get('channel') or op['op']} {s.get('color')}", s['when']))
        if isinstance(op.get('when'), dict):
            out.append((f"{op['op']} when", op['when']))
    return out, inputs


#: the charts a case may name: its bars, its timeframe, the other symbols on the same bars, and (below a day) the
#: DAILY bars of each, which a calculation timeframe of a day is computed on
CHARTS = {
    'daily': {'bars': STOCK, 'tf': 'D', 'symbols': OTHER, 'frames': {}},
    'intraday': {'bars': INTRADAY['bars'], 'tf': INTRADAY['tf'], 'symbols': {s: c['bars'] for s, c in INTRADAY_OTHER.items()},
                 'frames': {'D': {'bars': INTRADAY['daily'], 'symbols': {s: c['daily'] for s, c in INTRADAY_OTHER.items()}}}},
}


def calc_timeframe_of(answer):
    """The calculation timeframe the answer sets for the whole indicator (its last word on it), or None."""
    calc = None
    for op in (answer or {}).get('ops') or []:
        if isinstance(op, dict) and op.get('op') == 'set_calculation_timeframe':
            calc = op.get('timeframe') or None
    return calc


def _interpret(tree, bars, inputs, tf, symbols):
    # the door stores the EXPANSION of a band or regression call, never the name: evaluate what is stored
    return [_num(x) for x in ast_interpret.interpret(call_expansions.expand_calls(tree), bars, inputs, None, None, {'tf': tf, 'symbols': symbols})]


def evaluate(tree, inputs, chart='daily', calc=None):
    """The formula's column on a built chart, or (None, why it could not be computed).

    `calc`: the calculation timeframe the answer set. On the chart's own timeframe (or none) the formula is computed
    on the chart's bars. On a HIGHER one it is computed on that timeframe's bars and placed on the chart's bars by
    the product's own projection (`frame_projection`): what a member's chart shows, not a rule restated here."""
    c = CHARTS[chart]
    try:
        if calc in (None, '', c['tf']):
            return _interpret(tree, c['bars'], inputs, c['tf'], c['symbols']), None
        frame = c['frames'].get(calc)
        if frame is None:
            return None, f'a calculation timeframe of {calc!r} on the {chart} chart is not graded here'
        from . import frame_projection
        col = _interpret(tree, frame['bars'], inputs, calc, frame['symbols'])
        placed = frame_projection.project([{'id': 'x', 'frameBars': frame['bars'], 'columns': {'x': [v if _ok(v) else None for v in col]},
                                            'frame': calc, 'chartBars': c['bars'], 'chartTf': c['tf'], 'newestFinal': True}])['x']
        return [_num(v) for v in placed['columns']['x']], None
    except Exception as exc:  # noqa: BLE001 -- a formula the interpreter refuses is a finding, not a crash
        if type(exc).__name__ == 'LaneUnavailable':
            raise                                               # no node here: NOT graded, never a verdict
        return None, f'{type(exc).__name__}: {str(exc)[:160]}'


def compare(got, want):
    """(bars compared, bars that disagree, (bars only the built one has, bars only the rule has))."""
    both, bad, built_only, rule_only = 0, 0, 0, 0
    for g, w in zip(got, want):
        if _ok(g) and _ok(w):
            both += 1
            if abs(g - w) > max(1e-9, 1e-6 * max(abs(g), abs(w))):
                bad += 1
        elif _ok(g):
            built_only += 1
        elif _ok(w):
            rule_only += 1
    return both, bad, (built_only, rule_only)


def grade(case_id, answer, chart='daily'):
    """{'verdict': 'right' | 'wrong' | 'no rule' | 'not built', 'lines': [...]}: one line per named thing."""
    built, inputs = trees_of(answer)
    if not built:
        return {'verdict': 'not built', 'lines': []}
    want = _rules.rules(case_id)
    if want is None:
        return {'verdict': 'no rule', 'lines': []}
    calc = calc_timeframe_of(answer)
    cols = [(name, *evaluate(tree, inputs, chart, calc)) for name, tree in built]
    lines, right = [], True
    fill = want.pop('__fill_in__', None)
    if fill is not None:
        return _grade_fill_in(fill, built, inputs, cols, chart, calc)
    expect_n = want.pop('__outputs__', None)
    outputs = [n for n, _ in built if n.startswith('output ')]
    if expect_n is not None and len(outputs) != expect_n:
        right = False
        lines.append(f'the indicator holds {len(outputs)} output(s), {expect_n} asked for')
    for what, readings in want.items():
        best = None
        for reading, column in readings:
            for name, got, _err in cols:
                if got is None:
                    continue
                both, bad, lop = compare(got, column)
                if both and (best is None or (bad, sum(lop)) < (best[0], sum(best[1]))):
                    best = (bad, lop, both, name, reading)
        if best is None:
            right = False
            lines.append(f'{what}: NOTHING TO COMPARE (no formula has a value where the rule has one)')
        elif best[0] == 0:
            lines.append(f'{what} = {best[3]} [{best[4]}] on {best[2]} bars')
        else:
            right = False
            lines.append(f'{what}: NO FORMULA EQUALS IT. closest {best[3]} [{best[4]}], {best[0]} of {best[2]} bars differ')
    for name, got, err in cols:
        if err:
            lines.append(f'could not compute {name}: {err}')
        elif sum(1 for x in got if _ok(x) and abs(x) > 1e12):
            right = False
            lines.append(f'{name} holds values above 1e12')
    return {'verdict': 'right' if right else 'wrong', 'lines': lines}


def _grade_fill_in(fill, built, inputs, cols, chart, calc):
    """A rule about SETTINGS the member fills in: `fill` is [(what, a value to try)]. Right when
    (1) there is a setting for each, every one defaulting to 0 or to nothing (the member's own figures are never invented);
    (2) with nothing filled in, NOTHING has a value on any bar (no line at 0, no example position);
    (3) with the settings filled in, each value is shown by some output on every bar (whichever setting holds which)."""
    import itertools
    lines, right = [], True
    names = list(inputs)
    if len(names) < len(fill):
        return {'verdict': 'wrong', 'lines': [f'{len(names)} setting(s) for {len(fill)} figure(s) the member must give: {[w for w, _v in fill]}']}
    invented = {n: d for n, d in inputs.items() if d not in (0, 0.0, None)}
    if invented:
        right = False
        lines.append(f'a figure of the member is INVENTED as a default: {invented}')
    drawn = [name for name, got, _err in cols if got is not None and any(_ok(v) for v in got)]
    if drawn:
        right = False
        lines.append(f'with nothing filled in, {drawn} has a value on the chart (a setting at 0 is drawn as a level at 0)')
    else:
        lines.append('with nothing filled in, nothing is drawn')
    values = [v for _w, v in fill]
    shown = None
    for chosen in itertools.permutations(names, len(values)):
        filled = {**inputs, **dict(zip(chosen, values))}
        got = [evaluate(tree, filled, chart, calc)[0] for _name, tree in built]
        if all(any(col is not None and col and all(_ok(x) and abs(x - v) <= 1e-9 * max(1.0, abs(v)) for x in col) for col in got) for v in values):
            shown = dict(zip([w for w, _v in fill], chosen))
            break
    if shown is None:
        right = False
        lines.append(f'filled in with {values}, no output shows each of them on every bar')
    else:
        lines.append(f'filled in, each figure is shown on every bar: {shown}')
    return {'verdict': 'right' if right else 'wrong', 'lines': lines}


def lane_of(answer):
    """The lane an answer came back on: 'formula' (a patch that builds), 'script', or 'wall' (nothing built)."""
    answer = answer or {}
    if isinstance(answer.get('script'), dict) or answer.get('turn') == 'script':
        return 'script'
    built, _inputs = trees_of(answer)
    return 'formula' if built else 'wall'


#: the plain words that say a number cannot be given here
CANNOT_GIVE = ('not available', "can't", 'cannot', 'can not', "isn't available", 'is not something')


def grade_wall(case, answer):
    """A request that cannot be served: right when nothing is built, the door refuses, and the reply names the wall."""
    answer = answer or {}
    lines, right = [], True
    built, _inputs = trees_of(answer)
    if built or lane_of(answer) == 'script':
        return {'verdict': 'wrong', 'lines': ['something was BUILT for a request that cannot be served']}
    offers = case['wall'].get('offers')
    theirs = case['wall'].get('theirs')
    questions = [q for q in answer.get('questions') or [] if isinstance(q, dict)]
    # a wall WITH OFFERS may be refused as a question that says so and carries the offers as one-tap choices; a wall
    # that is ANOTHER PUBLISHER'S OWN NUMBER may be an answer that says so and then offers UCT's own
    refusals = ('unsupported',) + (('clarify',) if offers else ()) + (('answer',) if theirs else ())
    if answer.get('disposition') not in refusals or (answer.get('disposition') == 'clarify' and not questions):
        right = False
        lines.append(f"the door did not refuse (it answered {answer.get('disposition')!r})")
    said = [str(answer.get('reply') or '')] + [str(q.get('text') or '') for q in questions]
    reply = ' '.join(' '.join(said).lower().split())
    choices = [' '.join(str(c).lower().split()) for q in questions for c in q.get('choices') or []]
    for offer in offers or []:
        words = [w.lower() for w in offer['words']]
        made = next((c for c in (choices if questions else [reply]) if all(w in c for w in words)), None)
        if made is None:
            right = False
            lines.append(f"NOT OFFERED: {offer['what']} (no {'choice' if questions else 'sentence'} holds {offer['words']})")
        else:
            lines.append(f"offered: {offer['what']}")
    if theirs:
        cannot = min((reply.find(p) for p in CANNOT_GIVE if p in reply), default=-1)
        ours = reply.find('uct')
        if cannot < 0:
            right = False
            lines.append(f"it never says {theirs}'s own number cannot be given here")
        elif 0 <= ours < cannot:
            right = False
            lines.append(f"it names UCT's own BEFORE saying {theirs}'s number cannot be given")
        if ours >= 0 and f"not {theirs.lower()}'s" not in reply:
            right = False
            lines.append(f"it offers UCT's own without saying it is not {theirs}'s")
    named = [w for w in case['wall']['names'] if w.lower() in reply]
    if named:
        lines.append(f'the reply names the wall: {named[0]!r}')
    else:
        right = False
        lines.append(f"the reply names none of {case['wall']['names']}")
    return {'verdict': 'right' if right else 'wrong', 'lines': lines}


def grade_case(case, answer=None):
    """The verdict on an answer to a case (the recorded one by default), on the lane the case expects."""
    answer = case['answer'] if answer is None else answer
    got_lane = lane_of(answer)
    if case['lane'] == 'wall':
        result = grade_wall(case, answer)
    elif case['lane'] == 'formula':
        result = grade(case['id'], answer, case.get('chart', 'daily'))
        # a formula case may also hold what the member is TOLD (`says`: each group needs one of its phrases)
        told = ' '.join(str(answer.get('reply') or '').lower().split())
        for group in case.get('says') or []:
            if not any(p.lower() in told for p in group):
                result = {'verdict': 'wrong' if result['verdict'] == 'right' else result['verdict'],
                          'lines': result['lines'] + [f'the reply says none of {group}']}
        if got_lane != 'formula':
            result = {'verdict': 'wrong' if got_lane == 'script' else result['verdict'], 'lines': result['lines'] + [f'answered on the {got_lane} lane, the formula lane expected']}
    else:
        result = {'verdict': 'no grader', 'lines': ['the script lane is graded through the browser engine, not here']}
    return {**result, 'lane': got_lane}


def specimens(case):
    """Every WRONG answer this case holds, oldest first: each fixed defect kept in `found`, then its record while the
    case is recorded WRONG. Each is {answer, defect, recorded, fixed_by} (`fixed_by` None while the defect stands)."""
    out = [dict(s) for s in case.get('found') or []]
    if case.get('recorded_verdict') == 'wrong':
        out.append({'answer': case['answer'], 'defect': case.get('defect'), 'recorded': case.get('recorded'), 'fixed_by': None})
    return out


def specimen(case):
    """The wrong answer a finding rests on: the newest of `specimens(case)`, or None when the case never was wrong."""
    held = specimens(case)
    return held[-1] if held else None


def rule_digest(case_id):
    """A fingerprint of what a rule SAYS on the built market: it changes when the rule's numbers change, and only then."""
    want = _rules.rules(case_id)
    if want is None:
        return None
    h = hashlib.sha256()
    for what in sorted(want):
        h.update(repr(what).encode())
        if what in ('__outputs__', '__fill_in__'):
            h.update(repr(want[what]).encode())
            continue
        for reading, column in want[what]:
            h.update(repr(reading).encode())
            h.update(','.join('n' if not _ok(v) else '%.6g' % v for v in column).encode())
    return h.hexdigest()[:16]


def capabilities_of(source):
    """The capabilities a script uses, by the product's ONE detector. Asked by an adoption only (to keep what the
    record covers); grading never reads it."""
    from api.services import pine_capabilities
    return pine_capabilities.capabilities_of(source)
