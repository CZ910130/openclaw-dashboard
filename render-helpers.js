function getRoleColor(role) {
  return role === 'user' ? 'var(--blue)' : role === 'assistant' ? 'var(--green)' : 'var(--yellow)';
}

function createMutedNote(text, className = 'ui-muted-note') {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

function createLabeledValue(label, value, options = {}) {
  const {
    valueColor = '',
    valueSize = '13px',
    valueWeight = '',
    valueClass = '',
    mono = false,
    subText = '',
    compactLabel = false,
    valueBreakAll = false,
    containerClass = ''
  } = options;

  const box = document.createElement('div');
  if (containerClass) box.className = containerClass;

  const labelEl = document.createElement('div');
  labelEl.className = compactLabel ? 'ui-meta-label ui-meta-label-compact' : 'ui-meta-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'ui-meta-value';
  if (valueClass) valueEl.classList.add(...valueClass.split(' ').filter(Boolean));
  if (mono) valueEl.classList.add('mono');
  if (valueBreakAll) valueEl.classList.add('ui-break-all');
  valueEl.style.fontSize = valueSize;
  if (valueWeight) valueEl.style.fontWeight = valueWeight;
  if (valueColor) valueEl.style.color = valueColor;
  valueEl.textContent = value;

  box.appendChild(labelEl);
  box.appendChild(valueEl);

  if (subText) {
    const subEl = document.createElement('div');
    subEl.className = 'ui-meta-sub mono';
    subEl.textContent = subText;
    box.appendChild(subEl);
  }

  return box;
}

function createSessionMessageRow(message, options = {}) {
  const { compact = false } = options;
  const row = document.createElement('div');
  row.className = compact ? 'session-message-row session-message-row-compact' : 'session-message-row';

  const head = document.createElement('div');
  head.className = 'session-message-head';

  const role = document.createElement('span');
  role.className = 'session-message-role';
  role.style.color = getRoleColor(message.role);
  role.textContent = message.role || '';

  const timeEl = document.createElement('span');
  timeEl.className = 'session-message-time';
  timeEl.textContent = message.timestamp ? new Date(message.timestamp).toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'}) : '';

  const body = document.createElement('div');
  body.className = compact ? 'session-message-body session-message-body-compact mono' : 'session-message-body mono';
  body.textContent = message.content || '';

  head.appendChild(role);
  head.appendChild(timeEl);
  row.appendChild(head);
  row.appendChild(body);
  return row;
}

function renderSessionMessages(container, messages, options = {}) {
  const { emptyText = 'No messages', compact = false, loadingText = '' } = options;
  container.innerHTML = '';
  if (loadingText) {
    container.appendChild(createMutedNote(loadingText));
    return;
  }
  if (!messages.length) {
    container.appendChild(createMutedNote(emptyText));
    return;
  }
  messages.forEach(message => container.appendChild(createSessionMessageRow(message, { compact })));
}
