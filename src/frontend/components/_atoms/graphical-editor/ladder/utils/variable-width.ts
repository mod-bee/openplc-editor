/**
 * How wide a ladder variable element is, and how much room a block leaves on each side for them.
 *
 * An element is at least DEFAULT_VARIABLE_WIDTH and grows to fit its name on one line, so a long name
 * (`IO.din[FN_PUMP_RUN_FB].q`) stretches the wire to its pin instead of wrapping. The width is estimated
 * from the characters rather than measured, so the editor and the CLI (which has no fonts) lay a rung out
 * the same; the estimate errs wide.
 */
import { DEFAULT_VARIABLE_WIDTH } from './constants'

/** Upper bound of one character of the element's text (text-xs, 12 px) incl. letter spacing. */
const CHAR_WIDTH = 7
/** The element's text keeps clear of both of its ends. */
const TEXT_PADDING = 8

/** The text an element shows: its variable, or the pin's type placeholder when it names none. */
export function variableElementText(name: string | undefined, pinType: string | undefined): string {
  return name && name.trim() !== '' ? name.trim() : `(*${pinType ?? ''}*)`
}

export function variableElementWidth(text: string): number {
  return Math.max(DEFAULT_VARIABLE_WIDTH, Math.ceil(text.length * CHAR_WIDTH) + TEXT_PADDING)
}
