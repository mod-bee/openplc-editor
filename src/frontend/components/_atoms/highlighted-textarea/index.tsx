import type { ChangeEvent, ComponentPropsWithRef, UIEvent } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'

import { useOpenPLCStore } from '../../../store'
import { extractSearchQuery } from '../../../store/slices/search/utils'
import { cn } from '../../../utils/cn'

type HighlightedTextAreaProps = ComponentPropsWithRef<'textarea'> & {
  textAreaValue: string
  setTextAreaValue: (value: string) => void
  handleSubmit?: (currentValue?: string) => void
  submitWith?: {
    enter: boolean
  }
  inputHeight?: {
    scrollLimiter: number
    height: number
  }
  textAreaClassName?: string
  highlightClassName?: string
  scrollableIndicator?: boolean
  scrollableIndicatorClassName?: string
  /** The area's height each time it is sized to its text (no extra layout: it comes from the batch below). */
  onHeightChange?: (height: number) => void
}

/** One text area to size to its text: the height is the text's, or `height` once the text reaches `scrollLimiter`. */
type SizingJob = {
  input: HTMLTextAreaElement
  highlight: HTMLDivElement
  indicator: HTMLDivElement | null
  scrollLimiter?: number
  height?: number
  report: (height: number) => void
}

const sizingQueue = new Set<SizingJob>()

/**
 * Sizes every queued text area at once: all heights reset, then all read, then all set. Reading a height right
 * after changing one forces the browser to lay the page out again, so done one area at a time a diagram of a
 * thousand elements laid the page out a thousand times. Runs before the frame is painted.
 */
function flushSizing(): void {
  const jobs = [...sizingQueue]
  sizingQueue.clear()
  for (const job of jobs) {
    job.input.style.height = 'auto'
    job.highlight.style.height = 'auto'
  }
  const textHeights = jobs.map((job) => job.input.scrollHeight)
  jobs.forEach((job, index) => {
    const textHeight = textHeights[index]
    const limited = job.scrollLimiter !== undefined && job.height !== undefined
    const height = limited && textHeight >= job.scrollLimiter! ? job.height! : textHeight
    job.input.style.height = `${height}px`
    job.highlight.style.height = `${height}px`
    // What the area's scrollHeight is now: its text, or the set height when that is taller.
    const shown = Math.max(textHeight, height)
    // The area scrolls when its text is taller than the limit.
    if (job.indicator && job.scrollLimiter !== undefined) {
      job.indicator.style.display = shown > job.scrollLimiter ? 'block' : 'none'
    }
    job.report(shown)
  })
}

function scheduleSizing(job: SizingJob): void {
  if (sizingQueue.size === 0) queueMicrotask(flushSizing)
  sizingQueue.add(job)
}

const HighlightedTextArea = forwardRef<HTMLTextAreaElement, HighlightedTextAreaProps>(
  (
    {
      textAreaClassName,
      highlightClassName,
      scrollableIndicator = true,
      scrollableIndicatorClassName,
      placeholder,
      textAreaValue,
      setTextAreaValue,
      handleSubmit,
      submitWith = {
        enter: true,
      },
      inputHeight,
      onHeightChange,
      ...props
    }: HighlightedTextAreaProps,
    ref,
  ) => {
    // Only the search query: a diagram holds one of these per element, and a subscription to the whole store
    // would redraw every one of them on any change anywhere.
    const searchQuery = useOpenPLCStore((state) => state.searchQuery)

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
    const highlightDivRef = useRef<HTMLDivElement>(null)

    const [inputFocus, setInputFocus] = useState<boolean>(false)
    const [canSubmit, setCanSubmit] = useState<boolean>(true)
    // The latest callback, for the batch (callers pass a new function each render).
    const onHeightChangeRef = useRef(onHeightChange)
    onHeightChangeRef.current = onHeightChange
    const formattedVariableValue = searchQuery ? extractSearchQuery(textAreaValue, searchQuery) : textAreaValue

    // @ts-expect-error - not all properties are used
    useImperativeHandle(ref, () => {
      return {
        focus: () => {
          inputRef.current?.focus()
          setInputFocus(true)
        },
        isFocused: inputFocus,
        blur: ({ submit }: { submit?: boolean }) => {
          if (submit !== undefined) {
            setCanSubmit(submit)
          }
          setInputFocus(false)
        },
      }
    }, [inputRef, inputFocus])

    useEffect(() => {
      if (!inputFocus) inputRef.current?.blur()
    }, [inputFocus])

    // The limits as numbers, not the object: callers pass a new object each render.
    const scrollLimiter = inputHeight?.scrollLimiter
    const limitedHeight = inputHeight?.height

    useLayoutEffect(() => {
      if (inputRef.current && highlightDivRef.current) {
        scheduleSizing({
          input: inputRef.current,
          highlight: highlightDivRef.current,
          indicator: scrollableIndicatorRef.current,
          scrollLimiter,
          height: limitedHeight,
          report: (height) => onHeightChangeRef.current?.(height),
        })
      }
    }, [textAreaValue, scrollLimiter, limitedHeight])

    const onChangeHandler = (e: ChangeEvent<HTMLTextAreaElement>) => {
      setTextAreaValue(e.target.value)
      if (props.onChange) props.onChange(e)
    }

    const onScrollHandler = (e: UIEvent<HTMLTextAreaElement>) => {
      // The highlight follows the text straight away (as React state this was a render, and a forced layout on
      // every area as it was first drawn).
      if (highlightDivRef.current) highlightDivRef.current.scrollTop = e.currentTarget.scrollTop
    }

    return (
      <div
        className='[&::-webkit-text-size-adjust]:none relative h-full w-full'
        aria-label={props['aria-label'] ?? 'HighlightedTextArea'}
      >
        <div
          className={cn(
            'pointer-events-none absolute -z-10 w-full overflow-y-scroll',
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            scrollableIndicator ? '[&::-webkit-scrollbar]:hidden' : '',
            highlightClassName,
          )}
          ref={highlightDivRef}
        >
          <div
            className={cn('w-full whitespace-pre-wrap break-words text-transparent')}
            dangerouslySetInnerHTML={{ __html: formattedVariableValue }}
          />
        </div>
        <textarea
          value={textAreaValue}
          onChange={onChangeHandler}
          placeholder={placeholder ?? '???'}
          className={cn(
            'absolute w-full resize-none bg-transparent outline-none',
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            scrollableIndicator ? '[&::-webkit-scrollbar]:hidden' : '',
            textAreaClassName,
          )}
          onFocus={(e) => {
            setInputFocus(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            if (inputRef.current && highlightDivRef.current) {
              inputRef.current.scrollTop = 0
              highlightDivRef.current.scrollTop = 0
            }
            props.onBlur?.(e)
            if (canSubmit && handleSubmit) handleSubmit(e.target.value)
            setCanSubmit(true)
          }}
          onScroll={(e) => onScrollHandler(e)}
          onKeyDown={(e) => {
            if (props.onKeyDown) {
              props.onKeyDown(e)
            }
            if (submitWith.enter && e.key === 'Enter') {
              setInputFocus(false)
            }
          }}
          onKeyUp={props.onKeyUp}
          ref={inputRef}
          rows={1}
          spellCheck={false}
        />
        {scrollableIndicator && (
          <div
            className={cn(
              'pointer-events-none absolute top-1/2 hidden -translate-y-1/2 text-cp-sm',
              scrollableIndicatorClassName ? scrollableIndicatorClassName : '-right-2',
            )}
            ref={scrollableIndicatorRef}
          >
            ↕
          </div>
        )}
      </div>
    )
  },
)

export { HighlightedTextArea }
