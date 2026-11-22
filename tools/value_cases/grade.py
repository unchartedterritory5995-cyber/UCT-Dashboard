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
from .market import OTHER, STOCK

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
            if isinstance(inp, dict) and 'name' in inp:
                inputs[inp['name']] = inp.get('default')
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


def evaluate(tree, inputs):
    """The formula's column on the built market, or (None, why it could not be computed)."""
    try:
        # the door stores the EXPANSION of a band or regression call, never the name: evaluate what is stored
        got = ast_interpret.interpret(call_expansions.expand_calls(tree), STOCK, inputs, None, None, {'tf': 'D', 'symbols': OTHER})
        return [_num(x) for x in got], None
    except Exception as exc:  # noqa: BLE001 -- a formula the interpreter refuses is a finding, not a crash
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


def grade(case_id, answer):
    """{'verdict': 'right' | 'wrong' | 'no rule' | 'not built', 'lines': [...]}: one line per named thing."""
    built, inputs = trees_of(answer)
    if not built:
        return {'verdict': 'not built', 'lines': []}
    want = _rules.rules(case_id)
    if want is None:
        return {'verdict': 'no rule', 'lines': []}
    cols = [(name, *evaluate(tree, inputs)) for name, tree in built]
    lines, right = [], True
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
        result = grade(case['id'], answer)
        if got_lane != 'formula':
            result = {'verdict': 'wrong' if got_lane == 'script' else result['verdict'], 'lines': result['lines'] + [f'answered on the {got_lane} lane, the formula lane expected']}
    else:
        result = {'verdict': 'no grader', 'lines': ['the script lane is graded through the browser engine, not here']}
    return {**result, 'lane': got_lane}


def rule_digest(case_id):
    """A fingerprint of what a rule SAYS on the built market: it changes when the rule's numbers change, and only then."""
    want = _rules.rules(case_id)
    if want is None:
        return None
    h = hashlib.sha256()
    for what in sorted(want):
        h.update(repr(what).encode())
        if what == '__outputs__':
            h.update(repr(want[what]).encode())
            continue
        for reading, column in want[what]:
            h.update(repr(reading).encode())
            h.update(','.join('n' if not _ok(v) else '%.6g' % v for v in column).encode())
    return h.hexdigest()[:16]
