from datetime import date

import pytest

from app.models.ml_model import build_training_set, get_predictor
from app.services.insights import compute_streak, longest_streak
from app.utils.nlp import analyze, analyze_text, detect_crisis


@pytest.mark.parametrize("text,emotion", [
    ("Had a wonderful day with friends, feeling grateful", "joy"),
    ("I feel anxious about exams and tired", "fear"),
    ("So frustrated and angry at my boss", "anger"),
    ("I am not happy at all", "sadness"),
    ("Meh. Nothing much happened.", "neutral"),
])
def test_emotion_detection(text, emotion):
    assert analyze(text).emotion == emotion


def test_negated_negative_word_is_not_counted():
    assert analyze("I was not anxious today, felt calm").emotion == "joy"


@pytest.mark.parametrize("text", [
    "I want to kill myself", "thinking about suicide", "I don't want to live anymore",
    "I keep wanting to hurt myself", "everyone would be better off dead without me",
])
def test_crisis_detection(text):
    assert detect_crisis(text)


@pytest.mark.parametrize("text", [
    "This deadline is killing me", "I'm dying to see that movie", "My phone died today",
])
def test_crisis_detection_avoids_common_idioms(text):
    assert not detect_crisis(text)


def test_backwards_compatible_helpers():
    score, emotion = analyze_text("Great day!")
    assert score > 0 and emotion == "joy"
    level, confidence, explanation = get_predictor().predict_risk(0.5, 8, 2, 9000)
    assert level == "Low" and 0 < confidence <= 100 and explanation


def test_model_generalises_to_unseen_samples():
    X, y = build_training_set(1000, seed=123)
    assert get_predictor().model.score(X, y) > 0.8


def test_model_is_monotonic_for_clear_cases():
    p = get_predictor()
    assert p.predict_full(0.7, 8, 2, 10000).risk_level == "Low"
    assert p.predict_full(-0.8, 3, 12, 500).risk_level == "High"


def test_factor_directions():
    factors = {f.key: f for f in get_predictor().predict_full(0.0, 8, 2, 10000).factors}
    assert factors["sentiment"].direction == "neutral"
    assert factors["sleep"].direction == "protective"
    factors = {f.key: f for f in get_predictor().predict_full(-0.5, 4, 10, 1000).factors}
    assert all(f.direction == "risk" for f in factors.values())


def test_streaks():
    days = {date(2026, 1, d) for d in (1, 2, 3, 5, 6)}
    assert compute_streak(days, date(2026, 1, 6)) == 2
    assert compute_streak(days, date(2026, 1, 7)) == 2   # today not yet checked in
    assert compute_streak(days, date(2026, 1, 8)) == 0
    assert longest_streak(days) == 3
