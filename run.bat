@echo off
where py >nul 2>nul && (py -3 "%~dp0run.py" %*) || (python "%~dp0run.py" %*)
pause