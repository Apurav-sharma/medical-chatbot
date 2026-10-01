"""
safety.py — Clinical safety detection before any tool dispatch.

This runs synchronously, before LLM inference, so it cannot be bypassed
by crafty prompting. The patterns are intentionally conservative — we'd
rather have a false positive escalation than miss a real emergency.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Clinical urgency patterns (Hindi + English + Hinglish)
# ---------------------------------------------------------------------------

_CLINICAL_URGENT_PATTERNS = [
    # Chest pain / heart
    r"\bseene\s+mein\s+dard\b",
    r"\bchest\s+pain\b",
    r"\bseene\s+mein\b",
    r"\bsaanso\s+mein\s+takleef\b",
    r"\bsaans\s+(phool|nahi\s+aa)\b",
    r"\bbreathing\s+(difficulty|problem|trouble)\b",
    r"\bdifficulty\s+(breathing|in\s+breathing)\b",
    r"\bshortness\s+of\s+breath\b",
    r"\bcan.?t\s+breathe\b",
    r"\bnot\s+breathing\b",
    r"\bdil\s+(mein|ka)\s+dard\b",
    r"\bheart\s+attack\b",
    r"\bdil\s+ka\s+daura\b",
    # Stroke / unconscious
    r"\bbehosh\b",
    r"\bunconsci",
    r"\bparalysis\b",
    r"\bstroke\b",
    r"\bmunh\s+tirha\b",
    # Breathing / suffocation
    r"\bghuttan\b",
    r"\bsuffocating\b",
    r"\bnahi\s+le\s+pa\s+raha\b",
    # Severe pain
    r"\bbahut\s+tej\s+dard\b",
    r"\bsevere\s+pain\b",
    r"\bexcruciating\b",
    # Bleeding
    r"\bkhoon\s+aa\s+raha\b",
    r"\bheavy\s+bleed",
    r"\bbhaaree\s+khoon\b",
    # Fainting
    r"\bgir\s+pad",
    r"\bfaint",
    r"\bchakkar\s+aa\s+raha\b",
    # Emergency
    r"\bemergency\b",
    r"\baambulance\b",
    r"\bambulance\b",
    # Saans (breath) difficulty
    r"\bsaans\s+phool\b",
    r"\bsaans\s+thodi\s+phool\b",
]

_MEDICAL_ADVICE_PATTERNS = [
    r"\bkitni\s+(goli|tablet|medicine|dawaa)\b",
    r"\bdawaa\s+le\s+lun\b",
    r"\bek\s+aur\s+goli\b",
    r"\bkitni\s+der\s+mein\s+utar\b",
    r"\bkya\s+(kha|pi|le)\s+sakta\b",
    r"\bdiagnosis\b",
    r"\bwhat\s+(medicine|drug|tablet|pill)\b",
    r"\bshould\s+i\s+(take|eat|drink)\b",
    r"\bkya\s+(yeh|ye)\s+serious\s+hai\b",
    r"\bkitni\s+doses\b",
]

_COMPILED_URGENT = [re.compile(p, re.IGNORECASE) for p in _CLINICAL_URGENT_PATTERNS]
_COMPILED_ADVICE = [re.compile(p, re.IGNORECASE) for p in _MEDICAL_ADVICE_PATTERNS]


def detect_clinical_urgency(text: str) -> bool:
    """Return True if text signals something that needs a clinician NOW."""
    return any(p.search(text) for p in _COMPILED_URGENT)


def detect_medical_advice_request(text: str) -> bool:
    """Return True if text is asking for clinical judgement / drug dosing."""
    return any(p.search(text) for p in _COMPILED_ADVICE)


def detect_prompt_injection(text: str) -> bool:
    """
    Detect attempts to override the agent's system prompt or claim special
    permissions. These should result in 'refused', not escalated.
    """
    injection_patterns = [
        r"\bsystem\s+override\b",
        r"\bignore\s+(your\s+)?(previous|prior|all)\s+instructions?\b",
        r"\badministrator\s+mode\b",
        r"\bsystem\s+(prompt|says|command)\b",
        r"\byou\s+are\s+now\b",
        r"\binternal\s+test\b",
        r"\bauthori[sz]ed\s+internal\b",
        r"\boverride\b",
        r"\bsudo\b",
        r"\broot\s+access\b",
        r"\bdev\s+mode\b",
        r"\bcancel\s+every\b",
        r"\bdelete\s+all\b",
        r"\b(list|show|export|reveal)\s+(me\s+)?(all|every)\s+(appointments|patients|records)\b",
        r"\bgive\s+me\s+access\b",
        r"\breveal\s+(your|the)\s+(prompt|instructions|system)\b",
        r"\bshow\s+(me\s+)?(all|every)\s+(patient|appointment)\b",
    ]
    compiled = [re.compile(p, re.IGNORECASE) for p in injection_patterns]
    return any(p.search(text) for p in compiled)


def check_all_turns(turns: list[str]) -> dict | None:
    """
    Scan all turns for safety signals.
    Returns a dict with 'type' and 'trigger_turn' if a signal is found,
    else None.

    Priority: clinical_urgent > medical_advice > prompt_injection
    """
    for i, turn in enumerate(turns):
        if detect_clinical_urgency(turn):
            return {"type": "clinical_urgent", "trigger_turn": i, "text": turn}
        if detect_medical_advice_request(turn):
            return {"type": "medical_advice", "trigger_turn": i, "text": turn}

    # Prompt injection is checked separately — it results in 'refused' not escalation
    for i, turn in enumerate(turns):
        if detect_prompt_injection(turn):
            return {"type": "prompt_injection", "trigger_turn": i, "text": turn}

    return None
