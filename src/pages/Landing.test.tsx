import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Landing from './Landing'

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

describe('FieldCraft public landing page', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', VisibleObserver)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function renderLanding() {
    return render(<MemoryRouter><Landing /></MemoryRouter>)
  }

  it('puts the product walkthrough and simple navigation in the first experience', () => {
    renderLanding()

    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Demo' })).toHaveAttribute('href', '#demo')
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how-it-works')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '#privacy')
    expect(screen.getByRole('region', { name: /voice-to-invoice demo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try fieldcraft/i })).toBeInTheDocument()
  })

  it('states the local demo and AI boundaries beside real product capabilities', () => {
    renderLanding()

    expect(screen.getByText(/fixed sample.*nothing is recorded/i)).toBeInTheDocument()
    expect(screen.getByText(/you review the result before anything is shared/i)).toBeInTheDocument()
    expect(screen.getByText(/jobs, clients, invoices, and expenses/i)).toBeInTheDocument()
  })

  it('links real support and legal pages without unverified social proof or plans', () => {
    const { container } = renderLanding()

    expect(screen.getAllByRole('link', { name: /privacy policy/i })[0]).toHaveAttribute(
      'href',
      'https://avinashamanchi.github.io/fieldcraft/privacy.html',
    )
    expect(screen.getAllByRole('link', { name: /terms of use/i })[0]).toHaveAttribute(
      'href',
      'https://avinashamanchi.github.io/fieldcraft/terms.html',
    )
    expect(screen.getAllByRole('link', { name: /support/i })[0]).toHaveAttribute(
      'href',
      'https://avinashamanchi.github.io/fieldcraft/support.html',
    )

    const copy = container.textContent ?? ''
    for (const unsupportedClaim of ['Mike S.', '2,400+', '$4.2M+', '4.9/5 rating', 'QuickBooks export', 'API access']) {
      expect(copy).not.toContain(unsupportedClaim)
    }
  })
})
