#!/bin/zsh
# MASION_HELPER_DESKTOP_LAUNCHER
set -e
ENTRY_DIR="${0:A:h}"
TARGET="$HOME/Library/Application Support/MasionMiningHelper"
PLIST="$HOME/Library/LaunchAgents/xyz.masion.mining-helper.plist"
HELPER_URL='http://127.0.0.1:4780/'
function ready() {
 /usr/bin/curl -fsS --max-time 2 "${HELPER_URL}api/health" 2>/dev/null | /usr/bin/grep -q '"product":"MasionMiningHelper"'
}
function failure() {
 print '助手未能启动。请保留窗口中的提示，或重新下载安装包后重试。'
 if [[ -t 0 ]]; then read '?按回车关闭窗口'; fi
}
trap 'result=$?; if (( result != 0 )); then failure; fi' EXIT
if ! ready; then
 if /usr/bin/nc -z 127.0.0.1 4780 2>/dev/null; then
  print '4780 端口正由其他程序占用，无法启动助手。'; exit 1
 fi
 if [[ -f "$TARGET/server.mjs" && -f "$PLIST" ]]; then
  launchctl kickstart "gui/$(id -u)/xyz.masion.mining-helper" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$PLIST"
 else
  if [[ -f "$ENTRY_DIR/助手文件/install-mac.command" ]]; then SOURCE="$ENTRY_DIR/助手文件"
  elif [[ -f "$ENTRY_DIR/install-mac.command" && "$ENTRY_DIR" != "$TARGET" ]]; then SOURCE="$ENTRY_DIR"
  else print '请从解压后的完整安装包中启动。'; exit 1; fi
  /bin/zsh "$SOURCE/install-mac.command" --quiet
 fi
 for attempt in {1..40}; do
  if ready; then break; fi
  /bin/sleep 0.25
 done
 if ! ready; then print '助手启动超时。请重新下载完整安装包后重试。'; exit 1; fi
fi
print '助手已就绪。启动助手不会自动开始挖矿。'
if [[ "${MASION_NO_OPEN:-0}" != '1' ]]; then /usr/bin/open "$HELPER_URL"; fi
