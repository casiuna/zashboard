// Offline regression tests: real TypeScript helpers/API, no device requests or extra dependencies.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const dataModule = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = async (path, replacements = {}) => {
  let code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    code = code.replaceAll(`'${specifier}'`, `'${url}'`).replaceAll(`"${specifier}"`, `"${url}"`)
  }
  return dataModule(code)
}
const helperURL = await compile('src/helper/nikki.ts')
const { getNikkiRefreshURL, getNikkiIntegrationError, isNikkiIntegrationEnabled } = await import(
  helperURL
)
const settingsURL = await compile('src/helper/nikki-settings.ts', { './nikki': helperURL })
const { exportNikkiIntegrationSettings, restoreNikkiIntegrationSettings, NIKKI_SETTINGS_KEY } =
  await import(settingsURL)
const storeURL = dataModule('export const activeBackend = { value: undefined }')
const i18nURL = dataModule('export const i18n = { global: { t: key => key } }')
const { activeBackend } = await import(storeURL)
const { refreshNikkiSubscriptionAPI } = await import(
  await compile('src/api/nikki.ts', {
    '@/helper/nikki': helperURL,
    '@/store/setup': storeURL,
    '@/i18n': i18nURL,
  })
)

globalThis.window = {
  location: { protocol: 'http:', search: '' },
  matchMedia: () => ({ matches: false }),
}
globalThis.location = { hash: '' }
const storage = {}
Object.defineProperties(storage, {
  getItem: { value: (key) => storage[key] ?? null },
  setItem: {
    value: (key, value) => {
      storage[key] = String(value)
    },
  },
  clear: {
    value: () => {
      for (const key of Object.keys(storage)) delete storage[key]
    },
  },
})
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
const utils = await import(
  await compile('src/helper/utils.ts', {
    './nikki-settings': settingsURL,
    '@/constant': dataModule(
      'export const MIN_PROXY_CARD_WIDTH = 1; export const PROXY_CARD_SIZE = {}',
    ),
    '@vueuse/core': dataModule('export const useMediaQuery = () => false'),
    dayjs: dataModule('export default () => {}'),
    'pretty-bytes': dataModule('export default () => {}'),
  })
)

const makeBackend = (patch = {}) => ({
  uuid: 'test-device',
  type: 'clash',
  protocol: 'http',
  host: '192.0.2.10',
  port: '9090',
  secondaryPath: '/controller',
  password: 'offline-test-token',
  nikkiIntegration: { enabled: true, refreshPath: '/cgi-bin/nikki-refresh' },
  ...patch,
})
const withIntegration = (patch) =>
  makeBackend({
    nikkiIntegration: { enabled: true, refreshPath: '/cgi-bin/nikki-refresh', ...patch },
  })
const rejectKey = (backend, key, pageProtocol = '') =>
  assert.throws(
    () => getNikkiRefreshURL(backend, pageProtocol),
    (error) => error.key === key,
  )

for (const [host, expected] of [
  ['192.0.2.10', 'http://192.0.2.10/cgi-bin/nikki-refresh'],
  ['2001:db8::10', 'http://[2001:db8::10]/cgi-bin/nikki-refresh'],
  ['[2001:db8::10]', 'http://[2001:db8::10]/cgi-bin/nikki-refresh'],
  ['Router.Example', 'http://router.example/cgi-bin/nikki-refresh'],
]) {
  test(`Web origin for ${host} ignores controller port and secondaryPath`, () =>
    assert.equal(getNikkiRefreshURL(makeBackend({ host })), expected))
}

test('HTTPS default uses the Web server default port', () =>
  assert.equal(
    getNikkiRefreshURL(makeBackend({ protocol: 'https', port: '9443' })),
    'https://192.0.2.10/cgi-bin/nikki-refresh',
  ))
for (const origin of ['http://192.0.2.10:8080', 'https://192.0.2.10:8443']) {
  test(`explicit same-host origin ${origin}`, () =>
    assert.equal(
      getNikkiRefreshURL(withIntegration({ bridgeOrigin: origin })),
      `${origin}/cgi-bin/nikki-refresh`,
    ))
}
test('IPv6 origin supports a different bridge port', () =>
  assert.equal(
    getNikkiRefreshURL(
      makeBackend({
        host: '2001:db8::10',
        nikkiIntegration: {
          enabled: true,
          refreshPath: '/cgi-bin/refresh',
          bridgeOrigin: 'https://[2001:db8::10]:8443',
        },
      }),
    ),
    'https://[2001:db8::10]:8443/cgi-bin/refresh',
  ))

