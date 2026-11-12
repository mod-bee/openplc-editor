import { fireEvent, render, screen } from '@testing-library/react'

import type { SystemLibrary } from '../../../../../middleware/shared/ports/library-types'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { Library } from '../library'

const LIBRARY: SystemLibrary = {
  name: 'engine-lib',
  author: '',
  version: '1.0.0',
  stPath: '',
  cPath: '',
  pous: [
    {
      name: 'ENGINE',
      type: 'function-block',
      language: 'cpp',
      variables: [],
      body: '',
      documentation: '',
      methods: [
        {
          name: 'Record',
          returnType: 'BOOL',
          variables: [{ name: 'DATA', class: 'input', type: { definition: 'generic-type', value: 'ANY' } }],
        },
        { name: 'Reset', variables: [] },
      ],
    },
    { name: 'PLAIN', type: 'function-block', language: 'st', variables: [], body: '', documentation: '' },
  ],
}

const renderLibrary = () =>
  render(
    <Library
      filterText='n'
      setFilterText={() => undefined}
      setSelectedFileKey={() => undefined}
      selectedFileKey={null}
      filteredLibraries={[LIBRARY]}
      filteredUserLibraries={[]}
    />,
    { wrapper: createStoreWrapper(createTestStore()) },
  )

describe('Library explorer — methods of a block', () => {
  it('shows a block’s methods only when its arrow is opened', () => {
    renderLibrary()
    expect(screen.getByText('ENGINE')).toBeTruthy()
    expect(screen.queryByText('Record : BOOL')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show methods' }))
    expect(screen.getByText('Record : BOOL')).toBeTruthy()
    expect(screen.getByText('Reset')).toBeTruthy()
    expect(screen.getByText('Record : BOOL').closest('li')?.getAttribute('title')).toBe('Record(DATA := ANY) : BOOL')

    fireEvent.click(screen.getByRole('button', { name: 'Hide methods' }))
    expect(screen.queryByText('Record : BOOL')).toBeNull()
  })

  it('gives a block without methods no arrow', () => {
    renderLibrary()
    expect(screen.getByText('PLAIN')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /methods/ })).toHaveLength(1)
  })
})
