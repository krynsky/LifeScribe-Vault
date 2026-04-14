from __future__ import annotations


class LLMError(Exception):
    """Base for all LLM subsystem errors."""

    code: str = "llm_error"


class PrivacyViolation(LLMError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code
