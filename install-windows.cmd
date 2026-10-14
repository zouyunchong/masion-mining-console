@echo off
setlocal
cd /d "%~dp0"
set "TARGET=%LOCALAPPDATA%\MasionMiningHelper"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MasionMiningHelper.cmd"
if /I "%~dp0"=="%TARGET%\" (
 echo Run the installer from the extracted download folder.
 if /I not "%~1"=="--quiet" pause
 exit /b 1
)
if not exist "%TARGET%" mkdir "%TARGET%"
robocopy "%~dp0." "%TARGET%" /E /XD .local /NFL /NDL /NJH /NJS
if errorlevel 8 (
 echo Copy failed.
 if /I not "%~1"=="--quiet" pause
 exit /b 1
)
> "%STARTUP%" echo @echo off
>> "%STARTUP%" echo cd /d "%TARGET%"
>> "%STARTUP%" echo start "Masion Helper" /min "%TARGET%\runtime\node.exe" "%TARGET%\server.mjs"
start "Masion Helper" /min "%TARGET%\runtime\node.exe" "%TARGET%\server.mjs"
echo Installed. Helper starts at login. Mining requires clicking Start.
echo Pairing code: http://127.0.0.1:4780/
echo Website: https://masion.xyz/LTC
if not exist "%USERPROFILE%\Desktop\Masion 挖矿助手.cmd" copy /Y "%~dp0启动挖矿助手.cmd" "%USERPROFILE%\Desktop\Masion 挖矿助手.cmd" >nul
if /I not "%~1"=="--quiet" pause
