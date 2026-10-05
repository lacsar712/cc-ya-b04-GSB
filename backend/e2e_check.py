"""端到端验证：嵌入式 Postgres + Quart test client，覆盖邻机对照全部口径。"""
import asyncio
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pgserver  # noqa: E402

PGDATA = Path(tempfile.mkdtemp(prefix="yaw-pg-"))


def setup_db():
    server = pgserver.PostgresServer(PGDATA, cleanup_mode="stop")
    server.ensure_pgdata_inited()
    server.ensure_postgres_running()
    uri = server.get_uri()
    # 建 yawalign 库与 app 角色不必要——直接用默认库即可
    import os
    os.environ["DATABASE_URL"] = uri
    return server


async def call(client, method, path, token=None, json=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    fn = getattr(client, method)
    if json is not None:
        return await fn(path, json=json, headers=headers)
    return await fn(path, headers=headers)


async def login(client, username, password):
    res = await client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert res.status_code == 200, await res.get_json()
    return (await res.get_json())["access_token"]


async def main():
    server = setup_db()
    # 延迟导入，确保读到 DATABASE_URL
    import api as api_mod
    import db
    from worker import claim_and_process
    import psycopg

    app = api_mod.app

    # 直接执行 startup 的建表+种子
    def init():
        with db.connect() as conn:
            api_mod.seed_if_empty(conn)
            conn.commit()
    await asyncio.to_thread(init)

    results = []

    def check(name, cond, detail=""):
        results.append((name, bool(cond), detail))
        print(f"{'PASS' if cond else 'FAIL'}  {name}  {detail}")

    async with app.test_app() as tapp:
        client = tapp.test_client()
        tech = await login(client, "technician", "tech123456")
        obs = await login(client, "observer", "obs123456")

        # 机号列表
        res = await call(client, "get", "/api/turbines", tech)
        turbines = await res.get_json()
        check("机号列表含种子 W01/W07", set(["W01", "W07"]).issubset(set(turbines)), str(turbines))

        now = datetime.now(timezone.utc)
        iso = lambda d: d.isoformat()

        # --- 场景1：两侧窗口内均有办结，差值由后台计算 ---
        # 为 W02 造两条办结：一条较早 2.0°，一条较新 2.6°（最近者应被选中）
        def make_rows():
            with db.connect() as conn:
                conn.execute(
                    """INSERT INTO yaw_logs
                       (turbine_code, yaw_err_deg, status, verdict, reason,
                        created_by, created_at, processed_at)
                       VALUES ('W02', 2.0, 'done', '偏航超差', 'old',
                               'technician', %s, %s),
                              ('W02', 2.6, 'done', '偏航超差', 'new',
                               'technician', %s, %s)""",
                    (now - timedelta(hours=5), now - timedelta(hours=5),
                     now - timedelta(hours=1), now - timedelta(hours=1)),
                )
                # W03 窗口外老办结（很早），窗口内无办结
                conn.execute(
                    """INSERT INTO yaw_logs
                       (turbine_code, yaw_err_deg, status, verdict, reason,
                        created_by, created_at, processed_at)
                       VALUES ('W03', 9.9, 'done', '偏航超差', 'out-of-window',
                               'technician', %s, %s)""",
                    (now - timedelta(days=30), now - timedelta(days=30)),
                )
                # W04 有 pending（未办结）记录，窗口内无 done
                conn.execute(
                    """INSERT INTO yaw_logs
                       (turbine_code, yaw_err_deg, status, verdict, reason,
                        created_by, created_at)
                       VALUES ('W04', 1.1, 'pending', NULL, NULL,
                               'technician', %s)""",
                    (now,),
                )
                conn.commit()
        await asyncio.to_thread(make_rows)

        window_start = iso(now - timedelta(days=1))
        cutoff = iso(now)

        body = {
            "recompute_action": "recompute",
            "left_turbine": "W01",
            "right_turbine": "W02",
            "window_start": window_start,
            "cutoff_at": cutoff,
        }
        res = await call(client, "post", "/api/compare/recompute", tech, body)
        check("双侧有办结 201", res.status_code == 201, str(res.status_code))
        rep = await res.get_json()
        check("左值取 W01=0.4", rep["left_yaw_err_deg"] == 0.4, str(rep["left_yaw_err_deg"]))
        check("右值取最近办结 W02=2.6（非旧的2.0）", rep["right_yaw_err_deg"] == 2.6,
              str(rep["right_yaw_err_deg"]))
        check("差值后台计算 0.4-2.6=-2.2", abs(rep["diff_deg"] - (-2.2)) < 1e-9,
              str(rep["diff_deg"]))
        check("动作标记落库 recompute", rep["recompute_action"] == "recompute")
        check("报送人 technician", rep["created_by"] == "technician")
        check("截止时刻同捆落库", rep["cutoff_at"] is not None)

        # --- 场景2：一侧窗口内只有窗口外办结 -> 缺办结，差值 NULL，不填假数 ---
        body2 = dict(body, left_turbine="W01", right_turbine="W03")
        res = await call(client, "post", "/api/compare/recompute", tech, body2)
        rep2 = await res.get_json()
        check("窗口外有办结仍 201", res.status_code == 201)
        check("W03 窗口内缺办结->NULL", rep2["right_yaw_err_deg"] is None,
              str(rep2["right_yaw_err_deg"]))
        check("一侧缺办结->差值NULL不造假", rep2["diff_deg"] is None, str(rep2["diff_deg"]))
        check("左侧真实值仍展示 0.4", rep2["left_yaw_err_deg"] == 0.4)

        # --- 场景3：只有 pending 不算办结 ---
        body3 = dict(body, left_turbine="W01", right_turbine="W04")
        res = await call(client, "post", "/api/compare/recompute", tech, body3)
        rep3 = await res.get_json()
        check("仅 pending -> 缺办结 NULL", rep3["right_yaw_err_deg"] is None
              and rep3["diff_deg"] is None)

        # --- 场景4：待 worker 认领办结后，再次重算应取到新办结 ---
        # 注意：截止时刻是「截至此刻」的快照；worker 办结发生在 now 之后，
        # 故本场景截止取 now+60s，办结点才落在所选时段内。
        def drain_worker():
            with db.connect() as conn:
                processed = 0
                while claim_and_process(conn):
                    conn.commit()
                    processed += 1
                return processed
        n = await asyncio.to_thread(drain_worker)
        check("worker 认领并办结 pending", n >= 1, f"processed={n}")
        body4 = dict(body,
                     left_turbine="W01", right_turbine="W04",
                     cutoff_at=iso(now + timedelta(seconds=60)))
        res = await call(client, "post", "/api/compare/recompute", tech, body4)
        rep4 = await res.get_json()
        check("办结后重算取到 W04=1.1", rep4["right_yaw_err_deg"] == 1.1,
              str(rep4["right_yaw_err_deg"]))
        check("办结后差值=0.4-1.1=-0.7", rep4["diff_deg"] is not None
              and abs(rep4["diff_deg"] - (-0.7)) < 1e-9,
              str(rep4["diff_deg"]))

        # --- 场景5：时段之外的办结点不计入：用更窄窗口（近2小时），W01 种子 now 时刻在窗内，
        # W02 最近办结 1 小时前在窗内；再用过去窗口（30~20 天前）两侧都无 -> 全 NULL ---
        body5 = dict(body,
                     window_start=iso(now - timedelta(days=30)),
                     cutoff_at=iso(now - timedelta(days=20)))
        res = await call(client, "post", "/api/compare/recompute", tech, body5)
        rep5 = await res.get_json()
        check("纯窗口外->两侧NULL", rep5["left_yaw_err_deg"] is None
              and rep5["right_yaw_err_deg"] is None and rep5["diff_deg"] is None)

        # --- 同捆校验：缺动作标记 / 缺截止 / 缺机号 一律 400 ---
        bad1 = {k: v for k, v in body.items() if k != "recompute_action"}
        res = await call(client, "post", "/api/compare/recompute", tech, bad1)
        check("缺 recompute_action -> 400", res.status_code == 400, str(res.status_code))

        bad2 = {k: v for k, v in body.items() if k != "cutoff_at"}
        res = await call(client, "post", "/api/compare/recompute", tech, bad2)
        check("缺截止时刻 -> 400", res.status_code == 400, str(res.status_code))

        bad3 = dict(body, left_turbine="")
        res = await call(client, "post", "/api/compare/recompute", tech, bad3)
        check("缺左机 -> 400", res.status_code == 400)

        bad4 = dict(body, left_turbine="W01", right_turbine="W01")
        res = await call(client, "post", "/api/compare/recompute", tech, bad4)
        check("左右同机 -> 400", res.status_code == 400)

        bad5 = dict(body, window_start=cutoff, cutoff_at=window_start)
        res = await call(client, "post", "/api/compare/recompute", tech, bad5)
        check("截止早于起点 -> 400", res.status_code == 400)

        # --- 权限：观察岗不能报送，但可读取 ---
        res = await call(client, "post", "/api/compare/recompute", obs, body)
        check("观察岗报送 -> 403", res.status_code == 403, str(res.status_code))
        res = await call(client, "get", "/api/compare/reports", obs)
        check("观察岗可查重算记录", res.status_code == 200)
        reports = await res.get_json()
        check("历史记录数=5（场景1-5）", len(reports) == 5, f"n={len(reports)}")

        res = await call(client, "get", "/api/compare/reports", tech)
        check("技师可查重算记录", res.status_code == 200)

        # 未登录 401
        res = await call(client, "post", "/api/compare/recompute", None, body)
        check("未登录报送 -> 401", res.status_code == 401)

        # 落库事实：所有报告行 recompute_action 非空、cutoff 非空（同捆留痕）
        def assert_rows():
            with db.connect() as conn:
                return conn.execute(
                    """SELECT count(*) AS n FROM yaw_compare_reports
                       WHERE recompute_action IS DISTINCT FROM 'recompute'
                          OR cutoff_at IS NULL"""
                ).fetchone()["n"]
        bad_rows = await asyncio.to_thread(assert_rows)
        check("库中无动作/截止缺失行", bad_rows == 0, f"bad={bad_rows}")

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    server.cleanup()
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
