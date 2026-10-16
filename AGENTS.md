# Agent Instructions

## Issues

Before creating an issue, review the available issue templates in the `.github` directory.

When drafting the issue:

- Use the most appropriate template.
- Follow the template structure.
- Fill in all required sections.
- Remove sections that the template explicitly marks as optional or not applicable.
- Do not invent reproduction steps, logs, screenshots, or expected behavior.

## Pull Requests

Before creating a pull request, read `.github/PULL_REQUEST_TEMPLATE.md`.

When drafting the pull request:

- Follow the template structure.
- Use the title format required by the template.
- Fill in or remove each section according to the template guidance.
- Include testing details, or explain why testing was not run.
- Do not invent testing results.
- Do not claim validation, verification, or review steps that were not actually performed.

## Automated Contributions

Fully automated contributions are not considered equivalent to normal community participation.

A contribution may be considered fully automated if it is submitted through an automated agent, or if the submitting account participates in project discussions through an automated agent, without meaningful human review or intervention.

When making this determination, maintainers may consider the overall behavior of the account, including but not limited to disclosed agent usage, interaction patterns, response characteristics, and other available evidence. No single factor is determinative.

Maintainers reserve the right to accept, reject, modify, or reimplement any contribution independently of any action taken against the submitting account. Acceptance of a contribution does not imply acceptance of the submitting account or its contribution method. If an account is determined to be primarily operated through automated processes, we may need to restrict its future participation in contributions until that determination is rescinded.

## Git Commits

When creating commits, follow the repository `git-commit` skill rules:

- Use Conventional Commits title format: `type(scope): subject`.
- Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `build`, `ci`, `chore`, `revert`.
- Use a meaningful scope based on the main module, package, or feature.
- Write the subject in imperative mood and describe the actual change.
- Use a concise Markdown list in the commit body, with each item describing one key change.
- Do not invent changes that are not present in the diff.
- Do not describe behavior, refactors, fixes, or tests that are not reflected in the commit.

Include at most one `Co-authored-by` trailer that matches the AI assistant actually used to produce the change.

Examples:

- `Co-authored-by: Codex <267193182+codex@users.noreply.github.com>`
- `Co-authored-by: GitHub Copilot <copilot@github.com>`
- `Co-authored-by: Claude <81847+claude@users.noreply.github.com>`

If you are not one of the listed assistants, do not add a `Co-authored-by` trailer.

Instead, ask the human collaborator to provide the exact `Co-authored-by` trailer to use. Do not invent, infer, or generate one yourself.

## TGVIO Front End (`tgvio-web/`)

This fork embeds its own front end instead of OpenList-Frontend. Read `tgvio-web/README.md` for the code map and `tgvio/README.md` for build and deploy. The design rules below are the contract; keep new screens consistent with them.

### 定位

一个人用的私人片库与网盘：主要内容是短视频和图片，在 iPhone 和桌面浏览器上都要顺手。界面要像“影院”而不是“后台”：内容（封面）是主角，界面退后；动效要多、要有电影感，但任何时候都不能卡。设计参数：变化度 5、动效 9、密度 6。

### 视觉系统

- 一块近黑底（`#0c0c0d`）或冷灰底（浅色），一个强调色：酸橙绿 `--accent`。强调色只用于焦点、进度、主按钮和选中，不做装饰；危险操作用 `--danger`。不要紫蓝渐变、外发光、渐变大字。
- 层次靠字号、字重、留白和 1px 发丝线（`hairline`），少用卡片和阴影；需要浮起的东西（Dock、菜单、面板）才用 `glass` 和 `--shadow-float`。
- 字体 Geist / Geist Mono（自托管）；数字用等宽数字（`tabular`）。大标题紧字距（-0.04em）。
- 圆角固定三档：控件 10、卡片 14、面板 22，胶囊只用于开关和徽标。
- 图标只用 Phosphor（`XxxIcon` 命名），不手画 SVG。不用 emoji，界面文字用中文，不用破折号（em dash）。
- 深浅主题都要能用，默认跟随系统；登录页固定深色（`.theme-dark` 局部作用域）。
- 片库是成人内容：封面默认模糊（悬停或长按显示），登录前的页面不展示任何网盘内容（登录海报墙由代码绘制）。

### 动效原则

- 动效表达空间关系，而不是装饰：进入文件夹是从点击处“推进”，返回是“拉远”（`Stage`）；预览从缩略图原位放大，关闭时缩回当前文件的格子（`Viewer`）；删除、排序、重命名、捏合换列时其余文件滑向新位置（`lib/flip.ts`）；Dock 在有选择时变形为操作栏；搜索框展开成搜索面板；主题从点击处扩散。
- 一律弹簧（`lib/motion.ts` 的预设），时长型动画用 expo 缓出。按下有回弹（scale 0.92 到 0.97）。
- 只动 transform 和 opacity。连续值（指针位置、拖拽、滚动、下拉距离）用 Motion 的 motion value，不进 React state；不要监听 window scroll。
- 大列表靠虚拟滚动（`@tanstack/react-virtual`，必须 `useFlushSync: false`），格子 `memo`，入场动画用 CSS 关键帧和 `--i` 错峰，只有首屏错峰。
- 有隐喻的地方用实物的动作：分享结果是一张会“撕开”的票（二维码从中心涟漪拼出，提取码像翻牌落位），文件夹是一叠纸（封面由里面的图拼成，悬停时纸张散开、格子互换），影院模式的海报跟着指针倾斜并带高光。
- 一直在动的东西要自我保护：登录海报墙先测帧率，撑不住就停下来（`useCanDrift`）。颗粒只放在固定层上。
- `prefers-reduced-motion` 时所有动效关闭（`MotionConfig reducedMotion="user"` 加 CSS 媒体查询），功能不受影响。

