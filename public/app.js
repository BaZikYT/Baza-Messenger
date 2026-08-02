// ============================================================
//  КЛИЕНТ — Волна
//  1. Авторизация
//  2. Серверы (текстовые + голосовые каналы)
//  3. Группы
//  4. Друзья + ЛС
//  5. Сторис
//  6. Профиль (редактор + просмотр чужого)
//  7. Голосовые сообщения
//  8. Звонки 1-на-1 (по userId)
//  9. Голосовые каналы (mesh WebRTC)
// ============================================================

const socket = io({ autoConnect: false });

let me = null;
let typingTimeout = null;

let serversData = [];
let groupsData = [];
let selectedRail = 'home';     // 'home' | serverId | groupId
let mainView = { type: 'friends' };
let initialRoutingDone = false;

let friendsData = { friends: [], incoming: [], outgoing: [] };
let onlineUsersByUserId = {};
let storiesData = [];

// --- состояние звонка 1-на-1 ---
let localStream = null;
let peerConnection = null;
let remotePeerId = null;       // userId
let pendingOffer = null;
let currentCallType = 'voice';

// --- голосовые каналы (mesh) ---
let voiceLocalStream = null;
let voiceChannelId = null;
let voicePeerConnections = {}; // userId -> RTCPeerConnection

// --- запись голосового сообщения ---
let mediaRecorder = null;
let recordedChunks = [];
let recStartTime = 0;
let recTimerInterval = null;

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ============================================================
//  DOM-элементы
// ============================================================
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const authTabs = document.querySelectorAll('.auth-tab');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const authError = document.getElementById('auth-error');
const authSubmit = document.getElementById('auth-submit');
const logoutBtn = document.getElementById('logout-btn');
const profileBtn = document.getElementById('profile-btn');

const homeIcon = document.getElementById('home-icon');
const serverIconsEl = document.getElementById('server-icons');
const groupIconsEl = document.getElementById('group-icons');
const addServerIcon = document.getElementById('add-server-icon');
const addGroupIcon = document.getElementById('add-group-icon');

const storiesBar = document.getElementById('stories-bar');
const channelsList = document.getElementById('channels-list');
const currentChannelName = document.getElementById('current-channel-name');
const chatHash = document.getElementById('chat-hash');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const typingIndicator = document.getElementById('typing-indicator');
const usersList = document.getElementById('users-list');
const onlineCount = document.getElementById('online-count');
const usersColTitle = document.getElementById('users-col-title');
const meAvatar = document.getElementById('me-avatar');
const meName = document.getElementById('me-name');
const meStatus = document.getElementById('me-status');

const dmCallBtn = document.getElementById('dm-call-btn');
const dmVideoBtn = document.getElementById('dm-video-btn');
const dmProfileBtn = document.getElementById('dm-profile-btn');

const friendsPanel = document.getElementById('friends-panel');
const addFriendForm = document.getElementById('add-friend-form');
const addFriendInput = document.getElementById('add-friend-input');
const friendRequestError = document.getElementById('friend-request-error');
const incomingSection = document.getElementById('incoming-section');
const outgoingSection = document.getElementById('outgoing-section');
const incomingList = document.getElementById('incoming-list');
const outgoingList = document.getElementById('outgoing-list');
const friendsListEl = document.getElementById('friends-list');

// Сервер модалка
const serverModal = document.getElementById('server-modal');
const serverTabs = document.querySelectorAll('[data-servertab]');
const createServerForm = document.getElementById('create-server-form');
const createServerInput = document.getElementById('create-server-input');
const joinServerForm = document.getElementById('join-server-form');
const joinServerInput = document.getElementById('join-server-input');
const serverModalError = document.getElementById('server-modal-error');
const closeServerModalBtn = document.getElementById('close-server-modal');
const serverAvatarUpload = document.getElementById('server-avatar-upload');
const serverAvatarFile = document.getElementById('server-avatar-file');
const serverAvatarPreview = document.getElementById('server-avatar-preview');
let serverAvatarFileObj = null;

// Группа модалка
const groupModal = document.getElementById('group-modal');
const createGroupForm = document.getElementById('create-group-form');
const createGroupInput = document.getElementById('create-group-input');
const groupModalError = document.getElementById('group-modal-error');
const closeGroupModalBtn = document.getElementById('close-group-modal');
const groupMembersList = document.getElementById('group-members-list');
const groupAvatarUpload = document.getElementById('group-avatar-upload');
const groupAvatarFile = document.getElementById('group-avatar-file');
const groupAvatarPreview = document.getElementById('group-avatar-preview');
let groupAvatarFileObj = null;
let selectedGroupMembers = new Set();

// Профиль модалка
const profileModal = document.getElementById('profile-modal');
const profileForm = document.getElementById('profile-form');
const editUsername = document.getElementById('edit-username');
const editStatus = document.getElementById('edit-status');
const editBio = document.getElementById('edit-bio');
const profileError = document.getElementById('profile-error');
const closeProfileModalBtn = document.getElementById('close-profile-modal');
const avatarUploadBtn = document.getElementById('avatar-upload-btn');
const avatarFile = document.getElementById('avatar-file');
const editAvatarPreview = document.getElementById('edit-avatar-preview');
const bannerUploadBtn = document.getElementById('banner-upload-btn');
const bannerFile = document.getElementById('banner-file');
const editBannerPreview = document.getElementById('edit-banner-preview');

// Просмотр профиля
const viewProfileModal = document.getElementById('view-profile-modal');
const closeViewProfileBtn = document.getElementById('close-view-profile');
const viewAvatar = document.getElementById('view-avatar');
const viewBanner = document.getElementById('view-banner');
const viewUsername = document.getElementById('view-username');
const viewStatus = document.getElementById('view-status');
const viewOnline = document.getElementById('view-online');
const viewBio = document.getElementById('view-bio');
const viewMeta = document.getElementById('view-meta');
const viewActions = document.getElementById('view-actions');

// Сторис
const storyViewer = document.getElementById('story-viewer');
const storyProgress = document.getElementById('story-progress');
const storyAvatar = document.getElementById('story-avatar');
const storyUsername = document.getElementById('story-username');
const storyTime = document.getElementById('story-time');
const storyContent = document.getElementById('story-content');
const closeStoryBtn = document.getElementById('close-story');
const storyPrevBtn = document.getElementById('story-prev');
const storyNextBtn = document.getElementById('story-next');
let storyState = { userIndex: 0, storyIndex: 0, timer: null };

// Звонки
const incomingCallEl = document.getElementById('incoming-call');
const incomingName = document.getElementById('incoming-name');
const incomingType = document.getElementById('incoming-type');
const incomingAvatar = document.getElementById('incoming-avatar');
const acceptBtn = document.getElementById('accept-btn');
const rejectBtn = document.getElementById('reject-btn');

const callOverlay = document.getElementById('call-overlay');
const callWithName = document.getElementById('call-with-name');
const callStatus = document.getElementById('call-status');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const toggleMicBtn = document.getElementById('toggle-mic');
const toggleCamBtn = document.getElementById('toggle-cam');
const hangupBtn = document.getElementById('hangup-btn');

// Голосовые сообщения
const voiceRecordBtn = document.getElementById('voice-record-btn');
const recordingIndicator = document.getElementById('recording-indicator');
const recTimer = document.getElementById('rec-timer');
const cancelRecBtn = document.getElementById('cancel-rec-btn');
const sendRecBtn = document.getElementById('send-rec-btn');

// Голосовой канал
const voicePanel = document.getElementById('voice-panel');
const voiceChannelName = document.getElementById('voice-channel-name');
const voiceParticipants = document.getElementById('voice-participants');
const leaveVoiceBtn = document.getElementById('leave-voice-btn');

// Форма кода подтверждения (вход)
const codeForm = document.getElementById('code-form');
const codeInput = document.getElementById('code-input');
const codeInfo = document.getElementById('code-info');
const codeError = document.getElementById('code-error');
const codeSubmit = document.getElementById('code-submit');
const codeBack = document.getElementById('code-back');

// Привязка почты
const emailStatus = document.getElementById('email-status');
const emailInput = document.getElementById('email-input');
const emailBindBtn = document.getElementById('email-bind-btn');
const emailBindRow = document.getElementById('email-bind-row');
const emailVerifyRow = document.getElementById('email-verify-row');
const emailCodeInput = document.getElementById('email-code-input');
const emailVerifyBtn = document.getElementById('email-verify-btn');
const emailUnbindBtn = document.getElementById('email-unbind-btn');
const emailError = document.getElementById('email-error');

// Демонстрация экрана
const screenShareBtn = document.getElementById('screen-share-btn');
let screenStream = null;
let isSharingScreen = false;
let pendingEmailForLogin = null;

// Непрочитанные сообщения
let unreadData = {};

// ============================================================
//  Утилиты
// ============================================================
function initials(name) { return name.trim().slice(0, 2).toUpperCase(); }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function scrollMessagesToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function setAvatar(el, user) {
  el.innerHTML = '';
  if (user.avatar) {
    el.style.background = '';
    const img = document.createElement('img');
    img.src = user.avatar;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.style.background = user.avatarColor || '';
    el.textContent = initials(user.username || '?');
  }
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return Math.floor(diff / 60000) + ' мин назад';
  if (h < 24) return h + ' ч назад';
  return Math.floor(h / 24) + ' д назад';
}

// ============================================================
//  1. АВТОРИЗАЦИЯ
// ============================================================
let authMode = 'login';

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.tab;
    authTabs.forEach((t) => t.classList.toggle('active', t === tab));
    authSubmit.textContent = authMode === 'login' ? 'Войти' : 'Создать аккаунт';
    passwordInput.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    hideAuthError();
  });
});

function showAuthError(text) { authError.textContent = text; authError.classList.remove('hidden'); }
function hideAuthError() { authError.classList.add('hidden'); }

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) return;

  authSubmit.disabled = true;
  try {
    if (authMode === 'register') {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { showAuthError(data.error || 'Что-то пошло не так'); return; }
      enterApp(data);
    } else {
      // Вход — через request-code (поддержка 2FA через почту)
      const res = await fetch('/api/login/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { showAuthError(data.error || 'Неверное имя или пароль'); return; }

      if (data.requireCode) {
        pendingEmailForLogin = data.email;
        codeInfo.textContent = `Код подтверждения отправлен на ${data.email}.`;
        if (data.devCode) codeInfo.textContent += ` (Тестовый режим, код: ${data.devCode})`;
        authForm.classList.add('hidden');
        codeForm.classList.remove('hidden');
        codeInput.value = '';
        codeInput.focus();
      } else {
        enterApp(data.user);
      }
    }
  } catch (err) {
    showAuthError('Не удалось связаться с сервером');
  } finally {
    authSubmit.disabled = false;
  }
});

