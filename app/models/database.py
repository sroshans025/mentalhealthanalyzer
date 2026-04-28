import sqlite3
import os
from datetime import datetime

# Use /tmp directory if running on Vercel (read-only filesystem)
if os.environ.get('VERCEL') == '1':
    DB_PATH = '/tmp/mental_health.db'
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'mental_health.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            journal TEXT,
            sleep_hours REAL,
            screen_time REAL,
            activity_level INTEGER,
            sentiment_score REAL,
            emotion TEXT,
            risk_level TEXT,
            confidence REAL,
            explanation TEXT
        )
    ''')
    conn.commit()
    conn.close()

def save_prediction(data):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO predictions 
        (timestamp, journal, sleep_hours, screen_time, activity_level, sentiment_score, emotion, risk_level, confidence, explanation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        datetime.now().isoformat(),
        data['journal'], data['sleep_hours'], data['screen_time'], data['activity_level'],
        data['sentiment_score'], data['emotion'], data['risk_level'], data['confidence'], data['explanation']
    ))
    conn.commit()
    conn.close()

def get_history():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT timestamp, risk_level, emotion FROM predictions ORDER BY timestamp DESC LIMIT 30')
    rows = cursor.fetchall()
    conn.close()
    return [{"timestamp": r[0], "risk_level": r[1], "emotion": r[2]} for r in rows]
