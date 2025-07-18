@echo off
cd /d "C:\Users\xii90\Documents\line-bot-name-collector"

echo Starting ngrok and bot...

start /min "" npx ngrok http 3000

timeout /t 4 /nobreak >nul

:: 用 PowerShell 抓 ngrok URL
for /f "delims=" %%A in ('powershell -Command "(Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels[0].public_url"') do set NGROK_URL=%%A

set WEBHOOK_URL=%NGROK_URL%/webhook
echo Webhook URL: %WEBHOOK_URL%

:: 從 .env 取得 TOKEN
for /f "tokens=1,2 delims==" %%A in ('type .env') do (
    if "%%A"=="CHANNEL_ACCESS_TOKEN" set TOKEN=%%B
)

:: 設定 webhook
curl -X PUT https://api.line.me/v2/bot/channel/webhook/endpoint ^
-H "Authorization: Bearer %TOKEN%" ^
-H "Content-Type: application/json" ^
-d "{\"endpoint\":\"%WEBHOOK_URL%\"}"

:: 啟動機器人
start "" node index.js

echo Bot and ngrok started. You may now use your LINE bot.
pause
