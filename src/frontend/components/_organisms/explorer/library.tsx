import { ReactNode, useEffect, useRef, useState } from 'react'

import type { SystemLibrary, SystemLibraryMethod, UserLibrary } from '../../../../middleware/shared/ports/library-types'
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { BookIcon } from '../../../assets/icons/interface/Book'
import { CloseIcon } from '../../../assets/icons/interface/Close'
import { MagnifierIcon } from '../../../assets/icons/interface/Magnifier'
import { useOpenPLCStore } from '../../../store'
import { CreateLibraryManagerEditor } from '../../../store/slices/tabs/utils'
import { buildLibraryTree, type LibraryTreeNode, methodLabel, methodSignature } from '../../../utils/library-tree'
import { isCallableMethod, pouMethods } from '../../../utils/PLC/pou-methods'
import { InputWithRef } from '../../_atoms/input'
import { LibraryFile, LibraryFolder, LibraryMethod, LibraryRoot } from '../../_molecules/library-tree'

type ILibraryFileProps = {
  label: string
}

type ILibraryFolderProps = {
  label: string
  children?: ReactNode
}

type ILibraryRootProps = {
  children: ReactNode
}

type LibraryProps = {
  filteredLibraries: SystemLibrary[]
  filteredUserLibraries: UserLibrary[]
  setSelectedFileKey: (key: string) => void
  selectedFileKey: string | null
  filterText: string
  setFilterText: (text: string) => void
}

