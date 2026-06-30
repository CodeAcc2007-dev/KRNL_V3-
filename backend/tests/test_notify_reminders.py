from types import SimpleNamespace
from datetime import datetime, timezone, timedelta
import app.tasks.notify_task as nt


class FakeQuery:
    def __init__(self, rows, store): self._rows, self.store, self._upd = list(rows), store, None
    def select(self, *a, **k): return self
    def eq(self, c, v): self._rows = [r for r in self._rows if r.get(c) == v]; return self
    def update(self, data): self._upd = data; return self
    def execute(self): return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, rows): self.rows = rows
    def table(self, name): return FakeQuery(self.rows, self)


def _ev(id, hours, reminded):
    dl = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    return {"id": id, "user_id": "u1", "display_name": "X", "deadline": dl,
            "deadline_reminded": reminded}


def test_reminds_events_within_24h(monkeypatch):
    sent = []
    monkeypatch.setattr(nt, "send_to_user", lambda c, uid, p, kind: sent.append((id(c), kind)))
    rows = [_ev(1, 10, False), _ev(2, 40, False), _ev(3, 5, True)]
    monkeypatch.setattr(nt, "supabase_service", FakeSupabase(rows))
    out = nt.send_due_reminders()
    assert out["reminded"] == 1  # only event 1 (within 24h, not yet reminded)
    assert sent and sent[0][1] == "reminders"
