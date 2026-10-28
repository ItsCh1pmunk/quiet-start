import { folderList, chooseFolder, sectionsFor, safeURL, normalizeSettings, faviconURL, initials } from './model.js';

const $ = id => document.getElementById(id);
const PREFIX = 'quietStart.';
const FIELDS = Object.keys(normalizeSettings(null));
const KEYS = FIELDS.map(field => PREFIX + field);
function readSettings(values) {
  return normalizeSettings(Object.fromEntries(FIELDS.map(field => [field, values[PREFIX + field]])));
}
const state = { tree: [], settings: normalizeSettings(null), navigation: null, query: '', ready: false };
let refreshVersion = 0;
let refreshTimer;
let saveTimer;
let pendingPatch = {};
let saving = false;
let storageReady = false;
let saveFailed = false;
let loadingSettings = true;
let changesDuringLoad = {};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(message, retry) {
  const box = $('notice');
  box.replaceChildren();
  box.hidden = !message;
  if (!message) return;
  box.append(document.createTextNode(message));
  if (retry) {
    const button = element('button', 'text-button', '重试');
    button.type = 'button';
    button.addEventListener('click', retry);
    box.append(button);
  }
}

// Store each preference separately: simultaneous edits in other tabs cannot
// overwrite unrelated fields. Within this page, writes are serialized.
function updateSettings(patch) {
  pendingPatch = { ...pendingPatch, ...patch };
  state.settings = normalizeSettings({ ...state.settings, ...patch });
  saveFailed = false;
  $('save-status').textContent = '正在保存…';
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 120);
}
async function flushSettings() {
  if (saving || !Object.keys(pendingPatch).length) return;
  saving = true;
  const patch = pendingPatch;
  pendingPatch = {};
  try {
    await chrome.storage.local.set(Object.fromEntries(Object.entries(patch).map(([field, value]) => [PREFIX + field, value])));
    storageReady = true;
    saveFailed = false;
    // onChanged keeps all pages current; a read here could return a stale
    // snapshot and roll back a change received from another page.
    $('save-status').textContent = Object.keys(pendingPatch).length ? '正在保存…' : '已保存在本机';
  } catch {
    pendingPatch = { ...patch, ...pendingPatch };
    saveFailed = true;
    $('save-status').textContent = '保存失败，请重试';
    notice('设置未能保存。当前页面仍可使用。', () => { notice(''); flushSettings(); });
  } finally {
    saving = false;
    if (!saveFailed && Object.keys(pendingPatch).length) flushSettings();
  }
}

function createTile(item) {
  const folder = !item.url;
  const tile = element(folder ? 'button' : 'a', `bookmark${folder ? ' folder-tile' : ''}`);
  const name = item.title?.trim() || (folder ? '未命名文件夹' : new URL(item.url).hostname || item.url);
  tile.title = folder ? `打开文件夹：${name}` : `${name}\n${item.url}`;
  const icon = element('span', 'bookmark-icon');
  icon.setAttribute('aria-hidden', 'true');
  if (folder) {
    tile.type = 'button';
    tile.addEventListener('click', () => { state.navigation = item.id; render(); });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M2 7a3 3 0 0 1 3-3h5l2 2h7a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z');
    svg.append(path); icon.append(svg);
  } else {
    tile.href = safeURL(item.url);
    tile.rel = 'noreferrer noopener';
    tile.referrerPolicy = 'no-referrer';
    let hash = 0;
    for (const char of item.url) hash = (hash * 31 + char.codePointAt(0)) | 0;
    icon.dataset.tint = String(Math.abs(hash) % 6);
    const letter = element('span', 'bookmark-letter', initials(item.title, item.url));
    icon.append(letter);
    const src = state.settings.lettersOnly ? null : faviconURL(item.url, chrome.runtime.getURL('/'), 64);
    if (src) {
      const img = new Image();
      img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      img.addEventListener('load', () => { img.classList.add('loaded'); letter.hidden = true; });
      img.addEventListener('error', () => { img.remove(); letter.hidden = false; });
      img.src = src; icon.append(img);
    }
  }
  tile.append(icon, element('span', 'bookmark-name', name));
  return tile;
}

