import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger("uvicorn.error")


def parse_deadline(value: Optional[str]) -> Optional[datetime]:
    """Parse a stored deadline string (date or datetime) into a datetime, else None."""
    if not value:
        return None
    s = str(value).replace("Z", "").replace("T", " ").split(".")[0].strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def should_apply_extension(current: Optional[str], new: Optional[str]) -> bool:
    """Forward-only guard: true only when both parse and `new` is strictly later."""
    c = parse_deadline(current)
    n = parse_deadline(new)
    if c is None or n is None:
        return False
    return n > c
