import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import COMPARE_SCHEMA, SCHEMA, connect
from rules import judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    conn.execute(COMPARE_SCHEMA)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, status, verdict, reason,
                          created_by, created_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, verdict, reason,
                    created_by, created_at)
                   VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg, status, verdict, reason,
                             created_by, created_at, processed_at""",
                (turbine_code, yaw_err_deg, user["username"], now),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(insert)
    return jsonify(row), 201


LATEST_DONE_SQL = """
    SELECT id, yaw_err_deg, processed_at
    FROM yaw_logs
    WHERE turbine_code = %s
      AND status = 'done'
      AND processed_at IS NOT NULL
      AND processed_at >= %s
      AND processed_at <= %s
    ORDER BY processed_at DESC, id DESC
    LIMIT 1
"""


def _parse_dt(value, field):
    """解析 ISO 8601 时间；无时区信息时按 UTC 处理。失败抛 ValueError。"""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field}不能为空")
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _serialize_report(row):
    return {
        "id": row["id"],
        "left_turbine": row["left_turbine"],
        "right_turbine": row["right_turbine"],
        "window_start": row["window_start"].isoformat(),
        "cutoff_at": row["cutoff_at"].isoformat(),
        "left_log_id": row["left_log_id"],
        "right_log_id": row["right_log_id"],
        "left_yaw_err_deg": row["left_yaw_err_deg"],
        "right_yaw_err_deg": row["right_yaw_err_deg"],
        "diff_deg": row["diff_deg"],
        "left_available": row["left_yaw_err_deg"] is not None,
        "right_available": row["right_yaw_err_deg"] is not None,
        "recompute_action": row["recompute_action"],
        "created_by": row["created_by"],
        "created_at": row["created_at"].isoformat(),
    }


@app.get("/api/turbines")
@require_login
async def list_turbines(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT DISTINCT turbine_code
                   FROM yaw_logs
                   ORDER BY turbine_code"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify([r["turbine_code"] for r in rows])


@app.post("/api/compare/recompute")
@require_writer
async def recompute_compare(user):
    """邻机误差对照重算。

    四要素必须同捆到一次请求并在同一事务落库：
    左机、右机、时段起、截止时刻（同时携带 recompute_action='recompute'）。
    差值只由后台计算；任一侧窗口内缺办结记录时，误差与差值一律 NULL，不填假数。
    """
    body = await request.get_json(force=True, silent=True) or {}

    # 重算动作标记与截止时刻同捆校验，缺一即拒绝（不算做完）。
    recompute_action = body.get("recompute_action")
    if recompute_action != "recompute":
        return jsonify({"detail": "必须由后台重算动作触发（recompute_action 缺失或不符）"}), 400

    left_turbine = (body.get("left_turbine") or "").strip()
    right_turbine = (body.get("right_turbine") or "").strip()
    if not left_turbine or not right_turbine:
        return jsonify({"detail": "左机与右机均必须选择"}), 400
    if left_turbine == right_turbine:
        return jsonify({"detail": "邻机对照需选择两台不同机组"}), 400

    try:
        window_start = _parse_dt(body.get("window_start"), "时段起点")
        cutoff_at = _parse_dt(body.get("cutoff_at"), "截止时刻")
    except ValueError as exc:
        return jsonify({"detail": str(exc)}), 400

    if cutoff_at < window_start:
        return jsonify({"detail": "截止时刻不得早于时段起点"}), 400

    def do_recompute():
        with connect() as conn:
            with conn.transaction():
                # 取所选时段内两侧各自「最近办结」点；时段外的办结行不会被选中。
                left_row = conn.execute(
                    LATEST_DONE_SQL,
                    (left_turbine, window_start, cutoff_at),
                ).fetchone()
                right_row = conn.execute(
                    LATEST_DONE_SQL,
                    (right_turbine, window_start, cutoff_at),
                ).fetchone()

                # 两侧值各自如实落库；缺办结的一侧保持 NULL，不用 0 或旧数据顶假数。
                # 只有两侧在窗口内都有办结点时，差值才由后台算出，否则差值为 NULL。
                if left_row is not None:
                    left_err = float(left_row["yaw_err_deg"])
                    left_log_id = left_row["id"]
                else:
                    left_err = None
                    left_log_id = None
                if right_row is not None:
                    right_err = float(right_row["yaw_err_deg"])
                    right_log_id = right_row["id"]
                else:
                    right_err = None
                    right_log_id = None
                diff_deg = (
                    round(left_err - right_err, 3)
                    if left_err is not None and right_err is not None
                    else None
                )

                now = datetime.now(timezone.utc)
                row = conn.execute(
                    """INSERT INTO yaw_compare_reports
                       (left_turbine, right_turbine, window_start, cutoff_at,
                        left_log_id, right_log_id,
                        left_yaw_err_deg, right_yaw_err_deg, diff_deg,
                        recompute_action, created_by, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       RETURNING *""",
                    (
                        left_turbine, right_turbine, window_start, cutoff_at,
                        left_log_id, right_log_id,
                        left_err, right_err, diff_deg,
                        "recompute", user["username"], now,
                    ),
                ).fetchone()
            conn.commit()
            return row

    row = await run_db(do_recompute)
    return jsonify(_serialize_report(row)), 201


@app.get("/api/compare/reports")
@require_login
async def list_compare_reports(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT *
                   FROM yaw_compare_reports
                   ORDER BY id DESC
                   LIMIT 50"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify([_serialize_report(r) for r in rows])
