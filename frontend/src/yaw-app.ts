import { css, html, LitElement } from "lit";
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

type ComparisonRow = {
  id: number;
  left_code: string;
  right_code: string;
  since_at: string | null;
  cutoff_at: string;
  left_log_id: number | null;
  right_log_id: number | null;
  left_err_deg: number | null;
  right_err_deg: number | null;
  left_processed_at: string | null;
  right_processed_at: string | null;
  diff_deg: number | null;
  missing: "left" | "right" | "both" | null;
  created_by: string;
  created_at: string;
};

type CompareSpec = {
  threshold_deg: number;
  verdict_rule: string;
  diff_rule: string;
  window_rule: string;
  missing_rule: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type View = "logs" | "compare";

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 0 1.5rem 1.5rem;
      max-width: 960px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid #334155;
      flex-wrap: wrap;
    }
    .brand {
      font-size: 1.25rem;
      font-weight: 700;
      color: #38bdf8;
      margin-right: auto;
    }
    .tabs {
      display: flex;
      gap: 0.25rem;
    }
    .tab {
      background: transparent;
      color: #94a3b8;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0.4rem 0.9rem;
      font-weight: 600;
    }
    .tab.active {
      background: #0c4a6e;
      color: #7dd3fc;
      border-color: #0369a1;
    }
    .who {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 1.1rem;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
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
    .missing {
      background: #3f3f46;
      color: #d4d4d8;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .muted {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    .warn {
      color: #fbbf24;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .pick-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0 1rem;
    }
    .compare-cols {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 1rem;
      align-items: stretch;
    }
    .compare-col {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.9rem 1rem;
    }
    .compare-col h3 {
      margin: 0 0 0.5rem;
      font-size: 0.9rem;
      color: #94a3b8;
      font-weight: 600;
    }
    .big {
      font-size: 1.6rem;
      font-weight: 700;
      color: #f1f5f9;
    }
    .diff-col {
      display: flex;
      flex-direction: column;
      justify-content: center;
      text-align: center;
      min-width: 150px;
      border-color: #0369a1;
    }
    .diff-col .big {
      color: #7dd3fc;
    }
    .kv {
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-top: 0.35rem;
    }
    .kv span {
      color: #94a3b8;
    }
    dl.spec {
      margin: 0;
      font-size: 0.9rem;
    }
    dl.spec dt {
      color: #94a3b8;
      margin-top: 0.5rem;
    }
    dl.spec dd {
      margin: 0.15rem 0 0;
      color: #e2e8f0;
    }
    @media (max-width: 720px) {
      .compare-cols {
        grid-template-columns: 1fr;
      }
    }
  `;

  @state() private session: Session | null = null;
  @state() private logs: LogRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  @state() private view: View = "logs";
  @state() private turbines: string[] = [];
  @state() private leftCode = "";
  @state() private rightCode = "";
  @state() private sinceAt = "";
  @state() private cutoffAt = "";
  @state() private comparison: ComparisonRow | null = null;
  @state() private spec: CompareSpec | null = null;
  @state() private compareError = "";
  @state() private compareBusy = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshLogs();
        void this.loadCompareData();
        this._pollTimer = window.setInterval(() => void this.refreshLogs(), 2000);
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
      await this.refreshLogs();
      await this.loadCompareData();
      this._pollTimer = window.setInterval(() => void this.refreshLogs(), 2000);
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
    this.comparison = null;
    this.spec = null;
    this.turbines = [];
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

  /* ---------- 邻机误差对照 ---------- */

  private switchView(view: View) {
    this.view = view;
    if (view === "compare") {
      void this.loadCompareData();
    }
  }

  private async loadCompareData() {
    if (!this.session) return;
    try {
      const [tRes, sRes] = await Promise.all([
        fetch("/api/turbines", { headers: this.authHeaders() }),
        fetch("/api/compare/spec", { headers: this.authHeaders() }),
      ]);
      if (tRes.status === 401 || sRes.status === 401) {
        this.logout();
        return;
      }
      if (tRes.ok) {
        this.turbines = (await tRes.json()) as string[];
        if (!this.leftCode && this.turbines.length > 0) {
          this.leftCode = this.turbines[0];
        }
        if (!this.rightCode && this.turbines.length > 1) {
          this.rightCode = this.turbines[1];
        }
      }
      if (sRes.ok) {
        this.spec = (await sRes.json()) as CompareSpec;
      }
      if (!this.cutoffAt) {
        this.cutoffAt = toLocalInputValue(new Date());
      }
      await this.loadComparisonForPair();
    } catch {
      /* ignore transient network errors */
    }
  }

  private async loadComparisonForPair() {
    if (!this.session || !this.leftCode || !this.rightCode) {
      this.comparison = null;
      return;
    }
    try {
      const res = await fetch(
        `/api/comparisons?left=${encodeURIComponent(
          this.leftCode
        )}&right=${encodeURIComponent(this.rightCode)}`,
        { headers: this.authHeaders() }
      );
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      const rows = (await res.json()) as ComparisonRow[];
      this.comparison = rows[0] ?? null;
    } catch {
      /* ignore transient network errors */
    }
  }

  private onPairChanged() {
    this.compareError = "";
    void this.loadComparisonForPair();
  }

  private get canRecompute() {
    return (
      this.isWriter &&
      !this.compareBusy &&
      this.leftCode !== "" &&
      this.rightCode !== "" &&
      this.leftCode !== this.rightCode &&
      this.cutoffAt !== ""
    );
  }

  private async recompute() {
    this.compareError = "";
    // 重算动作与截止时刻同捆提交，缺一不可
    if (!this.leftCode || !this.rightCode || !this.cutoffAt) {
      this.compareError = "左机、右机与截止时刻须同捆提交，缺一不可";
      return;
    }
    const cutoff = new Date(this.cutoffAt);
    if (Number.isNaN(cutoff.getTime())) {
      this.compareError = "截止时刻不合法";
      return;
    }
    const body: Record<string, string> = {
      left_code: this.leftCode,
      right_code: this.rightCode,
      cutoff_at: cutoff.toISOString(),
    };
    if (this.sinceAt) {
      const since = new Date(this.sinceAt);
      if (Number.isNaN(since.getTime())) {
        this.compareError = "时段起点不合法";
        return;
      }
      body.since_at = since.toISOString();
    }
    this.compareBusy = true;
    try {
      const res = await fetch("/api/comparisons", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        this.compareError = data.detail || "重算失败";
        return;
      }
      // 差值只认后台重算结果，页面绝不手算相减
      this.comparison = data as ComparisonRow;
    } catch {
      this.compareError = "重算时网络异常";
    } finally {
      this.compareBusy = false;
    }
  }

  private get compareStale(): boolean {
    const c = this.comparison;
    if (!c) return false;
    if (c.left_code !== this.leftCode || c.right_code !== this.rightCode) {
      return true;
    }
    const cutoffMs = this.cutoffAt ? new Date(this.cutoffAt).getTime() : NaN;
    if (!Number.isFinite(cutoffMs) || Date.parse(c.cutoff_at) !== cutoffMs) {
      return true;
    }
    const sinceMs = this.sinceAt ? new Date(this.sinceAt).getTime() : null;
    const rowSinceMs = c.since_at ? Date.parse(c.since_at) : null;
    return sinceMs !== rowSinceMs;
  }

  private fmtTime(iso: string | null | undefined) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleString("zh-CN", { hour12: false });
  }

  private renderSide(
    title: string,
    code: string,
    errDeg: number | null,
    processedAt: string | null,
    logId: number | null,
    missing: boolean
  ) {
    return html`
      <div class="compare-col">
        <h3>${title}：${code || "未选"}</h3>
        ${missing
          ? html`
              <p><span class="tag missing">缺办结</span></p>
              <p class="muted">所选时段内无办结记录，不填假数。</p>
            `
          : html`
              <p class="big">${errDeg}°</p>
              <p class="kv"><span>办结时间：</span>${this.fmtTime(processedAt)}</p>
              <p class="kv"><span>来源记录：</span>#${logId}</p>
            `}
      </div>
    `;
  }

  private renderCompare() {
    const c = this.comparison;
    const leftMissing = c?.missing === "left" || c?.missing === "both";
    const rightMissing = c?.missing === "right" || c?.missing === "both";
    return html`
      <section>
        <h2>选择机组与时段</h2>
        <div class="pick-grid">
          <div>
            <label>左机机号</label>
            <select
              .value=${this.leftCode}
              @change=${(e: Event) => {
                this.leftCode = (e.target as HTMLSelectElement).value;
                this.onPairChanged();
              }}
            >
              <option value="">请选择</option>
              ${this.turbines.map(
                (t) => html`
                  <option value=${t} ?selected=${t === this.leftCode}>
                    ${t}
                  </option>
                `
              )}
            </select>
          </div>
          <div>
            <label>右机机号</label>
            <select
              .value=${this.rightCode}
              @change=${(e: Event) => {
                this.rightCode = (e.target as HTMLSelectElement).value;
                this.onPairChanged();
              }}
            >
              <option value="">请选择</option>
              ${this.turbines.map(
                (t) => html`
                  <option value=${t} ?selected=${t === this.rightCode}>
                    ${t}
                  </option>
                `
              )}
            </select>
          </div>
          <div>
            <label>时段起点（可选）</label>
            <input
              type="datetime-local"
              .value=${this.sinceAt}
              @input=${(e: Event) =>
                (this.sinceAt = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label>截止时刻（必选，与重算同捆提交）</label>
            <input
              type="datetime-local"
              .value=${this.cutoffAt}
              @input=${(e: Event) =>
                (this.cutoffAt = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        ${this.isWriter
          ? html`
              <div class="row-actions">
                <button ?disabled=${!this.canRecompute} @click=${this.recompute}>
                  ${this.compareBusy ? "重算中…" : "后台重算差值"}
                </button>
                <span class="muted">
                  重算会把左机、右机与截止时刻同捆报送，差值只由后台计算。
                </span>
              </div>
            `
          : html`<p class="muted">观察岗只读，不能报送重算。</p>`}
        ${this.leftCode && this.leftCode === this.rightCode
          ? html`<p class="warn">左机与右机不能是同一机组。</p>`
          : null}
        ${this.compareError
          ? html`<p class="err">${this.compareError}</p>`
          : null}
      </section>

      <section>
        <h2>对照结果</h2>
        ${c
          ? html`
              <div class="compare-cols">
                ${this.renderSide(
                  "左机最近办结",
                  c.left_code,
                  c.left_err_deg,
                  c.left_processed_at,
                  c.left_log_id,
                  leftMissing
                )}
                <div class="compare-col diff-col">
                  <h3>二者差值（左 − 右）</h3>
                  ${c.diff_deg !== null
                    ? html`<p class="big">${c.diff_deg}°</p>`
                    : html`
                        <p class="big">—</p>
                        <p class="muted">缺办结，不出差值</p>
                      `}
                </div>
                ${this.renderSide(
                  "右机最近办结",
                  c.right_code,
                  c.right_err_deg,
                  c.right_processed_at,
                  c.right_log_id,
                  rightMissing
                )}
              </div>
              <p class="kv" style="margin-top:0.75rem;">
                <span>结果口径：</span>截止 ${this.fmtTime(c.cutoff_at)}
                ${c.since_at
                  ? html`／起点 ${this.fmtTime(c.since_at)}`
                  : null}
                ／由 ${c.created_by} 于 ${this.fmtTime(c.created_at)} 后台重算
              </p>
              ${this.compareStale
                ? html`
                    <p class="warn">
                      当前机组或时段与这份结果不一致，请重新后台重算；页面临时显示的差值不作数。
                    </p>
                  `
                : null}
            `
          : html`
              <p class="muted">
                尚未后台重算，中间列不出数。选好左机、右机与截止时刻后点「后台重算差值」。
              </p>
            `}
      </section>

      <section>
        <h2>口径（只读）</h2>
        ${this.spec
          ? html`
              <dl class="spec">
                <dt>判定阈值</dt>
                <dd>${this.spec.verdict_rule}</dd>
                <dt>差值口径</dt>
                <dd>${this.spec.diff_rule}</dd>
                <dt>时段口径</dt>
                <dd>${this.spec.window_rule}</dd>
                <dt>缺办结口径</dt>
                <dd>${this.spec.missing_rule}</dd>
              </dl>
            `
          : html`<p class="muted">口径加载中…</p>`}
      </section>
    `;
  }

  private renderLogs() {
    return html`
      <section>
        <div class="row-actions">
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
              <h2>提交偏航记录</h2>
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
        <h2>对中记录</h2>
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
                      class="tag ${row.status === "pending" ? "pending" : "ok"}"
                    >
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}"
                          >${row.verdict}</span
                        >`
                      : "—"}
                  </td>
                  <td>${row.reason ?? "—"}</td>
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
        <h1 style="margin-top:1.5rem;">风机偏航对中台</h1>
        <p class="sub">
          现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。
        </p>
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
      <header class="topbar">
        <span class="brand">风机偏航对中台</span>
        <nav class="tabs">
          <button
            class="tab ${this.view === "logs" ? "active" : ""}"
            @click=${() => this.switchView("logs")}
          >
            对中记录
          </button>
          <button
            class="tab ${this.view === "compare" ? "active" : ""}"
            @click=${() => this.switchView("compare")}
          >
            邻机误差对照
          </button>
        </nav>
        <span class="who">
          ${this.session.username}（${this.isWriter ? "可提交" : "只读"}）
        </span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </header>
      ${this.view === "logs" ? this.renderLogs() : this.renderCompare()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
