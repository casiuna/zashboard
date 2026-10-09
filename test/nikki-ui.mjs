// Browser regression against localhost mocks only. Reuses the project's Chrome/CDP harness.
import assert from 'node:assert/strict'
import { waitFor } from './lib/cdp.mjs'
import { startHarness } from './lib/harness.mjs'

const harness = await startHarness({ groups: 6, nodes: 4, connections: 6 })
let checks = 0
const check = (name, condition) => {
  assert.ok(condition, name)
  checks++
  console.log(`PASS: ${name}`)
}
try {
  const page = await harness.openProxiesPage({ settings: { 'config/language': 'en' } })
  const ready = async (expression) => {
    assert.notEqual(
      await waitFor(() => page.evaluate(expression), { timeout: 15000 }),
      null,
      expression,
    )
  }
  const clickText = async (text, scope = 'document') => {
    const expression = `(() => {
      const button = [...${scope}.querySelectorAll('button')].find(b => b.getBoundingClientRect().width && b.textContent.trim() === ${JSON.stringify(text)});
      if (!button) return false; button.click(); return true;
    })()`
    await ready(expression)
  }
  const fill = async (selector, value) => {
    await ready(`!!document.querySelector(${JSON.stringify(selector)})`)
    await page.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)});
      input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  }
  const openManager = async () => {
    await page.goto(`${harness.app.url}/#/setup`)
    await clickText('Manage backends')
    await ready(`!!document.querySelector('button[aria-label="Edit backend"]')`)
  }
  const editFirst = async () => {
    await page.evaluate(`document.querySelector('button[aria-label="Edit backend"]').click()`)
    await ready(`!!document.querySelector('.modal.modal-open input[name="nikki-enabled"]')`)
  }
  const storage = async () =>
    JSON.parse(await page.evaluate(`localStorage.getItem('setup/api-list')`))
  const dismiss = async () => {
    await page.evaluate(
      `document.querySelectorAll('.modal.modal-open button[aria-label="close"]').forEach(button => button.click())`,
    )
    await ready(`!document.querySelector('.modal.modal-open')`)
  }

  await openManager()
  await editFirst()
  check(
    'legacy backend opens with Nikki disabled',
    !(await page.evaluate(
      `document.querySelector('.modal.modal-open input[name="nikki-enabled"]').checked`,
    )),
  )
  await page.evaluate(
    `document.querySelector('.modal.modal-open input[name="nikki-enabled"]').click()`,
  )
  await ready(`!!document.querySelector('.modal.modal-open input[name="nikki-refresh-path"]')`)
  check(
    'enabling initializes the CGI path',
    await page.evaluate(
      `document.querySelector('.modal.modal-open input[name="nikki-refresh-path"]').value === '/cgi-bin/nikki-refresh'`,
    ),
  )
  await fill('.modal.modal-open input[name="nikki-bridge-origin"]', 'http://attacker.example')
  await ready(
    `document.querySelector('.modal.modal-open [role="alert"]')?.textContent.includes('match')`,
  )
  check(
    'foreign bridge host disables Save',
    await page.evaluate(
      `[...document.querySelectorAll('.modal.modal-open button')].find(b => b.textContent.trim() === 'Save').disabled`,
    ),
  )
  await fill('.modal.modal-open input[name="nikki-bridge-origin"]', 'http://127.0.0.1:8080')
  await fill('.modal.modal-open input[name="nikki-refresh-path"]', '//attacker.example/refresh')
  await ready(`!!document.querySelector('.modal.modal-open [role="alert"]')`)
  check('cross-domain path shows an inline error', true)
  await fill('.modal.modal-open input[name="nikki-refresh-path"]', '/cgi-bin/nikki-refresh')
  await ready(
    `![...document.querySelectorAll('.modal.modal-open button')].find(b => b.textContent.trim() === 'Save').disabled`,
  )
  await clickText('Save', `document.querySelector('.modal.modal-open')`)
  await ready(
    `JSON.parse(localStorage.getItem('setup/api-list'))[0].nikkiIntegration?.enabled === true`,
  )
  check(
    'edit saves integration to the backend record',
    (await storage())[0].nikkiIntegration.bridgeOrigin === 'http://127.0.0.1:8080',
  )
  await ready(`!!document.querySelector('button[aria-label="Edit backend"]')`)
  await clickText('Add backend', `document.querySelector('.modal.modal-open')`)
  await ready(`!!document.querySelector('.modal.modal-open input[name="nikki-enabled"]')`)
  check(
    'new backend defaults to disabled',
    !(await page.evaluate(
      `document.querySelector('.modal.modal-open input[name="nikki-enabled"]').checked`,
    )),
  )
  await fill('.modal.modal-open input[placeholder="9090"]', String(harness.mock.port))
  await page.evaluate(`(() => { const label = [...document.querySelectorAll('.modal.modal-open label')].find(e => e.textContent.trim() === 'Label');
    const input = label.nextElementSibling.querySelector('input'); input.value = 'ordinary'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await ready(
    `![...document.querySelectorAll('.modal.modal-open button')].find(b => b.textContent.trim() === 'Save').disabled`,
  )
  await clickText('Save', `document.querySelector('.modal.modal-open')`)
  await ready(`JSON.parse(localStorage.getItem('setup/api-list')).length === 2`)
  check(
    'adding an ordinary backend keeps it unconfigured',
    (await storage())[1].nikkiIntegration === undefined,
  )

  await openManager()
  await clickText('Add backend', `document.querySelector('.modal.modal-open')`)
  await ready(`!!document.querySelector('.modal.modal-open input[name="nikki-enabled"]')`)
  await fill('.modal.modal-open input[placeholder="9090"]', String(harness.mock.port))
  await page.evaluate(`(() => { const label = [...document.querySelectorAll('.modal.modal-open label')].find(e => e.textContent.trim() === 'Label');
    const input = label.nextElementSibling.querySelector('input'); input.value = 'nikki-two'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal.modal-open input[name="nikki-enabled"]').click(); })()`)
  await fill('.modal.modal-open input[name="nikki-refresh-path"]', '/cgi-bin/nikki-refresh-two')
  await fill('.modal.modal-open input[name="nikki-bridge-origin"]', 'http://127.0.0.1:8081')
  await ready(
    `![...document.querySelectorAll('.modal.modal-open button')].find(b => b.textContent.trim() === 'Save').disabled`,
  )
  await clickText('Save', `document.querySelector('.modal.modal-open')`)
  await ready(`JSON.parse(localStorage.getItem('setup/api-list')).length === 3`)
  check(
    'adding a second Nikki backend preserves its own configuration',
    (await storage())[2].nikkiIntegration.bridgeOrigin === 'http://127.0.0.1:8081',
  )

  await openManager()
  await editFirst()
  check(
    'reopening retains CGI path and origin',
    await page.evaluate(
      `document.querySelector('.modal.modal-open input[name="nikki-bridge-origin"]').value === 'http://127.0.0.1:8080'`,
    ),
  )
  await fill('.modal.modal-open input[name="nikki-refresh-path"]', '/unsaved-change')
  await clickText('Cancel', `document.querySelector('.modal.modal-open')`)
  check(
    'cancel does not mutate the saved nested configuration',
    (await storage())[0].nikkiIntegration.refreshPath === '/cgi-bin/nikki-refresh',
  )
  await dismiss()
  await page.reload()
  await openManager()
  await editFirst()
  check(
    'page reload retains the enabled integration',
    await page.evaluate(
      `document.querySelector('.modal.modal-open input[name="nikki-enabled"]').checked`,
    ),
  )
  await clickText('Cancel', `document.querySelector('.modal.modal-open')`)
  await ready(
    `(() => { const b = [...document.querySelectorAll('.modal.modal-open button')].find(e => e.textContent.trim().startsWith('perf')); if (!b) return false; b.click(); return true; })()`,
  )
  await ready(`localStorage.getItem('setup/active-uuid') === 'perf'`)
  await dismiss()

  await page.goto(`${harness.app.url}/#/settings`)
  await ready(`(document.body?.innerText ?? '').includes('Update Subscription')`)
  check(
    'enabled backend renders the action and arrows icon',
    await page.evaluate(`(() => {
    const b = document.querySelector('button[aria-label="Update Subscription"]');
    return !!b?.querySelector('path[d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5"]'); })()`),
  )
  // Replace fetch only for the CGI path; no actual bridge is contacted.
  await page.evaluate(`(() => { const original = window.fetch.bind(window); window.__nikkiRequests = [];
    window.fetch = (url, options) => { if (String(url).includes('/cgi-bin/nikki-refresh')) {
      window.__nikkiRequests.push({ url: String(url), method: options.method, body: options.body, redirect: options.redirect });
      return Promise.resolve(new Response('{"success":true}', { headers: { 'Content-Type': 'application/json' } }));
    } return original(url, options); };
    const timeout = window.setTimeout.bind(window); window.__nikkiDelays = [];
    window.setTimeout = (callback, delay, ...args) => { if (delay === 3000) window.__nikkiDelays.push(delay); return timeout(callback, delay, ...args); };
  })()`)
  await page.evaluate(`document.querySelector('button[aria-label="Update Subscription"]').click()`)
  await ready(`window.__nikkiRequests.length === 1`)
  check(
    'action uses configured Web origin and preserves POST protocol',
    await page.evaluate(
      `window.__nikkiRequests[0].url === 'http://127.0.0.1:8080/cgi-bin/nikki-refresh' && window.__nikkiRequests[0].method === 'POST' && window.__nikkiRequests[0].body === '' && window.__nikkiRequests[0].redirect === 'error'`,
    ),
  )
  await ready(`window.__nikkiDelays.includes(3000)`)
  check('success retains the 3000 ms refresh delay', true)

  // Switch using the real backend menu, without reloading the page.
  await clickText('perf')
  await ready(
    `(() => { const b = [...document.querySelectorAll('button')].find(b => b.getBoundingClientRect().width && b.textContent.trim().startsWith('ordinary')); if (!b) return false; b.click(); return true; })()`,
  )
  await ready(
    `localStorage.getItem('setup/active-uuid') === JSON.parse(localStorage.getItem('setup/api-list')).find(b => b.label === 'ordinary').uuid`,
  )
  await ready(`!document.querySelector('button[aria-label="Update Subscription"]')`)
  check('switching to ordinary backend hides the action immediately', true)

  await clickText('ordinary')
  await ready(
    `(() => { const b = [...document.querySelectorAll('button')].find(b => b.getBoundingClientRect().width && b.textContent.trim().startsWith('nikki-two')); if (!b) return false; b.click(); return true; })()`,
  )
  await ready(`!!document.querySelector('button[aria-label="Update Subscription"]')`)
  await page.evaluate(`document.querySelector('button[aria-label="Update Subscription"]').click()`)
  await ready(`window.__nikkiRequests.length === 2`)
  check(
    'switching to another enabled backend selects its own CGI path and port',
    await page.evaluate(
      `window.__nikkiRequests[1].url === 'http://127.0.0.1:8081/cgi-bin/nikki-refresh-two'`,
    ),
  )

  // The normal settings export produces a credential-free integration snapshot.
  await page.goto(`${harness.app.url}/#/setup`)
  await clickText('Dashboard settings')
  await page.evaluate(`(() => { const create = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => {
    blob.text().then(text => sessionStorage.setItem('nikki-test-backup', text)); return create(blob); }; })()`)
  await ready(
    `(() => { const item = [...document.querySelectorAll('.modal.modal-open .setting-item')].find(e => e.textContent.includes('Export settings')); if (!item) return false; item.querySelector('button').click(); return true; })()`,
  )
  await ready(`!!sessionStorage.getItem('nikki-test-backup')`)
  check(
    'normal export includes Nikki settings but excludes credentials',
    await page.evaluate(`(() => {
    const text = sessionStorage.getItem('nikki-test-backup'); const settings = JSON.parse(text);
    return !!settings['config/nikki-integrations'] && !('setup/api-list' in settings) && !text.includes('password'); })()`),
  )
  await page.evaluate(`(() => { const list = JSON.parse(localStorage.getItem('setup/api-list')); delete list[0].nikkiIntegration;
    localStorage.setItem('setup/api-list', JSON.stringify(list)); })()`)
  await page.reload()
  await ready(`(document.body?.innerText ?? '').includes('Dashboard settings')`)
  await clickText('Dashboard settings')
  await page.evaluate(`(() => { const native = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return native.call(this);
      const transfer = new DataTransfer(); transfer.items.add(new File([sessionStorage.getItem('nikki-test-backup')], 'settings.json', { type: 'application/json' }));
      this.files = transfer.files; this.dispatchEvent(new Event('change', { bubbles: true })); };
  })()`)
  await ready(
    `(() => { const item = [...document.querySelectorAll('.modal.modal-open .setting-item')].find(e => e.textContent.includes('Import settings from file')); if (!item) return false; item.querySelector('button').click(); return true; })()`,
  )
  await ready(
    `JSON.parse(localStorage.getItem('setup/api-list'))[0].nikkiIntegration?.enabled === true`,
  )
  check(
    'normal file import restores the matching integration only',
    (await storage())[1].nikkiIntegration === undefined,
  )

  await page.close()
  console.log(`\n${checks} Nikki browser checks passed (localhost mocks only).`)
} finally {
  await harness.close()
}
