"""
tools.py — The six clinic front-desk tools.

CRITICAL DESIGN RULE:
  - This layer never calls an LLM.
  - This layer is the single source of truth.
  - Every mutation goes through a database transaction.
  - The LLM may propose tool arguments; this layer decides whether they are valid.

Tools:
  1. search_slots
  2. book_appointment
  3. reschedule_appointment
  4. cancel_appointment
  5. lookup_patient
  6. escalate_to_human
"""

from __future__ import annotations

import datetime
import difflib
import re
import sqlite3
from typing import Any

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_DAY_ABBREV = {
    "Monday": "Mon", "Tuesday": "Tue", "Wednesday": "Wed",
    "Thursday": "Thu", "Friday": "Fri", "Saturday": "Sat", "Sunday": "Sun",
}


def _date_obj(date_str: str) -> datetime.date:
    """Parse YYYY-MM-DD; raise ValueError with clear message on failure."""
    try:
        return datetime.date.fromisoformat(date_str)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid date '{date_str}'. Expected YYYY-MM-DD.")


def _time_obj(time_str: str) -> datetime.time:
    """Parse HH:MM; raise ValueError with clear message on failure."""
    try:
        h, m = time_str.split(":")
        return datetime.time(int(h), int(m))
    except Exception:
        raise ValueError(f"Invalid time '{time_str}'. Expected HH:MM.")


def _day_abbrev(date: datetime.date) -> str:
    return date.strftime("%a")  # Mon, Tue, ...


def _add_minutes(t: datetime.time, minutes: int) -> datetime.time:
    dt = datetime.datetime.combine(datetime.date.today(), t)
    dt += datetime.timedelta(minutes=minutes)
    return dt.time()


