(function (GP) {
  let activeVoiceController = null;

  async function fetchVoiceAudioBlob(audioPath) {
    const response = await fetch(`${GP.API_BASE}${audioPath || '/api/voice/last.wav'}?t=${Date.now()}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() },
      signal: activeVoiceController?.signal
    });
    if (!response.ok) throw new Error(`voice audio failed: ${response.status}`);
    return URL.createObjectURL(await response.blob());
  }

  function stopActiveVoice() {
    if (GP.state.activeVoiceAudio) {
      GP.state.activeVoiceAudio.pause();
      GP.state.activeVoiceAudio.currentTime = 0;
      GP.state.activeVoiceAudio = null;
    }
    if (GP.state.activeVoiceReply) {
      GP.state.activeVoiceReply.classList.remove('is-voice-playing');
      GP.state.activeVoiceReply = null;
    }
  }

  function stopVoiceActivity() {
    const activeChunks = document.querySelectorAll('.voice-chunk.queued, .voice-chunk.rendering');
    let stopped = Boolean(GP.state.activeVoiceAudio || GP.state.activeVoiceReply || activeVoiceController || activeChunks.length);
    activeVoiceController?.abort();
    activeVoiceController = null;
    stopActiveVoice();
    activeChunks.forEach((button) => {
      button.classList.remove('queued', 'rendering', 'ready', 'failed', 'canceled');
      button.classList.add('canceled');
      button.disabled = true;
    });
    document.querySelectorAll('.voice-chunk-status').forEach((status) => {
      status.textContent = 'voice rendering stopped';
    });
    void GP.api('/api/voice/tts/cancel', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
    return stopped;
  }
  async function playAudioUrl(url, replyElement) {
    stopActiveVoice();
    const audio = new Audio(url);
    GP.state.activeVoiceAudio = audio;
    GP.state.activeVoiceReply = replyElement || null;
    if (replyElement) replyElement.classList.add('is-voice-playing');
    audio.addEventListener('ended', () => {
      if (GP.state.activeVoiceAudio === audio) {
        GP.state.activeVoiceAudio = null;
        GP.state.activeVoiceReply = null;
      }
      if (replyElement) replyElement.classList.remove('is-voice-playing');
    }, { once: true });
    try {
      await audio.play();
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

  async function playAudioUrlIfAllowed(url, replyElement) {
    try {
      await playAudioUrl(url, replyElement);
      if (replyElement) replyElement.classList.remove('is-voice-ready');
      return true;
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

  function relativeApiUrl(path) {
    return String(path || '').startsWith('/') ? path : `/${path}`;
  }

  async function fetchJobStatus(statusUrl) {
    return GP.api(relativeApiUrl(statusUrl));
  }

  async function fetchChunkAudioBlob(audioPath) {
    return fetchVoiceAudioBlob(relativeApiUrl(audioPath));
  }

  async function playReadyChunks(tray, replyElement) {
    const ready = [...tray.querySelectorAll('.voice-chunk.ready')];
    if (!ready.length) {
      GP.write('no voice chunks are ready yet.', 'hint');
      return;
    }
    for (const button of ready) {
      if (!button.isConnected) return;
      if (!button.dataset.audioUrl) continue;
      await playAudioUrlIfAllowed(button.dataset.audioUrl, replyElement);
    }
  }

  async function prepareChunkedReplyVoice(replyElement, text) {
    if (replyElement.dataset.chunkedVoice === '1') return;
    replyElement.dataset.chunkedVoice = '1';
    const tray = chunkTrayFor(replyElement);
    tray.innerHTML = '';

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
    controls.append(status, gpu, playReady);
    tray.appendChild(controls);
    tray._gpuIndicator = GP.startGpuIndicator?.(gpu) || null;

    try {
      const data = await GP.api('/api/voice/tts/chunks', {
        method: 'POST',
        body: JSON.stringify({ text, agent_id: replyElement?.dataset.agentId || 'ghost_host', words_per_chunk: 5 })
      });
      const chunks = Array.isArray(data.chunks) ? data.chunks : [];
      status.textContent = `${chunks.length} voice chunks rendering`;
      if (!chunks.length) stopTrayGpuIndicator(tray);
      chunks.forEach((chunk) => renderChunkButton(tray, replyElement, chunk, status));
    } catch (error) {
      stopTrayGpuIndicator(tray);
      status.textContent = `voice chunks unavailable: ${error.message}`;
      replyElement.dataset.chunkedVoice = '';
    }
  }

  function renderChunkButton(tray, replyElement, chunk, status) {
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
    tray.appendChild(button);
    if (chunk.status === 'ready') {
      markChunkReady(button, chunk.audio_url, status, tray);
      return;
    }
    pollChunk(button, status, tray);
  }

  async function pollChunk(button, status, tray) {
    if (!button.isConnected) return;
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
    if (total && ready + failed + canceled >= total) stopTrayGpuIndicator(tray);
  }

  async function toggleReplyVoice(replyElement, text) {
    const account = GP.state.account;
    const session = GP.token();
    const current = () => GP.state.account === account && GP.token() === session && replyElement.isConnected;
    if (!account || !current()) return;
    if (GP.state.activeVoiceReply === replyElement && GP.state.activeVoiceAudio) {
      stopActiveVoice();
      return;
    }
    if (replyElement.dataset.audioUrl) {
      await playAudioUrlIfAllowed(replyElement.dataset.audioUrl, replyElement);
      return;
    }
    const rendering = GP.animatedStatusLine('voice rendering', { dots: false, bright: true });
    activeVoiceController?.abort();
    activeVoiceController = new AbortController();
    const signal = activeVoiceController.signal;
    try {
      const data = await GP.api('/api/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text, agent_id: replyElement?.dataset.agentId || 'ghost_host' }),
        signal
      });
      if (!current()) { rendering.remove(); return; }
      const url = await fetchVoiceAudioBlob(data.audio_url || '/api/voice/last.wav');
      if (!current()) { URL.revokeObjectURL(url); rendering.remove(); return; }
      replyElement.dataset.audioUrl = url;
      rendering.remove();
      await playAudioUrlIfAllowed(url, replyElement);
    } catch (error) {
      rendering.remove();
      if (current() && error.name !== 'AbortError') throw error;
    } finally {
      if (activeVoiceController?.signal === signal) activeVoiceController = null;
    }
  }

  GP.fetchVoiceAudioBlob = fetchVoiceAudioBlob;
  GP.stopActiveVoice = stopActiveVoice;
  GP.stopVoiceActivity = stopVoiceActivity;
  GP.playAudioUrl = playAudioUrl;
  GP.prepareChunkedReplyVoice = prepareChunkedReplyVoice;
  GP.toggleReplyVoice = toggleReplyVoice;
})(window.GhostProtocol);
