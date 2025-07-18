@echo off
echo ✅ 開始初始化 Git 倉庫...

REM 設定 Git 使用者身份（請修改為你自己的資料）
git config --global user.name "Lucy"
git config --global user.email "smile367220@yahoo.com.tw"

REM 初始化 Git 倉庫（若尚未初始化）
IF NOT EXIST .git (
    git init
)

REM 建立 .gitignore（如果不存在）
IF NOT EXIST .gitignore (
    echo node_modules/> .gitignore
    echo .env>> .gitignore
    echo nickname.db>> .gitignore
    echo push-to-github.bat>> .gitignore
)

REM 加入所有檔案，提交 commit
git add .
git commit -m "初始化專案"

REM 切換為 main 分支
git branch -M main

REM 設定 GitHub 遠端網址（請確認是否跟你的 repo 相符）
git remote add origin https://github.com/Lucy-72/line-bot-name-collector.git

REM 強制推送到 GitHub（⚠️ 覆蓋遠端 main 分支）
git push -u origin main --force

echo 🚀 專案已成功推送到 GitHub！
pause
