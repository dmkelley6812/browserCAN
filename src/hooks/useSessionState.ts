import { useState, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export function useSessionState<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = sessionStorage.getItem(key)
      if (item !== null) return JSON.parse(item) as T
    } catch {
      // ignore parse errors — fall through to initial
    }
    return initial
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state))
    } catch {
      // ignore quota exceeded
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state])

  return [state, setState]
}

export function useSessionSetState(
  key: string,
  initial?: Set<number>
): [Set<number>, Dispatch<SetStateAction<Set<number>>>] {
  const [state, setState] = useState<Set<number>>(() => {
    try {
      const item = sessionStorage.getItem(key)
      if (item !== null) return new Set(JSON.parse(item) as number[])
    } catch {
      // ignore
    }
    return initial ?? new Set()
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify([...state]))
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state])

  return [state, setState]
}
