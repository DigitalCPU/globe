(function (GP) {
  async function signUp() {
    try {
      const username = await GP.promptLine('create user name:');
      const email = await GP.promptLine('enter e-mail:');
      const password = await GP.promptLine('create password:', 'password');
      const confirmPassword = await GP.promptLine('enter password again:', 'password');
      if (password !== confirmPassword) {
        GP.write('passwords do not match. account not created.', 'error');
        return;
      }
      const displayName = username;
      const data = await GP.api('/api/ghost/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, display_name: displayName, phone: '', password, device_id: GP.deviceId() })
      });
      localStorage.setItem(GP.sessionKey, data.session_token);
      GP.state.account = data.account;
      GP.updateSession();
      GP.write(`logged in: ${GP.state.account.display_name || GP.state.account.username}`);
      GP.write('terminal features unlocked.');
      GP.menu();
    } catch (error) {
      GP.write(error.message || 'sign-up failed', 'error');
    }
  }

  async function signIn() {
    try {
      const login = await GP.promptLine('user name or e-mail:');
      const password = await GP.promptLine('password:', 'password');
      const data = await GP.api('/api/ghost/login', {
        method: 'POST',
        body: JSON.stringify({ login, password })
      });
      localStorage.setItem(GP.sessionKey, data.session_token);
      GP.state.account = data.account;
      GP.updateSession();
      GP.write(`logged in: ${GP.state.account.display_name || GP.state.account.username}`);
      GP.write('terminal features unlocked.');
      GP.menu();
    } catch (error) {
      GP.write(error.message || 'sign-in failed', 'error');
    }
  }

  function logout() {
    if (GP.token()) void GP.api('/api/id/logout', { method: 'POST', body: '{}' }).catch(() => {});
    localStorage.removeItem(GP.sessionKey);
    GP.state.account = null;
    if (GP.state.evaMode) GP.closeEva?.();
    if (GP.state.chatMode) GP.exitChat?.();
    GP.stopActiveVoice?.();
    GP.state.controlMode = false;
    GP.state.files = [];
    GP.state.posts = [];
    GP.state.chatMessages = [];
    GP.state.databaseCategory = '';
    GP.state.promptHandler = null;
    GP.dom.input.value = '';
    GP.dom.input.type = 'text';
    GP.clear();
    GP.updateSession();
    GP.write('signed out');
  }

  async function refreshMe() {
    const session = GP.token();
    if (!session) {
      GP.updateSession();
      return;
    }
    try {
      const data = await GP.api('/api/id/me');
      if (GP.token() !== session) return;
      GP.state.account = data.account;
      GP.updateSession();
    } catch (error) {
      if (GP.token() !== session) return;
      localStorage.removeItem(GP.sessionKey);
      GP.state.account = null;
      GP.updateSession();
    }
  }

  GP.signUp = signUp;
  GP.signIn = signIn;
  GP.logout = logout;
  GP.refreshMe = refreshMe;
})(window.GhostProtocol);
