(function () {
  const RELAY_BASE = 'https://globe-qwen-relay.digitalcomputermail.workers.dev';
  const API_BASE = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? '' : RELAY_BASE;
  const sessionKey = 'ghostprotocol:session:v1';
  const deviceKey = 'ghostprotocol:device-id:v1';

  const screen = document.getElementById('screen');
  const form = document.getElementById('commandForm');
  const input = document.getElementById('commandInput');
  const fileInput = document.getElementById('fileInput');
  const cameraInput = document.getElementById('cameraInput');
  const connectionState = document.getElementById('connectionState');
  const sessionState = document.getElementById('sessionState');
  const windowMinimize = document.getElementById('windowMinimize');
  const windowRestore = document.getElementById('windowRestore');
  const windowFullscreen = document.getElementById('windowFullscreen');
  const windowClose = document.getElementById('windowClose');

  const state = {
    account: null,
    files: [],
    posts: [],
    fullscreenAttempted: false,
    promptHandler: null,
    controlMode: false,
    boardOpen: false,
    boardElement: null
  };

  function write(text = '', className = '') {
    const line = document.createElement('div');
    line.className = `line ${className}`.trim();
    line.textContent = text;
    screen.appendChild(line);
    autoScroll();
  }

  function clear() {
    screen.innerHTML = '';
  }

  function autoScroll() {
    screen.scrollTop = screen.scrollHeight;
  }

  function commandKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function deviceId() {
    let value = localStorage.getItem(deviceKey);
    if (!value) {
      const random = crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      value = `ghost-${random}`;
      localStorage.setItem(deviceKey, value);
    }
    return value;
  }

  async function enterFullscreen() {
    if (document.fullscreenElement) return true;
    const target = document.documentElement;
    if (!target.requestFullscreen) return false;
    try {
      await target.requestFullscreen({ navigationUI: 'hide' });
      return true;
    } catch (error) {
      return false;
    }
  }

  function activateImmersion() {
    if (state.fullscreenAttempted || document.fullscreenElement) return;
    state.fullscreenAttempted = true;
    void enterFullscreen();
  }

  function token() {
    return localStorage.getItem(sessionKey) || '';
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const auth = token();
    if (auth) headers['X-ID-Session'] = auth;
    headers['X-Device-ID'] = deviceId();
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const type = response.headers.get('Content-Type') || '';
    const payload = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload && typeof payload === 'object' ? payload.error : payload;
      throw new Error(message || `Request failed: ${response.status}`);
    }
    return payload;
  }

  function commandButton(label, command) {
    const button = document.createElement('button');
    button.className = 'terminal-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => run(command));
    screen.appendChild(button);
    autoScroll();
  }

  function inlineButton(label, handler) {
    const button = document.createElement('button');
    button.className = 'terminal-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function help() {
    write('help');
    write('Terminal portal commands:');
    write('  help');
    write('  sign-up        create a terminal profile with name, email, and password');
    write('  sign-in        access an existing terminal profile');
    write('  sign-out       close the active terminal profile');
    if (state.account) {
      write('  menu           show terminal features');
      write('  upload         upload files to your local profile folder');
      write('  uploaded-files open files stored in your local profile folder');
      write('  mydatabase     open files stored in your local profile folder');
      write('  camera         use camera and save to your local profile folder');
      write('  board          open the message board');
      write('  post board     write a new message board post');
      write('  close board    close the message board view');
    } else {
      write('');
      write('Sign in or sign up to access upload, files, camera, and board features.');
    }
    write('');
    commandButton('sign-in', 'sign-in');
    commandButton('sign-up', 'sign-up');
    if (state.account) {
      commandButton('menu', 'menu');
      commandButton('mydatabase', 'mydatabase');
      commandButton('board', 'board');
    }
    write('');
  }

  function menu() {
    if (!state.account) {
      write('Access denied. Use sign-in or sign-up first.', 'error');
      return;
    }
    write(`terminal access granted: ${state.account.display_name || state.account.username}`);
    write('1) upload files');
    write('2) uploaded files / local profile folder');
    write('3) use camera');
    write('4) message board');
    write('5) sign out');
    commandButton('upload', 'upload');
    commandButton('uploaded files', 'uploaded-files');
    commandButton('camera', 'camera');
    commandButton('board', 'board');
    commandButton('post board', 'post-board');
    commandButton('sign out', 'sign-out');
    write('');
  }

  function requireAccount() {
    if (state.account) return true;
    write('No active session. Use sign-in.', 'error');
    return false;
  }

  function writeControlCommands() {
    write('control panel ui access granted');
    write('remote command center ready');
    write(`device id: ${deviceId()}`);
    write('backend gate: owner account + remote-access on + trusted device');
    write('');
    write('system commands:');
    write('  status');
    write('  settings');
    write('  preset balanced');
    write('  preset cpu');
    write('  preset long');
    write('  set-temp <0..2>');
    write('  set-tokens <count>');
    write('  set-context <count>');
    write('  set-gpu-layers <-1|0|count>');
    write('  set-model <path>');
    write('  load-model');
    write('  unload-model');
    write('  fxp3-status');
    write('');
    write('account commands:');
    write('  account-list');
    write('  account-show <user|id>');
    write('  account-set-password <user|id> <new-password>');
    write('  account-ranks');
    write('  account-set-role <user|id> <rank>');
    write('  account-ban <user|id>');
    write('  account-unban <user|id>');
    write('  account-punish <user|id>');
    write('  account-reward <user|id>');
    write('  account-delete <user|id> CONFIRM');
    write('  account-delete <user|id> CONFIRM --delete-files');
    write('  owner accounts cannot be deleted remotely');
    write('');
    write('  exit-control');
  }

  function formatControlValue(value, depth = 0) {
    if (value === null || value === undefined) return '--';
    if (typeof value !== 'object') return String(value);
    const lines = [];
    const indent = '  '.repeat(depth);
    Object.entries(value).forEach(([key, item]) => {
      if (item && typeof item === 'object') {
        lines.push(`${indent}${key}:`);
        lines.push(formatControlValue(item, depth + 1));
      } else {
        lines.push(`${indent}${key}: ${formatControlValue(item, depth + 1)}`);
      }
    });
    return lines.join('\n');
  }

  async function accessControlPanelUi() {
    if (!requireAccount()) return;
    try {
      const data = await api('/api/ghost/control/status');
      state.controlMode = true;
      writeControlCommands();
      if (data.backend) {
        write(`backend: ${data.backend.host}:${data.backend.port}`);
        write(`model: ${data.backend.model_ready ? 'ready' : 'not ready'} / ${data.backend.model}`);
      }
    } catch (error) {
      write(error.message || 'access denied', 'error');
    }
  }

  async function runControlCommand(command) {
    const lowered = command.trim().toLowerCase();
    if (lowered === 'exit-control' || lowered === 'exit control' || lowered === 'exit') {
      state.controlMode = false;
      write('control panel ui access closed');
      return;
    }
    try {
      const data = await api('/api/ghost/control/command', {
        method: 'POST',
        body: JSON.stringify({ command })
      });
      write(data.message || 'command complete');
      if (data.data) write(formatControlValue(data.data));
    } catch (error) {
      write(error.message || 'control command failed', 'error');
    }
  }

  function promptLine(question, type = 'text') {
    return new Promise((resolve) => {
      write(question);
      const oldType = input.type;
      input.type = type;
      input.value = '';
      input.focus();
      state.promptHandler = () => {
        const value = input.value;
        input.value = '';
        input.type = oldType;
        state.promptHandler = null;
        resolve(value);
      };
    });
  }

  async function signUp() {
    try {
      const username = await promptLine('create user name:');
      const email = await promptLine('enter e-mail:');
      const password = await promptLine('create password:', 'password');
      const confirmPassword = await promptLine('enter password again:', 'password');
      if (password !== confirmPassword) {
        write('passwords do not match. account not created.', 'error');
        return;
      }
      const displayName = username;
      const data = await api('/api/ghost/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, display_name: displayName, phone: '', password, device_id: deviceId() })
      });
      localStorage.setItem(sessionKey, data.session_token);
      state.account = data.account;
      updateSession();
      write(`logged in: ${state.account.display_name || state.account.username}`);
      write('terminal features unlocked.');
      menu();
    } catch (error) {
      write(error.message || 'sign-up failed', 'error');
    }
  }

  async function signIn() {
    try {
      const login = await promptLine('user name or e-mail:');
      const password = await promptLine('password:', 'password');
      const data = await api('/api/ghost/login', {
        method: 'POST',
        body: JSON.stringify({ login, password })
      });
      localStorage.setItem(sessionKey, data.session_token);
      state.account = data.account;
      updateSession();
      write(`logged in: ${state.account.display_name || state.account.username}`);
      write('terminal features unlocked.');
      menu();
    } catch (error) {
      write(error.message || 'sign-in failed', 'error');
    }
  }

  function updateSession() {
    if (!state.account) {
      sessionState.textContent = 'guest';
      return;
    }
    sessionState.textContent = state.account.display_name || state.account.username;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function uploadFile(file, folder = 'ghost') {
    const started = await api('/api/id/files/upload/start', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name || 'ghost-upload.bin',
        folder,
        content_type: file.type || 'application/octet-stream',
        size: file.size
      })
    });
    const uploadId = started.upload_id;
    const chunkSize = Number(started.chunk_size || (8 * 1024 * 1024));
    let offset = Number(started.received || 0);
    try {
      while (offset < file.size) {
        const next = Math.min(offset + chunkSize, file.size);
        const chunk = file.slice(offset, next);
        const result = await api(`/api/id/files/upload/chunk?upload_id=${encodeURIComponent(uploadId)}&offset=${offset}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk
        });
        offset = Number(result.received || next);
        write(`upload ${Math.floor((offset / file.size) * 100)}%`);
      }
      return api('/api/id/files/upload/finish', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      });
    } catch (error) {
      await api('/api/id/files/upload/cancel', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      }).catch(() => {});
      throw error;
    }
  }

  function chooseFile(inputElement) {
    return new Promise((resolve) => {
      inputElement.value = '';
      inputElement.onchange = () => resolve(inputElement.files && inputElement.files[0]);
      inputElement.click();
    });
  }

  async function upload() {
    if (!requireAccount()) return;
    const file = await chooseFile(fileInput);
    if (!file) {
      write('upload canceled');
      return;
    }
    try {
      write(`uploading ${file.name}...`);
      const result = await uploadFile(file);
      write(`stored ${result.file.name || result.file.stored_name} (${formatBytes(result.file.size)})`);
    } catch (error) {
      write(error.message || 'upload failed', 'error');
    }
  }

  async function camera() {
    if (!requireAccount()) return;
    const file = await chooseFile(cameraInput);
    if (!file) {
      write('camera canceled');
      return;
    }
    try {
      write('sending camera image...');
      const result = await uploadFile(file, 'camera');
      write(`stored ${result.file.name || result.file.stored_name} (${formatBytes(result.file.size)})`);
    } catch (error) {
      write(error.message || 'camera failed', 'error');
    }
  }

  async function downloadFile(file) {
    const response = await fetch(`${API_BASE}/api/id/file?file_id=${encodeURIComponent(file.file_id)}`, {
      headers: { 'X-ID-Session': token(), 'X-Device-ID': deviceId() }
    });
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name || file.stored_name || 'download';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function isImageFile(file) {
    const type = String(file.content_type || '').toLowerCase();
    const name = String(file.name || file.stored_name || '').toLowerCase();
    return type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|webp)$/.test(name);
  }

  async function viewFile(file, row) {
    if (!isImageFile(file)) {
      write('preview is available for images. use download for this file.', 'error');
      return;
    }
    const existing = row.querySelector('.file-preview');
    if (existing) {
      existing.remove();
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/id/file/fx?file_id=${encodeURIComponent(file.file_id)}`, {
        headers: { 'X-ID-Session': token(), 'X-Device-ID': deviceId() }
      });
      if (!response.ok) throw new Error(`preview failed: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const wrap = document.createElement('div');
      wrap.className = 'file-preview';
      const image = document.createElement('img');
      image.src = url;
      image.alt = file.name || file.stored_name || 'image preview';
      image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      wrap.appendChild(image);
      row.appendChild(wrap);
      autoScroll();
    } catch (error) {
      write(error.message || 'preview failed', 'error');
    }
  }

  async function renameFile(file) {
    const current = file.name || file.stored_name || '';
    const nextName = await promptLine(`rename ${current} to:`);
    if (!nextName.trim()) {
      write('rename canceled');
      return;
    }
    try {
      const result = await api('/api/id/files/rename', {
        method: 'POST',
        body: JSON.stringify({ file_id: file.file_id, name: nextName })
      });
      write(`renamed: ${result.file.name || result.file.stored_name}`);
      await myDatabase();
    } catch (error) {
      write(error.message || 'rename failed', 'error');
    }
  }

  async function sendFileToBoard(file) {
    await api('/api/board/posts', {
      method: 'POST',
      body: JSON.stringify({
        category: 'General',
        text: `GhostProtocol file: ${file.name || file.stored_name}`,
        image_file_id: file.file_id
      })
    });
    write(`sent to board: ${file.name || file.stored_name}`);
  }

  async function fetchBoardImage(entry, container) {
    const imageInfo = entry && (entry.image || entry);
    const fileId = imageInfo && (imageInfo.image_file_id || imageInfo.file_id);
    if (!fileId) return;
    try {
      const response = await fetch(`${API_BASE}/api/board/image?file_id=${encodeURIComponent(fileId)}&fx=1`, {
        headers: { 'X-ID-Session': token(), 'X-Device-ID': deviceId() }
      });
      if (!response.ok) throw new Error(`image unavailable: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const image = document.createElement('img');
      image.src = url;
      image.alt = imageInfo.image_name || imageInfo.file_name || imageInfo.name || 'board image';
      image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      container.appendChild(image);
    } catch (error) {
      const failed = document.createElement('div');
      failed.className = 'line error';
      failed.textContent = error.message || 'image preview failed';
      container.appendChild(failed);
    }
  }

  async function myDatabase() {
    if (!requireAccount()) return;
    try {
      const data = await api('/api/id/files');
      state.files = data.files || [];
      write(`MyDatabase: ${state.files.length} files`);
      if (!state.files.length) {
        write('empty');
        return;
      }
      state.files.forEach((file, index) => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.textContent = `${index + 1}) ${file.name || file.stored_name} / ${formatBytes(file.size)} / ${file.folder}`;
        screen.appendChild(row);
        if (isImageFile(file)) {
          const view = document.createElement('button');
          view.className = 'terminal-button';
          view.type = 'button';
          view.textContent = 'view';
          view.addEventListener('click', () => viewFile(file, row));
          row.appendChild(document.createElement('br'));
          row.appendChild(view);
        } else {
          row.appendChild(document.createElement('br'));
        }
        const download = document.createElement('button');
        download.className = 'terminal-button';
        download.type = 'button';
        download.textContent = 'download';
        download.addEventListener('click', () => downloadFile(file).catch((error) => write(error.message, 'error')));
        row.appendChild(download);
        const rename = document.createElement('button');
        rename.className = 'terminal-button';
        rename.type = 'button';
        rename.textContent = 'rename';
        rename.addEventListener('click', () => renameFile(file));
        row.appendChild(rename);
        const board = document.createElement('button');
        board.className = 'terminal-button';
        board.type = 'button';
        board.textContent = 'send to board';
        board.addEventListener('click', () => sendFileToBoard(file).catch((error) => write(error.message, 'error')));
        row.appendChild(board);
      });
      screen.scrollTop = screen.scrollHeight;
    } catch (error) {
      write(error.message || 'database unavailable', 'error');
    }
  }

  function clearBoardElement() {
    if (state.boardElement) state.boardElement.remove();
    state.boardElement = null;
  }

  function boardSummary(post) {
    const name = post.display_name || post.username || 'user';
    const text = post.text || '[file]';
    const replies = Number(post.reply_count || 0);
    const replyText = replies === 1 ? '1 reply' : `${replies} replies`;
    return `${name}: ${text} (${replyText})`;
  }

  async function refreshBoardPanel() {
    if (!state.boardElement) return;
    const list = state.boardElement.querySelector('.board-panel-list');
    list.textContent = 'loading board...';
    const data = await api('/api/board/posts?limit=80');
    state.posts = data.posts || [];
    list.innerHTML = '';
    if (!state.posts.length) {
      list.textContent = 'no board messages yet';
      autoScroll();
      return;
    }
    state.posts.forEach((post, index) => {
      const row = document.createElement('button');
      row.className = 'board-row';
      row.type = 'button';
      row.textContent = `${index + 1}) ${boardSummary(post)}`;
      row.addEventListener('click', () => openBoardThread(post.post_id, row));
      list.appendChild(row);
    });
    autoScroll();
  }

  async function openBoardThread(postId, row) {
    if (!postId) return;
    const existing = state.boardElement && state.boardElement.querySelector('.board-thread-detail');
    if (existing) existing.remove();
    const detail = document.createElement('div');
    detail.className = 'board-thread-detail';
    detail.textContent = 'opening thread...';
    row.insertAdjacentElement('afterend', detail);
    try {
      const data = await api(`/api/board/thread?post_id=${encodeURIComponent(postId)}`);
      const post = data.post || {};
      const replies = Array.isArray(data.replies) ? data.replies : [];
      detail.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'board-thread-root';
      root.textContent = `${post.display_name || post.username || 'user'}: ${post.text || '[file]'}`;
      detail.appendChild(root);
      await fetchBoardImage(post, root);
      if (replies.length) {
        replies.forEach((reply) => {
          const replyRow = document.createElement('div');
          replyRow.className = 'board-reply';
          replyRow.textContent = `${reply.display_name || reply.username || 'user'}: ${reply.text || '[file]'}`;
          detail.appendChild(replyRow);
          void fetchBoardImage(reply, replyRow);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'line hint';
        empty.textContent = 'no replies yet';
        detail.appendChild(empty);
      }
      detail.appendChild(inlineButton('reply', () => replyToBoardThread(postId)));
      detail.appendChild(inlineButton('close thread', () => detail.remove()));
      autoScroll();
    } catch (error) {
      detail.textContent = error.message || 'thread unavailable';
      detail.classList.add('error');
    }
  }

  async function postBoardMessage() {
    if (!requireAccount()) return;
    try {
      const text = await promptLine('new board post, or leave blank to cancel:');
      const key = commandKey(text);
      if (!text.trim()) {
        write('board post canceled');
        return;
      }
      if (key === 'closeboard' || key === 'boardclose') {
        closeBoard();
        return;
      }
      await api('/api/board/posts', {
        method: 'POST',
        body: JSON.stringify({ category: 'General', text })
      });
      write('posted');
      await refreshBoardPanel();
    } catch (error) {
      write(error.message || 'post failed', 'error');
    }
  }

  async function replyToBoardThread(postId) {
    try {
      const text = await promptLine('reply text, or leave blank to cancel:');
      const key = commandKey(text);
      if (!text.trim()) {
        write('reply canceled');
        return;
      }
      if (key === 'closeboard' || key === 'boardclose') {
        closeBoard();
        return;
      }
      await api('/api/board/replies', {
        method: 'POST',
        body: JSON.stringify({ post_id: postId, text })
      });
      write('reply posted');
      await refreshBoardPanel();
    } catch (error) {
      write(error.message || 'reply failed', 'error');
    }
  }

  async function board() {
    if (!requireAccount()) return;
    try {
      state.boardOpen = true;
      clearBoardElement();
      const panel = document.createElement('div');
      panel.className = 'board-panel';
      const header = document.createElement('div');
      header.className = 'board-panel-header';
      header.textContent = 'Message board';
      header.appendChild(inlineButton('post', () => postBoardMessage()));
      header.appendChild(inlineButton('refresh', () => refreshBoardPanel().catch((error) => write(error.message, 'error'))));
      header.appendChild(inlineButton('close board', () => closeBoard()));
      panel.appendChild(header);
      const list = document.createElement('div');
      list.className = 'board-panel-list';
      panel.appendChild(list);
      screen.appendChild(panel);
      state.boardElement = panel;
      await refreshBoardPanel();
    } catch (error) {
      write(error.message || 'board unavailable', 'error');
    }
  }

  function closeBoard() {
    state.boardOpen = false;
    clearBoardElement();
    write('board closed');
  }

  function logout() {
    localStorage.removeItem(sessionKey);
    state.account = null;
    updateSession();
    write('logged out');
  }

  async function refreshMe() {
    if (!token()) {
      updateSession();
      return;
    }
    try {
      const data = await api('/api/id/me');
      state.account = data.account;
      updateSession();
    } catch (error) {
      localStorage.removeItem(sessionKey);
      state.account = null;
      updateSession();
    }
  }

  async function status() {
    try {
      await api('/api/status');
      connectionState.textContent = 'online';
      return true;
    } catch (error) {
      connectionState.textContent = 'offline';
      return false;
    }
  }

  function run(raw) {
    const rawCommand = String(raw || '').trim();
    const command = rawCommand.toLowerCase();
    const key = commandKey(rawCommand);
    if (!command) return;
    write(`> ${rawCommand}`);
    if (command === 'access control panel ui') {
      void accessControlPanelUi();
      return;
    }
    if (state.controlMode) {
      void runControlCommand(rawCommand);
      return;
    }
    if (command === 'help') help();
    else if (['signin', 'login', 'logon'].includes(key)) void signIn();
    else if (['signup', 'register', 'createaccount', 'createprofile'].includes(key)) void signUp();
    else if (command === 'menu') menu();
    else if (command === 'upload' || command === '1') void upload();
    else if (command === 'mydatabase' || command === 'database' || command === 'uploaded-files' || command === 'files' || command === '2') void myDatabase();
    else if (command === 'camera' || command === 'use camera' || command === '3') void camera();
    else if (command === 'board' || command === 'message board' || command === '4') void board();
    else if (key === 'postboard' || key === 'boardpost') void postBoardMessage();
    else if (key === 'closeboard' || key === 'boardclose') closeBoard();
    else if (['logout', 'signout', 'logoff'].includes(key) || command === '5') logout();
    else if (command === 'clear') clear();
    else if (command === 'full' || command === 'fullscreen' || command === 'immersion') void enterFullscreen();
    else write('unknown command. type help.', 'error');
  }

  document.addEventListener('pointerdown', activateImmersion, { once: true });
  document.addEventListener('keydown', activateImmersion, { once: true });

  windowMinimize?.addEventListener('click', () => {
    document.body.classList.add('terminal-minimized');
  });

  windowRestore?.addEventListener('click', () => {
    document.body.classList.remove('terminal-minimized', 'terminal-closed');
    if (document.fullscreenElement) void document.exitFullscreen();
    input.focus();
  });

  windowFullscreen?.addEventListener('click', () => {
    document.body.classList.remove('terminal-minimized', 'terminal-closed');
    void enterFullscreen();
    input.focus();
  });

  windowClose?.addEventListener('click', () => {
    window.close();
    document.body.classList.add('terminal-closed');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.promptHandler) {
      state.promptHandler();
      return;
    }
    const command = input.value;
    input.value = '';
    run(command);
  });

  clear();
  void status();
  void refreshMe();
})();
