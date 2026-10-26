import pytest
from pydantic import ValidationError

from app.config import Settings


def test_production_requires_postgresql_database_url():
    with pytest.raises(ValidationError, match="DATABASE_URL must be configured with PostgreSQL"):
        Settings(_env_file=None, app_env="production")

    with pytest.raises(ValidationError, match="DATABASE_URL must be configured with PostgreSQL"):
        Settings(
            _env_file=None,
            app_env="production",
            database_url="sqlite:///./aurum_edge.db",
        )


def test_production_accepts_postgresql_database_urls():
    for database_url in (
        "postgres://db.example/aurum_edge",
        "postgresql://db.example/aurum_edge",
        "postgresql+psycopg://db.example/aurum_edge",
    ):
        settings = Settings(
            _env_file=None,
            app_env="production",
            database_url=database_url,
        )
        assert settings.database_url == database_url


def test_development_retains_local_sqlite_default(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    settings = Settings(_env_file=None, app_env="development")
    assert settings.database_url == "sqlite:///./aurum_edge.db"
