import { useEffect, useState } from 'react'
import { fetchFireCatalog } from '../services/fireApi'
import type { FireDataCatalog } from '../types/api'

type Status = 'loading' | 'ready' | 'error'

export function useFireData() {
  const [catalog, setCatalog] = useState<FireDataCatalog | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    fetchFireCatalog(controller.signal)
      .then((data) => {
        setCatalog(data)
        setStatus('ready')
        setError(null)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setCatalog(null)
        setStatus('error')
        setError(reason instanceof Error ? reason.message : 'Failed to load the data.')
      })

    return () => controller.abort()
  }, [attempt])

  return {
    catalog,
    status,
    error,
    reload: () => {
      setStatus('loading')
      setError(null)
      setAttempt((value) => value + 1)
    },
  }
}
