(function (GP) {
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
    GP.write(`> ${rawCommand}`);
    if (command === 'access control panel ui') {
      void GP.accessControlPanelUi();
      return;
    }
    if (GP.state.controlMode) {
      void GP.runControlCommand(rawCommand);
      return;
    }
    if (command === 'help') GP.help();
    else if (['signin', 'login', 'logon'].includes(key)) void GP.signIn();
    else if (['signup', 'register', 'createaccount', 'createprofile'].includes(key)) void GP.signUp();
    else if (command === 'menu') GP.menu();
    else if (command === 'upload' || command === '1') void GP.upload();
    else if (command === 'mydatabase' || command === 'database' || command === 'uploaded-files' || command === 'files' || command === '2') void GP.myDatabase();
    else if (command === 'camera' || command === 'use camera' || command === '3') void GP.camera();
    else if (command === 'board' || command === 'message board' || command === '4') void GP.board();
    else if (key === 'postboard' || key === 'boardpost') void GP.postBoardMessage();
    else if (key === 'closeboard' || key === 'boardclose') GP.closeBoard();
    else if (['logout', 'signout', 'logoff'].includes(key) || command === '5') GP.logout();
    else if (command === 'clear') GP.clear();
    else if (command === 'full' || command === 'fullscreen' || command === 'immersion') void GP.enterFullscreen();
    else GP.write('unknown command. type help.', 'error');
  }

  function bindWindowControls() {
    GP.dom.windowMinimize?.addEventListener('click', () => {
      document.body.classList.add('terminal-minimized');
    });

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
      window.close();
      document.body.classList.add('terminal-closed');
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