def _slot_minutes(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM clinic_meta WHERE key='slot_minutes'").fetchone()
    return int(row["value"]) if row else 15


def _is_holiday(conn: sqlite3.Connection, date_str: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM holidays WHERE holiday_date=?", (date_str,)
    ).fetchone() is not None


def _is_doctor_on_leave(conn: sqlite3.Connection, doctor_id: str, date_str: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM doctor_leave WHERE doctor_id=? AND leave_date=?",
        (doctor_id, date_str),
    ).fetchone() is not None


def _get_windows(conn: sqlite3.Connection, doctor_id: str, day: str) -> list[dict]:
    """Return doctor's working windows for a given day abbreviation."""
    rows = conn.execute(
        "SELECT start_time, end_time FROM doctor_windows WHERE doctor_id=? AND day=?",
        (doctor_id, day),
    ).fetchall()
    return [{"start": r["start_time"], "end": r["end_time"]} for r in rows]


def _generate_slots(windows: list[dict], slot_minutes: int) -> list[str]:
    """
    Generate HH:MM slot start times from working windows.
    Overlapping windows are merged so slots are not duplicated.
    """
    if not windows:
        return []

    # Convert windows to intervals
    intervals = []
    for w in windows:
        s = _time_obj(w["start"])
        e = _time_obj(w["end"])
        intervals.append((s, e))

    # Merge overlapping intervals
    intervals.sort(key=lambda x: x[0])
    merged = [intervals[0]]
    for s, e in intervals[1:]:
        ls, le = merged[-1]
        if s <= le:
            merged[-1] = (ls, max(le, e))
        else:
            merged.append((s, e))

    slots = []
    for start, end in merged:
        current = start
        while True:
            next_t = _add_minutes(current, slot_minutes)
            # Slot must fully fit inside the window
            if next_t > end:
                break
            slots.append(current.strftime("%H:%M"))
            current = next_t

    return slots


def _booked_starts(conn: sqlite3.Connection, doctor_id: str, date_str: str) -> set[str]:
    rows = conn.execute(
        "SELECT start_time FROM appointments WHERE doctor_id=? AND date=? AND status='booked'",
        (doctor_id, date_str),
    ).fetchall()
    return {r["start_time"] for r in rows}


# ---------------------------------------------------------------------------
# Public tool functions — called by the dispatcher, never by the LLM directly
# ---------------------------------------------------------------------------


def search_slots(
    conn: sqlite3.Connection,
    *,
    doctor_id: str,
    date: str,
) -> dict:
    """
    Return available (unbooked) slots for a doctor on a date.

    Returns:
      {"status": "ok", "slots": ["09:00", "09:15", ...]}
      {"status": "error", "code": "...", "message": "..."}
    """
    # --- Validate doctor ---
    doc = conn.execute("SELECT id, name FROM doctors WHERE id=?", (doctor_id,)).fetchone()
    if doc is None:
        return {"status": "error", "code": "unknown_doctor",
                "message": f"No doctor with id '{doctor_id}'."}

    # --- Validate date ---
    try:
        date_obj = _date_obj(date)
    except ValueError as e:
        return {"status": "error", "code": "invalid_date", "message": str(e)}

    # --- Check holiday ---
    if _is_holiday(conn, date):
        return {"status": "ok", "slots": [], "note": "clinic_holiday",
                "message": f"The clinic is closed on {date} (public holiday)."}

    # --- Check doctor leave ---
    if _is_doctor_on_leave(conn, doctor_id, date):
        return {"status": "ok", "slots": [], "note": "doctor_on_leave",
                "message": f"{doc['name']} is on leave on {date}."}

    # --- Check day schedule ---
    day = _day_abbrev(date_obj)
    windows = _get_windows(conn, doctor_id, day)
    if not windows:
        return {"status": "ok", "slots": [], "note": "no_schedule",
                "message": f"{doc['name']} does not work on {day}s."}

    # --- Generate and filter slots ---
    slot_min = _slot_minutes(conn)
    all_slots = _generate_slots(windows, slot_min)
    booked = _booked_starts(conn, doctor_id, date)
    free = [s for s in all_slots if s not in booked]

    return {
        "status": "ok",
        "doctor_id": doctor_id,
        "doctor_name": doc["name"],
        "date": date,
        "slots": free,
    }


def book_appointment(
    conn: sqlite3.Connection,
    *,
    patient_id: str,
    doctor_id: str,
    date: str,
    start: str,
) -> dict:
    """
    Create a new appointment atomically.

    The UNIQUE constraint on (doctor_id, date, start_time) prevents double-booking
    even under concurrent requests.

    Returns:
      {"status": "ok", "appointment_id": "ap_NNNN", ...}
      {"status": "error", "code": "...", "message": "..."}
    """
    # --- Validate patient ---
    pt = conn.execute("SELECT id, name FROM patients WHERE id=?", (patient_id,)).fetchone()
    if pt is None:
        return {"status": "error", "code": "unknown_patient",
                "message": f"No patient with id '{patient_id}'."}

    # --- Validate doctor ---
    doc = conn.execute("SELECT id, name FROM doctors WHERE id=?", (doctor_id,)).fetchone()
    if doc is None:
        return {"status": "error", "code": "unknown_doctor",
                "message": f"No doctor with id '{doctor_id}'."}

    # --- Validate date ---
    try:
        date_obj = _date_obj(date)
    except ValueError as e:
        return {"status": "error", "code": "invalid_date", "message": str(e)}

    # --- Validate start time ---
    try:
        start_t = _time_obj(start)
    except ValueError as e:
        return {"status": "error", "code": "invalid_time", "message": str(e)}

    # --- Check holiday ---
    if _is_holiday(conn, date):
        return {"status": "error", "code": "clinic_closed",
                "message": f"Clinic is closed on {date} (public holiday)."}

    # --- Check doctor leave ---
    if _is_doctor_on_leave(conn, doctor_id, date):
        return {"status": "error", "code": "doctor_on_leave",
                "message": f"{doc['name']} is on leave on {date}."}

    # --- Validate slot is in doctor's schedule ---
    day = _day_abbrev(date_obj)
    windows = _get_windows(conn, doctor_id, day)
    if not windows:
        return {"status": "error", "code": "no_schedule",
                "message": f"{doc['name']} does not work on {day}s."}

    slot_min = _slot_minutes(conn)
    all_slots = _generate_slots(windows, slot_min)
    if start not in all_slots:
        return {"status": "error", "code": "slot_not_in_schedule",
                "message": f"Slot {start} is not part of {doc['name']}'s schedule on {date}."}

    # --- Compute end time ---
    end_t = _add_minutes(start_t, slot_min)
    end_str = end_t.strftime("%H:%M")

    # --- Atomic insert — UNIQUE constraint blocks duplicates ---
    from db import next_appointment_id
    ap_id = next_appointment_id(conn)

    try:
        conn.execute(
            """INSERT INTO appointments (id, patient_id, doctor_id, date, start_time, end_time, status)
               VALUES (?,?,?,?,?,?,'booked')""",
            (ap_id, patient_id, doctor_id, date, start, end_str),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        # UNIQUE violation — slot already taken
        return {"status": "error", "code": "slot_taken",
                "message": f"Slot {start} on {date} with {doc['name']} is already booked."}

    return {
        "status": "ok",
        "appointment_id": ap_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "date": date,
        "start": start,
        "end": end_str,
    }


def reschedule_appointment(
    conn: sqlite3.Connection,
    *,
    appointment_id: str,
    new_date: str,
    new_start: str,
) -> dict:
    """
    Atomically move an existing appointment to a new slot.

    Uses a single UPDATE within a transaction so the old appointment
    is never deleted before the new slot is confirmed.

    Returns:
      {"status": "ok", "appointment_id": ..., ...}
      {"status": "error", "code": "...", "message": "..."}
    """
    # --- Validate appointment exists and is booked ---
    ap = conn.execute(
        "SELECT * FROM appointments WHERE id=?", (appointment_id,)
    ).fetchone()
    if ap is None:
        return {"status": "error", "code": "unknown_appointment",
                "message": f"No appointment with id '{appointment_id}'."}
    if ap["status"] != "booked":
        return {"status": "error", "code": "appointment_not_active",
                "message": f"Appointment '{appointment_id}' has status '{ap['status']}', cannot reschedule."}

    doctor_id = ap["doctor_id"]
    patient_id = ap["patient_id"]

    # --- Validate new date ---
    try:
        new_date_obj = _date_obj(new_date)
    except ValueError as e:
        return {"status": "error", "code": "invalid_date", "message": str(e)}

    # --- Validate new start time ---
    try:
        new_start_t = _time_obj(new_start)
    except ValueError as e:
        return {"status": "error", "code": "invalid_time", "message": str(e)}

    # --- Check same slot (no-op guard) ---
    if new_date == ap["date"] and new_start == ap["start_time"]:
        return {"status": "error", "code": "same_slot",
                "message": "New slot is the same as the current slot."}

    doc = conn.execute("SELECT name FROM doctors WHERE id=?", (doctor_id,)).fetchone()

    # --- Check holiday ---
    if _is_holiday(conn, new_date):
        return {"status": "error", "code": "clinic_closed",
                "message": f"Clinic is closed on {new_date} (public holiday)."}

    # --- Check doctor leave ---
    if _is_doctor_on_leave(conn, doctor_id, new_date):
        return {"status": "error", "code": "doctor_on_leave",
                "message": f"{doc['name']} is on leave on {new_date}."}

    # --- Validate slot in doctor schedule ---
    day = _day_abbrev(new_date_obj)
    windows = _get_windows(conn, doctor_id, day)
    if not windows:
        return {"status": "error", "code": "no_schedule",
                "message": f"{doc['name']} does not work on {day}s."}

    slot_min = _slot_minutes(conn)
    all_slots = _generate_slots(windows, slot_min)
    if new_start not in all_slots:
        return {"status": "error", "code": "slot_not_in_schedule",
                "message": f"Slot {new_start} is not part of {doc['name']}'s schedule on {new_date}."}

    new_end_t = _add_minutes(new_start_t, slot_min)
    new_end_str = new_end_t.strftime("%H:%M")

    # --- Atomic update within transaction ---
    # We UPDATE the existing row rather than delete+insert.
    # If the target slot is already booked, the UNIQUE constraint fires on UPDATE.
    try:
        conn.execute(
            """UPDATE appointments
               SET date=?, start_time=?, end_time=?
               WHERE id=?""",
            (new_date, new_start, new_end_str, appointment_id),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        return {"status": "error", "code": "slot_taken",
                "message": f"Slot {new_start} on {new_date} with {doc['name']} is already booked. "
                           "Your original appointment is unchanged."}

    return {
        "status": "ok",
        "appointment_id": appointment_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "old_date": ap["date"],
        "old_start": ap["start_time"],
        "new_date": new_date,
        "new_start": new_start,
        "new_end": new_end_str,
    }


def cancel_appointment(
    conn: sqlite3.Connection,
    *,
    appointment_id: str,
) -> dict:
    """
    Cancel a booked appointment.

    Returns:
      {"status": "ok", "appointment_id": ..., ...}
      {"status": "error", "code": "...", "message": "..."}
    """
    ap = conn.execute(
        "SELECT * FROM appointments WHERE id=?", (appointment_id,)
    ).fetchone()
    if ap is None:
        return {"status": "error", "code": "unknown_appointment",
                "message": f"No appointment with id '{appointment_id}'."}
    if ap["status"] != "booked":
        return {"status": "error", "code": "already_cancelled",
                "message": f"Appointment '{appointment_id}' is already cancelled."}

    conn.execute(
        "UPDATE appointments SET status='cancelled' WHERE id=?", (appointment_id,)
    )
    conn.commit()

    return {
        "status": "ok",
        "appointment_id": appointment_id,
        "patient_id": ap["patient_id"],
        "doctor_id": ap["doctor_id"],
        "date": ap["date"],
        "start": ap["start_time"],
        "new_status": "cancelled",
    }


def lookup_patient(
    conn: sqlite3.Connection,
    *,
    name: str | None = None,
    phone: str | None = None,
    dob: str | None = None,
) -> dict:
    """
    Resolve a caller to patient record(s).

    NEVER guesses between multiple matches — returns all candidates.
    The agent must then ask for more details or escalate.

    Returns:
      {"status": "found",    "patient": {...}}             — exactly one match
      {"status": "ambiguous","candidates": [...]}          — multiple matches
      {"status": "not_found","message": "..."}             — zero matches
      {"status": "error",    "code": "...", "message": "..."}
    """
    if not name and not phone and not dob:
        return {"status": "error", "code": "no_criteria",
                "message": "At least one of name, phone, or dob is required."}

    conditions = []
    params: list[Any] = []

    if phone:
        # Phone is strong — exact match first
        phone_clean = phone.strip().replace(" ", "").replace("-", "")
        conditions.append("REPLACE(REPLACE(phone,' ',''),'-','') = ?")
        params.append(phone_clean)

    if name:
        # Case-insensitive partial name match
        conditions.append("LOWER(name) LIKE ?")
        params.append(f"%{name.lower()}%")

    if dob:
        conditions.append("dob = ?")
        params.append(dob)

    # Build query: phone is AND'd with other criteria if present; otherwise
    # we fall back to name/dob alone.
    if len(conditions) == 1:
        where = conditions[0]
    else:
        # AND all conditions together for strict matching
        where = " AND ".join(conditions)

    sql = f"SELECT id, name, phone, dob FROM patients WHERE {where}"
    rows = conn.execute(sql, params).fetchall()

    # If phone+name combination yields nothing, try phone alone (caller may give
    # a name that doesn't exactly match the file, e.g. "Sharma ji")
    if len(rows) == 0 and phone and name:
        rows = conn.execute(
            "SELECT id, name, phone, dob FROM patients WHERE REPLACE(REPLACE(phone,' ',''),'-','') = ?",
            [phone.strip().replace(" ", "").replace("-", "")],
        ).fetchall()

    if len(rows) == 0:
        # Try name-only fallback if phone+name combo failed
        if name and phone:
            pass  # already tried phone-only above
        elif name and not phone:
            pass  # already tried name-only

        # Final attempt: if name given without phone, try exact name match
        if len(rows) == 0 and name and not phone:
            rows = conn.execute(
                "SELECT id, name, phone, dob FROM patients WHERE LOWER(name) LIKE ?",
                [f"%{name.lower()}%"],
            ).fetchall()

        if len(rows) == 0:
            return {"status": "not_found",
                    "message": "No patient matched the provided information."}

    # A short name may have a close spelling variant in the clinic records
    # (for example, Imran / Imraan). Surface all such candidates instead of
    # treating a partial substring hit as a unique identity. Phone or DOB
    # criteria remain authoritative and are not widened.
    if name and not phone and not dob and len(rows) == 1:
        name_tokens = re.findall(r"[a-z]+", name.lower())
        if len(name_tokens) == 1:
            all_rows = conn.execute(
                "SELECT id, name, phone, dob FROM patients ORDER BY id"
            ).fetchall()
            query = name_tokens[0]
            near_ids = set()
            for row in all_rows:
                for token in re.findall(r"[a-z]+", row["name"].lower()):
                    if token != query and difflib.SequenceMatcher(None, query, token).ratio() >= 0.82:
                        near_ids.add(row["id"])
            if near_ids:
                rows = list(rows) + [r for r in all_rows if r["id"] in near_ids]

    candidates = [
        {"id": r["id"], "name": r["name"], "phone": r["phone"], "dob": r["dob"]}
        for r in rows
    ]

    if len(candidates) == 1:
        return {"status": "found", "patient": candidates[0]}

    return {"status": "ambiguous", "candidates": candidates}


def lookup_patient_by_id(conn: sqlite3.Connection, patient_id: str) -> dict | None:
    """Return a patient dict by exact ID, or None."""
    row = conn.execute(
        "SELECT id, name, phone, dob FROM patients WHERE id=?", (patient_id,)
    ).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "name": row["name"], "phone": row["phone"], "dob": row["dob"]}


def get_patient_appointments(
    conn: sqlite3.Connection,
    patient_id: str,
    date: str | None = None,
) -> list[dict]:
    """Return all booked appointments for a patient, optionally filtered by date."""
    if date:
        rows = conn.execute(
            "SELECT * FROM appointments WHERE patient_id=? AND date=? AND status='booked'",
            (patient_id, date),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM appointments WHERE patient_id=? AND status='booked' ORDER BY date, start_time",
            (patient_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def is_guardian_of(conn: sqlite3.Connection, guardian_id: str, ward_id: str) -> bool:
    """Check if guardian_id is an authorized guardian for ward_id."""
    return conn.execute(
        "SELECT 1 FROM guardians WHERE guardian_id=? AND ward_id=?",
        (guardian_id, ward_id),
    ).fetchone() is not None


def escalate_to_human(
    conn: sqlite3.Connection,
    *,
    reason: str,
    conversation_id: str,
    summary: str,
    patient_id: str | None = None,
    appointment_id: str | None = None,
) -> dict:
    """
    Record a handoff to a human agent.

    Valid reasons: clinical_urgent, medical_advice, not_authorised,
                   ambiguous_patient, out_of_scope

    Returns:
      {"status": "ok", "escalation_reason": reason, ...}
      {"status": "error", "code": "invalid_reason", "message": "..."}
    """
    valid_reasons = {
        "clinical_urgent", "medical_advice", "not_authorised",
        "ambiguous_patient", "out_of_scope",
    }
    if reason not in valid_reasons:
        return {"status": "error", "code": "invalid_reason",
                "message": f"Unknown escalation reason '{reason}'. "
                           f"Must be one of: {sorted(valid_reasons)}."}

    import datetime as _dt
    timestamp = _dt.datetime.utcnow().isoformat() + "Z"

    # Persist to handoffs table if it exists (created by the API layer)
    try:
        conn.execute(
            """INSERT OR IGNORE INTO handoffs
               (conversation_id, reason, summary, patient_id, appointment_id, timestamp, resolved)
               VALUES (?,?,?,?,?,?,0)""",
            (conversation_id, reason, summary, patient_id, appointment_id, timestamp),
        )
        conn.commit()
    except sqlite3.OperationalError:
        pass  # handoffs table may not exist in test contexts

    return {
        "status": "ok",
        "escalation_reason": reason,
        "conversation_id": conversation_id,
        "summary": summary,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "timestamp": timestamp,
    }
