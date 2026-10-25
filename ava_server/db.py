"""Database access.

Two contexts:
* `system(actor)` runs as the connection's own role (service role on
  Supabase), bypassing RLS. Used for agents, scoring and scheduled jobs.
* `as_user(user_id)` switches to the `authenticated` role with the user's JWT
  claims for the transaction, so row-level security enforces the spec 4.8
  matrix on every user write.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

from .config import settings

_conn_url: str | None = None


def configure(url: str) -> None:
    """Override the database URL (tests)."""
    global _conn_url
    _conn_url = url


def _url() -> str:
    url = _conn_url or settings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


@contextmanager
def _transaction() -> Iterator[psycopg.Connection]:
    with psycopg.connect(_url(), row_factory=dict_row, autocommit=False, prepare_threshold=None) as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


@contextmanager
def system(actor: str = "AVA") -> Iterator[psycopg.Connection]:
    with _transaction() as conn:
        conn.execute("select set_config('app.actor', %s, true)", (actor,))
        yield conn


@contextmanager
def as_user(user_id: str, aal: str = "aal2") -> Iterator[psycopg.Connection]:
    # The API checks the second factor before acting (auth.current_user), so its
    # own calls carry aal2; tests pass aal1 to exercise the database rule.
    with _transaction() as conn:
        claims = json.dumps({"sub": str(user_id), "role": "authenticated", "aal": aal})
        conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
        conn.execute("set local role authenticated")
        yield conn


def one(conn: psycopg.Connection, sql: str, params=()) -> dict | None:
    return conn.execute(sql, params).fetchone()


def all_rows(conn: psycopg.Connection, sql: str, params=()) -> list[dict]:
    return conn.execute(sql, params).fetchall()


def jsonb(value) -> psycopg.types.json.Jsonb:
    return psycopg.types.json.Jsonb(value)
