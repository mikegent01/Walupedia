@echo off
REM Waluipedia - double-click: serves the site and opens the control panel (http://localhost:8765/panel).
REM The panel starts and stops the rest: workflow server (chat), sheets suite, TTS studio, and opens the
REM Waluipedia Hub, the Token Plate Studio and the NPC Forge. Ctrl-C here (or Shut down on the panel) stops it.
REM
REM   start.bat                 the control panel (python start.py)
REM   start.bat studio          Token Plate Studio on its own (tools\token-plate-studio.py)
REM   start.bat forge           NPC Forge on its own (tools\npc-forge.py)
REM   start.bat plates [args]   the hands-off token-plate batch (tools\make-token-plates.py render --full)
REM   start.bat tailscale       site + chatroom reachable from phones on your tailnet (--host 0.0.0.0 --workflow)
REM   start.bat --no-gui        anything else goes to start.py (python start.py --help lists the flags)
REM
REM Renders need Comfy Desktop open (127.0.0.1:8188 by default); the pages have a Start Comfy button too.
cd /d "%~dp0"
if /I "%~1"=="studio" goto studio
if /I "%~1"=="forge" goto forge
if /I "%~1"=="plates" goto plates
if /I "%~1"=="tailscale" goto tailscale
python start.py %*
goto end

:tailscale
python start.py --host 0.0.0.0 --workflow %2 %3 %4 %5 %6 %7 %8 %9
goto end

:studio
python tools\token-plate-studio.py %2 %3 %4 %5 %6 %7 %8 %9
goto end

:forge
python tools\npc-forge.py serve %2 %3 %4 %5 %6 %7 %8 %9
goto end

:plates
python tools\make-token-plates.py render --full %2 %3 %4 %5 %6 %7 %8 %9
echo.
echo Full run finished (exit code %errorlevel%: 0 = everybody plated, 2 = some left without a plate, 3 = the server went away).
echo Review: git status  --  the contact sheet is in ..\token-renders\run-sheet.png
echo Then:   python tools\sheets-suite.py        (plates -> prototype tokens -> Foundry packets)
pause
goto end

:end
if errorlevel 1 (
  echo.
  echo Something did not start. Python 3.10+ is needed; renders need Comfy Desktop running.
  pause
)
