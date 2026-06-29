"""calculate_priority: relevance-led blend with importance-only fallback."""
from app.api.v1.endpoints.events import calculate_priority, IMPORTANT_THRESHOLD


def _ev(importance, interest_tags):
    return {"importance_score": importance, "interest_tags": interest_tags}


def test_no_user_interests_falls_back_to_importance():
    # importance 0.8 -> 80; no interests selected -> importance only
    assert calculate_priority(_ev(0.8, ["hackathons"]), []) == 80.0


def test_single_match_blends_60_relevance():
    # 0.4*80 + 0.6*60 = 68.0
    assert calculate_priority(_ev(0.8, ["hackathons"]), ["hackathons"]) == 68.0


def test_two_matches_max_relevance():
    # 0.4*80 + 0.6*100 = 92.0
    assert calculate_priority(_ev(0.8, ["hackathons", "sports"]),
                              ["hackathons", "sports"]) == 92.0


def test_interests_set_but_no_overlap():
    # relevance 0 -> 0.4*80 + 0 = 32.0  (NOT the importance-only fallback)
    assert calculate_priority(_ev(0.8, ["hackathons"]), ["finance"]) == 32.0


def test_already_scaled_importance_and_cap():
    # importance stored as 0-100 int; 2+ matches -> 0.4*100 + 0.6*100 = 100.0
    assert calculate_priority(_ev(100, ["a", "b"]), ["a", "b"]) == 100.0


def test_threshold_constant_is_60():
    assert IMPORTANT_THRESHOLD == 60.0
