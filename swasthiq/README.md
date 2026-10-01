# SwasthiQ Clinic Front Desk Agent

Gemini interprets caller intent, resolves corrections and Hindi/Hinglish phrasing, selects the clinic tools, and writes the final caller response. The SQLite-backed tools are the source of truth for patient records, appointments, schedules, and available slots. Each evaluation request gets a fresh database seeded from `backend/clinic.json`.

## Run locally

Use Python 3.10 or newer.

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

`backend/.env` supplies `GEMINI_API_KEY`, `LLM_MODEL`, and server settings. Keep this file private; use `.env.example` as the shareable template. The API loads `.env` when it starts.

## Replay the supplied conversations

From the `swasthiq` directory, with the server running:

```powershell
python runner.py --url http://127.0.0.1:8000/agent/run
python runner.py --url http://127.0.0.1:8000/agent/run --repeat 3
python runner.py --url http://127.0.0.1:8000/agent/run --dir adversarial
```

The runner validates the response shape and reports deterministic fingerprints. Compare each result with its script's `expected` block; the runner itself does not grade those expectations.

## Tests

```powershell
python -m pytest backend/tests -q
```

The tests exercise tool validation, slot integrity, patient lookup, date/time helpers, and safety detection without calling Gemini.

The evaluation endpoint is `POST /agent/run`. Optional dashboard and handoff endpoints are documented in `backend/main.py`. See [DECISIONS.md](DECISIONS.md) for implementation choices and assignment edge cases.
