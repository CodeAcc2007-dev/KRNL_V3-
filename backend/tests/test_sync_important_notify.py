from types import SimpleNamespace
import app.tasks.sync_task as st


class Recorder:
    def __init__(self): self.updated = []
    def table(self, name): self.name = name; return self
    def update(self, data): self.updated.append(data); return self
    def eq(self, *a, **k): return self
    def execute(self): return SimpleNamespace(data=[{}])


def test_important_event_notifies_and_stamps(monkeypatch):
    sent = []
    monkeypatch.setattr(st, "send_to_user", lambda c, uid, payload, kind: sent.append((uid, kind, payload)))
    rec = Recorder()
    row = {"id": 7, "user_id": "u1", "display_name": "Fee due", "raw_summary": "pay now",
           "importance_score": 90, "interest_tags": [], "notified_at": None}
    pushed = st.maybe_notify_important(rec, "u1", row, [])
    assert pushed is True
    assert sent and sent[0][1] == "important"
    assert rec.updated and "notified_at" in rec.updated[0]


def test_low_priority_event_does_not_notify(monkeypatch):
    sent = []
    monkeypatch.setattr(st, "send_to_user", lambda c, uid, payload, kind: sent.append(uid))
    rec = Recorder()
    row = {"id": 8, "user_id": "u1", "display_name": "Movie", "raw_summary": "fun",
           "importance_score": 10, "interest_tags": [], "notified_at": None}
    assert st.maybe_notify_important(rec, "u1", row, []) is False
    assert sent == []


def test_already_notified_event_skips(monkeypatch):
    sent = []
    monkeypatch.setattr(st, "send_to_user", lambda c, uid, payload, kind: sent.append(uid))
    rec = Recorder()
    row = {"id": 9, "user_id": "u1", "display_name": "Fee", "raw_summary": "x",
           "importance_score": 90, "interest_tags": [], "notified_at": "2026-06-30T00:00:00Z"}
    assert st.maybe_notify_important(rec, "u1", row, []) is False
    assert sent == []
