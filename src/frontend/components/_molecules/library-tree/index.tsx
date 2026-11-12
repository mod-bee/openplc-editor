import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useState } from 'react'

import { ArrowIcon } from '../../../assets/icons/interface/Arrow'
import { LibraryCloseFolderIcon } from '../../../assets/icons/library/CloseFolder'
import { LibraryFileIcon } from '../../../assets/icons/library/File'
import { LibraryOpenFolderIcon } from '../../../assets/icons/library/OpenFolder'
import { cn } from '../../../utils/cn'

type ILibraryRootProps = ComponentPropsWithoutRef<'ul'> & {
  children: ReactNode
}
const LibraryRoot = ({ children, ...res }: ILibraryRootProps) => {
  return (
    <div>
      <ul className='select-none list-none p-0' {...res}>
        {children}
      </ul>
    </div>
  )
}

type ILibraryFolderProps = ComponentPropsWithoutRef<'li'> & {
  label: string
  children?: ReactNode
  initiallyOpen?: boolean
  shouldBeOpen?: boolean
}

const LibraryFolder = ({ label, children, initiallyOpen, shouldBeOpen }: ILibraryFolderProps) => {
  const [folderIsOpen, setFolderIsOpen] = useState(initiallyOpen || false)

  const handleFolderVisibility = useCallback(() => setFolderIsOpen(!folderIsOpen), [folderIsOpen])

  useEffect(() => {
    if (shouldBeOpen !== undefined) {
      setFolderIsOpen(shouldBeOpen)
    }
  }, [shouldBeOpen])

  const hasFilesAssociated = Array.isArray(children) && children.length > 0

  return (
    <li className='cursor-pointer aria-expanded:cursor-default'>
      <div
        className='flex w-full cursor-pointer flex-row items-center gap-1 py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
        onClick={hasFilesAssociated ? handleFolderVisibility : undefined}
      >
        {hasFilesAssociated ? (
          <div className='h-4 w-4'>
            <ArrowIcon
              direction='right'
              className={`h-4 w-4 stroke-brand-light transition-all ${folderIsOpen ? 'rotate-270 stroke-brand' : ''}`}
            />
          </div>
        ) : (
          <div className='h-5 w-5' />
        )}
        {folderIsOpen ? (
          <div className='h-5 w-5'>
            <LibraryOpenFolderIcon size='sm' />
          </div>
        ) : (
          <div className='h-5 w-5'>
            <LibraryCloseFolderIcon size='sm' />
          </div>
        )}
        <p
          className={`w-full truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ${folderIsOpen && 'font-medium text-neutral-1000 dark:text-white'}`}
        >
          {label}
        </p>
      </div>
      {children && folderIsOpen && (
        <div>
          {/*
           * Indent the child list so nested folders and files visually
           * track the hierarchy depth. Top-level folders sit flush
           * because they live under `LibraryRoot`'s own padding-free
           * `<ul>`; only this inner `<ul>` (rendered inside an open
           * folder) carries the per-level offset.
           */}
          <ul className='list-none p-0 pl-3'>{children}</ul>
        </div>
      )}
    </li>
  )
}

type ILibraryFileProps = ComponentPropsWithoutRef<'li'> & {
  label: string
  isSelected: boolean
  onSelect: () => void
  /** Set for a block with methods: whether its method rows are shown. */
  expanded?: boolean
  onToggleExpanded?: () => void
}

const LibraryFile = ({ label, isSelected, onSelect, expanded, onToggleExpanded, ...res }: ILibraryFileProps) => {
  return (
    <li
      className={`${isSelected ? 'bg-slate-50 dark:bg-neutral-900' : ''} ml-2 cursor-pointer pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900`}
      {...res}
    >
      <div className={cn('flex flex-row items-center gap-[6px] py-1', onToggleExpanded ? 'pl-1' : 'pl-6')}>
        {onToggleExpanded && (
          <button
            type='button'
            aria-label={expanded ? 'Hide methods' : 'Show methods'}
            aria-expanded={expanded}
            className='h-4 w-4'
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpanded()
            }}
          >
            <ArrowIcon
              direction='right'
              className={`h-4 w-4 stroke-brand-light transition-all ${expanded ? 'rotate-270 stroke-brand' : ''}`}
            />
          </button>
        )}
        <div className='h-5 w-5'>
          <LibraryFileIcon size='sm' />
        </div>
        <p
          className={cn(
            'ml-1 w-full truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            isSelected && 'font-medium text-neutral-1000 dark:text-white',
          )}
        >
          {label}
        </p>
      </div>
    </li>
  )
}

type ILibraryMethodProps = {
  label: string
  /** The method as a call is written, shown on hover. */
  signature: string
  /** Dragged onto a Ladder or FBD diagram, it places a method box. */
  draggable?: boolean
  onDragStart?: (event: React.DragEvent<HTMLLIElement>) => void
}

/** A method of the block above it. */
const LibraryMethod = ({ label, signature, draggable, onDragStart }: ILibraryMethodProps) => {
  return (
    <li
      className={cn(
        'ml-2 pl-2',
        draggable ? 'cursor-grab hover:bg-slate-50 dark:hover:bg-neutral-900' : 'cursor-default',
      )}
      title={signature}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <div className='flex flex-row items-center gap-[6px] py-0.5 pl-12'>
        <span className='font-caption text-[10px] font-medium text-brand'>M</span>
        <p className='ml-1 w-full truncate font-caption text-xs font-normal text-neutral-700 dark:text-neutral-400'>
          {label}
        </p>
      </div>
    </li>
  )
}

export { LibraryFile, LibraryFolder, LibraryMethod, LibraryRoot }
