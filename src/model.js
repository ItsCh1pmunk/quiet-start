/** Pure bookmark/layout rules. No browser APIs or network access. */
export function folderList(tree) {
  const folders = [];
  function visit(node, parentPath = '') {
    if (node.url) return;
    const title = node.title || (node.id === '0' ? '全部书签' : '未命名文件夹');
    const path = parentPath ? `${parentPath} / ${title}` : title;
    folders.push({ ...node, title, path });
    for (const child of node.children || []) visit(child, node.id === '0' ? '' : path);
  }
  for (const node of tree || []) visit(node);
  return folders;
}

export function chooseFolder(tree, id) {
  const folders = folderList(tree);
  return folders.find(f => f.id === id) ||
    folders.find(f => f.folderType === 'bookmarks-bar') ||
    folders.find(f => f.id === '1') || folders.find(f => f.id !== '0') || folders[0] || null;
}

export function safeURL(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'chrome:', 'chrome-extension:', 'mailto:', 'ftp:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function sectionsFor(folder, grouped, query = '') {
  if (!folder) return [];
  const needle = query.trim().toLocaleLowerCase();
  const sections = [];
  function visit(node, path) {
    const items = (node.children || []).filter(child => {
      if (!child.url) return false;
      return safeURL(child.url) && (!needle || `${child.title} ${child.url}`.toLocaleLowerCase().includes(needle));
    });
    if (items.length) sections.push({ id: node.id, title: path || '收藏夹', items });
    for (const child of node.children || []) {
      if (!child.url) visit(child, path ? `${path} / ${child.title || '未命名文件夹'}` : child.title || '未命名文件夹');
    }
  }
  if (grouped || needle) visit(folder, '');
  else {
    const items = (folder.children || []).filter(child => !child.url || safeURL(child.url));
    if (items.length) sections.push({ id: folder.id, title: '收藏夹', items });
  }
  return sections;
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const clamp = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && value !== null && value !== '' ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return {
    folderId: typeof source.folderId === 'string' ? source.folderId : '',
    iconSize: clamp(source.iconSize, 64, 40, 88),
    columns: clamp(source.columns, 8, 4, 12),
    grouped: typeof source.grouped === 'boolean' ? source.grouped : true,
    lettersOnly: typeof source.lettersOnly === 'boolean' ? source.lettersOnly : false
  };
}

export function faviconURL(pageURL, baseURL, size) {
  try {
    if (!['http:', 'https:'].includes(new URL(pageURL).protocol)) return null;
    const url = new URL('_favicon/', baseURL);
    url.searchParams.set('pageUrl', pageURL);
    url.searchParams.set('size', String(size));
    return url.href;
  } catch { return null; }
}

export function initials(title, url) {
  let text = title?.trim();
  if (!text) {
    try { text = new URL(url).hostname.replace(/^www\./, ''); } catch { text = '?'; }
  }
  return Array.from(text || '?')[0].toLocaleUpperCase();
}
