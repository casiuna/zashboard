import type { Backend, NikkiIntegration } from '@/types'
import { getNikkiIntegrationError, NikkiIntegrationError } from './nikki'

// Dashboard exports deliberately exclude controller credentials. Match integrations to
// existing backends by UUID + controller identity, or by an unambiguous identity on import.
export const NIKKI_SETTINGS_KEY = 'config/nikki-integrations'
const identityKeys = ['type', 'protocol', 'host', 'port', 'secondaryPath'] as const

const cleanIntegration = (value: NikkiIntegration): NikkiIntegration => ({
  enabled: value.enabled,
  refreshPath: value.refreshPath,
  ...(value.bridgeOrigin ? { bridgeOrigin: value.bridgeOrigin } : {}),
})

export const exportNikkiIntegrationSettings = (backends: Backend[]): string =>
  JSON.stringify({
    version: 1,
    backends: backends
      .filter((backend) => backend.type === 'clash' && backend.nikkiIntegration)
      .map((backend) => ({
        uuid: backend.uuid,
        type: backend.type,
        protocol: backend.protocol,
        host: backend.host,
        port: backend.port,
        secondaryPath: backend.secondaryPath,
        nikkiIntegration: cleanIntegration(backend.nikkiIntegration!),
      })),
  })

export const restoreNikkiIntegrationSettings = (
  backends: Backend[],
  serialized: unknown,
): Backend[] => {
  try {
    if (typeof serialized !== 'string' || !Array.isArray(backends)) throw new Error()
    const snapshot = JSON.parse(serialized)
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.backends)) throw new Error()
    const updates = new Map<string, NikkiIntegration>()
    for (const entry of snapshot.backends) {
      if (
        !entry ||
        typeof entry.uuid !== 'string' ||
        entry.type !== 'clash' ||
        !identityKeys.every((key) => typeof entry[key] === 'string') ||
        typeof entry.nikkiIntegration?.enabled !== 'boolean' ||
        typeof entry.nikkiIntegration?.refreshPath !== 'string' ||
        (entry.nikkiIntegration.bridgeOrigin !== undefined &&
          typeof entry.nikkiIntegration.bridgeOrigin !== 'string')
      ) {
        throw new Error()
      }
      const nikkiIntegration = cleanIntegration(entry.nikkiIntegration)
      const validationError = getNikkiIntegrationError({ ...entry, nikkiIntegration })
      if (validationError) throw new NikkiIntegrationError(validationError)
      const matches = backends.filter((backend) =>
        identityKeys.every((key) => backend[key] === entry[key]),
      )
      const match =
        matches.find((backend) => backend.uuid === entry.uuid) ??
        (matches.length === 1 ? matches[0] : undefined)
      if (!match && matches.length > 1) throw new Error()
      if (match) updates.set(match.uuid, nikkiIntegration)
    }
    return backends.map((backend) =>
      updates.has(backend.uuid)
        ? { ...backend, nikkiIntegration: updates.get(backend.uuid)! }
        : backend,
    )
  } catch (error) {
    if (error instanceof NikkiIntegrationError) throw error
    throw new NikkiIntegrationError('nikkiInvalidBackup')
  }
}
