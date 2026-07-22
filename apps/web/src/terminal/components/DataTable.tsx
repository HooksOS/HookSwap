import { ReactNode, useMemo, useState } from 'react'
import { ComingSoon } from '~/terminal/components/ComingSoon'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export type DataTableAlign = 'left' | 'right' | 'center'
export type DataTableSortDirection = 'asc' | 'desc'

export interface DataTableColumn<Row> {
  /** Stable column id (used for sort state). */
  id: string
  /** Header text — rendered uppercase, mono 11px `#98A0AC` per the B3 markets table. */
  header: string
  /** CSS grid track, e.g. `'minmax(160px,1.7fr)'`, `'1fr'`, `'96px'` (B3 uses these verbatim). */
  width: string
  /** Default `'left'`. Numeric columns in the design are right-aligned; sparklines centered. */
  align?: DataTableAlign
  /**
   * Numeric/mono column: plain string/number cell content is wrapped in
   * IBM Plex Mono 12.5px (hard rule for all numerics).
   */
  mono?: boolean
  /** Cell renderer. Return plain text for mono columns or any node for custom cells. */
  cell: (row: Row) => ReactNode
  /** Colour for mono/plain text cells (default `#59626F`); e.g. green/red for signed changes. */
  cellColor?: (row: Row) => string
  /** Providing this makes the column sortable (click header to toggle asc/desc). */
  sortValue?: (row: Row) => number | string
  /**
   * Mobile card-mode role. When ANY column sets this, the table renders as a
   * native-app **card list** on mobile (≤900px) instead of a horizontal-scroll
   * grid: `'title'` = the card's left identity block (pair/token + sublabel),
   * `'primary'` = a labelled stat shown on the right (2–3 max), `'secondary'` =
   * a muted stat under the title, `'hide'` (or unset) = omitted on mobile.
   * Columns with no role in a card-mode table are hidden on mobile.
   */
  mobileRole?: 'title' | 'primary' | 'secondary' | 'hide'
}

export interface DataTableSort {
  columnId: string
  direction: DataTableSortDirection
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>
  /** Row data. `undefined` while loading. */
  rows?: ReadonlyArray<Row>
  rowKey: (row: Row) => string
  /** Force skeleton rows (also shown while `rows` is undefined and there is no error). */
  loading?: boolean
  /** Error message — renders the error state (with optional retry). */
  error?: string
  onRetry?: () => void
  /**
   * Renders a clean "No data yet" state (in place of rows/error/empty) for data
   * that has none yet (empty until on-chain activity/liquidity accrues). Takes
   * precedence over `error`/`loading`. Optionally override the muted subtext.
   */
  comingSoon?: boolean
  comingSoonSubtext?: string
  /** Shown when `rows` is an empty array. Default "No data". */
  emptyMessage?: string
  /** Number of skeleton rows while loading. Default 8 (prototype placeholder count). */
  skeletonRows?: number
  initialSort?: DataTableSort
  onRowClick?: (row: Row) => void
  /**
   * Explicit min-width (px) for the table's inner scroll body. When omitted it is
   * derived from the sum of each column's minimum track width, so the table keeps
   * its columns legible and scrolls horizontally inside its own container on narrow
   * viewports instead of compressing/overflowing the page. Pass a value to override.
   */
  minWidth?: number
}

/**
 * Minimum track width (px) implied by a CSS grid column string. `minmax(150px,…)`
 * and fixed `'96px'` yield their leading px value; flex-only (`'1fr'`) columns fall
 * back to a sensible legible minimum.
 */
function columnMinWidth(width: string): number {
  const match = width.match(/(\d+(?:\.\d+)?)px/)
  return match ? parseFloat(match[1]) : 80
}