const Library = ({
  filterText,
  setFilterText,
  setSelectedFileKey,
  selectedFileKey,
  filteredLibraries,
  filteredUserLibraries,
}: LibraryProps) => {
  const {
    editor: { type, meta },
  } = useOpenPLCStore()
  const updateTabs = useOpenPLCStore((s) => s.tabsActions.updateTabs)
  const setSelectedTab = useOpenPLCStore((s) => s.tabsActions.setSelectedTab)
  const addModel = useOpenPLCStore((s) => s.editorActions.addModel)
  const setEditor = useOpenPLCStore((s) => s.editorActions.setEditor)
  const getEditorFromEditors = useOpenPLCStore((s) => s.editorActions.getEditorFromEditors)
  const projectPous = useOpenPLCStore((s) => s.project.data.pous)

  /**
   * Open the Library Manager tab.  Same idiom the explorer's Project
   * tree uses for opening data-types / POUs / etc.: updateTabs +
   * addModel + setEditor + setSelectedTab.  Idempotent — re-opening
   * an already-open Library Manager tab just re-selects it.
   */
  const handleOpenManager = () => {
    const tabName = 'Library Manager'
    updateTabs({ name: tabName, elementType: { type: 'library-manager' } })
    let model = getEditorFromEditors(tabName)
    if (!model) {
      model = CreateLibraryManagerEditor(tabName)
      addModel(model)
    }
    setEditor(model)
    setSelectedTab(tabName)
  }

  const [isSearchActive, setIsSearchActive] = useState(false)
  const [shouldRenderInput, setShouldRenderInput] = useState(false)

  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isSearchActive) {
      setShouldRenderInput(true)
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      const timer = setTimeout(() => {
        setShouldRenderInput(false)
      }, 500)

      return () => clearTimeout(timer)
    }
  }, [isSearchActive])

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value.toLowerCase())
  }

  return (
    <div id='library-container' className='flex h-full w-full flex-col pr-2'>
      {/* Actions handler */}
      <div id='library-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 pl-2'>
        <div
          id='library-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'
        >
          <BookIcon size='sm' />
          <span
            id='project-name'
            className={`transition-[width,opacity, ml] overflow-hidden pl-1 font-caption text-xs font-medium text-neutral-1000 duration-500 ease-in-out dark:text-neutral-50 ${
              isSearchActive ? 'ml-0 w-0 opacity-0' : 'ml-1 w-[60px] opacity-100'
            }`}
          >
            Library
          </span>
        </div>

        <div
          id='search-container'
          className={`relative flex h-8 items-center justify-start overflow-hidden rounded-lg transition-all duration-500 ease-in-out ${
            isSearchActive ? 'w-full' : 'w-10'
          }`}
        >
          {shouldRenderInput && (
            <div
              className={`absolute left-0 flex w-full items-center justify-between bg-neutral-100 transition-opacity duration-500 ease-in-out dark:bg-brand-dark ${
                isSearchActive ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <InputWithRef
                id='Search-File'
                type='text'
                placeholder='Search'
                className='h-8 w-full bg-neutral-100 px-2 font-caption text-xs font-medium focus:outline-none dark:bg-brand-dark'
                value={filterText}
                onChange={handleFilterChange}
                ref={inputRef}
              />
            </div>
          )}
          <div className='absolute right-0 flex h-8 w-10 flex-shrink-0 items-center justify-center bg-brand'>
            {isSearchActive ? (
              <CloseIcon
                className='w-4 cursor-pointer stroke-white'
                onClick={() => {
                  setFilterText('')
                  setIsSearchActive(false)
                }}
              />
            ) : (
              <MagnifierIcon
                className='w-6 cursor-pointer'
                onClick={() => {
                  setIsSearchActive(!isSearchActive)
                  setFilterText('')
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Data display */}
      <div id='library-tree-container' className='flex h-full w-full flex-col overflow-auto pr-1'>
        <LibraryRoot>
          {filteredLibraries.map((library) => {
            // Build a category-driven tree per library so nested folder
            // paths from the source .stlib (e.g. OSCAT's
            // POUs/Mathematical/Complex) render as actual folders rather
            // than collapsing into a flat name list. The filter applies
            // per-POU, so folders containing no surviving POUs prune
            // automatically (see buildLibraryTree).
            const tree = buildLibraryTree(library, (pou) => pou.name.toLowerCase().includes(filterText))
            return (
              <LibraryFolder
                key={library.name}
                label={tree.label}
                initiallyOpen={false}
                shouldBeOpen={filterText.length > 0}
              >
                {tree.children.map((child, idx) =>
                  renderSystemTreeNode(child, library.name, {
                    type,
                    // The union for `meta` allows narrow start-screen
                    // variants without a language field; coerce to
                    // string here so the renderer's drag-payload
                    // language checks (`'ld'` / `'fbd'`) read uniformly.
                    language: 'language' in meta ? (meta.language as string) : '',
                    selectedFileKey,
                    setSelectedFileKey,
                    filterText,
                    keySuffix: `${library.name}-${idx}`,
                  }),
                )}
              </LibraryFolder>
            )
          })}
        </LibraryRoot>
        {filteredUserLibraries.length > 0 && (
          <LibraryRoot>
            <LibraryFolder label='User-defined POUs' initiallyOpen={true}>
              {filteredUserLibraries
                .filter((userLibrary) => userLibrary.name.toLowerCase().includes(filterText))
                .map((userLibrary) => (
                  <UserLibraryBlock
                    key={userLibrary.name}
                    name={userLibrary.name}
                    methods={callableMethods(projectPous, userLibrary.name)}
                    ctx={{ type, language: 'language' in meta ? (meta.language as string) : '' }}
                  >
                    {(expand) => (
                      <LibraryFile
                        {...expand}
                        label={userLibrary.name}
                        onClick={() => setSelectedFileKey(userLibrary.name)}
                        onSelect={() => setSelectedFileKey(userLibrary.name)}
                        isSelected={selectedFileKey === userLibrary.name}
                        draggable
                        onDragStart={(e) => {
                          if (type === 'plc-textual')
                            e.dataTransfer.setData('application/library', `user/${userLibrary.name}`)
                          else if (type === 'plc-graphical') {
                            if (meta.language === 'ld') {
                              e.dataTransfer.setData('application/reactflow/ladder-blocks', 'block')
                              e.dataTransfer.setData('text/plain', 'block') // WebKit fallback
                            }
                            if (meta.language === 'fbd') {
                              e.dataTransfer.setData('application/reactflow/fbd-blocks', 'block')
                              e.dataTransfer.setData('text/plain', 'block') // WebKit fallback
                            }
                            e.dataTransfer.setData('application/library', `user/${userLibrary.name}`)
                          }
                        }}
                      />
                    )}
                  </UserLibraryBlock>
                ))}
            </LibraryFolder>
          </LibraryRoot>
        )}

        {/* Trailing "Manage libraries…" affordance — mirrors the
            "+ Install additional boards…" pattern in the device-config
            dropdown.  Drops the user into the Library Manager tab to
            install / enable libraries without leaving the explorer.
            Visual treatment matches that affordance: a literal "+"
            glyph in brand colour rather than a stand-alone icon. */}
        <button
          type='button'
          onClick={handleOpenManager}
          className='mx-2 mt-2 flex items-center gap-1 rounded-md px-2 py-1.5 text-left font-caption text-xs font-medium text-brand hover:bg-neutral-100 dark:hover:bg-neutral-850'
        >
          + Manage libraries…
        </button>
      </div>
    </div>
  )
}

/**
 * Recursively render a system-library tree node (folder or POU leaf).
 *
 * Folders re-emit `LibraryFolder` and recurse; POU leaves render a
 * draggable `LibraryFile` whose drag payload preserves the original
 * `application/library` envelope so consumers (Monaco's textual drop,
 * FBD/Ladder graphical drop) keep their existing parsing path. The
 * drag payload uses the kebab-case library identifier (`library.name`)
 * — never the human-readable `displayName` — because FB instantiation
 * downstream looks pous up by name in `libraries.system`.
 */
function renderSystemTreeNode(
  node: LibraryTreeNode,
  libraryName: string,
  ctx: {
    type: string
    language: string
    selectedFileKey: string | null
    setSelectedFileKey: (key: string) => void
    filterText: string
    keySuffix: string
  },
): ReactNode {
  if (node.kind === 'folder') {
    return (
      <LibraryFolder
        key={`${ctx.keySuffix}-${node.label}`}
        label={node.label}
        initiallyOpen={false}
        shouldBeOpen={ctx.filterText.length > 0}
      >
        {node.children.map((child, idx) =>
          renderSystemTreeNode(child, libraryName, {
            ...ctx,
            keySuffix: `${ctx.keySuffix}-${idx}`,
          }),
        )}
      </LibraryFolder>
    )
  }
  return (
    <SystemLibraryBlock key={`${ctx.keySuffix}-${node.pou.name}`} pou={node.pou} libraryName={libraryName} ctx={ctx} />
  )
}

/**
 * A block of an installed library: draggable, and, when it has methods, an
 * arrow that shows one row per method below it.
 */
function SystemLibraryBlock({
  pou,
  libraryName,
  ctx,
}: {
  pou: Extract<LibraryTreeNode, { kind: 'pou' }>['pou']
  libraryName: string
  ctx: {
    type: string
    language: string
    selectedFileKey: string | null
    setSelectedFileKey: (key: string) => void
  }
}) {
  const [showMethods, setShowMethods] = useState(false)
  const methods = pou.methods ?? []
  const block = (
    <LibraryFile
      label={pou.name}
      {...(methods.length > 0 ? { expanded: showMethods, onToggleExpanded: () => setShowMethods(!showMethods) } : {})}
      onClick={() => ctx.setSelectedFileKey(pou.name)}
      onSelect={() => ctx.setSelectedFileKey(pou.name)}
      isSelected={ctx.selectedFileKey === pou.name}
      draggable
      onDragStart={(e) => {
        if (ctx.type === 'plc-textual') {
          e.dataTransfer.setData('application/library', `system/${libraryName}/${pou.name}`)
        } else if (ctx.type === 'plc-graphical') {
          if (ctx.language === 'ld') {
            e.dataTransfer.setData('application/reactflow/ladder-blocks', 'block')
            e.dataTransfer.setData('text/plain', 'block') // WebKit fallback
          }
          if (ctx.language === 'fbd') {
            e.dataTransfer.setData('application/reactflow/fbd-blocks', 'block')
            e.dataTransfer.setData('text/plain', 'block') // WebKit fallback
          }
          e.dataTransfer.setData('application/library', `system/${libraryName}/${pou.name}`)
        }
      }}
    />
  )
  if (methods.length === 0 || !showMethods) return block
  return (
    <>
      {block}
      {methods.map((method) => (
        <LibraryMethod
          key={method.name}
          label={methodLabel(method)}
          signature={methodSignature(method)}
          {...methodDrag(ctx, `system/${libraryName}/${pou.name}.${method.name}`)}
        />
      ))}
    </>
  )
}

/**
 * A method dragged onto a Ladder or FBD diagram places a method box (CODESYS's
 * `instance.Method` box); its instance is named on the box. Text editors take
 * a call written out instead, so there the row is not dragged.
 */
function methodDrag(ctx: { type: string; language: string }, blockRef: string) {
  if (ctx.type !== 'plc-graphical') return {}
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent<HTMLLIElement>) => {
      const kind = ctx.language === 'fbd' ? 'application/reactflow/fbd-blocks' : 'application/reactflow/ladder-blocks'
      e.dataTransfer.setData(kind, 'block')
      e.dataTransfer.setData('text/plain', 'block') // WebKit fallback
      e.dataTransfer.setData('application/library', blockRef)
    },
  }
}

/** A function block of this project, with its callable methods below it. */
function UserLibraryBlock({
  name,
  methods,
  ctx,
  children,
}: {
  name: string
  methods: SystemLibraryMethod[]
  ctx: { type: string; language: string }
  children: (expand: { expanded?: boolean; onToggleExpanded?: () => void }) => ReactNode
}) {
  const [showMethods, setShowMethods] = useState(false)
  const toggle =
    methods.length > 0 ? { expanded: showMethods, onToggleExpanded: () => setShowMethods(!showMethods) } : {}
  return (
    <>
      {children(toggle)}
      {showMethods &&
        methods.map((method) => (
          <LibraryMethod
            key={method.name}
            label={methodLabel(method)}
            signature={methodSignature(method)}
            {...methodDrag(ctx, `user/${name}.${method.name}`)}
          />
        ))}
    </>
  )
}

/** A project block's methods a caller may call, in the library tree's shape. */
function callableMethods(pous: readonly PLCPou[], name: string): SystemLibraryMethod[] {
  return (pouMethods(pous, name) ?? []).filter(isCallableMethod).map((method) => ({
    name: method.name,
    ...(method.returnType !== undefined ? { returnType: method.returnType } : {}),
    variables: method.variables.map((variable) => ({
      name: variable.name,
      class: variable.class as SystemLibraryMethod['variables'][number]['class'],
      type: variable.type as SystemLibraryMethod['variables'][number]['type'],
    })),
  }))
}

export { Library }
export type { ILibraryFileProps, ILibraryFolderProps, ILibraryRootProps }
