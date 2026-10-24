@echo off
REM Waluipedia - double-click: bring the branch you are on up to date with gh-pages, then push it.
REM It merges origin/gh-pages INTO your working branch (gh-pages itself is never touched, so an open
REM PR stays open). Uncommitted work is stashed and put back. On gh-pages it just pulls.
REM
REM   sync.bat            fetch, merge gh-pages in, push this branch
REM   sync.bat nopush     fetch and merge only
cd /d "%~dp0"
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo Branch: %BRANCH%
git fetch origin --prune --tags
if errorlevel 1 goto fail
if /I "%BRANCH%"=="gh-pages" (
  git pull --ff-only --autostash origin gh-pages
  goto done
)
git merge --autostash --no-edit origin/gh-pages
if errorlevel 1 goto conflict
if /I "%~1"=="nopush" goto done
git push -u origin %BRANCH%
if errorlevel 1 goto fail
goto done

:conflict
echo.
echo Merge stopped on conflicts. Fix them, "git commit", then run sync.bat again.
echo (Or undo with: git merge --abort)
goto fail

:fail
echo.
echo Sync did not finish.
pause
exit /b 1

:done
echo.
echo Synced.
pause
