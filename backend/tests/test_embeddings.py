"""Tests for batched embedding generation (Phase 1: one API call per email)."""
import types as pytypes
from unittest.mock import patch

from app.services import ingestion


class FakeEmb:
    def __init__(self, values):
        self.values = values


def _resp(vectors):
    return pytypes.SimpleNamespace(embeddings=[FakeEmb(v) for v in vectors])


def test_empty_list_makes_no_api_call():
    with patch.object(ingestion.genai_client.models, "embed_content") as m:
        assert ingestion.generate_embeddings_batch([]) == []
        m.assert_not_called()


def test_batches_all_chunks_into_one_call_and_preserves_order():
    chunks = ["alpha", "beta", "gamma"]
    vecs = [[1.0] * 768, [2.0] * 768, [3.0] * 768]
    with patch.object(ingestion.genai_client.models, "embed_content", return_value=_resp(vecs)) as m:
        out = ingestion.generate_embeddings_batch(chunks)
        m.assert_called_once()
        # All chunks sent in a single call as a list.
        assert m.call_args.kwargs["contents"] == chunks
    assert out == vecs


def test_blank_entries_get_zero_vectors_and_are_not_sent():
    chunks = ["real", "   ", "also real"]
    vecs = [[1.0] * 768, [9.0] * 768]
    with patch.object(ingestion.genai_client.models, "embed_content", return_value=_resp(vecs)) as m:
        out = ingestion.generate_embeddings_batch(chunks)
        assert m.call_args.kwargs["contents"] == ["real", "also real"]
    assert out[0] == [1.0] * 768
    assert out[1] == [0.0] * 768
    assert out[2] == [9.0] * 768


def test_raises_on_response_size_mismatch():
    with patch.object(ingestion.genai_client.models, "embed_content", return_value=_resp([[1.0] * 768])):
        try:
            ingestion.generate_embeddings_batch(["a", "b"])
            assert False, "expected RuntimeError on size mismatch"
        except RuntimeError:
            pass
