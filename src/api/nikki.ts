import { activeBackend } from '@/store/setup'

export const refreshNikkiSubscriptionAPI = async () => {
  const backend = activeBackend.value

  if (!backend) {
    throw new Error('No active backend')
  }

  const response = await fetch(`http://${backend.host}/cgi-bin/nikki-refresh`, {
    method: 'POST',
    body: backend.password || '',
  })

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to refresh Nikki subscription')
  }

  return result
}
