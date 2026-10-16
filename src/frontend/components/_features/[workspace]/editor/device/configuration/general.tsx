import { boardSelectors } from '../../../../../../hooks/use-store-selectors'
import { BuildOutputSwitch } from './components/build-output-switch'
import { DebuggerDisplaySettings } from './components/debugger-display-settings'

/**
 * Configuration > General: the project's settings that are not about the board itself — what a build
 * keeps, and how the debugger shows values.
 */
const General = () => {
  const availableBoards = boardSelectors.useAvailableBoards()
  const deviceBoard = boardSelectors.useDeviceBoard()
  const boardInfo = availableBoards.get(deviceBoard)

  return (
    <div id='device-configuration-general' className='flex w-full max-w-2xl flex-col gap-6 p-4'>
      <BuildOutputSwitch boardInfo={boardInfo} />
      <DebuggerDisplaySettings />
    </div>
  )
}

export { General }
