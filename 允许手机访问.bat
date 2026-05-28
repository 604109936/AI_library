@echo off
chcp 65001 >nul
REM 自动以管理员身份重启自己
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
REM 已是管理员：放行 TCP 3000 入站（覆盖所有网络类型，含公用网络）
powershell -NoProfile -Command "Remove-NetFirewallRule -DisplayName 'AI-Library-Dev-3000' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'AI-Library-Dev-3000' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any | Out-Null"
echo.
echo [OK] Port 3000 allowed for LAN.
echo Phone browser:  http://192.168.1.8:3000
echo.
echo （手机和电脑连同一个 WiFi，浏览器打开上面的地址即可）
echo.
pause
