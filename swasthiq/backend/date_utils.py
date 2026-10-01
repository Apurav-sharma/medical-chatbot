"""
date_utils.py — Deterministic relative-date resolution.

All date resolution uses the `today` field from the API request.
NEVER calls datetime.now() — doing so would make the agent fail on
any day other than the day it was tested.
"""

from __future__ import annotations

import datetime
import re

# ---------------------------------------------------------------------------
# Hindi / Hinglish relative-date vocabulary
# ---------------------------------------------------------------------------

_WEEKDAY_NAMES: dict[str, int] = {
    # English
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
    # Hindi transliterated
    "somwar": 0, "mangalwar": 1, "budhwar": 2, "guruwar": 3,
    "brihaspativar": 3, "shukravar": 4, "shanivar": 5, "ravivar": 6,
    # Common short forms
    "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
    # English day names with Hindi suffix
    "shanivaar": 5, "somvaar": 0, "mangalvaar": 1, "budhvaar": 2,
    "guruvaar": 3, "shukravaar": 4, "ravivaar": 6,
}

_RELATIVE_DAY_OFFSETS: dict[str, int] = {
    "today": 0, "aaj": 0,
    "tomorrow": 1, "kal": 1,
    "day after tomorrow": 2, "parso": 2, "parson": 2,
}

# Hindi numbers for clock hours
_HINDI_NUMBERS: dict[str, int] = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "paanch": 5,
    "chhe": 6, "saat": 7, "aath": 8, "nau": 9, "das": 10,
    "gyarah": 11, "barah": 12, "terah": 13, "chaudah": 14,
    "pandrah": 15, "solah": 16, "satrah": 17, "atharah": 18,
    "unnees": 19, "bees": 20, "ikkees": 21, "baees": 22,
    "teis": 23,
}


def parse_date(text: str, today: datetime.date) -> datetime.date | None:
    """
    Try to extract a concrete date from `text` relative to `today`.

    Handles:
    - YYYY-MM-DD literals
    - "kal", "parso", "today/aaj", "tomorrow"
    - Weekday names (next occurrence on or after today)
    - "N tareekh" (Nth day of current/next month)

    Returns None if no date could be parsed.
    """
    text_l = text.lower().strip()

    # YYYY-MM-DD literal
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if m:
        try:
            return datetime.date.fromisoformat(m.group(1))
        except ValueError:
            pass

    # Relative offsets
    for key, offset in _RELATIVE_DAY_OFFSETS.items():
        if key in text_l:
            return today + datetime.timedelta(days=offset)

    # "N tareekh" — Nth of the month
    m = re.search(r"\b(\d{1,2})\s*(?:tareekh|taarikh|tarikh)\b", text_l)
    if m:
        day_num = int(m.group(1))
        candidate = _day_candidate(today, day_num)
        if candidate is None:
            return None
        if candidate < today:
            # Roll to next month
            candidate = _next_month_candidate(today, day_num)
            if candidate is None:
                return None
        return candidate

    # Pure number that looks like a day of month (1-31)
    # Only accept if accompanied by month context or alone after weekday fails
    m = re.search(r"\b(\d{1,2})\b", text_l)
    if m:
        day_num = int(m.group(1))
        if 1 <= day_num <= 31:
            try:
                candidate = _day_candidate(today, day_num)
                if candidate is None:
                    return None
                if candidate < today:
                    candidate = _next_month_candidate(today, day_num)
                    if candidate is None:
                        return None
                return candidate
            except ValueError:
                pass

    # Weekday name → next occurrence
    for name, weekday in sorted(_WEEKDAY_NAMES.items(), key=lambda x: -len(x[0])):
        if re.search(r"\b" + re.escape(name) + r"\b", text_l):
            days_ahead = (weekday - today.weekday()) % 7
            if days_ahead == 0:
                days_ahead = 7  # "next Monday" means next week's Monday
            return today + datetime.timedelta(days=days_ahead)

    return None


def _day_candidate(today: datetime.date, day_num: int) -> datetime.date | None:
    try:
        return today.replace(day=day_num)
    except ValueError:
        return None


def _next_month_candidate(today: datetime.date, day_num: int) -> datetime.date | None:
    year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    try:
        return datetime.date(year, month, day_num)
    except ValueError:
        return None


def parse_time(text: str) -> str | None:
    """
    Try to extract an HH:MM time from text.

    Handles:
    - HH:MM literals (09:30, 9:30)
    - "<number> baje" with Hindi number words
    - "<digit> baje" with numeric hours
    - AM/PM indicators

    Returns "HH:MM" string or None.
    """
    text_l = text.lower()

    # HH:MM literal
    m = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if m:
        h, mn = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mn <= 59:
            return f"{h:02d}:{mn:02d}"

    # Hindi number + baje
    for word, hour in _HINDI_NUMBERS.items():
        if re.search(r"\b" + re.escape(word) + r"\s*baje\b", text_l):
            # Apply AM/PM context heuristics
            if "subah" in text_l or "morning" in text_l:
                return f"{hour:02d}:00"
            if "shaam" in text_l or "evening" in text_l or "raat" in text_l or "night" in text_l:
                if hour < 12:
                    hour += 12
            # Default: morning for small hours, evening for >= 5 pm ambiguity
            # For 1-12 without context, use as-is (LLM may supply more context)
            return f"{hour:02d}:00"

    # Digit + baje
    m = re.search(r"\b(\d{1,2})\s*baje\b", text_l)
    if m:
        hour = int(m.group(1))
        if "subah" in text_l or "morning" in text_l:
            return f"{hour:02d}:00"
        if "shaam" in text_l or "evening" in text_l:
            if hour < 12:
                hour += 12
        if "raat" in text_l or "night" in text_l:
            if hour < 12:
                hour += 12
        return f"{hour:02d}:00"

    # AM/PM
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text_l)
    if m:
        h = int(m.group(1))
        mn = int(m.group(2)) if m.group(2) else 0
        if m.group(3) == "pm" and h != 12:
            h += 12
        elif m.group(3) == "am" and h == 12:
            h = 0
        return f"{h:02d}:{mn:02d}"

    return None


def resolve_date_from_turns(turns: list[str], today: datetime.date) -> datetime.date | None:
    """Scan all turns for a date, returning the first found."""
    combined = " ".join(turns)
    return parse_date(combined, today)


def resolve_time_from_turns(turns: list[str]) -> str | None:
    """Scan all turns for a time, returning the first found."""
    combined = " ".join(turns)
    return parse_time(combined)
