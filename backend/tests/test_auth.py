"""Tests for authentication endpoints: register, login, /me."""

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

async def test_register_new_user(client: AsyncClient):
    """Registering a new user returns 201 with a valid JWT."""
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "newuser",
            "email": "new@example.com",
            "password": "secret123",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_register_duplicate_username(client: AsyncClient):
    """Registering a duplicate username returns 409."""
    payload = {
        "username": "dupuser",
        "email": "dup1@example.com",
        "password": "secret123",
    }
    resp1 = await client.post("/api/auth/register", json=payload)
    assert resp1.status_code == 201

    # Same username, different email
    payload2 = {**payload, "email": "dup2@example.com"}
    resp2 = await client.post("/api/auth/register", json=payload2)
    assert resp2.status_code == 409
    assert "Username already registered" in resp2.json()["detail"]


async def test_register_duplicate_email(client: AsyncClient):
    """Registering a duplicate email returns 409."""
    payload = {
        "username": "emailuser1",
        "email": "same@example.com",
        "password": "secret123",
    }
    resp1 = await client.post("/api/auth/register", json=payload)
    assert resp1.status_code == 201

    payload2 = {**payload, "username": "emailuser2"}
    resp2 = await client.post("/api/auth/register", json=payload2)
    assert resp2.status_code == 409
    assert "Email already registered" in resp2.json()["detail"]


async def test_register_short_password(client: AsyncClient):
    """Password shorter than 6 characters is rejected with 422."""
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "shortpw",
            "email": "short@example.com",
            "password": "abc",
        },
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

async def test_login_correct_credentials(client: AsyncClient):
    """Login with correct credentials returns a JWT."""
    await client.post(
        "/api/auth/register",
        json={
            "username": "loginuser",
            "email": "login@example.com",
            "password": "goodpass",
        },
    )

    resp = await client.post(
        "/api/auth/login",
        json={"username": "loginuser", "password": "goodpass"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_login_wrong_password(client: AsyncClient):
    """Login with the wrong password returns 401."""
    await client.post(
        "/api/auth/register",
        json={
            "username": "wrongpw",
            "email": "wrongpw@example.com",
            "password": "correctpass",
        },
    )

    resp = await client.post(
        "/api/auth/login",
        json={"username": "wrongpw", "password": "badpass"},
    )
    assert resp.status_code == 401
    assert "Invalid credentials" in resp.json()["detail"]


async def test_login_nonexistent_user(client: AsyncClient):
    """Login with a username that does not exist returns 401."""
    resp = await client.post(
        "/api/auth/login",
        json={"username": "ghost", "password": "nope"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /me endpoint
# ---------------------------------------------------------------------------

async def test_me_authenticated(auth_client: AsyncClient):
    """GET /me with a valid token returns the current user's info."""
    resp = await auth_client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "testuser"
    assert data["email"] == "testuser@example.com"
    assert data["is_active"] is True


async def test_me_unauthenticated(client: AsyncClient):
    """GET /me without a token returns 401."""
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_me_invalid_token(client: AsyncClient):
    """GET /me with a garbage token returns 401."""
    resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert resp.status_code == 401
