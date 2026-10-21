# tgvio-web

OpenList 的自研前端。只依赖 OpenList HTTP API，`tgvio/build.sh` 把 `dist/` 嵌入二进制（`public/dist`）。

## 命令

```sh
npm ci
npm run dev        # http://127.0.0.1:5180，代理 /api /d /p 到 OPENLIST_URL（默认 http://127.0.0.1:5299）
npm run check      # tsc + vitest + vite build
```

本机测试实例：`/root/dev/oltest`（本地存储、端口 5299、管理员密码在 `.admin`），`config.json` 的 `dist_dir` 指向本目录 `dist/`。OpenList 启动时缓存 index.html，每次 build 后跑 `/root/dev/oltest/restart.sh`。截图脚本：`/root/dev/shots/olshot.sh`、`olshot2.sh`（Playwright 容器）。

## 代码地图

| 路径 | 内容 |
|---|---|
| `src/App.tsx` | 启动（公开设置、/api/me）、路由：`/@login`、`/@s/<id>`（公开分享页，免登录）、`/@manage/*`、其余为文件路径 |
| `src/lib/api.ts` | fetch 封装（`{code,message,data}`，401 回登录）、token 存 `localStorage.token`（与官方前端同 key） |
| `src/api/*.ts` | fs、auth（密码 sha256 加盐登录）、admin（存储/驱动/用户/设置/元信息/任务/TGVIO 统计与回收站） |
| `src/lib/upload.ts` | 上传：小文件 `PUT /api/fs/put`（As-Task），大文件 multipart 分片续传 |
| `src/stores/` | zustand：session、prefs（视图/排序/模糊/主题，持久化）、ui（选择、菜单、对话框、预览）、uploads、toast |
| `src/hooks/useDir.ts` | 目录查询（react-query key `["list", path]`）、文件夹密码（sessionStorage）、悬停预取（同时最多 1 个，防 115 风控） |
| `src/lib/actions.ts` | 新建/重命名/删除/移动/复制：先本地改缓存（配合 `lib/flip.ts` 的 FLIP 动画），再后台重读 |
| `src/components/Stage.tsx` | 文件夹转场（进入=从点击处放大，返回=缩小，跳转=横移），每个文件夹一层、各自滚动位置 |
| `src/components/DirectoryView.tsx` | 标题、排序、虚拟滚动（文件夹卡片行 + 缩略图行 / 列表行）、框选、拖放、空/错/密码状态、README |
| `src/components/Tile.tsx` | GridTile、FolderTile（里面的图拼成的动态封面）、ListRow（memo；指针光斑、长按菜单） |
| `src/hooks/useCover.ts` | 文件夹封面：可见才排队取列表（同时 1 个），缓存 30 分钟 |
| `src/components/Cinema.tsx` | 影院模式：大幅海报位、继续观看、可倾斜的海报墙 |
| `src/components/Share.tsx`, `src/pages/SharePage.tsx`, `src/api/share.ts` | 创建分享（有效期、提取码、次数）、二维码、我的分享；访客分享页 |
| `src/lib/errors.ts`, `src/components/ErrorState.tsx` | 报错翻译成人话（不显示原文）；“断片”错误态：胶片撕开、重试时接回 |
| `src/api/posters.ts`, `src/hooks/usePosters.ts`, `src/components/PosterPicker.tsx` | TMDB 海报：按名字批量查、待查的自动轮询、手动更换 |
| `src/lib/progress.ts` | 视频播放进度（本机 localStorage），供续播和继续观看 |
| `src/components/Viewer.tsx` | 预览：FLIP 打开/关回格子、手势、缩放、滚轮切换、各类型视图（视频含加载/外部播放器/续播） |
| `src/components/VideoPlayer.tsx` | 视频播放器：自绘控制条（缓冲区间、悬停时间、音量、倍速、画中画、全屏）、快捷键、双击快进、续播、卡住/放不了时给外部播放器 |
| `src/components/Dock.tsx` | 底部 Dock（桌面放大效果），有选择时变形为选择操作栏 |
| `src/components/Palette.tsx` | 搜索/命令面板（从顶栏搜索框 layoutId 变形） |
| `src/components/{Dialogs,Sheet,Menu,ContextMenu,Transfers,DropZone,Toaster}.tsx` | 对话框、底部/居中面板、菜单、传输面板、拖入上传、通知 |
| `src/components/PosterWall.tsx` | 登录页海报墙（生成的海报、CSS 无缝循环、指针倾斜、帧率不足时静止） |
| `src/pages/manage/` | 管理页；`Form.tsx` 按驱动/设置项类型渲染字段 |
| `src/styles/index.css` | 设计令牌（深/浅）、按钮/输入、关键帧、颗粒层、封面模糊 |

## 约定

- 动画只动 transform/opacity（少量一次性 width/height 除外）；连续值用 Motion 的 motion value，不进 React state。
- 虚拟滚动 `useFlushSync: false`，否则滚动掉帧。
- 手机：`Menu` 在窄屏自动变成底部操作表；长按只在单指且手指仍按着时生效（`Tile.tsx` 的 `fingers`），避免捏合误选。
- `.theme-dark` 局部深色区（登录页）要重新声明 Tailwind 的 `--color-*` 别名，已在 `index.css` 里做好。
- 一个强调色（`--accent`）；圆角：控件 10、卡片 14、面板 22。
- `MotionConfig reducedMotion="user"` + CSS 媒体查询，减少动态效果时全部关闭。
- 不写 em dash；界面文字中文。
- 旧内核（Chrome 86～98，360/QQ/搜狗等）：构建时 `legacy-css.ts` 在每个样式表旁写一份 `*.legacy.css`（展开 `@layer`、`:where`、逻辑属性，`translate/scale/rotate` 折成 `transform`，主题色的 `color-mix` 按深浅主题算成 rgba，`dvh` 前置 `vh`）。`index.html` 里的小脚本只在浏览器没有 `CSSLayerBlockRule` 时追加这份样式，并补 `Object.hasOwn`、`.at()`、`findLast`、`crypto.randomUUID` 和 `aspect-ratio`。主样式表不变。验证用 `zenika/alpine-chrome:86`。
