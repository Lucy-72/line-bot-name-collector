require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const sqlite3 = require('sqlite3').verbose();

const app = express();

const allowedGroups = [
  'Ce60dfe3b5c78e72f7d556dcc9a9f03dd' // 替換成你的群組 ID
];

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// 建立 SQLite 資料表
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

// webhook 接收事件
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

function handleEvent(event) {
  const userId = event.source.userId;

  if (event.type === 'join' && event.source.type === 'group') {
    const groupId = event.source.groupId;
    console.log('加入的群組 ID：', groupId);

    if (!allowedGroups.includes(groupId)) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '這個群組不是授權名單，我將離開。'
      }).then(() => client.leaveGroup(groupId));
    } else {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '嗨，我來啦！這是主人允許的群組，請輸入 @登記暱稱 開始使用～'
      });
    }
  }

  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const text = event.message.text;
  let userName = userId;

  return getDisplayName(event.source)
    .then(name => {
      userName = name;

      if (text.startsWith('@登記暱稱')) {
        const parts = text.split('/');
        const nickname = parts[1]?.trim();
        const server = parts[2]?.trim();
        const note = parts[3]?.trim() || '';

        if (!nickname || !server) {
          return reply(event.replyToken, '請輸入格式：@登記暱稱/暱稱/伺服器/備註（備註可省略）');
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
          return reply(event.replyToken, `暱稱已登記為：${nickname}`);
        });

        stmt.finalize();
        return;
      }

      if (text.startsWith('@找人/')) {
        const keyword = text.split('/')[1]?.trim();
        if (!keyword) return reply(event.replyToken, '請輸入關鍵字！');

        db.all(`
          SELECT * FROM nicknames
          WHERE nickname LIKE ? OR server LIKE ? OR note LIKE ? OR name LIKE ?
        `, [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`], (err, rows) => {
          if (err) return reply(event.replyToken, '查詢失敗');

          if (rows.length === 0) return reply(event.replyToken, '查無資料');

          let msg = `符合「${keyword}」的結果：\n`;
          rows.forEach(e => {
            msg += `${e.name}｜暱稱：${e.nickname}｜伺服器：${e.server}｜備註：${e.note || '無'}\n`;
          });

          return reply(event.replyToken, msg);
        });
        return;
      }

      if (text === '@暱稱清單' || text === '暱稱名單') {
        db.all(`SELECT * FROM nicknames`, (err, rows) => {
          if (err) return reply(event.replyToken, '資料錯誤');
          if (rows.length === 0) return reply(event.replyToken, '目前沒有登記資料');

          let msg = `暱稱清單（共 ${rows.length} 筆）：\n`;
          rows.forEach(e => {
            msg += `${e.name}｜暱稱：${e.nickname}｜伺服器：${e.server}｜備註：${e.note || '無'}\n`;
          });

          return reply(event.replyToken, msg);
        });
        return;
      }

      if (text === '@說明') {
        const guide = `
使用說明：

1. 登記暱稱
@登記暱稱/暱稱/伺服器/備註

2. 查詢暱稱
@找人/關鍵字

3. 清單查看
@暱稱清單 或 暱稱名單
        `.trim();
        return reply(event.replyToken, guide);
      }

      return reply(event.replyToken, '請輸入 @登記暱稱 或 @找人 查詢暱稱。');
    })
    .catch(err => {
      console.error('錯誤：', err);
      return reply(event.replyToken, '發生錯誤，請稍後再試。');
    });
}

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

function reply(token, msg) {
  return client.replyMessage(token, {
    type: 'text',
    text: msg
  });
}

app.listen(3000, () => {
  console.log('LINE Bot 已啟動：http://localhost:3000');
});
