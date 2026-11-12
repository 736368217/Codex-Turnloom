#!/bin/sh
# Install or remove the optional Codex-Turnloom machine gateway service.
#
# POSIX sh; shellcheck-friendly (no bashisms, no `local`, all expansions quoted).
# This script does NOT run any installation by itself: it is meant to be invoked
# explicitly by an operator, e.g. `sudo sh deploy/install-server.sh --systemd`.
# It is idempotent: existing users, directories, configs and units are reused.
#
# Note: the gateway implementation itself lives in server/machine-gateway.cjs
# (provided by a parallel task); this installer only prepares config/unit files.

set -eu

PREFIX=/opt/codex-turnloom
CONFIG=/etc/codex-turnloom/machine.json
PORT=8787
SVC_USER=codex-turnloom
READONLY=0
USE_SYSTEMD=0
DO_UNINSTALL=0

UNIT_NAME=codex-turnloom-gateway.service
UNIT_PATH=/etc/systemd/system/$UNIT_NAME
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG_TEMPLATE=$SCRIPT_DIR/machine.example.json
UNIT_TEMPLATE=$SCRIPT_DIR/systemd/codex-turnloom-gateway.service

TMP_CONFIG=
TMP_UNIT=

cleanup() {
  [ -z "$TMP_CONFIG" ] || rm -f -- "$TMP_CONFIG" || true
  [ -z "$TMP_UNIT" ] || rm -f -- "$TMP_UNIT" || true
}
trap cleanup EXIT HUP INT TERM

die() {
  printf '错误: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '==> %s\n' "$*"
}

usage() {
  cat <<'EOF'
用法: sh deploy/install-server.sh [选项]

  --prefix <dir>    安装前缀（默认 /opt/codex-turnloom）
  --config <path>   机器网关配置（默认 /etc/codex-turnloom/machine.json）
  --port <n>        网关对外端口（默认 8787，1-65535）
  --user <name>     运行服务的系统用户（默认 codex-turnloom）
  --readonly        通过 CODEX_LAN_READONLY=1 让后端进入只读模式
  --systemd         生成并安装/启用 systemd 单元（不加则只准备目录与配置）
  --uninstall       停止并移除 systemd 单元（不删除配置与数据）
  -h, --help        显示本帮助

示例:
  sudo sh deploy/install-server.sh --systemd
  sudo sh deploy/install-server.sh --systemd --prefix /srv/turnloom \
    --config /etc/turnloom/machine.json --port 8787 --readonly
  sudo sh deploy/install-server.sh --uninstall

前置: Node.js >= 22.5、root 权限、Linux systemd（仅 --systemd 时）。
配置中的 REPLACE_WITH_* 占位符必须在启动前全部替换。
EOF
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "需要 root 权限，请用 sudo 运行（例如：sudo sh $0 --systemd）"
  fi
}

