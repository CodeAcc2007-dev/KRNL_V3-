from app.services.event_merge import parse_deadline, should_apply_extension


def test_parse_handles_date_only_and_datetime_and_iso_t():
    assert parse_deadline("2026-06-20") is not None
    assert parse_deadline("2026-06-20 18:00:00") is not None
    assert parse_deadline("2026-06-20T18:00:00.123Z") is not None
    assert parse_deadline(None) is None
    assert parse_deadline("not a date") is None


def test_apply_only_when_new_is_strictly_later():
    assert should_apply_extension("2026-06-10", "2026-06-20") is True
    assert should_apply_extension("2026-06-20", "2026-06-10") is False
    assert should_apply_extension("2026-06-20", "2026-06-20") is False


def test_apply_false_when_either_side_unparseable_or_missing():
    assert should_apply_extension(None, "2026-06-20") is False
    assert should_apply_extension("2026-06-10", None) is False
    assert should_apply_extension("2026-06-10", "garbage") is False
