from textblob import TextBlob
import re

def analyze_text(text: str):
    """
    Basic NLP Pipeline using TextBlob.
    Option A style: fast and efficient baseline.
    """
    # Preprocess: lowercase and remove special characters
    clean_text = re.sub(r'[^\w\s]', '', text.lower())
    
    blob = TextBlob(clean_text)
    sentiment_score = blob.sentiment.polarity  # -1.0 to 1.0
    
    # Simple rule-based emotion classification
    if sentiment_score <= -0.5:
        emotion = "sadness"
    elif sentiment_score < 0:
        emotion = "fear" if "scared" in clean_text or "anxious" in clean_text else "anger"
    elif sentiment_score == 0:
        emotion = "neutral"
    else:
        emotion = "joy"

    return sentiment_score, emotion
