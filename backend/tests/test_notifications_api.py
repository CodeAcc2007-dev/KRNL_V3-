"""Notifications endpoints: vapid key + subscribe/unsubscribe payload shaping."""
import pytest
from fastapi import HTTPException
import app.api.v1.endpoints.notifications as notif


def test_vapid_key_endpoint_returns_configured_key(monkeypatch):
    monkeypatch.setattr(notif.settings, "VAPID_PUBLIC_KEY", "PUBKEY123")
    assert notif.get_vapid_public_key(current_user={"user_id": "u1"}) == {"key": "PUBKEY123"}


def test_subscribe_shapes_row(monkeypatch):
    captured = {}
    class FakeTable:
        def upsert(self, data, **k):
            captured["row"] = data
            return self
        def execute(self):
            return type("R", (), {"data": [captured["row"]]})()
    monkeypatch.setattr(notif, "supabase", type("S", (), {"table": lambda self, n: FakeTable()})())
    body = {"endpoint": "https://push/x", "keys": {"p256dh": "AAA", "auth": "BBB"}}
    out = notif.subscribe(body, current_user={"user_id": "u1"})
    assert captured["row"]["user_id"] == "u1"
    assert captured["row"]["endpoint"] == "https://push/x"
    assert captured["row"]["p256dh"] == "AAA" and captured["row"]["auth"] == "BBB"
    assert out == {"status": "subscribed"}


def test_subscribe_missing_endpoint_400():
    with pytest.raises(HTTPException) as exc:
        notif.subscribe({"keys": {"p256dh": "AAA", "auth": "BBB"}}, current_user={"user_id": "u1"})
    assert exc.value.status_code == 400


def test_unsubscribe_deletes_by_endpoint(monkeypatch):
    captured = {}
    class FakeTable:
        def delete(self):
            captured["delete"] = True
            return self
        def eq(self, col, val):
            captured["eq"] = (col, val)
            return self
        def execute(self):
            return type("R", (), {"data": []})()
    monkeypatch.setattr(notif, "supabase", type("S", (), {"table": lambda self, n: FakeTable()})())
    out = notif.unsubscribe({"endpoint": "https://push/x"}, current_user={"user_id": "u1"})
    assert captured["delete"] is True
    assert captured["eq"] == ("endpoint", "https://push/x")
    assert out == {"status": "unsubscribed"}


def test_unsubscribe_missing_endpoint_400():
    with pytest.raises(HTTPException) as exc:
        notif.unsubscribe({}, current_user={"user_id": "u1"})
    assert exc.value.status_code == 400
