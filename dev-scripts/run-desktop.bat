@echo off
setlocal
rem Build the current working tree and launch it in the Electron shell.
rem
rem Double-click, or run from anywhere - it locates the repo relative to itself.
rem Equivalent to: npm run build && npm run build:desktop && npm --prefix desktop start
rem
rem This is the production-shaped desktop run: the packaged server bundle, the built
rem client, and the same %APPDATA%\Viator database the installed app uses. It is NOT
rem the HMR dev loop (that is "npm run dev" + "npm run dev:desktop").
rem
rem Port 8642 must be free - stop any "npm run dev" / "npm start" / installed Viator
rem first, or the window will just report the port is in use.
rem
rem Flags:
rem   --no-build   skip both builds and launch whatever is already compiled

cd /d "%~dp0.."
title Viator desktop (from source)

echo ==================================================
echo   Viator - build ^& launch the desktop app
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on your PATH.
  echo Install Node.js 22+ from https://nodejs.org and run this again.
  goto :error
)

if not exist "node_modules\" (
  echo Installing workspace dependencies ^(first run, this can take a minute^)...
  call npm install || goto :error
  echo.
)

rem desktop/ is deliberately not an npm workspace: it keeps its own lockfile and its
rem own better-sqlite3 built against Electron's ABI. See desktop/CLAUDE.md.
if not exist "desktop\node_modules\" (
  echo Installing desktop dependencies...
  call npm ci --prefix desktop || goto :error
  echo.
)

if /i "%~1"=="--no-build" goto :run

echo Building shared, server and client...
call npm run build || goto :error
echo.

echo Bundling the Electron shell...
call npm run build:desktop || goto :error
echo.

:run
echo Launching Viator. Close this window to stop it.
echo.
call npm --prefix desktop start || goto :error
goto :eof

:error
echo.
echo Something went wrong - see the messages above.
echo.
pause
exit /b 1
