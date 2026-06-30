from types import SimpleNamespace
from datetime import datetime, timedelta
import app.tasks.notify_task as nt


class FakeQuery:
    def __init__(self, rows, store):
        self._rows, self.store, self._upd = list(rows), store, None
    def select(self, *a, **k): return self
    def eq(self, c, v): self._rows = [r for r in self._rows if r.get(c) == v]; return self
    @property
    def not_(self): return self
    def is_(self, c, v):
        # Only "null" is used here: keep rows whose column is NOT null.
        self._rows = [r for r in self._rows if r.get(c) is not None]
        return self
    def update(self, data): self._upd = data; return self
    def execute(self):
        if self._upd is not None:
            self.store.updates.append(self._upd)
        return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, rows): self.rows, self.updates = rows, []
    def table(self, name): return FakeQuery(self.rows, self)


def _ev(id, hours, reminded, deadline="__auto__"):
    if deadline == "__auto__":
        # Stored deadlines are naive IST wall-clock (no offset suffix).
        dl = (datetime.now(nt.IST) + timedelta(hours=hours)).replace(tzinfo=None).isoformat(sep=" ")
    else:
        dl = deadline
    return {"id": id, "user_id": "u1", "display_name": "X", "deadline": dl,
            "deadline_reminded": reminded}


def test_reminds_events_within_24h(monkeypatch):
    sent = []
    monkeypatch.setattr(nt, "send_to_user", lambda c, uid, p, kind: sent.append((id(c), kind)))
    # event 1 (10h) and event 2 (20h IST) are both inside the 24h window; under the
    # old UTC-misinterpretation the 20h one read as 25.5h and was wrongly skipped.
    # event 3 (30h) is outside; event 4 already reminded; event 5 has no deadline.
    rows = [
        _ev(1, 10, False),
        _ev(2, 20, False),
        _ev(3, 30, False),
        _ev(4, 5, True),
        _ev(5, 10, False, deadline=None),
    ]
    fake = FakeSupabase(rows)
    monkeypatch.setattr(nt, "supabase_service", fake)
    out = nt.send_due_reminders()
    assert out["reminded"] == 2  # events 1 and 2
    assert all(kind == "reminders" for _, kind in sent)
    assert fake.updates == [{"deadline_reminded": True}, {"deadline_reminded": True}]
