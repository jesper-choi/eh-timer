@echo off
chcp 65001 >nul
title eh timer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
	echo.
	echo   Node.js가 필요합니다.
	echo   https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
	echo.
	pause
	exit /b 1
)

rem gist 동기화 설정이 있으면 사용
set ENVFLAG=
if exist .env set ENVFLAG=--env-file=.env

rem 서버가 뜨는 동안 기다렸다가 기본 브라우저를 연다
start /b "" cmd /c "ping -n 3 127.0.0.1 >nul & rundll32 url.dll,FileProtocolHandler http://localhost:8000/"

echo.
echo   eh timer - http://localhost:8000
echo   이 창을 닫으면 타이머가 종료됩니다.
echo.
node %ENVFLAG% server.js 8000

echo.
echo   서버가 종료되었습니다. (포트 8000이 이미 사용 중이면 이미 실행 중일 수 있습니다)
pause
