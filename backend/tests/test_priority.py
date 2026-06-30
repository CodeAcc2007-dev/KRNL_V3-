"""calculate_priority: boost-only blend (interests promote, never demote) + consequence floor."""
from app.api.v1.endpoints.events import (
    calculate_priority,
    _has_consequence,
    IMPORTANT_THRESHOLD,
)


def _ev(importance, interest_tags, display_name="", raw_summary=""):
    return {
        "importance_score": importance,
        "interest_tags": interest_tags,
        "display_name": display_name,
        "raw_summary": raw_summary,
    }


def test_no_user_interests_falls_back_to_importance():
    # importance 0.8 -> 80; no interests selected -> importance only
    assert calculate_priority(_ev(0.8, ["hackathons"]), []) == 80.0


def test_high_importance_not_demoted_by_missing_interest():
    # importance 80, interests set but no overlap: blend would be 32,
    # but max(80, 32) keeps it at its intrinsic importance.
    assert calculate_priority(_ev(0.8, ["hackathons"]), ["finance"]) == 80.0


def test_low_importance_promoted_by_two_matches():
    # importance 20, 2 matches -> blend 0.4*20 + 0.6*100 = 68 -> max(20, 68) = 68
    assert calculate_priority(_ev(0.2, ["hackathons", "sports"]),
                              ["hackathons", "sports"]) == 68.0


def test_single_match_below_importance_keeps_importance():
    # importance 80, 1 match -> blend 68 -> max(80, 68) = 80 (already important)
    assert calculate_priority(_ev(0.8, ["hackathons"]), ["hackathons"]) == 80.0


def test_priority_capped_at_100():
    assert calculate_priority(_ev(100, ["a", "b"]), ["a", "b"]) == 100.0


def test_threshold_constant_is_60():
    assert IMPORTANT_THRESHOLD == 60.0


# --- consequence floor ---

def test_consequence_floor_surfaces_low_rated_admin_mail():
    # extraction under-rated a fee notice (0.1); consequence floor -> >= 75
    ev = _ev(0.1, [], display_name="Hostel fee payment due", raw_summary="Pay before last date")
    assert calculate_priority(ev, ["finance"]) >= IMPORTANT_THRESHOLD
    assert calculate_priority(ev, []) >= 75.0


def test_consequence_floor_detects_account_signals():
    ev = _ev(0.0, [], display_name="Your account will be deactivated",
             raw_summary="Action required")
    assert _has_consequence(ev) is True
    assert calculate_priority(ev, []) >= 75.0


def test_benign_mail_not_floored():
    ev = _ev(0.2, [], display_name="Movie night this Friday", raw_summary="Come hang out")
    assert _has_consequence(ev) is False
    assert calculate_priority(ev, []) == 20.0
