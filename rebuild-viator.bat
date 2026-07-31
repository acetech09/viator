@echo off
setlocal
rem Rebuild + launch Viator locally. Double-click this file after changing code.
rem Unlike start-viator.bat (which only builds when dist is missing), this ALWAYS
rem runs a fresh build first, then starts the server on http://localhost:8642 and
rem opens your browser. Close this window to stop the server.

cd /d "%~dp0"
title Viator server (rebuild)

echo ============================================
echo   Viator - EVE Online shopping list
echo   (rebuild + launch)
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

echo Building the app ^(fresh build every time^)...
call npm run build || goto :error
echo.

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
