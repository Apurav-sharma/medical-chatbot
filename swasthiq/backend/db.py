"""
db.py — SQLite database initialisation and helper functions.

Each POST /agent/run call initialises a fresh in-memory SQLite database from
clinic.json so that state does not leak between conversations.
"""

from __future__ import annotations

import json
import pathlib
import sqlite3
from typing import Any

CLINIC_JSON = pathlib.Path(__file__).parent / "clinic.json"


def load_clinic() -> dict:
    """Load clinic.json exactly as shipped; do not mutate it."""
    with CLINIC_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def build_db(clinic: dict) -> sqlite3.Connection:
    """
    Create a fresh in-memory SQLite database from clinic data.
    Returns an open connection with WAL mode and foreign keys enabled.

    Using in-memory DB (`:memory:`) guarantees perfect state isolation
    between conversation runs without any disk I/O cleanup.
    """
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    _create_schema(conn)
    _seed(conn, clinic)
    return conn


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE doctors (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            speciality  TEXT NOT NULL
        );

        CREATE TABLE doctor_windows (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            doctor_id   TEXT NOT NULL REFERENCES doctors(id),
            day         TEXT NOT NULL,   -- Mon, Tue, ...
            start_time  TEXT NOT NULL,   -- HH:MM
            end_time    TEXT NOT NULL
        );

        CREATE TABLE doctor_leave (
            doctor_id   TEXT NOT NULL REFERENCES doctors(id),
            leave_date  TEXT NOT NULL,   -- YYYY-MM-DD
            PRIMARY KEY (doctor_id, leave_date)
        );

        CREATE TABLE holidays (
            holiday_date TEXT PRIMARY KEY   -- YYYY-MM-DD
        );

        CREATE TABLE patients (
            id      TEXT PRIMARY KEY,
            name    TEXT NOT NULL,
            phone   TEXT NOT NULL,
            dob     TEXT NOT NULL
        );

        CREATE TABLE guardians (
            guardian_id TEXT NOT NULL REFERENCES patients(id),
            ward_id     TEXT NOT NULL REFERENCES patients(id),
            PRIMARY KEY (guardian_id, ward_id)
        );

        -- UNIQUE constraint on (doctor_id, date, start) prevents double-booking
        -- at the database level even under concurrent requests.
        CREATE TABLE appointments (
            id          TEXT PRIMARY KEY,
            patient_id  TEXT NOT NULL REFERENCES patients(id),
            doctor_id   TEXT NOT NULL REFERENCES doctors(id),
            date        TEXT NOT NULL,   -- YYYY-MM-DD
            start_time  TEXT NOT NULL,   -- HH:MM
            end_time    TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'booked',
            UNIQUE (doctor_id, date, start_time)
        );

        CREATE TABLE clinic_meta (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL
        );
        """
    )
    conn.commit()


def _seed(conn: sqlite3.Connection, clinic: dict) -> None:
    """Populate tables from clinic.json data."""
    meta = clinic["clinic"]
    conn.execute(
        "INSERT INTO clinic_meta VALUES ('id',?), ('name',?), ('slot_minutes',?), ('reference_date',?)",
        (meta["id"], meta["name"], str(meta["slot_minutes"]), meta["reference_date"]),
    )

    for doc in clinic["doctors"]:
        conn.execute(
            "INSERT INTO doctors VALUES (?,?,?)",
            (doc["id"], doc["name"], doc["speciality"]),
        )
        for w in doc["windows"]:
            conn.execute(
                "INSERT INTO doctor_windows (doctor_id, day, start_time, end_time) VALUES (?,?,?,?)",
                (doc["id"], w["day"], w["start"], w["end"]),
            )
        for ld in doc.get("leave_dates", []):
            conn.execute(
                "INSERT INTO doctor_leave VALUES (?,?)",
                (doc["id"], ld),
            )

    for h in clinic.get("holidays", []):
        conn.execute("INSERT INTO holidays VALUES (?)", (h,))

    # Insert all patients first, then guardians (avoids FK violation since
    # guardian_of references patients that may not exist yet when processed
    # in order — e.g. Meera Joshi at pt_0009 lists pt_0031 as a ward).
    guardians_to_insert = []
    for pt in clinic["patients"]:
        conn.execute(
            "INSERT INTO patients VALUES (?,?,?,?)",
            (pt["id"], pt["name"], pt["phone"], pt["dob"]),
        )
        for ward_id in pt.get("guardian_of", []):
            guardians_to_insert.append((pt["id"], ward_id))

    for guardian_id, ward_id in guardians_to_insert:
        conn.execute(
            "INSERT INTO guardians VALUES (?,?)",
            (guardian_id, ward_id),
        )

    for ap in clinic["appointments"]:
        conn.execute(
            "INSERT INTO appointments VALUES (?,?,?,?,?,?,?)",
            (ap["id"], ap["patient_id"], ap["doctor_id"],
             ap["date"], ap["start"], ap["end"], ap["status"]),
        )

    conn.commit()


def next_appointment_id(conn: sqlite3.Connection) -> str:
    """Generate the next sequential appointment id (ap_NNNN)."""
    row = conn.execute(
        "SELECT id FROM appointments ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return "ap_0001"
    last_num = int(row["id"].split("_")[1])
    return f"ap_{last_num + 1:04d}"


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM clinic_meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None
