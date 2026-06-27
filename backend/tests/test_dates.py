"""Tests for IST date helpers shared by Ask KRNL retrieval/answering."""
from datetime import datetime, timezone, date
from app.utils.dates import ist_today, today_anchor, parse_deadline_date


def test_ist_today_rolls_forward_past_utc_evening():
    # 2026-06-27 19:00 UTC -> 00:30 IST next day
    assert ist_today(datetime(2026, 6, 27, 19, 0, tzinfo=timezone.utc)) == date(2026, 6, 28)


def test_ist_today_stays_same_day_before_boundary():
    # 2026-06-27 18:00 UTC -> 23:30 IST same day
    assert ist_today(datetime(2026, 6, 27, 18, 0, tzinfo=timezone.utc)) == date(2026, 6, 27)


def test_today_anchor_formats_weekday_and_date():
    assert today_anchor(datetime(2026, 6, 27, 19, 0, tzinfo=timezone.utc)) == "Sunday, 2026-06-28"


def test_parse_deadline_date_handles_date_only():
    assert parse_deadline_date("2026-06-25") == date(2026, 6, 25)


def test_parse_deadline_date_handles_timestamp_variants():
    assert parse_deadline_date("2026-06-25 14:30:00") == date(2026, 6, 25)
    assert parse_deadline_date("2026-06-25T14:30:00Z") == date(2026, 6, 25)
    assert parse_deadline_date("2026-06-25 14:30:00.123") == date(2026, 6, 25)


def test_parse_deadline_date_returns_none_on_bad_input():
    assert parse_deadline_date(None) is None
    assert parse_deadline_date("") is None
    assert parse_deadline_date("not a date") is None
