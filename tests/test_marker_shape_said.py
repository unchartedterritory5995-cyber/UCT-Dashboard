"""A marker shape the chart cannot draw is drawn as the nearest one, and SAID (2026-11-26).

The community-words probe (live, admin measurement only): "a gray triangle above the bar when today's high minus the 10
day average is at least 2 times the 21 day ATR" was built as an ARROW and the reply said "an arrow" without saying a
triangle is not drawn here. The chart draws four marker shapes (`presentation_schema.MARKER_SHAPES`). Held here: the
rule is in the instructions every formula turn reads, it names exactly the schema's shapes (derived, so a shape added
there is named here), and it says to tell the member. No model call.
"""
from api.services import definition_conversation as conv
from api.services import presentation_schema


def test_the_rule_is_in_the_instructions():
    assert conv.MARKER_SHAPE_RULE in conv.system_prompt()


def test_it_names_exactly_the_shapes_the_schema_draws():
    shapes = presentation_schema.MARKER_SHAPES
    assert set(conv.MARKER_SHAPE_WORDS) == set(shapes)
    assert f"in {len(shapes)} shapes only" in conv.MARKER_SHAPE_RULE
    for s in shapes:
        assert conv.MARKER_SHAPE_WORDS[s] in conv.MARKER_SHAPE_RULE, s


def test_it_says_to_tell_the_member_which_shape_and_that_the_asked_one_is_not_drawn():
    r = conv.MARKER_SHAPE_RULE
    assert "triangle" in r and "say in `reply` which shape it is drawn as" in r and "not drawn on this chart" in r
