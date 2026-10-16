import { useEffect, useState } from 'react'

import { encodeForceValue } from '../../../utils/variable-sizes'
import { Label } from '../../_atoms/label'
import { Modal, ModalContent, ModalTitle } from '../modal'

type ForceValueDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The variable as the user knows it (`well.Data.set.tanks`, `motor.Start`). */
  name: string
  /** Its type as the debugger reads it (`INT`, `REAL`, `TIME`, `STRING`, an enum's base type). */
  type: string
  /** Its value now, as shown online. */
  currentValue?: string
  /** An enumeration's member names (and their values, when not their position): picked from a list. */
  enumValues?: string[]
  enumCodes?: number[]
  /** Force the encoded value; `text` is what the user entered. */
  onForce: (value: Uint8Array, text: string) => Promise<void> | void
}

/** What to type for a type, shown under the field. */
function typeHint(type: string): string {
  const t = type.toUpperCase()
  if (/^L?TIME$/.test(t)) return 'A duration, e.g. T#5s, T#1m30s or 500ms.'
  if (/^L?REAL$/.test(t)) return 'A number, e.g. 12.5 or -3.'
  if (/^W?STRING/.test(t)) return 'Text, without quotes.'
  if (/^(U?(S|D|L)?INT)$/.test(t)) return 'A whole number.'
  if (/^(BYTE|WORD|DWORD|LWORD)$/.test(t)) return 'A whole number, or 16#FF for hex.'
  if (/^(DATE|TOD|DT|TIME_OF_DAY|DATE_AND_TIME)$/.test(t)) return 'As written in ST, e.g. D#2026-10-17.'
  return ''
}

/**
 * Force a non-BOOL value from any online element (watch table, ladder or FBD variable, empty pin). Says
 * what is forced and its type, shows the value now, lists an enumeration's names, and keeps the dialog
 * open with the reason when the value cannot be forced, instead of failing after it closed.
 */
const ForceValueDialog = ({
  open,
  onOpenChange,
  name,
  type,
  currentValue,
  enumValues,
  enumCodes,
  onForce,
}: ForceValueDialogProps) => {
  const isEnum = (enumValues?.length ?? 0) > 0
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setText(isEnum && currentValue && enumValues?.includes(currentValue) ? currentValue : (enumValues?.[0] ?? ''))
    // Only when the dialog opens: the value keeps changing online while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const confirm = async () => {
    if (text.trim() === '') {
      setError('Enter a value to force.')
      return
    }
    let value: Uint8Array
    try {
      value = encodeForceValue(text, type, enumValues, enumCodes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    await onForce(value, text)
    onOpenChange(false)
  }

  const fieldClass =
    'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className='flex h-fit min-h-0 w-[420px] select-none flex-col items-stretch justify-start rounded-lg p-6'>
        <ModalTitle className='mb-1 text-lg font-semibold'>Force value</ModalTitle>
        <p className='mb-4 break-all text-sm text-neutral-600 dark:text-neutral-400'>
          <span className='font-semibold text-neutral-850 dark:text-neutral-200'>{name}</span>{' '}
          <span className='uppercase text-neutral-400'>{type}</span>
          {currentValue !== undefined && <span className='block'>Now: {currentValue}</span>}
        </p>
        <Label htmlFor='force-value-input' className='mb-2 block text-sm text-neutral-950 dark:text-white'>
          Value
        </Label>
        {isEnum ? (
          <select
            id='force-value-input'
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            className={fieldClass}
            autoFocus
          >
            {enumValues?.map((member) => (
              <option key={member} value={member}>
                {member}
              </option>
            ))}
          </select>
        ) : (
          <input
            id='force-value-input'
            type='text'
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void confirm()}
            placeholder='Value'
            className={fieldClass}
            autoFocus
          />
        )}
        {error ? (
          <p role='alert' className='mt-2 text-xs text-red-500'>
            {error}
          </p>
        ) : (
          !isEnum && <p className='mt-2 text-xs text-neutral-500 dark:text-neutral-400'>{typeHint(type)}</p>
        )}
        <p className='mt-2 text-xs text-neutral-500 dark:text-neutral-400'>
          The program cannot change it while it is forced. Release the force to give it back.
        </p>
        <div className='mt-5 flex gap-3'>
          <button
            onClick={() => void confirm()}
            className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
          >
            Force
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { ForceValueDialog }
