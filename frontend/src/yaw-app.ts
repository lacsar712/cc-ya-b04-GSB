import { css, html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

// 邻机误差对照：所有数值均来自后台重算接口，页面只负责原样展示。
type CompareReport = {
  id: number;
  left_turbine: string;
  right_turbine: string;
  window_start: string;
  cutoff_at: string;
  left_log_id: number | null;
  right_log_id: number | null;
  left_yaw_err_deg: number | null;
  right_yaw_err_deg: number | null;
  diff_deg: number | null;
  left_available: boolean;
  right_available: boolean;
  recompute_action: string;
  created_by: string;
  created_at: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type PageKey = "logs" | "compare";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInputValue(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 1080px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1rem;
    }
    nav {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid #334155;
    }
    nav button {
      border-radius: 6px 6px 0 0;
      background: transparent;
      color: #94a3b8;
      border: 1px solid transparent;
      border-bottom: none;
      font-weight: 600;
    }
    nav button.active {
      background: #1e293b;
      color: #38bdf8;
      border-color: #334155;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input,
    select {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
      color-scheme: dark;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.82rem;
      margin: 0.25rem 0 0.75rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0 0.75rem;
    }
    .compare-grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 0.75rem;
      align-items: stretch;
      margin-top: 0.75rem;
    }
    .cell {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 180px;
    }
    .cell .name {
      color: #94a3b8;
      font-size: 0.85rem;
      margin-bottom: 0.4rem;
    }
    .cell .metric {
      font-size: 1.9rem;
      font-weight: 700;
      color: #f1f5f9;
    }
    .cell.mid .metric {
      color: #fbbf24;
    }
    .cell .missing {
      color: #f87171;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .cell .readonly-tag {
      margin-top: 0.4rem;
      font-size: 0.72rem;
      color: #64748b;
    }
    .meta-line {
      color: #94a3b8;
      font-size: 0.82rem;
      margin-top: 0.6rem;
    }
    @media (max-width: 720px) {
      .form-grid {
        grid-template-columns: 1fr 1fr;
      }
      .compare-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  @state() private session: Session | null = null;
  @state() private page: PageKey = "logs";
  @state() private logs: LogRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  // 邻机误差对照页状态
  @state() private turbines: string[] = [];
  @state() private leftTurbine = "";
  @state() private rightTurbine = "";
  @state() private windowStart = "";
  @state() private cutoffAt = "";
  // 中间三列只承载「后台重算」返回的报告；选择一旦变动立即清空，绝不临时填差值。
  @state() private compareReport: CompareReport | null = null;
  @state() private compareHistory: CompareReport[] = [];
  @state() private compareError = "";
  @state() private recomputing = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.afterLogin();
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async afterLogin() {
    this.initCompareWindow();
    await Promise.all([this.refreshLogs(), this.loadTurbines()]);
    this._pollTimer = window.setInterval(() => void this.refreshLogs(), 2000);
  }

  private initCompareWindow() {
    // 默认时段：近 7 天至当前时刻，仅为默认值，可自行调整。
    const now = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    this.windowStart = toLocalInputValue(start);
    this.cutoffAt = toLocalInputValue(now);
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async loadTurbines() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/turbines", { headers: this.authHeaders() });
      if (!res.ok) return;
      this.turbines = (await res.json()) as string[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.afterLogin();
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.compareReport = null;
    this.compareHistory = [];
    this.page = "logs";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  // ---- 邻机误差对照 ----

  private switchPage(p: PageKey) {
    this.page = p;
    if (p === "compare") {
      void this.loadTurbines();
      void this.refreshReports();
    }
  }

  // 任一选择项变更：清空上次后台结果。页面不会、也无法临时填出差值。
  private invalidateReport() {
    this.compareReport = null;
    this.compareError = "";
  }

  private onLeftTurbine(e: Event) {
    this.leftTurbine = (e.target as HTMLSelectElement).value;
    this.invalidateReport();
  }

  private onRightTurbine(e: Event) {
    this.rightTurbine = (e.target as HTMLSelectElement).value;
    this.invalidateReport();
  }

  private onWindowStart(e: Event) {
    this.windowStart = (e.target as HTMLInputElement).value;
    this.invalidateReport();
  }

  private onCutoffAt(e: Event) {
    this.cutoffAt = (e.target as HTMLInputElement).value;
    this.invalidateReport();
  }

  private get compareFormComplete(): boolean {
    return (
      this.leftTurbine !== "" &&
      this.rightTurbine !== "" &&
      this.leftTurbine !== this.rightTurbine &&
      this.windowStart !== "" &&
      this.cutoffAt !== ""
    );
  }

  private async refreshReports() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/compare/reports", {
        headers: this.authHeaders(),
      });
      if (!res.ok) return;
      this.compareHistory = (await res.json()) as CompareReport[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async recomputeCompare() {
    if (!this.compareFormComplete) return;
    this.compareError = "";
    this.recomputing = true;

    const startMs = Date.parse(this.windowStart);
    const cutoffMs = Date.parse(this.cutoffAt);
    if (Number.isNaN(startMs) || Number.isNaN(cutoffMs)) {
      this.compareError = "时段起点或截止时刻格式无效";
      this.recomputing = false;
      return;
    }

    try {
      // 重算动作与截止时刻（及左机/右机/时段起）同捆提交，缺一不发请求。
      const res = await fetch("/api/compare/recompute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          recompute_action: "recompute",
          left_turbine: this.leftTurbine,
          right_turbine: this.rightTurbine,
          window_start: new Date(startMs).toISOString(),
          cutoff_at: new Date(cutoffMs).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.compareError = data.detail || "后台重算失败";
        return;
      }
      // 中间三列只接受后台重算返回值，本文件不做任何左右相减。
      this.compareReport = data as CompareReport;
      await this.refreshReports();
    } catch {
      this.compareError = "重算时网络异常";
    } finally {
      this.recomputing = false;
    }
  }

  private fmtDeg(v: number | null): string {
    return v === null ? "—" : `${v}°`;
  }

  private fmtTime(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  private turbineOptions(selected: string): TemplateResult {
    return html`
      <option value="" ?selected=${selected === ""}>请选择机组</option>
      ${this.turbines.map(
        (code) =>
          html`<option value=${code} ?selected=${code === selected}>
            ${code}
          </option>`
      )}
    `;
  }

  private renderCompare() {
    const report = this.compareReport;
    return html`
      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">邻机误差对照 · 后台重算</h2>
        <p class="hint">
          取所选时段（含起止边界）内左机、右机各自最近一次「已办结」偏航误差；
          时段之外的办结点不计入。差值（左 − 右）仅由后台重算给出，本页只读展示，不做手算相减。
        </p>

        <div class="form-grid">
          <div>
            <label>左机</label>
            <select @change=${this.onLeftTurbine}>
              ${this.turbineOptions(this.leftTurbine)}
            </select>
          </div>
          <div>
            <label>右机</label>
            <select @change=${this.onRightTurbine}>
              ${this.turbineOptions(this.rightTurbine)}
            </select>
          </div>
          <div>
            <label>时段起点</label>
            <input
              type="datetime-local"
              .value=${this.windowStart}
              @change=${this.onWindowStart}
            />
          </div>
          <div>
            <label>截止时刻（与重算动作同捆提交）</label>
            <input
              type="datetime-local"
              .value=${this.cutoffAt}
              @change=${this.onCutoffAt}
            />
          </div>
        </div>

        <div class="row-actions">
          ${this.isWriter
            ? html`
                <button
                  ?disabled=${this.recomputing || !this.compareFormComplete}
                  @click=${this.recomputeCompare}
                >
                  ${this.recomputing ? "后台重算中…" : "触发后台重算"}
                </button>
              `
            : html`
                <span class="hint" style="margin:0;">
                  观察岗可选择机号查看，但不能报送重算。
                </span>
              `}
          <button class="secondary" @click=${this.loadTurbines}>刷新机号</button>
        </div>
        ${this.compareError ? html`<p class="err">${this.compareError}</p>` : null}

        <div class="compare-grid" aria-label="邻机误差对照（只读）">
          <div class="cell">
            <div class="name">
              左机最近办结 · ${report ? report.left_turbine : this.leftTurbine || "—"}
            </div>
            ${report && report.left_turbine === this.leftTurbine
              ? report.left_yaw_err_deg === null
                ? html`<div class="missing">— 时段内无办结</div>`
                : html`<div class="metric">
                    ${this.fmtDeg(report.left_yaw_err_deg)}
                  </div>`
              : html`<div class="missing">— 待后台重算</div>`}
            <div class="readonly-tag">只读 · 后台取数</div>
          </div>

          <div class="cell mid">
            <div class="name">差值（左 − 右）</div>
            ${report &&
            report.left_turbine === this.leftTurbine &&
            report.right_turbine === this.rightTurbine
              ? report.diff_deg === null
                ? html`<div class="missing">— 一侧缺办结，不计差值</div>`
                : html`<div class="metric">${this.fmtDeg(report.diff_deg)}</div>`
              : html`<div class="missing">— 待后台重算</div>`}
            <div class="readonly-tag">
              只读 · recompute_action 已同捆报送
            </div>
          </div>

          <div class="cell">
            <div class="name">
              右机最近办结 · ${report ? report.right_turbine : this.rightTurbine || "—"}
            </div>
            ${report && report.right_turbine === this.rightTurbine
              ? report.right_yaw_err_deg === null
                ? html`<div class="missing">— 时段内无办结</div>`
                : html`<div class="metric">
                    ${this.fmtDeg(report.right_yaw_err_deg)}
                  </div>`
              : html`<div class="missing">— 待后台重算</div>`}
            <div class="readonly-tag">只读 · 后台取数</div>
          </div>
        </div>

        ${report
          ? html`
              <p class="meta-line">
                本次重算口径：时段
                ${this.fmtTime(report.window_start)}
                ～ ${this.fmtTime(report.cutoff_at)}
                ｜动作标记 ${report.recompute_action}
                ｜报送人 ${report.created_by}
                ｜重算时间 ${this.fmtTime(report.created_at)}
                ${report.diff_deg === null
                  ? "｜至少一侧在时段内缺办结，差值留空（不填假数）"
                  : ""}
              </p>
            `
          : html`
              <p class="meta-line">
                选择左机、右机与时段后，须由现场技师触发后台重算；未触发重算前差值留空。
              </p>
            `}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">最近重算记录（后台留痕，只读）</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>左机</th>
              <th>右机</th>
              <th>左办结°</th>
              <th>差值°</th>
              <th>右办结°</th>
              <th>截止时刻</th>
              <th>报送人</th>
            </tr>
          </thead>
          <tbody>
            ${this.compareHistory.length === 0
              ? html`<tr>
                  <td colspan="8" style="color:#94a3b8;">暂无后台重算记录</td>
                </tr>`
              : this.compareHistory.map(
                  (r) => html`
                    <tr>
                      <td>${r.id}</td>
                      <td>${r.left_turbine}</td>
                      <td>${r.right_turbine}</td>
                      <td>${r.left_yaw_err_deg === null
                        ? "—"
                        : r.left_yaw_err_deg}</td>
                      <td>${r.diff_deg === null ? "—" : r.diff_deg}</td>
                      <td>${r.right_yaw_err_deg === null
                        ? "—"
                        : r.right_yaw_err_deg}</td>
                      <td>${this.fmtTime(r.cutoff_at)}</td>
                      <td>${r.created_by}</td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      <h1>风机偏航对中台</h1>
      <p class="sub">
        已登录：${this.session.username}
        (${this.isWriter ? "可提交" : "只读"})
      </p>

      <nav>
        <button
          class=${this.page === "logs" ? "active" : nothing}
          @click=${() => this.switchPage("logs")}
        >
          对中记录
        </button>
        <button
          class=${this.page === "compare" ? "active" : nothing}
          @click=${() => this.switchPage("compare")}
        >
          邻机误差对照
        </button>
      </nav>

      ${this.page === "logs"
        ? html`
            <section>
              <div class="row-actions">
                <button class="secondary" @click=${this.logout}>退出</button>
                <button
                  class="secondary"
                  ?disabled=${this.loading}
                  @click=${this.refreshLogs}
                >
                  刷新列表
                </button>
              </div>
            </section>

            ${this.isWriter
              ? html`
                  <section>
                    <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录</h2>
                    <label>机组编号</label>
                    <input
                      placeholder="例如 W12"
                      .value=${this.turbineCode}
                      @input=${(e: Event) =>
                        (this.turbineCode = (e.target as HTMLInputElement).value)}
                    />
                    <label>偏航误差（度，可正可负）</label>
                    <input
                      type="number"
                      step="0.1"
                      .value=${this.yawErr}
                      @input=${(e: Event) =>
                        (this.yawErr = (e.target as HTMLInputElement).value)}
                    />
                    <button ?disabled=${this.loading} @click=${this.submitLog}>
                      提交（进入待认领队列）
                    </button>
                    ${this.error ? html`<p class="err">${this.error}</p>` : null}
                  </section>
                `
              : null}

            <section>
              <h2 style="margin-top:0;font-size:1.1rem;">对中记录</h2>
              <table>
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>机组</th>
                    <th>误差°</th>
                    <th>状态</th>
                    <th>结论</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.logs.map(
                    (row) => html`
                      <tr>
                        <td>${row.id}</td>
                        <td>${row.turbine_code}</td>
                        <td>${row.yaw_err_deg}</td>
                        <td>
                          <span
                            class="tag ${row.status === "pending"
                              ? "pending"
                              : "ok"}"
                          >
                            ${row.status === "pending" ? "待处理" : "已完成"}
                          </span>
                        </td>
                        <td>
                          ${row.verdict
                            ? html`<span class="tag ${this.verdictClass(row)}">
                                ${row.verdict}
                              </span>`
                            : "—"}
                        </td>
                        <td>${row.reason ?? "—"}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </section>
          `
        : this.renderCompare()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
