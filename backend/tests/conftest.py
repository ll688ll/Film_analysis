"""Shared pytest fixtures for the Film Analysis backend test suite."""

import os
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app

# ---------------------------------------------------------------------------
# Test database (async SQLite via aiosqlite)
# ---------------------------------------------------------------------------

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DB_URL, echo=False)
TestSessionLocal = async_sessionmaker(
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def _override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# Override the dependency globally for the whole test session
app.dependency_overrides[get_db] = _override_get_db


# ---------------------------------------------------------------------------
# Database lifecycle
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(autouse=True)
async def _setup_db():
    """Create all tables before each test and drop them afterwards."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Initialise the in-memory image cache expected by the app
    app.state.image_cache = {}
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


# ---------------------------------------------------------------------------
# HTTP client fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def client():
    """Unauthenticated async HTTP client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_client(client: AsyncClient):
    """
    Authenticated async HTTP client.

    Registers a fresh user, obtains a JWT, and returns a client with the
    Authorization header pre-set.
    """
    register_payload = {
        "username": "testuser",
        "email": "testuser@example.com",
        "password": "testpass123",
    }
    resp = await client.post("/api/auth/register", json=register_payload)
    assert resp.status_code == 201, f"Registration failed: {resp.text}"

    token = resp.json()["access_token"]

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# Test film fixture
# ---------------------------------------------------------------------------

TEST_FILM_PATH = r"d:\LocProj\playground\Film_analysis\test\CAL_007.tif"


@pytest.fixture
def test_film_path():
    """Return the path to the test calibration film scan.

    Skips the test automatically if the file is not available.
    """
    p = Path(TEST_FILM_PATH)
    if not p.exists():
        pytest.skip(f"Test film not found at {TEST_FILM_PATH}")
    return str(p)