// Форма ввода кода подтверждения
codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  codeError.classList.add('hidden');
  const code = codeInput.value.trim();
  if (!code) return;

  codeSubmit.disabled = true;
  try {
    const res = await fetch('/api/login/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) { codeError.textContent = data.error || 'Неверный код'; codeError.classList.remove('hidden'); return; }
    codeForm.classList.add('hidden');
    authForm.classList.remove('hidden');
    codeInput.value = '';
    enterApp(data);
  } catch (err) {
    codeError.textContent = 'Не удалось связаться с сервером';
    codeError.classList.remove('hidden');
  } finally {
    codeSubmit.disabled = false;
  }
});

codeBack.addEventListener('click', () => {
  codeForm.classList.add('hidden');
  authForm.classList.remove('hidden');
  codeInput.value = '';
  codeError.classList.add('hidden');
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  socket.disconnect();
  me = null;
  initialRoutingDone = false;
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  passwordInput.value = '';
});

async function enterApp(user) {
  me = user;
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');

  setAvatar(meAvatar, me);
  meName.textContent = me.username;
  meStatus.textContent = me.status || 'В сети';

  socket.connect();
  await loadFriends();
  await loadServers();
  await loadGroups();
  await loadStories();
}

(async function checkExistingSession() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) enterApp(await res.json());
  } catch (err) {}
})();

socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') {
    appScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
  }
});

socket.on('profile-updated', (user) => {
  if (me && user.id === me.id) {
    me = user;
    setAvatar(meAvatar, me);
    meName.textContent = me.username;
    meStatus.textContent = me.status || 'В сети';
  }
});

// ============================================================
//  2. СЕРВЕРЫ И КАНАЛЫ
// ============================================================
async function loadServers(forceSelectId) {
  try {
    const res = await fetch('/api/servers');
    if (!res.ok) return;
    serversData = await res.json();
    renderServerRail();

    if (forceSelectId) { selectServer(forceSelectId); return; }

    if (!initialRoutingDone) {
      initialRoutingDone = true;
      if (serversData.length > 0) selectServer(serversData[0].id);
      else selectHome();
      return;
    }

    if (selectedRail !== 'home' && !groupsData.some(g => g.id === selectedRail)) {
      const server = serversData.find((s) => s.id === selectedRail);
      if (server) renderServerChannelsSidebar(server);
      else selectHome();
    }
  } catch (err) {}
}

function renderServerRail() {
  homeIcon.classList.toggle('active', selectedRail === 'home');
  serverIconsEl.innerHTML = '';
  serversData.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'server-icon' + (selectedRail === s.id ? ' active' : '');
    el.title = s.name;
    if (s.avatar) {
      const img = document.createElement('img');
      img.src = s.avatar;
      el.appendChild(img);
    } else {
      el.style.background = selectedRail === s.id ? '' : (s.color || '');
      el.textContent = initials(s.name);
    }
    el.addEventListener('click', () => selectServer(s.id));
    serverIconsEl.appendChild(el);
  });
}

function selectHome() {
  selectedRail = 'home';
  renderServerRail();
  renderGroupRail();
  storiesBar.classList.remove('hidden');
  // Сбросить панель участников — показать онлайн-друзей вместо участников сервера
  usersColTitle.textContent = 'В сети — ';
  usersList.innerHTML = '';
  switchToFriendsView();
  // Обновить список онлайн (он придёт через socket 'user-list')
  loadUnreadMessages();
}
homeIcon.addEventListener('click', selectHome);

function selectServer(serverId) {
  selectedRail = serverId;
  renderServerRail();
  renderGroupRail();
  storiesBar.classList.add('hidden');
  const server = serversData.find((s) => s.id === serverId);
  if (!server) return;
  renderServerChannelsSidebar(server);

  const textChannels = server.channels.filter(c => c.type !== 'voice');
  if (textChannels.length > 0) {
    openChannel(textChannels[0].id, textChannels[0].name);
  } else {
    mainView = { type: 'empty' };
    messagesEl.classList.add('hidden');
    messageForm.classList.add('hidden');
    friendsPanel.classList.add('hidden');
    typingIndicator.classList.add('hidden');
    chatHash.classList.add('hidden');
    currentChannelName.textContent = 'Пока нет текстовых каналов';
  }
  loadServerMembers(serverId);
}

function renderServerChannelsSidebar(server) {
  const textChannels = server.channels.filter(c => c.type !== 'voice');
  const voiceChannels = server.channels.filter(c => c.type === 'voice');

  let html = `<div class="server-name-header"><h2>${escapeHtml(server.name)}</h2><span class="invite-chip" data-copy-invite="${escapeHtml(server.inviteCode)}" title="Скопировать код приглашения">${escapeHtml(server.inviteCode)}</span></div>`;

  if (textChannels.length > 0) {
    html += `<div class="sidebar-section-label">Текстовые каналы</div>`;
    textChannels.forEach((c) => {
      const active = mainView.type === 'channel' && mainView.channelId === c.id;
      html += `<div class="channel-item${active ? ' active' : ''}" data-channel-id="${escapeHtml(c.id)}" data-channel-name="${escapeHtml(c.name)}"><span class="hash">#</span><span>${escapeHtml(c.name)}</span></div>`;
    });
  }

  if (voiceChannels.length > 0) {
    html += `<div class="sidebar-section-label">Голосовые каналы</div>`;
    voiceChannels.forEach((c) => {
      html += `<div class="channel-item voice-channel-item" data-voice-channel-id="${escapeHtml(c.id)}" data-voice-channel-name="${escapeHtml(c.name)}"><span class="hash">🔊</span><span>${escapeHtml(c.name)}</span></div>`;
    });
  }

  if (server.ownerId === me.id) {
    html += `<div class="add-channel-btn" data-add-channel="${escapeHtml(server.id)}">+ Добавить канал</div>`;
  }
  channelsList.innerHTML = html;
}

// ============================================================
//  3. ГРУППЫ
// ============================================================
async function loadGroups() {
  try {
    const res = await fetch('/api/groups');
    if (!res.ok) return;
    groupsData = await res.json();
    renderGroupRail();
  } catch (err) {}
}

function renderGroupRail() {
  groupIconsEl.innerHTML = '';
  groupsData.forEach((g) => {
    const el = document.createElement('div');
    el.className = 'server-icon group-icon' + (selectedRail === g.id ? ' active' : '');
    el.title = g.name;
    if (g.avatar) {
      const img = document.createElement('img');
      img.src = g.avatar;
      el.appendChild(img);
    } else {
      el.style.background = selectedRail === g.id ? '' : (g.color || '');
      el.textContent = initials(g.name);
    }
    el.addEventListener('click', () => selectGroup(g.id));
    groupIconsEl.appendChild(el);
  });
}

function selectGroup(groupId) {
  selectedRail = groupId;
  renderServerRail();
  renderGroupRail();
  storiesBar.classList.add('hidden');
  const group = groupsData.find((g) => g.id === groupId);
  if (!group) return;
  renderGroupChannelsSidebar(group);

  const textChannels = group.channels.filter(c => c.type !== 'voice');
  if (textChannels.length > 0) {
    openGroupChannel(group.id, textChannels[0].id, textChannels[0].name);
  } else {
    mainView = { type: 'empty' };
    messagesEl.classList.add('hidden');
    messageForm.classList.add('hidden');
    friendsPanel.classList.add('hidden');
    typingIndicator.classList.add('hidden');
    chatHash.classList.add('hidden');
    currentChannelName.textContent = 'Пока нет текстовых каналов';
  }
  loadGroupMembers(groupId);
}

function renderGroupChannelsSidebar(group) {
  const textChannels = group.channels.filter(c => c.type !== 'voice');
  const voiceChannels = group.channels.filter(c => c.type === 'voice');

  let html = `<div class="server-name-header"><h2>${escapeHtml(group.name)}</h2></div>`;

  if (textChannels.length > 0) {
    html += `<div class="sidebar-section-label">Текстовые каналы</div>`;
    textChannels.forEach((c) => {
      const active = mainView.type === 'group-channel' && mainView.channelId === c.id;
      html += `<div class="channel-item${active ? ' active' : ''}" data-group-channel-id="${escapeHtml(c.id)}" data-group-id="${escapeHtml(group.id)}" data-channel-name="${escapeHtml(c.name)}"><span class="hash">#</span><span>${escapeHtml(c.name)}</span></div>`;
    });
  }

  if (voiceChannels.length > 0) {
    html += `<div class="sidebar-section-label">Голосовые каналы</div>`;
    voiceChannels.forEach((c) => {
      html += `<div class="channel-item voice-channel-item" data-voice-channel-id="${escapeHtml(c.id)}" data-voice-channel-name="${escapeHtml(c.name)}"><span class="hash">🔊</span><span>${escapeHtml(c.name)}</span></div>`;
    });
  }

  if (group.ownerId === me.id) {
    html += `<div class="add-channel-btn" data-add-group-channel="${escapeHtml(group.id)}">+ Добавить канал</div>`;
  }
  channelsList.innerHTML = html;
}

