from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Aurum Edge"
    app_env: Literal["development", "production"] = "development"
    database_url: str = "sqlite:///./aurum_edge.db"
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    debug: bool = False
    max_upload_bytes: int = 20_000_000
    stale_after_days: int = 5
    minimum_daily_volume: float = 1.0
    expiry_guard_days: int = 3
    minimum_zscore_history: int = 20
    anomaly_zscore_threshold: float = 2.5
    render_api_key: str | None = None
    render_workflow_task_slug: str | None = None

    @model_validator(mode="after")
    def require_postgres_in_production(self) -> "Settings":
        if self.app_env == "production" and not self.database_url.startswith(
            ("postgres://", "postgresql://", "postgresql+psycopg://")
        ):
            raise ValueError("DATABASE_URL must be configured with PostgreSQL in production")
        return self


settings = Settings()
