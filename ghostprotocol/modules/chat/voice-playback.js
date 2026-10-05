(function (GP) {
  const WORDS_PER_VOICE_CHUNK = 8;
  const voiceOperations = new Map();

  function voiceAgentId(replyElement) {
    const id = String(replyElement?.dataset.agentId || 'aitool').toLowerCase();
    return ({ eva_0: 'eva', ai_tool: 'aitool' })[id] || id;
  }

  function abortError() {
    return new DOMException('Voice rendering stopped.', 'AbortError');
  }

  function beginVoiceOperation(replyElement) {
    stopVoiceActivity('', replyElement);
    const operation = {
      replyElement, agentId: voiceAgentId(replyElement), controller: new AbortController(),
      jobIds: new Set(), session: GP.token(), device: GP.deviceId()
    };
    voiceOperations.set(replyElement, operation);
    return operation;
  }

  async function cancelVoiceJob(jobId, operation) {
    // Capture the submitting session so a late response after logout can be canceled.
    const response = await fetch(`${GP.API_BASE}/api/voice/tts/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ID-Session': operation.session, 'X-Device-ID': operation.device },
      body: JSON.stringify({ job_id: jobId })
    });
    if (!response.ok) throw new Error(`voice cancellation failed: ${response.status}`);
  }

  function voiceDelay(signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const canceled = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', canceled); resolve(); }, 500);
      signal.addEventListener('abort', canceled, { once: true });
    });
  }

  async function requestVoiceJob(text, operation) {
    const signal = operation.controller.signal;
    // Do not abort submission: retain the returned job ID for scoped cancellation.
    const job = await GP.api('/api/voice/tts', {
      method: 'POST', body: JSON.stringify({ text, agent_id: operation.agentId, async: true })
    });
    if (!job.job_id || !job.audio_url || !job.status_url) throw new Error('voice backend needs the character-routing update');
    operation.jobIds.add(job.job_id);
    if (signal.aborted) {
      void cancelVoiceJob(job.job_id, operation).catch(() => {});
      operation.jobIds.delete(job.job_id);
      throw abortError();
    }
    const deadline = Date.now() + 180000;
    let state = job;
    while (state.status !== 'ready') {
      if (signal.aborted) throw abortError();
      if (state.status === 'failed') throw new Error(state.error || 'voice rendering failed');
      if (state.status === 'canceled') throw abortError();
      if (Date.now() > deadline) throw new Error('voice rendering timed out');
      await voiceDelay(signal);
      state = await GP.api(job.status_url, { signal });
    }
    const url = await fetchVoiceAudioBlob(job.audio_url, signal);
    if (signal.aborted) { URL.revokeObjectURL(url); throw abortError(); }
    operation.jobIds.delete(job.job_id);
    return { job, url };
  }

  async function voiceBackendMode() {
    const now = Date.now();
    const cached = GP.state.voiceBackendStatus;
    if (cached && now - cached.checkedAt < 5000) return cached;
    const status = await GP.api('/api/voice/status');
    const next = {
      checkedAt: now,
      backend: String(status.voice_backend || 'local').toLowerCase(),
      status
    };
    GP.state.voiceBackendStatus = next;
    return next;
  }

  async function requestFullVoice(text, operation) {
    const signal = operation.controller.signal;
    const data = await GP.api('/api/voice/tts', {
      method: 'POST',
      body: JSON.stringify({ text, agent_id: operation.agentId, async: false, timeout_seconds: 180 }),
      signal
    });
    const url = await fetchVoiceAudioBlob(data.audio_url || '/api/voice/last.wav', signal);
    if (signal.aborted) { URL.revokeObjectURL(url); throw abortError(); }
    return { data, url };
  }

  function finishVoiceOperation(operation) {
    for (const id of operation.jobIds) void cancelVoiceJob(id, operation).catch(() => {});
    operation.jobIds.clear();
    if (voiceOperations.get(operation.replyElement) === operation) voiceOperations.delete(operation.replyElement);
  }

  async function fetchVoiceAudioBlob(audioPath, signal) {
    if (!audioPath) throw new Error('voice response is missing its processed audio URL');
    const response = await fetch(`${GP.API_BASE}${audioPath}${audioPath.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() },
      signal
    });
    if (response.status !== 200 || !String(response.headers.get('Content-Type')).startsWith('audio/')) throw new Error(`voice audio failed: ${response.status}`);
    return URL.createObjectURL(await response.blob());
  }

  function stopActiveVoice() {
    if (GP.state.activeVoiceAudio) {
      GP.state.activeVoiceAudio.currentTime = 0;
      GP.state.activeVoiceAudio.pause();
      GP.state.activeVoiceAudio = null;
    }
    if (GP.state.activeVoiceReply) {
      GP.state.activeVoiceReply.classList.remove('is-voice-playing');
      GP.state.activeVoiceReply = null;
    }
  }

  function stopVoiceActivity(agentId = '', replyElement = null) {
    const matches = reply => (!replyElement || reply === replyElement) && (!agentId || voiceAgentId(reply) === agentId);
    let stopped = false;
    if (GP.state.activeVoiceReply && matches(GP.state.activeVoiceReply)) {
      stopActiveVoice();
      stopped = true;
    }
    for (const operation of voiceOperations.values()) {
      if (!matches(operation.replyElement)) continue;
      operation.controller.abort();
      finishVoiceOperation(operation);
      operation.replyElement.dataset.chunkedVoice = '';
      const tray = operation.replyElement.nextElementSibling;
      if (tray?.classList.contains('voice-chunk-tray')) {
        tray.querySelectorAll('.voice-chunk.queued, .voice-chunk.rendering').forEach(button => {
          button.classList.remove('queued', 'rendering');
          button.classList.add('canceled');
          button.disabled = true;
        });
        stopTrayGpuIndicator(tray);
      }
      stopped = true;
    }
    return stopped;
  }
  async function playAudioUrl(url, replyElement, options = {}) {
    stopActiveVoice();
    const audio = new Audio(url);
    GP.state.activeVoiceAudio = audio;
    GP.state.activeVoiceReply = replyElement || null;
    if (replyElement) replyElement.classList.add('is-voice-playing');
    const ended = new Promise((resolve) => {
      const finish = () => {
        if (GP.state.activeVoiceAudio === audio) {
          GP.state.activeVoiceAudio = null;
          GP.state.activeVoiceReply = null;
        }
        if (replyElement) replyElement.classList.remove('is-voice-playing');
        resolve(audio.ended);
      };
      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener('pause', () => {
        finish();
      }, { once: true });
    });
    try {
      await audio.play();
      if (options.waitForEnd) return await ended;
      return true;
    } catch (error) {
      if (GP.state.activeVoiceAudio === audio) {
        GP.state.activeVoiceAudio = null;
        GP.state.activeVoiceReply = null;
      }
      if (replyElement) replyElement.classList.remove('is-voice-playing');
      throw error;
    }
  }

  function isPlaybackBlocked(error) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    return name === 'notallowederror'
      || message.includes('request is not allowed')
      || message.includes('play() failed')
      || message.includes('user didn')
      || message.includes('user gesture');
  }

  function markVoiceReady(replyElement) {
    if (replyElement) {
      replyElement.classList.remove('is-voice-playing');
      replyElement.classList.add('is-voice-ready');
      if (replyElement.dataset.voiceReadyNotice === '1') return;
      replyElement.dataset.voiceReadyNotice = '1';
    }
    GP.write('voice ready. tap reply to play.', 'hint');
  }

  async function playAudioUrlIfAllowed(url, replyElement, options = {}) {
    try {
      const played = await playAudioUrl(url, replyElement, options);
      if (replyElement) replyElement.classList.remove('is-voice-ready');
      return played;
    } catch (error) {
      if (!isPlaybackBlocked(error)) throw error;
      markVoiceReady(replyElement);
      return false;
    }
  }


  function chunkTrayFor(replyElement) {
    let tray = replyElement.nextElementSibling;
    if (!tray || !tray.classList.contains('voice-chunk-tray')) {
      tray = document.createElement('div');
      tray.className = 'voice-chunk-tray';
      replyElement.insertAdjacentElement('afterend', tray);
    }
    return tray;
  }

  function stopTrayGpuIndicator(tray) {
    if (tray?._gpuIndicator) {
      tray._gpuIndicator.remove();
      tray._gpuIndicator = null;
    }
  }

  function voiceWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }

  function splitVoiceChunks(text) {
    const words = voiceWords(text);
    const chunks = [];
    for (let index = 0; index < words.length; index += WORDS_PER_VOICE_CHUNK) {
      chunks.push(words.slice(index, index + WORDS_PER_VOICE_CHUNK).join(' '));
    }
    return chunks;
  }

  function shouldUseChunkedVoice(text) {
    return voiceWords(text).length > WORDS_PER_VOICE_CHUNK;
  }

  function relativeApiUrl(path) {
    return String(path || '').startsWith('/') ? path : `/${path}`;
  }

  async function fetchJobStatus(statusUrl) {
    return GP.api(relativeApiUrl(statusUrl));
  }

  async function fetchChunkAudioBlob(audioPath) {
    return fetchVoiceAudioBlob(relativeApiUrl(audioPath));
  }

  async function playReadyChunks(tray, replyElement, signal) {
    const ready = [...tray.querySelectorAll('.voice-chunk.ready')];
    if (!ready.length) {
      GP.write('no voice chunks are ready yet.', 'hint');
      return;
    }
    for (const button of ready) {
      if (!button.isConnected || signal?.aborted) return;
      if (!button.dataset.audioUrl) continue;
      if (!await playAudioUrlIfAllowed(button.dataset.audioUrl, replyElement, { waitForEnd: true })) break;
    }
  }

  async function prepareChunkedReplyVoice(replyElement, text, options = {}) {
    if (replyElement.dataset.chunkedVoice === '1') return;
    const operation = beginVoiceOperation(replyElement);
    const signal = operation.controller.signal;
    replyElement.dataset.chunkedVoice = '1';
    const tray = chunkTrayFor(replyElement);
    tray.querySelectorAll('.voice-chunk').forEach(button => {
      if (button.dataset.audioUrl) URL.revokeObjectURL(button.dataset.audioUrl);
    });
    tray.innerHTML = '';
    const chunks = splitVoiceChunks(text);

    const controls = document.createElement('div');
    controls.className = 'voice-chunk-controls';
    const status = document.createElement('span');
    status.className = 'voice-chunk-status';
    status.textContent = 'voice chunks queued';
    const gpu = document.createElement('span');
    gpu.className = 'gpu-activity-indicator';
    const playReady = document.createElement('button');
    playReady.type = 'button';
    playReady.className = 'terminal-button voice-play-ready';
    playReady.textContent = 'play ready';
    playReady.addEventListener('click', () => playReadyChunks(tray, replyElement).catch((error) => GP.write(`voice unavailable: ${error.message}`, 'error')));
    const processing = document.createElement('button');
    processing.type = 'button';
    processing.className = 'terminal-button voice-processing-toggle';
    processing.textContent = 'processing';
    processing.setAttribute('aria-expanded', 'false');
    const chunkList = document.createElement('div');
    chunkList.className = 'voice-chunk-list';
    chunkList.hidden = true;
    processing.addEventListener('click', () => {
      const expanded = chunkList.hidden;
      chunkList.hidden = !expanded;
      processing.setAttribute('aria-expanded', String(expanded));
    });
    controls.append(status, gpu, playReady, processing);
    tray.append(controls, chunkList);
    tray._chunkList = chunkList;
    tray._gpuIndicator = GP.startGpuIndicator?.(gpu) || null;

    if (!chunks.length) {
      status.textContent = 'no voice chunks to render';
      stopTrayGpuIndicator(tray);
      finishVoiceOperation(operation);
      return;
    }

    const buttons = chunks.map((chunkText, index) => renderChunkButton(tray, replyElement, {
      index,
      text: chunkText,
      status: 'queued'
    }, status, false));
    status.textContent = `${chunks.length} voice chunks rendering`;
    controls.classList.add('is-rendering');

    try {
      for (const button of buttons) {
        if (signal.aborted || !button.isConnected) break;
        await renderChunkAudio(button, replyElement, status, tray, operation);
      }
      updateChunkStatus(status, tray);
      if (!signal.aborted && options.autoplay) await playReadyChunks(tray, replyElement, signal);
    } catch (error) {
      if (error.name === 'AbortError') {
        buttons.forEach((button) => {
          if (!button.classList.contains('ready') && !button.classList.contains('failed')) {
            button.disabled = true;
            button.classList.remove('queued', 'rendering');
            button.classList.add('canceled');
          }
        });
        status.textContent = 'voice rendering stopped';
        controls.classList.remove('is-rendering');
        stopTrayGpuIndicator(tray);
      } else {
        status.textContent = `voice chunks unavailable: ${error.message}`;
        replyElement.dataset.chunkedVoice = '';
        buttons.forEach(button => {
          if (button.classList.contains('queued')) {
            button.classList.remove('queued');
            button.classList.add('failed');
            button.title = error.message;
          }
        });
        GP.write(`voice unavailable: ${error.message}`, 'error');
      }
    } finally {
      finishVoiceOperation(operation);
      updateChunkStatus(status, tray);
    }
  }

  function renderChunkButton(tray, replyElement, chunk, status, poll = true) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `voice-chunk ${chunk.status || 'queued'}`;
    button.textContent = chunk.text || `chunk ${Number(chunk.index || 0) + 1}`;
    button.disabled = chunk.status !== 'ready';
    button.dataset.statusUrl = chunk.status_url || `/api/voice/tts/jobs/${chunk.job_id}`;
    button.dataset.audioPath = chunk.audio_url || `/api/voice/tts/jobs/${chunk.job_id}.wav`;
    button.addEventListener('click', async () => {
      if (!button.dataset.audioUrl) return;
      await playAudioUrlIfAllowed(button.dataset.audioUrl, replyElement);
    });
    (tray._chunkList || tray).appendChild(button);
    if (chunk.status === 'ready') {
      markChunkReady(button, chunk.audio_url, status, tray);
      return button;
    }
    if (poll) pollChunk(button, status, tray);
    return button;
  }

  async function renderChunkAudio(button, replyElement, status, tray, operation) {
    button.classList.remove('queued', 'ready', 'failed', 'canceled');
    button.classList.add('rendering');
    status.textContent = `${tray.querySelectorAll('.voice-chunk.ready').length}/${tray.querySelectorAll('.voice-chunk').length} ready`;
    try {
      const { job, url } = await requestVoiceJob(button.textContent, operation);
      if (operation.controller.signal.aborted || !button.isConnected) { URL.revokeObjectURL(url); throw abortError(); }
      button.dataset.jobId = job.job_id;
      button.dataset.statusUrl = job.status_url;
      button.dataset.audioPath = job.audio_url;
      button.dataset.audioUrl = url;
      await markChunkReady(button, job.audio_url, status, tray);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      button.disabled = true;
      button.classList.remove('queued', 'rendering', 'ready');
      button.classList.add('failed');
      button.textContent = `failed: ${button.textContent}`;
      button.title = error.message;
      updateChunkStatus(status, tray);
      throw error;
    }
  }

  async function pollChunk(button, status, tray) {
    if (!button.isConnected || button.classList.contains('canceled')) return;
    try {
      const data = await fetchJobStatus(button.dataset.statusUrl);
      const nextStatus = data.status || 'queued';
      button.classList.remove('queued', 'rendering', 'ready', 'failed');
      button.classList.add(nextStatus);
      if (nextStatus === 'ready') {
        markChunkReady(button, data.audio_url || button.dataset.audioPath, status, tray);
        return;
      }
      if (nextStatus === 'failed' || nextStatus === 'canceled') {
        button.disabled = true;
        if (nextStatus === 'failed') button.textContent = `failed: ${button.textContent}`;
        updateChunkStatus(status, tray);
        return;
      }
      window.setTimeout(() => pollChunk(button, status, tray), 1200);
      updateChunkStatus(status, tray);
    } catch (_error) {
      window.setTimeout(() => pollChunk(button, status, tray), 1800);
    }
  }

  async function markChunkReady(button, audioPath, status, tray) {
    if (!button.isConnected || button.classList.contains('canceled')) return;
    button.disabled = false;
    button.classList.remove('queued', 'rendering', 'failed', 'canceled');
    button.classList.add('ready');
    if (!button.dataset.audioUrl) {
      try {
        button.dataset.audioUrl = await fetchChunkAudioBlob(audioPath || button.dataset.audioPath);
      } catch (error) {
        button.disabled = true;
        button.classList.remove('ready');
        button.classList.add('failed');
        button.textContent = `failed: ${button.textContent}`;
      }
    }
    updateChunkStatus(status, tray);
  }

  function updateChunkStatus(status, tray) {
    const total = tray.querySelectorAll('.voice-chunk').length;
    const ready = tray.querySelectorAll('.voice-chunk.ready').length;
    const failed = tray.querySelectorAll('.voice-chunk.failed').length;
    const canceled = tray.querySelectorAll('.voice-chunk.canceled').length;
    const suffix = [failed ? `${failed} failed` : '', canceled ? `${canceled} canceled` : ''].filter(Boolean).join(', ');
    status.textContent = `${ready}/${total} ready${suffix ? `, ${suffix}` : ''}`;
    const rendering = Boolean(total && ready + failed + canceled < total);
    status.closest('.voice-chunk-controls')?.classList.toggle('is-rendering', rendering);
    if (total && !rendering) stopTrayGpuIndicator(tray);
  }

  async function toggleReplyVoice(replyElement, text) {
    const account = GP.state.account;
    const session = GP.token();
    const current = () => GP.state.account === account && GP.token() === session && replyElement.isConnected;
    if (!account || !current()) return;
    if (voiceOperations.has(replyElement)) { stopVoiceActivity('', replyElement); return; }
    if (GP.state.activeVoiceReply === replyElement && GP.state.activeVoiceAudio) {
      stopActiveVoice();
      return;
    }
    if (replyElement.dataset.audioUrl) {
      await playAudioUrlIfAllowed(replyElement.dataset.audioUrl, replyElement);
      return;
    }
    const backend = await voiceBackendMode();
    if (backend.backend !== 'vast' && shouldUseChunkedVoice(text)) {
      const tray = replyElement.nextElementSibling?.classList?.contains('voice-chunk-tray')
        ? replyElement.nextElementSibling
        : null;
      if (replyElement.dataset.chunkedVoice === '1' && tray) {
        await playReadyChunks(tray, replyElement);
        return;
      }
      await prepareChunkedReplyVoice(replyElement, text, { autoplay: true });
      return;
    }
    const rendering = GP.animatedStatusLine('voice rendering', { dots: false, bright: true });
    const operation = beginVoiceOperation(replyElement);
    try {
      const { url } = backend.backend === 'vast'
        ? await requestFullVoice(text, operation)
        : await requestVoiceJob(text, operation);
      if (!current()) { URL.revokeObjectURL(url); rendering.remove(); return; }
      replyElement.dataset.audioUrl = url;
      rendering.remove();
      await playAudioUrlIfAllowed(url, replyElement);
    } catch (error) {
      rendering.remove();
      if (current() && error.name !== 'AbortError') throw error;
    } finally {
      finishVoiceOperation(operation);
    }
  }

  GP.fetchVoiceAudioBlob = fetchVoiceAudioBlob;
  GP.stopActiveVoice = stopActiveVoice;
  GP.stopVoiceActivity = stopVoiceActivity;
  GP.playAudioUrl = playAudioUrl;
  GP.prepareChunkedReplyVoice = prepareChunkedReplyVoice;
  GP.toggleReplyVoice = toggleReplyVoice;
})(window.GhostProtocol);
