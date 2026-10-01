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
    else if (action) return;
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
      if (button.dataset.staticLabel === 'true') continue;
      const value = button.dataset.value;
      if (value === ' ') continue;
      button.textContent = !symbols && shifted ? value.toUpperCase() : value;
      button.setAttribute('aria-label', button.textContent);
    }
    panel.querySelector('[data-action="shift"]')?.setAttribute('aria-pressed', String(shifted));
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
    const functionRow = document.createElement('div');
    functionRow.className = 'keyboard-function-row';
    const body = document.createElement('div');
    body.className = 'keyboard-full-body';
    const main = document.createElement('div');
    main.className = 'keyboard-full-main';
    const middle = document.createElement('div');
    middle.className = 'keyboard-full-middle';
    const nav = document.createElement('div');
    nav.className = 'keyboard-nav-grid';
    const arrows = document.createElement('div');
    arrows.className = 'keyboard-arrow-grid';
    const numpad = document.createElement('div');
    numpad.className = 'keyboard-numpad';
    middle.append(nav, arrows);
    body.append(main, middle, numpad);
    layout.append(functionRow, body);
    panel.appendChild(layout);

    function fullKey(parent, label, options = {}) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `keyboard-key keyboard-full-key${options.className ? ` ${options.className}` : ''}`;
      button.textContent = label;
      button.title = options.name || label.replace(/\n/g, ' ');
      button.setAttribute('aria-label', button.title);
      button.dataset.staticLabel = 'true';
      if (options.action) button.dataset.action = options.action;
      else if (options.value !== undefined) button.dataset.value = options.value;
      else button.dataset.action = 'noop';
      if (options.col) button.style.gridColumn = options.col;
      if (options.row) button.style.gridRow = options.row;
      parent.appendChild(button);
      return button;
    }

    function spacer(parent, className = '') {
      const gap = document.createElement('div');
      gap.className = `keyboard-full-spacer${className ? ` ${className}` : ''}`;
      parent.appendChild(gap);
    }

    fullKey(functionRow, 'ESC', { action: 'noop' });
    spacer(functionRow, 'is-wide');
    ['F1', 'F2', 'F3', 'F4'].forEach(label => fullKey(functionRow, label, { action: 'noop' }));
    spacer(functionRow);
    ['F5', 'F6', 'F7', 'F8'].forEach(label => fullKey(functionRow, label, { action: 'noop' }));
    spacer(functionRow);
    ['F9', 'F10', 'F11', 'F12'].forEach(label => fullKey(functionRow, label, { action: 'noop' }));
    spacer(functionRow);
    fullKey(functionRow, 'PRTSC\nSYSRQ', { action: 'noop' });
    fullKey(functionRow, 'SCROLL\nLOCK', { action: 'noop' });
    fullKey(functionRow, 'PAUSE\nBREAK', { action: 'noop' });

    [
      ['~\n`', '`'], ['!\n1', '1'], ['@\n2', '2'], ['#\n3', '3'], ['$\n4', '4'],
      ['%\n5', '5'], ['^\n6', '6'], ['&\n7', '7'], ['*\n8', '8'], ['(\n9', '9'],
      [')\n0', '0'], ['_\n-', '-'], ['+\n=', '=']
    ].forEach(([label, value], index) => fullKey(main, label, { value, row: '1', col: String(index + 1) }));
    fullKey(main, 'BACKSPACE\n\u2190', { action: 'backspace', row: '1', col: '14 / span 2', className: 'is-wide' });

    fullKey(main, 'TAB\n\u21e4', { value: '\t', row: '2', col: '1 / span 2', className: 'is-wide' });
    'qwertyuiop'.split('').forEach((letter, index) => fullKey(main, letter.toUpperCase(), { value: letter, row: '2', col: String(index + 3) }));
    fullKey(main, '{\n[', { value: '[', row: '2', col: '13' });
    fullKey(main, '}\n]', { value: ']', row: '2', col: '14' });
    fullKey(main, '|\n\\', { value: '\\', row: '2', col: '15' });

    fullKey(main, 'CAPS LOCK', { action: 'shift', row: '3', col: '1 / span 2', className: 'is-wide' });
    'asdfghjkl'.split('').forEach((letter, index) => fullKey(main, letter.toUpperCase(), { value: letter, row: '3', col: String(index + 3) }));
    fullKey(main, ':\n;', { value: ';', row: '3', col: '12' });
    fullKey(main, '"\n\'', { value: '\'', row: '3', col: '13' });
    fullKey(main, 'ENTER\n\u21b5', { action: 'enter', row: '3', col: '14 / span 2', className: 'is-wide' });

    fullKey(main, '\u2b06 SHIFT', { action: 'shift', row: '4', col: '1 / span 3', className: 'is-wide is-shift' });
    'zxcvbnm'.split('').forEach((letter, index) => fullKey(main, letter.toUpperCase(), { value: letter, row: '4', col: String(index + 4) }));
    fullKey(main, '<\n,', { value: ',', row: '4', col: '11' });
    fullKey(main, '>\n.', { value: '.', row: '4', col: '12' });
    fullKey(main, '?\n/', { value: '/', row: '4', col: '13' });
    fullKey(main, '\u2b06 SHIFT', { action: 'shift', row: '4', col: '14 / span 2', className: 'is-wide is-shift' });

    fullKey(main, 'CTRL', { action: 'noop', row: '5', col: '1' });
    fullKey(main, '\u25a3', { action: 'noop', row: '5', col: '2', name: 'System key' });
    fullKey(main, 'ALT', { action: 'noop', row: '5', col: '3' });
    fullKey(main, 'SPACE', { value: ' ', row: '5', col: '4 / span 7', className: 'is-space' });
    fullKey(main, 'ALT', { action: 'noop', row: '5', col: '11' });
    fullKey(main, 'FN', { action: 'noop', row: '5', col: '12' });
    fullKey(main, '\u2630', { action: 'noop', row: '5', col: '13', name: 'Menu' });
    fullKey(main, 'CTRL', { action: 'noop', row: '5', col: '14 / span 2' });

    [
      ['INSERT', '1', '1'], ['HOME', '2', '1'], ['PAGE\nUP', '3', '1'],
      ['DELETE', '1', '2'], ['END', '2', '2'], ['PAGE\nDOWN', '3', '2']
    ].forEach(([label, col, navRow]) => fullKey(nav, label, { action: 'noop', col, row: navRow }));

    fullKey(arrows, '\u2b06', { action: 'up', col: '2', row: '1', name: 'Move cursor up' });
    fullKey(arrows, '\u25c0', { action: 'left', col: '1', row: '2', name: 'Move cursor left' });
    fullKey(arrows, '\u2b07', { action: 'down', col: '2', row: '2', name: 'Move cursor down' });
    fullKey(arrows, '\u25b6', { action: 'right', col: '3', row: '2', name: 'Move cursor right' });

    [
      ['NUM\nLOCK', 'noop', '1', '1'], ['/', '/', '2', '1'], ['*', '*', '3', '1'], ['-', '-', '4', '1'],
      ['7\nHOME', '7', '1', '2'], ['8\n\u2b06', '8', '2', '2'], ['9\nPG UP', '9', '3', '2'],
      ['4\n\u25c0', '4', '1', '3'], ['5', '5', '2', '3'], ['6\n\u25b6', '6', '3', '3'],
      ['1\nEND', '1', '1', '4'], ['2\n\u2b07', '2', '2', '4'], ['3\nPG DN', '3', '3', '4']
    ].forEach(([label, value, col, numRow]) => {
      const opts = value === 'noop' ? { action: 'noop', col, row: numRow } : { value, col, row: numRow };
      fullKey(numpad, label, opts);
    });
    fullKey(numpad, '+', { value: '+', col: '4', row: '2 / span 2', className: 'is-tall' });
    fullKey(numpad, '0\nINS', { value: '0', col: '1 / span 2', row: '5', className: 'is-wide' });
    fullKey(numpad, '.\nDEL', { value: '.', col: '3', row: '5' });
    fullKey(numpad, 'ENTER', { action: 'enter', col: '4', row: '4 / span 2', className: 'is-tall' });
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
