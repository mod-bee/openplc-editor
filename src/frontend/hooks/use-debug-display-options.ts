/**
 * How the debugger writes values on the diagrams: the project's Configuration > General > Debugger
 * settings (`DeviceConfiguration.debugDisplay`), each absent one at its default.
 */
import { useMemo } from 'react'

import type { DebugDisplaySetting } from '../../middleware/shared/ports/types'
import { useOpenPLCStore } from '../store'

export type DebugDisplayOptions = Required<DebugDisplaySetting>

export const DEFAULT_DEBUG_DISPLAY_OPTIONS: DebugDisplayOptions = {
  decimals: 3,
  blockInputs: true,
  functionInputs: true,
  hideSecrets: true,
}

export function debugDisplayOptions(setting: DebugDisplaySetting | undefined): DebugDisplayOptions {
  return { ...DEFAULT_DEBUG_DISPLAY_OPTIONS, ...(setting ?? {}) }
}

export function useDebugDisplayOptions(): DebugDisplayOptions {
  const setting = useOpenPLCStore((state) => state.deviceDefinitions.configuration.debugDisplay)
  return useMemo(() => debugDisplayOptions(setting), [setting])
}
