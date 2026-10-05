# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

顶栏另设「邻机误差对照」专页：值班时对照相邻两机谁偏得更狠，选左机/右机与所选时段（含截止时刻）后由**后台重算**取两机在时段内各自最近一次「已办结」误差及二者差值，页面只读展示。

## 邻机误差对照口径（硬规则）

1. **上方选择**：左机、右机、时段起点、截止时刻；**中间列**：左机最近办结误差、二者差值、右机最近办结误差；**下方口径只读**。
2. **差值只能后台重算**：页面不做任何手算相减，中间三列只渲染 `POST /api/compare/recompute` 的返回值；临时填差值而未触发后台重算视为未完成（任一选择项变更即清空上次结果）。
3. **缺办结不造假数**：任一侧在所选时段内无办结（仅有窗口外办结或仅有待处理）时，该侧误差与差值留 `—` / NULL；另一侧真实值仍如实展示。
4. **时段外不计入**：只取 `processed_at` 落在 `[时段起点, 截止时刻]` 内、`status='done'` 的最近一条。
5. **动作与截止同捆**：请求必须同时携带 `recompute_action="recompute"` 与 `cutoff_at`（及左机/右机/时段起），缺一返回 400，且四要素在同一事务落库留痕。
6. **权限**：技师（writer）可触发重算报送；观察岗（reader）可选机号、查看结果与历史，但无报送按钮，强报返回 403。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交 |
| observer | obs123456 | 只读 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. 顶栏「邻机误差对照」：
   - technician 选左机/右机/时段后点「触发后台重算」，中间三列显示左机最近办结°、差值（左−右）°、右机最近办结°；
   - observer 进入专页只能选择与查看，无重算按钮，直接调接口返回 403；
   - 一侧时段内无办结时该侧与差值显示「—」，不出现 0 或旧数据；
   - 未点重算（或改动任一选择项）时中间三列不显示任何差值。

## 对照接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/turbines` | 登录 | 已有记录的机号下拉 |
| POST | `/api/compare/recompute` | writer | 同捆提交 `recompute_action`、`left_turbine`、`right_turbine`、`window_start`、`cutoff_at`；事务内取窗口内最近办结并由后台算出差值，落 `yaw_compare_reports` |
| GET | `/api/compare/reports` | 登录 | 最近 50 次后台重算留痕（只读） |

可选端到端自检（需本机 Python，内嵌 pgserver，无需 docker）：

```bash
cd backend
pip install -r requirements.txt pgserver
python3 e2e_check.py
```

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
