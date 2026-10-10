# TGVIO 版 OpenList

本分支（`tgvio`）= 官方 OpenList v4.2.6 + 为 TGVIO 适配的少量补丁。原二开（缩略图、代理节点池、多根挂载）已移除；`main` 分支仅作历史参考。

## 补丁

| 提交 | 内容 | 原因 |
|---|---|---|
| f3beb2a1 | 115 取链走 Android 接口；API 用浏览器 UA，仅上传初始化用 115Browser UA；115 请求 30 s 超时 | 官方 chrome downurl 接口在 TGVIO 负载下被 115 风控（405） |
| 48ffd764 | 按链接 `t=` 过期时间缓存下载链接（提前 2 min，最长 15 min） | 否则每个 WebDAV GET/Range 都向 115 取一次链接 |
| c00910a5 | `/api/fs/remove` 同一存储多文件合并为一次网盘删除（`driver.BatchRemove`） | Player 删除一个视频的封面、副本、原片 |
| 446ba887 | 批量删除后从网盘重新列目录核实，残留逐个删除 | 115 曾对 148 个文件的批量删除报成功却留下 2 个 |

新增代码集中在 `internal/driver/tgvio.go`、`internal/op/tgvio_remove*.go`、`internal/fs/tgvio_remove.go`，便于合并上游新版本。

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

systemd `openlist.service`：`/opt/openlist/openlist server`，数据 `/opt/openlist/data`，端口 5244。115 为 5 个同路径挂载 `/115/{照片,Pron,我要看,读书,软件}`。
