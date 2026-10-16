import { Label } from '@root/frontend/components/_atoms/label'
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import { FieldHelpIcon, TooltipProvider } from '@root/frontend/components/_atoms/tooltip'
import { debugDisplayOptions, DEFAULT_DEBUG_DISPLAY_OPTIONS } from '@root/frontend/hooks/use-debug-display-options'
import { useOpenPLCStore } from '@root/frontend/store'
import type { DebugDisplaySetting } from '@root/middleware/shared/ports/types'

type Toggle = { key: 'blockInputs' | 'functionInputs' | 'hideSecrets'; label: string; help: string }

const TOGGLES: Toggle[] = [
  {
    key: 'blockInputs',
    label: 'Block input values',
    help: 'Online, show the value at each input pin of a function block: the value the block was last called with.',
  },
  {
    key: 'functionInputs',
    label: 'Function input values',
    help: 'Online, show the value at each input pin of a function (ADD, SEL, ...), from the output wired into it.',
  },
  {
    key: 'hideSecrets',
    label: 'Hide passwords',
    help: 'Online, show •••• instead of the value of a STRING named like a password, key, token or secret.',
  },
]

const DECIMALS_HELP =
  'Online, how many decimal places a REAL value shows. The PLC keeps full precision; this is only the display.'

/**
 * The project's Debugger settings (`DeviceConfiguration.debugDisplay`): how values read on the diagrams
 * while online. Saved in the project; a setting left at its default is not stored.
 */
function DebuggerDisplaySettings() {
  const setting = useOpenPLCStore((s) => s.deviceDefinitions.configuration.debugDisplay)
  const setDebugDisplay = useOpenPLCStore((s) => s.deviceActions.setDebugDisplay)
  const options = debugDisplayOptions(setting)

  // Store only what differs from the defaults, so a project at the defaults carries nothing.
  const update = (patch: Partial<DebugDisplaySetting>) => {
    const next: DebugDisplaySetting = {}
    const merged = { ...options, ...patch }
    for (const key of Object.keys(merged) as Array<keyof DebugDisplaySetting>) {
      if (merged[key] !== DEFAULT_DEBUG_DISPLAY_OPTIONS[key]) Object.assign(next, { [key]: merged[key] })
    }
    setDebugDisplay(Object.keys(next).length > 0 ? next : undefined)
  }

  return (
    <TooltipProvider>
      <div id='debugger-display-settings' className='flex flex-col gap-3'>
        <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Debugger</Label>
        <div className='flex items-center gap-4'>
          <Label htmlFor='debugger-decimals' className='min-w-32 shrink-0 text-xs text-neutral-950 dark:text-white'>
            Decimal places
          </Label>
          <input
            id='debugger-decimals'
            aria-label='Decimal places'
            type='number'
            min={0}
            max={6}
            step={1}
            value={String(options.decimals)}
            onChange={(e) => {
              const next = Math.round(Number(e.target.value))
              if (Number.isFinite(next) && next >= 0 && next <= 6) update({ decimals: next })
            }}
            className='flex h-[30px] w-16 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
          />
          <FieldHelpIcon text={DECIMALS_HELP} />
        </div>
        {TOGGLES.map(({ key, label, help }) => (
          <div key={key} className='flex items-center gap-4'>
            <Label
              htmlFor={`debugger-${key}`}
              className='min-w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'
            >
              {label}
            </Label>
            <ToggleSwitch
              id={`debugger-${key}`}
              checked={options[key]}
              onCheckedChange={(checked) => update({ [key]: checked })}
              aria-label={label}
            />
            <FieldHelpIcon text={help} />
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}

export { DebuggerDisplaySettings }
