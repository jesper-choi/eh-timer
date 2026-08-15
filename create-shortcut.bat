@echo off
chcp 65001 >nul
rem 바탕화면에 큐브 아이콘 바로가기를 만든다. 한 번만 실행하면 된다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\eh timer.lnk');" ^
  "$s.TargetPath = '%~dp0eh timer.bat';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.IconLocation = '%~dp0assets\icon.ico';" ^
  "$s.Description = 'eh timer';" ^
  "$s.Save()"

if errorlevel 1 (
	echo   바로가기 생성에 실패했습니다.
) else (
	echo.
	echo   바탕화면에 'eh timer' 바로가기를 만들었습니다.
	echo   앞으로는 그 아이콘을 더블클릭하면 됩니다.
	echo.
)
pause
