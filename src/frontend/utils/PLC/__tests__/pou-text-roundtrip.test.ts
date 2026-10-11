/**
 * A load/save round trip must not reformat the file (DOPE-650).
 *
 * `variablesText` is written back verbatim now, so anything the loader drops
 * when it slices the VAR section becomes a byte diff in every POU file the
 * first time a project is saved — noise in every user's git history, and it
 * undercuts the promise that the text is preserved.
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { parseTextualPouFromString } from '../pou-text-parser'
import { serializeTextualPouToString } from '../pou-text-serializer'

const textOf = (pou: PLCPou) => pou.variablesText

describe('the stored declaration text keeps the block indentation', () => {
  it('starts at the line holding VAR, not at the keyword', () => {
    const source = 'PROGRAM main\n  VAR\n    a : INT;\n  END_VAR\n\n  a := 1;\n\nEND_PROGRAM'
    expect(textOf(parseTextualPouFromString(source, 'st', 'program'))).toBe('  VAR\n    a : INT;\n  END_VAR')
  })

  it('keeps a tab indent', () => {
    const source = 'PROGRAM main\n\tVAR\n\t\ta : INT;\n\tEND_VAR\n\n\ta := 1;\n\nEND_PROGRAM'
    expect(textOf(parseTextualPouFromString(source, 'st', 'program'))).toBe('\tVAR\n\t\ta : INT;\n\tEND_VAR')
  })

  it('keeps an unindented block unindented', () => {
    const source = 'PROGRAM main\nVAR\n  a : INT;\nEND_VAR\n\na := 1;\n\nEND_PROGRAM'
    expect(textOf(parseTextualPouFromString(source, 'st', 'program'))).toBe('VAR\n  a : INT;\nEND_VAR')
  })

  it('keeps comments and blank lines inside the block', () => {
    const source =
      'PROGRAM main\n  VAR\n    (* note *)\n\n    a : INT;  // trailing\n  END_VAR\n\n  a := 1;\n\nEND_PROGRAM'
    const text = textOf(parseTextualPouFromString(source, 'st', 'program')) ?? ''
    expect(text).toContain('(* note *)')
    expect(text).toContain('// trailing')
    expect(text).toContain('*)\n\n')
  })

  it('marks a POU whose declarations parsed as not needing repair', () => {
    const pou = parseTextualPouFromString(
      'PROGRAM main\n  VAR\n    a : INT;\n  END_VAR\n\n  ;\n\nEND_PROGRAM',
      'st',
      'program',
    )
    expect(pou.variablesTextUnparsed).toBeUndefined()
  })
})

describe('the body round-trips without gaining or losing a blank line', () => {
  const save = (pou: PLCPou) => serializeTextualPouToString(pou as never)

  it('writes a body with a trailing newline the way it loads back', () => {
    const source = 'FUNCTION_BLOCK FB\n  VAR\n    a : INT;\n  END_VAR\n\n'
    const loaded = parseTextualPouFromString(`${source}a := 1;\n\nEND_FUNCTION_BLOCK`, 'st', 'function-block')
    const withNewline = { ...loaded, body: { ...loaded.body, value: 'a := 1;\n' } } as PLCPou
    // What apply writes from a spec body ending in a newline ...
    const written = save(withNewline)
    // ... is what a save of the loaded POU writes: describe -> apply is stable.
    expect(written).toBe(save(parseTextualPouFromString(written, 'st', 'function-block')))
    expect(written.endsWith('a := 1;\n\nEND_FUNCTION_BLOCK')).toBe(true)
  })

  it('reads the body without the blank lines around it', () => {
    const source = 'PROGRAM main\n  VAR\n    a : INT;\n  END_VAR\n\n\na := 1;\n  a := 2;\n\nEND_PROGRAM'
    expect(parseTextualPouFromString(source, 'st', 'program').body.value).toBe('a := 1;\n  a := 2;')
  })
})


describe("a FUNCTION's return type keeps its declared length", () => {
  const save = (pou: PLCPou) => serializeTextualPouToString(pou as never)
  const fn = (returnType: string) =>
    `FUNCTION label : ${returnType}\n  VAR_INPUT\n    n : INT;\n  END_VAR\n\nlabel := 'x';\n\nEND_FUNCTION`

  it.each(['STRING(48)', 'WSTRING(8)', 'STRING[20]', 'INT'])('reads and writes back %s', (returnType) => {
    const source = fn(returnType)
    const loaded = parseTextualPouFromString(source, 'st', 'function')
    expect(loaded.interface?.returnType).toBe(returnType)
    expect(textOf(loaded)).toBe('  VAR_INPUT\n    n : INT;\n  END_VAR')
    expect(save(loaded)).toBe(save(parseTextualPouFromString(save(loaded), 'st', 'function')))
    expect(save(loaded).startsWith(`FUNCTION label : ${returnType}\n`)).toBe(true)
  })
})
