# Decisions

## Starter-pack inconsistencies and implementation choices

- The contract allows `refused`, but there is no `refuse` tool. Prompt-injection and bulk-data requests therefore return `refused` without a tool call, as the examples require.
- The conversation harness submits all caller turns up front and does not deliver an answer after a clarifying question. If a patient remains ambiguous after those turns, the agent escalates instead of silently choosing a match or waiting for a turn that cannot arrive.
- Availability and mutations are facts from the SQLite-backed tools. Gemini interprets the caller, selects tools, and writes the final response; the backend validates the requested slot and records the actual outcome.
- Clinical urgency and medication-advice patterns are checked before model tool use. These checks can only cause a human handoff; they do not generate caller-facing reply text or make booking decisions.
- Each run constructs a new in-memory database from `clinic.json`, so example bookings cannot leak across runs. The persistent SQLite database is used only by the optional handoff/conversation dashboard APIs.
- The example workflow says a caller who requests a search and then says they will call back should not be booked. The backend searches when the doctor and date are known, then relies on the complete caller transcript and tool results before any mutation.

## Model execution

The backend loads `backend/.env` through the API startup, uses its configured Gemini model, and runs with temperature zero. Model requests are serialized and paced to avoid exceeding a common free-tier request-per-minute quota. The LLM remains responsible for interpreting ordinary Hindi, English, Hinglish, corrections, and intent; local checks are limited to safety and tool-data integrity.
