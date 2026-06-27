"""Tests for Ask KRNL source-set construction, rendering, and citations."""
from app.services.answer_context import (
    build_source_set, render_context, to_superscript, map_citations,
)


def _agenda(eid, name, deadline):
    return {"event_id": str(eid), "display_name": name, "deadline": deadline,
            "venue": "Room 1", "category": "Academic"}


def _rag(eid, name, text, links=None):
    return {"event_id": str(eid), "display_name": name, "text": text,
            "category": "General", "deadline": None, "venue": None,
            "links": links or [], "importance_score": 0.5}


def test_build_merges_rag_body_into_matching_agenda_event():
    agenda = [_agenda(5, "Quiz", "2026-06-30")]
    rag = [_rag(5, "Quiz", "Full body of quiz email", links=["http://x"])]
    sources = build_source_set(agenda, rag)
    assert len(sources) == 1
    s = sources[0]
    assert s["index"] == 1
    assert s["event_id"] == "5"
    assert s["body"] == "Full body of quiz email"
    assert s["links"] == ["http://x"]
    assert s["deadline"] == "2026-06-30"  # structured field preserved from agenda


def test_build_appends_rag_only_events_after_agenda():
    agenda = [_agenda(5, "Quiz", "2026-06-30")]
    rag = [_rag(9, "Policy", "Body about a policy")]
    sources = build_source_set(agenda, rag)
    assert [s["event_id"] for s in sources] == ["5", "9"]
    assert [s["index"] for s in sources] == [1, 2]


def test_build_caps_rag_only_extras():
    agenda = []
    rag = [_rag(i, f"E{i}", f"body {i}") for i in range(1, 9)]  # 8 RAG-only
    sources = build_source_set(agenda, rag, max_rag_extra=5)
    assert len(sources) == 5


def test_build_agenda_only_event_has_empty_body():
    sources = build_source_set([_agenda(5, "Quiz", "2026-06-30")], [])
    assert sources[0]["body"] == ""


def test_render_context_starts_with_today_anchor_and_lists_sources():
    sources = build_source_set([_agenda(5, "Quiz", "2026-06-30")], [])
    out = render_context(sources, "Sunday, 2026-06-28")
    assert out.startswith("Today is Sunday, 2026-06-28 (IST).")
    assert "[1]" in out
    assert "Quiz" in out
    assert "2026-06-30" in out


def test_to_superscript_multi_digit():
    assert to_superscript(1) == "¹"
    assert to_superscript(12) == "¹²"


def test_map_citations_resolves_agenda_only_event():
    sources = build_source_set([_agenda(5, "Quiz", "2026-06-30")], [])
    text, cites = map_citations("The quiz is on 2026-06-30 [1].", sources)
    assert "¹" in text and "[1]" not in text
    assert cites == [{"id": 1, "label": "Quiz", "event_id": 5}]


def test_map_citations_ignores_unreferenced_sources():
    sources = build_source_set(
        [_agenda(5, "Quiz", "2026-06-30"), _agenda(6, "Talk", "2026-07-01")], [])
    text, cites = map_citations("Only the quiz matters [1].", sources)
    assert [c["event_id"] for c in cites] == [5]
