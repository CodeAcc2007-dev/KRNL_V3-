"""Tests for the email-dedup helpers used by the sync task (Phase 1)."""
from app.utils.dedup import get_message_id


class FakeMsg:
    def __init__(self, headers=None, uid=None):
        self.headers = headers or {}
        self.uid = uid


def test_uses_rfc_message_id_header_stripped_of_brackets():
    msg = FakeMsg(headers={"message-id": ("<abc123@iitb.ac.in>",)}, uid="42")
    assert get_message_id(msg) == "abc123@iitb.ac.in"


def test_header_lookup_is_case_insensitive():
    msg = FakeMsg(headers={"Message-ID": ("<XYZ@host>",)}, uid="7")
    assert get_message_id(msg) == "XYZ@host"


def test_falls_back_to_uid_when_no_message_id_header():
    msg = FakeMsg(headers={}, uid="99")
    assert get_message_id(msg) == "uid:99"


def test_falls_back_to_uid_when_header_value_empty():
    msg = FakeMsg(headers={"message-id": ("",)}, uid="13")
    assert get_message_id(msg) == "uid:13"


def test_handles_plain_string_header_value():
    msg = FakeMsg(headers={"message-id": "<plain@host>"}, uid="1")
    assert get_message_id(msg) == "plain@host"
