"""Journal text analysis.

Sentiment polarity comes from TextBlob's lexicon. The dominant emotion is
chosen with small keyword lexicons and falls back to polarity when no
emotion-specific words are present. A separate check flags language that
suggests the writer may be in crisis, so the interface can surface support
resources straight away.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from textblob import TextBlob

EMOTIONS = ("joy", "neutral", "sadness", "fear", "anger")

_LEXICON: dict[str, tuple[str, ...]] = {
    "joy": (
        "happy", "joy", "joyful", "glad", "grateful", "thankful", "excited", "calm", "relaxed",
        "peaceful", "proud", "content", "hopeful", "love", "loved", "great", "amazing", "wonderful",
        "fantastic", "good", "better", "energized", "energised", "motivated", "cheerful", "fun",
        "laughed", "smile", "smiled", "accomplished", "satisfied", "rested", "refreshed",
    ),
    "sadness": (
        "sad", "down", "depressed", "depressing", "lonely", "alone", "empty", "hopeless", "cry",
        "cried", "crying", "tears", "miserable", "unhappy", "grief", "grieving", "lost", "hurt",
        "heartbroken", "numb", "worthless", "tired", "exhausted", "drained", "low", "unmotivated",
        "disappointed", "gloomy", "blue", "isolated",
    ),
    "fear": (
        "anxious", "anxiety", "scared", "afraid", "fear", "worried", "worry", "worrying", "nervous",
        "panic", "panicked", "stressed", "stress", "stressful", "overwhelmed", "tense", "uneasy",
        "dread", "terrified", "restless", "insecure", "pressure", "overthinking", "deadline",
        "deadlines",
    ),
    "anger": (
        "angry", "anger", "mad", "furious", "annoyed", "irritated", "frustrated", "frustrating",
        "hate", "hated", "rage", "resent", "resentful", "fed up", "pissed", "bitter", "unfair",
        "argued", "argument", "fight", "fought",
    ),
}

# Fatigue words lean towards low mood but are weaker evidence than e.g. "sad".
_WEAK = {"tired", "exhausted", "drained", "low", "down", "lost", "good", "better", "pressure"}

_NEGATIONS = {"not", "no", "never", "dont", "don't", "isnt", "isn't", "wasnt", "wasn't", "cant",
              "can't", "cannot", "hardly", "barely", "didnt", "didn't", "aint", "ain't"}

# Phrases that warrant immediately showing crisis-support resources.
_CRISIS_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bkill(?:ing)?\s+myself\b",
        r"\bsuicid(?:e|al)\b",
        r"\bend(?:ing)?\s+(?:my|it)\s+(?:life|all)\b",
        r"\bend\s+it\s+all\b",
        r"\bself[\s-]?harm(?:ing)?\b",
        r"\b(?:hurt|harm|cut)(?:ting)?\s+myself\b",
        r"\bwant(?:\s+to|na)\s+die\b",
        r"\bwish\s+i\s+(?:was|were)\s+dead\b",
        r"\bbetter\s+off\s+dead\b",
        r"\bno\s+reason\s+to\s+(?:live|go\s+on)\b",
        r"\bdon'?t\s+want\s+to\s+(?:live|be\s+alive|wake\s+up)\b",
    )
]

_WORD_RE = re.compile(r"[a-z']+")


@dataclass(frozen=True)
class TextAnalysis:
    sentiment_score: float
    emotion: str
    crisis_flag: bool
    word_count: int


def _tokens(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def _emotion_scores(tokens: list[str], lowered: str) -> dict[str, float]:
    scores = {e: 0.0 for e in _LEXICON}
    for i, tok in enumerate(tokens):
        negated = any(t in _NEGATIONS for t in tokens[max(0, i - 3):i])
        for emotion, words in _LEXICON.items():
            if tok in words:
                if negated and emotion == "joy":
                    # "not happy" reads as low mood rather than joy.
                    scores["sadness"] += 0.75
                elif not negated:
                    scores[emotion] += 0.5 if tok in _WEAK else 1.0
    for emotion, words in _LEXICON.items():
        for phrase in (w for w in words if " " in w):
            scores[emotion] += lowered.count(phrase)
    return scores


def detect_crisis(text: str) -> bool:
    return any(p.search(text) for p in _CRISIS_PATTERNS)


def analyze(text: str) -> TextAnalysis:
    lowered = text.lower()
    tokens = _tokens(lowered)
    polarity = float(TextBlob(text).sentiment.polarity)

    scores = _emotion_scores(tokens, lowered)
    best = max(scores, key=lambda e: scores[e])
    if scores[best] > 0:
        emotion = best
        # Positive words dominate, but overall tone is clearly negative.
        if emotion == "joy" and polarity < -0.2:
            emotion = "sadness"
    elif polarity >= 0.3:
        emotion = "joy"
    elif polarity <= -0.4:
        emotion = "sadness"
    elif polarity < -0.05:
        emotion = "fear"
    else:
        emotion = "neutral"

    crisis = detect_crisis(text)
    if crisis:
        emotion = "sadness"
        polarity = min(polarity, -0.6)

    return TextAnalysis(
        sentiment_score=round(max(-1.0, min(1.0, polarity)), 3),
        emotion=emotion,
        crisis_flag=crisis,
        word_count=len(tokens),
    )


def analyze_text(text: str) -> tuple[float, str]:
    """Backwards compatible helper: (sentiment_score, emotion)."""
    result = analyze(text)
    return result.sentiment_score, result.emotion
