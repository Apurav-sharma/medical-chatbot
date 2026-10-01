"""
db.py — SQLite database initialisation and helper functions.

Supports both persistent SQLite database (for live user chats & appointments)
and isolated in-memory databases (for deterministic benchmark runs).
"""

from __future__ import annotations

import json
import pathlib
import sqlite3
import time
from typing import Any

CLINIC_JSON = pathlib.Path(__file__).parent / "clinic.json"
CLINIC_DB_PATH = pathlib.Path(__file__).parent / "clinic_live.db"


def load_clinic() -> dict:
    """Load clinic.json exactly as shipped; do not mutate it."""
    with CLINIC_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def build_db(clinic: dict | None = None, *, in_memory: bool = True) -> sqlite3.Connection:
    """
    Returns an open SQLite database connection with foreign keys enabled.
    - If in_memory=True (default): Creates an isolated in-memory database seeded from clinic.json.
    - If in_memory=False: Uses the persistent clinic_live.db so bookings, registrations,
      cancellations, and reschedules persist across live sessions.
    """
    if in_memory:
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        _create_schema(conn)
        _seed(conn, clinic or load_clinic())
        return conn

    # Persistent database
    db_exists = CLINIC_DB_PATH.exists()
    conn = sqlite3.connect(str(CLINIC_DB_PATH), check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    if not db_exists:
        _create_schema(conn)
        _seed(conn, clinic or load_clinic())

    return conn


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS doctors (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            speciality  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doctor_windows (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            doctor_id   TEXT NOT NULL REFERENCES doctors(id),
            day         TEXT NOT NULL,   -- Mon, Tue, ...
            start_time  TEXT NOT NULL,   -- HH:MM
            end_time    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doctor_leave (
            doctor_id   TEXT NOT NULL REFERENCES doctors(id),
            leave_date  TEXT NOT NULL,   -- YYYY-MM-DD
            PRIMARY KEY (doctor_id, leave_date)
        );

        CREATE TABLE IF NOT EXISTS holidays (
            holiday_date TEXT PRIMARY KEY   -- YYYY-MM-DD
        );

        CREATE TABLE IF NOT EXISTS patients (
            id      TEXT PRIMARY KEY,
            name    TEXT NOT NULL,
            phone   TEXT NOT NULL,
            dob     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS guardians (
            guardian_id TEXT NOT NULL REFERENCES patients(id),
            ward_id     TEXT NOT NULL REFERENCES patients(id),
            PRIMARY KEY (guardian_id, ward_id)
        );

        -- UNIQUE partial index on (doctor_id, date, start_time) WHERE status='booked'
        -- prevents double-booking while allowing cancelled/freed slots to be re-booked
        CREATE TABLE IF NOT EXISTS appointments (
            id          TEXT PRIMARY KEY,
            patient_id  TEXT NOT NULL REFERENCES patients(id),
            doctor_id   TEXT NOT NULL REFERENCES doctors(id),
            date        TEXT NOT NULL,   -- YYYY-MM-DD
            start_time  TEXT NOT NULL,   -- HH:MM
            end_time    TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'booked'
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_active_appts
        ON appointments (doctor_id, date, start_time)
        WHERE status = 'booked';

        CREATE TABLE IF NOT EXISTS clinic_meta (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL
        );
        """
    )
    conn.commit()


def _seed(conn: sqlite3.Connection, clinic: dict) -> None:
    """Populate database tables from clinic dictionary."""
    c_meta = clinic.get("clinic", {})
    conn.execute(
        "INSERT OR REPLACE INTO clinic_meta VALUES ('slot_minutes', ?)",
        (str(c_meta.get("slot_minutes", 15)),),
    )
    conn.execute(
        "INSERT OR REPLACE INTO clinic_meta VALUES ('reference_date', ?)",
        (str(c_meta.get("reference_date", "2026-10-01")),),
    )

    for doc in clinic.get("doctors", []):
        conn.execute(
            "INSERT OR IGNORE INTO doctors VALUES (?,?,?)",
            (doc["id"], doc["name"], doc["speciality"]),
        )
        for w in doc.get("windows", []):
            conn.execute(
                "INSERT INTO doctor_windows (doctor_id, day, start_time, end_time) VALUES (?,?,?,?)",
                (doc["id"], w["day"], w["start"], w["end"]),
            )
        for ld in doc.get("leave_dates", []):
            conn.execute(
                "INSERT OR IGNORE INTO doctor_leave VALUES (?,?)",
                (doc["id"], ld),
            )

    for h in clinic.get("holidays", []):
        conn.execute("INSERT OR IGNORE INTO holidays VALUES (?)", (h,))

    guardians_to_insert = []
    for pt in clinic.get("patients", []):
        conn.execute(
            "INSERT OR IGNORE INTO patients VALUES (?,?,?,?)",
            (pt["id"], pt["name"], pt["phone"], pt["dob"]),
        )
        for ward_id in pt.get("guardian_of", []):
            guardians_to_insert.append((pt["id"], ward_id))

    for guardian_id, ward_id in guardians_to_insert:
        conn.execute(
            "INSERT OR IGNORE INTO guardians VALUES (?,?)",
            (guardian_id, ward_id),
        )

    for ap in clinic.get("appointments", []):
        conn.execute(
            "INSERT OR IGNORE INTO appointments VALUES (?,?,?,?,?,?,?)",
            (ap["id"], ap["patient_id"], ap["doctor_id"],
             ap["date"], ap["start"], ap["end"], ap["status"]),
        )

    conn.commit()


def next_appointment_id(conn: sqlite3.Connection) -> str:
    """Generate the next sequential appointment id (ap_NNNN)."""
    rows = conn.execute("SELECT id FROM appointments WHERE id LIKE 'ap_%'").fetchall()
    max_num = 0
    for r in rows:
        try:
            num = int(r["id"].split("_")[1])
            if num > max_num:
                max_num = num
        except Exception:
            pass
    return f"ap_{max_num + 1:04d}"


def next_patient_id(conn: sqlite3.Connection) -> str:
    """Generate the next sequential patient id (pt_NNNN)."""
    rows = conn.execute("SELECT id FROM patients WHERE id LIKE 'pt_%'").fetchall()
    max_num = 0
    for r in rows:
        try:
            num = int(r["id"].split("_")[1])
            if num > max_num:
                max_num = num
        except Exception:
            pass
    return f"pt_{max_num + 1:04d}"


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM clinic_meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None
