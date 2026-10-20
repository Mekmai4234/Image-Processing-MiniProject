from datetime import datetime, timezone, timedelta
from typing import Optional
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

from app.core.config import settings


def get_app_timezone():
    """Return timezone object for settings.APP_TIMEZONE with UTC+7 fallback."""
    tz_name = settings.APP_TIMEZONE
    try:
        if ZoneInfo:
            return ZoneInfo(tz_name)
    except Exception:
        pass
    # Asia/Bangkok is UTC+7
    if tz_name == "Asia/Bangkok":
        return timezone(timedelta(hours=7))
    return timezone.utc


def utc_now() -> datetime:
    """Current UTC datetime."""
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 string ending with Z."""
    return utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso_to_utc(iso_str: str) -> datetime:
    """Parse ISO-8601 timestamp string into UTC datetime."""
    if iso_str.endswith("Z"):
        iso_str = iso_str[:-1] + "+00:00"
    dt = datetime.fromisoformat(iso_str)
    return dt.astimezone(timezone.utc)


def get_folder_date(dt_utc: Optional[datetime] = None) -> str:
    """
    Format date as YYYY-MM-DD in APP_TIMEZONE (Asia/Bangkok).
    Used for storage folder organization.
    """
    if dt_utc is None:
        dt_utc = utc_now()
    app_tz = get_app_timezone()
    local_dt = dt_utc.astimezone(app_tz)
    return local_dt.strftime("%Y-%m-%d")
