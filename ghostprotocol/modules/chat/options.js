(function (GP) {
  function writeOptionValue(label, value) {
    GP.write(`${label}: ${value || '--'}`);
  }

  function setVoiceOutput(enabled) {
    GP.state.voiceOutputEnabled = Boolean(enabled);
    localStorage.setItem(GP.voiceEnabledKey, enabled ? 'on' : 'off');
    document.querySelectorAll('[data-voice-setting="output"]').forEach(input => { input.checked = Boolean(enabled); });
    GP.write(`voice output: ${enabled ? 'on' : 'off'}`);
  }

  function setVoiceAutoplay(enabled) {
    GP.state.voiceAutoplayEnabled = Boolean(enabled);
    localStorage.setItem(GP.voiceAutoplayKey, enabled ? 'on' : 'off');
    document.querySelectorAll('[data-voice-setting="autoplay"]').forEach(input => { input.checked = Boolean(enabled); });
    GP.write(`voice auto play: ${enabled ? 'on' : 'off'}`);
  }

  async function showVoiceOptions() {
    GP.write('voice options');
    const controls = document.createElement('div');
    controls.className = 'voice-option-switches';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Voice options');
    for (const [name, labelText, checked, change] of [
      ['output', 'voice output', GP.state.voiceOutputEnabled, setVoiceOutput],
      ['autoplay', 'auto play', GP.state.voiceAutoplayEnabled, setVoiceAutoplay]
    ]) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.voiceSetting = name;
      input.checked = checked;
      input.addEventListener('change', () => change(input.checked));
      label.append(input, document.createTextNode(labelText));
      controls.appendChild(label);
    }
    GP.dom.screen.appendChild(controls);
    GP.autoScroll();
    try {
      const data = await GP.api('/api/voice/status');
      writeOptionValue('voice enabled', data.voice_enabled ? 'yes' : 'no');
      writeOptionValue('votronix', data.votronix_running ? 'running' : 'not running');
      writeOptionValue('tts', data.tts_ready ? 'ready' : 'not ready');
      writeOptionValue('provider', data.default_tts_provider);
      writeOptionValue('voice', data.default_voice_id);
      if (data.gpu?.label) writeOptionValue('gpu', data.gpu.label);
      await renderHostPresetSelector();
    } catch (error) {
      GP.write(`voice options unavailable: ${error.message}`, 'error');
    }
  }

  async function renderHostPresetSelector() {
    let presetsData;
    let resolvedData;
    try {
      [presetsData, resolvedData] = await Promise.all([
        GP.api('/api/voice/presets'),
        GP.api('/api/voice/resolve?agent_id=ghost_host')
      ]);
    } catch (error) {
      GP.write(`character presets unavailable: ${error.message}`, 'hint');
      return;
    }
    const presets = Array.isArray(presetsData.presets) ? presetsData.presets : [];
    const resolved = resolvedData.voice || {};
    const panel = document.createElement('div');
    panel.className = 'voice-option-switches voice-preset-picker';
    const label = document.createElement('label');
    label.textContent = 'Host preset ';
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = presets.length ? 'application default' : 'no saved character presets';
    select.appendChild(empty);
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.preset_id || '';
      option.textContent = preset.name || preset.preset_id || 'unnamed preset';
      if (option.value && option.value === resolved.preset_id) option.selected = true;
      select.appendChild(option);
    }
    select.disabled = presets.length === 0;
    select.addEventListener('change', async () => {
      try {
        const result = await GP.api('/api/voice/assign', {
          method: 'POST',
          body: JSON.stringify({
            agent_id: 'ghost_host',
            display_name: 'Host Assistant',
            preset_id: select.value,
            voice_enabled: true
          })
        });
        const voice = result.voice || {};
        GP.write(`host preset: ${voice.preset_name || 'application default'}`);
      } catch (error) {
        GP.write(`preset update failed: ${error.message}`, 'error');
      }
    });
    label.appendChild(select);
    panel.appendChild(label);
    if (resolved.preset_name || resolved.fallback_reason) {
      const note = document.createElement('span');
      note.className = 'hint';
      note.textContent = ` current: ${resolved.preset_name || resolved.fallback_reason}`;
      panel.appendChild(note);
    }
    GP.dom.screen.appendChild(panel);
    GP.autoScroll();
  }
  async function showAiOptions() {
    GP.write('AI options');
    try {
      const data = await GP.api('/api/status');
      writeOptionValue('backend', data.ready ? 'ready' : 'not ready');
      writeOptionValue('model', data.model);
      if (data.vision) {
        writeOptionValue('vision', data.vision.enabled ? data.vision.model : 'off');
      }
      if (data.host && data.port) writeOptionValue('local endpoint', `${data.host}:${data.port}`);
    } catch (error) {
      GP.write(`AI options unavailable: ${error.message}`, 'error');
    }
  }

  GP.showVoiceOptions = showVoiceOptions;
  GP.showAiOptions = showAiOptions;
  GP.setVoiceOutput = setVoiceOutput;
  GP.setVoiceAutoplay = setVoiceAutoplay;
})(window.GhostProtocol);
