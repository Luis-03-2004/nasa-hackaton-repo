import type { FireDataCatalog } from '../types/api'

const MOCK_URL = '/mocks/fire-data.json'

export async function fetchFireCatalog(signal?: AbortSignal): Promise<FireDataCatalog> {
  const response = await fetch(MOCK_URL, { signal })

  if (!response.ok) {
    throw new Error(`Could not load the harmonized series (${response.status}).`)
  }

  return (await response.json()) as FireDataCatalog
}
