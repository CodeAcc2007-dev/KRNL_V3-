"""dispatch_all_syncs: Beat task enqueues one sync per connected account."""
from types import SimpleNamespace
import app.tasks.sync_task as st


class FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        return FakeQuery(list(self.rows))


class BrokenSupabase:
    def table(self, name):
        raise ConnectionError("db down")


def _capture_delay(monkeypatch):
    calls = []
    monkeypatch.setattr(st.run_email_sync, "delay", lambda uid, aid: calls.append((uid, aid)))
    return calls


def test_dispatches_one_sync_per_connected_account(monkeypatch):
    rows = [
        {"id": 1, "user_id": "u1", "connection_status": "connected"},
        {"id": 2, "user_id": "u2", "connection_status": "connected"},
        {"id": 3, "user_id": "u3", "connection_status": "disconnected"},
    ]
    monkeypatch.setattr(st, "supabase_service", FakeSupabase(rows))
    calls = _capture_delay(monkeypatch)

    result = st.dispatch_all_syncs()

    assert result["dispatched"] == 2
    assert calls == [("u1", 1), ("u2", 2)]


def test_no_connected_accounts_dispatches_nothing(monkeypatch):
    rows = [{"id": 1, "user_id": "u1", "connection_status": "disconnected"}]
    monkeypatch.setattr(st, "supabase_service", FakeSupabase(rows))
    calls = _capture_delay(monkeypatch)

    assert st.dispatch_all_syncs()["dispatched"] == 0
    assert calls == []


def test_dispatch_survives_db_error(monkeypatch):
    monkeypatch.setattr(st, "supabase_service", BrokenSupabase())
    calls = _capture_delay(monkeypatch)

    result = st.dispatch_all_syncs()

    assert result["dispatched"] == 0
    assert calls == []
