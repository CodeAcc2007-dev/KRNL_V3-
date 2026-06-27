"""Vector chunks must collapse to one entry per event before fusion."""
from app.services.retrieval import dedupe_vector_docs


def test_keeps_first_chunk_per_event_in_order():
    docs = [("5", "chunk a"), ("5", "chunk b"), ("9", "chunk c")]
    assert dedupe_vector_docs(docs) == [("5", "chunk a"), ("9", "chunk c")]


def test_empty_input():
    assert dedupe_vector_docs([]) == []
