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
"""

# 邻机误差对照：每次「后台重算」落一行。
# 差值只由后台算出；任一侧在所选时段内没有办结记录时，对应列与差值均为 NULL，禁止填假数。
# recompute_action 固定为 'recompute'，与截止时刻同捆落库，缺一不可。
COMPARE_SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_compare_reports (
    id serial PRIMARY KEY,
    left_turbine text NOT NULL,
    right_turbine text NOT NULL,
    window_start timestamptz NOT NULL,
    cutoff_at timestamptz NOT NULL,
    left_log_id integer REFERENCES yaw_logs(id),
    right_log_id integer REFERENCES yaw_logs(id),
    left_yaw_err_deg double precision,
    right_yaw_err_deg double precision,
    diff_deg double precision,
    recompute_action text NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
"""
