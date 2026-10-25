from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Aurum Edge"
    database_url: str = "sqlite:///./aurum_edge.db"
    debug: bool = False
    max_upload_bytes: int = 20_000_000
    stale_after_days: int = 5
    minimum_daily_volume: float = 1.0
    expiry_guard_days: int = 3
    minimum_zscore_history: int = 20
    anomaly_zscore_threshold: float = 2.5
    render_api_key: str | None = None
    render_workflow_task_slug: str | None = None


settings = Settings()