// ============================================================
//  Клик по левой колонке
// ============================================================
channelsList.addEventListener('click', (e) => {
  const homeBtn = e.target.closest('[data-home-action]');
  if (homeBtn) { switchToFriendsView(); return; }

  const dmEl = e.target.closest('[data-dm-user]');
  if (dmEl) { openDm(dmEl.dataset.dmUser, dmEl.dataset.dmUsername); return; }

  const chEl = e.target.closest('[data-channel-id]');
  if (chEl) { openChannel(chEl.dataset.channelId, chEl.dataset.channelName); return; }

  const gchEl = e.target.closest('[data-group-channel-id]');
  if (gchEl) { openGroupChannel(gchEl.dataset.groupId, gchEl.dataset.groupChannelId, gchEl.dataset.channelName); return; }

  const voiceEl = e.target.closest('[data-voice-channel-id]');
  if (voiceEl) { joinVoiceChannel(voiceEl.dataset.voiceChannelId, voiceEl.dataset.voiceChannelName); return; }

  const inviteEl = e.target.closest('[data-copy-invite]');
  if (inviteEl) {
    const code = inviteEl.dataset.copyInvite;
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
    const original = code;
    inviteEl.textContent = 'Скопировано!';
    setTimeout(() => { inviteEl.textContent = original; }, 1200);
    return;
  }

  const addChBtn = e.target.closest('[data-add-channel]');
  if (addChBtn) { promptAddChannel(addChBtn.dataset.addChannel); return; }

  const addGchBtn = e.target.closest('[data-add-group-channel]');
  if (addGchBtn) { promptAddGroupChannel(addGchBtn.dataset.addGroupChannel); return; }
});

async function promptAddChannel(serverId) {
  const name = window.prompt('Название нового канала:');
  if (!name || !name.trim()) return;
  const type = window.confirm('OK = текстовый, Отмена = голосовой') ? 'text' : 'voice';

  const res = await fetch(`/api/servers/${serverId}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Не удалось добавить канал'); return; }
  await loadServers();
}

async function promptAddGroupChannel(groupId) {
  const name = window.prompt('Название нового канала:');
  if (!name || !name.trim()) return;
  const type = window.confirm('OK = текстовый, Отмена = голосовой') ? 'text' : 'voice';

  const res = await fetch(`/api/groups/${groupId}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Не удалось добавить канал'); return; }
  await loadGroups();
  selectGroup(groupId);
}

socket.on('server-updated', () => loadServers());
socket.on('group-updated', () => loadGroups());

// ============================================================
//  Переключение видов
// ============================================================
function openChannel(channelId, channelName) {
  mainView = { type: 'channel', channelId };
  messagesEl.innerHTML = '';
  messagesEl.classList.remove('hidden');
  messageForm.classList.remove('hidden');
  friendsPanel.classList.add('hidden');
  typingIndicator.classList.remove('hidden');
  chatHash.classList.remove('hidden');
  currentChannelName.textContent = channelName;
  dmCallBtn.classList.add('hidden');
  dmVideoBtn.classList.add('hidden');
  dmProfileBtn.classList.add('hidden');

  if (selectedRail !== 'home' && !groupsData.some(g => g.id === selectedRail)) {
    const server = serversData.find((s) => s.id === selectedRail);
    if (server) renderServerChannelsSidebar(server);
  }
  socket.emit('switch-channel', channelId);
}

function openGroupChannel(groupId, channelId, channelName) {
  mainView = { type: 'group-channel', groupId, channelId };
  messagesEl.innerHTML = '';
  messagesEl.classList.remove('hidden');
  messageForm.classList.remove('hidden');
  friendsPanel.classList.add('hidden');
  typingIndicator.classList.remove('hidden');
  chatHash.classList.remove('hidden');
  currentChannelName.textContent = channelName;
  dmCallBtn.classList.add('hidden');
  dmVideoBtn.classList.add('hidden');
  dmProfileBtn.classList.add('hidden');

  const group = groupsData.find((g) => g.id === groupId);
  if (group) renderGroupChannelsSidebar(group);
  socket.emit('group-open', { groupId, channelId });
}

function openDm(userId, username) {
  mainView = { type: 'dm', userId, username };
  messagesEl.innerHTML = '';
  messagesEl.classList.remove('hidden');
  messageForm.classList.remove('hidden');
  friendsPanel.classList.add('hidden');
  typingIndicator.classList.add('hidden');
  chatHash.classList.add('hidden');
  currentChannelName.textContent = username;
  dmCallBtn.classList.remove('hidden');
  dmVideoBtn.classList.remove('hidden');
  dmProfileBtn.classList.remove('hidden');

  if (selectedRail === 'home') renderHomeSidebar();
  socket.emit('dm-open', userId);
}

function switchToFriendsView() {
  mainView = { type: 'friends' };
  messagesEl.classList.add('hidden');
  messageForm.classList.add('hidden');
  typingIndicator.classList.add('hidden');
  friendsPanel.classList.remove('hidden');
  chatHash.classList.add('hidden');
  currentChannelName.textContent = 'Друзья';
  dmCallBtn.classList.add('hidden');
  dmVideoBtn.classList.add('hidden');
  dmProfileBtn.classList.add('hidden');

  if (selectedRail === 'home') renderHomeSidebar();
  renderFriendsPanel();
}

function renderHomeSidebar() {
  const friendsActive = mainView.type === 'friends';
  const badge = friendsData.incoming.length
    ? `<span class="friends-badge">${friendsData.incoming.length}</span>` : '';
  let html = `<div class="channel-item friends-nav-item${friendsActive ? ' active' : ''}" data-home-action="friends">
    <span>👥</span><span>Друзья</span>${badge}
  </div>`;
  html += `<div class="sidebar-section-label">Личные сообщения</div>`;

  if (friendsData.friends.length === 0) {
    html += `<div class="friends-empty" style="padding:4px 10px;">Пока нет друзей</div>`;
  } else {
    friendsData.friends.forEach((f) => {
      const active = mainView.type === 'dm' && mainView.userId === f.id;
      const online = !!onlineUsersByUserId[f.id];
      html += `<div class="channel-item${active ? ' active' : ''}" data-dm-user="${escapeHtml(f.id)}" data-dm-username="${escapeHtml(f.username)}">
        <span class="dm-avatar-mini" style="background:${escapeHtml(f.avatarColor || '')}">${escapeHtml(initials(f.username))}</span>
        <span>${escapeHtml(f.username)}</span>
        ${online ? '<span class="online-dot"></span>' : ''}
      </div>`;
    });
  }
  channelsList.innerHTML = html;
}

// ============================================================
//  Модалка сервера
// ============================================================
function openServerModal() {
  serverModal.classList.remove('hidden');
  serverModalError.classList.add('hidden');
  createServerInput.value = '';
  joinServerInput.value = '';
  serverAvatarFileObj = null;
  serverAvatarPreview.textContent = '+';
  serverAvatarPreview.style.background = '';
}
function closeServerModal() { serverModal.classList.add('hidden'); }

addServerIcon.addEventListener('click', openServerModal);
closeServerModalBtn.addEventListener('click', closeServerModal);

serverAvatarUpload.addEventListener('click', () => serverAvatarFile.click());
serverAvatarFile.addEventListener('change', () => {
  const file = serverAvatarFile.files[0];
  if (!file) return;
  serverAvatarFileObj = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    serverAvatarPreview.innerHTML = `<img src="${e.target.result}" />`;
  };
  reader.readAsDataURL(file);
});

serverTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    serverTabs.forEach((t) => t.classList.toggle('active', t === tab));
    const mode = tab.dataset.servertab;
    createServerForm.classList.toggle('hidden', mode !== 'create');
    joinServerForm.classList.toggle('hidden', mode !== 'join');
    serverModalError.classList.add('hidden');
  });
});

createServerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = createServerInput.value.trim();
  if (!name) return;

  const formData = new FormData();
  formData.append('name', name);
  if (serverAvatarFileObj) formData.append('avatar', serverAvatarFileObj);

  const res = await fetch('/api/servers', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) {
    serverModalError.textContent = data.error || 'Не удалось создать сервер';
    serverModalError.classList.remove('hidden');
    return;
  }
  closeServerModal();
  await loadServers(data.id);
});

joinServerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = joinServerInput.value.trim();
  if (!code) return;

  const res = await fetch('/api/servers/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode: code }),
  });
  const data = await res.json();
  if (!res.ok) {
    serverModalError.textContent = data.error || 'Не удалось присоединиться';
    serverModalError.classList.remove('hidden');
    return;
  }
  closeServerModal();
  await loadServers(data.id);
});

// ============================================================
//  Модалка группы
// ============================================================
function openGroupModal() {
  groupModal.classList.remove('hidden');
  groupModalError.classList.add('hidden');
  createGroupInput.value = '';
  groupAvatarFileObj = null;
  groupAvatarPreview.textContent = '+';
  groupAvatarPreview.style.background = '';
  selectedGroupMembers = new Set();
  renderGroupMembersSelect();
}
function closeGroupModal() { groupModal.classList.add('hidden'); }

addGroupIcon.addEventListener('click', openGroupModal);
closeGroupModalBtn.addEventListener('click', closeGroupModal);

groupAvatarUpload.addEventListener('click', () => groupAvatarFile.click());
groupAvatarFile.addEventListener('change', () => {
  const file = groupAvatarFile.files[0];
  if (!file) return;
  groupAvatarFileObj = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    groupAvatarPreview.innerHTML = `<img src="${e.target.result}" />`;
  };
  reader.readAsDataURL(file);
});

function renderGroupMembersSelect() {
  if (friendsData.friends.length === 0) {
    groupMembersList.innerHTML = '<div class="friends-empty">Сначала добавьте друзей</div>';
    return;
  }
  groupMembersList.innerHTML = friendsData.friends.map((f) => `
    <label class="member-checkbox${selectedGroupMembers.has(f.id) ? ' checked' : ''}">
      <input type="checkbox" value="${escapeHtml(f.id)}" ${selectedGroupMembers.has(f.id) ? 'checked' : ''} />
      <span class="dm-avatar-mini" style="background:${escapeHtml(f.avatarColor || '')}">${escapeHtml(initials(f.username))}</span>
      <span>${escapeHtml(f.username)}</span>
    </label>
  `).join('');

  groupMembersList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedGroupMembers.add(cb.value);
      else selectedGroupMembers.delete(cb.value);
      cb.closest('.member-checkbox').classList.toggle('checked', cb.checked);
    });
  });
}

createGroupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = createGroupInput.value.trim();
  if (!name) return;

  const formData = new FormData();
  formData.append('name', name);
  formData.append('memberIds', JSON.stringify([...selectedGroupMembers]));
  if (groupAvatarFileObj) formData.append('avatar', groupAvatarFileObj);

  const res = await fetch('/api/groups', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) {
    groupModalError.textContent = data.error || 'Не удалось создать группу';
    groupModalError.classList.remove('hidden');
    return;
  }
  closeGroupModal();
  await loadGroups();
  selectGroup(data.id);
});

