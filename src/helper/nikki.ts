import type { Backend } from '@/types'

export const DEFAULT_NIKKI_REFRESH_PATH = '/cgi-bin/nikki-refresh'

export type NikkiErrorKey =
  | 'nikkiIntegrationDisabled'
  | 'nikkiInvalidHost'
  | 'nikkiInvalidPath'
  | 'nikkiInvalidOrigin'
  | 'nikkiOriginHostMismatch'
  | 'nikkiMixedContent'
  | 'nikkiInvalidBackup'

export class NikkiIntegrationError extends Error {
  constructor(public readonly key: NikkiErrorKey) {
    super(key)
  }
}

export const isNikkiIntegrationEnabled = (backend?: Pick<Backend, 'type' | 'nikkiIntegration'>) =>
  backend?.type === 'clash' && backend.nikkiIntegration?.enabled === true

// This is the device's Web server, not the external-controller port or secondaryPath.
export const getDefaultNikkiOrigin = (backend: Pick<Backend, 'protocol' | 'host'>): string => {
  const { host, protocol } = backend
  if (
    typeof host !== 'string' ||
    !host ||
    /[\s/\\@?#%]/.test(host) ||
    (host.startsWith('[') && !/^\[[0-9a-fA-F:.]+\]$/.test(host)) ||
    !['http', 'https'].includes(protocol)
  ) {
    throw new NikkiIntegrationError('nikkiInvalidHost')
  }
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  try {
    const url = new URL(`${protocol}://${authority}`)
    if (url.port || url.username || url.password) throw new Error()
    return url.origin
  } catch {
    throw new NikkiIntegrationError('nikkiInvalidHost')
  }
}

type NikkiBackend = Pick<Backend, 'type' | 'protocol' | 'host' | 'nikkiIntegration'>

export const getNikkiRefreshURL = (backend: NikkiBackend, pageProtocol = ''): string => {
  if (!isNikkiIntegrationEnabled(backend)) {
    throw new NikkiIntegrationError('nikkiIntegrationDisabled')
  }
  const integration = backend.nikkiIntegration!
  const path = integration.refreshPath
  // Accept a literal absolute path only: no authorities, query, fragment, escapes or traversal.
  if (
    typeof path !== 'string' ||
    !/^\/(?!\/)[a-zA-Z0-9/_.~-]+$/.test(path) ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new NikkiIntegrationError('nikkiInvalidPath')
  }

  const defaultOrigin = getDefaultNikkiOrigin(backend)
  let origin = new URL(defaultOrigin)
  if (integration.bridgeOrigin) {
    const value = integration.bridgeOrigin
    if (typeof value !== 'string' || !/^https?:\/\/[^/\s\\?#]+\/?$/.test(value)) {
      throw new NikkiIntegrationError('nikkiInvalidOrigin')
    }
    try {
      origin = new URL(value)
    } catch {
      throw new NikkiIntegrationError('nikkiInvalidOrigin')
    }
    if (origin.username || origin.password || origin.pathname !== '/') {
      throw new NikkiIntegrationError('nikkiInvalidOrigin')
    }
    // A port/protocol override must not silently send the controller secret to another host.
    if (origin.hostname !== new URL(defaultOrigin).hostname) {
      throw new NikkiIntegrationError('nikkiOriginHostMismatch')
    }
  }
  if (pageProtocol === 'https:' && origin.protocol === 'http:') {
    throw new NikkiIntegrationError('nikkiMixedContent')
  }
  return new URL(path, origin).href
}

export const getNikkiIntegrationError = (
  backend: NikkiBackend,
  pageProtocol = '',
): NikkiErrorKey | '' => {
  if (!isNikkiIntegrationEnabled(backend)) return ''
  try {
    getNikkiRefreshURL(backend, pageProtocol)
    return ''
  } catch (error) {
    if (error instanceof NikkiIntegrationError) return error.key
    throw error
  }
}
