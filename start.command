#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -x runtime/node ]]; then
 runtime/node server.mjs
elif command -v node >/dev/null; then
 node server.mjs
else
 print '请使用带运行环境的完整助手包。'
fi
