import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiveInvoiceDemo from './LiveInvoiceDemo'

class VisibleObserver {
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) { this.callback = callback }
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  root = null
  rootMargin = '0px'
  thresholds = [0.35]
}

function setReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('FieldCraft live invoice demo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IntersectionObserver', VisibleObserver)
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('The local demo must not use the network.') }))
    setReducedMotion(false)
  })

  afterEach(() => {
    cleanup()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('autoplays the visible voice-to-invoice story and pauses on request', () => {
    const { unmount } = render(<LiveInvoiceDemo />)

    expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toHaveAttribute('data-demo-stage', 'ready')
    expect(screen.getByRole('button', { name: /pause demo/i })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2400) })
    expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toHaveAttribute('data-demo-stage', 'listening')

    fireEvent.click(screen.getByRole('button', { name: /pause demo/i }))
    act(() => { vi.advanceTimersByTime(4800) })
    expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toHaveAttribute('data-demo-stage', 'listening')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('supports direct inspection and replay without application state', () => {
    render(<LiveInvoiceDemo />)

    fireEvent.click(screen.getByRole('button', { name: /build invoice/i }))
    expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toHaveAttribute('data-demo-stage', 'invoice')
    fireEvent.click(screen.getByRole('button', { name: /replay/i }))
    expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toHaveAttribute('data-demo-stage', 'ready')
  })

  it('shows the completed invoice without autoplay for reduced motion', () => {
    setReducedMotion(true)
    render(<LiveInvoiceDemo />)

    expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toHaveAttribute('data-demo-stage', 'share')
    expect(screen.getByText(/invoice is ready to review and share/i)).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })
})
