(function () {
  const RELAY_BASE = 'https://globe-qwen-relay.digitalcomputermail.workers.dev';
  const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
  const API_BASE = LOCAL_HOSTS.includes(window.location.hostname) ? '' : RELAY_BASE;
  const publicSite = !LOCAL_HOSTS.includes(window.location.hostname);
  const sessionKey = 'digitalcpu:id-session:v1';

  function $(id) {
    return document.getElementById(id);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.includes(',') ? result.split(',', 2)[1] : result);
      };
      reader.onerror = () => reject(reader.error || new Error('File read failed.'));
      reader.readAsDataURL(file);
    });
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = localStorage.getItem(sessionKey) || '';
    if (token) headers['X-ID-Session'] = token;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const contentType = response.headers.get('Content-Type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload && typeof payload === 'object' ? payload.error : payload;
      throw new Error(message || `Request failed: ${response.status}`);
    }
    return payload;
  }

  async function downloadFile(file) {
    const token = localStorage.getItem(sessionKey) || '';
    const response = await fetch(`${API_BASE}/api/id/file?file_id=${encodeURIComponent(file.file_id)}`, {
      headers: { 'X-ID-Session': token }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Download failed: ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name || file.stored_name || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function init() {
    const button = $('accountButton');
    const panel = $('idProfilePanel');
    const closeButton = $('idProfileClose');
    const status = $('idProfileStatus');
    const forms = $('idProfileForms');
    const accountBox = $('idProfileAccount');
    const loginTab = $('idLoginTab');
    const registerTab = $('idRegisterTab');
    const authForm = $('idAuthForm');
    const usernameInput = $('idUsername');
    const passwordInput = $('idPassword');
    const displayNameInput = $('idDisplayName');
    const submitButton = $('idSubmit');
    const profileName = $('idProfileName');
    const profileMeta = $('idProfileMeta');
    const storageMeta = $('idStorageMeta');
    const message = $('idProfileMessage');
    const logoutButton = $('idLogout');
    const refreshFilesButton = $('idRefreshFiles');
    const uploadForm = $('idUploadForm');
    const fileInput = $('idFileInput');
    const folderInput = $('idFolderInput');
    const fileList = $('idFileList');

    if (!button || !panel || !authForm || !fileList) return;

    const state = {
      mode: 'login',
      account: null,
      files: []
    };

    function setMessage(text, isError = false) {
      message.textContent = text;
      message.style.color = isError ? 'rgba(255, 170, 170, 0.95)' : '';
    }

    function setOpen(open) {
      panel.hidden = !open;
      button.classList.toggle('is-active', open);
    }

    function setMode(mode) {
      state.mode = mode;
      const registering = mode === 'register';
      loginTab.classList.toggle('is-active', !registering);
      registerTab.classList.toggle('is-active', registering);
      displayNameInput.hidden = !registering;
      submitButton.textContent = registering ? 'Register' : 'Login';
      passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
      setMessage(registering ? 'Create a name and password for your folder.' : 'Sign in to open your folder.');
    }

    function renderAccount(account) {
      state.account = account || null;
      const signedIn = Boolean(state.account);
      forms.hidden = signedIn;
      accountBox.hidden = !signedIn;
      status.textContent = signedIn ? 'signed in' : publicSite ? 'relay' : 'offline';
      if (!signedIn) {
        profileName.textContent = '--';
        profileMeta.textContent = 'signed out';
        storageMeta.textContent = 'storage --';
        renderFiles([]);
        return;
      }
      profileName.textContent = account.display_name || account.username;
      profileMeta.textContent = account.username;
      storageMeta.textContent = `storage ${formatBytes(account.storage_usage_bytes)}`;
      setMessage('Your local host folder is ready.');
    }

    function renderFiles(files) {
      state.files = Array.isArray(files) ? files : [];
      fileList.innerHTML = '';
      if (!state.files.length) {
        const item = document.createElement('li');
        item.textContent = 'No files in this folder yet.';
        fileList.appendChild(item);
        return;
      }
      for (const file of state.files) {
        const item = document.createElement('li');
        const label = document.createElement('span');
        const open = document.createElement('button');
        const remove = document.createElement('button');
        label.textContent = `${file.name || file.stored_name} - ${formatBytes(file.size)}`;
        label.title = file.path || file.name || '';
        open.type = 'button';
        open.textContent = 'Open';
        open.addEventListener('click', async () => {
          try {
            setMessage(`Opening ${file.name || file.stored_name}...`);
            await downloadFile(file);
            setMessage('Download ready.');
          } catch (error) {
            setMessage(error.message || 'Download failed.', true);
          }
        });
        remove.type = 'button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => deleteFile(file.file_id));
        item.append(label, open, remove);
        fileList.appendChild(item);
      }
    }

    async function refreshMe() {
      const token = localStorage.getItem(sessionKey);
      if (!token) {
        renderAccount(null);
        if (publicSite) setMessage('Start quick-launch on the desktop, then sign in here.');
        return false;
      }
      try {
        const data = await api('/api/id/me');
        renderAccount(data.account);
        await refreshFiles();
        return true;
      } catch (error) {
        localStorage.removeItem(sessionKey);
        renderAccount(null);
        setMessage(error.message || 'Session expired.', true);
        return false;
      }
    }

    async function refreshFiles() {
      if (!state.account) return;
      try {
        const data = await api('/api/id/files');
        renderAccount(data.account || state.account);
        renderFiles(data.files || []);
      } catch (error) {
        setMessage(error.message || 'Could not load files.', true);
      }
    }

    async function deleteFile(fileId) {
      try {
        setMessage('Deleting file...');
        await api('/api/id/files/delete', {
          method: 'POST',
          body: JSON.stringify({ file_id: fileId })
        });
        await refreshFiles();
        setMessage('File deleted.');
      } catch (error) {
        setMessage(error.message || 'Delete failed.', true);
      }
    }

    button.addEventListener('click', () => {
      setOpen(panel.hidden);
      if (!panel.hidden) void refreshMe();
    });

    closeButton?.addEventListener('click', () => setOpen(false));
    loginTab?.addEventListener('click', () => setMode('login'));
    registerTab?.addEventListener('click', () => setMode('register'));
    refreshFilesButton?.addEventListener('click', () => refreshFiles());

    logoutButton?.addEventListener('click', async () => {
      try {
        await api('/api/id/logout', { method: 'POST', body: '{}' });
      } catch (error) {
        console.warn('Logout request failed.', error);
      }
      localStorage.removeItem(sessionKey);
      renderAccount(null);
      setMode('login');
    });

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        setMessage(state.mode === 'register' ? 'Creating account...' : 'Signing in...');
        const data = await api(`/api/id/${state.mode === 'register' ? 'register' : 'login'}`, {
          method: 'POST',
          body: JSON.stringify({
            username: usernameInput.value.trim(),
            password: passwordInput.value,
            display_name: displayNameInput.value.trim()
          })
        });
        localStorage.setItem(sessionKey, data.session_token);
        passwordInput.value = '';
        renderAccount(data.account);
        await refreshFiles();
      } catch (error) {
        setMessage(error.message || 'Account request failed.', true);
      }
    });

    uploadForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        setMessage('Choose a file first.', true);
        return;
      }
      try {
        setMessage(`Uploading ${file.name}...`);
        const contentBase64 = await fileToBase64(file);
        await api('/api/id/files/upload', {
          method: 'POST',
          body: JSON.stringify({
            filename: file.name,
            folder: folderInput.value || 'uploads',
            content_type: file.type || 'application/octet-stream',
            content_base64: contentBase64
          })
        });
        fileInput.value = '';
        await refreshFiles();
        setMessage('Upload complete.');
      } catch (error) {
        setMessage(error.message || 'Upload failed.', true);
      }
    });

    setMode('login');
    void refreshMe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
