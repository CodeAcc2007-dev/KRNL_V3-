"""send_to_user: pref gating, delivery, and dead-subscription pruning."""
from types import SimpleNamespace
import app.services.push as push


class FakeQuery:
    def __init__(self, store, table):
        self.store, self.table, self._rows, self._del = store, table, list(store.get(table, [])), None
    def select(self, *a, **k):
        return self
    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val]
        self._eqcol, self._eqval = col, val
        return self
    def delete(self):
        self._del = True
        return self
    def execute(self):
        if self._del:
            self.store[self.table] = [r for r in self.store.get(self.table, [])
                                      if r.get(self._eqcol) != self._eqval]
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, store):
        self.store = store
    def table(self, name):
        return FakeQuery(self.store, name)


def _store(prefs, subs):
    return {
        "profiles": [{"id": "u1", "notification_prefs": prefs}],
        "push_subscriptions": subs,
    }


def test_master_off_sends_nothing(monkeypatch):
    sent = []
    monkeypatch.setattr(push, "_send_one", lambda s, p: sent.append(s))
    store = _store({"master": False, "important": True},
                   [{"id": 1, "user_id": "u1", "endpoint": "e1", "p256dh": "x", "auth": "y"}])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 0 and sent == []


def test_type_off_sends_nothing(monkeypatch):
    sent = []
    monkeypatch.setattr(push, "_send_one", lambda s, p: sent.append(s))
    store = _store({"master": True, "important": False},
                   [{"id": 1, "user_id": "u1", "endpoint": "e1", "p256dh": "x", "auth": "y"}])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 0 and sent == []


def test_no_vapid_key_sends_nothing(monkeypatch):
    monkeypatch.setattr(push.settings, "VAPID_PRIVATE_KEY", "")
    sent = []
    monkeypatch.setattr(push, "_send_one", lambda s, p: sent.append(s))
    store = _store({"master": True, "important": True},
                   [{"id": 1, "user_id": "u1", "endpoint": "e1", "p256dh": "x", "auth": "y"}])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 0 and sent == []


def test_sends_to_all_subscriptions(monkeypatch):
    sent = []
    monkeypatch.setattr(push, "_send_one", lambda s, p: sent.append(s["endpoint"]))
    store = _store({"master": True, "important": True}, [
        {"id": 1, "user_id": "u1", "endpoint": "e1", "p256dh": "x", "auth": "y"},
        {"id": 2, "user_id": "u1", "endpoint": "e2", "p256dh": "x", "auth": "y"},
    ])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 2 and set(sent) == {"e1", "e2"}


def test_dead_subscription_pruned_others_still_sent(monkeypatch):
    def fake_send(sub, payload):
        if sub["endpoint"] == "dead":
            raise push.WebPushException("gone", response=SimpleNamespace(status_code=410))
    monkeypatch.setattr(push, "_send_one", fake_send)
    store = _store({"master": True, "important": True}, [
        {"id": 1, "user_id": "u1", "endpoint": "dead", "p256dh": "x", "auth": "y"},
        {"id": 2, "user_id": "u1", "endpoint": "live", "p256dh": "x", "auth": "y"},
    ])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 1
    remaining = {r["endpoint"] for r in store["push_subscriptions"]}
    assert remaining == {"live"}
