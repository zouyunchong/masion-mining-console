@echo off
cd /d "%~dp0"
echo Masion local helper - open http://127.0.0.1:4780/ for pairing.
"runtime\node.exe" server.mjs
pause
