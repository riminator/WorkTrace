"""
auth.py — Supabase JWT validation for FastAPI.

Supabase projects may sign JWTs with either:
  - HS256 using the project JWT secret (older projects)
  - ES256 using a rotating asymmetric key fetched from the JWKS endpoint (newer projects)

This module handles both. It first attempts ES256 via JWKS, falling back to
HS256 with the static secret if JWKS is unavailable or the token uses HS256.

Required env vars:
  SUPABASE_JWT_SECRET  — JWT Secret from Supabase → Project Settings → API
  SUPABASE_URL         — Project URL from Supabase → Project Settings → API
                         (used to construct the JWKS endpoint)
"""
from __future__ import annotations

import logging
import threading
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from kb.config import SUPABASE_JWT_SECRET, SUPABASE_URL

log = logging.getLogger(__name__)

_bearer = HTTPBearer()

# ── JWKS cache ────────────────────────────────────────────────────────────────
# Fetched once on first use, refreshed if a kid is not found.

_jwks_lock   = threading.Lock()
_jwks_keys:  dict[str, Any] = {}   # kid → PyJWT key object
_jwks_loaded = False


def _load_jwks() -> None:
    """Fetch the Supabase JWKS and cache key objects by kid."""
    global _jwks_loaded
    if not SUPABASE_URL:
        return
    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
        for jwk in resp.json().get("keys", []):
            kid = jwk.get("kid")
            if kid:
                _jwks_keys[kid] = jwt.algorithms.ECAlgorithm.from_jwk(jwk)
        _jwks_loaded = True
        log.info("Loaded %d JWKS key(s) from %s", len(_jwks_keys), url)
    except Exception as exc:
        log.warning("Could not load Supabase JWKS: %s", exc)


def _get_jwks_key(kid: str) -> Any | None:
    """Return the cached public key for *kid*, reloading JWKS if not found."""
    with _jwks_lock:
        if kid not in _jwks_keys:
            _load_jwks()
        return _jwks_keys.get(kid)


# ── JWT validation ────────────────────────────────────────────────────────────

def _decode_token(token: str) -> dict:
    """
    Decode and verify a Supabase JWT.

    Tries ES256 via JWKS first (newer Supabase projects), then falls back
    to HS256 with the static SUPABASE_JWT_SECRET (older projects).
    """
    # Peek at the header without verifying to find alg + kid
    try:
        header = jwt.get_unverified_header(token)
    except jwt.DecodeError as exc:
        raise jwt.InvalidTokenError(f"Malformed token header: {exc}")

    alg = header.get("alg", "HS256")
    kid = header.get("kid")

    # ── ES256 path (JWKS) ──────────────────────────────────────────────────────
    if alg == "ES256" and kid:
        key = _get_jwks_key(kid)
        if key:
            return jwt.decode(
                token,
                key,
                algorithms=["ES256"],
                options={"verify_aud": False},
            )
        # kid not found even after reload — fall through to HS256 as last resort
        log.warning("ES256 kid '%s' not found in JWKS, falling back to HS256", kid)

    # ── HS256 path (static secret) ────────────────────────────────────────────
    if not SUPABASE_JWT_SECRET:
        raise jwt.InvalidTokenError("No SUPABASE_JWT_SECRET configured and JWKS key not available.")

    return jwt.decode(
        token,
        SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """
    Validate the Supabase JWT in the Authorization header and return the user's
    UUID string (``sub`` claim), which is stable and unique per Supabase user.

    Raises HTTP 401 if the token is missing, expired, or has an invalid signature.
    """
    token = credentials.credentials
    try:
        payload = _decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired.")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}")

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has no sub claim.")

    return user_id
