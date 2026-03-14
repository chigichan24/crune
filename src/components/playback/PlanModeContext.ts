import { createContext, useContext } from 'react'

export const PlanModeContext = createContext<boolean>(false)

export function usePlanMode(): boolean {
  return useContext(PlanModeContext)
}
