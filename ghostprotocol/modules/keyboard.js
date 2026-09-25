(function (GP) {
  const toggle = document.getElementById('keyboardToggle');
  const panel = document.getElementById('virtualKeyboard');
  const terminal = document.querySelector('.terminal');
  const textTypes = new Set(['text', 'search', 'tel', 'url', 'email', 'password']);
  const originalModes = new Map();
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
  }

  function selection(field) {
    return [field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length];
  }

  function setSelection(field, start, end = start) {
    // Email inputs do not expose the selection API.
    if (field.selectionStart !== null) field.setSelectionRange(start, end);
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
    else if (action === 'left' || action === 'right') moveCursor(field, action === 'left' ? -1 : 1);
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

  function render() {
    panel.replaceChildren();
    const layouts = symbols
      ? (shifted ? ['~`|\\^{}<>_', '.,;:?!\'"()', '+-=*/%&'] : ['1234567890', '@#$%&*-+=/', '()!?\'":'])
      : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    layouts.forEach((letters, index) => {
      const row = document.createElement('div');
      row.className = 'keyboard-row';
      if (index === 2) key(row, symbols ? '#+=' : '\u21e7', 'shift', 1.5, symbols ? 'More symbols' : 'Shift');
      for (const letter of letters) key(row, letter);
      if (index === 2) key(row, '\u232b', 'backspace', 1.5, 'Backspace');
      panel.appendChild(row);
    });
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    key(row, symbols ? 'abc' : '123', 'layout', 1.5, symbols ? 'Letters' : 'Numbers and symbols');
    key(row, '@');
    const space = key(row, 'space', null, 3, 'Space');
    space.dataset.value = ' ';
    key(row, '.');
    key(row, '\u2190', 'left', 1, 'Move cursor left');
    key(row, '\u2192', 'right', 1, 'Move cursor right');
    key(row, '\u21b5', 'enter', 1.5, 'Enter');
    panel.appendChild(row);
    updateKeys();
  }

  function stopRepeat() {
    window.clearTimeout(repeatTimer);
  }

  function setOpen(value) {
    stopRepeat();
    opened = value;
    toggle.setAttribute('aria-expanded', String(opened));
    panel.hidden = !opened;
    terminal.classList.toggle('keyboard-open', opened);
    if (opened) {
      render();
      prepareFields(terminal);
      observer.observe(terminal, { childList: true, subtree: true });
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

  document.addEventListener('focusin', event => {
    if (editable(event.target)) remember(event.target);
  });
  document.addEventListener('pointerdown', event => {
    if (opened && editable(event.target)) suppressNativeKeyboard(event.target);
  }, true);
  toggle.addEventListener('pointerdown', event => event.preventDefault());
  toggle.addEventListener('click', () => setOpen(!opened));
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
      setOpen(false);
    }
  }, true);
})(window.GhostProtocol);
