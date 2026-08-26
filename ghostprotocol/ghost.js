(function () {
  const RELAY_BASE = 'https://globe-qwen-relay.digitalcomputermail.workers.dev';
  const API_BASE = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? '' : RELAY_BASE;
  const sessionKey = 'ghostprotocol:session:v1';

  const screen = document.getElementById('screen');
  const form = document.getElementById('commandForm');
  const input = document.getElementById('commandInput');
  const fileInput = document.getElementById('fileInput');
  const cameraInput = document.getElementById('cameraInput');
  const connectionState = document.getElementById('connectionState');
  const sessionState = document.getElementById('sessionState');

  const state = {
    account: null,
    files: [],
    posts: []
  };

  function write(text = '', className = '') {
    const line = document.createElement('div');
    line.className = `line ${className}`.trim();
    line.textContent = text;
    screen.appendChild(line);
    screen.scrollTop = screen.scrollHeight;
  }

  function clear() {
    screen.innerHTML = '';
  }

  function token() {
    return localStorage.getItem(sessionKey) || '';
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const auth = token();
    if (auth) headers['X-ID-Session'] = auth;
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
  }

  function help() {
    write('help');
    write('Commands:');
    write('  help');
    write('  sign-in');
    write('  sign-up');
    if (state.account) {
      write('  menu');
      write('  upload');
      write('  mydatabase');
      write('  camera');
      write('  board');
      write('  logout');
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
    write('1) upload');
    write('2) MyDatabase');
    write('3) use camera');
    write('4) message board');
    write('5) Log out');
    commandButton('upload', 'upload');
    commandButton('MyDatabase', 'mydatabase');
    commandButton('camera', 'camera');
    commandButton('board', 'board');
    commandButton('logout', 'logout');
    write('');
  }

  function requireAccount() {
    if (state.account) return true;
    write('No active session. Use sign-in.', 'error');
    return false;
  }

  function promptLine(question, type = 'text') {
    return new Promise((resolve) => {
      write(question);
      const oldType = input.type;
      input.type = type;
      input.value = '';
      input.focus();
      const handler = (event) => {
        event.preventDefault();
        form.removeEventListener('submit', handler);
        const value = input.value;
        input.value = '';
        input.type = oldType;
        resolve(value);
      };
      form.addEventListener('submit', handler);
    });
  }

  async function signUp() {
    try {
      const email = await promptLine('email address (.com required):');
      const displayName = await promptLine('name chosen:');
      const phone = await promptLine('phone number optional:');
      const password = await promptLine('password:', 'password');
      const data = await api('/api/ghost/register', {
        method: 'POST',
        body: JSON.stringify({ email, display_name: displayName, phone, password })
      });
      localStorage.setItem(sessionKey, data.session_token);
      state.account = data.account;
      updateSession();
      write(`signed up: ${state.account.display_name || state.account.username}`);
      menu();
    } catch (error) {
      write(error.message || 'sign-up failed', 'error');
    }
  }

  async function signIn() {
    try {
      const login = await promptLine('email address or phone number:');
      const password = await promptLine('password:', 'password');
      const data = await api('/api/ghost/login', {
        method: 'POST',
        body: JSON.stringify({ login, password })
      });
      localStorage.setItem(sessionKey, data.session_token);
      state.account = data.account;
      updateSession();
      write(`signed in: ${state.account.display_name || state.account.username}`);
      menu();
    } catch (error) {
      write(error.message || 'sign-in failed', 'error');
    }
  }

  function updateSession() {
    sessionState.textContent = state.account ? (state.account.display_name || state.account.username) : 'guest';
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
      headers: { 'X-ID-Session': token() }
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
        const download = document.createElement('button');
        download.className = 'terminal-button';
        download.type = 'button';
        download.textContent = 'download';
        download.addEventListener('click', () => downloadFile(file).catch((error) => write(error.message, 'error')));
        row.appendChild(document.createElement('br'));
        row.appendChild(download);
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

  async function board() {
    if (!requireAccount()) return;
    try {
      const data = await api('/api/board/posts?limit=80');
      state.posts = data.posts || [];
      write(`Message board: ${state.posts.length} entries`);
      state.posts.forEach((post) => {
        const row = document.createElement('div');
        row.className = 'board-row';
        row.textContent = `${post.display_name || post.username || 'user'}: ${post.text || '[file]'}`;
        screen.appendChild(row);
      });
      const text = await promptLine('post to board, or leave blank to cancel:');
      if (!text.trim()) {
        write('board post canceled');
        return;
      }
      await api('/api/board/posts', {
        method: 'POST',
        body: JSON.stringify({ category: 'General', text })
      });
      write('posted');
    } catch (error) {
      write(error.message || 'board unavailable', 'error');
    }
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
    } catch (error) {
      connectionState.textContent = 'offline';
    }
  }

  function run(raw) {
    const command = String(raw || '').trim().toLowerCase();
    if (!command) return;
    write(`> ${command}`);
    if (command === 'help') help();
    else if (command === 'sign-in' || command === 'signin' || command === 'login') void signIn();
    else if (command === 'sign-up' || command === 'signup' || command === 'register') void signUp();
    else if (command === 'menu') menu();
    else if (command === 'upload' || command === '1') void upload();
    else if (command === 'mydatabase' || command === 'database' || command === '2') void myDatabase();
    else if (command === 'camera' || command === 'use camera' || command === '3') void camera();
    else if (command === 'board' || command === 'message board' || command === '4') void board();
    else if (command === 'logout' || command === 'log out' || command === '5') logout();
    else if (command === 'clear') clear();
    else write('unknown command. type help.', 'error');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = input.value;
    input.value = '';
    run(command);
  });

  clear();
  write('GhostProtocol terminal portal');
  write('Type help.');
  help();
  void status();
  void refreshMe();
})();
