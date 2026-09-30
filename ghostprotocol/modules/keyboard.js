(function (GP) {
  const toggle = document.getElementById('keyboardToggle');
  const panel = document.getElementById('virtualKeyboard');
  const terminal = document.querySelector('.terminal');
  const textTypes = new Set(['text', 'search', 'tel', 'url', 'email', 'password']);
  const originalModes = new Map();
  let keyboardMode = 'closed';
  let opened = false;
  let target = GP.dom.input;
  let symbols = false;
  let shifted = false;
  let repeatTimer;
  let repeating = false;
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  function editable(field) {
    return (field instanceof HTMLTextAreaElement ||
      (field instanceof HTMLInputElement && textTypes.has(field.type))) &&
      !field.disabled && !field.readOnly;
  }

  function suppressNativeKeyboard(field) {
    if (!editable(field) || originalModes.has(field)) return;
    originalModes.set(field, field.getAttribute('inputmode'));
    field.setAttribute('inputmode', 'none');
  }

  function prepareFields(root) {
    if (!(root instanceof Element)) return;
    suppressNativeKeyboard(root);
    root.querySelectorAll('input, textarea').forEach(suppressNativeKeyboard);
  }

  // Only watch while open, so dynamically created forms also use this keyboard.
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) prepareFields(node);
    }
    for (const field of originalModes.keys()) {
      if (!field.isConnected) restoreMode(field);
    }
  });

  function restoreMode(field) {
    const mode = originalModes.get(field);
    if (mode === null) field.removeAttribute('inputmode');
    else field.setAttribute('inputmode', mode);
    originalModes.delete(field);
  }

  function remember(field) {
    target?.classList.remove('keyboard-target');
    target = field;
    if (opened) {
      suppressNativeKeyboard(field);
      field.classList.add('keyboard-target');
    }
  }

  function activeField() {
    if (!target?.isConnected || !editable(target) || !target.getClientRects().length) {
      remember(GP.dom.input);
    }
    return editable(target) ? target : null;
  }

  function focusField(field) {
    suppressNativeKeyboard(field);
    field.focus({ preventScroll: true });
    if (GP.dom.screen.contains(field)) field.scrollIntoView({ block: 'nearest' });
    revealCaret(field);
  }

  function selection(field) {
    return [field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length];
  }

  function setSelection(field, start, end = start) {
    // Email inputs do not expose the selection API.
    if (field.selectionStart !== null) field.setSelectionRange(start, end);
    revealCaret(field);
  }

  function revealCaret(field) {
    if (!editable(field)) return;
    window.requestAnimationFrame(() => {
      if (!field.isConnected) return;
      const position = field.selectionEnd ?? field.value.length;
      if (field instanceof HTMLInputElement) {
        const maxScroll = Math.max(0, field.scrollWidth - field.clientWidth);
        if (position >= field.value.length - 1) {
          field.scrollLeft = field.scrollWidth;
        } else {
          const ratio = field.value.length ? position / field.value.length : 0;
          field.scrollLeft = Math.max(0, Math.min(maxScroll, maxScroll * ratio));
        }
      } else if (field instanceof HTMLTextAreaElement && position >= field.value.length - 1) {
        field.scrollTop = field.scrollHeight;
      }
    });
  }

  function boundaries(text) {
    const parts = segmenter ? [...segmenter.segment(text)].map(part => part.segment) : Array.from(text);
    const offsets = [0];
    for (const part of parts) offsets.push(offsets[offsets.length - 1] + part.length);
    return offsets;
  }

  function edit(field, text, backwards = false) {
    focusField(field);
    let [start, end] = selection(field);
    if (backwards && start === end) {
      start = boundaries(field.value).filter(offset => offset < start).pop() ?? 0;
    }
    const limit = field.maxLength;
    if (limit >= 0 && text.length > limit - (field.value.length - (end - start))) return;
    const inputType = backwards ? 'deleteContentBackward' : 'insertText';
    const data = backwards ? null : text;
    if (!field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }))) return;
    field.value = field.value.slice(0, start) + text + field.value.slice(end);
    setSelection(field, start + text.length);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }));
  }

  function moveCursor(field, direction) {
    focusField(field);
    const [start, end] = selection(field);
    const offsets = boundaries(field.value);
    const next = direction < 0
      ? (start !== end ? start : offsets.filter(offset => offset < start).pop() ?? 0)
      : (start !== end ? end : offsets.find(offset => offset > end) ?? field.value.length);
    setSelection(field, next);
  }

  function moveCursorVertical(field, direction) {
    focusField(field);
    if (!(field instanceof HTMLTextAreaElement)) return;
    const position = field.selectionEnd ?? field.value.length;
    const lines = field.value.slice(0, position).split('\n');
    const column = lines[lines.length - 1].length;
    const currentLine = lines.length - 1;
    const allLines = field.value.split('\n');
    const nextLine = Math.max(0, Math.min(allLines.length - 1, currentLine + direction));
    if (nextLine === currentLine) return;
    let next = 0;
    for (let index = 0; index < nextLine; index += 1) next += allLines[index].length + 1;
    next += Math.min(column, allLines[nextLine].length);
    setSelection(field, next);
  }

  function enter(field) {
    focusField(field);
    // Honor each form's existing Enter handler (including the AiTool composer).
    const proceed = field.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, shiftKey: shifted
    }));
    if (proceed) {
      if (field instanceof HTMLTextAreaElement) edit(field, '\n');
      else if (field.form) {
        const submit = field.form.querySelector('button[type="submit"], input[type="submit"]');
        if (!submit?.disabled) field.form.requestSubmit(submit || undefined);
      }
    }
    field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    shifted = false;
    updateKeys();
  }

  function press(button) {
    const action = button.dataset.action;
    if (action === 'layout') {
      symbols = !symbols;
      shifted = false;
      render();
      return;
    }
    if (action === 'shift') {
      shifted = !shifted;
      if (symbols) render();
      else updateKeys();
      return;
    }
    const field = activeField();
    if (!field) return;
    if (action === 'backspace') edit(field, '', true);
    else if (action === 'right' && GP.acceptPredictiveSuggestion?.()) return;
    else if (action === 'left' || action === 'right') moveCursor(field, action === 'left' ? -1 : 1);
    else if (action === 'up' || action === 'down') moveCursorVertical(field, action === 'up' ? -1 : 1);
    else if (action === 'enter') enter(field);
    else {
      const value = button.dataset.value;
      edit(field, !symbols && shifted ? value.toUpperCase() : value);
      if (!symbols && shifted) { shifted = false; updateKeys(); }
    }
  }

  function key(row, label, action, width = 1, name = label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keyboard-key';
    button.textContent = label;
    button.title = name;
    button.setAttribute('aria-label', name);
    button.style.setProperty('--key-width', width);
    if (action) button.dataset.action = action;
    else button.dataset.value = label;
    row.appendChild(button);
    return button;
  }

  function updateKeys() {
    for (const button of panel.querySelectorAll('[data-value]')) {
      const value = button.dataset.value;
      if (value === ' ') continue;
      button.textContent = !symbols && shifted ? value.toUpperCase() : value;
      button.setAttribute('aria-label', button.textContent);
    }
    panel.querySelector('[data-action="shift"]').setAttribute('aria-pressed', String(shifted));
  }

  function row(parent, className = '') {
    const element = document.createElement('div');
    element.className = `keyboard-row${className ? ` ${className}` : ''}`;
    parent.appendChild(element);
    return element;
  }

  function renderCompact() {
    panel.replaceChildren();
    const layouts = symbols
      ? (shifted ? ['~`|\\^{}<>_', '.,;:?!\'"()', '+-=*/%&'] : ['1234567890', '@#$%&*-+=/', '()!?\'":'])
      : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    layouts.forEach((letters, index) => {
      const keys = row(panel);
      if (index === 2) key(keys, symbols ? '#+=' : '\u21e7', 'shift', 1.5, symbols ? 'More symbols' : 'Shift');
      for (const letter of letters) key(keys, letter);
      if (index === 2) key(keys, '\u232b', 'backspace', 1.5, 'Backspace');
    });
    const keys = row(panel);
    key(keys, symbols ? 'abc' : '123', 'layout', 1.5, symbols ? 'Letters' : 'Numbers and symbols');
    key(keys, '@');
    const space = key(keys, 'space', null, 3, 'Space');
    space.dataset.value = ' ';
    key(keys, '.');
    key(keys, '\u2190', 'left', 1, 'Move cursor left');
    key(keys, '\u2192', 'right', 1, 'Move cursor right');
    key(keys, '\u21b5', 'enter', 1.5, 'Enter');
    updateKeys();
  }

  function renderFull() {
    panel.replaceChildren();
    const layout = document.createElement('div');
    layout.className = 'keyboard-full-layout';
    const main = document.createElement('div');
    main.className = 'keyboard-full-main';
    const side = document.createElement('div');
    side.className = 'keyboard-full-side';
    layout.append(main, side);
    panel.appendChild(layout);

    [
      ['`1234567890-=', '\u232b'],
      ['qwertyuiop[]\\'],
      ['asdfghjkl;\'', '\u21b5'],
      ['zxcvbnm,./', '\u21e7']
    ].forEach((parts, index) => {
      const keys = row(main, 'keyboard-full-row');
      if (index === 2) key(keys, 'caps', 'shift', 1.35, 'Shift');
      if (index === 3) key(keys, '\u21e7', 'shift', 1.8, 'Shift');
      for (const letter of parts[0]) key(keys, letter);
      if (parts[1] === '\u232b') key(keys, parts[1], 'backspace', 2.15, 'Backspace');
      else if (parts[1] === '\u21b5') key(keys, parts[1], 'enter', 2.2, 'Enter');
      else if (parts[1] === '\u21e7') key(keys, parts[1], 'shift', 2.2, 'Shift');
    });

    const bottom = row(main, 'keyboard-full-row');
    key(bottom, '123', 'layout', 1.35, symbols ? 'Letters' : 'Numbers and symbols');
    key(bottom, '@');
    const space = key(bottom, 'space', null, 7, 'Space');
    space.dataset.value = ' ';
    key(bottom, '.');
    key(bottom, ',');
    key(bottom, '\u2190', 'left', 1.2, 'Move cursor left');
    key(bottom, '\u2192', 'right', 1.2, 'Move cursor right');

    const numpad = document.createElement('div');
    numpad.className = 'keyboard-numpad';
    side.appendChild(numpad);
    ['789', '456', '123'].forEach(letters => {
      const keys = row(numpad, 'keyboard-numpad-row');
      for (const letter of letters) key(keys, letter);
    });
    const zero = row(numpad, 'keyboard-numpad-row');
    key(zero, '0', null, 2, '0');
    key(zero, '.');
    const ops = row(numpad, 'keyboard-numpad-row');
    ['+', '-', '/', '*'].forEach(letter => key(ops, letter));

    const arrows = document.createElement('div');
    arrows.className = 'keyboard-arrow-pad';
    side.appendChild(arrows);
    const up = row(arrows, 'keyboard-arrow-row');
    key(up, '\u2191', 'up', 1, 'Move cursor up');
    const down = row(arrows, 'keyboard-arrow-row');
    key(down, '\u2190', 'left', 1, 'Move cursor left');
    key(down, '\u2193', 'down', 1, 'Move cursor down');
    key(down, '\u2192', 'right', 1, 'Move cursor right');
    key(row(arrows, 'keyboard-arrow-row'), '\u21b5', 'enter', 3, 'Enter');
    updateKeys();
  }

  function render() {
    if (keyboardMode === 'full') renderFull();
    else renderCompact();
    updateKeys();
  }

  function stopRepeat() {
    window.clearTimeout(repeatTimer);
  }

  function updateToggleUi() {
    const expanded = keyboardMode !== 'closed';
    const title = keyboardMode === 'closed'
      ? 'Open keyboard'
      : keyboardMode === 'inline'
        ? 'Dock keyboard at bottom'
        : keyboardMode === 'docked'
          ? 'Use iPad width keyboard'
          : keyboardMode === 'wide'
            ? 'Use full desktop keyboard'
            : 'Close keyboard';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', title);
    toggle.title = title;
    toggle.dataset.mode = keyboardMode;
  }

  function setMode(value) {
    const nextMode = ['inline', 'docked', 'wide', 'full'].includes(value) ? value : 'closed';
    const wasOpened = opened;
    stopRepeat();
    keyboardMode = nextMode;
    opened = keyboardMode !== 'closed';
    updateToggleUi();
    panel.hidden = !opened;
    terminal.classList.toggle('keyboard-open', opened);
    terminal.classList.toggle('keyboard-inline', opened && keyboardMode === 'inline');
    terminal.classList.toggle('keyboard-docked', opened && (keyboardMode === 'docked' || keyboardMode === 'wide' || keyboardMode === 'full'));
    terminal.classList.toggle('keyboard-wide', opened && keyboardMode === 'wide');
    terminal.classList.toggle('keyboard-full', opened && keyboardMode === 'full');
    if (opened) {
      render();
      prepareFields(terminal);
      if (!wasOpened) observer.observe(terminal, { childList: true, subtree: true });
      const field = activeField();
      if (field) {
        const [start, end] = selection(field);
        // Refocus after changing inputmode to dismiss an already-open phone keyboard.
        field.blur();
        remember(field);
        focusField(field);
        setSelection(field, start, end);
      }
    } else {
      observer.disconnect();
      target?.classList.remove('keyboard-target');
      target?.blur();
      for (const field of originalModes.keys()) restoreMode(field);
      toggle.focus({ preventScroll: true });
    }
  }

  function setOpen(value) {
    setMode(value ? 'inline' : 'closed');
  }

  function cycleMode() {
    if (keyboardMode === 'closed') setMode('inline');
    else if (keyboardMode === 'inline') setMode('docked');
    else if (keyboardMode === 'docked') setMode('wide');
    else if (keyboardMode === 'wide') setMode('full');
    else setMode('closed');
  }

  GP.setKeyboardMode = setMode;
  GP.openKeyboard = () => setMode('inline');
  GP.dockKeyboard = () => setMode('docked');
  GP.wideKeyboard = () => setMode('wide');
  GP.fullKeyboard = () => setMode('full');
  GP.closeKeyboard = () => setMode('closed');
  GP.cycleKeyboard = cycleMode;
  GP.keyboardMode = () => keyboardMode;

  updateToggleUi();
  document.addEventListener('focusin', event => {
    if (editable(event.target)) remember(event.target);
  });
  document.addEventListener('pointerdown', event => {
    if (opened && editable(event.target)) suppressNativeKeyboard(event.target);
  }, true);
  toggle.addEventListener('pointerdown', event => event.preventDefault());
  toggle.addEventListener('click', cycleMode);
  panel.addEventListener('pointerdown', event => {
    const button = event.target.closest('button');
    if (!button || event.button !== 0) return;
    event.preventDefault();
    stopRepeat();
    repeating = false;
    if (button.dataset.action === 'backspace') {
      const field = activeField();
      repeatTimer = window.setTimeout(function repeat() {
        if (!opened || activeField() !== field) return;
        repeating = true;
        press(button);
        repeatTimer = window.setTimeout(repeat, 80);
      }, 450);
    }
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && !repeating) press(button);
    repeating = false;
  });
  window.addEventListener('pointerup', stopRepeat);
  window.addEventListener('pointercancel', stopRepeat);
  window.addEventListener('blur', stopRepeat);
  document.addEventListener('keydown', event => {
    if (opened && event.key === 'Escape') {
      event.preventDefault();
      setMode('closed');
    }
  }, true);
})(window.GhostProtocol);
