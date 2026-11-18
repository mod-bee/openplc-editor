/**
 * ForceValueDialog: what is forced and its type, the value now, an enumeration's names to pick from, and
 * a value that cannot be forced kept in the dialog with the reason.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ForceValueDialog } from '..'

const renderDialog = (props: Partial<Parameters<typeof ForceValueDialog>[0]> = {}) => {
  const onForce = jest.fn()
  const onOpenChange = jest.fn()
  render(
    <ForceValueDialog
      open
      onOpenChange={onOpenChange}
      name='well.Data.set.tanks'
      type='INT'
      currentValue='73'
      onForce={onForce}
      {...props}
    />,
  )
  return { onForce, onOpenChange }
}

describe('ForceValueDialog', () => {
  it('names the variable, its type and its value now, and forces the encoded value', async () => {
    const { onForce, onOpenChange } = renderDialog()
    expect(screen.getByText('well.Data.set.tanks')).toBeTruthy()
    expect(screen.getByText('Now: 73')).toBeTruthy()
    expect(screen.getByText('A whole number.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('Force'))
    await waitFor(() => expect(onForce).toHaveBeenCalledWith(new Uint8Array([5, 0]), '5'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open with the reason when the value cannot be forced', () => {
    const { onForce, onOpenChange } = renderDialog()
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('Force'))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(onForce).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('says that up to 126 characters can be forced into a string of any declared length (E5)', () => {
    const { onForce } = renderDialog({ name: 'log.line', type: 'STRING(320)', currentValue: '"ok"' })
    expect(
      screen.getByText(/Up to 126 characters can be forced or written into a string of any declared length/),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'x'.repeat(127) } })
    fireEvent.click(screen.getByText('Force'))
    expect(screen.getByRole('alert').textContent).toMatch(/max 126/)
    expect(onForce).not.toHaveBeenCalled()
  })

  it("picks an enumeration's member by name, starting at the value now", async () => {
    const { onForce } = renderDialog({ type: 'INT', enumValues: ['Off', 'Hand', 'Auto'], currentValue: 'Hand' })
    const select = screen.getByLabelText('Value') as HTMLSelectElement
    expect(select.value).toBe('Hand')
    fireEvent.change(select, { target: { value: 'Auto' } })
    fireEvent.click(screen.getByText('Force'))
    await waitFor(() => expect(onForce).toHaveBeenCalledWith(new Uint8Array([2, 0]), 'Auto'))
  })
})
