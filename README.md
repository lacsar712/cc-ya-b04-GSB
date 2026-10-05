# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

顶栏设有「邻机误差对照」专页：选左机、右机与截止时刻（时段起点可选）后点「后台重算差值」，后台取两台机组在所选时段内各自的最近办结记录，算出二者差值（左 − 右）并落库；中间列展示两侧最近办结与差值，下方为只读口径。

对照口径（硬性约束）：

- 差值只能由后台重算得出，页面不得手算相减；页面临时填了差值却未触发后台重算视为未完成。
- 重算动作与选定的截止时刻必须同捆提交，缺一不可（缺任一项接口返回 400）。
- 落在所选时段之外的办结点不计入本次对照。
- 任一侧缺办结记录时，中间列对应侧与差值一律留空，不填假数。
- 技师（writer）可选机号并报送重算；观察岗（reader）只读，不能报送（接口返回 403）。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交、可报送重算 |
| observer | obs123456 | 只读 |

## 启动

```bash
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/logs` | 对中记录列表（登录） |
| POST | `/api/logs` | 提交偏航记录（仅技师） |
| GET | `/api/turbines` | 已有记录的机组编号（登录） |
| GET | `/api/compare/spec` | 对照口径，只读（登录） |
| POST | `/api/comparisons` | 后台重算差值（仅技师；`left_code`、`right_code`、`cutoff_at` 同捆必填，`since_at` 可选） |
| GET | `/api/comparisons?left=&right=` | 对照结果查询，最新在前（登录） |

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. 邻机误差对照：technician 选左机 W01、右机 W07 与晚于种子办结时间的截止时刻，点「后台重算差值」后中间列显示左 0.4°、右 3.2°、差值 −2.8°；把截止时刻改到种子办结时间之前重算，两侧显示「缺办结」，差值留空。
5. 缺截止时刻或任一机号时重算被拒（400）；observer 点重算被拒（403），且对照页无重算按钮。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