// ============================================================
//  4. СООБЩЕНИЯ
// ============================================================
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value;
  if (!text.trim()) return;

  if (mainView.type === 'dm') socket.emit('dm-message', { to: mainView.userId, text });
  else if (mainView.type === 'channel') socket.emit('chat-message', { text });
  else if (mainView.type === 'group-channel') socket.emit('group-message', { groupId: mainView.groupId, channelId: mainView.channelId, text });

  messageInput.value = '';
});

messageInput.addEventListener('input', () => {
  if (mainView.type === 'channel' || mainView.type === 'group-channel') socket.emit('typing');
});

socket.on('channel-history', ({ channelId, messages }) => {
  if (mainView.type !== 'channel' || mainView.channelId !== channelId) return;
  messagesEl.innerHTML = '';
  messages.forEach(renderMessage);
  scrollMessagesToBottom();
});

socket.on('chat-message', (msg) => {
  if (mainView.type !== 'channel' || mainView.channelId !== msg.channelId) return;
  renderMessage(msg);
  scrollMessagesToBottom();
});

socket.on('dm-history', ({ withUserId, messages }) => {
  if (mainView.type !== 'dm' || mainView.userId !== withUserId) return;
  messagesEl.innerHTML = '';
  messages.forEach(renderMessage);
  scrollMessagesToBottom();
});

socket.on('group-history', ({ groupId, channelId, messages }) => {
  if (mainView.type !== 'group-channel' || mainView.groupId !== groupId || mainView.channelId !== channelId) return;
  messagesEl.innerHTML = '';
  messages.forEach(renderMessage);
  scrollMessagesToBottom();
});

socket.on('group-message', (msg) => {
  if (mainView.type !== 'group-channel' || mainView.groupId !== msg.groupId || mainView.channelId !== msg.channelId) return;
  renderMessage(msg);
  scrollMessagesToBottom();
});

let typingHideTimer = null;
socket.on('typing', ({ username }) => {
  typingIndicator.textContent = `${username} печатает…`;
  clearTimeout(typingHideTimer);
  typingHideTimer = setTimeout(() => (typingIndicator.textContent = ''), 1500);
});

function renderMessage(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  const time = new Date(msg.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const avatarHtml = msg.avatar
    ? `<div class="avatar"><img src="${escapeHtml(msg.avatar)}" /></div>`
    : `<div class="avatar" style="background:${escapeHtml(msg.avatarColor || '')}">${escapeHtml(initials(msg.username))}</div>`;

  let contentHtml = '';
  if (msg.voiceUrl) {
    contentHtml = `<div class="voice-msg">
      <button class="voice-play-btn" data-url="${escapeHtml(msg.voiceUrl)}">▶️</button>
      <span class="voice-duration">${msg.voiceDuration ? formatDuration(msg.voiceDuration) : '🔊'}</span>
      <span class="voice-wave"></span>
    </div>`;
  }
  if (msg.text) {
    contentHtml += `<div class="msg-text">${escapeHtml(msg.text)}</div>`;
  }

  wrap.innerHTML = `
    ${avatarHtml}
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-author" data-user-id="${escapeHtml(msg.userId || '')}">${escapeHtml(msg.username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      ${contentHtml}
    </div>`;
  messagesEl.appendChild(wrap);
}

// Воспроизведение голосовых сообщений (делегирование)
messagesEl.addEventListener('click', (e) => {
  const playBtn = e.target.closest('.voice-play-btn');
  if (!playBtn) return;
  const url = playBtn.dataset.url;
  const audio = new Audio(url);
  playBtn.textContent = '⏸️';
  audio.play();
  audio.addEventListener('ended', () => { playBtn.textContent = '▶️'; });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶️'; });
});

// Клик по имени автора — открыть профиль
messagesEl.addEventListener('click', (e) => {
  const author = e.target.closest('.msg-author');
  if (!author || !author.dataset.userId) return;
  viewProfile(author.dataset.userId);
});

// ============================================================
//  5. ГОЛОСОВЫЕ СООБЩЕНИЯ
// ============================================================
voiceRecordBtn.addEventListener('click', startRecording);

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];
    recStartTime = Date.now();

    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    });

    mediaRecorder.start();
    recordingIndicator.classList.remove('hidden');
    recTimerInterval = setInterval(() => {
      const sec = (Date.now() - recStartTime) / 1000;
      recTimer.textContent = formatDuration(sec);
    }, 200);
  } catch (err) {
    alert('Нет доступа к микрофону: ' + err.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(recTimerInterval);
  recordingIndicator.classList.add('hidden');
}

cancelRecBtn.addEventListener('click', () => {
  stopRecording();
  recordedChunks = [];
});

sendRecBtn.addEventListener('click', () => {
  if (!mediaRecorder) return;
  mediaRecorder.addEventListener('stop', async () => {
    const duration = (Date.now() - recStartTime) / 1000;
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', blob, 'voice.webm');

    try {
      const res = await fetch('/api/upload/voice', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Не удалось загрузить'); return; }

      if (mainView.type === 'dm') {
        socket.emit('dm-message', { to: mainView.userId, text: '', voiceUrl: data.url, voiceDuration: duration });
      } else if (mainView.type === 'channel') {
        socket.emit('chat-message', { text: '', voiceUrl: data.url, voiceDuration: duration });
      } else if (mainView.type === 'group-channel') {
        socket.emit('group-message', { groupId: mainView.groupId, channelId: mainView.channelId, text: '', voiceUrl: data.url, voiceDuration: duration });
      }
    } catch (err) {
      alert('Ошибка загрузки голосового');
    }
  }, { once: true });
  stopRecording();
});

// ============================================================
//  6. СПИСОК ОНЛАЙН (персонализированный)
// ============================================================
socket.on('user-list', (list) => {
  onlineUsersByUserId = {};
  list.forEach((u) => { onlineUsersByUserId[u.userId] = u; });

  onlineCount.textContent = list.length;
  usersList.innerHTML = '';

  list.forEach((u) => {
    const el = document.createElement('div');
    el.className = 'user-item';
    const avatarHtml = u.avatar
      ? `<div class="avatar"><img src="${escapeHtml(u.avatar)}" /><span class="online-dot"></span></div>`
      : `<div class="avatar" style="background:${escapeHtml(u.avatarColor || '')}">${escapeHtml(initials(u.username))}<span class="online-dot"></span></div>`;
    el.innerHTML = `
      ${avatarHtml}
      <div class="user-name" data-user-id="${escapeHtml(u.userId)}">${escapeHtml(u.username)}</div>
      <div class="call-icons">
        <button class="icon-btn" title="Профиль" data-profile="${escapeHtml(u.userId)}">👤</button>
        <button class="icon-btn" title="Аудиозвонок" data-call="voice" data-call-id="${escapeHtml(u.userId)}" data-call-name="${escapeHtml(u.username)}">🎙️</button>
        <button class="icon-btn" title="Видеозвонок" data-call="video" data-call-id="${escapeHtml(u.userId)}" data-call-name="${escapeHtml(u.username)}">📹</button>
      </div>`;
    el.querySelector('[data-call="voice"]').addEventListener('click', () => startCall(u.userId, u.username, 'voice'));
    el.querySelector('[data-call="video"]').addEventListener('click', () => startCall(u.userId, u.username, 'video'));
    el.querySelector('[data-profile]').addEventListener('click', () => viewProfile(u.userId));
    el.querySelector('.user-name').addEventListener('click', () => viewProfile(u.userId));
    usersList.appendChild(el);
  });

  if (mainView.type === 'friends') renderFriendsPanel();
  if (selectedRail === 'home') renderHomeSidebar();
});

// ============================================================
//  Участники сервера/группы
// ============================================================
async function loadServerMembers(serverId) {
  try {
    const res = await fetch(`/api/servers/${serverId}/members`);
    if (!res.ok) return;
    const members = await res.json();
    renderMembersList(members, 'Участники сервера');
  } catch (err) {}
}

async function loadGroupMembers(groupId) {
  try {
    const res = await fetch(`/api/groups/${groupId}/members`);
    if (!res.ok) return;
    const members = await res.json();
    renderMembersList(members, 'Участники группы');
  } catch (err) {}
}

function renderMembersList(members, title) {
  usersColTitle.textContent = title + ' — ' + members.length;
  usersList.innerHTML = '';
  members.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'user-item';
    const avatarHtml = m.avatar
      ? `<div class="avatar"><img src="${escapeHtml(m.avatar)}" />${m.isOnline ? '<span class="online-dot"></span>' : ''}</div>`
      : `<div class="avatar" style="background:${escapeHtml(m.avatarColor || '')}">${escapeHtml(initials(m.username))}${m.isOnline ? '<span class="online-dot"></span>' : ''}</div>`;
    el.innerHTML = `
      ${avatarHtml}
      <div class="user-name" data-user-id="${escapeHtml(m.id)}">${escapeHtml(m.username)}${m.isOwner ? ' 👑' : ''}</div>
      <div class="call-icons">
        <button class="icon-btn" title="Профиль" data-profile="${escapeHtml(m.id)}">👤</button>
      </div>`;
    el.querySelector('[data-profile]').addEventListener('click', () => viewProfile(m.id));
    el.querySelector('.user-name').addEventListener('click', () => viewProfile(m.id));
    usersList.appendChild(el);
  });
}

// ============================================================
//  7. ДРУЗЬЯ
// ============================================================
async function loadFriends() {
  try {
    const res = await fetch('/api/friends');
    if (!res.ok) return;
    friendsData = await res.json();
    if (selectedRail === 'home') renderHomeSidebar();
    if (mainView.type === 'friends') renderFriendsPanel();
  } catch (err) {}
}

function friendCard(person, actionsHtml) {
  const online = !!onlineUsersByUserId[person.id];
  const avatarHtml = person.avatar
    ? `<div class="avatar"><img src="${escapeHtml(person.avatar)}" />${online ? '<span class="online-dot"></span>' : ''}</div>`
    : `<div class="avatar" style="background:${escapeHtml(person.avatarColor || '')}">${escapeHtml(initials(person.username))}${online ? '<span class="online-dot"></span>' : ''}</div>`;
  return `
    <div class="friend-card">
      <div class="friend-avatar-clickable" data-profile="${escapeHtml(person.id)}">${avatarHtml}</div>
      <div class="friend-name" data-profile="${escapeHtml(person.id)}">${escapeHtml(person.username)}</div>
      <div class="friend-actions">${actionsHtml}</div>
    </div>`;
}

