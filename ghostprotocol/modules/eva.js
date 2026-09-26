(function (GP) {
  let panel = null, output = null, controller = null, busy = false, version = 0;
  const accountKey = () => `${GP.state.account?.account_id || GP.state.account?.username || ''}:${GP.token()}`;
  let ownerKey = '';
  let previousConnection = 'online';

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
    if (GP.dom.connectionState) GP.dom.connectionState.textContent = previousConnection;
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
    previousConnection = GP.dom.connectionState.textContent;
    GP.dom.appTitle.textContent = 'Eva';
    GP.dom.connectionState.textContent = 'connecting';
    panel = document.createElement('section'); panel.className = 'eva-session';
    panel.setAttribute('aria-label', 'EVA conversation');
    output = document.createElement('div'); output.setAttribute('role', 'log');
    panel.append(output); GP.dom.screen.append(panel);
    GP.renderEvaHeader(); GP.autoScroll();
    return true;
  }

  async function request(path, options = {}, activation = false) {
    if (!open()) return;
    if (busy) { line('EVA is still responding.', 'hint'); return; }
    const key = accountKey(), currentVersion = version;
    busy = true;
    const pending = line('EVA: connecting...', 'hint');
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 155000);
    try {
      const data = await GP.api(`/api/eva/v1/${path}`, {...options, signal: controller.signal});
      let voiceResults;
      if (path === 'status' && !activation) {
        voiceResults = await Promise.allSettled([
          GP.api('/api/voice/active', {signal: controller.signal}),
          GP.api('/api/voice/status', {signal: controller.signal})
        ]);
      }
      if (version !== currentVersion || key !== accountKey() || !panel?.isConnected) return;
      pending.remove();
      GP.dom.connectionState.textContent = data.status?.Core === 'OFFLINE' ? 'offline' : 'online';
      if (path === 'chat') {
        if (GP.writeAiReply) {
          const reply = GP.writeAiReply(String(data.reply || ''), output, 'eva_0');
          reply.classList.add('eva-reply');
        } else {
          line(`eva> ${data.reply}`, 'eva-reply');
        }
      }
      else if (path === 'status' && activation) {
        line(GP.dom.connectionState.textContent === 'online' ? 'Eva Online' : 'Eva Offline', 'eva-activation');
      } else if (path === 'status') {
        const model = data.model || {};
        const voice = voiceResults[0].status === 'fulfilled' ? voiceResults[0].value : null;
        const service = voiceResults[1].status === 'fulfilled' ? voiceResults[1].value : null;
        const layers = model.gpu_offload_layers;
        const unknown = value => value ?? 'unavailable';
        line([
          `Eva: ${GP.dom.connectionState.textContent}`,
          `Model: ${unknown(model.name)}`,
          `Model loaded: ${model.loaded == null ? 'unavailable' : model.loaded ? 'yes' : 'no'}`,
          `Context tokens: ${unknown(model.context_tokens)}`,
          `Max response tokens: ${unknown(model.max_tokens)}`,
          `Temperature: ${unknown(model.temperature)}`,
          `GPU offload setting: ${layers === 0 ? '0 (CPU)' : layers === -1 ? 'all layers' : unknown(layers)}`,
          `Votronix: ${service ? service.votronix_running ? 'online' : 'offline' : 'unavailable'}`,
          `Active voice: ${voice ? voice.name || String(voice.voice_id || '').split(/[\\/]/).pop() || 'system default' : 'unavailable'}`,
          'Voice source: Votronix active voice',
          `Voice output: ${GP.state.voiceOutputEnabled ? 'on' : 'off'}`,
          `Autoplay: ${GP.state.voiceAutoplayEnabled ? 'on' : 'off'}`
        ].join('\n'), 'eva-status');
      } else line(JSON.stringify(data, null, 2), 'eva-status');
    } catch (error) {
      if (version === currentVersion && key === accountKey() && panel?.isConnected) {
        pending.textContent = error.name === 'AbortError' ? 'EVA request timed out.' : error.message;
        pending.className = 'line error';
        if (path === 'status') GP.dom.connectionState.textContent = 'unavailable';
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
    if (path) void request(path, {}, key === 'eva');
  };

  const updateSession = GP.updateSession;
  GP.updateSession = function () {
    if (panel && ownerKey !== accountKey()) GP.closeEva();
    return updateSession.apply(this, arguments);
  };
})(window.GhostProtocol);

