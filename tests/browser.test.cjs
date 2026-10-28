/* Real extension integration tests. Requires Node 18+ and Playwright 1.62.1.
   Uses a disposable browser profile and synthetic bookmarks only. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const extension = path.resolve(__dirname, '..');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, message) {
  for (let i = 0; i < 70; i++) { if (await check()) return; await delay(80); }
  throw new Error(message);
}
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'quiet-start-test-'));
  const screenshotDir = process.env.QUIET_START_TEST_OUTPUT || path.join(extension, 'docs', 'screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });
  let serverRequests = 0;
  const server = http.createServer(async (req, res) => {
    serverRequests++;
    if (req.url === '/favicon.ico') { res.setHeader('Content-Type', 'image/png'); res.end(await fs.readFile(path.join(extension, 'assets/icon-32.png'))); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local fixture</title><link rel="icon" href="/favicon.ico">Local test fixture'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixtureURL = `http://127.0.0.1:${server.address().port}/`;
  let context;
  const checks = [];
  const errors = [];
  const externalRequests = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, colorScheme: 'light',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    context.on('request', req => { if (/^https?:/.test(req.url())) externalRequests.push(req.url()); });
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('#main[aria-busy="false"]');
    assert.match(page.url(), /^chrome-extension:\/\/[a-z]+\/newtab.html$/);
    assert.equal(await page.locator('#empty').isVisible(), true);
    checks.push('真实 MV3 扩展加载、新标签页覆盖、初始空态');
    const extensionURL = page.url();
    const ids = await page.evaluate(async fixtureURL => {
      const tree = await chrome.bookmarks.getTree();
      const bar = tree[0].children.find(f => f.folderType === 'bookmarks-bar') || tree[0].children[0];
      const direct = [['Apple','https://apple.com/'],['GitHub','https://github.com/'],['Notion','https://notion.so/'],['Linear','https://linear.app/'],['Figma','https://figma.com/'],['Wikipedia','https://wikipedia.org/'],['YouTube','https://youtube.com/'],['MDN Web Docs','https://developer.mozilla.org/']];
      const created = [];
      for (const [title, url] of direct) created.push(await chrome.bookmarks.create({ parentId: bar.id, title, url }));
      const design = await chrome.bookmarks.create({ parentId: bar.id, title: '设计与灵感' });
      for (const [title, url] of [['Dribbble','https://dribbble.com/'],['Are.na','https://are.na/'],['Behance','https://behance.net/']]) await chrome.bookmarks.create({ parentId: design.id, title, url });
      const deep = await chrome.bookmarks.create({ parentId: design.id, title: '阅读清单' });
      await chrome.bookmarks.create({ parentId: deep.id, title: '中文设计案例', url: 'https://example.com/article' });
      const work = await chrome.bookmarks.create({ parentId: bar.id, title: '工作' });
      await chrome.bookmarks.create({ parentId: work.id, title: 'Google Drive', url: 'https://drive.google.com/' });
      await chrome.bookmarks.create({ parentId: work.id, title: 'Local fixture', url: fixtureURL });
      const empty = await chrome.bookmarks.create({ parentId: bar.id, title: '空文件夹' });
      await chrome.bookmarks.create({ parentId: bar.id, title: '危险脚本', url: 'javascript:alert(1)' });
      return { bar: bar.id, design: design.id, deep: deep.id, work: work.id, empty: empty.id, first: created[0].id };
    }, fixtureURL);
    await until(async () => await page.locator('a.bookmark').count() === 14, 'bookmark creation did not update');
    assert.deepEqual(await page.locator('.section-heading h2').allTextContents(), ['常用网站','设计与灵感','设计与灵感 / 阅读清单','工作']);
    assert.equal(serverRequests, 0, 'favicon lookup contacted an unvisited bookmark origin');
    assert.equal(externalRequests.length, 0, 'new tab initiated external web requests');
    assert.equal(await page.getByText('危险脚本', { exact: true }).count(), 0);
    checks.push('真实书签新增事件、深层分组、不执行危险协议、未访问网址的图标不联系目标站点');
    assert.equal(await page.locator('#choose-folder').evaluate(element => element.tagName), 'SELECT', 'header folder control must be a direct dropdown');
    await page.locator('#choose-folder').selectOption(ids.design);
    assert.equal(await page.locator('#settings-dialog').evaluate(dialog => dialog.open), false, 'quick folder change must not open settings');
    assert.equal(await page.locator('a.bookmark').count(), 4);
    await until(async () => await page.evaluate(async expected => (await chrome.storage.local.get('quietStart.folderId'))['quietStart.folderId'] === expected, ids.design), 'quick folder selection was not saved');
    await page.reload();
    await page.waitForSelector('#main[aria-busy="false"]');
    assert.equal(await page.locator('#choose-folder').inputValue(), ids.design);
    await page.locator('#settings-button').click();
    assert.equal(await page.locator('#folder-select').inputValue(), ids.design);
    await page.locator('#close-settings').click();
    await page.locator('#choose-folder').selectOption(ids.bar);
    assert.equal(await page.locator('a.bookmark').count(), 14);
    assert.equal(await page.locator('#settings-dialog').evaluate(dialog => dialog.open), false);
    checks.push('右上角直接下拉选择收藏夹、不打开设置、与完整设置同步、重开保留');
    await page.locator('#search').fill('中文');
    assert.equal(await page.locator('a.bookmark').count(), 1);
    await page.locator('#search').fill('no-matching-bookmark');
    assert.equal(await page.locator('#empty-title').innerText(), '没有找到书签');
    await page.locator('#empty-folder').click();
    assert.equal(await page.locator('a.bookmark').count(), 14);
    checks.push('跨子文件夹搜索、无结果、清除搜索');
    await page.locator('#settings-button').click();
    await page.locator('#grouped').uncheck();
    await page.locator('#close-settings').click();
    assert.equal(await page.locator('button.folder-tile').count(), 3);
    await page.getByRole('button', { name: '设计与灵感', exact: true }).click();
    assert.equal(await page.locator('a.bookmark').count(), 3);
    assert.equal(await page.locator('#breadcrumbs').isVisible(), true);
    assert.equal(await page.locator('#choose-folder').inputValue(), ids.bar, 'temporary browsing must not masquerade as a saved source');
    await page.locator('#breadcrumbs').getByRole('button', { name: '书签栏', exact: true }).click();
    assert.equal(await page.locator('a.bookmark').count(), 8);
    checks.push('文件夹磁贴、面包屑返回');
    await page.getByRole('button', { name: '设计与灵感', exact: true }).click();
    await page.locator('#choose-folder').selectOption(ids.design);
    assert.equal(await page.locator('#folder-select').inputValue(), ids.design);
    await until(async () => await page.evaluate(async expected => (await chrome.storage.local.get('quietStart.folderId'))['quietStart.folderId'] === expected, ids.design), 'browsed subfolder was not saved as a source');
    await page.reload();
    await page.waitForSelector('#main[aria-busy="false"]');
    assert.equal(await page.locator('#choose-folder').inputValue(), ids.design);
    assert.equal(await page.locator('a.bookmark').count(), 3);
    await page.locator('#choose-folder').selectOption(ids.bar);
    assert.equal(await page.locator('a.bookmark').count(), 8);
    checks.push('临时浏览与保存来源一致，可将正在浏览的子文件夹保存为默认收藏夹');

    await page.locator('#settings-button').click();
    await page.locator('#folder-select').selectOption(ids.empty);
    await page.locator('#close-settings').click();
    assert.equal(await page.locator('#empty').isVisible(), true);
    await page.evaluate(async id => chrome.bookmarks.removeTree(id), ids.empty);
    await until(async () => await page.locator('a.bookmark').count() === 8, 'deleted source did not fall back');
    checks.push('选择文件夹、空文件夹、来源删除自动回退');
    await page.locator('#settings-button').click();
    await page.locator('#grouped').check();
    await page.locator('#letters-only').check();
    await page.locator('#close-settings').click();
    await page.evaluate(async id => chrome.bookmarks.update(id, { title: '<img src=x onerror=alert(1)>' }), ids.first);
    await until(async () => await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).count() === 1, 'rename event did not update');
    assert.equal(await page.locator('img').count(), 0);
    await page.evaluate(async id => chrome.bookmarks.update(id, { title: 'Apple' }), ids.first);
    await until(async () => await page.getByText('Apple', { exact: true }).count() === 1, 'rename restoration failed');
    await page.evaluate(async ({first, work}) => chrome.bookmarks.move(first, { parentId: work }), ids);
    await until(async () => (await page.locator('.bookmark-section').last().locator('a.bookmark').count()) === 3, 'move event failed');
    await page.evaluate(async ({first, bar}) => chrome.bookmarks.move(first, { parentId: bar, index: 0 }), ids);
    await until(async () => (await page.locator('.bookmark-section').first().locator('a.bookmark').count()) === 8, 'move back failed');
    checks.push('重命名、移动实时更新、标题注入防护、纯字母图标模式');
    const second = await context.newPage();
    await second.goto(extensionURL);
    await second.waitForSelector('#main[aria-busy="false"]');
    await page.locator('#settings-button').click();
    await second.locator('#settings-button').click();
    // Delay reads to force overlapping saves from two real extension pages.
    for (const tab of [page, second]) await tab.evaluate(() => {
      const read = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async (...args) => { const value = await read(...args); await new Promise(r => setTimeout(r, 250)); return value; };
    });
    await Promise.all([
      page.locator('#icon-size').evaluate(input => { input.value = '80'; input.dispatchEvent(new Event('input', { bubbles: true })); }),
      second.locator('#columns').evaluate(input => { input.value = '10'; input.dispatchEvent(new Event('input', { bubbles: true })); })
    ]);
    await delay(1200);
    for (const tab of [page, second]) {
      assert.equal(await tab.locator('#icon-size').inputValue(), '80', 'live icon setting diverged');
      assert.equal(await tab.locator('#columns').inputValue(), '10', 'live column setting diverged');
    }
    await page.reload(); await second.reload();
    for (const tab of [page, second]) {
      await tab.waitForSelector('#main[aria-busy="false"]');
      await tab.locator('#settings-button').click();
      assert.equal(await tab.locator('#icon-size').inputValue(), '80', 'concurrent icon size was overwritten');
      assert.equal(await tab.locator('#columns').inputValue(), '10', 'concurrent column count was overwritten');
    }
    checks.push('多标签页并发设置不丢失、重开保存');
    await second.close();
    const initializing = await context.newPage();
    await initializing.addInitScript(() => {
      const read = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async (...args) => {
        const snapshot = await read(...args);
        globalThis.initialReadCaptured = true;
        await new Promise(resolve => setTimeout(resolve, 900));
        return snapshot;
      };
    });
    await initializing.goto(extensionURL);
    await initializing.waitForFunction(() => globalThis.initialReadCaptured);
    await page.locator('#columns').evaluate(input => { input.value = '11'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await initializing.waitForSelector('#main[aria-busy="false"]');
    await initializing.locator('#settings-button').click();
    assert.equal(await initializing.locator('#columns').inputValue(), '11', 'initial stale snapshot overwrote a live update');
    await initializing.close();
    checks.push('初始化期间其他标签页的更新不会被旧快照覆盖');
    await page.locator('#reset-settings').click();
    await until(async () => await page.locator('#icon-size').inputValue() === '64', 'reset failed');
    await page.locator('#letters-only').check();
    await page.locator('#close-settings').click();
    await delay(300);
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(244, 245, 247)');
    await page.screenshot({ path: path.join(screenshotDir, 'light.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(23, 26, 33)');
    await page.screenshot({ path: path.join(screenshotDir, 'dark.png'), fullPage: true });
    await page.locator('#settings-button').click();
    await page.screenshot({ path: path.join(screenshotDir, 'settings.png'), fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings-dialog').evaluate(d => d.open), false);
    await page.keyboard.press('Meta+k');
    assert.equal(await page.locator('#search').evaluate(e => e === document.activeElement), true);
    checks.push('系统浅深色响应、设置恢复默认、键盘搜索和 Escape');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--columns').trim()), '3');
    await page.screenshot({ path: path.join(screenshotDir, 'narrow.png'), fullPage: true });
    checks.push('375 px 窄窗口自动缩列、无横向溢出');
    // Exercise the actual cached favicon route after visiting a local fixture.
    const fixture = await context.newPage();
    await fixture.goto(fixtureURL); await fixture.waitForLoadState('networkidle');
    await fixture.close();
    serverRequests = 0; externalRequests.length = 0;
    await page.locator('#settings-button').click();
    await page.locator('#letters-only').uncheck();
    await page.locator('#close-settings').click();
    await page.locator('a.bookmark').filter({ hasText: 'Local fixture' }).scrollIntoViewIfNeeded();
    await until(async () => await page.locator('a.bookmark').filter({ hasText: 'Local fixture' }).locator('img').evaluate(i => i.complete && i.naturalWidth > 0), 'cached favicon did not load');
    await delay(300);
    assert.equal(serverRequests, 0, 'cached favicon requested origin');
    assert.equal(externalRequests.length, 0);
    const cachedTile = page.locator('a.bookmark').filter({ hasText: 'Local fixture' });
    await cachedTile.locator('img').evaluate(i => { i.src = chrome.runtime.getURL('assets/missing-test-icon.png'); });
    await until(async () => await cachedTile.locator('img').count() === 0, 'failed favicon was not removed');
    assert.equal(await cachedTile.locator('.bookmark-letter').isVisible(), true);
    await context.setOffline(true);
    await page.reload(); await page.waitForSelector('#main[aria-busy="false"]');
    assert.equal(await page.locator('a.bookmark').count(), 14);
    await context.setOffline(false);
    checks.push('本地缓存 favicon 可显示、失败回退字母、读取不联系源站、断网新标签页仍可用');
    // Inject API failures only at the browser boundary, and verify visible recovery.
    await page.evaluate(() => {
      const read = chrome.bookmarks.getTree.bind(chrome.bookmarks);
      chrome.bookmarks.getTree = async () => { throw new Error('test read failure'); };
      globalThis.restoreBookmarkRead = () => { chrome.bookmarks.getTree = read; };
      return chrome.bookmarks.create({ title: 'failure trigger', url: 'https://example.test/' });
    });
    await until(async () => (await page.locator('#notice').innerText()).includes('无法读取'), 'read error not visible');
    await page.evaluate(() => restoreBookmarkRead());
    await page.locator('#notice button').click();
    await until(async () => !(await page.locator('#notice').isVisible()), 'read retry failed');
    await page.locator('#settings-button').click();
    await page.evaluate(() => {
      const write = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async () => { throw new Error('test storage failure'); };
      globalThis.restoreStorageWrite = () => { chrome.storage.local.set = write; };
    });
    await page.locator('#columns').evaluate(input => { input.value = '9'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await until(async () => (await page.locator('#save-status').innerText()).includes('保存失败'), 'save error not visible');
    await page.evaluate(() => restoreStorageWrite());
    await page.locator('#close-settings').click();
    await page.locator('#notice button').click();
    await until(async () => (await page.locator('#save-status').innerText()).includes('已保存'), 'save retry failed');
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('quietStart.columns'))['quietStart.columns']), 9);
    await page.evaluate(async id => chrome.bookmarks.remove(id), ids.first);
    await until(async () => await page.locator('a.bookmark').count() === 13, 'deletion update failed');
    assert.deepEqual(errors, []);
    checks.push('读取及保存失败与重试、删除事件、无未捕获页面异常');
    console.log(JSON.stringify({ browser: context.browser().version(), checks, pageErrors: errors, externalNewTabRequests: externalRequests.length }, null, 2));
  } finally {
    if (context) await context.close();
    server.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
