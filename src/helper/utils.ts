import { MIN_PROXY_CARD_WIDTH, PROXY_CARD_SIZE } from '@/constant'
import type { Backend, BackendType } from '@/types'
import { useMediaQuery } from '@vueuse/core'
import dayjs from 'dayjs'
import prettyBytes, { type Options } from 'pretty-bytes'
import {
  exportNikkiIntegrationSettings,
  NIKKI_SETTINGS_KEY,
  restoreNikkiIntegrationSettings,
} from './nikki-settings'

export const isPreferredDark = useMediaQuery('(prefers-color-scheme: dark)')
export const isMiddleScreen = useMediaQuery('(max-width: 768px)')
export const isPWA = (() => {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
})()

export const prettyBytesHelper = (bytes: number, opts?: Options) => {
  return prettyBytes(Number.isFinite(bytes) ? bytes : 0, {
    binary: false,
    ...opts,
  })
}

export const prettySpeedHelper = (bytes: number, opts?: Options) => {
  const value = Number.isFinite(bytes) ? bytes : 0
  const maximumFractionDigits = opts?.maximumFractionDigits ?? 1

  return value < 1000
    ? `${(value / 1000).toFixed(maximumFractionDigits)} kB`
    : prettyBytesHelper(value, { maximumFractionDigits, ...opts })
}

export const fromNow = (timestamp: string | number) => {
  return dayjs(timestamp).fromNow()
}

export const prettyUptimeHelper = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '-'

  const uptime = dayjs.duration(seconds, 'seconds')

  return uptime.days() > 0 ? uptime.format('D[d] HH:mm:ss') : uptime.format('HH:mm:ss')
}

export const getDashboardSettingsFromStorage = () => {
  const settings: Record<string, string> = {}

  for (const key in localStorage) {
    if (key.startsWith('config/') && key !== NIKKI_SETTINGS_KEY) {
      settings[key] = localStorage.getItem(key) as string
    }
  }

  const backends: Backend[] = JSON.parse(localStorage.getItem('setup/api-list') || '[]')
  if (backends.some((backend) => backend.nikkiIntegration)) {
    settings[NIKKI_SETTINGS_KEY] = exportNikkiIntegrationSettings(backends)
  }
  return settings
}

export const applyNikkiIntegrationSettingsToStorage = (settings: Record<string, unknown>) => {
  if (!(NIKKI_SETTINGS_KEY in settings)) return
  const backends: Backend[] = JSON.parse(localStorage.getItem('setup/api-list') || '[]')
  const restored = restoreNikkiIntegrationSettings(backends, settings[NIKKI_SETTINGS_KEY])
  localStorage.setItem('setup/api-list', JSON.stringify(restored))
}

export const applyDashboardSettingsToStorage = (settings: Record<string, unknown>) => {
  applyNikkiIntegrationSettingsToStorage(settings)
  for (const key in settings) {
    if (key.startsWith('config/') && key !== NIKKI_SETTINGS_KEY) {
      localStorage.setItem(key, settings[key] as string)
    }
  }
}

export const exportSettings = () => {
  const settings = getDashboardSettingsFromStorage()
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'zashboard-settings'
  a.click()
  URL.revokeObjectURL(url)
}

export const resetSettings = () => {
  const keysToReset = Object.keys(localStorage).filter((key) => {
    return key.startsWith('config/')
  })

  keysToReset.forEach((key) => localStorage.removeItem(key))
  window.location.reload()
}

export const getUrlFromBackend = (end: {
  protocol: string
  host: string
  port: string
  secondaryPath?: string
}) => {
  const host = end.host.includes(':') && !end.host.startsWith('[') ? `[${end.host}]` : end.host
  return `${end.protocol}://${host}:${end.port}${end.secondaryPath || ''}`
}

export const getBackendProbeUrl = (end: Omit<Backend, 'uuid'>) => getUrlFromBackend(end)

export const getLabelFromBackend = (end: Omit<Backend, 'uuid'>) => {
  return end.label || `${end.host}:${end.port}`
}

export const getMinCardWidth = (size: PROXY_CARD_SIZE) => {
  return size === PROXY_CARD_SIZE.LARGE ? MIN_PROXY_CARD_WIDTH.LARGE : MIN_PROXY_CARD_WIDTH.SMALL
}

export const PROXIES_PARENT_CLASS = 'proxies-scrollable-parent'

const getProtocolFromQuery = (query: URLSearchParams) => {
  const protocol = query.get('protocol')

  if (protocol === 'http' || protocol === 'https') {
    return protocol
  }
  if (query.get('http')) {
    return 'http'
  }
  if (query.get('https')) {
    return 'https'
  }

  return window.location.protocol.replace(':', '')
}

export const getBackendFromUrl = () => {
  const query = new URLSearchParams(
    window.location.search || location.hash.match(/\?.*$/)?.[0]?.replace('?', ''),
  )

  if (query.has('hostname')) {
    const type = query.get('type') === 'dae' ? 'dae' : 'clash'

    return {
      type: type as BackendType,
      protocol: getProtocolFromQuery(query),
      secondaryPath: query.get('secondaryPath') || '',
      host: query.get('hostname') as string,
      port: query.get('port') as string,
      password: query.get('secret') || '',
      label: query.get('label') || '',
      disableUpgradeCore:
        query.get('disableUpgradeCore') === '1' || query.get('disableUpgradeCore') === 'core',
      disableTunMode: query.get('disableTunMode') === '1' || query.get('disableTunMode') === 'tun',
    }
  }
  return null
}
