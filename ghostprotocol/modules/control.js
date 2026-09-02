(function (GP) {
  function writeControlCommands() {
    GP.write('control panel ui access granted');
    GP.write('remote command center ready');
    GP.write(`device id: ${GP.deviceId()}`);
    GP.write('backend gate: owner account + remote-access on + trusted device');
    GP.write('');
    GP.write('system commands:');
    GP.write('  status');
    GP.write('  settings');
    GP.write('  preset balanced');
    GP.write('  preset cpu');
    GP.write('  preset long');
    GP.write('  set-temp <0..2>');
    GP.write('  set-tokens <count>');
    GP.write('  set-context <count>');
    GP.write('  set-gpu-layers <-1|0|count>');
    GP.write('  set-model <path>');
    GP.write('  load-model');
    GP.write('  unload-model');
    GP.write('  fxp3-status');
    GP.write('');
    GP.write('account commands:');
    GP.write('  account-list');
    GP.write('  account-show <user|id>');
    GP.write('  account-set-password <user|id> <new-password>');
    GP.write('  account-ranks');
    GP.write('  account-set-role <user|id> <rank>');
    GP.write('  account-ban <user|id>');
    GP.write('  account-unban <user|id>');
    GP.write('  account-punish <user|id>');
    GP.write('  account-reward <user|id>');
    GP.write('  account-delete <user|id> CONFIRM');
    GP.write('  account-delete <user|id> CONFIRM --delete-files');
    GP.write('  owner accounts cannot be deleted remotely');
    GP.write('');
    GP.write('  exit-control');
  }

  function formatControlValue(value, depth = 0) {
    if (value === null || value === undefined) return '--';
    if (typeof value !== 'object') return String(value);
    const lines = [];
    const indent = '  '.repeat(depth);
    Object.entries(value).forEach(([key, item]) => {
      if (item && typeof item === 'object') {
        lines.push(`${indent}${key}:`);
        lines.push(formatControlValue(item, depth + 1));
      } else {
        lines.push(`${indent}${key}: ${formatControlValue(item, depth + 1)}`);
      }
    });
    return lines.join('\n');
  }

  async function accessControlPanelUi() {
    if (!GP.requireAccount()) return;
    try {
      const data = await GP.api('/api/ghost/control/status');
      GP.state.controlMode = true;
      writeControlCommands();
      if (data.backend) {
        GP.write(`backend: ${data.backend.host}:${data.backend.port}`);
        GP.write(`model: ${data.backend.model_ready ? 'ready' : 'not ready'} / ${data.backend.model}`);
      }
    } catch (error) {
      GP.write(error.message || 'access denied', 'error');
    }
  }

  async function runControlCommand(command) {
    const lowered = command.trim().toLowerCase();
    if (lowered === 'exit-control' || lowered === 'exit control' || lowered === 'exit') {
      GP.state.controlMode = false;
      GP.write('control panel ui access closed');
      return;
    }
    try {
      const data = await GP.api('/api/ghost/control/command', {
        method: 'POST',
        body: JSON.stringify({ command })
      });
      GP.write(data.message || 'command complete');
      if (data.data) GP.write(formatControlValue(data.data));
    } catch (error) {
      GP.write(error.message || 'control command failed', 'error');
    }
  }

  GP.accessControlPanelUi = accessControlPanelUi;
  GP.runControlCommand = runControlCommand;
})(window.GhostProtocol);
