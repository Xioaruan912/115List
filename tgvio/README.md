# TGVIO 版 OpenList

本分支（`tgvio`）= 官方 OpenList v4.2.6 + 为 TGVIO 适配的少量补丁。原二开（缩略图、代理节点池、多根挂载）已移除；`main` 分支仅作历史参考。

## 补丁

| 提交 | 内容 | 原因 |
|---|---|---|
| f3beb2a1 | 115 取链走 Android 接口；API 用浏览器 UA，仅上传初始化用 115Browser UA；115 请求 30 s 超时 | 官方 chrome downurl 接口在 TGVIO 负载下被 115 风控（405） |
| 48ffd764 | 按链接 `t=` 过期时间缓存下载链接（提前 2 min，最长 15 min） | 否则每个 WebDAV GET/Range 都向 115 取一次链接 |
| c00910a5 | `/api/fs/remove` 同一存储多文件合并为一次网盘删除（`driver.BatchRemove`） | Player 删除一个视频的封面、副本、原片 |
| 446ba887 | 批量删除后从网盘重新列目录核实，残留逐个删除 | 115 曾对 148 个文件的批量删除报成功却留下 2 个 |
| 40d12fc8 | 分片上传在返回前取消并等待读取协程结束 | 提前返回后协程仍读已释放的缓存，进程 SIGSEGV（一天 4 次） |
| 366c18ab | 全部 115 存储共用限速（`TGVIO_115_API_RATE`，默认 4 次/秒）；405 触发熔断（降到 5 s 一次，30 s 起翻倍至 15 min）；发送前的连接失败（拨号、TLS 握手超时）重试 3 次 | 风控按账号/IP 判断；本机到 115 的新 TLS 握手约一半被丢弃 |
| 5e3b5100 | 列出并按 ID 清理 115 回收站（拒绝空列表，空列表对 115 意味着全部） | 经 OpenList 的删除只进回收站，不释放空间 |
| 439c8095 | 监控与回收站接口（见下） | Player/运维可读运行状况与空间 |
| 654580d1 | 大文件上传断点续传（45 min 内同文件同目录跳过 OSS 已有分片，失败自动整传）；分片重试 5 次、间隔 1/2/4/8 s | 每次上传初始化都分配新 OSS 对象，只能沿用上次的参数续传 |

新增代码集中在 `internal/tgvio/`、`internal/driver/tgvio.go`、`internal/op/tgvio_remove*.go`、`internal/fs/tgvio_remove.go`、`drivers/115/tgvio_*.go`、`server/handles/tgvio.go`，便于合并上游新版本。测试：`go test ./drivers/115/ ./server/handles/ ./internal/op/`（本机无 gcc，未跑 `-race`）。

## 接口

| 接口 | 权限 | 内容 |
|---|---|---|
| `GET /api/tgvio/stats` | 已登录、非访客 | 启动时间与运行时长（崩溃后会重置）、计数器（`115_calls:*`、`115_405`、`115_connect_*`、`link_cache_hits/misses`、`115_upload_*`）、熔断状态、网盘空间（缓存 10 min） |
| `GET /api/admin/tgvio/recycle?offset=&limit=` | 管理员 | 115 回收站一页（≤1000 项）及其大小 |
| `POST /api/admin/tgvio/recycle/clean` `{"ids":[...]}` | 管理员 | 永久清理 1–1000 个指定条目，绝不清空整个回收站 |

## 前端

默认嵌入 `tgvio-web/` 里的自研前端（React + Vite + Tailwind v4 + Motion），与官方 OpenList-Frontend 无代码关系，只用 OpenList 的 HTTP API。代码地图与约定见 `tgvio-web/README.md`。

