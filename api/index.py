"""Vercel Python function: every /api/* request is rewritten here (see vercel.json)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ava_server.app import app  # noqa: E402,F401
