import { createColumnHelper } from '@tanstack/react-table'

import type { PLCTask } from '../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../store'
import { GenericTable } from '../../_atoms/generic-table'
import { EditableNameCell, EditablePriorityCell } from './editable-cell'
import {
  SelectableCoreCell,
  SelectableIntervalCell,
  SelectableStackCell,
  SelectableStopOnStuckCell,
  SelectableTriggerCell,
} from './selectable-cell'

const columnHelper = createColumnHelper<PLCTask>()
const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: (props) => EditableNameCell(props),
  }),
  columnHelper.accessor('triggering', {
    header: 'Triggering',
    enableResizing: true,
    size: 468,
    minSize: 150,
    maxSize: 468,
    cell: (props) => SelectableTriggerCell(props),
  }),
  columnHelper.accessor('interval', {
    header: 'Interval',
    size: 468,
    minSize: 150,
    maxSize: 468,
    enableResizing: true,
    cell: (props) => SelectableIntervalCell(props),
  }),
  columnHelper.accessor('priority', {
    header: 'Priority',
    enableResizing: false,
    size: 468,
    minSize: 150,
    maxSize: 468,
    cell: (props) => EditablePriorityCell(props),
  }),
  // The task's CPU core (Auto by default); a vendor extension written to the
  // build as an IEC §6.2 pragma.
  columnHelper.accessor('core', {
    header: 'Core',
    enableResizing: false,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: (props) => SelectableCoreCell(props),
  }),
  // Whether the task stuck in one scan stops the PLC (Yes, the default), and its
  // stack (Default): vendor extensions written to the build as the same pragma.
  columnHelper.accessor('stopOnStuck', {
    header: 'Stop PLC if stuck',
    enableResizing: false,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: (props) => SelectableStopOnStuckCell(props),
  }),
  columnHelper.accessor('stack', {
    header: 'Stack',
    enableResizing: false,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: (props) => SelectableStackCell(props),
  }),
]

type PLCTaskTableProps = {
  tableData: PLCTask[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const TaskTable = ({ tableData, selectedRow, handleRowClick }: PLCTaskTableProps) => {
  const {
    editor: {
      meta: { name },
    },
    projectActions: { updateTask },
  } = useOpenPLCStore()

  const { captureAndPush } = usePouSnapshot()

  return (
    <GenericTable<PLCTask>
      columns={columns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        captureAndPush(name)
        // @ts-expect-error - The data value is a literal type that need to be parsed
        const result = updateTask({ rowId: rowIndex, data: { [columnId]: value } })
        return result
      }}
      tableContext='Tasks'
    />
  )
}

export { TaskTable }
