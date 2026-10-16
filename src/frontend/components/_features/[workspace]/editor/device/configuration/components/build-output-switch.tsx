import { Label } from '@root/frontend/components/_atoms/label'
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import { FieldHelpIcon, TooltipProvider } from '@root/frontend/components/_atoms/tooltip'
import { useOpenPLCStore } from '@root/frontend/store'
import { isArduinoTarget, isOpenPLCRuntimeV4Target } from '@root/frontend/utils/device'
import type { BoardInfo } from '@root/middleware/shared/ports/types'

/** How many builds are kept per board when the project does not say. */
export const DEFAULT_BUILD_OUTPUT_COUNT = 10

const BUILD_OUTPUT_HELP =
  'Keep a copy of each successful build in the project, in output/<board>/<date-time>_<program>/: for a board, ' +
  'the images that are flashed (firmware.bin is the program image for OTA updates and USB, firmware.merged.bin ' +
  'the whole flash on an ESP32), for Runtime v4 the program.zip sent to the runtime, which compiles it there. ' +
  'A build.json says what was built. The build folder itself is regenerated on every build, so it never keeps ' +
  'them. The oldest copies beyond the number kept are removed.'

type BuildOutputSwitchProps = {
  boardInfo: BoardInfo | undefined
}

/**
 * The project's "Keep build output" setting (`DeviceConfiguration.buildOutput`): off unless switched on.
 * Shown for Arduino boards and Runtime v4 targets, the two that build here.
 */
function BuildOutputSwitch({ boardInfo }: BuildOutputSwitchProps) {
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const buildOutput = useOpenPLCStore((s) => s.deviceDefinitions.configuration.buildOutput)
  const setBuildOutput = useOpenPLCStore((s) => s.deviceActions.setBuildOutput)

  if (!isArduinoTarget(boardInfo) && !isOpenPLCRuntimeV4Target(deviceBoard, boardInfo)) return null

  const keep = buildOutput?.keep === true
  const count = buildOutput?.count ?? DEFAULT_BUILD_OUTPUT_COUNT

  return (
    <TooltipProvider>
      <div id='build-output-field' className='flex items-center gap-4'>
        <Label
          htmlFor='build-output-switch'
          className='min-w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'
        >
          Keep build output
        </Label>
        <ToggleSwitch
          id='build-output-switch'
          checked={keep}
          onCheckedChange={(checked) => setBuildOutput(checked ? { keep: true, count } : undefined)}
          aria-label='Keep build output'
        />
        <FieldHelpIcon text={BUILD_OUTPUT_HELP} />
        {keep && (
          <div className='flex items-center gap-1'>
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>last</span>
            <input
              id='build-output-count'
              aria-label='Builds kept'
              type='number'
              min={1}
              max={100}
              step={1}
              value={String(count)}
              onChange={(e) => {
                const next = Math.round(Number(e.target.value))
                if (Number.isFinite(next) && next >= 1 && next <= 100) setBuildOutput({ keep: true, count: next })
              }}
              className='flex h-[30px] w-16 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>builds</span>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

export { BuildOutputSwitch }
