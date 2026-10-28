import test from 'node:test';
import assert from 'node:assert/strict';
import { folderList, chooseFolder, sectionsFor, safeURL, normalizeSettings, faviconURL, initials } from '../src/model.js';

const tree = [{ id: '0', title: '', children: [
  { id: '1', folderType: 'bookmarks-bar', title: '书签栏', children: [
    { id: 'a', title: 'Apple', url: 'https://apple.com/' },
    { id: 'f', title: '设计', children: [
      { id: 'b', title: 'Figma', url: 'https://figma.com/' },
      { id: 'g', title: '灵感', children: [{ id: 'c', title: '中文案例', url: 'https://example.com/case' }] }
    ] },
    { id: 'empty', title: '空文件夹', children: [] },
    { id: 'bad', title: '<img onerror=alert(1)>', url: 'javascript:alert(1)' }
  ] },
  { id: '2', title: '其他书签', children: [] }
] }];

test('folders retain unique ids and full nested paths', () => {
  assert.deepEqual(folderList(tree).map(f => [f.id, f.path]), [
    ['0', '全部书签'], ['1', '书签栏'], ['f', '书签栏 / 设计'], ['g', '书签栏 / 设计 / 灵感'],
    ['empty', '书签栏 / 空文件夹'], ['2', '其他书签']
  ]);
});
test('missing or deleted selection returns an actual bookmarks bar', () => {
  assert.equal(chooseFolder(tree, 'deleted').id, '1');
  assert.equal(chooseFolder(tree, 'g').id, 'g');
  assert.equal(chooseFolder([], 'missing'), null);
  const accountTree = [{ id: '0', title: '', children: [{ id: '9', title: '账户栏', folderType: 'bookmarks-bar', children: [] }] }];
  assert.equal(chooseFolder(accountTree, '').id, '9');
});
test('grouped view shows every depth exactly once with relative paths', () => {
  const result = sectionsFor(chooseFolder(tree, '1'), true, '');
  assert.deepEqual(result.map(s => [s.title, s.items.map(i => i.id)]), [
    ['收藏夹', ['a']], ['设计', ['b']], ['设计 / 灵感', ['c']]
  ]);
});
test('ungrouped view keeps child folders navigable and excludes executable bookmarks', () => {
  assert.deepEqual(sectionsFor(chooseFolder(tree, '1'), false, '')[0].items.map(i => i.id), ['a', 'f', 'empty']);
});
test('search finds nested titles and URLs regardless of current grouping', () => {
  assert.deepEqual(sectionsFor(chooseFolder(tree, '1'), false, '中文')[0].items.map(i => i.id), ['c']);
  assert.equal(sectionsFor(chooseFolder(tree, '1'), true, 'FIGMA')[0].items[0].id, 'b');
  assert.deepEqual(sectionsFor(chooseFolder(tree, '1'), true, 'absent'), []);
});
test('settings recover from corrupt values and clamp layout dimensions', () => {
  assert.deepEqual(normalizeSettings(null), { folderId: '', iconSize: 64, columns: 8, grouped: true, lettersOnly: false });
  assert.deepEqual(normalizeSettings({ folderId: 12, iconSize: 900, columns: -3, grouped: 'false', lettersOnly: true }),
    { folderId: '', iconSize: 88, columns: 4, grouped: true, lettersOnly: true });
  assert.equal(normalizeSettings({ iconSize: '80', columns: '10' }).iconSize, 80);
});
test('unsafe protocols never become clickable links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/hosts', 'invalid', 'vbscript:x']) assert.equal(safeURL(url), null);
  assert.equal(safeURL('https://example.com/a?q=x'), 'https://example.com/a?q=x');
  assert.equal(safeURL('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(safeURL('chrome://bookmarks/'), 'chrome://bookmarks/');
  assert.equal(safeURL('mailto:me@example.com'), 'mailto:me@example.com');
});
test('favicon queries remain internal and encode complete URL as data', () => {
  const result = new URL(faviconURL('https://example.com/?q=a&b=中文', 'chrome-extension://abc/', 64));
  assert.equal(result.protocol, 'chrome-extension:');
  assert.equal(result.hostname, 'abc');
  assert.equal(result.pathname, '/_favicon/');
  assert.equal(result.searchParams.get('pageUrl'), 'https://example.com/?q=a&b=中文');
  assert.equal(result.searchParams.get('size'), '64');
  assert.equal(faviconURL('chrome://settings/', 'chrome-extension://abc/', 64), null);
});
test('fallback icons handle Unicode, blank names, and punctuation', () => {
  assert.equal(initials('中文案例', 'https://example.com'), '中');
  assert.equal(initials('', 'https://www.apple.com'), 'A');
  assert.equal(initials('  figma', ''), 'F');
});
