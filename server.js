// ============================================================
//  СЕРВЕР — Волна
//  Express + Socket.io
//
//  REST:
//   - авторизация (регистрация/вход/выход)
//   - профиль (аватар, статус, bio, имя) + просмотр чужого профиля
//   - друзья (заявки, список)
//   - серверы (создание, вступление, каналы текстовые и голосовые)
//   - группы (создание, участники, каналы)
//   - сторис (создание, лента, удаление)
//   - загрузка файлов (аватары, сторис, голосовые сообщения)
//
//  Socket.io:
//   - онлайн-присутствие (персонализированное: друзья + совладельцы серверов)
//   - сообщения в каналах (текст + голосовые)
//   - личные сообщения (текст + голосовые)
//   - групповые сообщения
//   - голосовые каналы (mesh WebRTC)
//   - сигналинг WebRTC для звонков 1-на-1 (по userId)
//   - живые уведомления
//
//  Данные хранятся в data/*.json (аккаунты, серверы, друзья, сообщения, сторис, группы)
// ============================================================

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function rand() { return Math.random().toString(36).slice(2, 8); }

// ============================================================
//  Файловое хранилище
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  friendships: path.join(DATA_DIR, 'friendships.json'),
  servers: path.join(DATA_DIR, 'servers.json'),
  channels: path.join(DATA_DIR, 'channels.json'),
  memberships: path.join(DATA_DIR, 'memberships.json'),
  stories: path.join(DATA_DIR, 'stories.json'),
  groups: path.join(DATA_DIR, 'groups.json'),
  groupChannels: path.join(DATA_DIR, 'group_channels.json'),
  groupMemberships: path.join(DATA_DIR, 'group_memberships.json'),
  channelMessages: path.join(DATA_DIR, 'channel_messages.json'),
  dmMessages: path.join(DATA_DIR, 'dm_messages.json'),
  groupMessages: path.join(DATA_DIR, 'group_messages.json'),
};
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
Object.values(FILES).forEach((f) => { if (!fs.existsSync(f)) fs.writeFileSync(f, '[]'); });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return []; }
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

const readUsers = () => readJson(FILES.users);
const writeUsers = (d) => writeJson(FILES.users, d);
const readFriendships = () => readJson(FILES.friendships);
const writeFriendships = (d) => writeJson(FILES.friendships, d);
const readServers = () => readJson(FILES.servers);
const writeServers = (d) => writeJson(FILES.servers, d);
const readChannels = () => readJson(FILES.channels);
const writeChannels = (d) => writeJson(FILES.channels, d);
const readMemberships = () => readJson(FILES.memberships);
const writeMemberships = (d) => writeJson(FILES.memberships, d);
const readStories = () => readJson(FILES.stories);
const writeStories = (d) => writeJson(FILES.stories, d);
const readGroups = () => readJson(FILES.groups);
const writeGroups = (d) => writeJson(FILES.groups, d);
const readGroupChannels = () => readJson(FILES.groupChannels);
const writeGroupChannels = (d) => writeJson(FILES.groupChannels, d);
const readGroupMemberships = () => readJson(FILES.groupMemberships);
const writeGroupMemberships = (d) => writeJson(FILES.groupMemberships, d);
const readChannelMessages = () => readJson(FILES.channelMessages);
const writeChannelMessages = (d) => writeJson(FILES.channelMessages, d);
const readDmMessages = () => readJson(FILES.dmMessages);
const writeDmMessages = (d) => writeJson(FILES.dmMessages, d);
const readGroupMessages = () => readJson(FILES.groupMessages);
const writeGroupMessages = (d) => writeJson(FILES.groupMessages, d);

// Индексы сообщений в памяти (с загрузкой из файлов)
const channelMessages = {};       // channelId -> [messages]
const dmMessages = {};            // "userIdA::userIdB" -> [messages]
const groupMessages = {};         // groupId:channelId -> [messages]

function loadMessages() {
  readChannelMessages().forEach((m) => {
    if (!channelMessages[m.channelId]) channelMessages[m.channelId] = [];
    channelMessages[m.channelId].push(m);
  });
  readDmMessages().forEach((m) => {
    const key = dmKey(m.fromUserId, m.toUserId);
    if (!dmMessages[key]) dmMessages[key] = [];
    dmMessages[key].push(m);
  });
  readGroupMessages().forEach((m) => {
    const key = m.groupId + ':' + m.channelId;
    if (!groupMessages[key]) groupMessages[key] = [];
    groupMessages[key].push(m);
  });
}

function saveChannelMessage(msg) {
  const all = readChannelMessages();
  all.push(msg);
  if (all.length > 5000) all.splice(0, all.length - 5000);
  writeChannelMessages(all);
}
function saveDmMessage(msg) {
  const all = readDmMessages();
  all.push(msg);
  if (all.length > 5000) all.splice(0, all.length - 5000);
  writeDmMessages(all);
}
function saveGroupMessage(msg) {
  const all = readGroupMessages();
  all.push(msg);
  if (all.length > 5000) all.splice(0, all.length - 5000);
  writeGroupMessages(all);
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    avatarColor: u.avatarColor,
    avatar: u.avatar || null,
    bio: u.bio || '',
    banner: u.banner || null,
    status: u.status || '',
    createdAt: u.createdAt,
  };
}
function isMember(userId, serverId) {
  return readMemberships().some((m) => m.userId === userId && m.serverId === serverId);
}
function serializeServer(srv, channels) {
  return {
    id: srv.id,
    name: srv.name,
    ownerId: srv.ownerId,
    inviteCode: srv.inviteCode,
    color: srv.color,
    avatar: srv.avatar || null,
    channels: channels.map((c) => ({ id: c.id, name: c.name, type: c.type || 'text' })),
  };
}
function areFriends(userIdA, userIdB) {
  return readFriendships().some(
    (f) => f.status === 'accepted' &&
      ((f.userAId === userIdA && f.userBId === userIdB) || (f.userAId === userIdB && f.userBId === userIdA))
  );
}
function dmKey(a, b) { return [a, b].sort().join('::'); }

const AVATAR_COLORS = ['#35e3c9', '#7c8cff', '#ff9f6b', '#ff6bb0', '#6bd4ff', '#c58cff'];

// ============================================================
//  Multer — загрузка файлов
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || '.bin';
    cb(null, Date.now() + '_' + rand() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/|video\/|audio\/)/.test(file.mimetype);
    cb(ok ? null : new Error('Только изображения, видео и аудио'), ok);
  },
});

// ============================================================
//  Сессии
// ============================================================
const sessionMiddleware = session({
  secret: 'волна-секретный-ключ-обязательно-поменяй-в-проде',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
});

app.use(sessionMiddleware);
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
  next();
}

