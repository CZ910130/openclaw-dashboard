function appendInlineFormatted(parent, text) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  const str = String(text || '');
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(str.slice(last, m.index)));
    const token = m[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.className = 'markdown-strong';
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'inline-code-token';
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    }
    last = m.index + token.length;
  }
  if (last < str.length) parent.appendChild(document.createTextNode(str.slice(last)));
}

function renderSimpleMarkdown(target, content) {
  target.innerHTML = '';
  String(content || '').split('\n').forEach(line => {
    if (!line.trim()) {
      target.appendChild(document.createElement('br'));
      return;
    }
    const block = document.createElement('div');
    if (line.startsWith('### ')) {
      block.className = 'markdown-heading markdown-heading-h3';
      appendInlineFormatted(block, line.slice(4));
    } else if (line.startsWith('## ')) {
      block.className = 'markdown-heading markdown-heading-h2';
      appendInlineFormatted(block, line.slice(3));
    } else if (line.startsWith('# ')) {
      block.className = 'markdown-heading markdown-heading-h1';
      appendInlineFormatted(block, line.slice(2));
    } else {
      appendInlineFormatted(block, line);
    }
    target.appendChild(block);
  });
}

function setViewerMessage(target, message, color = 'var(--text-muted)') {
  target.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'viewer-message';
  div.style.color = color;
  div.textContent = message;
  target.appendChild(div);
}

// Memory page
let memoryFiles = [];
async function fetchMemoryFiles() {
  try {
    const res = await authFetch(API_BASE + '/api/memory-files');
    memoryFiles = await res.json();
    renderMemoryFilesList();
  } catch {}
}

function renderMemoryFilesList() {
  const el = document.getElementById('memoryFilesList');
  if (!el) return;
  const now = Date.now();
  if (!memoryFiles.length) {
    setEmptyState(el, 'No memory files');
    return;
  }
  el.innerHTML = '';
  memoryFiles.forEach(f => {
    const age = now - f.modified;
    const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
    const sizeKb = (f.size / 1024).toFixed(1);
    const icon = f.name.includes('MEMORY') ? '🧠' : f.name.includes('HEARTBEAT') ? '💓' : '📄';
    const item = document.createElement('div');
    item.className = 'memory-file-item';
    item.addEventListener('click', () => window.loadMemoryFile(encodeURIComponent(f.name)));

    const header = document.createElement('div');
    header.className = 'memory-file-header';

    const iconEl = document.createElement('span');
    iconEl.className = 'memory-file-icon';
    iconEl.textContent = icon;

    const nameEl = document.createElement('span');
    nameEl.className = 'memory-file-name';
    nameEl.textContent = f.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'memory-file-meta';
    metaEl.textContent = `${sizeKb} KB · ${ago}`;

    header.appendChild(iconEl);
    header.appendChild(nameEl);
    item.appendChild(header);
    item.appendChild(metaEl);
    el.appendChild(item);
  });
}