check_node() {
  NODE_BIN=$(command -v node || true)
  [ -n "$NODE_BIN" ] || die "找不到 node，请先安装 Node.js >= 22.5（package.json engines）"
  NODE_VERSION=$("$NODE_BIN" --version 2>/dev/null || true)
  NODE_MAJOR=${NODE_VERSION#v}
  NODE_MINOR=${NODE_MAJOR#*.}
  NODE_MAJOR=${NODE_MAJOR%%.*}
  NODE_MINOR=${NODE_MINOR%%.*}
  case "$NODE_MAJOR" in
    ''|*[!0-9]*) die "无法解析 node 版本：$NODE_VERSION" ;;
  esac
  case "$NODE_MINOR" in
    ''|*[!0-9]*) NODE_MINOR=0 ;;
  esac
  if [ "$NODE_MAJOR" -lt 22 ]; then
    die "Node.js 版本过低：$NODE_VERSION（需要 >= 22.5）"
  fi
  if [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; then
    die "Node.js 版本过低：$NODE_VERSION（需要 >= 22.5）"
  fi
  note "Node: $NODE_VERSION ($NODE_BIN)"
}

random_token() {
  # 24 bytes = 48 hex chars. No token is ever printed to stdout.
  if command -v openssl >/dev/null 2>&1; then
    RANDOM_HEX=$(openssl rand -hex 24 2>/dev/null) || RANDOM_HEX=
    if [ -n "$RANDOM_HEX" ]; then
      printf '%s\n' "$RANDOM_HEX"
      return 0
    fi
  fi
  if [ -r /dev/urandom ]; then
    od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
    printf '\n'
    return 0
  fi
  return 1
}

ensure_user() {
  if id "$SVC_USER" >/dev/null 2>&1; then
    note "系统用户已存在，复用：$SVC_USER"
    return 0
  fi
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER" \
      || die "创建系统用户失败：$SVC_USER"
  elif command -v adduser >/dev/null 2>&1; then
    adduser --system --no-create-home "$SVC_USER" \
      || die "创建系统用户失败：$SVC_USER"
  else
    die "找不到 useradd/adduser，请先手动创建系统用户 $SVC_USER"
  fi
  note "已创建系统用户：$SVC_USER"
}

ensure_dirs() {
  CONFIG_DIR=$(dirname -- "$CONFIG")
  if [ ! -d "$CONFIG_DIR" ]; then
    install -d -m 0750 "$CONFIG_DIR" || die "创建配置目录失败：$CONFIG_DIR"
    note "已创建配置目录：$CONFIG_DIR"
  fi
  install -d -m 0755 "$PREFIX" "$PREFIX/logs" /var/lib/codex-turnloom \
    || die "创建目录失败（$PREFIX / $PREFIX/logs / /var/lib/codex-turnloom）"
  chown "$SVC_USER" "$PREFIX/logs" /var/lib/codex-turnloom 2>/dev/null \
    || note "警告：无法把日志/数据目录属主改为 $SVC_USER，请手动检查权限"
  note "目录就绪：$PREFIX（WorkingDirectory）、$CONFIG_DIR、/var/lib/codex-turnloom"
}

ensure_config() {
  if [ -f "$CONFIG" ]; then
    note "配置已存在，保留不覆盖：$CONFIG"
    if grep -q 'REPLACE_WITH_' "$CONFIG"; then
      note "警告：配置仍含 REPLACE_WITH_* 占位符，请替换 machineToken、各 harness token、entry、codexHome 后再启动。"
    fi
    chmod 0600 "$CONFIG" || die "无法设置配置权限 0600：$CONFIG"
    return 0
  fi

  [ -f "$CONFIG_TEMPLATE" ] || die "找不到配置模板：$CONFIG_TEMPLATE"
  [ -f "$UNIT_TEMPLATE" ] || die "找不到 systemd 单元模板：$UNIT_TEMPLATE"
  command -v mktemp >/dev/null 2>&1 || die "找不到 mktemp，无法安全写入临时文件"

  MACHINE_TOKEN=$(random_token) || die "无法生成随机 machineToken（需要 openssl 或 /dev/urandom）"
  case "$MACHINE_TOKEN" in
    ''|*[!0-9a-f]*) die "生成的 machineToken 不是 16 进制字符串" ;;
  esac

  TMP_CONFIG=$(mktemp "$CONFIG.tmp.XXXXXX") || die "无法创建临时文件：$CONFIG.tmp.XXXXXX"
  sed "s/REPLACE_WITH_RANDOM_MACHINE_TOKEN/$MACHINE_TOKEN/" "$CONFIG_TEMPLATE" > "$TMP_CONFIG" \
    || die "写入配置模板失败：$CONFIG_TEMPLATE"
  if grep -q 'REPLACE_WITH_RANDOM_MACHINE_TOKEN' "$TMP_CONFIG"; then
    die "模板缺少 REPLACE_WITH_RANDOM_MACHINE_TOKEN 占位符，无法注入随机 machineToken"
  fi
  mv -- "$TMP_CONFIG" "$CONFIG" || die "落盘配置失败：$CONFIG"
  TMP_CONFIG=
  chmod 0600 "$CONFIG" || die "无法设置配置权限 0600：$CONFIG"
  chown "$SVC_USER" "$CONFIG" 2>/dev/null \
    || note "警告：无法把配置属主改为 $SVC_USER，请手动检查"
  note "已从模板创建配置：$CONFIG（machineToken 已随机生成，不在日志中打印）"
  note "必须替换剩余 REPLACE_WITH_*：每个 harness 的 token、entry、codexHome；token 必须互不相同且不等于 machineToken。"
  note "其它随机值可用：openssl rand -hex 24"
}