/**
 * Generic Terminal data table — pixel-perfect to the B3 markets table: CSS-grid
 * rows, uppercase mono 11px `#98A0AC` column headers over a `1px #EFF1F4` rule,
 * `1px #F4F6F8` hairline row dividers, 12px vertical / 6px horizontal cell
 * padding, IBM Plex Mono 12.5px numeric cells. Sortable columns (opt-in via
 * `sortValue`), loading skeleton rows, empty and error states.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  comingSoon = false,
  comingSoonSubtext,
  emptyMessage = 'No data',
  skeletonRows = 8,
  initialSort,
  onRowClick,
  minWidth,
}: DataTableProps<Row>): JSX.Element {
  const [sort, setSort] = useState<DataTableSort | undefined>(initialSort)
  const [hoveredKey, setHoveredKey] = useState<string | undefined>(undefined)

  const gridTemplateColumns = columns.map((column) => column.width).join(' ')
  // Sum of column minimums (+ the 6px cell padding on each side) so the table
  // never compresses below legibility; instead it scrolls inside .tm-table-scroll.
  const tableMinWidth = minWidth ?? columns.reduce((sum, column) => sum + columnMinWidth(column.width), 12)
  const isLoading = loading || (rows === undefined && !error)

  // Mobile card mode: opt-in when any column declares a `mobileRole`. The wide
  // grid (`.tm-dt-wide`) is hidden ≤900px and this card list shown instead — see
  // terminal.css. Tables that set no roles are untouched (still scroll on mobile).
  const hasCardMode = useMemo(() => columns.some((c) => c.mobileRole), [columns])
  const titleColumn = useMemo(
    () => columns.find((c) => c.mobileRole === 'title') ?? columns[0],
    [columns],
  )
  const primaryColumns = useMemo(() => columns.filter((c) => c.mobileRole === 'primary'), [columns])
  const secondaryColumns = useMemo(() => columns.filter((c) => c.mobileRole === 'secondary'), [columns])

  const sortedRows = useMemo(() => {
    if (!rows || !sort) {
      return rows
    }
    const column = columns.find((c) => c.id === sort.columnId)
    const sortValue = column?.sortValue
    if (!sortValue) {
      return rows
    }
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = sortValue(a)
      const vb = sortValue(b)
      if (va < vb) {
        return -1 * factor
      }
      if (va > vb) {
        return 1 * factor
      }
      return 0
    })
  }, [rows, sort, columns])

  const toggleSort = (column: DataTableColumn<Row>): void => {
    if (!column.sortValue) {
      return
    }
    setSort((current) =>
      current?.columnId === column.id
        ? { columnId: column.id, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { columnId: column.id, direction: 'desc' },
    )
  }

  return (
    <>
    <div className={hasCardMode ? 'tm-table-scroll tm-dt-wide' : 'tm-table-scroll'}>
      <div role="table" style={{ fontFamily: terminalFonts.sans, minWidth: tableMinWidth }}>
      {/* Header row */}
      <div
        role="row"
        style={{
          display: 'grid',
          gridTemplateColumns,
          gap: 0,
          padding: '0 6px 10px',
          borderBottom: `1px solid ${terminalColors.line}`,
          fontSize: 10.5,
          letterSpacing: '0.11em',
          textTransform: 'uppercase',
          color: terminalColors.ink3,
          fontWeight: 600,
          fontFamily: terminalFonts.mono,
        }}
      >
        {columns.map((column) => {
          const sortable = Boolean(column.sortValue)
          const active = sort?.columnId === column.id
          return (
            <span
              key={column.id}
              role="columnheader"
              aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
              tabIndex={sortable ? 0 : undefined}
              onClick={sortable ? (): void => toggleSort(column) : undefined}
              onKeyDown={
                sortable
                  ? (e): void => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSort(column)
                      }
                    }
                  : undefined
              }
              style={{
                textAlign: column.align ?? 'left',
                textTransform: 'uppercase',
                cursor: sortable ? 'pointer' : undefined,
                userSelect: 'none',
                color: active ? terminalColors.ink2 : terminalColors.ink3Alt,
                whiteSpace: 'nowrap',
              }}
            >
              {column.header}
              {active ? (sort?.direction === 'asc' ? ' ↑' : ' ↓') : ''}
            </span>
          )
        })}
      </div>

      {/* Empty-data state (no rows yet — awaiting on-chain activity) — takes precedence. */}
      {comingSoon ? (
        <ComingSoon variant="panel" subtext={comingSoonSubtext} minHeight={180} />
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: '28px 6px',
            textAlign: 'center',
            fontSize: 13,
            color: terminalColors.redDown,
          }}
        >
          <div>{error}</div>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                marginTop: 12,
                fontFamily: terminalFonts.sans,
                fontSize: 12.5,
                fontWeight: 600,
                color: terminalColors.ink2,
                background: terminalColors.bg,
                border: `1px solid ${terminalColors.line}`,
                padding: '8px 14px',
                borderRadius: 9,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : isLoading ? (
        /* Loading skeleton rows */
        <div aria-busy="true">
          {Array.from({ length: skeletonRows }, (_, rowIndex) => (
            <div
              key={rowIndex}
              role="row"
              style={{
                display: 'grid',
                gridTemplateColumns,
                gap: 0,
                padding: '12px 6px',
                borderBottom: `1px solid ${terminalColors.line3}`,
                alignItems: 'center',
              }}
            >
              {columns.map((column) => (
                <span
                  key={column.id}
                  style={{
                    display: 'flex',
                    justifyContent:
                      column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start',
                  }}
                >
                  <span
                    style={{
                      height: 12,
                      width: '60%',
                      maxWidth: 96,
                      borderRadius: 4,
                      background: terminalColors.line2,
                    }}
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : sortedRows && sortedRows.length > 0 ? (
        /* Data rows */
        sortedRows.map((row) => {
          const key = rowKey(row)
          return (
            <div
              key={key}
              role="row"
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? (): void => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e): void => {
                      if (e.key === 'Enter') {
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
              onMouseEnter={onRowClick ? (): void => setHoveredKey(key) : undefined}
              onMouseLeave={onRowClick ? (): void => setHoveredKey(undefined) : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns,
                gap: 0,
                padding: '12px 6px',
                borderBottom: `1px solid ${terminalColors.line3}`,
                alignItems: 'center',
                cursor: onRowClick ? 'pointer' : undefined,
                background: hoveredKey === key ? terminalColors.panel : undefined,
              }}
            >
              {columns.map((column) => (
                <span
                  key={column.id}
                  role="cell"
                  style={{
                    textAlign: column.align ?? 'left',
                    minWidth: 0,
                    ...(column.mono
                      ? {
                          fontFamily: terminalFonts.mono,
                          fontSize: 13,
                          fontVariantNumeric: 'tabular-nums',
                          color: column.cellColor?.(row) ?? terminalColors.ink2,
                        }
                      : column.cellColor
                        ? { color: column.cellColor(row) }
                        : null),
                  }}
                >
                  {column.cell(row)}
                </span>
              ))}
            </div>
          )
        })
      ) : (
        /* Empty state */
        <div
          style={{
            padding: '28px 6px',
            textAlign: 'center',
            fontSize: 13,
            color: terminalColors.ink3Alt,
          }}
        >
          {emptyMessage}
        </div>
      )}
      </div>
    </div>

    {/* Mobile card list (shown ≤900px; the wide grid above is hidden then). */}
    {hasCardMode ? (
      <div className="tm-dt-cards">
        {comingSoon ? (
          <ComingSoon variant="panel" subtext={comingSoonSubtext} minHeight={160} />
        ) : error ? (
          <div role="alert" className="tm-dt-card__msg" style={{ color: terminalColors.redDown }}>
            {error}
          </div>
        ) : isLoading ? (
          Array.from({ length: skeletonRows }, (_, i) => (
            <div key={i} className="tm-dt-card" aria-busy="true">
              <span className="tm-dt-card__skel" style={{ background: terminalColors.line2, width: '45%' }} />
              <span className="tm-dt-card__skel" style={{ background: terminalColors.line2, width: 56 }} />
            </div>
          ))
        ) : sortedRows && sortedRows.length > 0 ? (
          sortedRows.map((row) => {
            const key = rowKey(row)
            return (
              <div
                key={key}
                role="row"
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? (): void => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e): void => {
                        if (e.key === 'Enter') {
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
                className={onRowClick ? 'tm-dt-card tm-tap' : 'tm-dt-card'}
                style={{ cursor: onRowClick ? 'pointer' : undefined }}
              >
                <div className="tm-dt-card__id">
                  {titleColumn ? titleColumn.cell(row) : null}
                  {secondaryColumns.length ? (
                    <div className="tm-dt-card__sub">
                      {secondaryColumns.map((col) => (
                        <span key={col.id} style={{ color: col.cellColor?.(row) }}>
                          {col.header} {col.cell(row)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="tm-dt-card__stats">
                  {primaryColumns.map((col) => (
                    <div key={col.id} className="tm-dt-card__stat">
                      <span className="tm-dt-card__k">{col.header}</span>
                      <span className="tm-dt-card__v" style={{ color: col.cellColor?.(row) }}>
                        {col.cell(row)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        ) : (
          <div className="tm-dt-card__msg" style={{ color: terminalColors.ink3Alt }}>
            {emptyMessage}
          </div>
        )}
      </div>
    ) : null}
    </>
  )
}
