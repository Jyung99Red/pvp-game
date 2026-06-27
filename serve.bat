@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==================================================
echo =             PVP Local Server Start             =
echo ==================================================
echo.

:: Automatically retrieve the local IPv4 address using PowerShell
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.InterfaceAlias -notlike '*Loopback*' -and $_.InterfaceAlias -notlike '*Virtual*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress[0]"`) do (
    set LOCAL_IP=%%i
)

if "%LOCAL_IP%"=="" (
    :: Fallback in case PowerShell extraction fails
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| find "IPv4"') do (
        set temp_ip=%%a
        set LOCAL_IP=!temp_ip: =!
    )
)

echo [PC Access]    http://localhost:8000/index.html
if not "%LOCAL_IP%"=="" (
    echo [Phone Access] http://%LOCAL_IP%:8000/index.html
    echo.
    echo [Tip] Make sure your phone is connected to the SAME Wi-Fi as this PC.
) else (
    echo [Warning] Could not detect local network IP automatically. Please check ipconfig.
)
echo.
echo Starting Python HTTP Server on port 8000...
echo.

:: Open the browser on PC
start http://localhost:8000/index.html

:: Start the Python static file server
python -m http.server 8000

endlocal