- 文件：网格/列表（虚拟滚动，1500+ 项流畅）、进入文件夹的纵深缩放转场、框选/Shift 连选/拖到文件夹或面包屑移动、右键与长按菜单、新建/重命名/移动/复制/删除（FLIP 过渡）、属性与直链、离线下载、文件夹密码。
- 分享：右键或选择后生成链接（有效期、提取码、访问次数），带二维码；访客打开 `/@s/<id>` 无需登录；账户菜单里的「我的分享」可停用或删除。
- 影院模式：顶栏第三个视图，大幅海报位跟随悬停的条目，继续观看一行，海报墙。
- 文件夹封面：网格视图里文件夹显示里面图片拼成的封面，悬停时轮换。
- 海报：文件夹和视频按片名自动配 TMDB 海报（网格封面、影院模式大图与简介），右键「更换封面」手动挑选。令牌放在 `data/tgvio/tmdb_token`（权限 600），不进仓库。
- 回收站清理：115 账户设了安全密钥时，清理前要输入 6 位安全密钥（只在本次浏览中记住）。
- 管理员文件夹密码：用户页或元信息页的「在网页里也输入文件夹密码」，只影响网页，WebDAV 不变。
- 云端转码播放：115 的视频默认用网盘自己的 HLS 转码（4K、1080P 等，H.264），服务器代取分片；清晰度菜单可切回原画。每个视频只多一次主列表和一次清晰度列表请求，各缓存 30 分钟，走 115 的限速与 405 熔断。
- 视频：网盘链接慢时有加载提示，浏览器放不了时给出外部播放器（Infuse、nPlayer、VLC、IINA、PotPlayer），记住进度续播；预览里滚轮切换文件。
- 压缩包：在预览里直接浏览 zip/rar/7z/tar 目录、打开或下载单个文件、带密码的压缩包、解压整个或当前文件夹到任意目录（服务器任务）。
- 预览：图片（从格子放大展开、双击/滚轮/双指缩放、左右滑动、下拉关闭、缩略图条）、视频、音频、文本/代码/Markdown；其他类型给下载。
- 上传：拖入窗口或选择文件/文件夹；16 MB 以上走 `/api/fs/multipart`（分片并发 3、单片重试、断线续传），其余 `/api/fs/put` 作为任务；传输面板含服务器任务。
- 搜索面板（`/` 或 Ctrl K）：当前文件夹模糊筛选、全局搜索（需开启索引）、命令。
- 管理（`/@manage`）：概览（115 空间、访问统计、回收站清理）、存储（按驱动定义生成表单）、用户与权限、元信息、设置、任务。
- 登录页：倾斜的电影海报墙（海报由代码绘制，不加载外部资源、不展示网盘内容），列交替上下滚动、随指针倾斜，登录后整面墙推近淡出；设备跟不上 60 fps 时自动改为静止。
- 手机：长按进入多选（再长按出菜单）、菜单改为底部操作表、双指捏合切换 2/3/4 列、下拉刷新、输入框 16px 防 iOS 放大。
- 封面默认模糊（悬停/长按显示，搜索面板可切换）；深浅主题跟随系统；`prefers-reduced-motion` 时关闭动效。

## 构建

```sh
bash tgvio/build.sh                      # 默认嵌入 tgvio-web（先跑 tsc、vitest、vite build）
TGVIO_UI=official bash tgvio/build.sh    # 改嵌官方前端 v4.2.6
```

需要 Go（/usr/local/go）、Node（/root/.local/bin）与干净的工作区。输出 `/root/build/openlist-tgvio/openlist-<commit>`；官方前端同时解压在 `/root/build/openlist-tgvio/web/official-v4.2.6/`，在 `data/config.json` 设 `"dist_dir"` 指向它并重启，即可不换二进制切回官方界面（清空 `dist_dir` 再重启切回）。

## 升级（只换二进制）

```sh
bash tgvio/upgrade.sh /root/build/openlist-tgvio/openlist-<commit>
```

备份当前二进制到 `/root/backup/openlist-upgrade-<时间>/`，替换后核对目录列表、读写删与批量删除（`probe.py` 在 tgvio-player 容器内以 Player 账号执行）；任一失败自动换回旧二进制。

## 回滚

```sh
systemctl stop openlist
install -m 755 /root/backup/openlist-upgrade-<时间>/openlist.previous /opt/openlist/openlist
systemctl start openlist
```

## 部署事实

- 本机到 115 上传端（OSS 深圳，80 端口）RTT 约 216 ms、丢包约 5%，单连接上限约 1.8 Mbps，且分片须按序上传；宿主机已改用 BBR（`/etc/sysctl.d/90-tgvio-bbr.conf`），30 MB 上传 744 s → 274 s。秒传命中的上传不受影响。
- WebDAV PUT 任何失败都会被 OpenList 报成 405；客户端断开不会中止上传（期间对同一路径的 PUT 得到 423）。

systemd `openlist.service`：`/opt/openlist/openlist server`，数据 `/opt/openlist/data`，端口 5244。115 为 5 个同路径挂载 `/115/{照片,Pron,我要看,读书,软件}`。
