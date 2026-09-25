(function (GP) {
  let closeCurrent = null;
  GP.lobby = function () {
    if (closeCurrent) closeCurrent();
    GP.closeBoard?.(true);
    if (GP.state.chatMode) GP.exitChat();
    GP.state.headerHint = '';
    GP.renderMailHint?.();
    const panel = document.createElement('section');
    panel.className = 'lobby-panel';
    panel.setAttribute('aria-label', 'Public lobby');
    const header = document.createElement('div');
    header.className = 'lobby-header';
    const title = document.createElement('strong');
    title.textContent = 'Public lobby';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'close lobby';
    header.append(title);
    const navigation = document.createElement('nav');
    navigation.className = 'lobby-navigation';
    navigation.setAttribute('aria-label', 'Public lobby navigation');
    const actions = document.createElement('div');
    actions.className = 'lobby-actions';
    const tabs = document.createElement('div');
    tabs.className = 'lobby-tabs'; tabs.setAttribute('role', 'tablist');
    const body = document.createElement('div');
    body.className = 'lobby-body'; body.setAttribute('role', 'tabpanel');
    const status = document.createElement('div');
    status.className = 'hint'; status.setAttribute('role', 'status');
    navigation.append(tabs, actions, close);
    document.querySelector('.terminal-header').appendChild(navigation);
    panel.append(header, status, body);
    GP.dom.screen.appendChild(panel);
    let active = 'Board', data = {messages: [], users: []}, busy = false;
    let list = null, users = null, form = null, accountId = '', lastPresence = 0;
    const controller = new AbortController();
    const buttons = new Map();
    function cleanup() {
      clearInterval(timer); controller.abort(); panel.remove();
      navigation.remove();
      GP.state.headerHint = undefined;
      GP.renderMailHint?.();
      if (GP.state.boardElement && !GP.state.boardElement.isConnected) {
        GP.state.boardElement = null; GP.state.boardOpen = false;
      }
      closeCurrent = null;
    }
    close.addEventListener('click', cleanup);
    function renderData() {
      if (list) {
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        list.replaceChildren();
        for (const message of data.messages || []) {
          const line = document.createElement('div');
          line.className = 'line'; line.textContent = `${message.name}: ${message.text}`;
          list.appendChild(line);
        }
        if (!list.childNodes.length) list.textContent = 'No messages yet.';
        if (atBottom) list.scrollTop = list.scrollHeight;
      }
      if (users) {
        users.replaceChildren();
        for (const name of data.users || []) {
          const line = document.createElement('div'); line.textContent = name; users.appendChild(line);
        }
        if (!users.childNodes.length) users.textContent = 'No users active in the lobby.';
      }
    }
    async function refresh() {
      if (!panel.isConnected) { cleanup(); return; }
      if (busy || document.hidden) return;
      busy = true;
      try {
        if (GP.state.account && Date.now() - lastPresence > 30000) {
          await GP.api('/api/lobby', {method:'POST', body:'{}', signal:controller.signal});
          lastPresence = Date.now();
        }
        data = await GP.api('/api/lobby', {signal:controller.signal});
        status.textContent = GP.state.account ? '' : 'Guest - view only';
        const current = GP.state.account?.account_id || '';
        if (current !== accountId) { accountId = current; select(active); }
        renderData();
      } catch (error) {
        if (!controller.signal.aborted) status.textContent = `Lobby unavailable: ${error.message}`;
      } finally { busy = false; }
    }
    function select(name) {
      active = name; list = users = form = null;
      actions.replaceChildren();
      body.replaceChildren();
      buttons.forEach((button, label) => button.setAttribute('aria-selected', String(label === name)));
      if (name === 'Board') { void GP.board(body, actions); return; }
      if (name === 'Users Online') {
        const note = document.createElement('div'); note.className = 'hint';
        note.textContent = 'Active in this lobby within the last 90 seconds.';
        users = document.createElement('div'); body.append(note, users); renderData(); return;
      }
      if (name === 'AiTool') {
        const note = document.createElement('div');
        note.textContent = GP.state.account ? 'Your AI conversation is private.' : 'Sign in to start a private AI conversation.';
        body.appendChild(note);
        if (GP.state.account) body.appendChild(GP.inlineButton('open AiTool', () => { cleanup(); GP.enterChat(); }));
        return;
      }
      list = document.createElement('div'); list.className = 'lobby-messages';
      list.setAttribute('role','log'); body.appendChild(list);
      renderData();
      if (!GP.state.account) return;
      form = document.createElement('form'); form.className = 'lobby-compose';
      const input = document.createElement('input'); input.maxLength = 1000;
      input.placeholder = 'Message the public room'; input.setAttribute('aria-label', 'Public room message');
      const send = document.createElement('button'); send.type = 'submit'; send.textContent = 'send';
      form.append(input, send); body.appendChild(form);
      input.addEventListener('keydown', event => event.stopPropagation());
      form.addEventListener('submit', async event => {
        event.preventDefault(); event.stopPropagation();
        if (!input.value.trim() || send.disabled || !GP.requireAccount()) return;
        send.disabled = true;
        try {
          await GP.api('/api/lobby', {method:'POST', body:JSON.stringify({text:input.value.trim()}), signal:controller.signal});
          input.value = ''; await refresh();
        } catch (error) { if (!controller.signal.aborted) status.textContent = error.message; }
        finally { send.disabled = false; }
      });
    }
    for (const name of ['Board', 'Chat Room', 'AiTool', 'Users Online']) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
      button.setAttribute('role','tab'); button.addEventListener('click', () => select(name));
      buttons.set(name, button); tabs.appendChild(button);
    }
    const timer = setInterval(refresh, 8000);
    closeCurrent = cleanup;
    select(active); void refresh(); GP.autoScroll();
  };
  GP.closeLobby = () => { if (closeCurrent) closeCurrent(); };
})(window.GhostProtocol);

