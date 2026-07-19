from tools.theme_curation import proposals as P


def test_parse_valid_and_reject_noncap():
    raw = {"proposals": [
        {"action": "add", "sym": "SNDK", "tier": "core", "sub_theme_id": None,
         "rationale": "memory", "confidence": 0.9},
        {"action": "add", "sym": "FAKE", "tier": "core", "confidence": 0.5},   # not in cap -> rejected
        {"action": "drop", "sym": "AUY", "reason": "acquired", "confidence": 0.8},
        {"action": "remap", "sym": "SQ", "new_sym": "XYZ", "confidence": 0.7},
        {"action": "retier", "sym": "RKLB", "new_tier": "core", "confidence": 0.6},
        {"action": "bogus", "sym": "Z", "confidence": 1.0},                    # unknown -> rejected
    ]}
    cap = {"SNDK", "AUY", "SQ", "XYZ", "RKLB"}
    props, rejects = P.parse_llm_proposals("mem", raw, cap)
    kinds = {(p.action, p.sym) for p in props}
    assert ("add", "SNDK") in kinds and ("drop", "AUY") in kinds
    assert ("remap", "SQ") in kinds and ("retier", "RKLB") in kinds
    assert ("add", "FAKE") not in kinds and not any(p.action == "bogus" for p in props)
    assert len(rejects) == 2
    assert P.pid(next(p for p in props if p.sym == "SNDK")) == "mem::SNDK::add"


def test_remap_new_sym_must_be_chartable():
    raw = {"proposals": [{"action": "remap", "sym": "OLD", "new_sym": "GONE", "confidence": 0.9}]}
    props, rejects = P.parse_llm_proposals("t", raw, {"OLD"})   # GONE not in cap
    assert props == [] and len(rejects) == 1
