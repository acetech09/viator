@echo off
setlocal
rem Launch Viator locally. Double-click this file to start the app.
rem It builds on first run, starts the server on http://localhost:8642,
rem and opens your browser. Close this window to stop the server.
rem
rem This is the run-from-source path and uses the database in this folder's
rem data\ directory. The installed desktop app is separate and keeps its own
rem database in %APPDATA%\Viator. Only one of them can hold port 8642 at a time.

cd /d "%~dp0"
title Viator server

echo ============================================
echo   Viator - EVE Online shopping list
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on your PATH.
  echo Install Node.js 22+ from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies ^(first run, this can take a minute^)...
  call npm install || goto :error
  echo.
)

rem Build if the compiled output is missing. Delete client\dist and server\dist
rem ^(or run "npm run build"^) after changing code to force a rebuild.
if not exist "client\dist\" goto :build
if not exist "server\dist\" goto :build
goto :run

:build
echo Building the app...
call npm run build || goto :error
echo.

:run
set NODE_ENV=production
echo Starting server on http://localhost:8642
echo Close this window to stop the server.
echo.

rem Open the browser a few seconds after the server starts.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8642"

call npm start
goto :eof

:error
echo.
echo Something went wrong - see the messages above.
echo.
pause
exit /b 1
