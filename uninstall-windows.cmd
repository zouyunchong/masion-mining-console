@echo off
setlocal
chcp 65001 >nul
echo 将停止矿工，删除 MASION 助手、全部配置和本助手的登录启动项。
echo 矿池账户和 LTC 不会删除。其他应用不会受影响。
set /p "MASION_UNINSTALL_CONFIRM=输入 DELETE 确认完整卸载："
powershell.exe -NoProfile -NonInteractive -Command "if($env:MASION_UNINSTALL_CONFIRM -cne 'DELETE'){Write-Host '已取消。'; exit 0}; $ErrorActionPreference='Stop'; $desktopLauncher=Join-Path $env:USERPROFILE 'Desktop\Masion 挖矿助手.cmd'; if((Test-Path -LiteralPath $desktopLauncher) -and (Select-String -LiteralPath $desktopLauncher -SimpleMatch 'REM MASION_HELPER_DESKTOP_LAUNCHER' -Quiet)){Remove-Item -LiteralPath $desktopLauncher -Force}; $target=Join-Path $env:LOCALAPPDATA 'MasionMiningHelper'; $startup=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MasionMiningHelper.cmd'; Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue; $paths=@((Join-Path $target 'runtime\node.exe'),(Join-Path $target 'bin\xmrig.exe')); $owned=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($paths -contains $_.ExecutablePath) }); $owned | Where-Object {$_.ExecutablePath -eq $paths[0]} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}; Start-Sleep -Seconds 2; $owned | Where-Object {$_.ExecutablePath -eq $paths[1]} | ForEach-Object {$current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.ProcessId); if($current -and $current.ExecutablePath -eq $paths[1]){Stop-Process -Id $current.ProcessId -Force -ErrorAction SilentlyContinue}}; if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}; Write-Host 'MASION 助手、矿工、配置及登录启动项已删除。'"
if errorlevel 1 echo 卸载未完成，请检查提示后重试。
pause