for (const path of [
  '//attacker.example/refresh',
  'https://attacker.example',
  'javascript:alert(1)',
  '/\\attacker.example',
  '/cgi-bin/../refresh',
  '/cgi-bin/./refresh',
  '/%2f%2fattacker.example',
  '/cgi-bin/refresh?token=x',
  '/cgi-bin/refresh#x',
  '/cgi-bin/refresh\n',
  'cgi-bin/refresh',
  '',
]) {
  test(`reject unsafe path ${JSON.stringify(path)}`, () =>
    rejectKey(withIntegration({ refreshPath: path }), 'nikkiInvalidPath'))
}
for (const origin of [
  'javascript:alert(1)',
  '//192.0.2.10',
  'http://192.0.2.10/path',
  'http://user:pass@192.0.2.10',
  'http://192.0.2.10?x=y',
  'http://192.0.2.10:99999',
]) {
  test(`reject unsafe origin ${origin}`, () =>
    rejectKey(withIntegration({ bridgeOrigin: origin }), 'nikkiInvalidOrigin'))
}
test('reject a different bridge hostname before sending credentials', () =>
  rejectKey(
    withIntegration({ bridgeOrigin: 'https://attacker.example' }),
    'nikkiOriginHostMismatch',
  ))
test('reject mixed content, allow HTTPS bridge', () => {
  rejectKey(makeBackend(), 'nikkiMixedContent', 'https:')
  assert.equal(
    getNikkiIntegrationError(withIntegration({ bridgeOrigin: 'https://192.0.2.10' }), 'https:'),
    '',
  )
})
for (const host of [
  'user@router.example',
  'router.example/path',
  '192.0.2.10:9090',
  '[invalid]',
  '',
]) {
  test(`reject malformed backend host ${host}`, () =>
    rejectKey(makeBackend({ host }), 'nikkiInvalidHost'))
}
test('legacy, disabled and dae backends do not enable Nikki; no IP migration', () => {
  for (const backend of [
    undefined,
    makeBackend({ nikkiIntegration: undefined }),
    withIntegration({ enabled: false }),
    withIntegration({ enabled: 'true' }),
    makeBackend({ type: 'dae' }),
    makeBackend({ host: '192.168.31.2', nikkiIntegration: undefined }),
  ]) {
    assert.equal(isNikkiIntegrationEnabled(backend), false)
  }
  assert.equal(isNikkiIntegrationEnabled(makeBackend({ host: 'router-third.example' })), true)
})

test('settings round-trip preserves per-backend isolation without exporting secrets', () => {
  const original = [
    makeBackend(),
    makeBackend({
      uuid: 'second',
      host: 'router-two.example',
      nikkiIntegration: { enabled: false, refreshPath: '/other' },
    }),
  ]
  const saved = exportNikkiIntegrationSettings(original)
  assert.equal(saved.includes('offline-test-token'), false)
  assert.equal(saved.includes('password'), false)
  const changed = original.map((backend) => ({ ...backend, nikkiIntegration: undefined }))
  const restored = restoreNikkiIntegrationSettings(changed, saved)
  assert.deepEqual(
    restored.map((backend) => backend.nikkiIntegration),
    original.map((backend) => backend.nikkiIntegration),
  )
  assert.equal(changed[0].nikkiIntegration, undefined)
  assert.equal(restored[0].password, original[0].password)
  assert.equal(
    restoreNikkiIntegrationSettings(
      [makeBackend({ host: 'other.example', nikkiIntegration: undefined })],
      saved,
    )[0].nikkiIntegration,
    undefined,
  )
  assert.equal(
    restoreNikkiIntegrationSettings(
      [makeBackend({ uuid: 'new-browser', nikkiIntegration: undefined })],
      saved,
    )[0].nikkiIntegration.enabled,
    true,
  )
})
test('ambiguous backup does not guess a backend', () => {
  const saved = exportNikkiIntegrationSettings([makeBackend({ uuid: 'old' })])
  assert.throws(
    () =>
      restoreNikkiIntegrationSettings(
        [makeBackend({ uuid: 'one' }), makeBackend({ uuid: 'two' })],
        saved,
      ),
    (error) => error.key === 'nikkiInvalidBackup',
  )
})
test('malformed and foreign-host backups are rejected atomically', () => {
  assert.throws(
    () => restoreNikkiIntegrationSettings([makeBackend()], '{}'),
    (error) => error.key === 'nikkiInvalidBackup',
  )
  const saved = JSON.parse(exportNikkiIntegrationSettings([makeBackend()]))
  saved.backends[0].nikkiIntegration.bridgeOrigin = 'http://attacker.example'
  assert.throws(
    () => restoreNikkiIntegrationSettings([makeBackend()], JSON.stringify(saved)),
    (error) => error.key === 'nikkiOriginHostMismatch',
  )
})
test('normal Dashboard settings export/import restores integration, never controller credentials', () => {
  storage.clear()
  storage.setItem('setup/api-list', JSON.stringify([makeBackend()]))
  storage.setItem('config/theme', 'dark')
  const saved = utils.getDashboardSettingsFromStorage()
  assert.equal(JSON.stringify(saved).includes('offline-test-token'), false)
  assert.ok(saved[NIKKI_SETTINGS_KEY])
  storage.setItem('setup/api-list', JSON.stringify([makeBackend({ nikkiIntegration: undefined })]))
  utils.applyDashboardSettingsToStorage(saved)
  const restored = JSON.parse(storage.getItem('setup/api-list'))[0]
  assert.equal(restored.nikkiIntegration.enabled, true)
  assert.equal(restored.password, 'offline-test-token')
  assert.equal(storage.getItem(NIKKI_SETTINGS_KEY), null)
})
test('URL initialization remains disabled unless an existing backend was explicitly configured', () => {
  window.location.search = '?hostname=router.example&port=9090&nikkiIntegration=1'
  assert.equal(utils.getBackendFromUrl().nikkiIntegration, undefined)
})