install_unit() {
  [ "$USE_SYSTEMD" -eq 1 ] || return 0
  command -v systemctl >/dev/null 2>&1 \
    || die "找不到 systemctl；--systemd 只适用于 Linux systemd 主机"

  TMP_UNIT=$(mktemp "$UNIT_PATH.tmp.XXXXXX") || die "无法创建临时文件：$UNIT_PATH.tmp.XXXXXX"
  awk \
    -v prefix="$PREFIX" \
    -v config="$CONFIG" \
    -v node="$NODE_BIN" \
    -v svcuser="$SVC_USER" \
    -v port="$PORT" \
    -v readonly="$READONLY" \
    '
      /^User=/ { print "User=" svcuser; next }
      /^WorkingDirectory=/ { print "WorkingDirectory=" prefix; next }
      /^ExecStart=/ {
        print "ExecStart=" node " " prefix "/server/machine-gateway.cjs --host 0.0.0.0 --port " port " --config " config
        next
      }
      /^ReadWritePaths=/ { print "ReadWritePaths=" prefix "/logs /var/lib/codex-turnloom"; next }
      /^ReadOnlyPaths=/ { print "ReadOnlyPaths=" config; next }
      /^\[Service\]/ {
        print
        if (readonly == "1") {
          print "# --readonly: 让网关 spawn 的后端继承 CODEX_LAN_READONLY=1（token 不进命令行）"
          print "Environment=CODEX_LAN_READONLY=1"
        }
        next
      }
      { print }
    ' "$UNIT_TEMPLATE" > "$TMP_UNIT" || die "生成 systemd 单元失败：$UNIT_TEMPLATE"

  mv -- "$TMP_UNIT" "$UNIT_PATH" || die "安装 systemd 单元失败：$UNIT_PATH"
  TMP_UNIT=
  chmod 0644 "$UNIT_PATH" || die "无法设置单元权限：$UNIT_PATH"
  systemctl daemon-reload || die "systemctl daemon-reload 失败"
  systemctl enable --now "$UNIT_NAME" || die "systemctl enable --now 失败：$UNIT_NAME"
  note "已安装并启用：$UNIT_PATH（--port $PORT，用户 $SVC_USER）"
  note "查看状态：systemctl status $UNIT_NAME；日志：journalctl -u $UNIT_NAME -f"
}

uninstall_unit() {
  if [ ! -f "$UNIT_PATH" ]; then
    note "未安装 systemd 单元，无需处理：$UNIT_PATH"
  else
    command -v systemctl >/dev/null 2>&1 \
      || die "找不到 systemctl，无法停止/反注册单元"
    if systemctl is-active --quiet "$UNIT_NAME"; then
      systemctl stop "$UNIT_NAME" || die "停止单元失败：$UNIT_NAME"
    fi
    systemctl disable "$UNIT_NAME" 2>/dev/null || true
    rm -f -- "$UNIT_PATH" || die "移除单元文件失败：$UNIT_PATH"
    if [ -d "$UNIT_PATH.d" ]; then
      rm -rf -- "$UNIT_PATH.d" || die "移除单元 drop-in 失败：$UNIT_PATH.d"
    fi
    systemctl daemon-reload || true
    note "已停止并移除 systemd 单元：$UNIT_NAME"
  fi
  note "配置 $CONFIG 与数据/日志目录均保留；如确认不再使用，请手动清理。"
  note "系统用户 $SVC_USER 也保留，避免误删其它服务依赖的身份。"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      [ "$#" -ge 2 ] || die "--prefix 需要一个目录参数"
      PREFIX=$2
      shift 2
      ;;
    --config)
      [ "$#" -ge 2 ] || die "--config 需要一个文件路径"
      CONFIG=$2
      shift 2
      ;;
    --port)
      [ "$#" -ge 2 ] || die "--port 需要一个 1-65535 的整数"
      PORT=$2
      shift 2
      ;;
    --user)
      [ "$#" -ge 2 ] || die "--user 需要一个用户名"
      SVC_USER=$2
      shift 2
      ;;
    --readonly) READONLY=1; shift ;;
    --systemd) USE_SYSTEMD=1; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（用 --help 查看用法）" ;;
  esac
done

case "$PREFIX" in
  /*) ;;
  *) die "--prefix 必须是绝对路径：$PREFIX" ;;
esac
case "$CONFIG" in
  /*) ;;
  *) die "--config 必须是绝对路径：$CONFIG" ;;
esac
case "$PORT" in
  ''|*[!0-9]*) die "--port 必须是 1-65535 的整数：$PORT" ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  die "--port 超出范围（1-65535）：$PORT"
fi

if [ "$DO_UNINSTALL" -eq 1 ]; then
  require_root
  uninstall_unit
  exit 0
fi

require_root
check_node
ensure_user
ensure_dirs
ensure_config

if [ "$USE_SYSTEMD" -eq 1 ]; then
  install_unit
else
  note "未指定 --systemd：只准备了用户/目录/配置，未安装或启动任何服务。"
  note "单元模板：$UNIT_TEMPLATE（可自行审阅后安装到 $UNIT_PATH）"
fi

if [ "$READONLY" -eq 1 ] && [ "$USE_SYSTEMD" -ne 1 ]; then
  note "--readonly 需要 --systemd 才会写入单元环境变量；否则请在各 harness 的 extraArgs 中加 --readonly。"
fi

note "完成。启动前请确认 $CONFIG 中不含任何 REPLACE_WITH_* 占位符，且文件权限为 0600。"
