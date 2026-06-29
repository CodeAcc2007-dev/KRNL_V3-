"""_to_event_response maps a DB row to EventResponse identically for all event endpoints."""
from app.api.v1.endpoints.events import _to_event_response

SAMPLE_ROW = {
    "id": 5,
    "user_id": "u1",
    "display_name": "Hackathon",
    "deadline": "2026-07-01",
    "venue": "LH101",
    "category": "Technical",
    "tags": "ai, ml",
    "interest_tags": ["hackathons"],
    "importance_score": 0.8,
    "raw_summary": "a summary",
    "full_body": "clean body",
    "raw_body": "<p>raw body</p>",
    "links": ["http://x"],
    "has_registration": True,
    "registration_link": "http://x",
    "created_at": "2026-06-01T00:00:00",
    "updated_at": "2026-06-02T00:00:00",
    "deadline_history": [],
    "last_update_type": None,
    "email_date": "2026-06-01T00:00:00",
}

VALID_URGENCY = {"expired", "today", "tomorrow", "this_week", "upcoming"}


def test_maps_core_fields_verbatim():
    r = _to_event_response(SAMPLE_ROW, [])
    assert r.id == 5
    assert r.user_id == "u1"
    assert r.display_name == "Hackathon"
    assert r.deadline == "2026-07-01"
    assert r.venue == "LH101"
    assert r.category == "Technical"
    assert r.tags == ["ai", "ml"]            # comma string -> list
    assert r.importance_score == 0.8
    assert r.full_body == "clean body"
    assert r.raw_body == "<p>raw body</p>"   # raw_body still carried (EmailDetail fallback)
    assert r.email_date == "2026-06-01T00:00:00"
    assert r.urgency_label in VALID_URGENCY


def test_priority_uses_interest_overlap():
    # importance 0.8 -> 80; one interest_tag match -> 0.4*80 + 0.6*60 = 68
    matched = _to_event_response(SAMPLE_ROW, ["hackathons"])
    assert matched.personalized_priority == 68.0
    # interests set but no overlap -> 0.4*80 = 32
    miss = _to_event_response(SAMPLE_ROW, ["finance"])
    assert miss.personalized_priority == 32.0
    # no interests selected -> importance only -> 80
    none = _to_event_response(SAMPLE_ROW, [])
    assert none.personalized_priority == 80.0
    assert matched.interest_tags == ["hackathons"]


def test_defaults_optional_fields():
    # display_name is always set on real rows (required by the schema);
    # absent optionals fall back to safe defaults.
    r = _to_event_response({"id": 1, "user_id": "u1", "display_name": "X"}, [])
    assert r.id == 1
    assert r.tags == []
    assert r.importance_score == 0.0
    assert r.deadline_history == []
