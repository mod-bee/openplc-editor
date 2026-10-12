import { Label } from '@root/frontend/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { FieldHelpIcon, TooltipProvider } from '@root/frontend/components/_atoms/tooltip'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import { isArduinoTarget, isOpenPLCRuntimeV4Target } from '@root/frontend/utils/device'
import type { BoardInfo, OutputsOnStop } from '@root/middleware/shared/ports/types'

const OUTPUTS_ON_STOP_HELP =
  'What the outputs do when the PLC stops or goes to ERROR. Off switches every output off. Hold keeps each ' +
  'output at the value the last scan gave it, until the PLC runs again. Retained values are kept either way. ' +
  'A board that restarts after a fault starts with its outputs off.'

const OPTIONS: { value: OutputsOnStop; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'hold', label: 'Hold last value' },
]

type OutputsOnStopSelectProps = {
  boardInfo: BoardInfo | undefined
}

/**
 * Outputs on STOP and in ERROR, as CODESYS's "Behaviour of outputs in Stop":
 * off (the default) or held at their last values. A project setting, built
 * into both runtimes (OPENPLC_OUTPUTS_ON_STOP in defines.h), so it is shown
 * for Arduino boards and runtime v4 targets only. Styled as a VPP form row.
 */
function OutputsOnStopSelect({ boardInfo }: OutputsOnStopSelectProps) {
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const outputsOnStop = useOpenPLCStore((s) => s.deviceDefinitions.configuration.outputsOnStop) ?? 'off'
  const setOutputsOnStop = useOpenPLCStore((s) => s.deviceActions.setOutputsOnStop)

  if (!isArduinoTarget(boardInfo) && !isOpenPLCRuntimeV4Target(deviceBoard, boardInfo)) return null

  return (
    <TooltipProvider>
      <div id='outputs-on-stop-field' className='flex items-center gap-4'>
        <Label
          id='outputs-on-stop-label'
          className='min-w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'
        >
          Outputs on STOP / error
        </Label>
        <Select value={outputsOnStop} onValueChange={(value) => setOutputsOnStop(value as OutputsOnStop)}>
          <SelectTrigger
            aria-label='Outputs on STOP / error'
            withIndicator
            className='flex h-[30px] w-44 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
          />
          <SelectContent
            className='h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
            sideOffset={5}
            position='popper'
            align='center'
            side='bottom'
          >
            {OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className={cn(
                  'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                  'flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                )}
              >
                <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                  {option.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldHelpIcon text={OUTPUTS_ON_STOP_HELP} />
      </div>
    </TooltipProvider>
  )
}

export { OutputsOnStopSelect }