### 交互模型

- 桌面：悬停显示次要按钮和光斑，右键菜单、框选、Shift 连选、拖到文件夹或面包屑移动、键盘（`/` 搜索、Backspace 上一级、Ctrl A、Delete、F2）。
- 手机：长按进入多选（多选中再长按出菜单），菜单一律底部操作表，双指捏合 2/3/4 列，下拉刷新，面板可下滑关闭，输入框 16px，悬停才有的按钮在触屏上隐藏。
- 预览里：滚轮在空白处切换文件，一次手势只切一个（冷却期内的滚轮事件会延长冷却）；缩略图条只给图片和视频；视频要有加载、自动播放被拦、浏览器放不了（给外部播放器）三种状态，并记住播放进度。
- 错误一律经过 `lib/errors.ts` 翻译成一句人话加下一步，原始英文报错（路径、驱动信息）绝不显示，只能“复制详情”。整块的错误用 `ErrorState`（被撕断的胶片，重试时两半接回去再请求），一行的用它的 compact 形态或 `reason()`。
- 片名对应的海报来自 TMDB（`internal/tgvio/tmdb.go`）：服务器清洗名字、后台排队查询（4 次/秒）、结果存 `data/tgvio/posters.json`、图片缓存在 `data/tgvio/posters/`；令牌只在 `data/tgvio/tmdb_token`，绝不进仓库和输出。有海报就不再为封面列 115 目录。匹配错了用右键「更换封面」改，人工选择优先。改名要经过 `TMDB.Renamed`/`RenamedDir`，海报记录才跟得上新名字；按 TMDB 改名一律先给计划再逐条执行。官方海报是公开图，不做模糊。
- 登录令牌绑定设备会话（`server/common/tgvio_sessions.go`），有效性看磁盘上的会话，不看内存缓存；新的登录入口要调用 `common.GenerateToken(user, c)` 传上请求。
- 用户可以有多个根目录（`BasePath` 一行一个，`internal/model/tgvio_roots.go`）：所有请求路径都经 `JoinPath` 换成真实路径，返回给用户的路径用 `ShowPath` 换回来；新增接口不要直接拼 `BasePath`。
- 大文件上传走 `/api/fs/staged/*`（`server/handles/tgvio_staged.go`）：分块写进 `data/tgvio/staged`（不是 temp，OpenList 启动会清空 temp），可跨会话续传。
- 管理员带「免密访问」，因为 Player 和后台任务用管理员走 WebDAV；不要去掉这个权限。想让管理员在网页里也输入文件夹密码，用设置 `tgvio_admin_folder_password`（只影响网页接口）。
- 视频缩略图（`hooks/useThumbs.ts`）：剧集单集用 TMDB 剧照，其他视频由服务器从 115 云端转码截帧，后台单队列、限速、熔断时暂停，结果永久缓存；不要改成浏览器直接拉视频截图。
- 视频优先用 115 云端转码（`/api/tgvio/video` 拿清晰度和票据，`/tgvio/hls/` 由服务器代取分片，浏览器拿不到网盘地址）；默认 1080P，原文件放不了或卡住时自动换云端，用户的清晰度选择会记住。
- 每个状态都要设计：骨架屏加载、空文件夹给出下一步、错误就地显示并可重试、需要密码的文件夹给内联表单、操作结果用 toast（可横滑关闭）。
- 操作先改本地缓存让界面立刻动起来，再后台向服务器重读；失败要回滚并提示。

### 工程约束

- 只调用 OpenList HTTP API，不依赖官方前端代码。新接口加在 `src/api/`，类型在 `src/lib/types.ts`。
- 115 有风控：不要增加列表请求。悬停预取同时最多一个，且只取未缓存的目录。文件夹封面（`hooks/useCover.ts`）只为在屏幕上停留过的文件夹排队取列表，同时一个、新的优先，结果缓存 30 分钟并顺手写入目录缓存。
- 站点在 Cloudflare 后面：页面 HTML 是 `no-cache`，`/api` 是 `no-store`，缺失的静态资源返回 404（`server/static/tgvio_cache.go`）；构建会把最近 6 次构建的哈希资源一起嵌入，旧页面不至于白屏。
- 改完先在本机测试实例 `/root/dev/oltest`（端口 5299，本地存储）上用 Playwright 走一遍桌面和手机流程并截图（`/root/dev/shots/olshot*.sh`），看帧时间，再用 `tgvio/upgrade.sh` 上线。
