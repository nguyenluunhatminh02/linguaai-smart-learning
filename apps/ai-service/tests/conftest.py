"""Isolate the test environment before any app import.

app.config instantiates Settings at import time. A developer .env may hold
values that are invalid for the boolean DEBUG field (e.g. DEBUG=release),
which breaks pytest collection. Environment variables take precedence over
.env in pydantic-settings, so normalize them here first.
"""

import os

os.environ["APP_ENV"] = "test"
os.environ["NODE_ENV"] = "test"

_VALID_BOOL = {"1", "true", "yes", "on", "0", "false", "no", "off"}
if os.environ.get("DEBUG", "").strip().lower() not in _VALID_BOOL:
    os.environ["DEBUG"] = "false"
