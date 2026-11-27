# Mental Health Predictor

A full-stack wellbeing journal. Write a short daily reflection, log your sleep, screen time and steps, and the app estimates a daily wellbeing risk level by combining the tone of your writing with those habits. Over time it shows trends, patterns and personal insights drawn from your own check-ins.

Live: https://mentalhealthanalyzer-pink.vercel.app

![FastAPI](https://img.shields.io/badge/FastAPI-0A192F?style=for-the-badge&logo=fastapi&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-%23F7931E.svg?style=for-the-badge&logo=scikit-learn&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-black?style=for-the-badge&logo=vercel&logoColor=white)

> **Disclaimer:** this is a self-reflection tool built for educational purposes. It is **not** a medical or diagnostic tool and must not be used to make clinical decisions. If you are struggling, please contact a professional or a local helpline.

---

## Features

**Daily check-in**
- Journal reflection with a live tone preview while you type
- Sleep, screen time and step inputs (slider or exact number) with hints against your personal goals
- Tags (preset or custom) for filtering and pattern detection
- Drafts are kept on the device until the check-in is saved

**Analysis**
- NLP: TextBlob sentiment polarity plus negation-aware emotion lexicons (joy, neutral, sadness, anxiety, frustration)
- Behavioural fusion: a Random Forest classifier combines journal tone with sleep, screen time and activity
- Explainability: per-factor contribution bars, class probabilities and practical suggestions for the day
- Safety: language suggesting a crisis is detected, the result is escalated, and free 24/7 helplines are shown immediately

**Dashboard**
- Key figures: check-ins, current and longest streak, average sleep and steps with goal adherence
- Trend chart for risk, journal tone, sleep, screen time or steps over 7/30/90 days, with goal lines and an accessible table view
- Risk mix, detected feelings, latest check-in and recent entries
- Reminder when you haven't checked in today

**Journal**
- Full-text search, filters (risk, feeling, tag, date range), six sort orders and pagination
- Entry detail view with the full analysis; delete with confirmation
- Export to CSV (spreadsheet-safe) or JSON (full backup)

**Insights**
- Personal patterns from your data: how meeting each habit goal relates to your risk, tone trends, most common feeling, tags and weekdays linked to harder or easier days, streaks
- Risk breakdowns by sleep, screen time and step ranges

**Settings and privacy**
- Display name and personal goals (sleep, screen limit, steps)
- Light, dark or system theme
- Private profile with no passwords: each browser gets a random recovery key; only its SHA-256 hash is stored on the server
- Restore a journal on another device with the recovery key
- Delete all data permanently

---

## Architecture

```
app/
  main.py               FastAPI app: security headers, logging, error format, static files
  config.py             Settings from environment variables
  schemas.py            Request validation (Pydantic)
  security.py           Profile-key auth and rate limiting
  routes/api.py         REST API
  services/insights.py  Dashboard statistics and personal insights
  models/database.py    SQLAlchemy Core (SQLite or PostgreSQL)
  models/ml_model.py    Risk model, factors and suggestions
  utils/nlp.py          Sentiment, emotion and crisis-language detection
frontend/
  index.html            App shell
  assets/css/app.css    Design system (light and dark themes)
  assets/js/            ES modules: router, API client, views, charts
  assets/img/           SVG illustrations
  assets/vendor/        Chart.js (vendored, MIT)
tests/                  API and analysis tests (pytest)
```

The frontend is plain HTML, CSS and JavaScript modules with no build step, served by FastAPI. The Content Security Policy only allows scripts from the app's own origin.

### About the model

There is no public labelled dataset bundled with the app, so the Random Forest is trained at startup on a reproducible synthetic dataset. Labels come from a transparent heuristic based on widely published guidance (7-9 hours of sleep, lower leisure screen time, more daily movement, with journal tone weighted most), plus noise so the forest learns smooth boundaries. The factor explanations come from the same heuristic, so they always match what drove the prediction. See `app/models/ml_model.py`.

### API

Interactive docs are at `/api/docs`. Every data endpoint requires `Authorization: Bearer <profile key>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health and storage status |
| POST | `/api/profiles` | Create a private profile (returns the key once) |
| GET / PATCH / DELETE | `/api/profile` | Read, update goals, or delete everything |
| POST | `/api/analyze` | Unsaved tone preview |
| POST | `/api/entries` | Analyse and save a check-in (`/api/predict` kept as an alias) |
| GET | `/api/entries` | Search, filter, sort, paginate |
| GET / DELETE | `/api/entries/{id}` | Read or delete one entry |
| GET | `/api/tags`, `/api/history` | Tags in use; compact recent history |
| GET | `/api/stats?days=7\|30\|90\|365\|0` | Dashboard statistics |
| GET | `/api/insights` | Personal insights and breakdowns |
| GET | `/api/export?format=csv\|json` | Download all entries |

Errors use one shape: `{"error": {"code": 422, "message": "...", "details": [...]}}`.

---

## Run locally

```bash
git clone https://github.com/sroshans025/mentalhealthanalyzer.git
cd mentalhealthanalyzer
python -m venv .venv
# Windows: .venv\Scripts\activate   macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python run.py
```

Open http://localhost:8000. Data is stored in `mental_health.db` (SQLite) unless `DATABASE_URL` is set.

### Tests

```bash
python -m pytest
```

---

## Deployment (Vercel)

The project deploys on Vercel's Python runtime through `vercel.json`; pushing to `main` triggers a production deployment.

**Persistent storage:** Vercel's filesystem is read-only apart from `/tmp`, which is wiped between cold starts and is not shared between instances. Without a database the app still works, but saved journals do not survive on the hosted version. For durable storage, create a PostgreSQL database (for example Neon through the Vercel Marketplace, or Supabase) and set:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

Tables are created automatically on startup. See `.env.example` for the other optional settings. Never commit real credentials.