function renderFriendsPanel() {
  incomingSection.classList.toggle('hidden', friendsData.incoming.length === 0);
  incomingList.innerHTML = friendsData.incoming.map((p) => friendCard(p, `
    <button class="icon-btn accept-variant" title="Принять" data-action="accept" data-id="${escapeHtml(p.friendshipId)}">✓</button>
    <button class="icon-btn danger-variant" title="Отклонить" data-action="decline" data-id="${escapeHtml(p.friendshipId)}">✕</button>
  `)).join('');

  outgoingSection.classList.toggle('hidden', friendsData.outgoing.length === 0);
  outgoingList.innerHTML = friendsData.outgoing.map((p) => friendCard(p, `
    <button class="icon-btn danger-variant" title="Отменить заявку" data-action="cancel" data-id="${escapeHtml(p.friendshipId)}">✕</button>
  `)).join('');

  if (friendsData.friends.length === 0) {
    friendsListEl.innerHTML = '<div class="friends-empty">Пока никого нет — добавь друга по имени пользователя выше.</div>';
  } else {
    friendsListEl.innerHTML = friendsData.friends.map((p) => {
      const online = !!onlineUsersByUserId[p.id];
      const callButtons = online
        ? `<button class="icon-btn" title="Аудиозвонок" data-action="call-voice" data-id="${escapeHtml(p.id)}">🎙️</button>
           <button class="icon-btn" title="Видеозвонок" data-action="call-video" data-id="${escapeHtml(p.id)}">📹</button>`
        : '';
      return friendCard(p, `
        <button class="icon-btn" title="Написать" data-action="message" data-id="${escapeHtml(p.id)}" data-username="${escapeHtml(p.username)}">💬</button>
        ${callButtons}
        <button class="icon-btn danger-variant" title="Удалить из друзей" data-action="remove" data-id="${escapeHtml(p.friendshipId)}">🗑️</button>
      `);
    }).join('');
  }
}

// ============================================================
//  13. НЕПРОЧИТАННЫЕ СООБЩЕНИЯ
// ============================================================
async function loadUnreadMessages() {
  try {
    const res = await fetch('/api/dm/unread');
    if (!res.ok) return;
    unreadData = await res.json();
    if (selectedRail === 'home') renderHomeSidebar();
  } catch (err) {}
}

async function markDmAsRead(userId) {
  try {
    await fetch(`/api/dm/read/${userId}`, { method: 'POST' });
    if (unreadData[userId]) {
      delete unreadData[userId];
      if (selectedRail === 'home') renderHomeSidebar();
    }
  } catch (err) {}
}

renderHomeSidebar = function() {
  const friendsActive = mainView.type === 'friends';
  const badge = friendsData.incoming.length
    ? `<span class="friends-badge">${friendsData.incoming.length}</span>` : '';
  let html = `<div class="channel-item friends-nav-item${friendsActive ? ' active' : ''}" data-home-action="friends">
    <span>👥</span><span>Друзья</span>${badge}
  </div>`;
  const totalUnread = Object.values(unreadData).reduce((a, b) => a + b, 0);
  html += `<div class="sidebar-section-label">Личные сообщения${totalUnread > 0 ? ' · ' + totalUnread + ' непрочитанных' : ''}</div>`;
  if (friendsData.friends.length === 0) {
    html += `<div class="friends-empty" style="padding:4px 10px;">Пока нет друзей</div>`;
  } else {
    friendsData.friends.forEach((f) => {
      const active = mainView.type === 'dm' && mainView.userId === f.id;
      const online = !!onlineUsersByUserId[f.id];
      const unread = unreadData[f.id] || 0;
      html += `<div class="channel-item${active ? ' active' : ''}" data-dm-user="${escapeHtml(f.id)}" data-dm-username="${escapeHtml(f.username)}">
        <span class="dm-avatar-mini" style="background:${escapeHtml(f.avatarColor || '')}">${escapeHtml(initials(f.username))}</span>
        <span>${escapeHtml(f.username)}</span>
        ${unread > 0 ? `<span class="dm-unread-badge">${unread}</span>` : (online ? '<span class="online-dot"></span>' : '')}
      </div>`;
    });
  }
  channelsList.innerHTML = html;
};

const _origOpenDm = openDm;
openDm = function(userId, username) {
  _origOpenDm(userId, username);
  markDmAsRead(userId);
};

socket.on('dm-message', (msg) => {
  const otherId = msg.fromUserId === me.id ? msg.toUserId : msg.fromUserId;
  if (mainView.type === 'dm' && mainView.userId === otherId) {
    renderMessage(msg);
    scrollMessagesToBottom();
    markDmAsRead(otherId);
  } else if (msg.fromUserId !== me.id) {
    loadUnreadMessages();
  }
});

socket.on('connect', () => { loadUnreadMessages(); });

// ============================================================
//  14. ПРИВЯЗКА ПОЧТЫ
// ============================================================
async function loadEmailStatus() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const data = await res.json();
    updateEmailUI(data.email, data.emailVerified);
  } catch (err) {}
}

function updateEmailUI(email, verified) {
  emailError.classList.add('hidden');
  emailError.style.color = '';
  if (email && verified) {
    emailStatus.textContent = '✓ Почта привязана: ' + email;
    emailStatus.className = 'email-status verified';
    emailBindRow.classList.add('hidden');
    emailVerifyRow.classList.add('hidden');
    emailUnbindBtn.classList.remove('hidden');
  } else {
    emailStatus.textContent = 'Почта не привязана';
    emailStatus.className = 'email-status unverified';
    emailBindRow.classList.remove('hidden');
    emailVerifyRow.classList.add('hidden');
    emailUnbindBtn.classList.add('hidden');
  }
}

emailBindBtn.addEventListener('click', async () => {
  emailError.classList.add('hidden');
  const email = emailInput.value.trim();
  if (!email) { emailError.textContent = 'Введите email'; emailError.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/email/bind', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) { emailError.textContent = data.error || 'Ошибка'; emailError.classList.remove('hidden'); return; }
    emailBindRow.classList.add('hidden');
    emailVerifyRow.classList.remove('hidden');
    emailCodeInput.focus();
    if (data.devCode) {
      emailError.textContent = 'Тестовый режим. Код: ' + data.devCode;
      emailError.style.color = 'var(--accent)';
      emailError.classList.remove('hidden');
    }
  } catch (err) { emailError.textContent = 'Ошибка связи'; emailError.classList.remove('hidden'); }
});

emailVerifyBtn.addEventListener('click', async () => {
  emailError.classList.add('hidden');
  emailError.style.color = '';
  const code = emailCodeInput.value.trim();
  if (!code) { emailError.textContent = 'Введите код'; emailError.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/email/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) { emailError.textContent = data.error || 'Ошибка'; emailError.classList.remove('hidden'); return; }
    updateEmailUI(data.email, true);
    emailCodeInput.value = '';
  } catch (err) { emailError.textContent = 'Ошибка связи'; emailError.classList.remove('hidden'); }
});

emailUnbindBtn.addEventListener('click', async () => {
  if (!confirm('Отвязать почту? Вход будет без кода подтверждения.')) return;
  try {
    const res = await fetch('/api/email/unbind', { method: 'POST' });
    if (res.ok) updateEmailUI(null, false);
  } catch (err) {}
});

const _origOpenProfileModal = openProfileModal;
openProfileModal = function() {
  _origOpenProfileModal();
  loadEmailStatus();
};

// ============================================================
//  15. ДЕМОНСТРАЦИЯ ЭКРАНА
// ============================================================
screenShareBtn.addEventListener('click', async () => {
  if (isSharingScreen) { stopScreenShare(); return; }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    isSharingScreen = true;
    screenShareBtn.classList.add('active');
    if (peerConnection && localStream) {
      const videoTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(videoTrack);
      else peerConnection.addTrack(videoTrack, screenStream);
    }
    const screenVideo = document.createElement('video');
    screenVideo.id = 'screen-share-video';
    screenVideo.srcObject = screenStream;
    screenVideo.autoplay = true;
    screenVideo.muted = true;
    document.querySelector('.video-stage').appendChild(screenVideo);
    const label = document.createElement('div');
    label.className = 'screen-share-label';
    label.id = 'screen-share-label';
    label.textContent = 'Демонстрация экрана';
    document.querySelector('.video-stage').appendChild(label);
    if (remotePeerId) socket.emit('screen-share-start', { to: remotePeerId });
    screenStream.getVideoTracks()[0].addEventListener('ended', stopScreenShare);
  } catch (err) { console.error('Screen share error:', err); }
});

function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  isSharingScreen = false;
  screenShareBtn.classList.remove('active');
  const sv = document.getElementById('screen-share-video'); if (sv) sv.remove();
  const sl = document.getElementById('screen-share-label'); if (sl) sl.remove();
  if (peerConnection && localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(videoTrack);
    }
  }
  if (remotePeerId) socket.emit('screen-share-stop', { to: remotePeerId });
}

socket.on('screen-share-start', () => { callStatus.textContent = 'Собеседник демонстрирует экран'; });
socket.on('screen-share-stop', () => { callStatus.textContent = 'на связи'; });

const _origEndCall = endCall;
endCall = function(notifyPeer) {
  if (isSharingScreen) stopScreenShare();
  _origEndCall(notifyPeer);
};

// ============================================================
//  16. КОНТЕКСТНОЕ МЕНЮ И УПРАВЛЕНИЕ
// ============================================================
let ctxMenuEl = null;
function showCtxMenu(x, y, items) {
  hideCtxMenu();
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.className = 'ctx-menu';
  ctxMenuEl.style.left = x + 'px';
  ctxMenuEl.style.top = y + 'px';
  items.forEach((item) => {
    if (item.divider) { const d = document.createElement('div'); d.className = 'ctx-menu-divider'; ctxMenuEl.appendChild(d); return; }
    const el = document.createElement('div');
    el.className = 'ctx-menu-item' + (item.danger ? ' danger' : '');
    el.textContent = item.label;
    el.addEventListener('click', () => { hideCtxMenu(); item.action(); });
    ctxMenuEl.appendChild(el);
  });
  document.body.appendChild(ctxMenuEl);
}
function hideCtxMenu() { if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; } }
document.addEventListener('click', hideCtxMenu);

