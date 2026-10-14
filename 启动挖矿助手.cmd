@echo off
REM MASION_HELPER_DESKTOP_LAUNCHER
setlocal
chcp 65001 >nul
set "MASION_HELPER_BUNDLE=%~dp0助手文件"
set "MASION_HELPER_TARGET=%LOCALAPPDATA%\MasionMiningHelper"
powershell.exe -NoProfile -NonInteractive -Command "try{$h=Invoke-RestMethod 'http://127.0.0.1:4780/api/health' -TimeoutSec 2;if($h.product -eq 'MasionMiningHelper'){exit 0}}catch{};exit 1"
if not errorlevel 1 goto ready
powershell.exe -NoProfile -NonInteractive -Command "$c=New-Object Net.Sockets.TcpClient;try{$t=$c.ConnectAsync('127.0.0.1',4780);if($t.Wait(500) -and $c.Connected){exit 0}}catch{}finally{$c.Dispose()};exit 1"
if not errorlevel 1 (
 echo 4780 端口正由其他程序占用，无法启动助手。
 pause
 exit /b 1
)
if exist "%MASION_HELPER_TARGET%\server.mjs" (
 start "Masion Helper" /min "%MASION_HELPER_TARGET%\runtime\node.exe" "%MASION_HELPER_TARGET%\server.mjs"
) else (
 if not exist "%MASION_HELPER_BUNDLE%\install-windows.cmd" set "MASION_HELPER_BUNDLE=%~dp0"
 call "%MASION_HELPER_BUNDLE%\install-windows.cmd" --quiet
 if errorlevel 1 (
  echo 助手安装失败。请重新下载并完整解压。
  pause
  exit /b 1
 )
)
powershell.exe -NoProfile -NonInteractive -Command "for($i=0;$i -lt 40;$i++){try{$h=Invoke-RestMethod 'http://127.0.0.1:4780/api/health' -TimeoutSec 2;if($h.product -eq 'MasionMiningHelper'){exit 0}}catch{};Start-Sleep -Milliseconds 250};exit 1"
if errorlevel 1 (
 echo 助手未能启动。请保留此窗口的提示，重新下载完整安装包后重试。
 pause
 exit /b 1
)
:ready
echo 助手已就绪。启动助手不会自动开始挖矿。
if not "%MASION_NO_OPEN%"=="1" start "" "http://127.0.0.1:4780/"
exit /b 0
