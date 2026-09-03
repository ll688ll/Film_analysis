from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.auth import ALGORITHM
from app.database import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _auth_error(detail: str, code: str) -> HTTPException:
    """
    A 401 that says *why* it failed.

    Every rejection used to return the same "Could not validate credentials",
    which made an ordinary expired session indistinguishable from a changed
    SECRET_KEY or a deleted user -- undebuggable from the browser. The code
    travels in X-Auth-Error so the frontend can pick the right message.
    """
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer", "X-Auth-Error": code},
    )


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except ExpiredSignatureError:
        # Subclasses JWTError, so it has to be caught first.
        raise _auth_error("Session expired", "token_expired")
    except JWTError:
        raise _auth_error("Could not validate credentials", "invalid_token")

    username: str | None = payload.get("sub")
    user_id: int | None = payload.get("user_id")
    if username is None or user_id is None:
        raise _auth_error("Could not validate credentials", "invalid_token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise _auth_error("Account no longer exists", "user_not_found")
    if not user.is_active:
        raise _auth_error("Account is disabled", "user_inactive")

    return user
