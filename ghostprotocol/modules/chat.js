(function (GP) {
  const CHAT_OPENING = [
    'You are speaking through GhostProtocol.',
    'Answer as a concise terminal assistant.',
    'Help with public GhostProtocol features: sign-in, upload, MyDatabase, camera, message board, and chat.',
    'Do not reveal backend paths, hidden commands, tokens, server internals, admin controls, or private implementation details.',
    'Do not use emojis or emoticons because voice output may pronounce them poorly.'
  ].join(' ');

  function visibleHistory() {
    return GP.state.chatMessages.slice(-12).map((message) => ({
      role: message.role,
      content: message.content
    }));
  }

  function enterChat() {
    if (!GP.requireAccount()) return;
    GP.state.chatMode = true;
    GP.state.chatMessages = [];
    GP.write('AI session opened.');
    GP.write('type exit chat to return to terminal.');
    GP.commandButton('voice options', 'voice options');
    GP.commandButton('AI options', 'AI options');
    GP.commandButton('voice on', 'voice on');
    GP.commandButton('voice off', 'voice off');
    GP.write('');
  }

  function exitChat() {
    GP.state.chatMode = false;
    GP.write('AI session closed.');
  }

  function audioButton(label, handler) {
    const button = GP.inlineButton(label, handler);
    button.classList.add('voice-playback-button');
    GP.dom.screen.appendChild(button);
    GP.autoScroll();
    return button;
  }

  function animatedStatusLine(text) {
    const line = document.createElement('div');
    let tick = 0;
    line.className = 'line hint terminal-pulse';
    line.textContent = text;
    GP.dom.screen.appendChild(line);
    GP.autoScroll();
    const timer = window.setInterval(() => {
      tick = (tick + 1) % 4;
      line.textContent = `${text}${'.'.repeat(tick + 1)}`;
    }, 420);
    return {
      element: line,
      remove() {
        window.clearInterval(timer);
        line.remove();
      }
    };
  }

  function writeOptionValue(label, value) {
    GP.write(`${label}: ${value || '--'}`);
  }

  function setVoiceOutput(enabled) {
    GP.state.voiceOutputEnabled = Boolean(enabled);
    localStorage.setItem(GP.voiceEnabledKey, enabled ? 'on' : 'off');
    GP.write(`voice output: ${enabled ? 'on' : 'off'}`);
  }

  async function showVoiceOptions() {
    GP.write('voice options');
    writeOptionValue('chat voice output', GP.state.voiceOutputEnabled ? 'on' : 'off');
    GP.commandButton('voice on', 'voice on');
    GP.commandButton('voice off', 'voice off');
    try {
      const data = await GP.api('/api/voice/status');
      writeOptionValue('voice enabled', data.voice_enabled ? 'yes' : 'no');
      writeOptionValue('votronix', data.votronix_running ? 'running' : 'not running');
      writeOptionValue('tts', data.tts_ready ? 'ready' : 'not ready');
      writeOptionValue('provider', data.default_tts_provider);
      writeOptionValue('voice', data.default_voice_id);
      if (data.gpu?.label) writeOptionValue('gpu', data.gpu.label);
    } catch (error) {
      GP.write(`voice options unavailable: ${error.message}`, 'error');
    }
  }

  async function showAiOptions() {
    GP.write('AI options');
    try {
      const data = await GP.api('/api/status');
      writeOptionValue('backend', data.ready ? 'ready' : 'not ready');
      writeOptionValue('model', data.model);
      if (data.host && data.port) writeOptionValue('local endpoint', `${data.host}:${data.port}`);
    } catch (error) {
      GP.write(`AI options unavailable: ${error.message}`, 'error');
    }
  }

  async function fetchVoiceAudioBlob(audioPath) {
    const response = await fetch(`${GP.API_BASE}${audioPath || '/api/voice/last.wav'}?t=${Date.now()}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
    });
    if (!response.ok) throw new Error(`voice audio failed: ${response.status}`);
    return URL.createObjectURL(await response.blob());
  }

  async function playAudioUrl(url, button) {
    if (GP.state.activeVoiceAudio) {
      GP.state.activeVoiceAudio.pause();
      GP.state.activeVoiceAudio = null;
    }
    const audio = new Audio(url);
    GP.state.activeVoiceAudio = audio;
    audio.addEventListener('ended', () => {
      if (button) button.textContent = 'replay voice';
      if (GP.state.activeVoiceAudio === audio) GP.state.activeVoiceAudio = null;
    }, { once: true });
    await audio.play();
    if (button) button.textContent = 'playing voice';
  }

  async function speakReply(text) {
    const rendering = animatedStatusLine('voice rendering');
    try {
      const data = await GP.api('/api/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      const url = await fetchVoiceAudioBlob(data.audio_url || '/api/voice/last.wav');
      rendering.remove();
      const play = audioButton('play voice', () => {
        playAudioUrl(url, play).catch((error) => GP.write(`voice playback blocked: ${error.message}`, 'error'));
      });
      try {
        await playAudioUrl(url, play);
      } catch (error) {
        play.textContent = 'tap to play voice';
        GP.write('voice ready. tap play voice if the browser blocked autoplay.');
      }
    } catch (error) {
      rendering.remove();
      GP.write(`voice unavailable: ${error.message}`, 'error');
    }
  }

  async function sendChat(text) {
    const prompt = String(text || '').trim();
    if (!prompt) return;
    const key = GP.commandKey(prompt);
    if (key === 'voiceoptions') {
      await showVoiceOptions();
      return;
    }
    if (key === 'voiceon') {
      setVoiceOutput(true);
      return;
    }
    if (key === 'voiceoff') {
      setVoiceOutput(false);
      return;
    }
    if (key === 'aioptions') {
      await showAiOptions();
      return;
    }
    GP.write(`you> ${prompt}`);
    const thinking = animatedStatusLine('ai thinking');
    try {
      const messages = [
        { role: 'user', content: CHAT_OPENING },
        ...visibleHistory(),
        { role: 'user', content: prompt }
      ];
      const data = await GP.api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages })
      });
      const reply = String(data.reply || data.choices?.[0]?.message?.content || '').trim();
      if (!reply) throw new Error('empty AI reply');
      GP.state.chatMessages.push({ role: 'user', content: prompt });
      GP.state.chatMessages.push({ role: 'assistant', content: reply });
      thinking.remove();
      GP.write(`ai> ${reply}`);
      if (GP.state.voiceOutputEnabled) {
        void speakReply(reply);
      } else {
        GP.write('voice output is off.', 'hint');
      }
    } catch (error) {
      thinking.remove();
      GP.write(`chat failed: ${error.message}`, 'error');
    }
  }

  GP.enterChat = enterChat;
  GP.exitChat = exitChat;
  GP.sendChat = sendChat;
  GP.showVoiceOptions = showVoiceOptions;
  GP.showAiOptions = showAiOptions;
  GP.setVoiceOutput = setVoiceOutput;
})(window.GhostProtocol);
