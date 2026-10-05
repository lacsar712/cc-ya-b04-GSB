"""邻机误差对照：只认落在所选时段内的办结记录，差值一律由后台重算。

页面不得手算相减；任一侧缺办结时 diff_deg 为 None，不填假数。
"""


def latest_done(conn, turbine_code, since_at, cutoff_at):
    """所选时段内最近一条办结记录。

    只统计 status='done' 且 processed_at 不晚于截止时刻的行；
    给了时段起点时，早于起点的办结点同样不计入本次。
    """
    return conn.execute(
        """SELECT id, turbine_code, yaw_err_deg, processed_at
           FROM yaw_logs
           WHERE status = 'done'
             AND turbine_code = %s
             AND processed_at <= %s
             AND (%s::timestamptz IS NULL OR processed_at >= %s)
           ORDER BY processed_at DESC, id DESC
           LIMIT 1""",
        (turbine_code, cutoff_at, since_at, since_at),
    ).fetchone()


def build_comparison(conn, left_code, right_code, since_at, cutoff_at):
    """对左右两机各取时段内最近办结，后台算出差值。

    返回 dict：left/right 为 yaw_logs 行（缺办结为 None），
    diff_deg 仅当两侧都有办结时才计算，否则为 None 且 missing 标明缺哪侧。
    """
    left = latest_done(conn, left_code, since_at, cutoff_at)
    right = latest_done(conn, right_code, since_at, cutoff_at)

    missing = None
    if left is None and right is None:
        missing = "both"
    elif left is None:
        missing = "left"
    elif right is None:
        missing = "right"

    diff_deg = None
    if missing is None:
        diff_deg = round(float(left["yaw_err_deg"]) - float(right["yaw_err_deg"]), 3)

    return {"left": left, "right": right, "diff_deg": diff_deg, "missing": missing}
