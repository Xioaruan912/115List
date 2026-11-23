# AGENTS.md — 115List 项目工作流与接手规范

> **【强制规则 · 只允许续写，禁止覆盖】**
> 本文件为本项目经维护者确认的基准工作流与设计契约。
> 1. 后续任何接手开发的 AI Agent，**严禁覆盖、删除或重写本文件既有章节**。
> 2. 如有新增经验、架构变更、排障结论或阶段交接，**只允许在文末 `## 交接与续写日志（Append-Only）` 区域按时间顺序向下追加**。
> 3. 除非项目维护者明确要求修改某条既有规则，否则一律以本文件当前规范为准。

---

## 1. 分支与开发交付流程

- **唯一主分支**：所有开发与推送均在 `main` 分支进行（历史分支 `cc`、`tgvio`、`tgvio-web` 已归档清理，不再保留）。
- **本地开发，验收后上线**：
  1. 在本地工作区完成代码修改、自动化检查与真实浏览器验收。
  2. 未经维护者确认验收前，不直接修改线上生产服务二进制；线上运行时配置、凭据与数据库严禁进入 Git 仓库。
  3. 保留生产环境现有运行时备份（`/root/backup/`），升级必须先备份旧二进制并验证健康后再切换。
- **提交规范（Conventional Commits）**：
  - 标题格式：`type(scope): subject`（允许 `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `build`, `ci`, `chore`, `revert`），祈使语气、如实描述改动。
  - 正文用简洁 Markdown 列表说明关键变更，不虚构未执行的测试或未发生的改动。
  - 若未使用明确约定的 `Co-authored-by` 署名，不要自行编造或添加。

---

## 2. 前端与展示页标准工作流

### 2.1 常规前端开发（Global AI Frontend Design Workflow）

涉及**新页面、新组件、UI 改版或视觉打磨**时，按以下 4 阶段依次执行（纯后端/业务逻辑改动跳过）：

1. **Phase 1：设计研究（`ui-ux-pro-max`）**
   - 分析产品场景与用户目标，**优先沿用本项目既有视觉系统（见第 3 节）**，绝不另起一套互相冲突的 Design System。
   - 按需查询本地设计智能补充排版、色彩与交互规范。
2. **Phase 2：视觉设计与实现（`frontend-design`）**
   - 保持清晰的信息层级与克制留白；拒绝通用 AI 模板感（无廉价紫蓝渐变、无卡片套卡片、无无意义装饰）。
   - 补齐全部交互态：`hover`、`focus-visible`、`active`、`disabled`、`loading`、`empty`、`error`。
3. **Phase 3：真实浏览器视觉验收（绝不凭代码臆测）**
   - 在真实浏览器（Playwright / Chromium / `/browser`）打开实际渲染页面。
   - 同时检查 **桌面端（`1440px`）** 与 **移动端（`390px`）** 截图，核验布局平衡、断行溢出、对比度、深浅主题与交互反馈。
4. **Phase 4：设计评审与打磨（`impeccable`）**
   - 依次执行 `critique`（启发式评审）、`polish`（排版/间距/对齐细节）与 `audit`（可访问性、键盘焦点、响应式）。
   - 每轮修改后重新截图验证，默认至少完成 **2 轮** 基于证据的视觉打磨；确实已无问题时停止，不做多余改动。

### 2.2 展示页、落地页与 README 动效工作流（苹果工作流 / Apple-style Cinematic Frontend Workflow）

涉及**产品展示页、创意落地页、品牌横幅、动效 README 或滚动叙事体验**时，按任务体量分级执行：

- **Light（轻量级）**：局部视觉或微交互打磨，直接走精简设计 + 真实浏览器 `1440px` / `390px` 验收 + `impeccable` 打磨。
- **Standard（标准级）**：常规展示页、动效 README / SVG 视觉重塑：资产审计 → 视觉与动效设计 → Hero 优先实现 → 真实浏览器深浅主题与双端验收 → 2 轮精修。
- **Cinematic（电影级）**：多场景滚动叙事页：完整 6 阶段（视觉研究 → 艺术/资产方向与 2–3 真实原型对比 → 强制滚动分镜 → Hero First GSAP + ScrollTrigger 工程实现 → 实测性能与多进度点 QA → 跨阶段根因回溯评审）。
- **核心原则**：
  - 动效服务于空间关系与理解，而不是堆叠装饰；必须支持 `prefers-reduced-motion: reduce`。
  - 只暴露实验室指标为 **Lab**，不将合成测试伪装成真实用户数据，不编造通过结论。

---

## 3. 115List（`tgvio-web/`）产品与视觉契约

本仓库嵌入自研前端 `tgvio-web/`（React + Vite + Tailwind v4 + Motion），不依赖官方 OpenList-Frontend。详细代码地图见 `tgvio-web/README.md`，构建与部署细节见 `tgvio/README.md`。

### 3.1 定位与视觉系统

- **产品定位**：面向普通用户的私人影院与网盘（短视频、电影、剧集、图片），桌面与 iPhone / iPad 同样顺手。内容（封面与海报）是主角，界面退后。
- **色彩**：近黑底 `#0c0c0d`（浅色模式冷灰底）+ 唯一强调色 **酸橙绿 `--accent: #c4ec5c`**（`--accent-ink: #11140b`）。强调色仅用于焦点、进度、主按钮与选中；危险操作用 `--danger`。禁止紫蓝渐变、外发光、渐变大字。
- **层次与组件**：靠字号、字重、留白和 1px 发丝线（`hairline`）建立层次，少用厚重阴影；浮层（Dock、菜单、面板）使用 `glass` 与 `--shadow-float`。
- **字体与圆角**：Geist / Geist Mono（自托管），数字用 `tabular`，大标题紧字距 `-0.04em`。圆角固定三档：控件 `10`、卡片 `14`、面板 `22`，胶囊仅用于开关与徽标。
- **图标与文案**：图标统一使用 Phosphor（`XxxIcon`），不手画杂乱 SVG；界面文字用简洁中文，**不用 emoji，不用英文破折号（em dash）**。
- **隐私与主题**：深浅主题跟随系统，登录页固定深色（`.theme-dark`）且登录前不展示任何网盘内容；片库封面默认模糊（悬停或长按显示），官方 TMDB 公开海报不模糊。

