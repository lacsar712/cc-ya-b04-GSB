import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from compare import build_comparison
from rules import THRESHOLD_DEG, judge

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


def require_reporter(message):
    """报送类动作（如邻机对照重算）仅技师可用，观察岗一律 403。"""

    def decorator(handler):
        @wraps(handler)
        async def wrapper(*args, **kwargs):
            user = await current_user()
            if user is None:
                return jsonify({"detail": "未登录"}), 401
            if user["role"] != "writer":
                return jsonify({"detail": message}), 403
            return await handler(user, *args, **kwargs)

        return wrapper

    return decorator


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def parse_ts(value, field):
    """解析 ISO 时间字符串；空值返回 (None, None)，非法值返回 (None, 错误)。"""
    if value is None:
        return None, None
    if not isinstance(value, str) or not value.strip():
        return None, f"{field}必须是 ISO 时间字符串"
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None, f"{field}不是合法时间"
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed, None


def comparison_json(row):
    return {
        "id": row["id"],
        "left_code": row["left_code"],
        "right_code": row["right_code"],
        "since_at": iso(row["since_at"]),
        "cutoff_at": iso(row["cutoff_at"]),
        "left_log_id": row["left_log_id"],
        "right_log_id": row["right_log_id"],
        "left_err_deg": row["left_err_deg"],
        "right_err_deg": row["right_err_deg"],
        "left_processed_at": iso(row["left_processed_at"]),
        "right_processed_at": iso(row["right_processed_at"]),
        "diff_deg": row["diff_deg"],
        "missing": row["missing"],
        "created_by": row["created_by"],
        "created_at": iso(row["created_at"]),
    }


COMPARISON_SELECT = """
    SELECT c.id, c.left_code, c.right_code, c.since_at, c.cutoff_at,
           c.left_log_id, c.right_log_id, c.left_err_deg, c.right_err_deg,
           c.diff_deg, c.missing, c.created_by, c.created_at,
           l.processed_at AS left_processed_at,
           r.processed_at AS right_processed_at
    FROM yaw_comparisons c
    LEFT JOIN yaw_logs l ON l.id = c.left_log_id
    LEFT JOIN yaw_logs r ON r.id = c.right_log_id
"""


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


@app.get("/api/turbines")
@require_login
async def list_turbines(user):
    def query():
        with connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT turbine_code FROM yaw_logs ORDER BY turbine_code"
            ).fetchall()
            return [r["turbine_code"] for r in rows]

    return jsonify(await run_db(query))


@app.get("/api/compare/spec")
@require_login
async def compare_spec(user):
    """对照口径，只读展示，前端不得改动。"""
    return jsonify(
        {
            "threshold_deg": THRESHOLD_DEG,
            "verdict_rule": f"偏航误差绝对值 ≤ {THRESHOLD_DEG}° 判「合格」，否则「偏航超差」",
            "diff_rule": "差值 = 左机最近办结误差 − 右机最近办结误差，仅由后台重算得出，页面不得手算相减",
            "window_rule": "仅统计办结时间不晚于所选截止时刻的记录（填了时段起点时亦不早于起点），时段之外的办结点不计入本次",
            "missing_rule": "任一侧缺办结记录时，对应侧与差值一律留空，不填假数",
        }
    )


@app.post("/api/comparisons")
@require_reporter("观察岗只读，仅现场技师可报送重算")
async def create_comparison(user):
    body = await request.get_json(force=True, silent=True) or {}
    left_code = (body.get("left_code") or "").strip()
    right_code = (body.get("right_code") or "").strip()

    # 重算动作与选定的截止时刻必须同捆提交，缺一不算做完
    cutoff_at, err = parse_ts(body.get("cutoff_at"), "截止时刻")
    if err:
        return jsonify({"detail": err}), 400
    if not left_code or not right_code or cutoff_at is None:
        return jsonify({"detail": "左机、右机与截止时刻须同捆提交，缺一不可"}), 400
    if left_code == right_code:
        return jsonify({"detail": "左机与右机不能是同一机组"}), 400

    since_at, err = parse_ts(body.get("since_at"), "时段起点")
    if err:
        return jsonify({"detail": err}), 400
    if since_at is not None and since_at > cutoff_at:
        return jsonify({"detail": "时段起点不能晚于截止时刻"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            result = build_comparison(conn, left_code, right_code, since_at, cutoff_at)
            left = result["left"]
            right = result["right"]
            row = conn.execute(
                """INSERT INTO yaw_comparisons
                   (left_code, right_code, since_at, cutoff_at,
                    left_log_id, right_log_id, left_err_deg, right_err_deg,
                    diff_deg, missing, created_by, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    left_code,
                    right_code,
                    since_at,
                    cutoff_at,
                    left["id"] if left else None,
                    right["id"] if right else None,
                    float(left["yaw_err_deg"]) if left else None,
                    float(right["yaw_err_deg"]) if right else None,
                    result["diff_deg"],
                    result["missing"],
                    user["username"],
                    now,
                ),
            ).fetchone()
            saved = conn.execute(
                COMPARISON_SELECT + " WHERE c.id = %s", (row["id"],)
            ).fetchone()
            conn.commit()
            return saved

    row = await run_db(insert)
    return jsonify(comparison_json(row)), 201


@app.get("/api/comparisons")
@require_login
async def list_comparisons(user):
    left = (request.args.get("left") or "").strip()
    right = (request.args.get("right") or "").strip()

    def query():
        sql = COMPARISON_SELECT
        params = []
        clauses = []
        if left:
            clauses.append("c.left_code = %s")
            params.append(left)
        if right:
            clauses.append("c.right_code = %s")
            params.append(right)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY c.id DESC LIMIT 20"
        with connect() as conn:
            return conn.execute(sql, params).fetchall()

    rows = await run_db(query)
    return jsonify([comparison_json(r) for r in rows])