document.addEventListener('contextmenu', (e) => {
  const si = e.target.closest('.server-icon:not(.home-icon):not(.add-server-icon):not(.add-group-icon)');
  if (si) {
    e.preventDefault();
    const idx = Array.from(serverIconsEl.querySelectorAll('.server-icon')).indexOf(si);
    if (idx >= 0 && serversData[idx]) {
      const srv = serversData[idx];
      const isOwner = srv.ownerId === me.id;
      showCtxMenu(e.clientX, e.clientY, isOwner ? [
        { label: '✏️ Редактировать', action: () => editServer(srv) },
        { label: '👥 Добавить участника', action: () => addServerMember(srv) },
        { divider: true },
        { label: '🗑️ Удалить сервер', danger: true, action: () => deleteServer(srv) },
      ] : [
        { label: '📋 Копировать код', action: () => navigator.clipboard?.writeText(srv.inviteCode) },
        { divider: true },
        { label: '🚪 Покинуть сервер', danger: true, action: () => leaveServer(srv) },
      ]);
    }
    return;
  }
  const gi = e.target.closest('.group-icon');
  if (gi) {
    e.preventDefault();
    const idx = Array.from(groupIconsEl.querySelectorAll('.server-icon')).indexOf(gi);
    if (idx >= 0 && groupsData[idx]) {
      const grp = groupsData[idx];
      const isOwner = grp.ownerId === me.id;
      showCtxMenu(e.clientX, e.clientY, isOwner ? [
        { label: '✏️ Редактировать', action: () => editGroup(grp) },
        { label: '👥 Добавить участника', action: () => addGroupMember(grp) },
        { divider: true },
        { label: '🗑️ Удалить группу', danger: true, action: () => deleteGroup(grp) },
      ] : [{ label: '🚪 Покинуть группу', danger: true, action: () => leaveGroup(grp) }]);
    }
  }
});

async function editServer(srv) {
  const name = prompt('Новое название сервера:', srv.name);
  if (!name?.trim()) return;
  const fd = new FormData(); fd.append('name', name.trim());
  const res = await fetch(`/api/servers/${srv.id}`, { method: 'PUT', body: fd });
  if (!res.ok) { alert((await res.json()).error); return; }
  await loadServers();
}
async function deleteServer(srv) {
  if (!confirm(`Удалить сервер "${srv.name}"?`)) return;
  const res = await fetch(`/api/servers/${srv.id}`, { method: 'DELETE' });
  if (!res.ok) { alert((await res.json()).error); return; }
  await loadServers(); selectHome();
}
async function leaveServer(srv) {
  if (!confirm(`Покинуть сервер "${srv.name}"?`)) return;
  const res = await fetch(`/api/servers/${srv.id}/leave`, { method: 'POST' });
  if (!res.ok) { alert((await res.json()).error); return; }
  await loadServers(); selectHome();
}
async function addServerMember(srv) {
  const u = prompt('Имя пользователя для добавления:');
  if (!u?.trim()) return;
  const res = await fetch(`/api/servers/${srv.id}/members`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u.trim() }),
  });
  if (!res.ok) { alert((await res.json()).error); return; }
  loadServerMembers(srv.id);
}
async function editGroup(grp) {
  const name = prompt('Новое название группы:', grp.name);
  if (!name?.trim()) return;
  const fd = new FormData(); fd.append('name', name.trim());
  const res = await fetch(`/api/groups/${grp.id}`, { method: 'PUT', body: fd });
  if (!res.ok) { alert((await res.json()).error); return; }
  await loadGroups(); selectGroup(grp.id);
}
async function deleteGroup(grp) {
  if (!confirm(`Удалить группу "${grp.name}"?`)) return;
  const res = await fetch(`/api/groups/${grp.id}`, { method: 'DELETE' });
  if (!res.ok) { alert((await res.json()).error); return; }
  await loadGroups(); selectHome();
}
async function leaveGroup(grp) {
  if (!confirm(`Покинуть группу "${grp.name}"?`)) return;
  const res = await fetch(`/api/groups/${grp.id}/leave`, { method: 'POST' });
  if (!res.ok) { alert((await res.json()).error); return; }
  await loadGroups(); selectHome();
}
async function addGroupMember(grp) {
  const u = prompt('Имя друга для добавления:');
  if (!u?.trim()) return;
  const res = await fetch(`/api/groups/${grp.id}/members`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u.trim() }),
  });
  if (!res.ok) { alert((await res.json()).error); return; }
  loadGroupMembers(grp.id);
}

// Удаление каналов
renderServerChannelsSidebar = function(server) {
  const text = server.channels.filter(c => c.type !== 'voice');
  const voice = server.channels.filter(c => c.type === 'voice');
  const isOwner = server.ownerId === me.id;
  let html = `<div class="server-name-header"><h2>${escapeHtml(server.name)}</h2><span class="invite-chip" data-copy-invite="${escapeHtml(server.inviteCode)}">${escapeHtml(server.inviteCode)}</span></div>`;
  if (text.length) {
    html += `<div class="sidebar-section-label">Текстовые каналы</div>`;
    text.forEach(c => {
      const a = mainView.type === 'channel' && mainView.channelId === c.id;
      html += `<div class="channel-item${a ? ' active' : ''}" data-channel-id="${escapeHtml(c.id)}" data-channel-name="${escapeHtml(c.name)}"><span class="hash">#</span><span>${escapeHtml(c.name)}</span>${isOwner ? `<button class="channel-delete-btn" data-del-ch="${escapeHtml(c.id)}" data-srv="${escapeHtml(server.id)}">✕</button>` : ''}</div>`;
    });
  }
  if (voice.length) {
    html += `<div class="sidebar-section-label">Голосовые каналы</div>`;
    voice.forEach(c => {
      html += `<div class="channel-item voice-channel-item" data-voice-channel-id="${escapeHtml(c.id)}" data-voice-channel-name="${escapeHtml(c.name)}"><span class="hash">🔊</span><span>${escapeHtml(c.name)}</span>${isOwner ? `<button class="channel-delete-btn" data-del-ch="${escapeHtml(c.id)}" data-srv="${escapeHtml(server.id)}">✕</button>` : ''}</div>`;
    });
  }
  if (isOwner) html += `<div class="add-channel-btn" data-add-channel="${escapeHtml(server.id)}">+ Добавить канал</div>`;
  channelsList.innerHTML = html;
};

renderGroupChannelsSidebar = function(group) {
  const text = group.channels.filter(c => c.type !== 'voice');
  const voice = group.channels.filter(c => c.type === 'voice');
  const isOwner = group.ownerId === me.id;
  let html = `<div class="server-name-header"><h2>${escapeHtml(group.name)}</h2></div>`;
  if (text.length) {
    html += `<div class="sidebar-section-label">Текстовые каналы</div>`;
    text.forEach(c => {
      const a = mainView.type === 'group-channel' && mainView.channelId === c.id;
      html += `<div class="channel-item${a ? ' active' : ''}" data-group-channel-id="${escapeHtml(c.id)}" data-group-id="${escapeHtml(group.id)}" data-channel-name="${escapeHtml(c.name)}"><span class="hash">#</span><span>${escapeHtml(c.name)}</span>${isOwner ? `<button class="channel-delete-btn" data-del-gch="${escapeHtml(c.id)}" data-grp="${escapeHtml(group.id)}">✕</button>` : ''}</div>`;
    });
  }
  if (voice.length) {
    html += `<div class="sidebar-section-label">Голосовые каналы</div>`;
    voice.forEach(c => {
      html += `<div class="channel-item voice-channel-item" data-voice-channel-id="${escapeHtml(c.id)}" data-voice-channel-name="${escapeHtml(c.name)}"><span class="hash">🔊</span><span>${escapeHtml(c.name)}</span>${isOwner ? `<button class="channel-delete-btn" data-del-gch="${escapeHtml(c.id)}" data-grp="${escapeHtml(group.id)}">✕</button>` : ''}</div>`;
    });
  }
  if (isOwner) html += `<div class="add-channel-btn" data-add-group-channel="${escapeHtml(group.id)}">+ Добавить канал</div>`;
  channelsList.innerHTML = html;
};

channelsList.addEventListener('click', async (e) => {
  const dCh = e.target.closest('[data-del-ch]');
  if (dCh) {
    e.stopPropagation();
    if (!confirm('Удалить канал?')) return;
    const res = await fetch(`/api/servers/${dCh.dataset.srv}/channels/${dCh.dataset.delCh}`, { method: 'DELETE' });
    if (!res.ok) alert((await res.json()).error); else await loadServers();
    return;
  }
  const dGch = e.target.closest('[data-del-gch]');
  if (dGch) {
    e.stopPropagation();
    if (!confirm('Удалить канал?')) return;
    const res = await fetch(`/api/groups/${dGch.dataset.grp}/channels/${dGch.dataset.delGch}`, { method: 'DELETE' });
    if (!res.ok) alert((await res.json()).error); else { await loadGroups(); selectGroup(dGch.dataset.grp); }
    return;
  }
}, true);

socket.on('server-deleted', ({ serverId }) => { if (selectedRail === serverId) selectHome(); loadServers(); });
socket.on('group-deleted', ({ groupId }) => { if (selectedRail === groupId) selectHome(); loadGroups(); });

