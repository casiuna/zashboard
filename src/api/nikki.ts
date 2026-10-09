import { getNikkiRefreshURL, NikkiIntegrationError } from '@/helper/nikki'
import { i18n } from '@/i18n'
import { activeBackend } from '@/store/setup'

export const refreshNikkiSubscriptionAPI = async () => {
  const backend = activeBackend.value

  if (!backend) {
    throw new Error('No active backend')
  }

  let url: string
  try {
    url = getNikkiRefreshURL(backend, window.location.protocol)
  } catch (error) {
    if (error instanceof NikkiIntegrationError) throw new Error(i18n.global.t(error.key))
    throw error
  }

  const response = await fetch(url, {
    method: 'POST',
    body: backend.password || '',
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })

  if (response.status === 404) {
    throw new Error(i18n.global.t('nikkiBridgeNotFound'))
  }

  let result: { success?: boolean; error?: string } | null
  try {
    result = await response.json()
  } catch {
    throw new Error(i18n.global.t('nikkiInvalidResponse'))
  }

  if (!response.ok || result?.success !== true) {
    throw new Error(
      typeof result?.error === 'string' ? result.error : i18n.global.t('nikkiInvalidResponse'),
    )
  }

  return result
}
