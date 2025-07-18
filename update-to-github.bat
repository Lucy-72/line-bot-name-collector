@echo off
cd /d "%~dp0"
echo 🚀 開始推送最新程式碼到 GitHub...

REM 設定 Git 使用者（若已設定可略過）
git config user.name "你的GitHub帳號"
git config user.email "你的Email"

REM 加入全部變更
git add .

REM 自動建立 commit 訊息（可修改為你想要的）
git commit -m "🚀 自動推送最新更新"

REM 推送到 GitHub
git push origin main

echo ✅ 已完成推送！你可以去 Render 查看是否重新部署。
pause
