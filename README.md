# luci-app-fakesip

用于 OpenWrt / ImmortalWrt 的 FakeSIP 软件包与 LuCI 管理界面。
本仓库提供完整 feed，包含：

- `fakesip`：基于 [killadm/FakeSIP](https://github.com/killadm/FakeSIP) 的构建包
- `luci-app-fakesip`：LuCI 管理界面
- procd 服务脚本、UCI 默认配置、定时重启任务和 GitHub Actions 自动构建

## 功能

- 指定接口或全部接口
- 入站、出站、双向处理
- IPv4、IPv6、双栈模式
- 默认使用 nftables，兼容 iptables
- 支持 NFQUEUE、fwmark、TTL、重复包、动态 TTL
- 支持 IP/CIDR 与端口范围黑白名单过滤规则
- 支持每天、每周、按小时定时重启
- 支持 FakeSIP 内置异步文件日志线程与按大小自动轮转，LuCI 只读取最近日志片段，避免大日志拖慢页面
- LuCI 页面提供版本显示、在线更新、状态查看、启动、停止、重启、更新定时任务、清理残留规则和最近日志查看

## 目标环境

主要面向：

- OpenWrt 24.10 / 25.12
- ImmortalWrt 24.10.5 / 24.10.6
- mt798x / `mediatek/filogic`，并通过 release 工作流覆盖多个常见 target
- firewall4 / nftables

## GitHub Actions 自动构建

仓库内置两个 GitHub Actions：

- `.github/workflows/build-ipk.yml`：日常 push / PR 构建，默认使用 ImmortalWrt 24.10.5 `mediatek/filogic` SDK。
- `.github/workflows/release.yml`：`v*` tag 或手动触发发布，构建 OpenWrt / ImmortalWrt 多版本、多 target 的发布包。

Release 工作流默认覆盖：

- OpenWrt 24.10.7：`.ipk`
- OpenWrt 25.12.5：`.apk`
- ImmortalWrt 24.10.5 / 24.10.6：`.ipk`
- `x86/64`、`mediatek/filogic`、`ramips/mt7621`、`ath79/generic`、`ipq40xx/generic`、`ipq806x/generic`、`qualcommax/ipq807x`、`bcm27xx/bcm2711`、`rockchip/armv8`

每个 release 会上传：

- 单独的 `fakesip` / `luci-app-fakesip` 安装包
- 每个 target 的 bundle、manifest 和 sha256 校验文件
- 顶层 `manifest.json` 与 `sha256sums.txt`

## 手动作为 feed 构建

把本仓库加入 OpenWrt / ImmortalWrt 源码树：

```sh
echo "src-git fakesip https://github.com/<your-name>/luci-app-fakesip.git" >> feeds.conf.default
./scripts/feeds update fakesip
./scripts/feeds install -p fakesip fakesip luci-app-fakesip
```

选择包：

```text
Network -> Firewall -> FakeSIP
LuCI -> Services -> FakeSIP
```

或者直接写入 `.config`：

```sh
cat >> .config <<'EOF'
CONFIG_PACKAGE_fakesip=m
CONFIG_PACKAGE_luci-app-fakesip=m
EOF
make defconfig
```

编译：

```sh
make package/fakesip/compile V=s
make package/luci-app-fakesip/compile V=s
```

生成的安装包通常位于：

```text
bin/packages/<arch>/fakesip/
```

## 安装

把 GitHub Actions 或本地 SDK 生成的 IPK 上传到 OpenWrt 24.x / ImmortalWrt 后安装：

```sh
opkg install fakesip_*.ipk luci-app-fakesip_*.ipk
```

OpenWrt 25.x 使用 APK 包格式：

```sh
apk add --allow-untrusted fakesip-*.apk luci-app-fakesip-*.apk
```

安装 LuCI 后，也可以在 `服务 -> FakeSIP -> 更新` 中查看当前版本，点击“检查更新”从 GitHub Release 检查匹配当前发行版、版本和 target 的发布包，再执行在线更新。

依赖未安装时，通常需要这些软件包：

- `ca-bundle`
- `uclient-fetch`
- `libnetfilter-queue`
- `libnfnetlink`
- `libmnl`
- `libpthread`
- `nftables`
- `kmod-nfnetlink-queue`
- `kmod-nft-queue`

## 配置说明

默认配置文件：

```text
/etc/config/fakesip
```

常用字段：

- `enabled`：是否启用服务
- `interface_mode`：`custom` 指定接口，`all` 全部接口
- `interfaces`：接口列表，默认 `wan`
- `direction`：`both`、`inbound`、`outbound`
- `ip_family`：`both`、`ipv4`、`ipv6`
- `queue_num`：NFQUEUE 编号，默认 `513`
- `fwmark` / `fwmask`：绕过标记与掩码
- `repeat`：重复包数
- `ttl`：生成包 TTL
- `dynamic_pct`：动态 TTL 百分比
- `skip_firewall`：跳过自动维护防火墙规则；慎选，除非必须自己维护外部防火墙规则。
- `use_iptables`：使用 iptables 兼容模式；慎选，建议优先使用 nftables。
- `log_file`：FakeSIP 文件日志，必须是 `/var/log`、`/mnt` 或 `/opt` 下的绝对路径，不能包含 `..` 或指向符号链接，默认 `/var/log/fakesip/fakesip.log`；留空时不传递 `-w`，日志输出到 stderr
- `log_max_size`：对应 `--log-max-size`，支持纯数字字节数或 `K`、`M`、`G` 后缀，默认 `1M`；设置为 `0` 表示关闭内置轮转
- `log_rotate_count`：对应 `--log-rotate`，保留的轮转日志份数，默认 `3`；设置为 `0` 表示超过大小后不保留历史日志
- `silent`：静默模式，默认开启；关闭会逐包输出日志，除排查问题时外，日常使用建议开启。
- `scheduled_restart`：启用定时重启

过滤规则使用独立的 `config filter` 节：

```text
config filter
	option action 'allow'
	option type 'ip'
	option value '1.2.3.0/24'

config filter
	option action 'deny'
	option type 'port'
	option value '12345'
```

- `action`：`allow` 为白名单规则，`deny` 为黑名单规则
- `type`：`ip` 支持 IPv4、IPv6 和 CIDR；`port` 支持单端口或 `5000-6000` 范围
- `value`：匹配源或目标 IP/端口；黑名单优先于白名单
- 过滤规则不会阻断真实流量，只限制哪些连接生成 FakeSIP 混淆包。

黑白名单匹配顺序：

- 只有黑名单：默认都处理，命中 `deny` 的不处理。
- 只有 IP 白名单：只处理源 IP 或目的 IP 命中的流量。
- 只有端口白名单：只处理源端口或目的端口命中的流量。
- 同时有 IP 白名单和端口白名单：必须 IP 命中且端口命中才处理。
- 同时命中 `allow` 和 `deny`：按 `deny` 处理，不生成 FakeSIP 混淆包。

服务管理：

```sh
/etc/init.d/fakesip start
/etc/init.d/fakesip stop
/etc/init.d/fakesip restart
/etc/init.d/fakesip update_cron
/etc/init.d/fakesip cleanup_rules
```

## 日志写入与轮转

配置 `log_file` 后，init 脚本会向 FakeSIP 传递 `-w <file>`，FakeSIP 会启用异步文件日志线程。主处理线程只负责格式化日志并写入队列，实际文件写入、flush、大小检查和轮转由日志线程完成。

默认单个日志文件达到 `1M` 后轮转，保留 `3` 份历史日志。轮转文件名格式为 `<logpath>.YYYYmmdd-HHMMSS`，同一秒内多次轮转时会追加数字后缀。`log_max_size=0` 会关闭内置轮转，`log_rotate_count=0` 表示超过大小后不保留历史日志。

## 定时重启

定时重启使用 OpenWrt 默认 cron 机制，任务写入：

```text
/etc/crontabs/root
```

支持三种模式：

- `daily`：每天固定时间重启
- `weekly`：每周指定星期和时间重启
- `interval`：按小时间隔重启，范围 `1-168`

## 注意事项

- FakeSIP 依赖 NFQUEUE，内核模块必须可用
- 默认使用 nftables，仅在兼容需求明确时再启用 iptables
- 修改 `queue_num`、`fwmark` 或 `fwmask` 后，建议重启服务确认规则生效
- `cleanup_rules` 只清理 FakeSIP 自己创建的规则

## 许可

本仓库的 LuCI 集成和软件包遵循 GPL-3.0-or-later。
上游 FakeSIP 项目同样遵循 GPL-3.0-or-later，见：

https://github.com/killadm/FakeSIP
