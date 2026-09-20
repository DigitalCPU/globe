(function (GP) {
  const PUBLIC_COMMANDS = [
    ['inbox', 'mail', 'messages', 'messeges', 'message'],
    ['help'], ['lobby', 'public lobby'], ['close lobby'], ['profile'], ['edit profile'],
    ['sign-in', 'login', 'logon'], ['sign-up', 'register', 'create account', 'create profile'],
    ['sign-out', 'logout', 'logoff'], ['menu'], ['upload'],
    ['mydatabase', 'my database', 'database', 'uploaded-files', 'files'],
    ['camera', 'use camera'], ['board', 'message board'], ['chat', 'ai'],
    ['post board', 'board post'], ['close board', 'board close'],
    ['clear'], ['fullscreen', 'full', 'immersion']
  ];

  function commandDistance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
        }
      }
    }
    return rows[a.length][b.length];
  }

  function suggestCommand(raw) {
    const key = GP.commandKey(raw);
    const matches = key.length >= 3 && key.length <= 40 ? PUBLIC_COMMANDS.map(([command, ...aliases]) => {
      const distance = Math.min(...[command, ...aliases].map(alias => commandDistance(key, GP.commandKey(alias))));
      return { command, distance };
    }).filter(match => match.distance <= (key.length > 7 ? 3 : key.length > 4 ? 2 : 1))
      .sort((a, b) => a.distance - b.distance || a.command.localeCompare(b.command)) : [];
    if (!matches.length) {
      GP.write('unknown command. type help.', 'error');
      GP.commandButton('help', 'help');
      return;
    }
    const closest = matches.filter(match => match.distance === matches[0].distance).slice(0, 3);
    GP.write(`unknown command. did you mean to type ${closest.map(match => `"${match.command}"`).join(' or ')}?`, 'hint');
    closest.forEach(match => GP.commandButton(match.command, match.command));
  }

  async function status() {
    try {
      await GP.api('/api/status');
      GP.dom.connectionState.textContent = 'online';
      return true;
    } catch (error) {
      GP.dom.connectionState.textContent = 'offline';
      return false;
    }
  }

  function run(raw) {
    const rawCommand = String(raw || '').trim();
    const command = rawCommand.toLowerCase();
    const key = GP.commandKey(rawCommand);
    if (!command) return;
    if (!GP.state.controlMode && ['inbox','mail','messages','messeges','message'].includes(key)) { void GP.inbox(); return; }
    if (!GP.state.controlMode && /^mail\s+\S/i.test(rawCommand)) { void GP.composeMail(rawCommand.slice(5).trim()); return; }
    if (key === 'editprofile') { void GP.editProfile(); return; }
    if (command === 'profile' || command.startsWith('profile ')) { void GP.showProfile(rawCommand.slice(7).trim() || undefined); return; }
    if (key === 'lobby' || key === 'publiclobby') { GP.lobby(); return; }
    if (key === 'closelobby') { GP.closeLobby(); return; }
    if (GP.state.chatMode) {
      if (key === 'exitchat' || key === 'exit' || key === 'quit') {
        GP.exitChat();
      } else {
        void GP.sendChat(rawCommand);
      }
      return;
    }
    GP.write(`> ${rawCommand}`);
    if (command === 'access control panel ui') {
      void GP.accessControlPanelUi();
      return;
    }
    if (GP.state.controlMode) {
      void GP.runControlCommand(rawCommand);
      return;
    }
    if (/^.+\s+(add|remove)$/i.test(rawCommand)) { void GP.connectionCommand(rawCommand); return; }
    if (command === 'help') GP.help();
    else if (['signin', 'login', 'logon'].includes(key)) void GP.signIn();
    else if (['signup', 'register', 'createaccount', 'createprofile'].includes(key)) void GP.signUp();
    else if (command === 'menu') GP.menu();
    else if (command === 'upload' || command === '1') void GP.upload();
    else if (command === 'mydatabase' || command === 'database' || command === 'uploaded-files' || command === 'files' || command === '2') void GP.myDatabase();
    else if (command === 'camera' || command === 'use camera' || command === '3') void GP.camera();
    else if (command === 'board' || command === 'message board' || command === '4') void GP.board();
    else if (command === 'chat' || command === 'ai' || command === '5') GP.enterChat();
    else if (key === 'postboard' || key === 'boardpost') void GP.postBoardMessage();
    else if (key === 'closeboard' || key === 'boardclose') GP.closeBoard();
    else if (['logout', 'signout', 'logoff'].includes(key) || command === '6') GP.logout();
    else if (command === 'clear') GP.clear();
    else if (command === 'full' || command === 'fullscreen' || command === 'immersion') void GP.enterFullscreen();
    else suggestCommand(rawCommand);
  }

  function bindWindowControls() {
    if (GP.dom.windowMinimize) {
      GP.dom.windowMinimize.disabled = true;
      GP.dom.windowMinimize.title = 'Browser minimization is unavailable to websites';
    }

    GP.dom.windowRestore?.addEventListener('click', () => {
      document.body.classList.remove('terminal-minimized', 'terminal-closed');
      if (document.fullscreenElement) void document.exitFullscreen();
      GP.dom.input.focus();
    });

    GP.dom.windowFullscreen?.addEventListener('click', () => {
      document.body.classList.remove('terminal-minimized', 'terminal-closed');
      void GP.enterFullscreen();
      GP.dom.input.focus();
    });

    GP.dom.windowClose?.addEventListener('click', () => {
      try { window.close(); } catch (_) { /* Some browsers reject script closing. */ }
      window.setTimeout(() => {
        if (window.closed) return;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        GP.dom.windowClose.title = 'This browser blocked closing the tab from the website';
      }, 200);
    });
  }

  function start() {
    document.addEventListener('pointerdown', GP.activateImmersion, { once: true });
    document.addEventListener('keydown', GP.activateImmersion, { once: true });
    bindWindowControls();

    GP.dom.form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (GP.state.promptHandler) {
        GP.state.promptHandler();
        return;
      }
      const command = GP.dom.input.value;
      GP.dom.input.value = '';
      run(command);
    });

    GP.clear();
    void status();
    void GP.refreshMe();
  }

  GP.run = run;
  GP.status = status;
  GP.start = start;
  start();
})(window.GhostProtocol);
