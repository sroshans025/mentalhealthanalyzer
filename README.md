# 🧠 Mental Health Predictor

A futuristic, full-stack web application that uses **Natural Language Processing (NLP)** and **Machine Learning** to analyze daily journal entries and behavioral data (sleep, screen time, physical activity) to predict mental health risk trends. 

![UI Preview](https://img.shields.io/badge/UI-Glassmorphism-00B4DB?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/FastAPI-0A192F?style=for-the-badge&logo=fastapi&logoColor=white)
![Scikit-Learn](https://img.shields.io/badge/scikit--learn-%23F7931E.svg?style=for-the-badge&logo=scikit-learn&logoColor=white)
![Vercel Ready](https://img.shields.io/badge/Vercel-Deployed-black?style=for-the-badge&logo=vercel&logoColor=white)

---

## ✨ Features

- **NLP Sentiment Analysis:** Analyzes daily journal reflections using `TextBlob` to extract sentiment polarity and detect the dominant emotion (Joy, Neutral, Fear, Sadness, Anger).
- **Behavioral ML Fusion:** Fuses text sentiment with physiological data (Sleep, Screen Time, Steps) through a **Random Forest Classifier** to assess overall mental health risk.
- **Cyber-Glass Dashboard UI:** A stunning, premium dark-blue glassmorphism theme using Tailwind CSS with custom animated backgrounds, floating orbs, and interactive sliders.
- **Explainability:** Provides an automated breakdown (simulated SHAP values) explaining *why* a specific risk level was generated.
- **Temporal Tracking:** Logs predictions to a local SQLite database and renders a dynamic, gradient-filled 7-day radar chart using `Chart.js`.
- **Vercel Serverless Ready:** Dynamically adjusts filesystem writes (`/tmp` handling) to seamlessly deploy as a stateless serverless function on Vercel.

---

## 🛠️ Technology Stack

* **Backend Framework:** FastAPI (Python 3.12)
* **Machine Learning:** Scikit-Learn (`RandomForestClassifier`), Numpy
* **Natural Language Processing:** TextBlob
* **Frontend:** HTML5, Tailwind CSS, Vanilla JavaScript, Chart.js
* **Database:** SQLite (Local) / Ephemeral Storage (Vercel)

---

## 🚀 How to Run Locally

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/mental-health-analyzer.git
cd mental-health-analyzer
```

### 2. Create a Virtual Environment (Optional but recommended)
```bash
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Mac/Linux:
source .venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Start the FastAPI Server
```bash
python run.py
```

### 5. View Dashboard
Open your browser and navigate to: [http://localhost:8000](http://localhost:8000)

---

## ☁️ How to Deploy on Vercel

This application is pre-configured with `vercel.json` and specifically architected to run on Vercel's Python Serverless infrastructure.

1. Push your code to a GitHub repository.
2. Go to the [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New > Project**.
3. Import your repository.
4. Click **Deploy**. Vercel will automatically detect the settings and launch the app in seconds!

*(Note: SQLite data will reset on Vercel cold boots since Vercel is a stateless environment. If persistent data is required in production, simply swap the SQLite connection for a managed PostgreSQL instance like Supabase).*

---

## ⚠️ Disclaimer
**This application is an AI predictive model built for educational and demonstration purposes. It is NOT a medical diagnosis tool and should not be used to inform clinical decisions.**
