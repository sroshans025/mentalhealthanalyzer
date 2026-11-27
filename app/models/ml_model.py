"""Risk model: fuses journal sentiment with behavioural signals.

There is no public labelled dataset bundled with the app, so the Random Forest
is trained on a reproducible synthetic dataset. Labels come from a transparent
wellbeing heuristic (``_heuristic_score``) built on widely published guidance:
adults need roughly 7-9 hours of sleep, heavy recreational screen time and low
daily movement are linked to poorer mood, and negative journal tone carries the
most weight. Gaussian noise is added so the forest learns smooth, non-trivial
boundaries rather than memorising thresholds.

The per-factor contributions shown to the user come from the same heuristic,
so the explanation always matches the signals that drove the prediction.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger(__name__)

LABELS = ("Low", "Medium", "High")
WEIGHTS = {"sentiment": 0.40, "sleep": 0.25, "screen": 0.15, "activity": 0.20}
THRESHOLDS = (0.22, 0.42)  # score < 0.22 -> Low, < 0.42 -> Medium, else High


def _deficits(sentiment, sleep, screen, activity):
    """Each signal mapped to a 0..1 'risk pressure'. Works on scalars or arrays."""
    sentiment_d = np.clip((0.25 - np.asarray(sentiment, dtype=float)) / 1.25, 0.0, 1.0)
    sleep = np.asarray(sleep, dtype=float)
    sleep_d = np.where(
        sleep < 7.0,
        np.clip((7.0 - sleep) / 4.0, 0.0, 1.0),
        np.clip((sleep - 10.0) / 4.0, 0.0, 1.0) * 0.6,
    )
    screen_d = np.clip((np.asarray(screen, dtype=float) - 4.0) / 8.0, 0.0, 1.0)
    activity_d = np.clip((7000.0 - np.asarray(activity, dtype=float)) / 7000.0, 0.0, 1.0)
    return sentiment_d, sleep_d, screen_d, activity_d


def _heuristic_score(sentiment, sleep, screen, activity):
    s, sl, sc, a = _deficits(sentiment, sleep, screen, activity)
    return (WEIGHTS["sentiment"] * s + WEIGHTS["sleep"] * sl
            + WEIGHTS["screen"] * sc + WEIGHTS["activity"] * a)


def _label(score):
    return np.digitize(score, THRESHOLDS)


def build_training_set(n: int = 3000, seed: int = 42):
    rng = np.random.default_rng(seed)
    sentiment = np.clip(rng.normal(0.05, 0.45, n), -1.0, 1.0)
    sleep = np.clip(rng.normal(7.0, 1.8, n), 0.0, 14.0)
    screen = np.clip(rng.gamma(2.2, 2.4, n), 0.0, 18.0)
    activity = np.clip(rng.gamma(2.0, 3200.0, n), 0.0, 30000.0)
    score = _heuristic_score(sentiment, sleep, screen, activity) + rng.normal(0.0, 0.035, n)
    X = np.column_stack([sentiment, sleep, screen, activity])
    y = _label(score)
    return X, y


@dataclass
class Factor:
    key: str
    label: str
    value: float
    display: str
    impact: float          # contribution to the risk score (0..weight)
    share: float           # share of total risk pressure, 0..1
    direction: str         # "risk" | "protective" | "neutral"
    note: str


@dataclass
class Prediction:
    risk_level: str
    confidence: float
    probabilities: dict[str, float]
    score: float
    explanation: str
    factors: list[Factor] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)


_SUGGESTIONS = {
    "sentiment": "Your writing carried a heavy tone today. Talking with someone you trust, or writing down one small thing that went okay, can ease the load.",
    "sleep_short": "Short sleep strongly affects mood. Try a consistent wind-down time and keeping screens out of bed tonight.",
    "sleep_long": "Very long sleep can signal low energy or mood. A regular wake time and some morning daylight can help.",
    "screen": "Screen time was high. Short breaks away from devices (a walk, stretching, a chat in person) give your mind a reset.",
    "activity": "Movement was low today. Even a 10-15 minute walk is linked to better mood and lower stress.",
}


class MentalHealthPredictor:
    def __init__(self, n_samples: int = 3000, seed: int = 42):
        # Imported here so requests that never predict don't pay for it on cold start.
        from sklearn.ensemble import RandomForestClassifier

        X, y = build_training_set(n_samples, seed)
        self.model = RandomForestClassifier(
            n_estimators=120, max_depth=10, min_samples_leaf=3, random_state=seed, n_jobs=1
        )
        self.model.fit(X, y)
        self.training_accuracy = float(self.model.score(X, y))
        logger.info("Risk model trained on %d samples (train acc %.3f)", n_samples, self.training_accuracy)

    # ------------------------------------------------------------------ #
    def _factors(self, sentiment, sleep, screen, activity) -> list[Factor]:
        s, sl, sc, a = (float(v) for v in _deficits(sentiment, sleep, screen, activity))
        impacts = {
            "sentiment": WEIGHTS["sentiment"] * s,
            "sleep": WEIGHTS["sleep"] * sl,
            "screen": WEIGHTS["screen"] * sc,
            "activity": WEIGHTS["activity"] * a,
        }
        total = sum(impacts.values()) or 1.0

        def direction(pressure: float, protective: bool) -> str:
            if pressure >= 0.15:
                return "risk"
            return "protective" if protective else "neutral"

        sentiment = 0.0 if abs(sentiment) < 0.005 else sentiment
        tone = "positive" if sentiment > 0.15 else "negative" if sentiment < -0.05 else "neutral"
        sleep_note = (
            "Below the 7-9 hour range most adults need" if sleep < 7
            else "Above the typical healthy range" if sleep > 10
            else "Within a healthy range"
        )
        factors = [
            Factor("sentiment", "Journal tone", round(sentiment, 3), f"{sentiment:+.2f}",
                   round(impacts["sentiment"], 4), round(impacts["sentiment"] / total, 4),
                   "risk" if sentiment < -0.05 else "protective" if sentiment > 0.15 else "neutral",
                   f"Overall {tone} language in your entry"),
            Factor("sleep", "Sleep", float(sleep), f"{sleep:g} h",
                   round(impacts["sleep"], 4), round(impacts["sleep"] / total, 4),
                   direction(sl, 7 <= sleep <= 9.5), sleep_note),
            Factor("screen", "Screen time", float(screen), f"{screen:g} h",
                   round(impacts["screen"], 4), round(impacts["screen"] / total, 4),
                   direction(sc, screen <= 4),
                   "Higher than recommended for leisure use" if screen > 6 else "Moderate" if screen > 4 else "Well balanced"),
            Factor("activity", "Activity", float(activity), f"{int(activity):,} steps",
                   round(impacts["activity"], 4), round(impacts["activity"] / total, 4),
                   direction(a, activity >= 7000),
                   "Below a moderately active day" if activity < 5000 else "Some movement" if activity < 7000 else "An active day"),
        ]
        return sorted(factors, key=lambda f: f.impact, reverse=True)

    def predict_full(self, sentiment_score: float, sleep: float, screen: float, activity: int,
                     crisis_flag: bool = False) -> Prediction:
        features = np.array([[sentiment_score, sleep, screen, activity]], dtype=float)
        proba = self.model.predict_proba(features)[0]
        classes = list(self.model.classes_)
        probs = {LABELS[c]: float(proba[i]) for i, c in enumerate(classes)}
        for label in LABELS:
            probs.setdefault(label, 0.0)
        risk_level = max(probs, key=lambda k: probs[k])
        score = float(_heuristic_score(sentiment_score, sleep, screen, activity))

        factors = self._factors(sentiment_score, sleep, screen, activity)
        risk_factors = [f for f in factors if f.direction == "risk"]

        if crisis_flag:
            risk_level = "High"
            probs = {"Low": 0.0, "Medium": 0.0, "High": 1.0}
            explanation = ("Your entry contains language that suggests you may be going through "
                           "something very painful. Please consider reaching out for support now.")
        elif risk_factors and risk_level == "Low":
            reasons = ", ".join(f.label.lower() for f in risk_factors)
            explanation = f"Low risk overall. Worth keeping an eye on: {reasons}."
        elif risk_factors:
            reasons = ", ".join(f.label.lower() for f in risk_factors)
            explanation = f"{risk_level} risk, mainly influenced by {reasons}."
        else:
            explanation = f"{risk_level} risk. Your indicators look balanced today."

        suggestions = []
        for f in risk_factors:
            if f.key == "sleep":
                suggestions.append(_SUGGESTIONS["sleep_short" if sleep < 7 else "sleep_long"])
            else:
                suggestions.append(_SUGGESTIONS[f.key])
        if not suggestions:
            suggestions.append("Keep doing what is working. Noting what helped today makes it easier to repeat.")

        return Prediction(
            risk_level=risk_level,
            confidence=round(probs[risk_level] * 100, 1),
            probabilities={k: round(v * 100, 1) for k, v in probs.items()},
            score=round(score, 4),
            explanation=explanation,
            factors=factors,
            suggestions=suggestions[:3],
        )

    def predict_risk(self, sentiment_score: float, sleep: float, screen: float, activity: int):
        """Backwards compatible API: (risk_level, confidence, explanation)."""
        p = self.predict_full(sentiment_score, sleep, screen, activity)
        return p.risk_level, p.confidence, p.explanation


_lock = threading.Lock()
_predictor: MentalHealthPredictor | None = None


def get_predictor() -> MentalHealthPredictor:
    """Train lazily so health checks and static pages do not pay the cost."""
    global _predictor
    if _predictor is None:
        with _lock:
            if _predictor is None:
                _predictor = MentalHealthPredictor()
    return _predictor
