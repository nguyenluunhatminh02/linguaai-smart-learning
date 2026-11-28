"""Request-scoped context.

A contextvar carries the *server-sanitized* request id through logging and
rate-limit keying. Every request must set it and reset it in ``finally`` so a
pooled worker never reuses the previous request's id.
"""

from __future__ import annotations

import contextvars
from typing import Optional

request_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "request_id", default=None
)


def get_request_id() -> Optional[str]:
    return request_id_var.get()


def set_request_id(request_id: Optional[str]):
    """Set the id and return the token needed to restore the prior value."""
    return request_id_var.set(request_id)


def reset_request_id(token) -> None:
    """Restore the contextvar using the token from :func:`set_request_id`."""
    if token is not None:
        request_id_var.reset(token)