function renderBreadcrumbs(folders, current, source) {
  const nav = $('breadcrumbs');
  nav.replaceChildren();
  nav.hidden = current.id === source.id;
  if (nav.hidden) return;
  const path = [];
  let node = current;
  while (node) {
    path.unshift(node);
    if (node.id === source.id) break;
    node = folders.find(f => f.id === node.parentId);
  }
  for (const [index, folder] of path.entries()) {
    if (index) nav.append(element('span', '', '›'));
    const button = element('button', '', folder.title);
    button.type = 'button';
    if (folder.id === current.id) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => { state.navigation = folder.id; render(); });
    nav.append(button);
  }
}

function render() {
  const { settings } = state;
  const folders = folderList(state.tree);
  const source = chooseFolder(state.tree, settings.folderId);
  const current = folders.find(f => f.id === state.navigation) || source;
  if (!current) return;
  // Populate both pickers only when the folder tree changes, so keyboard
  // selection remains stable while bookmarks and preferences update.
  const signature = JSON.stringify(folders.map(f => [f.id, f.path]));
  for (const id of ['folder-select', 'choose-folder']) {
    const select = $(id);
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...folders.map(folder => {
        const option = element('option', '', folder.path);
        option.value = folder.id; return option;
      }));
      select.dataset.signature = signature;
    }
    select.value = source.id;
    select.disabled = false;
  }
  $('choose-folder').title = `当前收藏夹：${source.path}。直接选择来源文件夹。`;
  $('icon-size').value = settings.iconSize;
  $('columns').value = settings.columns;
  $('icon-size-value').value = `${settings.iconSize} px`;
  $('columns-value').value = `${settings.columns} 个`;
  $('grouped').checked = settings.grouped;
  $('letters-only').checked = settings.lettersOnly;
  document.documentElement.style.setProperty('--icon-size', `${settings.iconSize}px`);
  document.documentElement.style.setProperty('--cell-min', `${settings.iconSize + 28}px`);
  document.documentElement.style.setProperty('--cell-width', `${settings.iconSize + 48}px`);
  updateColumns();
  renderBreadcrumbs(folders, current, source);
  const sections = sectionsFor(current, settings.grouped, state.query);
  const total = sectionsFor(current, true).reduce((sum, section) => sum + section.items.length, 0);
  const visible = sections.reduce((sum, section) => sum + section.items.filter(i => i.url).length, 0);
  $('summary').textContent = state.query.trim() ? `找到 ${visible} 个书签 · ${current.title}` : `${current.title} · ${total} 个书签`;
  const fragment = document.createDocumentFragment();
  for (const section of sections) {
    const container = element('section', 'bookmark-section');
    const heading = element('div', 'section-heading');
    heading.append(element('h2', '', section.title === '收藏夹' ? '常用网站' : section.title), element('span', 'section-count', String(section.items.length)));
    const grid = element('div', 'bookmark-grid');
    grid.append(...section.items.map(createTile));
    container.append(heading, grid); fragment.append(container);
  }
  $('content').replaceChildren(fragment);
  $('empty').hidden = sections.length !== 0;
  $('empty-title').textContent = state.query.trim() ? '没有找到书签' : '这里还没有书签';
  $('empty-description').textContent = state.query.trim() ? '试试其他名称或网址；搜索范围包含当前文件夹的所有子文件夹。' : '按 ⌘ D 收藏一个网站，或选择其他书签文件夹。';
  $('empty-folder').textContent = state.query.trim() ? '清除搜索' : '选择文件夹';
  $('main').setAttribute('aria-busy', 'false');
}