### 3.2 动效与交互契约

- 动效表达空间关系（推进/拉远 `Stage`、原位放大 `Viewer`、重排 `lib/flip.ts`、Dock 变形），优先弹簧（`lib/motion.ts`），仅动画 `transform` 和 `opacity`。
- 大列表使用虚拟滚动（`@tanstack/react-virtual`，`useFlushSync: false`），连续手势值用 motion value，不进 React state，不监听 `window.scroll`。
- `prefers-reduced-motion` 下所有动效平稳降级，功能不受影响。
- 错误统一经 `tgvio-web/src/lib/errors.ts` 翻译为自然中文原因 + 下一步建议，不直接把原始英文/路径暴露给普通用户（仅保留「复制详情」）。
- 操作采用乐观更新：先更新本地缓存让界面即时响应，再后台向服务器校准，失败时回滚并提示。

---

## 4. 后端与 115 业务硬性约束

- **115 风控红线**：不要增加无谓的目录列表请求。悬停预取同时最多 1 个且仅限未缓存目录；文件夹封面（`hooks/useCover.ts`）仅排队屏幕可见项、单并发、缓存 30 分钟。
- **TMDB 海报与改名**：海报查自 `internal/tgvio/tmdb.go`（限速 4 次/秒，结果存 `data/tgvio/posters.json`，令牌存 `data/tgvio/tmdb_token`，绝不进仓库）。改名必须经过 `TMDB.Renamed` / `RenamedDir` 以保持海报记录同步；按 TMDB 整理命名必须先预览计划再逐条执行。
- **会话与多根目录**：登录会话持久化于 `data/tgvio/sessions.json`，新登录入口必须调用 `common.GenerateToken(user, c)`。所有用户路径必须经 `JoinPath` / `ShowPath`（`internal/model/tgvio_roots.go`）转换，禁止直接拼接 `BasePath`。
- **大文件续传**：分块写入 `data/tgvio/staged`（不可放进重启即清空的 `temp`），上传成功前保留暂存与恢复记录。
- **权限与视频**：保留管理员 WebDAV 免密权限（网页端密码控制走 `tgvio_admin_folder_password`）；视频缩略图由服务端单队列限速截帧缓存，不改浏览器直拉；视频优先 115 云端 HLS 转码（`/api/tgvio/video` + `/tgvio/hls/` 代理），不向浏览器暴露网盘直链。
- **缓存与静态资源**：站点位于 Cloudflare 后方，HTML `no-cache`，`/api` `no-store`，缺失静态资源返回 404（`server/static/tgvio_cache.go`），构建保留最近 6 次哈希产物防止旧页面白屏。
- **找资源站点**：遇到 Cloudflare 人机验证的站点不可在服务端绕过，应引导使用「浏览器打开」模式（配合粘贴磁力或书签送回）。

---

## 5. 本地检查与构建命令

```sh
# 后端单元测试
go test ./...

# 前端类型检查、单测与构建
cd tgvio-web && npm run check

# 离线构建脚本回归测试
bash tgvio/build_test.sh

# 构建嵌入自研前端的二进制
bash tgvio/build.sh
```

---

## 交接与续写日志（Append-Only）

> 后续每位接手开发的 Agent 请按 `### YYYY-MM-DD · <简短标题>` 格式在下方追加记录，**禁止删除或覆盖以上任何内容**。

### 2026-11-23 · 工作流定版、分支清理与面向普通用户的 README 重构

- **分支状态**：远端与本地已统一仅保留 `main` 分支（旧分支 `cc`、`tgvio`、`tgvio-web` 已确认合入并清理）。
- **找资源配置**：生产环境 `/opt/openlist/data/tgvio/resources.json` 中 SeedHub 因开启 Cloudflare Managed Challenge，已切换为「浏览器打开」模式恢复立即可用（原配置已备份为 `resources.json.bak`）。
- **README 与动效资产**：按苹果工作流重构 `README.md`（降低技术密度，面向普通用户），新增 `docs/media/hero-banner.svg` 与 `docs/media/cinema-flow.svg`，并通过 Playwright + Chromium 完成桌面 `1440px`（深/浅色）与手机 `390px` 两轮实测验收。
