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
    (options.target || GP.dom.screen).appendChild(row);
    GP.autoScroll();
  }

  function help() {
    GP.closeLobby?.();
    GP.closeBoard?.(true);
    GP.setStatusSuffix('/ terminal portal commands');
    GP.state.headerHint = '';
    GP.renderMailHint?.();
    const container = document.createElement('section');
    container.className = 'help-categories';
    const nav = document.createElement('nav');
    nav.className = 'profile-actions';
    nav.setAttribute('aria-label', 'Help categories');
    const content = document.createElement('div');
    container.append(nav, content);
    GP.dom.screen.appendChild(container);
    const groups = {
      Interface: ['clear', 'clear all', 'minimize', 'restore', 'open keyboard', 'dock keyboard', 'wide keyboard', 'full keyboard', 'close keyboard', 'keyboard', 'predictive', 'predictive on', 'predictive off', 'exit help'],
      Social: ['lobby', 'close lobby', 'users online', 'chat room', 'message board', 'close chat room', 'close message board', ['profile search <username>', 'profile ', true]],
      Account: ['sign-up', 'sign-in'],
    };
    if (GP.state.account) {
      groups.Social.push('edit profile', ['add connection: <username> add', '<username> add', true], ['remove connection: <username> remove', '<username> remove', true], ['inbox / mail / messages', 'inbox'], ['mail <username>', 'mail ', true], 'board', 'post board', 'close board');
      groups.Account = ['menu', 'sign-out'];
      groups.Files = ['upload', 'mydatabase', 'camera'];
      groups.AI = [['AiTool', 'aitool']];
      groups.EVA = ['eva', 'eva status', 'eva security', 'eva events', 'close eva'];
    }
    for (const [category, entries] of Object.entries(groups)) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'terminal-button';
      link.textContent = category;
      link.setAttribute('aria-pressed', 'false');
      link.addEventListener('click', () => {
        for (const button of nav.children) button.setAttribute('aria-pressed', String(button === link));
        content.replaceChildren();
        const heading = document.createElement('h3');
        heading.textContent = category;
        content.appendChild(heading);
        for (const entry of entries) {
          const [label, command, prefill] = Array.isArray(entry) ? entry : [entry, entry, false];
          helpCommand(label, command, {prefill, target: content});
        }
      });
      nav.appendChild(link);
    }
    GP.autoScroll();
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


