#!/usr/bin/env bash
set -euo pipefail

ROOT="${HERMES_ROOT:-$HOME/.hermes}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/diario_kanban.py"
BIN_DIR="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
STATE_DIR="$HOME/.local/state/time/diarios"

mkdir -p "$BIN_DIR" "$UNIT_DIR" "$STATE_DIR"
install -m 0755 "$SRC" "$BIN_DIR/time-diario-kanban"

cat > "$UNIT_DIR/time-diario-kanban.service" <<SERVICE
[Unit]
Description=Gerar diario diario dos agentes Hermes sem IA

[Service]
Type=oneshot
ExecStart=$BIN_DIR/time-diario-kanban --root $ROOT
SERVICE

cat > "$UNIT_DIR/time-diario-kanban.timer" <<TIMER
[Unit]
Description=Gerar diario dos agentes as 23h55

[Timer]
OnCalendar=*-*-* 23:55:00
Persistent=true
Unit=time-diario-kanban.service

[Install]
WantedBy=timers.target
TIMER

systemctl --user daemon-reload
systemctl --user enable --now time-diario-kanban.timer
systemctl --user list-timers time-diario-kanban.timer
