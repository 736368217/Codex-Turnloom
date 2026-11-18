#!/bin/sh
# Restricted reverse-tunnel account for Codex-Turnloom on a Debian/Ubuntu relay.
#
# The Windows host runs `ssh -N -R 127.0.0.1:<port>:127.0.0.1:8787 <user>@<relay>`;
# this script creates that account with no shell, one key, and a single permitted
# listen address so a compromised relay cannot be turned into a general proxy.
#
# Usage:
#   sh setup-tunnel-user.sh <authorized-key-line> [remote-port]
#   TUNNEL_PUBKEY='ssh-ed25519 AAAA... comment' sh setup-tunnel-user.sh
#
# Idempotent: regenerates authorized_keys and the managed Match block.
set -eu

SVC_USER=${TUNNEL_USER:-codextunnel}
REMOTE_PORT=${2:-${TUNNEL_PORT:-18786}}
PUBKEY=${1:-${TUNNEL_PUBKEY:-}}

if [ -z "$PUBKEY" ]; then
  echo "usage: $0 <authorized-key-line> [remote-port]" >&2
  exit 1
fi
case "$PUBKEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *) ;;
  *) echo "error: key must be a single authorized_keys line" >&2; exit 1 ;;
esac

MARK_BEGIN='# BEGIN codex-turnloom reverse tunnel (managed)'
MARK_END='# END codex-turnloom reverse tunnel (managed)'

if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --create-home --home-dir "/home/$SVC_USER" --shell /usr/sbin/nologin "$SVC_USER"
  echo "created user $SVC_USER"
else
  echo "user $SVC_USER exists"
fi

HOME_DIR="/home/$SVC_USER"
install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$HOME_DIR/.ssh"
printf '%s\n' "$PUBKEY" > "$HOME_DIR/.ssh/authorized_keys"
chown "$SVC_USER:$SVC_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 0600 "$HOME_DIR/.ssh/authorized_keys"

# Rebuild the managed Match block at the end of sshd_config. A Match block is
# scoped to end-of-file, so it must live outside /etc/ssh/sshd_config.d/*.conf.
TMP=$(mktemp)
awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
  $0==b {skip=1; next}
  $0==e {skip=0; next}
  skip!=1 {print}
' /etc/ssh/sshd_config > "$TMP"
cat >> "$TMP" <<EOF

$MARK_BEGIN
Match User $SVC_USER
    AllowTcpForwarding remote
    PermitListen 127.0.0.1:$REMOTE_PORT
    PermitOpen none
    GatewayPorts no
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    PasswordAuthentication no
$MARK_END
EOF
cp /etc/ssh/sshd_config "/etc/ssh/sshd_config.bak-$(date +%Y%m%dT%H%M%S)"
cat "$TMP" > /etc/ssh/sshd_config
rm -f "$TMP"

sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "sshd reloaded; managed block:"
tail -n 12 /etc/ssh/sshd_config
