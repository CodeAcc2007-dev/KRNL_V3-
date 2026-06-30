from types import SimpleNamespace
import app.tasks.notify_task as nt


class FakeQuery:
    def __init__(self, rows): self._rows = list(rows)
    def select(self, *a, **k): return self
    def eq(self, c, v): self._rows = [r for r in self._rows if r.get(c) == v]; return self
    def not_(self): return self
    def execute(self): return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, tables): self.tables = tables
    def table(self, name): return FakeQuery(self.tables.get(name, []))


def test_digest_sends_one_push_per_user(monkeypatch):
    sent = []
    monkeypatch.setattr(nt, "send_to_user", lambda c, uid, p, kind: sent.append((uid, kind)))
    tables = {
        "push_subscriptions": [{"user_id": "u1"}, {"user_id": "u2"}, {"user_id": "u1"}],
        "events": [],
    }
    monkeypatch.setattr(nt, "supabase_service", FakeSupabase(tables))
    out = nt.send_weekly_digest()
    assert out["users"] == 2
    assert {u for u, k in sent} == {"u1", "u2"}
    assert all(k == "digest" for _, k in sent)
