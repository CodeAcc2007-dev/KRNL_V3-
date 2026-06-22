from app.services.event_merge import parse_deadline, should_apply_extension
import types as pytypes
from unittest.mock import patch, MagicMock
from app.services import event_merge


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


def _qpoint(event_id):
    return pytypes.SimpleNamespace(payload={"event_id": str(event_id)})


def test_find_matching_returns_confirmed_active_event():
    # Qdrant returns candidate event_id 11; supabase returns it with a future deadline.
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value = \
        pytypes.SimpleNamespace(data=[{"id": 11, "display_name": "SSoC 2026", "deadline": "2999-01-01"}])
    with patch.object(event_merge, "generate_embeddings", return_value=[0.0] * 768), \
         patch.object(event_merge.qdrant_client, "query_points",
                      return_value=pytypes.SimpleNamespace(points=[_qpoint(11)])), \
         patch.object(event_merge, "confirm_same_event", return_value=True):
        match = event_merge.find_matching_event("user-1", "deadline extended", fake_sb)
    assert match is not None and match["id"] == 11


def test_find_matching_returns_none_when_llm_declines():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value = \
        pytypes.SimpleNamespace(data=[{"id": 11, "display_name": "SSoC 2026", "deadline": "2999-01-01"}])
    with patch.object(event_merge, "generate_embeddings", return_value=[0.0] * 768), \
         patch.object(event_merge.qdrant_client, "query_points",
                      return_value=pytypes.SimpleNamespace(points=[_qpoint(11)])), \
         patch.object(event_merge, "confirm_same_event", return_value=False):
        assert event_merge.find_matching_event("user-1", "x", fake_sb) is None


def test_find_matching_returns_none_when_no_candidates():
    fake_sb = MagicMock()
    with patch.object(event_merge, "generate_embeddings", return_value=[0.0] * 768), \
         patch.object(event_merge.qdrant_client, "query_points",
                      return_value=pytypes.SimpleNamespace(points=[])):
        assert event_merge.find_matching_event("user-1", "x", fake_sb) is None


def test_apply_extension_updates_event_and_appends_history():
    fake_sb = MagicMock()
    captured = {}

    def fake_update(payload):
        captured["payload"] = payload
        return MagicMock(eq=lambda *a, **k: MagicMock(execute=lambda: None))

    fake_sb.table.return_value.update.side_effect = fake_update
    event = {"id": 11, "deadline": "2026-06-10", "deadline_history": []}

    event_merge.apply_extension(event, "2026-06-20", "deadline_extension", "msg-1", fake_sb)

    p = captured["payload"]
    assert p["deadline"] == "2026-06-20"
    assert p["last_update_type"] == "deadline_extension"
    assert len(p["deadline_history"]) == 1
    assert p["deadline_history"][0]["old"] == "2026-06-10"
    assert p["deadline_history"][0]["new"] == "2026-06-20"
    assert p["deadline_history"][0]["message_id"] == "msg-1"
