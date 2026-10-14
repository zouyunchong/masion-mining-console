#!/bin/zsh
set -e
TARGET="$HOME/Library/Application Support/MasionMiningHelper"
PLIST="$HOME/Library/LaunchAgents/xyz.masion.mining-helper.plist"
print '将停止矿工，删除 MASION 助手、全部本机挖矿配置和本助手的登录启动项。'
print '矿池账户和 LTC 不会删除。其他应用不会受影响。'
read 'answer?输入 DELETE 确认完整卸载：'
[[ "$answer" == 'DELETE' ]] || { print '已取消。'; exit 0; }
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
# Match only this installation's dedicated executables, including manual starts.
if [[ -x "$TARGET/runtime/node" ]]; then
 export MASION_UNINSTALL_TARGET="$TARGET"
 "$TARGET/runtime/node" --input-type=module - <<'NODE'
import {execFileSync} from 'node:child_process';
const target=process.env.MASION_UNINSTALL_TARGET;
const lines=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
const owned=lines.map(s=>s.trim().match(/^(\d+)\s+(.*)$/)).filter(m=>m&&Number(m[1])!==process.pid&&[target+'/runtime/node ',target+'/bin/xmrig '].some(prefix=>m[2].startsWith(prefix))).map(m=>Number(m[1]));
for(const pid of owned)try{process.kill(pid,'SIGTERM')}catch{}
await new Promise(r=>setTimeout(r,6000));
const remaining=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').map(s=>s.trim().match(/^(\d+)\s+(.*)$/)).filter(m=>m&&owned.includes(Number(m[1]))&&[target+'/runtime/node ',target+'/bin/xmrig '].some(prefix=>m[2].startsWith(prefix)));
for(const m of remaining)try{process.kill(Number(m[1]),'SIGKILL')}catch{}
NODE
fi
DESKTOP_LAUNCHER="$HOME/Desktop/Masion 挖矿助手.command"
if [[ -f "$DESKTOP_LAUNCHER" ]] && /usr/bin/grep -q '^# MASION_HELPER_DESKTOP_LAUNCHER$' "$DESKTOP_LAUNCHER"; then rm -f -- "$DESKTOP_LAUNCHER"; fi
rm -f -- "$PLIST"
rm -rf -- "$TARGET"
print 'MASION 助手、矿工、全部配置及登录启动项已删除。'
print '浏览器中如仍显示旧页面，请关闭；下载的安装包可自行删除。'
read '?按回车关闭窗口'