// ============================================================
//  Email (nodemailer) — для привязки почты и кодов входа
// ============================================================
// Настрой свой SMTP здесь. По умолчанию используется Ethereal (тестовый).
// Для реальной работы укажи service/auth/user/pass своего почтового провайдера.
let emailTransport = null;
try {
  // Пытаемся создать тестовый транспорт Ethereal (письма не уходят реально,
  // но preview URL пишется в консоль). Замени на реальные настройки SMTP.
  emailTransport = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: 'wave@ethereal.email',
      pass: 'wavepass',
    },
  });
} catch (e) {
  console.warn('Email transport не создан:', e.message);
}

async function sendEmail(to, subject, text) {
  if (!emailTransport) {
    console.log(`[EMAIL] (нет транспорта) -> ${to}: ${subject}\n${text}`);
    return;
  }
  try {
    const info = await emailTransport.sendMail({
      from: '"Волна" <wave@volna.app>',
      to, subject, text,
    });
    // Ethereal preview
    if (info.messageId && info.messageId.includes('ethereal')) {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (e) {
    console.error('Ошибка отправки email:', e.message);
  }
}

// Коды подтверждения: userId -> { code, expiresAt, purpose }
const emailCodes = {};

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendEmailCode(userId, email, purpose) {
  const code = generateCode();
  emailCodes[userId] = { code, expiresAt: Date.now() + 10 * 60 * 1000, purpose, email };
  const subject = purpose === 'login' ? 'Код входа в Волна' : 'Код подтверждения Волна';
  const text = `Ваш код подтверждения: ${code}\n\nКод действителен 10 минут. Если вы не запрашивали код — проигнорируйте это письмо.`;
  sendEmail(email, subject, text);
  return code; // возвращаем для dev-режима (когда нет реального SMTP)
}

// ============================================================
//  Онлайн-присутствие
// ============================================================
const onlineUsers = {};       // socket.id -> { userId, username, avatarColor, avatar, channelId, voiceChannelId }
const socketsByUserId = {};   // userId -> Set<socket.id>

function emitToUser(userId, event, payload) {
  const set = socketsByUserId[userId];
  if (!set) return;
  set.forEach((sid) => io.to(sid).emit(event, payload));
}

function getOnlineUserIds() {
  const ids = new Set();
  Object.values(onlineUsers).forEach((u) => ids.add(u.userId));
  return ids;
}

// Друзья пользователя
function getFriendIds(userId) {
  return readFriendships()
    .filter((f) => f.status === 'accepted' && (f.userAId === userId || f.userBId === userId))
    .map((f) => (f.userAId === userId ? f.userBId : f.userAId));
}

// ID серверов, в которых состоит пользователь
function getServerIds(userId) {
  return readMemberships().filter((m) => m.userId === userId).map((m) => m.serverId);
}

// Отправить персонализированный список онлайн-пользователей (друзья + совладельцы серверов)
function sendPersonalUserList(socket) {
  const myId = socket.user.id;
  const friendIds = new Set(getFriendIds(myId));
  const myServerIds = new Set(getServerIds(myId));

  // участники моих серверов
  const serverMateIds = new Set();
  readMemberships().forEach((m) => {
    if (myServerIds.has(m.serverId)) serverMateIds.add(m.userId);
  });

  // участники моих групп
  const myGroupIds = readGroupMemberships().filter((m) => m.userId === myId).map((m) => m.groupId);
  readGroupMemberships().forEach((m) => {
    if (myGroupIds.includes(m.groupId)) serverMateIds.add(m.userId);
  });

  const visible = Object.values(onlineUsers).filter((u) => {
    if (u.userId === myId) return false;
    return friendIds.has(u.userId) || serverMateIds.has(u.userId);
  }).map((u) => ({
    userId: u.userId,
    username: u.username,
    avatarColor: u.avatarColor,
    avatar: u.avatar || null,
  }));

  socket.emit('user-list', visible);
}

// Разослать обновления списков всем, кто видит данного пользователя
function broadcastUserListToRelevant(userId) {
  const friendIds = getFriendIds(userId);
  const myServerIds = getServerIds(userId);
  const myGroupIds = readGroupMemberships().filter((m) => m.userId === userId).map((m) => m.groupId);

  const relevant = new Set(friendIds);

  // совладельцы серверов
  readMemberships().forEach((m) => {
    if (myServerIds.includes(m.serverId)) relevant.add(m.userId);
  });
  // совладельцы групп
  readGroupMemberships().forEach((m) => {
    if (myGroupIds.includes(m.groupId)) relevant.add(m.userId);
  });

  relevant.forEach((uid) => {
    const set = socketsByUserId[uid];
    if (set) set.forEach((sid) => sendPersonalUserList(io.sockets.sockets.get(sid) || { user: { id: uid }, emit: () => {} }));
  });
}

// Упрощённая версия: просто рассылаем всем сокетам их персонализированные списки
function broadcastAllUserLists() {
  Object.keys(socketsByUserId).forEach((uid) => {
    const set = socketsByUserId[uid];
    if (!set) return;
    set.forEach((sid) => {
      const s = io.sockets.sockets.get(sid);
      if (s) sendPersonalUserList(s);
    });
  });
}

// ============================================================
//  REST: регистрация / вход / выход / текущий пользователь
// ============================================================
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  const clean = (username || '').trim().slice(0, 24);

  if (clean.length < 2) return res.status(400).json({ error: 'Имя должно быть не короче 2 символов' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });

  const users = readUsers();
  if (users.some((u) => u.username.toLowerCase() === clean.toLowerCase())) {
    return res.status(409).json({ error: 'Это имя уже занято' });
  }

  const user = {
    id: 'u_' + Date.now() + '_' + rand(),
    username: clean,
    passwordHash: bcrypt.hashSync(password, 10),
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    avatar: null,
    bio: '',
    banner: null,
    status: '',
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);

  req.session.userId = user.id;
  res.json(publicUser(user));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Введите имя и пароль' });

  const users = readUsers();
  const user = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Неверное имя или пароль' });
  }

  req.session.userId = user.id;
  res.json(publicUser(user));
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
  const user = readUsers().find((u) => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ ...publicUser(user), email: user.email || null, emailVerified: !!user.emailVerified });
});

// ============================================================
//  REST: привязка почты и вход с кодом
// ============================================================
// Привязать почту к аккаунту (требует авторизации)
app.post('/api/email/bind', requireAuth, (req, res) => {
  const { email } = req.body || {};
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return res.status(400).json({ error: 'Некорректный email' });
  }

  const users = readUsers();
  // проверить, не привязана ли уже эта почта к другому аккаунту
  if (users.some((u) => u.id !== req.session.userId && u.email === clean)) {
    return res.status(409).json({ error: 'Эта почта уже привязана к другому аккаунту' });
  }

  const user = users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  // отправить код подтверждения
  const code = sendEmailCode(user.id, clean, 'bind');
  // В dev-режиме возвращаем код, чтобы пользователь мог ввести его без реальной почты
  res.json({ ok: true, devCode: emailTransport ? undefined : code, pendingEmail: clean });
});

