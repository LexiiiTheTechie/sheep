@echo off
rem Portable launcher for a Sheep release.
rem
rem At build time __APP__ is replaced with the app directory and __SHELL__ with
rem the desktop shell binary. Argument handling lives in the shell itself:
rem   --help                  -> python server.py --help
rem   --nowebui / --listen /
rem   --no-electron           -> engine only, no window

setlocal
set "DIR=%~dp0"
set "APP=%DIR%__APP__"
set "SHELL_BIN=%APP%\__SHELL__"

if not exist "%SHELL_BIN%" (
    echo Sheep shell not found: %SHELL_BIN%>&2
    exit /b 1
)

"%SHELL_BIN%" %*
exit /b %errorlevel%
