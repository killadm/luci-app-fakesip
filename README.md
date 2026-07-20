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
- 支持文件日志按大小自动轮转，LuCI 只读取最近日志片段，避免大日志拖慢页面
- LuCI 页面提供状态查看、启动、停止、重启、更新定时任务、清理残留规则和最近日志查看

## 目标环境

主要面向：

- ImmortalWrt 24.10.5
- mt798x / `mediatek/filogic`
- firewall4 / nftables

## GitHub Actions 自动构建

仓库内置 GitHub Actions：

- workflow 文件：`.github/workflows/build-ipk.yml`
- 触发方式：`push`、`pull_request`、`workflow_dispatch`
- 默认 SDK：`immortalwrt-sdk-24.10.5-mediatek-filogic_gcc-13.3.0_musl.Linux-x86_64.tar.zst`

构建完成后会上传以下 Artifact：

- `fakesip_*.ipk`
- `luci-app-fakesip_*.ipk`
- `sha256sums.txt`

Artifact 名称类似：

```text
fakesip-ipk-immortalwrt-24.10.5-mediatek-filogic
```

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

生成的 IPK 通常位于：

```text
bin/packages/<arch>/fakesip/
```

## 安装

把 GitHub Actions 或本地 SDK 生成的 IPK 上传到路由器后安装：

```sh
opkg install fakesip_*.ipk luci-app-fakesip_*.ipk
```

依赖未安装时，通常需要这些软件包：

- `libnetfilter-queue`
- `libnfnetlink`
- `libmnl`
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
- `skip_firewall`：跳过防火墙规则
- `use_iptables`：使用 iptables 兼容模式
- `log_file`：FakeSIP 文件日志，必须是 `/var/log`、`/mnt` 或 `/opt` 下的绝对路径，默认 `/var/log/fakesip/fakesip.log`
- `log_max_size_kb`：单个文件日志达到该大小后轮转，默认 `512` KB
- `log_rotate_count`：保留的轮转日志份数，默认 `3`
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

服务管理：

```sh
/etc/init.d/fakesip start
/etc/init.d/fakesip stop
/etc/init.d/fakesip restart
/etc/init.d/fakesip update_cron
/etc/init.d/fakesip rotate_log
/etc/init.d/fakesip cleanup_rules
```

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
