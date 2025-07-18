require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const sqlite3 = require('sqlite3').verbose();
const basicAuth = require('basic-auth');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express();

// ✅ 你的允許群組 ID 清單（請填入自己的 groupId）
const allowedGroups = [
  'YOUR_GROUP_ID_1',
  'YOUR_GROUP_ID_2'
];

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// 🔸 SQLite 初始化
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

// 🔸 webhook 入口
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

// 🔹 事件處理
function handleEvent(event) {
  const userId = event.source.userId;

  // ✅ 自動退出未授權群組
  if (event.type === 'join' && event.source.type === 'group') {
    const groupId = event.source.groupId;
    console.log('加入的群組 ID：', groupId);

    if (!allowedGroups.includes(groupId)) {
      return client.leaveGroup(groupId);
    } else {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '👋 嗨～我來啦！這是被主人允許的群組 ✅'
      });
    }
  }

  // 僅處理文字訊息
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const text = event.message.text;
  let userName = userId;

  return getDisplayName(event.source)
    .then(name => {
      userName = name;

      // 🟢 @登記暱稱
      if (text.startsWith('@登記暱稱')) {
        const parts = text.split('/');
        const nickname = parts[1]?.trim();
        const server = parts[2]?.trim();
        const note = parts[3]?.trim() || '';

        if (!nickname || !server) {
          return reply(event.replyToken, '請輸入正確格式：@登記暱稱/暱稱/伺服器/備註（備註可省略）');
        }

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
          if (err) {
            console.error(err);
            return reply(event.replyToken, '登記失敗，請稍後再試！');
          }
          return reply(event.replyToken, `✅ 暱稱已登記為：${nickname}`);
        });

        stmt.finalize();
        return;
      }

      // 🟡 @找人
      if (text.startsWith('@找人/')) {
        const keyword = text.split('/')[1]?.trim();
        if (!keyword) return reply(event.replyToken, '請輸入關鍵字！');

        db.all(`
          SELECT * FROM nicknames
          WHERE nickname LIKE ? OR server LIKE ? OR note LIKE ? OR name LIKE ?
        `, [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`], (err, rows) => {
          if (err) return reply(event.replyToken, '查詢失敗');

          if (rows.length === 0) return reply(event.replyToken, '查無符合的紀錄');

          let msg = `符合「${keyword}」的結果：\n`;
          rows.forEach(e => {
            msg += `${e.name}｜暱稱：${e.nickname}｜伺服器：${e.server}｜備註：${e.note || '（無）'}\n`;
          });

          return reply(event.replyToken, msg);
        });
        return;
      }

      // 🟠 清單
      if (text === '@暱稱清單' || text === '暱稱名單') {
        db.all(`SELECT * FROM nicknames`, (err, rows) => {
          if (err) return reply(event.replyToken, '資料讀取錯誤');
          if (rows.length === 0) return reply(event.replyToken, '目前沒有登記資料');

          let msg = `暱稱清單（共 ${rows.length} 筆）：\n`;
          rows.forEach(e => {
            msg += `${e.name}｜暱稱：${e.nickname}｜伺服器：${e.server}｜備註：${e.note || '（無）'}\n`;
          });

          return reply(event.replyToken, msg);
        });
        return;
      }

      // 🟣 說明
      if (text === '@說明') {
        const guide = `
📘 使用說明：

1️⃣ 登記暱稱  
@登記暱稱/暱稱/伺服器/備註  

2️⃣ 查詢暱稱  
@找人/關鍵字  

3️⃣ 檢視清單  
@暱稱清單 或 暱稱名單
`.trim();
        return reply(event.replyToken, guide);
      }

      return reply(event.replyToken,'請輸入 @登記暱稱 或 @找人 查詢暱稱～');
    })
    .catch(err => {
      console.error('錯誤：', err);
      return reply(event.replyToken,'發生錯誤，請稍後再試');
    });
}

// 🔹 取得使用者名稱
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

// 🔸 回覆訊息
function reply(token, msg) {
  return client.replyMessage(token, {
    type: 'text',
    text: msg
  });
}

// 🔐 管理用頁面（查詢 & 匯出 Excel）
app.get('/list', authCheck, (req, res) => {
  db.all(`SELECT * FROM nicknames`, (err, rows) => {
    if (err) return res.send('資料錯誤');
    let html = `<h2>暱稱清單（共 ${rows.length} 筆）</h2><ul>`;
    rows.forEach(e => {
      html += `<li>${e.name}｜暱稱：${e.nickname}｜伺服器：${e.server}｜備註：${e.note || '（無）'}</li>`;
    });
    html += '</ul>';
    res.send(html);
  });
});

app.get('/export', authCheck, (req, res) => {
  db.all(`SELECT * FROM nicknames`, (err, rows) => {
    if (err) return res.send('匯出錯誤');
    const data = rows.map(r => ({
      LINE名稱: r.name,
      暱稱: r.nickname,
      伺服器: r.server,
      備註: r.note || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "暱稱清單");

    const filePath = '暱稱清單.xlsx';
    XLSX.writeFile(wb, filePath);
    res.download(filePath);
  });
});

// 🔐 Basic Auth 檢查
function authCheck(req, res, next) {
  const credentials = basicAuth(req);
  if (!credentials || credentials.name !== process.env.ADMIN_USER || credentials.pass !== process.env.ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Protected"');
    return res.status(401).send('請輸入正確帳密！');
  }
  next();
}

app.listen(3000, () => {
  console.log('✅ LINE Bot 已啟動 http://localhost:3000');
});
