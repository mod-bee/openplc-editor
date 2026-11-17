/**
 * A library archive built for another compiler's calling convention is
 * refused at install and flagged in the installed list, with the
 * compiler's own reason. The compiler is a stub here; what it decides is
 * covered by strucpp's own tests.
 */

import type { StlibArchiveDTO } from '../../../../middleware/shared/ports/library-port'
import { userArchiveToInstalledRow } from '../installed-library-rows'
import { libraryCompatibilityError } from '../library-compatibility'
import { prepareStlibUpload } from '../prepare-library-upload'
import { __setStrucppRuntimeForTests, type StrucppRuntime } from '../strucpp-runtime'

const OLD =
  'library old-lib 1.0.0 was built for an older compiler (calling convention 1; this one needs 2): ' +
  'reinstall it from a release built with STruC++ 0.7.0 or later (toolchain v0.7.0-modbee.4 or later), or rebuild it'

function archive(name: string): StlibArchiveDTO {
  return {
    manifest: {
      name,
      version: '1.0.0',
      namespace: name,
      isBuiltin: false,
      functions: [],
      functionBlocks: [],
      types: [],
    },
  }
}

function stub(overrides: Partial<StrucppRuntime> = {}): StrucppRuntime {
  return {
    compile: jest.fn(),
    formatDiagnostic: jest.fn(),
    buildSourceMap: jest.fn(),
    getVersion: jest.fn(),
    importCodesysLibraryFromBytes: jest.fn(),
    loadStlibFromString: jest.fn((text: string) => JSON.parse(text) as unknown),
    compileStlib: jest.fn(),
    // The stub's rule: a library named old-lib is from the older compiler.
    libraryAbiErrors: jest.fn((archives: Array<{ manifest: { name: string } }>) =>
      archives
        .filter((a) => a.manifest.name === 'old-lib')
        .map(() => ({ message: OLD, line: 0, column: 0, severity: 'error' })),
    ),
    ...overrides,
  } as unknown as StrucppRuntime
}

afterEach(() => __setStrucppRuntimeForTests(null))

describe('libraryCompatibilityError', () => {
  it("gives the compiler's reason for an archive built for another compiler", () => {
    __setStrucppRuntimeForTests(stub())
    expect(libraryCompatibilityError(archive('old-lib'))).toBe(OLD)
  })

  it('is null for an archive this compiler can use', () => {
    __setStrucppRuntimeForTests(stub())
    expect(libraryCompatibilityError(archive('new-lib'))).toBeNull()
  })

  it('is null when the compiler has no such check', () => {
    __setStrucppRuntimeForTests(stub({ libraryAbiErrors: undefined }))
    expect(libraryCompatibilityError(archive('old-lib'))).toBeNull()
  })
})

describe('installing a .stlib', () => {
  it('refuses one built for another compiler, with the reason', () => {
    __setStrucppRuntimeForTests(stub())
    expect(() => prepareStlibUpload(JSON.stringify(archive('old-lib')))).toThrow(OLD)
  })

  it('accepts one built for this compiler', () => {
    __setStrucppRuntimeForTests(stub())
    expect(prepareStlibUpload(JSON.stringify(archive('new-lib')))).toMatchObject({
      name: 'new-lib',
      version: '1.0.0',
      origin: 'stlib',
    })
  })
})

describe('the installed list', () => {
  const metadata = { version: '1.0.0', installedAt: '2026-11-17T00:00:00.000Z', origin: 'stlib' as const }

  it('flags an installed library this compiler cannot use, saying why', () => {
    __setStrucppRuntimeForTests(stub())
    expect(userArchiveToInstalledRow(archive('old-lib'), { name: 'old-lib', ...metadata })).toMatchObject({
      name: 'old-lib',
      incompatible: OLD,
    })
  })

  it('leaves a usable library unflagged', () => {
    __setStrucppRuntimeForTests(stub())
    expect(userArchiveToInstalledRow(archive('new-lib'), { name: 'new-lib', ...metadata })).not.toHaveProperty(
      'incompatible',
    )
  })
})
