(function (GP) {
  GP.renderSessionLinks = function () {
    if (GP.state.evaMode) return GP.renderEvaHeader?.() || false;
    const hint = GP.dom.terminalHint;
    if (!hint || !GP.state.account || GP.state.chatMode || GP.state.headerHint === '') return false;
    hint.replaceChildren();
    const links = document.createElement('nav');
    links.className = 'session-shortcuts';
    links.setAttribute('aria-label', 'Account shortcuts');
    const shortcuts = GP.state.databaseOpen ? [
      ['inbox', 'inbox']
    ] : [
      ['mydatabase', 'mydatabase'],
      ['Lobby', 'lobby'], ['AiTool', 'aitool'], ['eva', 'eva'], ['sign out', 'sign-out']
    ];
    for (const [label, command] of shortcuts) GP.commandButton(label, command, links);
    if (GP.state.databaseOpen) {
      links.setAttribute('aria-label', 'MyDatabase navigation');
      for (const [category, label] of Object.entries(GP.Files.databaseCategories)) {
        const button = GP.inlineButton(label, () => GP.Files.selectDatabaseCategory(category, true));
        button.setAttribute('aria-controls', 'databaseContent');
        button.setAttribute('aria-expanded', String(category === GP.state.databaseCategory));
        if (category === GP.state.databaseCategory) button.setAttribute('aria-current', 'page');
        links.appendChild(button);
      }
      links.appendChild(GP.inlineButton('close', () => GP.clearAll()));
      GP.commandButton('sign out', 'sign-out', links);
    }
    hint.appendChild(links);
    return true;
  };

  function helpCommand(label, command, options = {}) {
    const row = document.createElement('div');
    row.className = 'help-command-row';
    const button = document.createElement('button');
    button.className = 'terminal-button help-command-link';
    if (options.pulse) button.classList.add('terminal-pulse');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (options.prefill) {
        GP.dom.input.value = command;
        GP.dom.input.focus();
        return;
      }
      GP.run(command);
    });
    row.appendChild(button);
    GP.dom.screen.appendChild(row);
    GP.autoScroll();
  }

  function help() {
    GP.closeLobby?.();
    GP.closeBoard?.(true);
    GP.setStatusSuffix('/ terminal portal commands');
    GP.state.headerHint = '';
    GP.renderMailHint?.();
    helpCommand('lobby', 'lobby');
    helpCommand('close lobby', 'close lobby');
    helpCommand('users online', 'users online');
    helpCommand('chat room', 'chat room');
    helpCommand('message board', 'message board');
    helpCommand('close chat room', 'close chat room');
    helpCommand('close message board', 'close message board');
    helpCommand('profile <username>', 'profile ', { prefill: true });
    helpCommand('sign-up', 'sign-up', { pulse: true });
    helpCommand('sign-in', 'sign-in');
    helpCommand('sign-out', 'sign-out');
    helpCommand('clear', 'clear');
    helpCommand('clear all', 'clear all');
    helpCommand('minimize', 'minimize');
    helpCommand('restore', 'restore');
    helpCommand('open keyboard', 'open keyboard');
    helpCommand('dock keyboard', 'dock keyboard');
    helpCommand('wide keyboard', 'wide keyboard');
    helpCommand('full keyboard', 'full keyboard');
    helpCommand('close keyboard', 'close keyboard');
    helpCommand('keyboard', 'keyboard');
    helpCommand('predictive', 'predictive');
    helpCommand('predictive on', 'predictive on');
    helpCommand('predictive off', 'predictive off');
    helpCommand('exit help', 'exit help');
    if (GP.state.account) {
      helpCommand('menu', 'menu');
      helpCommand('edit profile', 'edit profile');
      helpCommand('inbox / mail / messages', 'inbox');
      helpCommand('mail <username>', 'mail ', { prefill: true });
      helpCommand('upload', 'upload');
      helpCommand('mydatabase', 'mydatabase');
      helpCommand('camera', 'camera');
      helpCommand('board', 'board');
      helpCommand('AiTool', 'aitool');
      helpCommand('eva', 'eva');
      helpCommand('eva status', 'eva status');
      helpCommand('eva security / eva events', 'eva security');
      helpCommand('close eva', 'close eva');
      helpCommand('post board', 'post board');
      helpCommand('close board', 'close board');
    }
    GP.write('');
  }

  function menu() {
    if (!GP.state.account) {
      GP.write('Access denied. Use sign-in or sign-up first.', 'error');
      return;
    }
    GP.write(`terminal access granted: ${GP.state.account.display_name || GP.state.account.username}`);
    GP.renderMailHint?.();
    GP.write('1) upload files');
    GP.write('2) my database');
    GP.write('3) use camera');
    GP.write('4) message board');
    GP.write('5) AiTool');
    GP.write('6) sign out');
    GP.write('');
  }

  GP.help = help;
  GP.menu = menu;
})(window.GhostProtocol);


