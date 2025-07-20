require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// ✅ 授權群組 ID（可多個）
const allowedGroups = [
  'Ce60dfe3b5c78e72f7d556dcc9a9f03dd'
];

// ✅ LINE BOT 設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ✅ SQLite DB 初始化
const db = new sqlite3.Database('nickname.db');
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS nicknames (
      lineId TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      server TEXT NOT NULL,
      note TEXT,
      name TEXT
    )
  `);
});

// ✅ webhook 路徑
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error('處理 webhook 發生錯誤：', err);
    res.status(500).end(); // 避免 timeout
  }
});

// ✅ 處理事件主邏輯
async function handleEvent(event) {
  console.log('📩 收到事件：', JSON.stringify(event, null, 2));

  const userId = event.source.userId;
  const text = event.message?.text;
  const groupId = event.source.groupId;

  // ✅ 限定群組使用
  if (event.source.type === 'group' && !allowedGroups.includes(groupId)) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '這個群組不是授權名單，我將離開。'
    }).then(() => client.leaveGroup(groupId));
  }

  // ✅ 加入群組事件
  if (event.type === 'join' && event.source.type === 'group') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '嗨，我來啦！這是主人允許的群組，請輸入 @登記暱稱 開始使用～'
    });
  }

  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  // ✅ 取得使用者名稱
  const userName = await getDisplayName(event.source);

  // ✅ 登記暱稱
  if (text.startsWith('@登記暱稱')) {
    const parts = text.split('/');
    const nickname = parts[1]?.trim();
    const server = parts[2]?.trim();
    const note = parts[3]?.trim() || '';

    if (!nickname || !server) {
      return reply(event.replyToken, '請輸入格式：@登記暱稱/暱稱/伺服器/備註（備註可省略）');
    }

    await new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO nicknames (lineId, nickname, server, note, name)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(lineId) DO UPDATE SET
          nickname = excluded.nickname,
          server = excluded.server,
          note = excluded.note,
          name = excluded.name
      `);

      stmt.run(userId, nickname, server, note, userName, err => {
        if (err) reject(err);
        else resolve();
      });

      stmt.finalize();
    });

    return reply(event.replyToken, `✅ 暱稱已登記為：${nickname}`);
  }

  // ✅ 查詢
  if (text.startsWith('@找人/')) {
    const keyword = text.split('/')[1]?.trim();
    if (!keyword) return reply(event.replyToken, '請輸入關鍵字！');

    return new Promise((resolve, reject) => {
      db.all(`
        SELECT * FROM nicknames
        WHERE nickname LIKE ? OR server LIKE ? OR note LIKE ? OR name LIKE ?
      `, [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`], (err, rows) => {
        if (err) return resolve(reply(event.replyToken, '查詢失敗'));

        if (rows.length === 0) return resolve(reply(event.replyToken, '查無資料'));

        const msg = rows.map(e =>
          `${e.name}｜暱稱：${e.nickname}｜伺服器：${e.server}｜備註：${e.note || '無'}`
        ).join('\n');

        resolve(reply(event.replyToken, `🔍 符合「${keyword}」的結果：\n${msg}`));
      });
    });
  }

  // ✅ 清單
  if (text === '@暱稱清單' || text === '暱稱名單') {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM nicknames`, (err, rows) => {
        if (err) return resolve(reply(event.replyToken, '資料錯誤'));
        if (rows.length === 0) return resolve(reply(event.replyToken, '目前沒有登記資料'));

        const msg = rows.map(e =>
          `${e.name}｜暱稱：${e.nickname}｜伺服器：${e.server}｜備註：${e.note || '無'}`
        ).join('\n');

        resolve(reply(event.replyToken, `📋 暱稱清單（共 ${rows.length} 筆）：\n${msg}`));
      });
    });
  }

  // ✅ 說明
  if (text === '@說明') {
    const guide = `
📘 使用說明：

1. 登記暱稱
@登記暱稱/暱稱/伺服器/備註

2. 查詢暱稱
@找人/關鍵字

3. 清單查看
@暱稱清單 或 暱稱名單
    `.trim();
    return reply(event.replyToken, guide);
  }

  // ✅ 預設提示
  return reply(event.replyToken, '請輸入 @登記暱稱 或 @找人 查詢暱稱。');
}

// ✅ 回覆訊息
function reply(token, msg) {
  return client.replyMessage(token, {
    type: 'text',
    text: msg
  });
}

// ✅ 取得使用者顯示名稱
function getDisplayName(source) {
  if (source.type === 'user') {
    return client.getProfile(source.userId).then(p => p.displayName);
  } else if (source.type === 'group') {
    return client.getGroupMemberProfile(source.groupId, source.userId).then(p => p.displayName).catch(() => source.userId);
  } else if (source.type === 'room') {
    return client.getRoomMemberProfile(source.roomId, source.userId).then(p => p.displayName).catch(() => source.userId);
  }
  return Promise.resolve(source.userId);
}

// ✅ Render 預設會自動帶入 PORT 環境變數
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE Bot 已啟動：http://localhost:${PORT}`);
});
