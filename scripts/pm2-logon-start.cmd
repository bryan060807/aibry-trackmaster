@echo off
setlocal

set "PM2_HOME=%USERPROFILE%\.pm2"
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
set "PM2_CMD=%APPDATA%\npm\pm2.cmd"
set "TRACKMASTER_ROOT=%USERPROFILE%\aibry\projects\aibry-trackmaster"
set "LOG_FILE=%USERPROFILE%\pm2-startup.log"

echo [%date% %time%] PM2 logon startup begin>>"%LOG_FILE%"

call "%PM2_CMD%" resurrect>>"%LOG_FILE%" 2>&1
set "RESURRECT_EXIT=%ERRORLEVEL%"

pushd "%TRACKMASTER_ROOT%"
if errorlevel 1 (
  echo [%date% %time%] ERROR: TrackMaster project directory was not found.>>"%LOG_FILE%"
  exit /b 1
)

call "%PM2_CMD%" startOrRestart ecosystem.production.config.cjs --update-env>>"%LOG_FILE%" 2>&1
set "TRACKMASTER_EXIT=%ERRORLEVEL%"

call "%PM2_CMD%" save>>"%LOG_FILE%" 2>&1
set "SAVE_EXIT=%ERRORLEVEL%"

popd

echo [%date% %time%] PM2 logon startup complete: resurrect=%RESURRECT_EXIT% trackmaster=%TRACKMASTER_EXIT% save=%SAVE_EXIT%>>"%LOG_FILE%"

if not "%RESURRECT_EXIT%"=="0" exit /b %RESURRECT_EXIT%
if not "%TRACKMASTER_EXIT%"=="0" exit /b %TRACKMASTER_EXIT%
if not "%SAVE_EXIT%"=="0" exit /b %SAVE_EXIT%
exit /b 0