test('disabled or invalid integration never calls fetch', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    throw new Error('unexpected request')
  }
  for (const backend of [
    makeBackend({ nikkiIntegration: undefined }),
    withIntegration({ enabled: false }),
    withIntegration({ bridgeOrigin: 'http://attacker.example' }),
    withIntegration({ refreshPath: '//attacker.example' }),
  ]) {
    activeBackend.value = backend
    await assert.rejects(refreshNikkiSubscriptionAPI())
  }
  assert.equal(calls, 0)
})
test('POST retains raw password body and JSON protocol; redirects and cookies are disabled', async () => {
  activeBackend.value = makeBackend()
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response('{"success":true}')
  }
  assert.equal((await refreshNikkiSubscriptionAPI()).success, true)
  assert.equal(request.url, 'http://192.0.2.10/cgi-bin/nikki-refresh')
  assert.deepEqual(request.options, {
    method: 'POST',
    body: 'offline-test-token',
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
})
test('switching active Backend uses its own origin, path and token', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: options.body })
    return new Response('{"success":true}')
  }
  activeBackend.value = makeBackend()
  await refreshNikkiSubscriptionAPI()
  activeBackend.value = makeBackend({
    host: 'router-two.example',
    password: 'second-offline-token',
    nikkiIntegration: {
      enabled: true,
      refreshPath: '/other',
      bridgeOrigin: 'http://router-two.example:8080',
    },
  })
  await refreshNikkiSubscriptionAPI()
  assert.equal(requests[1].url, 'http://router-two.example:8080/other')
  assert.equal(requests[1].body, 'second-offline-token')
})
test('HTTP errors, malformed JSON and false success fail clearly', async () => {
  activeBackend.value = makeBackend()
  for (const response of [
    new Response('not json'),
    new Response('{"success":false}'),
    new Response('{"success":true}', { status: 500 }),
    new Response('null'),
  ]) {
    globalThis.fetch = async () => response
    await assert.rejects(refreshNikkiSubscriptionAPI())
  }
})

for (const host of ['2001:db8::10', '[2001:db8::10]']) {
  test(`controller URL brackets IPv6 literal ${host} without changing its port`, () => {
    assert.equal(
      utils.getUrlFromBackend(makeBackend({ host })),
      'http://[2001:db8::10]:9090/controller',
    )
  })
}
test('a port embedded in a bracketed IPv6 host is rejected', () =>
  rejectKey(makeBackend({ host: '[2001:db8::10]:80' }), 'nikkiInvalidHost'))

test('missing CGI returns an actionable HTTP 404 error, not success', async () => {
  activeBackend.value = makeBackend()
  globalThis.fetch = async () => new Response('<html>Not Found</html>', { status: 404 })
  await assert.rejects(refreshNikkiSubscriptionAPI(), { message: 'nikkiBridgeNotFound' })
})
