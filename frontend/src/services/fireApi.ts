import type { FireDataCatalog } from '../types/api'

const MOCK_URL = '/mocks/fire-data.json'

export async function fetchFireCatalog(signal?: AbortSignal): Promise<FireDataCatalog> {
  const response = await fetch(MOCK_URL, { signal })

  if (!response.ok) {
    throw new Error(`Não foi possível carregar a série harmonizada (${response.status}).`)
  }

  return (await response.json()) as FireDataCatalog
}
