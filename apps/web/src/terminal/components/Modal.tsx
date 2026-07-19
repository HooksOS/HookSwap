import { ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import { terminalColors, terminalFonts, terminalScrim, terminalShadows } from '~/terminal/theme/tokens'

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** Renders the Terminal modal header (Space Grotesk 600 18px + close button) when set. */
  title?: string
  /** Card width in px. Design: 424 (B8 confirm swap), 400 (B9 connect wallet), 640 (B11 palette). */
  width?: number
  /** Card radius in px. Design: 22 (B8/B9), 18 (B11 palette). */
  radius?: number
  /** `center` (B8/B9) or `top` (B11 palette sits 70px from the top). */
  align?: 'center' | 'top'
  /** Distance from the top when `align="top"`. Default 70 (B11). */
  topOffset?: number
  /** Show the 30×30 close button in the header. Default true when `title` is set. */
  showClose?: boolean
  /** Close when the scrim is clicked. Default true. */
  closeOnScrimClick?: boolean
  /** Accessible label when no `title` is rendered. */
  ariaLabel?: string
  children: ReactNode
}

/**
 * Terminal modal — pixel-perfect to B8/B9: full-screen scrim `rgba(11,15,20,.42)`
 * over a blurred backdrop (`backdrop-filter: blur(6px)`), centered white card
 * with 22px radius (18px for the palette) and shadow
 * `0 40px 90px -20px rgba(11,15,20,.5)`. Esc and scrim-click close; body scroll
 * locks while open. Rendered in a portal.
 */
export function Modal({
  open,
  onClose,
  title,
  width = 424,
  radius = 22,
  align = 'center',
  topOffset = 70,
  showClose,
  closeOnScrimClick = true,
  ariaLabel,
  children,
}: ModalProps): JSX.Element | null {
  // On phones, present as a native iOS bottom sheet (full-width, pinned to the
  // bottom, rounded top corners, grabber handle, slide-up) instead of a centered card.
  const isMobile = useIsMobileViewport()

  // Esc closes.
  useEffect(() => {
    if (!open) {
      return undefined
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) {
      return undefined
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) {
    return null
  }

  const wantsClose = showClose ?? Boolean(title)

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : align === 'top' ? 'flex-start' : 'center',
        justifyContent: 'center',
        paddingTop: !isMobile && align === 'top' ? topOffset : 0,
      }}
    >
      {/* Scrim + blurred backdrop */}
      <div
        onClick={closeOnScrimClick ? onClose : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          background: terminalScrim,
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      />

      {/* Card (desktop) / bottom sheet (mobile) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? ariaLabel}
        className={isMobile ? 'tm-sheet' : undefined}
        style={{
          position: 'relative',
          zIndex: 1,
          width: isMobile ? '100%' : width,
          maxWidth: isMobile ? '100%' : 'calc(100vw - 32px)',
          maxHeight: isMobile ? '92vh' : 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          background: terminalColors.bg,
          borderRadius: isMobile ? `${Math.max(radius, 20)}px ${Math.max(radius, 20)}px 0 0` : radius,
          boxShadow: terminalShadows.modal,
          overflow: 'hidden',
          fontFamily: terminalFonts.sans,
          color: terminalColors.ink,
          // Clear the iPhone home indicator inside the sheet.
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : undefined,
        }}
      >
        {isMobile ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, flexShrink: 0 }}>
            <span
              aria-hidden="true"
              style={{ width: 38, height: 5, borderRadius: 999, background: terminalColors.line2 }}
            />
          </div>
        ) : null}
        {title ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px 22px 14px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: terminalFonts.display,
                fontWeight: 600,
                fontSize: 18,
                color: terminalColors.ink,
              }}
            >
              {title}
            </span>
            {wantsClose ? <ModalCloseButton onClose={onClose} /> : null}
          </div>
        ) : null}
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

function ModalCloseButton({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        background: terminalColors.panel2,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={terminalColors.ink2} strokeWidth={2.4}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )
}
