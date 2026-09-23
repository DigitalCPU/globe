(function (GP) {
  let panel = null, output = null, controller = null, busy = false, version = 0;
  const accountKey = () => `${GP.state.account?.account_id || GP.state.account?.username || ''}:${GP.token()}`;
  let ownerKey = '';

  function line(text, className = '') {
    if (!output) return;
    const element = document.createElement('div');
    element.className = `line ${className}`.trim();
    element.textContent = text;
    output.appendChild(element);
    GP.autoScroll();
    return element;
  }

  GP.renderEvaHeader = function () {
    if (!GP.state.evaMode || !GP.dom.terminalHint) return false;
    GP.dom.terminalHint.replaceChildren();
    const links = document.createElement('nav');
    links.className = 'session-shortcuts';
    links.setAttribute('aria-label', 'EVA shortcuts');
    GP.commandButton('status', 'eva status', links);
    if (GP.isOwner()) {
      GP.commandButton('security', 'eva security', links);
      GP.commandButton('events', 'eva events', links);
    }
    GP.commandButton('close eva', 'close eva', links);
    GP.dom.terminalHint.append(links);
    return true;
  };

  GP.closeEva = function () {
    version++;
    controller?.abort(); controller = null; busy = false;
    GP.state.evaMode = false;
    panel?.remove(); panel = null; output = null;
    if (GP.dom.appTitle) GP.dom.appTitle.textContent = 'Ghost Protocol';
    GP.state.headerHint = undefined;
    GP.renderMailHint?.();
  };

  function open() {
    if (!GP.requireAccount()) return false;
    if (GP.state.evaMode && panel?.isConnected) return true;
    GP.closeLobby?.(); GP.closeBoard?.(true);
    if (GP.state.chatMode) GP.exitChat();
    GP.state.evaMode = true;
    ownerKey = accountKey();
    GP.dom.appTitle.textContent = 'Ghost Protocol / EVA-0';
    panel = document.createElement('section'); panel.className = 'eva-session';
    panel.setAttribute('aria-label', 'EVA conversation');
    output = document.createElement('div'); output.setAttribute('role', 'log');
    panel.append(output); GP.dom.screen.append(panel);
    GP.renderEvaHeader(); GP.autoScroll();
    return true;
  }

  async function request(path, options = {}) {
    if (!open()) return;
    if (busy) { line('EVA is still responding.', 'hint'); return; }
    const key = accountKey(), currentVersion = version;
    busy = true;
    const pending = line('EVA: connecting...', 'hint');
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 155000);
    try {
      const data = await GP.api(`/api/eva/v1/${path}`, {...options, signal: controller.signal});
      if (version !== currentVersion || key !== accountKey() || !panel?.isConnected) return;
      pending.remove();
      if (path === 'chat') line(`eva> ${data.reply}`, 'eva-reply');
      else line(JSON.stringify(data.status || data, null, 2), 'eva-status');
    } catch (error) {
      if (version === currentVersion && key === accountKey() && panel?.isConnected) {
        pending.textContent = error.name === 'AbortError' ? 'EVA request timed out.' : error.message;
        pending.className = 'line error';
      }
    } finally {
      clearTimeout(timeout);
      if (version === currentVersion) { busy = false; controller = null; }
    }
  }

  GP.sendEva = async function (text) {
    if (!open()) return;
    if (busy) { line('EVA is still responding.', 'hint'); return; }
    if (!text.trim() || text.length > 4000) { line('Enter a message of 1-4000 characters.', 'error'); return; }
    line(`you> ${text}`);
    await request('chat', {method: 'POST', body: JSON.stringify({message: text})});
  };

  GP.evaCommand = function (key) {
    if (['closeeva', 'exiteva'].includes(key)) { GP.closeEva(); return; }
    const path = {eva: 'status', evastatus: 'status', evasecurity: 'security/status', evaevents: 'security/events'}[key];
    if (path) void request(path);
  };

  const updateSession = GP.updateSession;
  GP.updateSession = function () {
    if (panel && ownerKey !== accountKey()) GP.closeEva();
    return updateSession.apply(this, arguments);
  };
})(window.GhostProtocol);
