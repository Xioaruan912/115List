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

## 构建

```sh
bash tgvio/build.sh            # 需要 Go（/usr/local/go）与干净的工作区
```

下载并校验官方前端 dist（v4.2.6），嵌入后编译为 `/root/build/openlist-tgvio/openlist-<commit>`。

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
