(function () {
  const RELAY_BASE = 'https://globe-qwen-relay.digitalcomputermail.workers.dev';
  const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
  const API_BASE = LOCAL_HOSTS.includes(window.location.hostname) ? '' : RELAY_BASE;
  const publicSite = !LOCAL_HOSTS.includes(window.location.hostname);
  const sessionKey = 'digitalcpu:id-session:v1';
  const deviceKey = 'digitalcpu:device-id:v1';

  function $(id) {
    return document.getElementById(id);
  }

  function deviceId() {
    let value = localStorage.getItem(deviceKey);
    if (!value) {
      const random = crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      value = `web-${random}`;
      localStorage.setItem(deviceKey, value);
    }
    return value;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = localStorage.getItem(sessionKey) || '';
    if (token) headers['X-ID-Session'] = token;
    headers['X-Device-ID'] = deviceId();
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

  function isImageFile(file) {
    const type = String(file.content_type || file.type || '').toLowerCase();
    const name = String(file.name || file.stored_name || '').toLowerCase();
    return type.startsWith('image/') || /\.(avif|gif|jpe?g|png|webp|bmp|svg)$/i.test(name);
  }

  async function fetchFileBlob(file) {
    const token = localStorage.getItem(sessionKey) || '';
    const response = await fetch(`${API_BASE}/api/id/file?file_id=${encodeURIComponent(file.file_id)}`, {
      headers: { 'X-ID-Session': token, 'X-Device-ID': deviceId() }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Download failed: ${response.status}`);
    }
    return response.blob();
  }

  async function downloadFile(file) {
    const blob = await fetchFileBlob(file);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name || file.stored_name || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function uploadFileChunked(file, folder, onProgress) {
    const started = await api('/api/id/files/upload/start', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        folder: folder || 'uploads',
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
        const percent = file.size ? Math.floor((offset / file.size) * 100) : 100;
        onProgress(`Uploading ${file.name}... ${percent}%`);
      }
      return api('/api/id/files/upload/finish', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      });
    } catch (error) {
      try {
        await api('/api/id/files/upload/cancel', {
          method: 'POST',
          body: JSON.stringify({ upload_id: uploadId })
        });
      } catch (cancelError) {
        console.warn('Upload cancel failed.', cancelError);
      }
      throw error;
    }
  }

  function conversionMessage(result, fallback = 'Upload complete.') {
    const file = result && result.file;
    const conversion = result && result.conversion;
    if (!conversion) return fallback;
    const saved = Number(conversion.saved_bytes || 0);
    const target = file?.name || conversion.stored_name || 'file';
    const action = conversion.action === 'converted' ? 'Converted' : conversion.action === 'copied' ? 'Saved' : 'Uploaded';
    if (saved > 0) return `${action} ${target}. Saved ${formatBytes(saved)}.`;
    return `${action} ${target}.`;
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
    const emailInput = $('idEmail');
    const submitButton = $('idSubmit');
    const profileName = $('idProfileName');
    const profileMeta = $('idProfileMeta');
    const storageMeta = $('idStorageMeta');
    const message = $('idProfileMessage');
    const logoutButton = $('idLogout');
    const settingsButton = $('idSettingsButton');
    const settingsPanel = $('idSettingsPanel');
    const settingsClose = $('idSettingsClose');
    const emailForm = $('idEmailForm');
    const updateEmailInput = $('idUpdateEmail');
    const passwordForm = $('idPasswordForm');
    const currentPasswordInput = $('idCurrentPassword');
    const newPasswordInput = $('idNewPassword');
    const confirmPasswordInput = $('idConfirmPassword');
    const deleteForm = $('idDeleteForm');
    const deletePasswordInput = $('idDeletePassword');
    const deleteConfirmInput = $('idDeleteConfirm');
    const ownerTerminal = $('idOwnerTerminal');
    const ownerOutput = $('idOwnerOutput');
    const ownerCommandForm = $('idOwnerCommandForm');
    const ownerCommandInput = $('idOwnerCommand');
    const ownerRefresh = $('idOwnerRefresh');
    const refreshFilesButton = $('idRefreshFiles');
    const uploadForm = $('idUploadForm');
    const fileInput = $('idFileInput');
    const cameraInput = $('idCameraInput');
    const cameraButton = $('idCameraButton');
    const folderInput = $('idFolderInput');
    const fileList = $('idFileList');
    const filePreview = $('idFilePreview');

    if (!button || !panel || !authForm || !fileList) return;

    const state = {
      mode: 'login',
      account: null,
      files: [],
      previewUrl: ''
    };

    function isOwner(account = state.account) {
      return String(account?.role || '').toLowerCase() === 'owner';
    }

    function notifyFilesChanged() {
      window.dispatchEvent(new CustomEvent('digitalcpu:id-files-changed'));
    }

    function setMessage(text, isError = false) {
      message.textContent = text;
      message.style.color = isError ? 'rgba(255, 170, 170, 0.95)' : '';
    }

    function setOpen(open) {
      panel.hidden = !open;
      button.classList.toggle('is-active', open);
    }

    function setSettingsOpen(open) {
      if (settingsPanel) settingsPanel.hidden = !open;
    }

    function clearSettingsFields() {
      if (currentPasswordInput) currentPasswordInput.value = '';
      if (newPasswordInput) newPasswordInput.value = '';
      if (confirmPasswordInput) confirmPasswordInput.value = '';
      if (deletePasswordInput) deletePasswordInput.value = '';
      if (deleteConfirmInput) deleteConfirmInput.value = '';
    }

    function writeOwner(text = '', className = '') {
      if (!ownerOutput) return;
      const line = document.createElement('div');
      line.className = className;
      line.textContent = text;
      ownerOutput.appendChild(line);
      ownerOutput.scrollTop = ownerOutput.scrollHeight;
    }

    function clearOwnerOutput() {
      if (ownerOutput) ownerOutput.innerHTML = '';
    }

    function formatOwnerValue(value, depth = 0) {
      if (value === null || value === undefined || value === '') return '--';
      if (typeof value !== 'object') return String(value);
      if (Array.isArray(value)) {
        return value.map((item, index) => `${'  '.repeat(depth)}${index + 1}. ${formatOwnerValue(item, depth + 1)}`).join('\n');
      }
      const indent = '  '.repeat(depth);
      return Object.entries(value).map(([key, item]) => {
        if (item && typeof item === 'object') return `${indent}${key}:\n${formatOwnerValue(item, depth + 1)}`;
        return `${indent}${key}: ${formatOwnerValue(item, depth + 1)}`;
      }).join('\n');
    }

    function renderOwnerTerminal() {
      if (!ownerTerminal) return;
      ownerTerminal.hidden = !isOwner();
      if (!isOwner()) {
        clearOwnerOutput();
        return;
      }
      if (!ownerOutput?.childElementCount) {
        writeOwner('owner terminal');
        writeOwner(`device id: ${deviceId()}`);
        writeOwner('Backend must allow this device: remote-access on');
        writeOwner(`Then trust it locally: remote-device-trust ${deviceId()} your-label`);
        writeOwner('Try: status, settings, account-list, account-show <user>, account-set-password <user> <new-pass>');
      }
    }

    async function refreshOwnerControlStatus() {
      if (!isOwner()) return;
      try {
        const data = await api('/api/ghost/control/status');
        writeOwner('status: granted', 'ok');
        if (data.remote_access) writeOwner(formatOwnerValue({ remote_access: data.remote_access }));
        if (data.backend) writeOwner(formatOwnerValue({ backend: data.backend }));
      } catch (error) {
        writeOwner(error.message || 'owner control unavailable', 'error');
      }
    }

    async function runOwnerCommand(command) {
      const raw = String(command || '').trim();
      if (!raw) return;
      writeOwner(`> ${raw}`);
      if (raw.toLowerCase() === 'clear') {
        clearOwnerOutput();
        renderOwnerTerminal();
        return;
      }
      try {
        const data = await api('/api/ghost/control/command', {
          method: 'POST',
          body: JSON.stringify({ command: raw })
        });
        writeOwner(data.message || 'command complete', 'ok');
        if (data.data) writeOwner(formatOwnerValue(data.data));
      } catch (error) {
        writeOwner(error.message || 'command failed', 'error');
      }
    }

    function setMode(mode) {
      state.mode = mode;
      const registering = mode === 'register';
      loginTab.classList.toggle('is-active', !registering);
      registerTab.classList.toggle('is-active', registering);
      displayNameInput.hidden = !registering;
      if (emailInput) {
        emailInput.hidden = !registering;
        emailInput.required = registering;
      }
      submitButton.textContent = registering ? 'Register' : 'Login';
      passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
      setMessage(registering ? 'Create a name and password for your folder.' : 'Sign in to open your folder.');
    }

    function clearPreview() {
      if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = '';
      }
      if (filePreview) {
        filePreview.hidden = true;
        filePreview.innerHTML = '';
      }
    }

    async function previewFile(file) {
      if (!filePreview) return;
      clearPreview();
      setMessage(`Previewing ${file.name || file.stored_name}...`);
      const blob = await fetchFileBlob(file);
      const url = URL.createObjectURL(blob);
      state.previewUrl = url;

      const header = document.createElement('div');
      const title = document.createElement('span');
      const close = document.createElement('button');
      const image = document.createElement('img');

      title.textContent = file.name || file.stored_name || 'image';
      close.type = 'button';
      close.textContent = 'Close';
      close.addEventListener('click', clearPreview);
      image.src = url;
      image.alt = title.textContent;

      header.append(title, close);
      filePreview.append(header, image);
      filePreview.hidden = false;
      setMessage('Preview ready.');
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
        setSettingsOpen(false);
        clearSettingsFields();
        if (updateEmailInput) updateEmailInput.value = '';
        renderFiles([]);
        clearPreview();
        renderOwnerTerminal();
        return;
      }
      profileName.textContent = account.display_name || account.username;
      profileMeta.textContent = account.profile?.email ? `${account.username} / ${account.profile.email}` : account.username;
      storageMeta.textContent = `storage ${formatBytes(account.storage_usage_bytes)}`;
      if (updateEmailInput) updateEmailInput.value = account.profile?.email || '';
      setMessage('Your local host folder is ready.');
      renderOwnerTerminal();
    }

    function renderFiles(files) {
      state.files = Array.isArray(files) ? files : [];
      fileList.innerHTML = '';
      clearPreview();
      if (!state.files.length) {
        const item = document.createElement('li');
        item.textContent = 'No files in this folder yet.';
        fileList.appendChild(item);
        return;
      }
      for (const file of state.files) {
        const item = document.createElement('li');
        const label = document.createElement('span');
        const preview = document.createElement('button');
        const open = document.createElement('button');
        const remove = document.createElement('button');
        label.textContent = `${file.name || file.stored_name} - ${formatBytes(file.size)}`;
        label.title = file.path || file.name || '';
        preview.type = 'button';
        preview.textContent = 'Preview';
        preview.hidden = !isImageFile(file);
        preview.addEventListener('click', async () => {
          try {
            await previewFile(file);
          } catch (error) {
            setMessage(error.message || 'Preview failed.', true);
          }
        });
        open.type = 'button';
        open.textContent = 'Download';
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
        item.append(label, preview, open, remove);
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
    settingsButton?.addEventListener('click', () => setSettingsOpen(settingsPanel?.hidden !== false));
    settingsClose?.addEventListener('click', () => setSettingsOpen(false));
    ownerRefresh?.addEventListener('click', () => refreshOwnerControlStatus());
    ownerCommandForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const command = ownerCommandInput?.value || '';
      if (ownerCommandInput) ownerCommandInput.value = '';
      void runOwnerCommand(command);
    });
    loginTab?.addEventListener('click', () => setMode('login'));
    registerTab?.addEventListener('click', () => setMode('register'));
    refreshFilesButton?.addEventListener('click', () => refreshFiles());

    emailForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        setMessage('Updating e-mail...');
        const data = await api('/api/id/email', {
          method: 'POST',
          body: JSON.stringify({ email: updateEmailInput?.value.trim() || '' })
        });
        renderAccount(data.account);
        setMessage('E-mail updated.');
      } catch (error) {
        setMessage(error.message || 'E-mail update failed.', true);
      }
    });

    passwordForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if ((newPasswordInput?.value || '') !== (confirmPasswordInput?.value || '')) {
        setMessage('New passwords do not match.', true);
        return;
      }
      try {
        setMessage('Resetting password...');
        const data = await api('/api/id/password', {
          method: 'POST',
          body: JSON.stringify({
            current_password: currentPasswordInput?.value || '',
            new_password: newPasswordInput?.value || '',
            confirm_password: confirmPasswordInput?.value || ''
          })
        });
        renderAccount(data.account);
        clearSettingsFields();
        setMessage('Password updated.');
      } catch (error) {
        setMessage(error.message || 'Password reset failed.', true);
      }
    });

    deleteForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if ((deleteConfirmInput?.value || '').trim() !== 'DELETE') {
        setMessage('Type DELETE to confirm account deletion.', true);
        return;
      }
      try {
        setMessage('Deleting account...');
        await api('/api/id/delete-account', {
          method: 'POST',
          body: JSON.stringify({
            password: deletePasswordInput?.value || '',
            confirm: 'DELETE'
          })
        });
        localStorage.removeItem(sessionKey);
        renderAccount(null);
        setMode('register');
        notifyFilesChanged();
        setMessage('Account deleted.');
      } catch (error) {
        setMessage(error.message || 'Delete account failed.', true);
      }
    });

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
            display_name: displayNameInput.value.trim(),
            email: emailInput ? emailInput.value.trim() : '',
            device_id: deviceId()
          })
        });
        localStorage.setItem(sessionKey, data.session_token);
        passwordInput.value = '';
        if (emailInput) emailInput.value = '';
        renderAccount(data.account);
        await refreshFiles();
        notifyFilesChanged();
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
        const result = await uploadFileChunked(file, folderInput.value || 'uploads', setMessage);
        fileInput.value = '';
        await refreshFiles();
        notifyFilesChanged();
        setMessage(conversionMessage(result));
      } catch (error) {
        setMessage(error.message || 'Upload failed.', true);
      }
    });

    cameraButton?.addEventListener('click', () => {
      if (!state.account) {
        setMessage('Sign in before using the camera.', true);
        return;
      }
      cameraInput?.click();
    });

    cameraInput?.addEventListener('change', async () => {
      const file = cameraInput.files && cameraInput.files[0];
      if (!file) return;
      try {
        setMessage('Uploading camera picture...');
        const result = await uploadFileChunked(file, folderInput.value || 'uploads', setMessage);
        cameraInput.value = '';
        await refreshFiles();
        notifyFilesChanged();
        setMessage(conversionMessage(result, 'Camera picture saved.'));
      } catch (error) {
        setMessage(error.message || 'Camera upload failed.', true);
      } finally {
        cameraInput.value = '';
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
