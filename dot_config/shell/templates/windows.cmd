@echo off
rem Installed by mise run shell:setup. CMD uses mise shims and inherited user ENV.
if defined MY_OPENCODE_CMD_INITIALIZED exit /b
set "MY_OPENCODE_CMD_INITIALIZED=1"
if defined MISE_DATA_DIR (
    if exist "%MISE_DATA_DIR%\shims\" set "PATH=%MISE_DATA_DIR%\shims;%PATH%"
) else (
    if exist "%LOCALAPPDATA%\mise\shims\" set "PATH=%LOCALAPPDATA%\mise\shims;%PATH%"
)
if exist "%USERPROFILE%\.local\bin\" set "PATH=%USERPROFILE%\.local\bin;%PATH%"
if exist "%USERPROFILE%\bin\" set "PATH=%USERPROFILE%\bin;%PATH%"
