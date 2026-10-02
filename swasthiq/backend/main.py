"""
main.py — FastAPI REST API for SwasthiQ Clinic Front Desk Agent.

Endpoints:
  POST /agent/run          — main evaluation endpoint (schema.md)
  GET  /api/handoffs       — list escalations for frontend Handoff Queue
  GET  /api/conversations/{id} — conversation detail for frontend
  POST /api/handoffs/{id}/resolve — mark a handoff as resolved
  GET  /health             — health check
"""

from __future__ import annotations

import datetime
import json
import pathlib
import sqlite3
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import re

# Load .env before importing agent (which reads GEMINI_API_KEY)
load_dotenv()

from agent import run_conversation
from db import build_db, load_clinic

# ---------------------------------------------------------------------------
# Persistent DB for handoffs (separate from per-conversation in-memory DBs)
# ---------------------------------------------------------------------------

_HANDOFFS_DB_PATH = pathlib.Path(__file__).parent / "handoffs.db"

def _init_handoffs_db() -> sqlite3.Connection:
    """Create or open the persistent handoffs database."""
    conn = sqlite3.connect(str(_HANDOFFS_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS handoffs (
            conversation_id TEXT PRIMARY KEY,
            reason          TEXT NOT NULL,
            summary         TEXT NOT NULL,
            patient_id      TEXT,
            appointment_id  TEXT,
            timestamp       TEXT NOT NULL,
            resolved        INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS conversation_results (
            conversation_id TEXT PRIMARY KEY,
            result_json     TEXT NOT NULL,
            created_at      TEXT NOT NULL
        );
        """
    )
    conn.commit()
    return conn

_handoffs_conn: sqlite3.Connection | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _handoffs_conn
    _handoffs_conn = _init_handoffs_db()
    yield
    if _handoffs_conn:
        _handoffs_conn.close()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SwasthiQ Clinic Front Desk Agent",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class AgentRunRequest(BaseModel):
    conversation_id: str
    today: str
    turns: list[str]
    assistant_replies: list[str] = Field(default_factory=list)
    ui_mode: bool = False

    @field_validator("today")
    @classmethod
    def validate_today(cls, v: str) -> str:
        try:
            datetime.date.fromisoformat(v)
        except ValueError:
            raise ValueError(f"today must be YYYY-MM-DD, got '{v}'")
        return v

    @field_validator("turns")
    @classmethod
    def validate_turns(cls, v: list[str]) -> list[str]:
        if not isinstance(v, list):
            raise ValueError("turns must be a list of strings")
        return v

    @field_validator("conversation_id")
    @classmethod
    def validate_conversation_id(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("conversation_id must not be empty")
        return v.strip()


class AppointmentConfirmRequest(BaseModel):
    conversation_id: str = "live_booking"
    doctor_id: str
    date: str
    slot: str
    name: str
    phone: str
    for_self: bool = True
    patient_name: str | None = None
    relationship: str | None = None

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        try:
            datetime.date.fromisoformat(v)
        except ValueError:
            raise ValueError(f"date must be YYYY-MM-DD, got '{v}'")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Name is required")
        return clean

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v)
        if len(digits) < 10:
            raise ValueError("Phone number must have at least 10 digits")
        return digits[-10:]


class AppointmentRescheduleRequest(BaseModel):
    conversation_id: str = "live_reschedule"
    new_date: str
    new_start: str

    @field_validator("new_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        try:
            datetime.date.fromisoformat(v)
        except ValueError:
            raise ValueError(f"new_date must be YYYY-MM-DD, got '{v}'")
        return v

    @field_validator("new_start")
    @classmethod
    def validate_start(cls, v: str) -> str:
        clean = v.strip()
        if not re.match(r"^\d{1,2}:\d{2}$", clean):
            raise ValueError(f"new_start must be HH:MM, got '{v}'")
        return clean


class CancellationIdentityRequest(BaseModel):
    name: str
    phone: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Full name is required")
        return value.strip()

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if len(digits) < 10:
            raise ValueError("Phone number must have at least 10 digits")
        return digits[-10:]


# ---------------------------------------------------------------------------
# Main evaluation endpoint
# ---------------------------------------------------------------------------

@app.post("/agent/run")
async def agent_run(request: AgentRunRequest) -> dict:
    """
    Main endpoint called by runner.py and the evaluator.
    Each call starts from a fresh clinic.json state.
    """
    result = run_conversation(
        conversation_id=request.conversation_id,
        today=request.today,
        turns=request.turns,
        assistant_replies=request.assistant_replies,
        ui_mode=request.ui_mode,
    )

    # Persist conversation result for frontend
    if _handoffs_conn:
        _persist_result(result)

    return result


def _persist_result(result: dict) -> None:
    """Save conversation result to persistent DB for frontend queries."""
    if not _handoffs_conn:
        return

    timestamp = datetime.datetime.utcnow().isoformat() + "Z"

    # Save full result
    _handoffs_conn.execute(
        """INSERT OR REPLACE INTO conversation_results
           (conversation_id, result_json, created_at)
           VALUES (?,?,?)""",
        (result["conversation_id"], json.dumps(result, ensure_ascii=False), timestamp),
    )

    # Save handoff if escalated
    if result.get("terminal_state") == "escalated" and result.get("escalation_reason"):
        _handoffs_conn.execute(
            """INSERT OR REPLACE INTO handoffs
               (conversation_id, reason, summary, patient_id, appointment_id, timestamp, resolved)
               VALUES (?,?,?,?,?,?,0)""",
            (
                result["conversation_id"],
                result["escalation_reason"],
                result.get("reply", "")[:300],
                result.get("patient_id"),
                result.get("appointment_id"),
                timestamp,
            ),
        )

    _handoffs_conn.commit()


# ---------------------------------------------------------------------------
# Frontend API endpoints
# ---------------------------------------------------------------------------

@app.get("/api/handoffs")
async def list_handoffs() -> dict:
    """List all escalated conversations for the Handoff Queue screen."""
    if not _handoffs_conn:
        return {"handoffs": []}

    rows = _handoffs_conn.execute(
        """SELECT h.*, cr.result_json
           FROM handoffs h
           LEFT JOIN conversation_results cr ON h.conversation_id = cr.conversation_id
           ORDER BY h.timestamp DESC"""
    ).fetchall()

    handoffs = []
    for row in rows:
        result_data = {}
        if row["result_json"]:
            try:
                result_data = json.loads(row["result_json"])
            except Exception:
                pass

        # Get last caller turn for display
        caller_said = ""
        turns = result_data.get("turns_snapshot", [])
        if turns:
            caller_said = turns[-1]
        else:
            caller_said = row["summary"][:100]

        handoffs.append({
            "conversation_id": row["conversation_id"],
            "reason": row["reason"],
            "summary": row["summary"],
            "patient_id": row["patient_id"],
            "appointment_id": row["appointment_id"],
            "timestamp": row["timestamp"],
            "resolved": bool(row["resolved"]),
            "caller_said": caller_said,
        })

    return {
        "handoffs": handoffs,
        "counts": {
            "total": len(handoffs),
            "open": sum(1 for h in handoffs if not h["resolved"]),
            "resolved": sum(1 for h in handoffs if h["resolved"]),
        },
    }


@app.get("/api/conversations")
async def list_conversations() -> dict:
    """List all conversation results."""
    if not _handoffs_conn:
        return {"conversations": []}

    rows = _handoffs_conn.execute(
        "SELECT conversation_id, result_json, created_at FROM conversation_results ORDER BY created_at DESC"
    ).fetchall()

    conversations = []
    for row in rows:
        try:
            result = json.loads(row["result_json"])
        except Exception:
            continue
        conversations.append({
            "conversation_id": row["conversation_id"],
            "terminal_state": result.get("terminal_state"),
            "escalation_reason": result.get("escalation_reason"),
            "patient_id": result.get("patient_id"),
            "appointment_id": result.get("appointment_id"),
            "created_at": row["created_at"],
        })

    return {"conversations": conversations}


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str) -> dict:
    """Get full conversation detail for the Conversation Detail screen."""
    if not _handoffs_conn:
        raise HTTPException(status_code=404, detail="No conversation data found")

    row = _handoffs_conn.execute(
        "SELECT result_json, created_at FROM conversation_results WHERE conversation_id=?",
        (conversation_id,),
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Conversation '{conversation_id}' not found")

    try:
        result = json.loads(row["result_json"])
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse conversation data")

    return {
        "conversation_id": conversation_id,
        "result": result,
        "created_at": row["created_at"],
    }


@app.post("/api/handoffs/{conversation_id}/resolve")
async def resolve_handoff(conversation_id: str) -> dict:
    """Mark a handoff as resolved."""
    if not _handoffs_conn:
        raise HTTPException(status_code=503, detail="Database not available")

    row = _handoffs_conn.execute(
        "SELECT 1 FROM handoffs WHERE conversation_id=?", (conversation_id,)
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Handoff '{conversation_id}' not found")

    _handoffs_conn.execute(
        "UPDATE handoffs SET resolved=1 WHERE conversation_id=?", (conversation_id,)
    )
    _handoffs_conn.commit()

    return {"conversation_id": conversation_id, "resolved": True}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "SwasthiQ Clinic Front Desk Agent"}


# ---------------------------------------------------------------------------
# Stats endpoint for frontend dashboard
# ---------------------------------------------------------------------------

@app.get("/api/stats")
async def stats() -> dict:
    """Return aggregate stats for the frontend dashboard."""
    if not _handoffs_conn:
        return {"stats": {}}

    rows = _handoffs_conn.execute(
        "SELECT terminal_state, COUNT(*) as cnt FROM conversation_results "
        "cr JOIN json_each(json_extract(cr.result_json, '$.terminal_state')) "
        "GROUP BY terminal_state"
    )
    # Simpler approach
    all_results = _handoffs_conn.execute(
        "SELECT result_json FROM conversation_results"
    ).fetchall()

    counts = {
        "booked": 0, "rescheduled": 0, "cancelled": 0,
        "escalated": 0, "refused": 0, "abandoned": 0,
    }
    for row in all_results:
        try:
            r = json.loads(row["result_json"])
            ts = r.get("terminal_state", "")
            if ts in counts:
                counts[ts] += 1
        except Exception:
            pass

    return {"stats": counts}


# ---------------------------------------------------------------------------
# Appointments & Schedule endpoints for frontend
# ---------------------------------------------------------------------------

@app.get("/api/appointments")
async def list_appointments(
    status: str | None = None,
    doctor_id: str | None = None,
    date: str | None = None,
    q: str | None = None,
) -> dict:
    """Return all appointments stored in the database with patient and doctor details."""
    conn = build_db(in_memory=False)
    query = """
        SELECT 
            a.id, a.patient_id, a.doctor_id, a.date, a.start_time, a.end_time, a.status,
            p.name as patient_name, p.phone as patient_phone, p.dob as patient_dob,
            d.name as doctor_name, d.speciality as doctor_speciality
        FROM appointments a
        LEFT JOIN patients p ON a.patient_id = p.id
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE 1=1
    """
    params: list[Any] = []
    if status and status != "all":
        query += " AND a.status = ?"
        params.append(status)
    if doctor_id and doctor_id != "all":
        query += " AND a.doctor_id = ?"
        params.append(doctor_id)
    if date:
        query += " AND a.date = ?"
        params.append(date)
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        query += " AND (LOWER(p.name) LIKE ? OR p.phone LIKE ? OR LOWER(a.id) LIKE ?)"
        params.extend([term, f"%{q.strip()}%", term])

    query += " ORDER BY a.date DESC, a.start_time DESC"
    rows = conn.execute(query, params).fetchall()

    appointments = [dict(r) for r in rows]
    total_count = len(appointments)
    booked_count = sum(1 for a in appointments if a["status"] == "booked")
    cancelled_count = sum(1 for a in appointments if a["status"] == "cancelled")

    return {
        "appointments": appointments,
        "counts": {
            "total": total_count,
            "booked": booked_count,
            "cancelled": cancelled_count,
        },
    }


@app.post("/api/appointments/{appointment_id}/cancel")
async def cancel_appointment_api(appointment_id: str) -> dict:
    """Cancel a booked appointment and free its slot in the database."""
    import tools
    conn = build_db(in_memory=False)
    res = tools.cancel_appointment(conn, appointment_id=appointment_id)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message", "Cancellation failed"))
    return res


@app.post("/api/cancellations/lookup")
async def cancellation_lookup(req: CancellationIdentityRequest) -> dict:
    """Resolve caller identity, then return active appointments they may cancel."""
    import tools
    conn = build_db(in_memory=False)
    match = tools.lookup_patient(conn, name=req.name, phone=req.phone)
    if match.get("status") != "found":
        return {"status": match.get("status", "not_found"), "message": match.get("message"),
                "candidates": match.get("candidates", [])}

    patient_id = match["patient"]["id"]
    ward_rows = conn.execute("SELECT ward_id FROM guardians WHERE guardian_id=?", (patient_id,)).fetchall()
    allowed_patient_ids = [patient_id, *(row["ward_id"] for row in ward_rows)]
    placeholders = ",".join("?" for _ in allowed_patient_ids)
    rows = conn.execute(
        f"""SELECT a.id, a.patient_id, a.date, a.start_time, a.end_time,
                   p.name AS patient_name, d.name AS doctor_name
            FROM appointments a
            JOIN patients p ON p.id=a.patient_id
            JOIN doctors d ON d.id=a.doctor_id
            WHERE a.status='booked' AND a.patient_id IN ({placeholders})
            ORDER BY a.date, a.start_time""",
        allowed_patient_ids,
    ).fetchall()
    return {"status": "ok", "patient": match["patient"], "appointments": [dict(row) for row in rows]}


@app.post("/api/cancellations/{appointment_id}/confirm")
async def confirm_cancellation(appointment_id: str, req: CancellationIdentityRequest) -> dict:
    """Cancel only after re-verifying the caller and appointment ownership."""
    import tools
    conn = build_db(in_memory=False)
    match = tools.lookup_patient(conn, name=req.name, phone=req.phone)
    if match.get("status") != "found":
        raise HTTPException(status_code=403, detail="Could not verify the patient. Check the name and phone number.")

    caller_id = match["patient"]["id"]
    appointment = conn.execute("SELECT patient_id FROM appointments WHERE id=?", (appointment_id,)).fetchone()
    wards = {row["ward_id"] for row in conn.execute("SELECT ward_id FROM guardians WHERE guardian_id=?", (caller_id,)).fetchall()}
    if not appointment or (appointment["patient_id"] != caller_id and appointment["patient_id"] not in wards):
        raise HTTPException(status_code=403, detail="This appointment is not linked to the verified patient or their listed ward.")

    result = tools.cancel_appointment(conn, appointment_id=appointment_id)
    if result.get("status") != "ok":
        raise HTTPException(status_code=400, detail=result.get("message", "Cancellation failed."))
    return result


@app.get("/api/slots")
async def get_slots(doctor_id: str, date: str) -> dict:
    """
    Read-only slot availability check used by the frontend SlotSelector.
    Safe to call multiple times — does not mutate any data.
    Returns the same structure as search_slots tool.
    """
    import tools
    conn = build_db(in_memory=False)
    result = tools.search_slots(conn, doctor_id=doctor_id, date=date)
    return result


@app.get("/api/doctors")
async def list_doctors() -> dict:
    """Return list of clinic doctors."""
    conn = build_db(in_memory=False)
    rows = conn.execute("SELECT id, name, speciality FROM doctors ORDER BY name").fetchall()
    return {"doctors": [dict(r) for r in rows]}


@app.post("/api/appointments/confirm")
async def confirm_appointment(req: AppointmentConfirmRequest) -> dict:
    """
    Authoritative backend validation & atomic booking transaction.
    1. Validates request schema with Pydantic.
    2. Validates doctor exists.
    3. Validates clinic holidays and doctor leaves.
    4. Re-checks slot availability atomically (race condition guard).
    5. Resolves or registers patient in clinic DB.
    6. Books appointment atomically with SQLite UNIQUE constraint protection.
    7. Returns authoritative booking result.
    """
    import tools
    conn = build_db(in_memory=False)

    # 1. Doctor check
    doc = conn.execute("SELECT id, name, speciality FROM doctors WHERE id=?", (req.doctor_id,)).fetchone()
    if not doc:
        raise HTTPException(status_code=400, detail=f"Doctor '{req.doctor_id}' does not exist.")

    # 2. Holiday check
    if tools._is_holiday(conn, req.date):
        raise HTTPException(status_code=400, detail=f"The clinic is closed on {req.date} (public holiday).")

    # 3. Doctor leave check
    if tools._is_doctor_on_leave(conn, req.doctor_id, req.date):
        raise HTTPException(status_code=400, detail=f"{doc['name']} is on leave on {req.date}.")

    # 4. Slot availability check (authoritative race condition guard)
    slot_res = tools.search_slots(conn, doctor_id=req.doctor_id, date=req.date)
    if slot_res.get("status") != "ok":
        raise HTTPException(status_code=400, detail=slot_res.get("message", "Slot check failed."))

    avail_slots = slot_res.get("slots", [])
    if req.slot not in avail_slots:
        return {
            "status": "error",
            "code": "slot_unavailable",
            "message": f"Slot {req.slot} is no longer available for {doc['name']} on {req.date}. Please select another time.",
            "available_slots": avail_slots,
        }

    # 5. Resolve or register patient
    target_name = req.name if req.for_self else (req.patient_name or req.name)
    target_phone = req.phone

    lp = tools.lookup_patient(conn, name=target_name, phone=target_phone)
    if lp.get("status") == "found":
        patient_id = lp["patient"]["id"]
    else:
        reg = tools.register_patient(conn, name=target_name, phone=target_phone)
        if reg.get("status") == "ok":
            patient_id = reg["patient"]["id"]
        else:
            row = conn.execute(
                "SELECT id FROM patients WHERE REPLACE(REPLACE(phone,' ',''),'-','') = ?",
                (target_phone,),
            ).fetchone()
            patient_id = row["id"] if row else "pt_new"

    # 6. Book appointment atomically
    bk = tools.book_appointment(
        conn,
        patient_id=patient_id,
        doctor_id=req.doctor_id,
        date=req.date,
        start=req.slot,
    )

    if bk.get("status") != "ok":
        raise HTTPException(status_code=400, detail=bk.get("message", "Failed to book appointment."))

    appt_id = bk.get("appointment_id", "")

    # Persist in conversation results if conversation_id provided
    if _handoffs_conn and req.conversation_id:
        result_record = {
            "conversation_id": req.conversation_id,
            "terminal_state": "booked",
            "escalation_reason": None,
            "patient_id": patient_id,
            "appointment_id": appt_id,
            "tool_calls": [
                {"name": "search_slots", "arguments": {"doctor_id": req.doctor_id, "date": req.date}},
                {"name": "lookup_patient", "arguments": {"name": target_name, "phone": target_phone}},
                {"name": "book_appointment", "arguments": {"patient_id": patient_id, "doctor_id": req.doctor_id, "date": req.date, "start": req.slot}},
            ],
            "reply": f"Your appointment with {doc['name']} on {req.date} at {req.slot} is confirmed. Appointment ID: {appt_id}.",
        }
        _persist_result(result_record)

    return {
        "status": "ok",
        "appointment_id": appt_id,
        "doctor_id": req.doctor_id,
        "doctor_name": doc["name"],
        "date": req.date,
        "slot": req.slot,
        "patient_name": target_name,
        "patient_phone": target_phone,
        "message": f"Your appointment with {doc['name']} on {req.date} at {req.slot} is confirmed.",
    }


@app.post("/api/appointments/{appointment_id}/reschedule")
async def reschedule_appointment_api(appointment_id: str, req: AppointmentRescheduleRequest) -> dict:
    """
    Atomically reschedule an appointment to a new date and time.
    """
    import tools
    conn = build_db(in_memory=False)
    res = tools.reschedule_appointment(
        conn,
        appointment_id=appointment_id,
        new_date=req.new_date,
        new_start=req.new_start,
    )
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message", "Reschedule failed"))

    # Log in conversation results if conversation_id provided
    if _handoffs_conn and req.conversation_id:
        doc = conn.execute("SELECT name FROM doctors WHERE id=?", (res.get("doctor_id", ""),)).fetchone()
        doc_name = doc["name"] if doc else "the doctor"
        result_record = {
            "conversation_id": req.conversation_id,
            "terminal_state": "rescheduled",
            "escalation_reason": None,
            "patient_id": res.get("patient_id"),
            "appointment_id": appointment_id,
            "tool_calls": [
                {"name": "search_slots", "arguments": {"doctor_id": res.get("doctor_id"), "date": req.new_date}},
                {"name": "reschedule_appointment", "arguments": {"appointment_id": appointment_id, "new_date": req.new_date, "new_start": req.new_start}},
            ],
            "reply": f"Your appointment has been successfully rescheduled to {req.new_date} at {req.new_start} with {doc_name}.",
        }
        _persist_result(result_record)

    return res
