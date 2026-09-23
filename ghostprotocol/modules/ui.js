(function (GP) {
  GP.renderSessionLinks = function () {
    if (GP.state.evaMode) return GP.renderEvaHeader?.() || false;
    const hint = GP.dom.terminalHint;
    if (!hint || !GP.state.account || GP.state.chatMode || GP.state.headerHint === '') return false;
    hint.replaceChildren();
    const links = document.createElement('nav');
    links.className = 'session-shortcuts';
    links.setAttribute('aria-label', 'Account shortcuts');
    for (const [label, command] of [
      ['inbox', 'inbox'], ['mydatabase', 'mydatabase'],
      ['board', 'board'], ['chat', 'chat'], ['eva', 'eva'], ['sign out', 'sign-out']
    ]) GP.commandButton(label, command, links);
    hint.appendChild(links);
    return true;
  };
  function help() {
    GP.closeLobby?.();
    GP.closeBoard?.(true);
    GP.state.headerHint = GP.state.account ? undefined : 'Sign in or sign up to upload, access personal files, chat, and post.';
    GP.renderMailHint?.();
    GP.write('Terminal portal commands:');
    GP.write('  lobby          open the public lobby (guests view only)');
    GP.write('  close lobby    close the public lobby');
    GP.write('  profile <username>  view a public profile and personal board');
    GP.write('  sign-up        create a terminal profile with name, email, and password');
    GP.write('  sign-in        access an existing terminal profile');
    GP.write('  sign-out       close the active terminal profile');
    if (GP.state.account) {
      GP.write('  menu           show terminal features');
      GP.write('  edit profile   edit your public profile and avatar');
      GP.write('  inbox / mail / messages / messeges  check private messages');
      GP.write('  mail <username>  compose a private message');
      GP.write('  upload         upload files to your local profile folder');
      GP.write('  mydatabase     open files stored in your local profile folder');
      GP.write('  camera         use camera and save to your local profile folder');
      GP.write('  board          open the message board');
      GP.write('  chat           open AI terminal chat with voice output');
      GP.write('  eva            open Agent EVA-0');
      GP.write('  eva status     show EVA service status');
      GP.write('  eva security / eva events  trusted-owner observations');
      GP.write('  close eva      return to the terminal');
      GP.write('  post board     write a new message board post');
      GP.write('  close board    close the message board view');
    }
    GP.write('');
    const links = document.createElement('nav');
    links.className = 'help-links';
    links.setAttribute('aria-label', 'Terminal shortcuts');
    GP.dom.screen.appendChild(links);
    GP.commandButton('sign-in', 'sign-in', links);
    GP.commandButton('lobby', 'lobby', links);
    GP.commandButton('sign-up', 'sign-up', links);
    if (GP.state.account) {
      GP.commandButton('menu', 'menu', links);
      GP.commandButton('mydatabase', 'mydatabase', links);
      GP.commandButton('board', 'board', links);
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
    GP.write('5) AI chat');
    GP.write('6) sign out');
    GP.write('');
  }

  GP.help = help;
  GP.menu = menu;
})(window.GhostProtocol);
