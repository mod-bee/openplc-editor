/**
 * The edge marker of a `BOOL R_EDGE` / `BOOL F_EDGE` input (IEC 61131-3 6.6.3.2
 * item 14, Table 40 feature 7): `>` for a rising edge, `<` for a falling one,
 * drawn at the block's edge in front of the pin name (`>START`). It tells the
 * reader the block acts on the moment the signal changes, not on its level.
 */

/** The pin's edge qualifier, read from a block variant's variables; undefined for a level pin. */
export const pinEdge = (
  variables: ReadonlyArray<{ name: string; edge?: string }>,
  pin: string,
): 'R_EDGE' | 'F_EDGE' | undefined => {
  const edge = variables.find((variable) => variable.name === pin)?.edge
  if (edge === 'R_EDGE' || edge === 'rising') return 'R_EDGE'
  if (edge === 'F_EDGE' || edge === 'falling') return 'F_EDGE'
  return undefined
}

const EdgePinMarker = ({ edge }: { edge: 'R_EDGE' | 'F_EDGE' | undefined }) =>
  edge === undefined ? null : (
    <span
      role='img'
      aria-label={edge === 'R_EDGE' ? 'rising edge input' : 'falling edge input'}
      title={edge === 'R_EDGE' ? 'R_EDGE — acts when the input turns on' : 'F_EDGE — acts when the input turns off'}
      className='pointer-events-none mr-0.5 select-none font-bold'
    >
      {edge === 'R_EDGE' ? '>' : '<'}
    </span>
  )

export { EdgePinMarker }
