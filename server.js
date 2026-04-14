const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 7000;

// 确保目录存在
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync('./public/uploads')) fs.mkdirSync('./public/uploads', { recursive: true });

// 数据库
const db = new Database('./data/wechatsim.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    token TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS app_data (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    filename TEXT,
    mimetype TEXT,
    size INTEGER,
    path TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// 检查是否已有用户
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));

// 文件上传配置
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// 认证中间件
function auth(req, res, next) {
  const token = req.cookies?.token || req.headers['x-token'];
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const user = db.prepare('SELECT * FROM users WHERE token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'invalid token' });
  req.user = user;
  next();
}

// ===== 认证路由 =====
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少4位' });

  // 只允许1个用户
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count >= 1) return res.status(403).json({ error: '已有注册用户，不允许再注册' });

  const hash = bcrypt.hashSync(password, 10);
  const id = uuidv4();
  const token = uuidv4();

  try {
    db.prepare('INSERT INTO users (id, username, password, token) VALUES (?, ?, ?, ?)').run(id, username, hash, token);
    res.cookie('token', token, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });
    res.json({ ok: true, token });
  } catch (e) {
    res.status(400).json({ error: '用户名已存在' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = uuidv4();
  db.prepare('UPDATE users SET token = ? WHERE id = ?').run(token, user.id);
  res.cookie('token', token, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });
  res.json({ ok: true, token });
});

app.get('/api/check', (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    return res.json({ authed: false, hasUser: count > 0 });
  }
  const user = db.prepare('SELECT id, username FROM users WHERE token = ?').get(token);
  if (user) return res.json({ authed: true, user });
  res.json({ authed: false, hasUser: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ===== 数据存储路由 =====
app.get('/api/data/:key', auth, (req, res) => {
  const row = db.prepare('SELECT value FROM app_data WHERE user_id = ? AND key = ?').get(req.user.id, req.params.key);
  res.json({ value: row ? JSON.parse(row.value) : null });
});

app.post('/api/data/:key', auth, (req, res) => {
  const val = JSON.stringify(req.body.value);
  db.prepare(`INSERT INTO app_data (user_id, key, value, updated_at) 
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(req.user.id, req.params.key, val);
  res.json({ ok: true });
});

app.get('/api/data', auth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM app_data WHERE user_id = ?').all(req.user.id);
  const data = {};
  rows.forEach(r => { try { data[r.key] = JSON.parse(r.value); } catch { data[r.key] = r.value; } });
  res.json(data);
});

app.post('/api/data', auth, (req, res) => {
  const stmt = db.prepare(`INSERT INTO app_data (user_id, key, value, updated_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  const tx = db.transaction((data) => {
    for (const [k, v] of Object.entries(data)) {
      stmt.run(req.user.id, k, JSON.stringify(v));
    }
  });
  tx(req.body);
  res.json({ ok: true });
});

// ===== 文件上传路由 =====
app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '无文件' });

  const id = uuidv4();
  const ext = path.extname(req.file.originalname) || '.jpg';
  let filename = `${id}${ext}`;
  let filepath = path.join('public/uploads', filename);
  let buffer = req.file.buffer;

  // 图片压缩
  if (req.file.mimetype.startsWith('image/') && !req.file.mimetype.includes('gif')) {
    try {
      const meta = await sharp(buffer).metadata();
      const maxDim = 1200;
      if (meta.width > maxDim || meta.height > maxDim || buffer.length > 500 * 1024) {
        buffer = await sharp(buffer)
          .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        filename = `${id}.jpg`;
        filepath = path.join('public/uploads', filename);
      }
    } catch (e) { console.warn('Image compress fail:', e.message); }
  }

  // 视频直接保存（不压缩）
  fs.writeFileSync(filepath, buffer);

  db.prepare('INSERT INTO uploads (id, user_id, filename, mimetype, size, path) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, filename, req.file.mimetype, buffer.length, `/uploads/${filename}`);

  res.json({ ok: true, url: `/uploads/${filename}`, id });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WeChatSim running on http://0.0.0.0:${PORT}`);
});
