import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useMemo, useState } from 'react'

import type { PLCTask } from '../../../../middleware/shared/ports/types'
import {
  findIntervalsOffTick,
  taskCoreCount,
  taskCoreProblem,
  taskSettingsProblem,
  taskStackChoices,
  taskStackLabel,
  taskThreadsFor,
} from '../../../../middleware/shared/utils/rtos'
import { useRtosMode } from '../../../hooks/use-rtos-mode'
import { useTargetCapabilities } from '../../../hooks/use-target-capabilities'
import { LocationWarningGlyph } from '../../_atoms/location-warning-glyph'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms/select'
import ArrowButtonGroup from '../../_features/[workspace]/editor/graphical/elements/arrow-button-group'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '../modal'

type ISelectableCellProps = CellContext<PLCTask, unknown>

const triggerOptions = ['Cyclic', 'Interrupt']

const SelectableTriggerCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue()

  const [cellValue, setCellValue] = useState(initialValue)

  const onValueChange = (value: string) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => onValueChange(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className='flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300'
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {triggerOptions.map((option) => (
          <SelectItem
            key={option}
            value={option}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {_.startCase(option)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SelectableIntervalCell = ({
  getValue,
  row: { index, original },
  column: { id },
  table,
}: ISelectableCellProps) => {
  const initialValue: string = getValue() as string
  // RTOS mode releases every task on the RTOS tick: flag a period it cannot keep
  // here, where it is set, rather than only when the build reaches it.
  const rtosMode = useRtosMode()
  const offTick = rtosMode
    ? findIntervalsOffTick([{ ...original, interval: initialValue }], rtosMode.profile.tickNs)[0]
    : undefined
  const [intervalModalOpen, setIntervalModalIsOpen] = useState(false)
  const [values, setValues] = useState({
    day: 0,
    hour: 0,
    min: 0,
    sec: 0,
    ms: 0,
    us: 0,
  })
  const [tempValues, setTempValues] = useState(values)

  useEffect(() => {
    const regex = /T#(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)min)?(?:(\d+)s)?(?:(\d+)ms)?(?:(\d+)us)?/

    const match = initialValue?.match(regex)

    if (match) {
      const [, day = 0, hour = 0, min = 0, sec = 0, ms = 0, us = 0] = match.map((v) => (v ? Number(v) : 0))

      const newValues = {
        day,
        hour,
        min,
        sec,
        ms,
        us,
      }

      setValues(newValues)
      setTempValues(newValues)
    }
  }, [initialValue])

  const formattedInterval = useMemo(() => {
    const { day, hour, min, sec, ms, us } = values

    return `T#${day > 0 ? `${day}d` : ''}${hour > 0 ? `${hour}h` : ''}${min > 0 ? `${min}m` : ''}${sec > 0 ? `${sec}s` : ''}${ms > 0 ? `${ms}ms` : ''}${us > 0 ? `${us}us` : ''}`
  }, [values])
  const handleSave = () => {
    const updatedValues = { ...tempValues }

    if (tempValues.us >= 1000) {
      const additionalMs = Math.floor(tempValues.us / 1000)
      updatedValues.ms += additionalMs
      updatedValues.us = tempValues.us % 1000
    }

    if (updatedValues.ms >= 1000) {
      const additionalSec = Math.floor(updatedValues.ms / 1000)
      updatedValues.sec += additionalSec
      updatedValues.ms = updatedValues.ms % 1000
    }

    setValues(updatedValues)
    setTempValues(updatedValues)

    const formattedInterval = `T#${updatedValues.day > 0 ? `${updatedValues.day}d` : ''}${updatedValues.hour > 0 ? `${updatedValues.hour}h` : ''}${updatedValues.min > 0 ? `${updatedValues.min}min` : ''}${updatedValues.sec > 0 ? `${updatedValues.sec}s` : ''}${updatedValues.ms > 0 ? `${updatedValues.ms}ms` : ''}${updatedValues.us > 0 ? `${updatedValues.us}us` : ''}`

    table.options.meta?.updateData(index, id, formattedInterval)
    setIntervalModalIsOpen(false)
  }

  const handleCancel = () => {
    setTempValues(values)
    setIntervalModalIsOpen(false)
  }

  const handleValueChange = (field: keyof typeof values, change: number) => {
    setTempValues((prev) => {
      const newValue = Math.max(0, prev[field] + change)
      return {
        ...prev,
        [field]: newValue,
      }
    })
  }

  return (
    <Modal open={intervalModalOpen} onOpenChange={setIntervalModalIsOpen}>
      <ModalTrigger
        asChild
        className='flex h-8 w-full cursor-pointer items-center justify-center outline-none dark:hover:bg-neutral-900'
      >
        <div className='flex h-full w-full cursor-pointer items-center justify-center gap-1 p-2 outline-none'>
          <span className='line-clamp-1 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
            {formattedInterval}
          </span>
          {offTick && rtosMode && (
            // The warning explains; it does not open the interval editor, which
            // the rest of the cell does.
            <span
              role='presentation'
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <LocationWarningGlyph
                label='Interval RTOS mode cannot keep'
                tooltip={`RTOS mode cannot keep this interval: ${offTick.reason}. ${
                  rtosMode.chosen
                    ? 'Builds fail until it can, or until RTOS mode is turned off in Board Settings.'
                    : 'Builds for this board use the single scan loop until it can.'
                }`}
              />
            </span>
          )}
        </div>
      </ModalTrigger>
      <ModalContent
        onClose={handleCancel}
        className='flex max-h-56 w-fit select-none flex-col justify-between gap-2 rounded-lg p-8'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Set interval</ModalTitle>
        <div className='flex h-24 w-full gap-2'>
          {(['day', 'hour', 'min', 'sec', 'ms', 'us'] as const).map((interval) => (
            <div key={interval} className='flex w-full flex-col justify-center gap-1 font-caption text-xs'>
              <label htmlFor={interval} className='w-full text-neutral-950 dark:text-white'>
                {interval}
              </label>
              <div className='flex gap-1'>
                <input
                  id={interval}
                  type='number'
                  className='h-[26px] w-16 rounded-lg border border-neutral-300 bg-white p-2 text-center text-xs text-neutral-700 outline-none ring-brand focus:border-brand focus:ring-2 dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-100'
                  value={tempValues[interval] || ''}
                  onChange={(e) =>
                    setTempValues((prev) => ({
                      ...prev,
                      [interval]: Number(e.target.value),
                    }))
                  }
                />
                <ArrowButtonGroup
                  onIncrement={() => handleValueChange(interval, 1)}
                  onDecrement={() => handleValueChange(interval, -1)}
                />
              </div>
            </div>
          ))}
        </div>
        <div className='flex h-8 w-full justify-evenly gap-7'>
          <button
            onClick={handleCancel}
            className='h-full w-[236px] rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className='h-full w-[236px] rounded-lg bg-brand text-center font-medium text-white'
          >
            Ok
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
const coreLabel = (core: number | undefined) => (core === undefined ? 'Auto' : `Core ${core}`)

/**
 * The task's CPU core: Auto (the runtime places it) or a core of the board.
 * Offered where the target can place a task (RTOS mode on a multi-core board, a
 * Linux runtime); elsewhere Auto only. A core the board cannot give the task is
 * flagged here, as the build will refuse it.
 */
const SelectableCoreCell = ({ row: { index, original }, table }: ISelectableCellProps) => {
  const capabilities = useTargetCapabilities()
  const rtosOn = useRtosMode() !== undefined
  const cores = taskCoreCount(capabilities, rtosOn)
  const core = original.core
  const problem = taskCoreProblem([original], capabilities, rtosOn)

  const options: (number | undefined)[] = [undefined, ...Array.from({ length: cores > 1 ? cores : 0 }, (_, i) => i)]
  const onValueChange = (value: string) => {
    table.options.meta?.updateData(index, 'core', value === 'auto' ? undefined : Number(value))
  }

  return (
    <div className='flex h-full w-full items-center justify-center gap-1'>
      <Select value={core === undefined ? 'auto' : String(core)} onValueChange={onValueChange} disabled={cores <= 1}>
        <SelectTrigger
          aria-label={`Core of ${original.name}`}
          title={cores <= 1 ? 'This board runs every task on the core the runtime picks (Auto).' : undefined}
          placeholder={coreLabel(core)}
          className='flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-300'
        />
        <SelectContent
          position='popper'
          side='bottom'
          sideOffset={-20}
          className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
        >
          {options.map((option) => (
            <SelectItem
              key={option ?? 'auto'}
              value={option === undefined ? 'auto' : String(option)}
              className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
            >
              <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                {coreLabel(option)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {problem && <LocationWarningGlyph label='Core this board cannot give the task' tooltip={problem} />}
    </div>
  )
}

const settingTriggerClass =
  'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-300'
const settingContentClass = 'box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
const settingItemClass =
  'flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
const NO_THREADS_TIP =
  'This board runs every task in one loop (RTOS mode off): a stuck task stops the PLC, and every task has the default stack.'

/**
 * Whether the task stuck in one scan stops the PLC: Yes (the default, as
 * always) or No (it is reported, and the PLC and the other tasks keep running),
 * for a communications task whose block can wait seconds on the network.
 * Offered where each task is a thread of its own (RTOS mode, a Linux runtime).
 */
const SelectableStopOnStuckCell = ({ row: { index, original }, table }: ISelectableCellProps) => {
  const capabilities = useTargetCapabilities()
  const rtosOn = useRtosMode() !== undefined
  const threads = taskThreadsFor(capabilities, rtosOn)
  const stops = original.stopOnStuck !== false
  const problem = original.stopOnStuck === false ? taskSettingsProblem([original], capabilities, rtosOn) : undefined

  const onValueChange = (value: string) => {
    table.options.meta?.updateData(index, 'stopOnStuck', value === 'no' ? false : undefined)
  }

  return (
    <div className='flex h-full w-full items-center justify-center gap-1'>
      <Select value={stops ? 'yes' : 'no'} onValueChange={onValueChange} disabled={!threads && stops}>
        <SelectTrigger
          aria-label={`Stop PLC if ${original.name} is stuck`}
          title={
            !threads
              ? NO_THREADS_TIP
              : 'No: when this task is stuck in one scan, it is reported and the PLC and the other tasks keep running.'
          }
          placeholder={stops ? 'Yes' : 'No'}
          className={settingTriggerClass}
        />
        <SelectContent position='popper' side='bottom' sideOffset={-20} className={settingContentClass}>
          {(['yes', 'no'] as const).map((option) => (
            <SelectItem key={option} value={option} className={settingItemClass}>
              <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                {option === 'yes' ? 'Yes' : 'No'}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {problem && <LocationWarningGlyph label='Setting this board cannot give the task' tooltip={problem} />}
    </div>
  )
}

/**
 * The task's stack: Default (the target's size) or a size in the board's
 * range. A size set elsewhere (the CLI) is shown as it is, flagged when the
 * build will refuse it.
 */
const SelectableStackCell = ({ row: { index, original }, table }: ISelectableCellProps) => {
  const capabilities = useTargetCapabilities()
  const rtosOn = useRtosMode() !== undefined
  const threads = taskThreadsFor(capabilities, rtosOn)
  const stack = original.stack
  const problem = stack !== undefined ? taskSettingsProblem([original], capabilities, rtosOn) : undefined
  const choices = taskStackChoices(threads, stack)

  const onValueChange = (value: string) => {
    table.options.meta?.updateData(index, 'stack', value === 'default' ? undefined : Number(value))
  }

  return (
    <div className='flex h-full w-full items-center justify-center gap-1'>
      <Select
        value={stack === undefined ? 'default' : String(stack)}
        onValueChange={onValueChange}
        disabled={!threads && stack === undefined}
      >
        <SelectTrigger
          aria-label={`Stack of ${original.name}`}
          title={
            !threads
              ? NO_THREADS_TIP
              : `Default is the board's own size; this board takes ${taskStackLabel(threads.stackMin)} to ${taskStackLabel(threads.stackMax)}.`
          }
          placeholder={taskStackLabel(stack)}
          className={settingTriggerClass}
        />
        <SelectContent position='popper' side='bottom' sideOffset={-20} className={settingContentClass}>
          {[undefined, ...choices].map((option) => (
            <SelectItem
              key={option ?? 'default'}
              value={option === undefined ? 'default' : String(option)}
              className={settingItemClass}
            >
              <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                {taskStackLabel(option)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {problem && <LocationWarningGlyph label='Stack this board cannot give the task' tooltip={problem} />}
    </div>
  )
}

export {
  SelectableCoreCell,
  SelectableIntervalCell,
  SelectableStackCell,
  SelectableStopOnStuckCell,
  SelectableTriggerCell,
}