// Подтвердить привязку почты кодом
app.post('/api/email/verify', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const myId = req.session.userId;
  const entry = emailCodes[myId];

  if (!entry) return res.status(400).json({ error: 'Код не запрашивался' });
  if (entry.purpose !== 'bind') return res.status(400).json({ error: 'Код не для привязки' });
  if (Date.now() > entry.expiresAt) {
    delete emailCodes[myId];
    return res.status(400).json({ error: 'Код истёк, запросите новый' });
  }
  if (entry.code !== String(code).trim()) {
    return res.status(400).json({ error: 'Неверный код' });
  }

  const users = readUsers();
  const user = users.find((u) => u.id === myId);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  user.email = entry.email;
  user.emailVerified = true;
  writeUsers(users);
  delete emailCodes[myId];

  res.json({ ok: true, email: user.email });
});

// Отвязать почту
app.post('/api/email/unbind', requireAuth, (req, res) => {
  const users = readUsers();
  const user = users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  user.email = null;
  user.emailVerified = false;
  writeUsers(users);
  res.json({ ok: true });
});

// Запросить код входа (после ввода логина/пароля, если почта привязана)
app.post('/api/login/request-code', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Введите имя и пароль' });

  const users = readUsers();
  const user = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Неверное имя или пароль' });
  }
  if (!user.email || !user.emailVerified) {
    // почта не привязана — разрешаем обычный вход
    req.session.userId = user.id;
    return res.json({ requireCode: false, user: publicUser(user) });
  }

  // почта привязана — отправляем код
  const code = sendEmailCode(user.id, user.email, 'login');
  // сохраняем userId во временной сессии (не даём полный доступ до ввода кода)
  req.session.pendingLoginUserId = user.id;
  return res.json({ requireCode: true, email: user.email.replace(/(.{1,2}).*(@.*)/, '$1***$2'), devCode: emailTransport ? undefined : code });
});

