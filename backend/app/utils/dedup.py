"""Pure helpers for deduplicating fetched emails (Phase 1).

Kept free of heavy/networked imports so the sync logic can be unit-tested
without pulling in Gemini/Qdrant/Supabase clients.
"""


def get_message_id(msg) -> str:
    """Return a stable identifier for an email.

    Prefers the RFC 5322 ``Message-ID`` header (globally unique, survives
    re-fetches), falling back to the IMAP ``uid`` when the header is missing.
    The returned value is used for the ``(user_id, message_id)`` dedup key.
    """
    headers = getattr(msg, "headers", None) or {}
    raw = headers.get("message-id") or headers.get("Message-ID")
    if isinstance(raw, (tuple, list)):
        raw = raw[0] if raw else ""
    mid = str(raw or "").strip().strip("<>").strip()
    if mid:
        return mid
    return f"uid:{getattr(msg, 'uid', '') or ''}"
