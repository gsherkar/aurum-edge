from importlib import import_module

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

Base = declarative_base()

database_url = settings.database_url
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(
    database_url,
    connect_args={"check_same_thread": False} if database_url.startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    import_module(".models", package=__package__)
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "sqlite":
        migrations = {
            "contract_specs": {
                "data_mode": "VARCHAR NOT NULL DEFAULT 'historical_file'",
                "conversion_factor": "FLOAT NOT NULL DEFAULT 1.0",
            },
            "market_observations": {
                "expiry_date": "DATE",
            },
            "import_batches": {
                "fallback_data_date": "DATE",
                "column_mapping": "TEXT",
            },
            "market_alerts": {
                "import_id": "VARCHAR NOT NULL DEFAULT 'legacy'",
                "liquidity_guard": "BOOLEAN NOT NULL DEFAULT 0",
                "stale_data_guard": "BOOLEAN NOT NULL DEFAULT 0",
                "data_quality_guard": "BOOLEAN NOT NULL DEFAULT 0",
                "explanation": "TEXT NOT NULL DEFAULT ''",
            },
        }
        inspector = inspect(engine)
        legacy_contract_uniqueness = any(
            set(constraint.get("column_names") or []) == {"symbol", "effective_start"}
            for constraint in inspector.get_unique_constraints("contract_specs")
        ) if inspector.has_table("contract_specs") else False
        with engine.begin() as connection:
            for table_name, columns in migrations.items():
                if not inspector.has_table(table_name):
                    continue
                existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
                for column_name, column_type in columns.items():
                    if column_name not in existing_columns:
                        connection.execute(
                            text(f'ALTER TABLE "{table_name}" ADD COLUMN "{column_name}" {column_type}')
                        )
            if inspector.has_table("contract_specs"):
                connection.execute(
                    text(
                        "UPDATE contract_specs SET verification_status = 'unverified' "
                        "WHERE verification_status NOT IN ('verified', 'unverified', 'demo-only')"
                    )
                )
            if legacy_contract_uniqueness:
                connection.execute(
                    text(
                        """
                        CREATE TABLE contract_specs_migrated (
                            id INTEGER NOT NULL PRIMARY KEY,
                            symbol VARCHAR NOT NULL,
                            data_mode VARCHAR NOT NULL DEFAULT 'historical_file',
                            contract_quantity FLOAT NOT NULL,
                            quotation_unit VARCHAR NOT NULL,
                            quotation_basis VARCHAR NOT NULL,
                            purity FLOAT,
                            conversion_factor FLOAT NOT NULL DEFAULT 1.0,
                            delivery_location VARCHAR,
                            effective_start DATE NOT NULL,
                            effective_end DATE,
                            expiry_date DATE,
                            settlement_info VARCHAR,
                            conversion_parameters VARCHAR,
                            specification_source VARCHAR NOT NULL,
                            verification_status VARCHAR NOT NULL DEFAULT 'unverified',
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL,
                            CONSTRAINT uq_contract_spec_version
                                UNIQUE (symbol, data_mode, effective_start, expiry_date)
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO contract_specs_migrated (
                            id, symbol, data_mode, contract_quantity, quotation_unit,
                            quotation_basis, purity, conversion_factor, delivery_location,
                            effective_start, effective_end, expiry_date, settlement_info,
                            conversion_parameters, specification_source, verification_status,
                            created_at, updated_at
                        )
                        SELECT id, symbol, data_mode, contract_quantity, quotation_unit,
                               quotation_basis, purity, conversion_factor, delivery_location,
                               effective_start, effective_end, expiry_date, settlement_info,
                               conversion_parameters, specification_source, verification_status,
                               COALESCE(created_at, CURRENT_TIMESTAMP),
                               COALESCE(updated_at, CURRENT_TIMESTAMP)
                        FROM contract_specs
                        """
                    )
                )
                connection.execute(text("DROP TABLE contract_specs"))
                connection.execute(text("ALTER TABLE contract_specs_migrated RENAME TO contract_specs"))
                connection.execute(text("CREATE INDEX ix_contract_specs_id ON contract_specs (id)"))
                connection.execute(text("CREATE INDEX ix_contract_specs_symbol ON contract_specs (symbol)"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
