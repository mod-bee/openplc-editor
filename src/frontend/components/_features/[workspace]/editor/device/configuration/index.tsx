import * as Tabs from '@radix-ui/react-tabs'
import { useState } from 'react'

import { cn } from '../../../../../../utils/cn'
import { DeviceEditorTemplate } from '../../../../../_templates/[editors]/device-editor-template'
import { Board } from './board'
import { General } from './general'

type ConfigurationTab = 'board' | 'general'

const TabItem = ({ value, label, isActive }: { value: ConfigurationTab; label: string; isActive: boolean }) => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'px-4 py-2 font-caption !text-xs font-medium transition-colors',
      'border-b-2 border-transparent',
      'hover:text-brand-medium dark:hover:text-brand-light',
      isActive
        ? 'border-brand-medium text-brand-medium dark:border-brand-light dark:text-brand-light'
        : 'text-neutral-500 dark:text-neutral-400',
    )}
  >
    {label}
  </Tabs.Trigger>
)

/**
 * Device Configuration screen: the Board (target, connection, pins, board options) and General (what a
 * build keeps, how the debugger shows values).
 *
 * Used to ship a built-in Communication section (Modbus RTU / Modbus
 * TCP) next to the Board slot — it was only meaningful for Arduino-
 * family targets and has been removed along with its schema, store
 * slice, and compiler emission. Arduino targets come back as VPP
 * packages, and each package persists its own settings under
 * `configuration.vendorScreenData[screenId]`.
 */
const DeviceConfigurationEditor = () => {
  const [activeTab, setActiveTab] = useState<ConfigurationTab>('board')
  return (
    <DeviceEditorTemplate id='device-configuration-editor'>
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ConfigurationTab)}
        className='flex min-h-0 w-full flex-1 flex-col'
      >
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='board' label='Board' isActive={activeTab === 'board'} />
          <TabItem value='general' label='General' isActive={activeTab === 'general'} />
        </Tabs.List>
        <Tabs.Content value='board' className='flex min-h-0 flex-1 data-[state=inactive]:hidden'>
          <Board />
        </Tabs.Content>
        <Tabs.Content value='general' className='flex min-h-0 flex-1 overflow-auto data-[state=inactive]:hidden'>
          <General />
        </Tabs.Content>
      </Tabs.Root>
    </DeviceEditorTemplate>
  )
}

export { DeviceConfigurationEditor }