// Подтвердить код входа
app.post('/api/login/verify-code', (req, res) => {
  const { code } = req.body || {};
  const pendingId = req.session.pendingLoginUserId;
  if (!pendingId) return res.status(400).json({ error: 'Нет ожидающего входа' });

  const entry = emailCodes[pendingId];
  if (!entry) return res.status(400).json({ error: 'Код не запрашивался' });
  if (entry.purpose !== 'login') return res.status(400).json({ error: 'Код не для входа' });
  if (Date.now() > entry.expiresAt) {
    delete emailCodes[pendingId];
    return res.status(400).json({ error: 'Код истёк, запросите новый' });
  }
  if (entry.code !== String(code).trim()) {
    return res.status(400).json({ error: 'Неверный код' });
  }

  const user = readUsers().find((u) => u.id === pendingId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  req.session.userId = user.id;
  delete req.session.pendingLoginUserId;
  delete emailCodes[pendingId];

  res.json(publicUser(user));
});

// ============================================================
//  REST: профиль (редактирование + просмотр чужого)
// ============================================================
app.use('/api/profile', requireAuth);

// Загрузка аватара
app.post('/api/profile/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const users = readUsers();
  const user = users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  // удалить старый аватар
  if (user.avatar) {
    const oldPath = path.join(__dirname, 'public', user.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  user.avatar = '/uploads/' + req.file.filename;
  writeUsers(users);

  // уведомить друзей об обновлении
  broadcastAllUserLists();
  emitToUser(user.id, 'profile-updated', publicUser(user));
  res.json({ avatar: user.avatar });
});

// Загрузка баннера
app.post('/api/profile/banner', upload.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const users = readUsers();
  const user = users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  if (user.banner) {
    const oldPath = path.join(__dirname, 'public', user.banner);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  user.banner = '/uploads/' + req.file.filename;
  writeUsers(users);
  emitToUser(user.id, 'profile-updated', publicUser(user));
  res.json({ banner: user.banner });
});

// Обновление текстовых полей профиля
app.put('/api/profile', (req, res) => {
  const { username, status, bio } = req.body || {};
  const users = readUsers();
  const user = users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  if (username !== undefined) {
    const clean = username.trim().slice(0, 24);
    if (clean.length < 2) return res.status(400).json({ error: 'Имя должно быть не короче 2 символов' });
    if (users.some((u) => u.id !== user.id && u.username.toLowerCase() === clean.toLowerCase())) {
      return res.status(409).json({ error: 'Это имя уже занято' });
    }
    user.username = clean;
  }
  if (status !== undefined) user.status = status.trim().slice(0, 100);
  if (bio !== undefined) user.bio = bio.trim().slice(0, 500);

  writeUsers(users);
  broadcastAllUserLists();
  emitToUser(user.id, 'profile-updated', publicUser(user));
  res.json(publicUser(user));
});

// Просмотр профиля другого пользователя
app.get('/api/users/:userId', (req, res) => {
  const user = readUsers().find((u) => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const isOnline = getOnlineUserIds().has(user.id);
  const isMyFriend = areFriends(req.session.userId, user.id);
  res.json({ ...publicUser(user), isOnline, isFriend: isMyFriend });
});

// ============================================================
//  REST: друзья
// ============================================================
app.use('/api/friends', requireAuth);

app.get('/api/friends', (req, res) => {
  const myId = req.session.userId;
  const friendships = readFriendships();
  const users = readUsers();
  const userMap = new Map(users.map((u) => [u.id, u]));

  const friends = [];
  const incoming = [];
  const outgoing = [];

  friendships.forEach((f) => {
    if (f.userAId !== myId && f.userBId !== myId) return;
    const otherId = f.userAId === myId ? f.userBId : f.userAId;
    const otherUser = userMap.get(otherId);
    if (!otherUser) return;

    const entry = {
      friendshipId: f.id,
      id: otherUser.id,
      username: otherUser.username,
      avatarColor: otherUser.avatarColor,
      avatar: otherUser.avatar || null,
    };

    if (f.status === 'accepted') friends.push(entry);
    else if (f.requestedBy === myId) outgoing.push(entry);
    else incoming.push(entry);
  });

  res.json({ friends, incoming, outgoing });
});

app.post('/api/friends/request', (req, res) => {
  const myId = req.session.userId;
  const { username } = req.body || {};
  if (!username || !username.trim()) return res.status(400).json({ error: 'Укажи имя пользователя' });

  const users = readUsers();
  const target = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'Пользователь с таким именем не найден' });
  if (target.id === myId) return res.status(400).json({ error: 'Нельзя добавить в друзья самого себя' });

  const friendships = readFriendships();
  const existing = friendships.find(
    (f) => (f.userAId === myId && f.userBId === target.id) || (f.userAId === target.id && f.userBId === myId)
  );
  if (existing) {
    return res.status(409).json({ error: existing.status === 'accepted' ? 'Вы уже друзья' : 'Заявка уже отправлена' });
  }

  const friendship = {
    id: 'f_' + Date.now() + '_' + rand(),
    userAId: myId,
    userBId: target.id,
    status: 'pending',
    requestedBy: myId,
    createdAt: new Date().toISOString(),
  };
  friendships.push(friendship);
  writeFriendships(friendships);

  const me = users.find((u) => u.id === myId);
  emitToUser(target.id, 'friend-request', { friendshipId: friendship.id, from: publicUser(me) });

  res.json({ ok: true });
});

app.post('/api/friends/respond', (req, res) => {
  const myId = req.session.userId;
  const { friendshipId, action } = req.body || {};

  const friendships = readFriendships();
  const f = friendships.find((x) => x.id === friendshipId);
  if (!f || (f.userAId !== myId && f.userBId !== myId)) {
    return res.status(404).json({ error: 'Заявка не найдена' });
  }
  if (f.requestedBy === myId) return res.status(403).json({ error: 'Нельзя ответить на собственную заявку' });

  const otherId = f.userAId === myId ? f.userBId : f.userAId;

  if (action === 'accept') {
    f.status = 'accepted';
    writeFriendships(friendships);
    const me = readUsers().find((u) => u.id === myId);
    emitToUser(otherId, 'friend-accepted', { friendshipId: f.id, by: publicUser(me) });
    broadcastAllUserLists();
    return res.json({ ok: true, status: 'accepted' });
  }

  if (action === 'decline') {
    writeFriendships(friendships.filter((x) => x.id !== friendshipId));
    emitToUser(otherId, 'friend-declined', { friendshipId: f.id });
    return res.json({ ok: true, status: 'declined' });
  }

  res.status(400).json({ error: 'Некорректное действие' });
});

app.delete('/api/friends/:friendshipId', (req, res) => {
  const myId = req.session.userId;
  const friendships = readFriendships();
  const f = friendships.find((x) => x.id === req.params.friendshipId);
  if (!f || (f.userAId !== myId && f.userBId !== myId)) {
    return res.status(404).json({ error: 'Не найдено' });
  }

  const otherId = f.userAId === myId ? f.userBId : f.userAId;
  writeFriendships(friendships.filter((x) => x.id !== f.id));
  emitToUser(otherId, 'friend-removed', { friendshipId: f.id });
  broadcastAllUserLists();
  res.json({ ok: true });
});

// ============================================================
//  REST: серверы (как в Discord — текстовые и голосовые каналы)
// ============================================================
app.use('/api/servers', requireAuth);

app.get('/api/servers', (req, res) => {
  const myId = req.session.userId;
  const memberships = readMemberships().filter((m) => m.userId === myId);
  const servers = readServers();
  const channels = readChannels();

  const result = memberships
    .map((m) => servers.find((s) => s.id === m.serverId))
    .filter(Boolean)
    .map((srv) => serializeServer(srv, channels.filter((c) => c.serverId === srv.id)));

  res.json(result);
});

// Создать сервер (с категориями как в Discord)
app.post('/api/servers', upload.single('avatar'), (req, res) => {
  const myId = req.session.userId;
  const { name } = req.body || {};
  const clean = (name || '').trim().slice(0, 40);
  if (clean.length < 2) return res.status(400).json({ error: 'Название должно быть не короче 2 символов' });

  const servers = readServers();
  const srv = {
    id: 's_' + Date.now() + '_' + rand(),
    name: clean,
    ownerId: myId,
    inviteCode: rand().toUpperCase() + rand().toUpperCase().slice(0, 2),
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    avatar: req.file ? '/uploads/' + req.file.filename : null,
    createdAt: new Date().toISOString(),
  };
  servers.push(srv);
  writeServers(servers);

  // Каналы по умолчанию как в Discord: текстовый "общий" + голосовой "Голосовой"
  const channels = readChannels();
  const textChannel = {
    id: 'c_' + Date.now() + '_' + rand(),
    serverId: srv.id,
    name: 'общий',
    type: 'text',
    createdAt: new Date().toISOString(),
  };
  const voiceChannel = {
    id: 'c_' + (Date.now() + 1) + '_' + rand(),
    serverId: srv.id,
    name: 'Голосовой',
    type: 'voice',
    createdAt: new Date().toISOString(),
  };
  channels.push(textChannel, voiceChannel);
  writeChannels(channels);
  channelMessages[textChannel.id] = [];

  const memberships = readMemberships();
  memberships.push({ serverId: srv.id, userId: myId, joinedAt: new Date().toISOString() });
  writeMemberships(memberships);

  res.json(serializeServer(srv, [textChannel, voiceChannel]));
});

app.post('/api/servers/join', (req, res) => {
  const myId = req.session.userId;
  const { inviteCode } = req.body || {};
  const code = (inviteCode || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Введите код приглашения' });

  const servers = readServers();
  const srv = servers.find((s) => s.inviteCode === code);
  if (!srv) return res.status(404).json({ error: 'Сервер с таким кодом не найден' });

  const memberships = readMemberships();
  if (memberships.some((m) => m.serverId === srv.id && m.userId === myId)) {
    return res.status(409).json({ error: 'Вы уже участник этого сервера' });
  }
  memberships.push({ serverId: srv.id, userId: myId, joinedAt: new Date().toISOString() });
  writeMemberships(memberships);

  const channels = readChannels().filter((c) => c.serverId === srv.id);
  broadcastAllUserLists();
  res.json(serializeServer(srv, channels));
});

// Добавить канал (текстовый или голосовой)
app.post('/api/servers/:serverId/channels', (req, res) => {
  const myId = req.session.userId;
  const srv = readServers().find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (srv.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может добавлять каналы' });

  const { name, type } = req.body || {};
  const clean = (name || '').trim().slice(0, 30);
  if (clean.length < 1) return res.status(400).json({ error: 'Введите название канала' });
  const chanType = type === 'voice' ? 'voice' : 'text';

  const channels = readChannels();
  const channel = {
    id: 'c_' + Date.now() + '_' + rand(),
    serverId: srv.id,
    name: clean,
    type: chanType,
    createdAt: new Date().toISOString(),
  };
  channels.push(channel);
  writeChannels(channels);
  if (chanType === 'text') channelMessages[channel.id] = [];

  const memberIds = readMemberships().filter((m) => m.serverId === srv.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'server-updated', { serverId: srv.id }));

  res.json({ id: channel.id, name: channel.name, type: channel.type });
});

// Участники сервера
app.get('/api/servers/:serverId/members', (req, res) => {
  const myId = req.session.userId;
  const srv = readServers().find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (!isMember(myId, srv.id)) return res.status(403).json({ error: 'Вы не участник' });

  const memberIds = readMemberships().filter((m) => m.serverId === srv.id).map((m) => m.userId);
  const users = readUsers();
  const onlineSet = getOnlineUserIds();
  const members = memberIds.map((id) => {
    const u = users.find((x) => x.id === id);
    if (!u) return null;
    return { ...publicUser(u), isOnline: onlineSet.has(id), isOwner: srv.ownerId === id };
  }).filter(Boolean);

  res.json(members);
});

// Редактировать сервер (имя, аватар)
app.put('/api/servers/:serverId', upload.single('avatar'), (req, res) => {
  const myId = req.session.userId;
  const servers = readServers();
  const srv = servers.find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (srv.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может редактировать' });

  const { name } = req.body || {};
  if (name !== undefined) {
    const clean = name.trim().slice(0, 40);
    if (clean.length < 2) return res.status(400).json({ error: 'Название должно быть не короче 2 символов' });
    srv.name = clean;
  }
  if (req.file) {
    if (srv.avatar) {
      const oldPath = path.join(__dirname, 'public', srv.avatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    srv.avatar = '/uploads/' + req.file.filename;
  }
  writeServers(servers);

  const channels = readChannels().filter((c) => c.serverId === srv.id);
  const memberIds = readMemberships().filter((m) => m.serverId === srv.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'server-updated', { serverId: srv.id }));
  res.json(serializeServer(srv, channels));
});

// Удалить сервер
app.delete('/api/servers/:serverId', (req, res) => {
  const myId = req.session.userId;
  const servers = readServers();
  const srv = servers.find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (srv.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может удалить сервер' });

  // удалить аватар
  if (srv.avatar) {
    const fp = path.join(__dirname, 'public', srv.avatar);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  // удалить каналы, сообщения, участников
  const channels = readChannels().filter((c) => c.serverId === srv.id);
  channels.forEach((c) => { delete channelMessages[c.id]; });
  writeChannels(readChannels().filter((c) => c.serverId !== srv.id));
  writeMemberships(readMemberships().filter((m) => m.serverId !== srv.id));
  writeServers(servers.filter((s) => s.id !== srv.id));

  // уведомить бывших участников
  const memberIds = readMemberships().filter((m) => m.serverId === srv.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'server-deleted', { serverId: srv.id }));
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Покинуть сервер
app.post('/api/servers/:serverId/leave', (req, res) => {
  const myId = req.session.userId;
  const srv = readServers().find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (srv.ownerId === myId) return res.status(400).json({ error: 'Владелец не может покинуть сервер — удалите его' });

  writeMemberships(readMemberships().filter((m) => !(m.serverId === srv.id && m.userId === myId)));
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Исключить участника (только владелец)
app.delete('/api/servers/:serverId/members/:userId', (req, res) => {
  const myId = req.session.userId;
  const srv = readServers().find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (srv.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может исключать' });
  if (req.params.userId === myId) return res.status(400).json({ error: 'Нельзя исключить себя' });

  writeMemberships(readMemberships().filter((m) => !(m.serverId === srv.id && m.userId === req.params.userId)));
  emitToUser(req.params.userId, 'server-deleted', { serverId: srv.id });
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Добавить участника по имени (только владелец)
app.post('/api/servers/:serverId/members', (req, res) => {
  const myId = req.session.userId;
  const srv = readServers().find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (srv.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может добавлять участников' });

  const { username } = req.body || {};
  const target = readUsers().find((u) => u.username.toLowerCase() === (username || '').trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (isMember(target.id, srv.id)) return res.status(409).json({ error: 'Уже участник' });

  const memberships = readMemberships();
  memberships.push({ serverId: srv.id, userId: target.id, joinedAt: new Date().toISOString() });
  writeMemberships(memberships);
  emitToUser(target.id, 'server-updated', { serverId: srv.id });
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Удалить канал (только владелец)
app.delete('/api/servers/:serverId/channels/:channelId', (req, res) => {
  const myId = req.session.userId;
  const srv = readServers().find((s) => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  if (srv.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может удалять каналы' });

  const channels = readChannels();
  const ch = channels.find((c) => c.id === req.params.channelId && c.serverId === srv.id);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });

  writeChannels(channels.filter((c) => c.id !== ch.id));
  delete channelMessages[ch.id];
  const memberIds = readMemberships().filter((m) => m.serverId === srv.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'server-updated', { serverId: srv.id }));
  res.json({ ok: true });
});

// ============================================================
//  REST: группы (как в Telegram/Discord — для друзей)
// ============================================================
app.use('/api/groups', requireAuth);

app.get('/api/groups', (req, res) => {
  const myId = req.session.userId;
  const gm = readGroupMemberships().filter((m) => m.userId === myId);
  const groups = readGroups();
  const groupChannels = readGroupChannels();

  const result = gm.map((m) => {
    const g = groups.find((x) => x.id === m.groupId);
    if (!g) return null;
    const channels = groupChannels.filter((c) => c.groupId === g.id);
    return {
      id: g.id,
      name: g.name,
      ownerId: g.ownerId,
      avatar: g.avatar || null,
      color: g.color,
      channels: channels.map((c) => ({ id: c.id, name: c.name, type: c.type || 'text' })),
    };
  }).filter(Boolean);

  res.json(result);
});

app.post('/api/groups', upload.single('avatar'), (req, res) => {
  const myId = req.session.userId;
  const { name, memberIds } = req.body || {};
  const clean = (name || '').trim().slice(0, 40);
  if (clean.length < 2) return res.status(400).json({ error: 'Название должно быть не короче 2 символов' });

  // memberIds — строка JSON или массив
  let members = [];
  try {
    members = typeof memberIds === 'string' ? JSON.parse(memberIds) : (memberIds || []);
  } catch { members = []; }

  // только друзья могут быть участниками
  members = members.filter((id) => areFriends(myId, id));
  members = [...new Set([myId, ...members])];

  const groups = readGroups();
  const group = {
    id: 'g_' + Date.now() + '_' + rand(),
    name: clean,
    ownerId: myId,
    avatar: req.file ? '/uploads/' + req.file.filename : null,
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: new Date().toISOString(),
  };
  groups.push(group);
  writeGroups(groups);

  // канал по умолчанию
  const gc = readGroupChannels();
  const defaultCh = {
    id: 'gc_' + Date.now() + '_' + rand(),
    groupId: group.id,
    name: 'общий',
    type: 'text',
    createdAt: new Date().toISOString(),
  };
  gc.push(defaultCh);
  writeGroupChannels(gc);
  groupMessages[group.id + ':' + defaultCh.id] = [];

  // участники
  const gm = readGroupMemberships();
  members.forEach((uid) => {
    gm.push({ groupId: group.id, userId: uid, joinedAt: new Date().toISOString() });
  });
  writeGroupMemberships(gm);

  // уведомить участников
  members.forEach((uid) => emitToUser(uid, 'group-updated', { groupId: group.id }));
  broadcastAllUserLists();

  const channels = readGroupChannels().filter((c) => c.groupId === group.id);
  res.json({
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    avatar: group.avatar,
    color: group.color,
    channels: channels.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  });
});

app.post('/api/groups/:groupId/channels', (req, res) => {
  const myId = req.session.userId;
  const group = readGroups().find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может добавлять каналы' });

  const { name, type } = req.body || {};
  const clean = (name || '').trim().slice(0, 30);
  if (clean.length < 1) return res.status(400).json({ error: 'Введите название канала' });
  const chanType = type === 'voice' ? 'voice' : 'text';

  const gc = readGroupChannels();
  const channel = {
    id: 'gc_' + Date.now() + '_' + rand(),
    groupId: group.id,
    name: clean,
    type: chanType,
    createdAt: new Date().toISOString(),
  };
  gc.push(channel);
  writeGroupChannels(gc);
  if (chanType === 'text') groupMessages[group.id + ':' + channel.id] = [];

  const memberIds = readGroupMemberships().filter((m) => m.groupId === group.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'group-updated', { groupId: group.id }));

  res.json({ id: channel.id, name: channel.name, type: channel.type });
});

// Участники группы
app.get('/api/groups/:groupId/members', (req, res) => {
  const myId = req.session.userId;
  const group = readGroups().find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });

  const gm = readGroupMemberships().filter((m) => m.groupId === group.id);
  if (!gm.some((m) => m.userId === myId)) return res.status(403).json({ error: 'Вы не участник' });

  const users = readUsers();
  const onlineSet = getOnlineUserIds();
  const members = gm.map((m) => {
    const u = users.find((x) => x.id === m.userId);
    if (!u) return null;
    return { ...publicUser(u), isOnline: onlineSet.has(u.id), isOwner: group.ownerId === u.id };
  }).filter(Boolean);

  res.json(members);
});

// Редактировать группу (имя, аватар)
app.put('/api/groups/:groupId', upload.single('avatar'), (req, res) => {
  const myId = req.session.userId;
  const groups = readGroups();
  const group = groups.find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может редактировать' });

  const { name } = req.body || {};
  if (name !== undefined) {
    const clean = name.trim().slice(0, 40);
    if (clean.length < 2) return res.status(400).json({ error: 'Название должно быть не короче 2 символов' });
    group.name = clean;
  }
  if (req.file) {
    if (group.avatar) {
      const oldPath = path.join(__dirname, 'public', group.avatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    group.avatar = '/uploads/' + req.file.filename;
  }
  writeGroups(groups);

  const memberIds = readGroupMemberships().filter((m) => m.groupId === group.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'group-updated', { groupId: group.id }));
  res.json({ ok: true });
});

// Удалить группу
app.delete('/api/groups/:groupId', (req, res) => {
  const myId = req.session.userId;
  const groups = readGroups();
  const group = groups.find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может удалить группу' });

  if (group.avatar) {
    const fp = path.join(__dirname, 'public', group.avatar);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  const gc = readGroupChannels().filter((c) => c.groupId === group.id);
  gc.forEach((c) => { delete groupMessages[group.id + ':' + c.id]; });
  writeGroupChannels(readGroupChannels().filter((c) => c.groupId !== group.id));
  writeGroupMemberships(readGroupMemberships().filter((m) => m.groupId !== group.id));
  writeGroups(groups.filter((g) => g.id !== group.id));

  const memberIds = readGroupMemberships().filter((m) => m.groupId === group.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'group-deleted', { groupId: group.id }));
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Покинуть группу
app.post('/api/groups/:groupId/leave', (req, res) => {
  const myId = req.session.userId;
  const group = readGroups().find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.ownerId === myId) return res.status(400).json({ error: 'Владелец не может покинуть группу — удалите её' });

  writeGroupMemberships(readGroupMemberships().filter((m) => !(m.groupId === group.id && m.userId === myId)));
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Исключить участника группы (только владелец)
app.delete('/api/groups/:groupId/members/:userId', (req, res) => {
  const myId = req.session.userId;
  const group = readGroups().find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может исключать' });
  if (req.params.userId === myId) return res.status(400).json({ error: 'Нельзя исключить себя' });

  writeGroupMemberships(readGroupMemberships().filter((m) => !(m.groupId === group.id && m.userId === req.params.userId)));
  emitToUser(req.params.userId, 'group-deleted', { groupId: group.id });
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Добавить участника в группу (только владелец, только друзья)
app.post('/api/groups/:groupId/members', (req, res) => {
  const myId = req.session.userId;
  const group = readGroups().find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может добавлять участников' });

  const { username } = req.body || {};
  const target = readUsers().find((u) => u.username.toLowerCase() === (username || '').trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!areFriends(myId, target.id)) return res.status(403).json({ error: 'Можно добавлять только друзей' });

  const gm = readGroupMemberships();
  if (gm.some((m) => m.groupId === group.id && m.userId === target.id)) {
    return res.status(409).json({ error: 'Уже участник' });
  }
  gm.push({ groupId: group.id, userId: target.id, joinedAt: new Date().toISOString() });
  writeGroupMemberships(gm);
  emitToUser(target.id, 'group-updated', { groupId: group.id });
  broadcastAllUserLists();
  res.json({ ok: true });
});

// Удалить канал группы (только владелец)
app.delete('/api/groups/:groupId/channels/:channelId', (req, res) => {
  const myId = req.session.userId;
  const group = readGroups().find((g) => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.ownerId !== myId) return res.status(403).json({ error: 'Только владелец может удалять каналы' });

  const gc = readGroupChannels();
  const ch = gc.find((c) => c.id === req.params.channelId && c.groupId === group.id);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });

  writeGroupChannels(gc.filter((c) => c.id !== ch.id));
  delete groupMessages[group.id + ':' + ch.id];
  const memberIds = readGroupMemberships().filter((m) => m.groupId === group.id).map((m) => m.userId);
  memberIds.forEach((uid) => emitToUser(uid, 'group-updated', { groupId: group.id }));
  res.json({ ok: true });
});

// ============================================================
//  REST: сторис
// ============================================================
app.use('/api/stories', requireAuth);

app.get('/api/stories', (req, res) => {
  const myId = req.session.userId;
  const now = Date.now();
  // сторис живут 24 часа
  let stories = readStories().filter((s) => now - new Date(s.createdAt).getTime() < 24 * 60 * 60 * 1000);

  // удалить просроченные
  const all = readStories();
  const valid = all.filter((s) => now - new Date(s.createdAt).getTime() < 24 * 60 * 60 * 1000);
  if (valid.length !== all.length) writeStories(valid);

  // видны сторис друзей + свои
  const friendIds = new Set(getFriendIds(myId));
  friendIds.add(myId);

  const users = readUsers();
  const userMap = new Map(users.map((u) => [u.id, u]));

  // группируем по пользователю
  const byUser = {};
  stories.forEach((s) => {
    if (!friendIds.has(s.userId)) return;
    if (!byUser[s.userId]) {
      const u = userMap.get(s.userId);
      byUser[s.userId] = {
        userId: s.userId,
        username: u ? u.username : s.username,
        avatarColor: u ? u.avatarColor : s.avatarColor,
        avatar: u ? (u.avatar || null) : null,
        stories: [],
      };
    }
    byUser[s.userId].stories.push({
      id: s.id,
      media: s.media,
      type: s.type,
      text: s.text || '',
      createdAt: s.createdAt,
    });
  });

  res.json(Object.values(byUser));
});

app.post('/api/stories', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const myId = req.session.userId;
  const users = readUsers();
  const user = users.find((u) => u.id === myId);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  const story = {
    id: 'st_' + Date.now() + '_' + rand(),
    userId: myId,
    username: user.username,
    avatarColor: user.avatarColor,
    media: '/uploads/' + req.file.filename,
    type,
    text: (req.body.text || '').slice(0, 200),
    createdAt: new Date().toISOString(),
  };
  const stories = readStories();
  stories.push(story);
  writeStories(stories);

  // уведомить друзей
  getFriendIds(myId).forEach((fid) => emitToUser(fid, 'story-new', { userId: myId }));
  emitToUser(myId, 'story-new', { userId: myId });

  res.json({ id: story.id, media: story.media, type: story.type, text: story.text, createdAt: story.createdAt });
});

app.delete('/api/stories/:storyId', (req, res) => {
  const myId = req.session.userId;
  const stories = readStories();
  const s = stories.find((x) => x.id === req.params.storyId);
  if (!s) return res.status(404).json({ error: 'Сторис не найдена' });
  if (s.userId !== myId) return res.status(403).json({ error: 'Нельзя удалить чужую сторис' });

  // удалить файл
  if (s.media) {
    const fp = path.join(__dirname, 'public', s.media);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  writeStories(stories.filter((x) => x.id !== s.id));
  res.json({ ok: true });
});

// ============================================================
//  REST: загрузка голосовых сообщений
// ============================================================
app.post('/api/upload/voice', requireAuth, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ============================================================
//  REST: непрочитанные личные сообщения
// ============================================================
app.get('/api/dm/unread', requireAuth, (req, res) => {
  const myId = req.session.userId;
  const users = readUsers();
  const me = users.find((u) => u.id === myId);
  if (!me) return res.status(404).json({ error: 'Не найден' });

  const reads = me.dmReads || {};
  const friendIds = getFriendIds(myId);
  const result = {};

  friendIds.forEach((fid) => {
    const key = dmKey(myId, fid);
    const msgs = dmMessages[key] || [];
    const lastRead = reads[fid] ? new Date(reads[fid]).getTime() : 0;
    const unread = msgs.filter((m) => m.fromUserId === fid && new Date(m.time).getTime() > lastRead).length;
    if (unread > 0) result[fid] = unread;
  });

  res.json(result);
});

app.post('/api/dm/read/:userId', requireAuth, (req, res) => {
  const myId = req.session.userId;
  const users = readUsers();
  const me = users.find((u) => u.id === myId);
  if (!me) return res.status(404).json({ error: 'Не найден' });
  if (!areFriends(myId, req.params.userId)) return res.status(403).json({ error: 'Не друзья' });

  if (!me.dmReads) me.dmReads = {};
  me.dmReads[req.params.userId] = new Date().toISOString();
  writeUsers(users);
  res.json({ ok: true });
});

// ============================================================
//  Socket.io
// ============================================================
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.use((socket, next) => {
  const sess = socket.request.session;
  if (!sess || !sess.userId) return next(new Error('unauthorized'));
  const user = readUsers().find((u) => u.id === sess.userId);
  if (!user) return next(new Error('unauthorized'));
  socket.user = publicUser(user);
  next();
});

// Голосовые каналы: channelId -> Map<userId, socketId>
const voiceChannels = {};

function getVoiceChannelMembers(channelId) {
  const ch = voiceChannels[channelId];
  if (!ch) return [];
  const result = [];
  ch.forEach((socketId, userId) => {
    const u = onlineUsers[socketId];
    if (u) result.push({ userId, username: u.username, avatarColor: u.avatarColor, avatar: u.avatar || null, socketId });
  });
  return result;
}

function broadcastVoiceChannelMembers(channelId) {
  const members = getVoiceChannelMembers(channelId);
  members.forEach((m) => {
    io.to(m.socketId).emit('voice-channel-members', { channelId, members });
  });
}

io.on('connection', (socket) => {
  const { id: userId, username, avatarColor, avatar } = socket.user;

  onlineUsers[socket.id] = { userId, username, avatarColor, avatar, channelId: null, voiceChannelId: null };
  if (!socketsByUserId[userId]) socketsByUserId[userId] = new Set();
  socketsByUserId[userId].add(socket.id);

  socket.emit('joined', { you: { id: socket.id, userId, username, avatarColor, avatar } });
  broadcastAllUserLists();

  // --- Переключение текстового канала ---
  socket.on('switch-channel', (channelId) => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    const channel = readChannels().find((c) => c.id === channelId);
    if (!channel || !isMember(user.userId, channel.serverId)) return;

    if (user.channelId) socket.leave('channel:' + user.channelId);
    user.channelId = channelId;
    socket.join('channel:' + channelId);

    if (!channelMessages[channelId]) channelMessages[channelId] = [];
    socket.emit('channel-history', { channelId, messages: channelMessages[channelId] });
  });

  // --- Сообщение в канал (текст или голосовое) ---
  socket.on('chat-message', (data) => {
    const user = onlineUsers[socket.id];
    if (!user || !user.channelId) return;

    const text = typeof data === 'string' ? data : (data.text || '');
    const voiceUrl = typeof data === 'object' ? data.voiceUrl : null;
    const voiceDuration = typeof data === 'object' ? data.voiceDuration : null;

    if (!text.trim() && !voiceUrl) return;

    const msg = {
      channelId: user.channelId,
      userId: user.userId,
      username: user.username,
      avatarColor: user.avatarColor,
      avatar: user.avatar || null,
      text: text.trim().slice(0, 2000),
      voiceUrl: voiceUrl || null,
      voiceDuration: voiceDuration || null,
      time: new Date().toISOString(),
    };
    if (!channelMessages[user.channelId]) channelMessages[user.channelId] = [];
    channelMessages[user.channelId].push(msg);
    if (channelMessages[user.channelId].length > 200) channelMessages[user.channelId].shift();
    saveChannelMessage(msg);

    io.to('channel:' + user.channelId).emit('chat-message', msg);
  });

  socket.on('typing', () => {
    const user = onlineUsers[socket.id];
    if (!user || !user.channelId) return;
    socket.to('channel:' + user.channelId).emit('typing', { username: user.username });
  });

  // --- Личные сообщения ---
  socket.on('dm-open', (friendUserId) => {
    const user = onlineUsers[socket.id];
    if (!user || !areFriends(user.userId, friendUserId)) return;
    const key = dmKey(user.userId, friendUserId);
    if (!dmMessages[key]) dmMessages[key] = [];
    socket.emit('dm-history', { withUserId: friendUserId, messages: dmMessages[key] });
  });

  socket.on('dm-message', ({ to, text, voiceUrl, voiceDuration }) => {
    const user = onlineUsers[socket.id];
    if (!user || !areFriends(user.userId, to)) return;
    if (!text.trim() && !voiceUrl) return;

    const key = dmKey(user.userId, to);
    if (!dmMessages[key]) dmMessages[key] = [];
    const msg = {
      fromUserId: user.userId,
      toUserId: to,
      userId: user.userId,
      username: user.username,
      avatarColor: user.avatarColor,
      avatar: user.avatar || null,
      text: text.trim().slice(0, 2000),
      voiceUrl: voiceUrl || null,
      voiceDuration: voiceDuration || null,
      time: new Date().toISOString(),
    };
    dmMessages[key].push(msg);
    if (dmMessages[key].length > 200) dmMessages[key].shift();
    saveDmMessage(msg);

    emitToUser(user.userId, 'dm-message', msg);
    emitToUser(to, 'dm-message', msg);
  });

  // --- Групповые сообщения ---
  socket.on('group-open', ({ groupId, channelId }) => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    const gm = readGroupMemberships();
    if (!gm.some((m) => m.groupId === groupId && m.userId === user.userId)) return;

    socket.join('group:' + groupId + ':' + channelId);
    const key = groupId + ':' + channelId;
    if (!groupMessages[key]) groupMessages[key] = [];
    socket.emit('group-history', { groupId, channelId, messages: groupMessages[key] });
  });

  socket.on('group-message', ({ groupId, channelId, text, voiceUrl, voiceDuration }) => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    const gm = readGroupMemberships();
    if (!gm.some((m) => m.groupId === groupId && m.userId === user.userId)) return;
    if (!text.trim() && !voiceUrl) return;

    const key = groupId + ':' + channelId;
    if (!groupMessages[key]) groupMessages[key] = [];
    const msg = {
      groupId,
      channelId,
      userId: user.userId,
      username: user.username,
      avatarColor: user.avatarColor,
      avatar: user.avatar || null,
      text: text.trim().slice(0, 2000),
      voiceUrl: voiceUrl || null,
      voiceDuration: voiceDuration || null,
      time: new Date().toISOString(),
    };
    groupMessages[key].push(msg);
    if (groupMessages[key].length > 200) groupMessages[key].shift();
    saveGroupMessage(msg);

    io.to('group:' + groupId + ':' + channelId).emit('group-message', msg);
  });

  // ============================================================
  //  Голосовые каналы (mesh WebRTC)
  // ============================================================
  socket.on('join-voice-channel', (channelId) => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    const channel = readChannels().find((c) => c.id === channelId) || readGroupChannels().find((c) => c.id === channelId);
    if (!channel) return;

    // проверить доступ
    if (channel.serverId && !isMember(user.userId, channel.serverId)) return;
    if (channel.groupId) {
      const gm = readGroupMemberships();
      if (!gm.some((m) => m.groupId === channel.groupId && m.userId === user.userId)) return;
    }

    // покинуть предыдущий голосовой канал
    if (user.voiceChannelId) {
      const prev = voiceChannels[user.voiceChannelId];
      if (prev) {
        prev.delete(user.userId);
        if (prev.size === 0) delete voiceChannels[user.voiceChannelId];
        else broadcastVoiceChannelMembers(user.voiceChannelId);
      }
    }

    if (!voiceChannels[channelId]) voiceChannels[channelId] = new Map();
    voiceChannels[channelId].set(user.userId, socket.id);
    user.voiceChannelId = channelId;
    socket.join('voice:' + channelId);

    // сообщить новому участнику о существующих + существующим о новом
    const members = getVoiceChannelMembers(channelId);
    socket.emit('voice-channel-members', { channelId, members });
    // разослать всем текущим (кроме нового) что появился новый
    members.forEach((m) => {
      if (m.userId !== user.userId) {
        io.to(m.socketId).emit('voice-user-joined', { channelId, userId: user.userId, username: user.username, socketId: socket.id });
      }
    });
  });

  socket.on('leave-voice-channel', () => {
    const user = onlineUsers[socket.id];
    if (!user || !user.voiceChannelId) return;
    const chId = user.voiceChannelId;
    const ch = voiceChannels[chId];
    if (ch) {
      ch.delete(user.userId);
      if (ch.size === 0) delete voiceChannels[chId];
      else {
        broadcastVoiceChannelMembers(chId);
        // сообщить остальным что пользователь вышел
        ch.forEach((sid) => {
          io.to(sid).emit('voice-user-left', { channelId: chId, userId: user.userId });
        });
      }
    }
    socket.leave('voice:' + chId);
    user.voiceChannelId = null;
    socket.emit('voice-channel-left', { channelId: chId });
  });

  // WebRTC сигналинг для голосовых каналов (mesh)
  socket.on('voice-offer', ({ toUserId, offer }) => {
    const set = socketsByUserId[toUserId];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('voice-offer', { fromUserId: userId, fromSocketId: socket.id, offer }));
  });

  socket.on('voice-answer', ({ toSocketId, answer }) => {
    io.to(toSocketId).emit('voice-answer', { fromSocketId: socket.id, answer });
  });

  socket.on('voice-ice', ({ toSocketId, candidate }) => {
    io.to(toSocketId).emit('voice-ice', { fromSocketId: socket.id, candidate });
  });

  // ============================================================
  //  Сигналинг WebRTC для звонков 1-на-1 (по userId)
  // ============================================================
  socket.on('call-user', ({ to, offer, callType }) => {
    const caller = onlineUsers[socket.id];
    if (!caller) return;
    const set = socketsByUserId[to];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('incoming-call', { from: userId, fromSocketId: socket.id, username: caller.username, avatar: caller.avatar, offer, callType }));
  });

  socket.on('answer-call', ({ to, answer }) => {
    const set = socketsByUserId[to];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('call-answered', { from: userId, answer }));
  });

  socket.on('reject-call', ({ to }) => {
    const set = socketsByUserId[to];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('call-rejected', { from: userId }));
  });

  socket.on('end-call', ({ to }) => {
    const set = socketsByUserId[to];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('call-ended', { from: userId }));
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const set = socketsByUserId[to];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('ice-candidate', { from: userId, candidate }));
  });

  // ============================================================
  //  Сигналинг демонстрации экрана (screen share) в звонках 1-на-1
  // ============================================================
  socket.on('screen-share-start', ({ to }) => {
    const set = socketsByUserId[to];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('screen-share-start', { from: userId }));
  });

  socket.on('screen-share-stop', ({ to }) => {
    const set = socketsByUserId[to];
    if (!set) return;
    set.forEach((sid) => io.to(sid).emit('screen-share-stop', { from: userId }));
  });

  // --- Отключение ---
  socket.on('disconnect', () => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    delete onlineUsers[socket.id];

    // покинуть голосовой канал
    if (user.voiceChannelId) {
      const ch = voiceChannels[user.voiceChannelId];
      if (ch) {
        ch.delete(user.userId);
        if (ch.size === 0) delete voiceChannels[user.voiceChannelId];
        else {
          broadcastVoiceChannelMembers(user.voiceChannelId);
          ch.forEach((sid) => io.to(sid).emit('voice-user-left', { channelId: user.voiceChannelId, userId: user.userId }));
        }
      }
    }

    const set = socketsByUserId[user.userId];
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) delete socketsByUserId[user.userId];
    }
    broadcastAllUserLists();
  });
});

// Загрузка сообщений при старте
loadMessages();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Волна запущена: http://localhost:${PORT}`);
});