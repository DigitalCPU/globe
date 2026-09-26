(function (GP) {
  async function fetchVoiceAudioBlob(audioPath) {
    const response = await fetch(`${GP.API_BASE}${audioPath || '/api/voice/last.wav'}?t=${Date.now()}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
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
      await playAudioUrl(replyElement.dataset.audioUrl, replyElement);
      return;
    }
    const rendering = GP.animatedStatusLine('voice rendering');
    try {
      const data = await GP.api('/api/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text, agent_id: replyElement?.dataset.agentId || 'ghost_host' })
      });
      if (!current()) { rendering.remove(); return; }
      const url = await fetchVoiceAudioBlob(data.audio_url || '/api/voice/last.wav');
      if (!current()) { URL.revokeObjectURL(url); rendering.remove(); return; }
      replyElement.dataset.audioUrl = url;
      rendering.remove();
      await playAudioUrl(url, replyElement);
    } catch (error) {
      rendering.remove();
      if (current()) throw error;
    }
  }

  GP.fetchVoiceAudioBlob = fetchVoiceAudioBlob;
  GP.stopActiveVoice = stopActiveVoice;
  GP.playAudioUrl = playAudioUrl;
  GP.toggleReplyVoice = toggleReplyVoice;
})(window.GhostProtocol);
