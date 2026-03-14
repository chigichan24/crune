import { useReducer, useEffect } from 'react'
import type { SessionDetail } from '../types'

type State = {
  data: SessionDetail | null
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'fetch' }
  | { type: 'success'; data: SessionDetail }
  | { type: 'error'; error: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'fetch':
      return { ...state, loading: true, error: null }
    case 'success':
      return { data: action.data, loading: false, error: null }
    case 'error':
      return { ...state, loading: false, error: action.error }
  }
}

const initialState: State = { data: null, loading: false, error: null }

export function useSessionDetail(sessionId: string | null) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    if (!sessionId) return

    const controller = new AbortController()
    dispatch({ type: 'fetch' })

    fetch(`/data/sessions/detail/${sessionId}.json`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: SessionDetail) => dispatch({ type: 'success', data }))
      .catch(e => {
        if (e.name !== 'AbortError') dispatch({ type: 'error', error: e.message })
      })

    return () => controller.abort()
  }, [sessionId])

  return {
    data: sessionId ? state.data : null,
    loading: sessionId ? state.loading : false,
    error: sessionId ? state.error : null,
  }
}
