import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS yaw_comparisons (
    id serial PRIMARY KEY,
    left_code text NOT NULL,
    right_code text NOT NULL,
    since_at timestamptz,
    cutoff_at timestamptz NOT NULL,
    left_log_id integer REFERENCES yaw_logs (id),
    right_log_id integer REFERENCES yaw_logs (id),
    left_err_deg double precision,
    right_err_deg double precision,
    diff_deg double precision,
    missing text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
"""
