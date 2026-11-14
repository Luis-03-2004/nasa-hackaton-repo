import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


STORAGE = os.getenv("FIRE_STORAGE", "parquet")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://hotspots:hotspots@localhost:5432/hotspots",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    if STORAGE == "parquet":
        yield None
        return
    with SessionLocal() as session:
        yield session
