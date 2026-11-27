from fastapi import HTTPException
from typing import Optional


class AIServiceException(HTTPException):
    def __init__(self, status_code: int, detail: str, error_code: Optional[str] = None):
        super().__init__(status_code=status_code, detail=detail)
        self.error_code = error_code


class LLMAUnavailableException(AIServiceException):
    def __init__(self):
        super().__init__(status_code=503, detail="AI service temporarily unavailable", error_code="LLM_UNAVAILABLE")


class RateLimitExceededException(AIServiceException):
    def __init__(self):
        super().__init__(status_code=429, detail="Rate limit exceeded", error_code="RATE_LIMIT_EXCEEDED")


class UnauthorizedException(AIServiceException):
    def __init__(self):
        super().__init__(status_code=401, detail="Invalid or missing API key", error_code="UNAUTHORIZED")
