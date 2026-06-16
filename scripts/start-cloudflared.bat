@echo off
REM Start cloudflared tunnel in background (if not already running)
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>NUL | find /I /N "cloudflared.exe" >NUL
if "%ERRORLEVEL%"=="1" (
    start "" /B "C:\Users\youzi\withtoge\bin\cloudflared.exe" --config "C:\Users\youzi\.cloudflared\config.yml" tunnel run ke-tunnel
    echo Cloudflared tunnel started
) else (
    echo Cloudflared already running
)
