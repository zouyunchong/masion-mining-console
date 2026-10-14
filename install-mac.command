#!/bin/zsh
set -e
SOURCE="${0:A:h}"
TARGET="$HOME/Library/Application Support/MasionMiningHelper"
PLIST="$HOME/Library/LaunchAgents/xyz.masion.mining-helper.plist"
if [[ "$SOURCE" == "$TARGET" ]]; then print '请从解压后的安装包运行安装文件。'; exit 1; fi
mkdir -p "$TARGET" "$HOME/Library/LaunchAgents"
rsync -a --exclude '.local' "$SOURCE/" "$TARGET/"
chmod +x "$TARGET/runtime/node" "$TARGET/bin/xmrig"
export MASION_HELPER_TARGET="$TARGET" MASION_HELPER_PLIST="$PLIST"
"$TARGET/runtime/node" --input-type=module - <<'NODE'
import fs from 'node:fs';
const target=process.env.MASION_HELPER_TARGET;
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const xml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>xyz.masion.mining-helper</string><key>ProgramArguments</key><array><string>${esc(target)}/runtime/node</string><string>${esc(target)}/server.mjs</string></array><key>WorkingDirectory</key><string>${esc(target)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${esc(target)}/helper.log</string><key>StandardErrorPath</key><string>${esc(target)}/helper-error.log</string></dict></plist>`;
fs.writeFileSync(process.env.MASION_HELPER_PLIST,xml);
NODE
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
print '助手已安装，登录系统后自动运行；不会自动启动挖矿。'
print '本机配对码：http://127.0.0.1:4780/'
print '网页入口：https://masion.xyz/LTC'
DESKTOP_LAUNCHER="$HOME/Desktop/Masion 挖矿助手.command"
if [[ ! -e "$DESKTOP_LAUNCHER" ]] || /usr/bin/grep -q '^# MASION_HELPER_DESKTOP_LAUNCHER$' "$DESKTOP_LAUNCHER"; then
 cp "$SOURCE/启动挖矿助手.command" "$DESKTOP_LAUNCHER"; chmod +x "$DESKTOP_LAUNCHER"
fi
if [[ "${1:-}" != '--quiet' ]]; then read '?按回车关闭安装窗口'; fi
