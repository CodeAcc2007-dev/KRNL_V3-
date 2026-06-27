"""Shared IST date helpers (UTC + 05:30, compared by calendar date)."""
from datetime import datetime, timezone, timedelta, date

IST_OFFSET = timedelta(hours=5, minutes=30)


def ist_today(now_utc: datetime | None = None) -> date:
    now_utc = now_utc or datetime.now(timezone.utc)
    return (now_utc + IST_OFFSET).date()


def today_anchor(now_utc: datetime | None = None) -> str:
    return ist_today(now_utc).strftime("%A, %Y-%m-%d")


def parse_deadline_date(deadline_str: str | None) -> date | None:
    if not deadline_str:
        return None
    clean = deadline_str.replace("Z", "").replace("T", " ").split(".")[0]
    try:
        return datetime.strptime(clean, "%Y-%m-%d %H:%M:%S").date()
    except Exception:
        try:
            return datetime.strptime(clean.split()[0], "%Y-%m-%d").date()
        except Exception:
            return None
