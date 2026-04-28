from fastapi import APIRouter
from pydantic import BaseModel
from app.utils.nlp import analyze_text
from app.models.ml_model import predictor
from app.models.database import save_prediction, get_history

router = APIRouter()

class PredictionRequest(BaseModel):
    journal: str
    sleep_hours: float
    screen_time: float
    activity_level: int

@router.post("/predict")
def predict_risk(request: PredictionRequest):
    # 1. NLP Pipeline
    sentiment, emotion = analyze_text(request.journal)
    
    # 2 & 3. Behavioral and Fusion Model (ML Prediction)
    risk_level, confidence, explanation = predictor.predict_risk(
        sentiment_score=sentiment,
        sleep=request.sleep_hours,
        screen=request.screen_time,
        activity=request.activity_level
    )
    
    # Compile results
    result = {
        "journal": request.journal,
        "sleep_hours": request.sleep_hours,
        "screen_time": request.screen_time,
        "activity_level": request.activity_level,
        "sentiment_score": round(sentiment, 2),
        "emotion": emotion,
        "risk_level": risk_level,
        "confidence": confidence,
        "explanation": explanation
    }
    
    # Save to Database
    save_prediction(result)
    
    return result

@router.get("/history")
def history():
    return {"history": get_history()}