function updateColumns() {
  const available = $('content').clientWidth;
  const fit = Math.max(1, Math.floor(available / (state.settings.iconSize + 28)));
  document.documentElement.style.setProperty('--columns', Math.min(state.settings.columns, fit));
}
async function refreshBookmarks() {
  const version = ++refreshVersion;
  try {
    const tree = await chrome.bookmarks.getTree();
    if (version !== refreshVersion) return;
    state.tree = tree;
    const source = chooseFolder(tree, state.settings.folderId);
    if (!source) throw new Error('empty tree');
    if (state.navigation && !folderList(tree).some(f => f.id === state.navigation)) state.navigation = null;
    state.ready = true;
    notice('');
    render();
    if (storageReady && source.id !== state.settings.folderId) updateSettings({ folderId: source.id });
  } catch {
    if (version !== refreshVersion) return;
    $('main').setAttribute('aria-busy', 'false');
    $('summary').textContent = '暂时无法读取书签';
    notice('无法读取 Chrome 书签。请确认扩展已启用，并尝试重新加载。', refreshBookmarks);
  }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshBookmarks, 80);
}
function openSettings(focusFolder = false) {
  if (!$('settings-dialog').open) $('settings-dialog').showModal();
  if (focusFolder) $('folder-select').focus();
}

$('settings-button').addEventListener('click', () => openSettings());
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('click', event => {
  if (event.target !== $('settings-dialog')) return;
  const box = $('settings-dialog').getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('settings-dialog').close();
});
for (const id of ['folder-select', 'choose-folder']) {
  $(id).addEventListener('change', event => {
    state.navigation = null;
    state.query = ''; $('search').value = '';
    updateSettings({ folderId: event.target.value });
  });
}
$('icon-size').addEventListener('input', event => updateSettings({ iconSize: Number(event.target.value) }));
$('columns').addEventListener('input', event => updateSettings({ columns: Number(event.target.value) }));
$('grouped').addEventListener('change', event => updateSettings({ grouped: event.target.checked }));
$('letters-only').addEventListener('change', event => updateSettings({ lettersOnly: event.target.checked }));
$('reset-settings').addEventListener('click', () => {
  state.navigation = null;
  state.query = ''; $('search').value = '';
  const defaults = normalizeSettings(null);
  const source = chooseFolder(state.tree, '');
  updateSettings({ ...defaults, folderId: source?.id || '' });
});
$('search').addEventListener('input', event => { state.query = event.target.value; render(); });
$('empty-folder').addEventListener('click', () => {
  if (state.query.trim()) { state.query = ''; $('search').value = ''; render(); $('search').focus(); }
  else openSettings(true);
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !$('settings-dialog').open) {
    event.preventDefault(); $('search').focus(); $('search').select();
  }
  if (event.key === 'Escape' && !$('settings-dialog').open && state.query) {
    state.query = ''; $('search').value = ''; render();
  }
});
window.addEventListener('resize', updateColumns);
// Flush promptly when a tab is hidden/closed; ordinary edits are already saved after 120 ms.
window.addEventListener('pagehide', flushSettings);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSettings(); });

async function start() {
  if (!globalThis.chrome?.bookmarks || !chrome.storage?.local) {
    $('main').setAttribute('aria-busy', 'false');
    $('summary').textContent = '请作为 Chrome 扩展安装';
    notice('此页面需要 Chrome 扩展环境。请前往 chrome://extensions，启用开发者模式，再加载包含 manifest.json 的文件夹。');
    return;
  }
  for (const name of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded']) {
    chrome.bookmarks[name]?.addListener(scheduleRefresh);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch = {};
    for (const field of FIELDS) {
      if (changes[PREFIX + field]) patch[field] = changes[PREFIX + field].newValue;
    }
    if (!Object.keys(patch).length) return;
    if (loadingSettings) changesDuringLoad = { ...changesDuringLoad, ...patch };
    const previousSource = state.settings.folderId;
    state.settings = normalizeSettings({ ...state.settings, ...patch, ...pendingPatch });
    if (previousSource !== state.settings.folderId) state.navigation = null;
    if (state.ready) render();
  });
  try {
    const saved = await chrome.storage.local.get(KEYS);
    state.settings = normalizeSettings({ ...readSettings(saved), ...changesDuringLoad, ...pendingPatch });
    storageReady = true;
  } catch {
    $('save-status').textContent = '无法读取设置，使用默认值';
  } finally {
    loadingSettings = false;
    changesDuringLoad = {};
  }
  await refreshBookmarks();
}
start();
