import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { InstalledLibrary } from '@root/middleware/shared/ports/library-types'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import { ProjectLibrariesTab } from '../project-libraries-tab'

const INSTALLED: InstalledLibrary[] = [
  { name: 'demo-utils', version: '2.1.0', bundled: false, installedAt: '', origin: 'stlib' },
]

let store: OpenPLCStore

const renderTab = () => render(<ProjectLibrariesTab installed={INSTALLED} />, { wrapper: createStoreWrapper(store) })

const projectRefNames = () => (store.getState().project.data.libraries ?? []).map((ref) => ref.name)

const removeMissing = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Remove ${name} from project` }))

describe('Project Libraries tab, missing libraries callout', () => {
  beforeEach(() => {
    store = createTestStore()
    const actions = store.getState().libraryActions
    actions.setSystemLibraries([
      ...store.getState().libraries.system,
      { name: 'demo-utils', author: 'qa', version: '2.1.0', stPath: '', cPath: '', pous: [] },
    ])
    actions.setProjectLibraries([
      { name: 'demo-utils', version: '2.1.0' },
      { name: 'ghost-lib', version: '1.0.0' },
      { name: 'other-ghost', version: '2.0.0' },
    ])
  })

  afterEach(() => cleanup())

  it('lists each missing library with its version', () => {
    renderTab()

    expect(screen.getByTestId('missing-library-row-ghost-lib').textContent).toContain('ghost-lib (v1.0.0)')
    expect(screen.getByTestId('missing-library-row-other-ghost').textContent).toContain('other-ghost (v2.0.0)')
  })

  it('offers a Remove from project action on every missing entry', () => {
    renderTab()

    for (const name of ['ghost-lib', 'other-ghost']) {
      const row = screen.getByTestId(`missing-library-row-${name}`)
      const button = within(row).getByRole('button', { name: `Remove ${name} from project` })
      expect(button.getAttribute('type')).toBe('button')
      expect(button.getAttribute('title')).toBe('Remove from project')
      expect(button.getAttribute('data-testid')).toBe(`missing-library-remove-${name}`)
    }
  })

  it('removes the clicked entry from the callout and keeps the other one', () => {
    renderTab()

    removeMissing('ghost-lib')

    expect(screen.queryByTestId('missing-library-row-ghost-lib')).toBeNull()
    expect(screen.queryByTestId('missing-library-row-other-ghost')).not.toBeNull()
  })

  it('drops only the clicked reference from the project libraries', () => {
    renderTab()

    removeMissing('ghost-lib')

    expect(projectRefNames()).toEqual(['demo-utils', 'other-ghost'])
  })

  it('leaves the removed library out of the project data the build reads', () => {
    renderTab()

    removeMissing('ghost-lib')

    const buildRefs = store.getState().projectActions.getCompileReadyProjectData().libraries ?? []
    expect(buildRefs.map((ref) => ref.name)).not.toContain('ghost-lib')
  })

  it('hides the callout once the last missing entry is removed', () => {
    renderTab()

    removeMissing('ghost-lib')
    removeMissing('other-ghost')

    expect(screen.queryByTestId('missing-libraries-callout')).toBeNull()
  })

  it('tells the user the entries can be installed or removed', () => {
    renderTab()

    const callout = screen.getByTestId('missing-libraries-callout')
    expect(
      within(callout).getByText('Install them on the System Libraries tab, or remove them from this project.'),
    ).not.toBeNull()
  })

  it('bounds the missing list with a vertical scroll that holds every missing entry', () => {
    renderTab()

    const list = screen.getByTestId('missing-libraries-list')
    const classes = list.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['max-h-32', 'overflow-y-auto']))
    expect(within(list).queryByTestId('missing-library-row-ghost-lib')).not.toBeNull()
    expect(within(list).queryByTestId('missing-library-row-other-ghost')).not.toBeNull()
  })

  it('lets the card body scroll vertically so the whole callout stays reachable', () => {
    renderTab()

    const callout = screen.getByTestId('missing-libraries-callout')
    const body = callout.parentElement
    if (body === null) throw new Error('missing-libraries-callout has no parent card body')
    const bodyClasses = body.className.split(/\s+/)
    expect(bodyClasses).toEqual(expect.arrayContaining(['overflow-y-auto', 'min-h-0', 'flex-1', 'flex-col']))
    expect(bodyClasses).not.toContain('overflow-hidden')
    expect(callout.className.split(/\s+/)).toContain('shrink-0')
  })

  it('keeps the remove action of an enabled library as it was', () => {
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: 'Remove from project' }))

    expect(store.getState().enabledLibraries).toEqual([])
    expect(projectRefNames()).toEqual(['ghost-lib', 'other-ghost'])
  })
})

const renderWithStore = (ui: ReactElement) => render(ui, { wrapper: createStoreWrapper(store) })

const row = (over: Partial<InstalledLibrary> = {}): InstalledLibrary => ({
  name: 'libtest-basic',
  version: '0.2.0',
  bundled: false,
  installedAt: '2026-01-01T00:00:00.000Z',
  origin: 'stlib',
  versions: ['0.2.0', '0.1.0'],
  ...over,
})

function seed({ pinned, outdated = true }: { pinned: string; outdated?: boolean }) {
  store.setState((state) => ({
    ...state,
    project: {
      ...state.project,
      data: { ...state.project.data, libraries: [{ name: 'libtest-basic', version: pinned }] },
    },
    enabledLibraries: ['libtest-basic'],
    missingLibraries: [],
    outdatedLibraries: outdated ? [{ name: 'libtest-basic', pinned, available: ['0.2.0', '0.1.0'] }] : [],
  }))
}

describe('ProjectLibrariesTab, versions and updates', () => {
  beforeEach(() => {
    store = createTestStore()
  })
  afterEach(() => cleanup())

  it('shows the version the project pins, not the newest installed', () => {
    seed({ pinned: '0.1.0' })
    renderWithStore(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.getByRole('combobox', { name: 'Version of libtest-basic' }).textContent).toContain('v0.1.0')
  })

  it('offers a way into the update dialog when a newer version is installed', async () => {
    const user = userEvent.setup()
    seed({ pinned: '0.1.0' })
    renderWithStore(<ProjectLibrariesTab installed={[row()]} />)

    await user.click(screen.getByRole('button', { name: /newer version installed/i }))

    expect(store.getState().modals['library-updates']?.open).toBe(true)
  })

  it('says nothing about updates when the project is on the newest', () => {
    seed({ pinned: '0.2.0', outdated: false })
    renderWithStore(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.queryByRole('button', { name: /newer version installed/i })).toBeNull()
  })

  it('names a pinned version that is not installed rather than showing a wrong one', () => {
    seed({ pinned: '9.9.9', outdated: false })
    renderWithStore(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.getByRole('combobox', { name: 'Version of libtest-basic' }).textContent).toContain('not installed')
  })

  it('shows how many versions are available on a library not yet added', () => {
    seed({ pinned: '0.1.0', outdated: false })
    store.setState((state) => ({ ...state, enabledLibraries: [] }))
    renderWithStore(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.getByText(/2 versions/)).toBeTruthy()

  })
})
