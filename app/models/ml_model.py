import numpy as np
from sklearn.ensemble import RandomForestClassifier

# We simulate a pre-trained model since we don't have a massive dataset available.
# In a real production scenario, this would load a .pkl model file.

class MentalHealthPredictor:
    def __init__(self):
        # Initialize a dummy RandomForest for demonstration of the ML pipeline
        self.model = RandomForestClassifier(n_estimators=100, random_state=42)
        
        # Simulated dummy training data
        # Features: [sentiment_score, sleep_hours, screen_time, activity_level]
        X_dummy = np.array([
            [0.8, 8, 2, 8000],  # Low risk
            [-0.9, 4, 10, 1000], # High risk
            [0.1, 6, 6, 4000],  # Medium risk
            [-0.5, 5, 8, 2000], # High risk
            [0.5, 7, 4, 6000]   # Low risk
        ])
        y_dummy = np.array([0, 2, 1, 2, 0]) # 0: Low, 1: Medium, 2: High
        self.model.fit(X_dummy, y_dummy)

    def predict_risk(self, sentiment_score: float, sleep: float, screen: float, activity: int):
        features = np.array([[sentiment_score, sleep, screen, activity]])
        
        pred_class = self.model.predict(features)[0]
        probabilities = self.model.predict_proba(features)[0]
        confidence = round(max(probabilities) * 100, 2)
        
        labels = ["Low", "Medium", "High"]
        risk_level = labels[pred_class]
        
        # Generate simple explainability feature (simulating SHAP/LIME)
        reasons = []
        if sentiment_score < 0:
            reasons.append("negative sentiment in journal")
        if sleep < 6:
            reasons.append("low sleep duration")
        if screen > 6:
            reasons.append("high screen time")
        if activity < 3000:
            reasons.append("low physical activity")
            
        if not reasons:
            explanation = "Healthy indicators across the board."
        else:
            explanation = f"{risk_level} risk primarily influenced by " + ", ".join(reasons) + "."

        return risk_level, confidence, explanation

predictor = MentalHealthPredictor()
