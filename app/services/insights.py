"""Dashboard statistics and personalised insights, computed from a profile's
own entries. Everything here is derived from stored data; nothing is mocked."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import mean
from typing import Any, Callable

from app.utils.nlp import EMOTIONS

RISK_LEVELS = ("Low", "Medium", "High")
EMOTION_LABELS = {"joy": "joy", "neutral": "neutral", "sadness": "sadness", "fear": "anxiety", "anger": "frustration"}
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def local_day(value: str, tz_offset: int) -> date:
    return (parse_ts(value) + timedelta(minutes=tz_offset)).date()


def today_local(tz_offset: int) -> date:
    return (datetime.now(timezone.utc) + timedelta(minutes=tz_offset)).date()


def _avg(values: list[float], digits: int = 2) -> float | None:
    return round(mean(values), digits) if values else None


def compute_streak(days: set[date], today: date) -> int:
    """Consecutive days with a check-in, ending today (or yesterday if today is still open)."""
    cursor = today if today in days else today - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def longest_streak(days: set[date]) -> int:
    best = run = 0
    prev: date | None = None
    for d in sorted(days):
        run = run + 1 if prev and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d
    return best


def compute_stats(all_entries: list[dict[str, Any]], profile: dict[str, Any], days: int,
                  tz_offset: int) -> dict[str, Any]:
    """``all_entries`` must be oldest-first. ``days`` = 0 means all time."""
    now = datetime.now(timezone.utc)
    today = today_local(tz_offset)
    if days:
        start = now - timedelta(days=days)
        window = [e for e in all_entries if parse_ts(e["created_at"]) >= start]
        prev_start = start - timedelta(days=days)
        previous = [e for e in all_entries if prev_start <= parse_ts(e["created_at"]) < start]
    else:
        window, previous = list(all_entries), []

    entry_days = {local_day(e["created_at"], tz_offset) for e in all_entries}

    sleep = [e["sleep_hours"] for e in window]
    screen = [e["screen_time"] for e in window]
    steps = [e["activity_level"] for e in window]
    risk = [e["risk_score"] for e in window]
    sentiment = [e["sentiment_score"] for e in window]

    def pct(predicate: Callable[[dict[str, Any]], bool]) -> int | None:
        return round(100 * sum(1 for e in window if predicate(e)) / len(window)) if window else None

    # Daily timeline (local days).
    by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for e in window:
        by_day[local_day(e["created_at"], tz_offset)].append(e)
    timeline = [
        {
            "date": d.isoformat(),
            "count": len(items),
            "risk": _avg([i["risk_score"] for i in items]),
            "sentiment": _avg([i["sentiment_score"] for i in items], 3),
            "sleep": _avg([i["sleep_hours"] for i in items], 1),
            "screen": _avg([i["screen_time"] for i in items], 1),
            "steps": round(mean([i["activity_level"] for i in items])),
        }
        for d, items in sorted(by_day.items())
    ]

    emotions = Counter(e["emotion"] for e in window)
    risks = Counter(e["risk_level"] for e in window)
    latest = all_entries[-1] if all_entries else None
    prev_risk = _avg([e["risk_score"] for e in previous])
    cur_risk = _avg(risk)

    return {
        "range_days": days,
        "totals": {"all_time": len(all_entries), "in_range": len(window)},
        "checked_in_today": today in entry_days,
        "streak": compute_streak(entry_days, today),
        "longest_streak": longest_streak(entry_days),
        "averages": {
            "sleep": _avg(sleep, 1),
            "screen": _avg(screen, 1),
            "steps": round(mean(steps)) if steps else None,
            "risk": cur_risk,
            "sentiment": _avg(sentiment, 3),
        },
        "previous_averages": {"risk": prev_risk},
        "risk_change": round(cur_risk - prev_risk, 2) if cur_risk is not None and prev_risk is not None else None,
        "goals": {
            "sleep_goal": profile["sleep_goal"],
            "screen_limit": profile["screen_limit"],
            "step_goal": profile["step_goal"],
            "sleep_met_pct": pct(lambda e: e["sleep_hours"] >= profile["sleep_goal"]),
            "screen_met_pct": pct(lambda e: e["screen_time"] <= profile["screen_limit"]),
            "steps_met_pct": pct(lambda e: e["activity_level"] >= profile["step_goal"]),
        },
        "timeline": timeline,
        "emotions": {k: emotions.get(k, 0) for k in EMOTIONS},
        "risk_distribution": {k: risks.get(k, 0) for k in RISK_LEVELS},
        "latest": {
            "id": latest["id"],
            "created_at": latest["created_at"],
            "risk_level": latest["risk_level"],
            "emotion": latest["emotion"],
            "confidence": latest["confidence"],
        } if latest else None,
    }


# --------------------------------------------------------------------------- #
# Insights
# --------------------------------------------------------------------------- #

MIN_ENTRIES_FOR_INSIGHTS = 3


def _bucketise(entries: list[dict[str, Any]], key: str,
               buckets: list[tuple[str, float, float]]) -> list[dict[str, Any]]:
    out = []
    for label, lo, hi in buckets:
        items = [e for e in entries if lo <= e[key] < hi]
        out.append({
            "label": label,
            "count": len(items),
            "avg_risk": _avg([e["risk_score"] for e in items]),
            "avg_sentiment": _avg([e["sentiment_score"] for e in items], 3),
        })
    return out


def _compare(entries, predicate, min_group=2):
    yes = [e["risk_score"] for e in entries if predicate(e)]
    no = [e["risk_score"] for e in entries if not predicate(e)]
    if len(yes) < min_group or len(no) < min_group:
        return None
    return mean(yes), mean(no), len(yes), len(no)


def compute_insights(all_entries: list[dict[str, Any]], profile: dict[str, Any],
                     tz_offset: int) -> dict[str, Any]:
    n = len(all_entries)
    breakdowns = {
        "sleep": _bucketise(all_entries, "sleep_hours",
                            [("Under 6h", 0, 6), ("6-7h", 6, 7), ("7-9h", 7, 9.01), ("Over 9h", 9.01, 25)]),
        "screen": _bucketise(all_entries, "screen_time",
                             [("Under 2h", 0, 2), ("2-4h", 2, 4.01), ("4-6h", 4.01, 6.01), ("Over 6h", 6.01, 25)]),
        "activity": _bucketise(all_entries, "activity_level",
                               [("Under 3k", 0, 3000), ("3k-7k", 3000, 7000), ("7k-10k", 7000, 10000),
                                ("10k+", 10000, 10**7)]),
    }
    if n < MIN_ENTRIES_FOR_INSIGHTS:
        return {"ready": False, "entries": n, "needed": MIN_ENTRIES_FOR_INSIGHTS - n,
                "insights": [], "breakdowns": breakdowns}

    insights: list[dict[str, Any]] = []

    def add(id_: str, tone: str, title: str, detail: str, metric: str | None = None):
        insights.append({"id": id_, "tone": tone, "title": title, "detail": detail, "metric": metric})

    def risk_word(v: float) -> str:
        return "low" if v < 1.5 else "moderate" if v < 2.4 else "high"

    habit_checks = [
        ("sleep", lambda e: e["sleep_hours"] >= profile["sleep_goal"],
         f"reach your {profile['sleep_goal']:g}h sleep goal", "fall short on sleep"),
        ("screen", lambda e: e["screen_time"] <= profile["screen_limit"],
         f"stay under {profile['screen_limit']:g}h of screen time", "go over your screen limit"),
        ("activity", lambda e: e["activity_level"] >= profile["step_goal"],
         f"hit {profile['step_goal']:,} steps", "move less"),
    ]
    for key, predicate, good_phrase, bad_phrase in habit_checks:
        cmp = _compare(all_entries, predicate)
        if not cmp:
            continue
        good, bad, n_good, n_bad = cmp
        diff = bad - good
        if diff >= 0.3:
            add(f"habit-{key}", "positive",
                f"Days you {good_phrase} go better",
                f"Your average risk is {risk_word(good)} ({good:.1f}/3) on those days versus "
                f"{risk_word(bad)} ({bad:.1f}/3) on days you {bad_phrase}. Based on {n_good + n_bad} check-ins.",
                f"{diff:.1f} lower")
        elif diff <= -0.3:
            add(f"habit-{key}", "info",
                f"{key.capitalize()} doesn't seem to be your main driver",
                f"Your risk has not been lower on days you {good_phrase}. Other factors may matter more for you right now.",
                None)

    # Sentiment trend: last 7 entries vs the 7 before.
    if n >= 6:
        half = min(7, n // 2)
        recent = mean(e["sentiment_score"] for e in all_entries[-half:])
        before = mean(e["sentiment_score"] for e in all_entries[-2 * half:-half])
        delta = recent - before
        if delta >= 0.1:
            add("sentiment-trend", "positive", "Your journal tone is lifting",
                f"Your last {half} entries read more positively than the {half} before them.", f"+{delta:.2f}")
        elif delta <= -0.1:
            add("sentiment-trend", "warning", "Your journal tone has dipped",
                f"Your last {half} entries read more negatively than the {half} before them. "
                "Be gentle with yourself and consider talking it through with someone you trust.", f"{delta:.2f}")
        else:
            add("sentiment-trend", "info", "Your mood has been steady",
                f"Journal tone over your last {half} entries is similar to the {half} before them.", None)

    # Dominant emotion over the last 14 days.
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    recent_emotions = Counter(e["emotion"] for e in all_entries if parse_ts(e["created_at"]) >= cutoff)
    if recent_emotions:
        top, count = recent_emotions.most_common(1)[0]
        total = sum(recent_emotions.values())
        tone = "positive" if top == "joy" else "info" if top == "neutral" else "warning"
        label = EMOTION_LABELS.get(top, top)
        add("top-emotion", tone, f"Most common feeling lately: {label}",
            f"{label.capitalize()} showed up in {count} of your {total} check-ins over the past two weeks.",
            f"{round(100 * count / total)}%")

    # Tags associated with higher or lower risk.
    tag_scores: dict[str, list[int]] = defaultdict(list)
    for e in all_entries:
        for t in e["tags"]:
            tag_scores[t].append(e["risk_score"])
    overall = mean(e["risk_score"] for e in all_entries)
    tag_avgs = {t: mean(v) for t, v in tag_scores.items() if len(v) >= 2}
    if tag_avgs:
        worst = max(tag_avgs, key=tag_avgs.get)
        best = min(tag_avgs, key=tag_avgs.get)
        if tag_avgs[worst] - overall >= 0.3:
            add("tag-worst", "warning", f"'{worst}' days tend to be harder",
                f"Entries tagged '{worst}' average {tag_avgs[worst]:.1f}/3 risk compared with {overall:.1f}/3 overall.",
                None)
        if overall - tag_avgs[best] >= 0.3 and best != worst:
            add("tag-best", "positive", f"'{best}' seems to help",
                f"Entries tagged '{best}' average {tag_avgs[best]:.1f}/3 risk compared with {overall:.1f}/3 overall.",
                None)

    # Day of week pattern.
    by_weekday: dict[int, list[int]] = defaultdict(list)
    for e in all_entries:
        by_weekday[local_day(e["created_at"], tz_offset).weekday()].append(e["risk_score"])
    eligible = {d: mean(v) for d, v in by_weekday.items() if len(v) >= 2}
    if len(eligible) >= 3:
        hardest = max(eligible, key=eligible.get)
        if eligible[hardest] - overall >= 0.3:
            add("weekday", "info", f"{WEEKDAYS[hardest]}s are usually tougher",
                f"Your average risk on {WEEKDAYS[hardest]}s is {eligible[hardest]:.1f}/3. "
                "Planning something restorative for that day could help.", None)

    # Consistency.
    entry_days = {local_day(e["created_at"], tz_offset) for e in all_entries}
    streak = compute_streak(entry_days, today_local(tz_offset))
    if streak >= 3:
        add("streak", "positive", f"{streak}-day check-in streak",
            "Regular reflection makes patterns easier to spot. Keep it going.", f"{streak}d")

    order = {"warning": 0, "positive": 1, "info": 2}
    insights.sort(key=lambda i: order.get(i["tone"], 3))
    return {"ready": True, "entries": n, "needed": 0, "insights": insights, "breakdowns": breakdowns}