// ============================================================
//  17. УПРАВЛЕНИЕ УЧАСТНИКАМИ (исключение)
// ============================================================
renderMembersList = function(members, title) {
  const server = serversData.find(s => s.id === selectedRail);
  const group = groupsData.find(g => g.id === selectedRail);
  const isOwner = (server && server.ownerId === me.id) || (group && group.ownerId === me.id);
  const etype = server ? 'server' : 'group';
  const eid = server ? server.id : (group ? group.id : null);
  usersColTitle.textContent = title + ' — ' + members.length;
  usersList.innerHTML = '';
  members.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'user-item';
    const ah = m.avatar
      ? `<div class="avatar"><img src="${escapeHtml(m.avatar)}" />${m.isOnline ? '<span class="online-dot"></span>' : ''}</div>`
      : `<div class="avatar" style="background:${escapeHtml(m.avatarColor || '')}">${escapeHtml(initials(m.username))}${m.isOnline ? '<span class="online-dot"></span>' : ''}</div>`;
    let acts = `<button class="icon-btn" data-profile="${escapeHtml(m.id)}">👤</button>`;
    if (isOwner && m.id !== me.id) acts += `<button class="icon-btn danger-variant" data-kick="${escapeHtml(m.id)}" data-etype="${etype}" data-eid="${escapeHtml(eid)}">✕</button>`;
    el.innerHTML = `${ah}<div class="user-name" data-user-id="${escapeHtml(m.id)}">${escapeHtml(m.username)}${m.isOwner ? ' 👑' : ''}</div><div class="call-icons">${acts}</div>`;
    el.querySelector('[data-profile]').addEventListener('click', () => viewProfile(m.id));
    el.querySelector('.user-name').addEventListener('click', () => viewProfile(m.id));
    const kb = el.querySelector('[data-kick]');
    if (kb) kb.addEventListener('click', async () => {
      if (!confirm(`Исключить ${m.username}?`)) return;
      const url = kb.dataset.etype === 'server' ? `/api/servers/${kb.dataset.eid}/members/${m.id}` : `/api/groups/${kb.dataset.eid}/members/${m.id}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) alert((await res.json()).error);
      else { if (kb.dataset.etype === 'server') loadServerMembers(kb.dataset.eid); else loadGroupMembers(kb.dataset.eid); }
    });
    usersList.appendChild(el);
  });
};

friendsPanel.addEventListener('click', async (e) => {
  const profileEl = e.target.closest('[data-profile]');
  if (profileEl && !e.target.closest('button')) {
    viewProfile(profileEl.dataset.profile);
    return;
  }

  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'accept' || action === 'decline') {
    await fetch('/api/friends/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendshipId: id, action }),
    });
    loadFriends();
  } else if (action === 'cancel' || action === 'remove') {
    await fetch(`/api/friends/${id}`, { method: 'DELETE' });
    loadFriends();
  } else if (action === 'call-voice' || action === 'call-video') {
    const target = onlineUsersByUserId[id];
    if (!target) return;
    startCall(target.userId, target.username, action === 'call-voice' ? 'voice' : 'video');
  } else if (action === 'message') {
    openDm(id, btn.dataset.username);
  }
});

addFriendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = addFriendInput.value.trim();
  if (!username) return;
  friendRequestError.classList.add('hidden');

  try {
    const res = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!res.ok) {
      friendRequestError.textContent = data.error || 'Не удалось отправить заявку';
      friendRequestError.classList.remove('hidden');
      return;
    }
    addFriendInput.value = '';
    loadFriends();
  } catch (err) {
    friendRequestError.textContent = 'Не удалось связаться с сервером';
    friendRequestError.classList.remove('hidden');
  }
});

socket.on('friend-request', () => loadFriends());
socket.on('friend-accepted', () => { loadFriends(); loadStories(); });
socket.on('friend-declined', () => loadFriends());
socket.on('friend-removed', () => { loadFriends(); loadStories(); });

// ============================================================
//  8. ПРОФИЛЬ (редактор)
// ============================================================
profileBtn.addEventListener('click', openProfileModal);

function openProfileModal() {
  profileModal.classList.remove('hidden');
  profileError.classList.add('hidden');
  editUsername.value = me.username;
  editStatus.value = me.status || '';
  editBio.value = me.bio || '';
  setAvatar(editAvatarPreview, me);
  editBannerPreview.style.backgroundImage = me.banner ? `url(${me.banner})` : '';
}

closeProfileModalBtn.addEventListener('click', () => profileModal.classList.add('hidden'));

avatarUploadBtn.addEventListener('click', () => avatarFile.click());
avatarFile.addEventListener('change', async () => {
  const file = avatarFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const res = await fetch('/api/profile/avatar', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { profileError.textContent = data.error || 'Ошибка'; profileError.classList.remove('hidden'); return; }
    me.avatar = data.avatar;
    setAvatar(editAvatarPreview, me);
    setAvatar(meAvatar, me);
  } catch (err) {
    profileError.textContent = 'Ошибка загрузки';
    profileError.classList.remove('hidden');
  }
});

bannerUploadBtn.addEventListener('click', () => bannerFile.click());
bannerFile.addEventListener('change', async () => {
  const file = bannerFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('banner', file);

  try {
    const res = await fetch('/api/profile/banner', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { profileError.textContent = data.error || 'Ошибка'; profileError.classList.remove('hidden'); return; }
    me.banner = data.banner;
    editBannerPreview.style.backgroundImage = `url(${me.banner})`;
  } catch (err) {
    profileError.textContent = 'Ошибка загрузки';
    profileError.classList.remove('hidden');
  }
});

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  profileError.classList.add('hidden');

  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: editUsername.value,
        status: editStatus.value,
        bio: editBio.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) { profileError.textContent = data.error || 'Ошибка'; profileError.classList.remove('hidden'); return; }
    me = data;
    setAvatar(meAvatar, me);
    meName.textContent = me.username;
    meStatus.textContent = me.status || 'В сети';
    profileModal.classList.add('hidden');
  } catch (err) {
    profileError.textContent = 'Ошибка сохранения';
    profileError.classList.remove('hidden');
  }
});

// ============================================================
//  9. ПРОСМОТР ЧУЖОГО ПРОФИЛЯ
// ============================================================
async function viewProfile(userId) {
  if (userId === me.id) { openProfileModal(); return; }

  try {
    const res = await fetch(`/api/users/${userId}`);
    if (!res.ok) return;
    const user = await res.json();

    setAvatar(viewAvatar, user);
    viewBanner.style.backgroundImage = user.banner ? `url(${user.banner})` : '';
    viewUsername.textContent = user.username;
    viewStatus.textContent = user.status ? '«' + user.status + '»' : '';
    viewOnline.textContent = user.isOnline ? '🟢 В сети' : '⚫ Не в сети';
    viewOnline.style.color = user.isOnline ? 'var(--accept)' : 'var(--text-muted)';
    viewBio.textContent = user.bio || '';
    viewBio.style.display = user.bio ? 'block' : 'none';

    const created = new Date(user.createdAt).toLocaleDateString('ru-RU');
    viewMeta.textContent = 'На Волна с ' + created;

    let actions = '';
    if (user.isFriend) {
      actions += `<button class="btn-primary" id="vp-message">💬 Написать</button>`;
      if (user.isOnline) {
        actions += `<button class="btn-secondary" id="vp-call">🎙️ Позвонить</button>`;
        actions += `<button class="btn-secondary" id="vp-video">📹 Видеозвонок</button>`;
      }
    } else {
      actions += `<button class="btn-primary" id="vp-add-friend">➕ Добавить в друзья</button>`;
    }
    viewActions.innerHTML = actions;

    viewProfileModal.classList.remove('hidden');

    const msgBtn = document.getElementById('vp-message');
    if (msgBtn) msgBtn.addEventListener('click', () => {
      viewProfileModal.classList.add('hidden');
      if (selectedRail !== 'home') selectHome();
      openDm(userId, user.username);
    });

    const callBtn = document.getElementById('vp-call');
    if (callBtn) callBtn.addEventListener('click', () => {
      viewProfileModal.classList.add('hidden');
      startCall(userId, user.username, 'voice');
    });

    const videoBtn = document.getElementById('vp-video');
    if (videoBtn) videoBtn.addEventListener('click', () => {
      viewProfileModal.classList.add('hidden');
      startCall(userId, user.username, 'video');
    });

    const addBtn = document.getElementById('vp-add-friend');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const r = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username }),
      });
      if (r.ok) {
        addBtn.textContent = '✓ Заявка отправлена';
        addBtn.disabled = true;
        loadFriends();
      }
    });
  } catch (err) {}
}

closeViewProfileBtn.addEventListener('click', () => viewProfileModal.classList.add('hidden'));

// Кнопки в шапке чата (DM)
dmCallBtn.addEventListener('click', () => {
  if (mainView.type === 'dm') startCall(mainView.userId, mainView.username, 'voice');
});
dmVideoBtn.addEventListener('click', () => {
  if (mainView.type === 'dm') startCall(mainView.userId, mainView.username, 'video');
});
dmProfileBtn.addEventListener('click', () => {
  if (mainView.type === 'dm') viewProfile(mainView.userId);
});

// ============================================================
//  10. СТОРИС
// ============================================================
async function loadStories() {
  try {
    const res = await fetch('/api/stories');
    if (!res.ok) return;
    storiesData = await res.json();
    renderStoriesBar();
  } catch (err) {}
}

function renderStoriesBar() {
  if (selectedRail !== 'home') { storiesBar.classList.add('hidden'); return; }
  storiesBar.classList.remove('hidden');

  let html = `<div class="story-item add-story" id="add-story-btn"><div class="story-avatar">+</div><span>Добавить</span></div>`;
  storiesData.forEach((group, idx) => {
    const avatarHtml = group.avatar
      ? `<div class="story-avatar"><img src="${escapeHtml(group.avatar)}" /></div>`
      : `<div class="story-avatar" style="background:${escapeHtml(group.avatarColor || '')}">${escapeHtml(initials(group.username))}</div>`;
    html += `<div class="story-item" data-story-user="${idx}">${avatarHtml}<span>${escapeHtml(group.username)}</span></div>`;
  });
  storiesBar.innerHTML = html;

  document.getElementById('add-story-btn').addEventListener('click', addStory);
  storiesBar.querySelectorAll('[data-story-user]').forEach((el) => {
    el.addEventListener('click', () => openStoryViewer(parseInt(el.dataset.storyUser)));
  });
}

function addStory() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('media', file);
    try {
      const res = await fetch('/api/stories', { method: 'POST', body: formData });
      if (res.ok) loadStories();
      else { const d = await res.json(); alert(d.error || 'Ошибка'); }
    } catch (err) { alert('Ошибка загрузки'); }
  });
  input.click();
}

function openStoryViewer(userIndex) {
  storyState.userIndex = userIndex;
  storyState.storyIndex = 0;
  storyViewer.classList.remove('hidden');
  showStory();
}

function showStory() {
  const group = storiesData[storyState.userIndex];
  if (!group) { closeStory(); return; }
  const story = group.stories[storyState.storyIndex];
  if (!story) { closeStory(); return; }

  setAvatar(storyAvatar, group);
  storyUsername.textContent = group.username;
  storyTime.textContent = timeAgo(story.createdAt);

  storyContent.innerHTML = '';
  if (story.type === 'video') {
    const video = document.createElement('video');
    video.src = story.media;
    video.autoplay = true;
    video.controls = false;
    storyContent.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = story.media;
    storyContent.appendChild(img);
  }

  // прогресс-бары
  storyProgress.innerHTML = group.stories.map((_, i) =>
    `<div class="progress-bar${i === storyState.storyIndex ? ' active' : i < storyState.storyIndex ? ' done' : ''}"></div>`
  ).join('');

  // авто-переключение
  clearTimeout(storyState.timer);
  storyState.timer = setTimeout(() => nextStory(), story.type === 'video' ? 15000 : 5000);
}

function nextStory() {
  const group = storiesData[storyState.userIndex];
  if (!group) return;
  if (storyState.storyIndex < group.stories.length - 1) {
    storyState.storyIndex++;
  } else if (storyState.userIndex < storiesData.length - 1) {
    storyState.userIndex++;
    storyState.storyIndex = 0;
  } else {
    closeStory();
    return;
  }
  showStory();
}

function prevStory() {
  if (storyState.storyIndex > 0) {
    storyState.storyIndex--;
  } else if (storyState.userIndex > 0) {
    storyState.userIndex--;
    const g = storiesData[storyState.userIndex];
    storyState.storyIndex = g.stories.length - 1;
  }
  showStory();
}

function closeStory() {
  storyViewer.classList.add('hidden');
  clearTimeout(storyState.timer);
  storyContent.innerHTML = '';
}

closeStoryBtn.addEventListener('click', closeStory);
storyNextBtn.addEventListener('click', nextStory);
storyPrevBtn.addEventListener('click', prevStory);

socket.on('story-new', () => loadStories());

// ============================================================
//  11. ЗВОНКИ 1-на-1 (по userId)
// ============================================================
function createPeerConnection(targetUserId) {
  const pc = new RTCPeerConnection(ICE_SERVERS);

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('ice-candidate', { to: targetUserId, candidate: event.candidate });
  };
  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    callStatus.textContent = 'на связи';
  };
  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) endCall(false);
  };
  return pc;
}

async function startCall(targetUserId, targetName, callType) {
  if (peerConnection) { alert('Вы уже в звонке'); return; }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
  } catch (err) {
    alert('Нет доступа к микрофону/камере: ' + err.message);
    return;
  }

  currentCallType = callType;
  remotePeerId = targetUserId;
  openCallUI(targetName, callType);

  peerConnection = createPeerConnection(targetUserId);
  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit('call-user', { to: targetUserId, offer, callType });
  callStatus.textContent = 'вызываем…';
}

socket.on('incoming-call', ({ from, fromSocketId, username, avatar, offer, callType }) => {
  if (peerConnection) { socket.emit('reject-call', { to: from }); return; }
  pendingOffer = offer;
  remotePeerId = from;
  currentCallType = callType;

  incomingName.textContent = username;
  incomingType.textContent = callType === 'video' ? 'видеозвонок…' : 'голосовой звонок…';
  if (avatar) {
    incomingAvatar.innerHTML = `<img src="${escapeHtml(avatar)}" />`;
    incomingAvatar.style.background = '';
  } else {
    incomingAvatar.innerHTML = '';
    incomingAvatar.style.background = 'linear-gradient(135deg, var(--accent), var(--violet))';
    incomingAvatar.textContent = initials(username);
  }
  incomingCallEl.classList.remove('hidden');
});

acceptBtn.addEventListener('click', async () => {
  incomingCallEl.classList.add('hidden');
  const targetUserId = remotePeerId;
  const targetName = incomingName.textContent;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: currentCallType === 'video' });
  } catch (err) {
    alert('Нет доступа к микрофону/камере: ' + err.message);
    socket.emit('reject-call', { to: targetUserId });
    resetCallState();
    return;
  }

  openCallUI(targetName, currentCallType);

  peerConnection = createPeerConnection(targetUserId);
  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

  await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit('answer-call', { to: targetUserId, answer });
  callStatus.textContent = 'на связи';
});

rejectBtn.addEventListener('click', () => {
  socket.emit('reject-call', { to: remotePeerId });
  incomingCallEl.classList.add('hidden');
  resetCallState();
});

socket.on('call-answered', async ({ answer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('call-rejected', () => {
  callStatus.textContent = 'звонок отклонён';
  setTimeout(() => endCall(false), 1000);
});

socket.on('call-ended', () => endCall(false));

socket.on('ice-candidate', async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {}
});

function openCallUI(name, callType) {
  callWithName.textContent = name;
  callStatus.textContent = 'соединение…';
  localVideo.srcObject = localStream;
  remoteVideo.srcObject = null;
  toggleCamBtn.style.display = callType === 'video' ? 'flex' : 'none';
  localVideo.style.display = callType === 'video' ? 'block' : 'none';
  callOverlay.classList.remove('hidden');
}

toggleMicBtn.addEventListener('click', () => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleMicBtn.classList.toggle('off', !track.enabled);
  toggleMicBtn.textContent = track.enabled ? '🎙️' : '🔇';
});

toggleCamBtn.addEventListener('click', () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleCamBtn.classList.toggle('off', !track.enabled);
});

hangupBtn.addEventListener('click', () => endCall(true));

function endCall(notifyPeer) {
  if (notifyPeer && remotePeerId) socket.emit('end-call', { to: remotePeerId });
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  callOverlay.classList.add('hidden');
  incomingCallEl.classList.add('hidden');
  resetCallState();
}

function resetCallState() {
  peerConnection = null;
  localStream = null;
  remotePeerId = null;
  pendingOffer = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  toggleMicBtn.classList.remove('off');
  toggleCamBtn.classList.remove('off');
  toggleMicBtn.textContent = '🎙️';
}

// ============================================================
//  12. ГОЛОСОВЫЕ КАНАЛЫ (mesh WebRTC)
// ============================================================
async function joinVoiceChannel(channelId, channelName) {
  if (voiceChannelId) leaveVoiceChannel();

  try {
    voiceLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('Нет доступа к микрофону: ' + err.message);
    return;
  }

  voiceChannelId = channelId;
  voiceChannelName.textContent = channelName;
  voicePanel.classList.remove('hidden');

  socket.emit('join-voice-channel', channelId);
}

function leaveVoiceChannel() {
  if (voiceChannelId) socket.emit('leave-voice-channel');
  Object.values(voicePeerConnections).forEach((pc) => pc.close());
  voicePeerConnections = {};
  if (voiceLocalStream) voiceLocalStream.getTracks().forEach((t) => t.stop());
  voiceLocalStream = null;
  voiceChannelId = null;
  voicePanel.classList.add('hidden');
}

leaveVoiceBtn.addEventListener('click', leaveVoiceChannel);

socket.on('voice-channel-members', ({ channelId, members }) => {
  if (channelId !== voiceChannelId) return;
  renderVoiceParticipants(members);

  // установить соединение с теми, кого ещё нет
  members.forEach((m) => {
    if (m.userId !== me.id && !voicePeerConnections[m.userId]) {
      createVoicePeerConnection(m.userId, m.socketId, true);
    }
  });
});

socket.on('voice-user-joined', ({ channelId, userId, username, socketId }) => {
  if (channelId !== voiceChannelId) return;
  // новый участник — он сам инициирует, мы только отвечаем
});

function createVoicePeerConnection(userId, socketId, isInitiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  voicePeerConnections[userId] = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('voice-ice', { toSocketId: socketId, candidate: event.candidate });
  };
  pc.ontrack = (event) => {
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
  };

  if (voiceLocalStream) {
    voiceLocalStream.getTracks().forEach((track) => pc.addTrack(track, voiceLocalStream));
  }

  if (isInitiator) {
    pc.createOffer().then((offer) => {
      pc.setLocalDescription(offer);
      socket.emit('voice-offer', { toUserId: userId, offer });
    });
  }
}

socket.on('voice-offer', ({ fromUserId, fromSocketId, offer }) => {
  if (!voiceChannelId) return;
  if (voicePeerConnections[fromUserId]) return;

  const pc = new RTCPeerConnection(ICE_SERVERS);
  voicePeerConnections[fromUserId] = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('voice-ice', { toSocketId: fromSocketId, candidate: event.candidate });
  };
  pc.ontrack = (event) => {
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
  };

  if (voiceLocalStream) {
    voiceLocalStream.getTracks().forEach((track) => pc.addTrack(track, voiceLocalStream));
  }

  pc.setRemoteDescription(new RTCSessionDescription(offer));
  pc.createAnswer().then((answer) => {
    pc.setLocalDescription(answer);
    socket.emit('voice-answer', { toSocketId: fromSocketId, answer });
  });
});

socket.on('voice-answer', ({ fromSocketId, answer }) => {
  // найти PC по socketId
  for (const [uid, pc] of Object.entries(voicePeerConnections)) {
    if (pc.connectionState === 'connecting') {
      pc.setRemoteDescription(new RTCSessionDescription(answer));
      break;
    }
  }
});

socket.on('voice-ice', ({ fromSocketId, candidate }) => {
  Object.values(voicePeerConnections).forEach((pc) => {
    try { pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
  });
});

socket.on('voice-user-left', ({ channelId, userId }) => {
  if (channelId !== voiceChannelId) return;
  if (voicePeerConnections[userId]) {
    voicePeerConnections[userId].close();
    delete voicePeerConnections[userId];
  }
  // обновить список участников
  socket.emit('join-voice-channel', channelId); // перезапросить список
});

socket.on('voice-channel-left', () => {
  Object.values(voicePeerConnections).forEach((pc) => pc.close());
  voicePeerConnections = {};
});

function renderVoiceParticipants(members) {
  voiceParticipants.innerHTML = members.map((m) => {
    const avatarHtml = m.avatar
      ? `<div class="avatar"><img src="${escapeHtml(m.avatar)}" /></div>`
      : `<div class="avatar" style="background:${escapeHtml(m.avatarColor || '')}">${escapeHtml(initials(m.username))}</div>`;
    return `<div class="voice-participant">${avatarHtml}<span>${escapeHtml(m.username)}${m.userId === me.id ? ' (вы)' : ''}</span><span class="voice-indicator">🔊</span></div>`;
  }).join('');
}