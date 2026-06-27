"""Tests for the structured upcoming-deadline agenda used by Ask KRNL."""
from datetime import date
from app.services.retrieval import _select_upcoming


def _row(id, name, deadline, venue="V", category="General"):
    return {"id": id, "display_name": name, "deadline": deadline,
            "venue": venue, "category": category}


def test_drops_deadlines_before_grace_window():
    today = date(2026, 6, 28)
    rows = [
        _row(1, "Past", "2026-06-25"),       # 3 days past -> dropped (grace 1)
        _row(2, "Future", "2026-07-01"),     # kept
    ]
    out = _select_upcoming(rows, today, grace_days=1)
    names = [o["display_name"] for o in out]
    assert names == ["Future"]


def test_keeps_yesterday_within_grace():
    today = date(2026, 6, 28)
    rows = [_row(1, "Yesterday", "2026-06-27")]
    out = _select_upcoming(rows, today, grace_days=1)
    assert [o["display_name"] for o in out] == ["Yesterday"]


def test_sorts_ascending_by_deadline():
    today = date(2026, 6, 28)
    rows = [
        _row(1, "Later", "2026-07-10"),
        _row(2, "Sooner", "2026-06-30"),
    ]
    out = _select_upcoming(rows, today, grace_days=1)
    assert [o["display_name"] for o in out] == ["Sooner", "Later"]


def test_maps_compact_shape_with_string_event_id():
    today = date(2026, 6, 28)
    out = _select_upcoming([_row(7, "X", "2026-06-30", venue="Room 1",
                                 category="Academic")], today)
    assert out[0] == {"event_id": "7", "display_name": "X",
                      "deadline": "2026-06-30", "venue": "Room 1",
                      "category": "Academic"}


def test_skips_rows_with_unparseable_deadline():
    today = date(2026, 6, 28)
    rows = [_row(1, "Bad", "garbage"), _row(2, "Good", "2026-06-30")]
    out = _select_upcoming(rows, today)
    assert [o["display_name"] for o in out] == ["Good"]
