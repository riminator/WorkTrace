"""
Database setup: SQLAlchemy engine, session factory, and ORM model for documents.
Runs CREATE EXTENSION IF NOT EXISTS vector and creates the table on first use.
"""
from __future__ import annotations

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    JSON,
    String,
    Text,
    create_engine,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from kb.config import DATABASE_URL, EMBED_DIMENSIONS


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"options": "-csearch_path=public"},
)
SessionLocal: sessionmaker[Session] = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Document(Base):
    """One row per text chunk extracted from a source file."""

    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), nullable=True, index=True)      # Supabase auth.uid() UUID string
    source = Column(String(1024), nullable=False, index=True)    # original file path
    file_type = Column(String(64), nullable=False)               # pdf / txt / image / docx / …
    chunk_index = Column(Integer, nullable=False, default=0)     # position within the source file
    content = Column(Text, nullable=False)                       # raw text of this chunk
    embedding = Column(Vector(EMBED_DIMENSIONS), nullable=True)  # pgvector column
    created_at = Column(DateTime, default=datetime.utcnow)
    doc_metadata = Column(JSON, nullable=True)                   # structured fields: meeting_date, title, etc.


def init_db() -> None:
    """Enable the pgvector extension and create all tables."""
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    # Migrations for tables that predate multi-tenancy
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_metadata JSONB"
        ))
        conn.execute(text(
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id VARCHAR(36)"
        ))
        conn.commit()


def get_session() -> Session:
    """Return a new database session (caller must close it)."""
    return SessionLocal()
