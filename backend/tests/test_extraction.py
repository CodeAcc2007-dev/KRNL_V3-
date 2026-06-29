"""Tests for the extraction schema additions (Phase 1: is_update/update_type)."""
from unittest.mock import patch

from app.services import ingestion


def test_model_exposes_update_signals():
    fields = ingestion.EmailExtractionModel.model_fields
    assert "is_update" in fields
    assert "update_type" in fields


def test_fallback_extraction_includes_update_keys():
    # Force the Gemini call to fail so we exercise the fallback dict.
    with patch.object(ingestion.genai_client.models, "generate_content", side_effect=RuntimeError("boom")):
        out = ingestion.extract_event_intelligence("subj", "body", "2026-06-22")
    assert out["is_update"] is False
    assert out["update_type"] is None


def test_model_exposes_interest_tags():
    assert "interest_tags" in ingestion.EmailExtractionModel.model_fields


def test_fallback_extraction_includes_interest_tags():
    with patch.object(ingestion.genai_client.models, "generate_content", side_effect=RuntimeError("boom")):
        out = ingestion.extract_event_intelligence("subj", "body", "2026-06-22")
    assert out["interest_tags"] == []


def test_normalize_interest_tags_maps_to_slugs_and_drops_unknown():
    lookup = {"hackathons": "hackathons", "research & projects": "research-projects"}
    out = ingestion.normalize_interest_tags(
        ["Hackathons", "Research & Projects", "Quidditch", "hackathons"], lookup)
    assert out == ["hackathons", "research-projects"]  # mapped, deduped, unknown dropped
