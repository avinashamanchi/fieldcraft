import Tesseract from 'tesseract.js'

export interface OCRResult {
  vendor: string
  date: string
  amount: number
  rawText: string
  confidence: number
  needsManualReview: boolean
}

function extractAmount(text: string): number {
  // Find patterns like TOTAL: $XX.XX, Total $XX.XX, $XX.XX at end of line
  const patterns = [
    /(?:total|amount|due|charged?)[:\s]*\$?([\d,]+\.?\d{0,2})/gi,
    /\$\s*([\d,]+\.\d{2})\s*$/gm,
    /(?:^|\n)\s*([\d,]+\.\d{2})\s*$/gm,
  ]

  const amounts: number[] = []
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const n = parseFloat(match[1].replace(',', ''))
      if (!isNaN(n) && n > 0 && n < 50000) amounts.push(n)
    }
  }

  if (amounts.length === 0) return 0
  // Return the largest amount found (most likely the total)
  return Math.max(...amounts)
}

function extractVendor(text: string): string {
  // First 3 non-empty lines often contain the vendor name
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 2)
  for (const line of lines.slice(0, 4)) {
    // Skip lines that are mostly numbers or dates
    if (!/^\d/.test(line) && !/receipt|invoice|thank you/i.test(line)) {
      return line.substring(0, 40)
    }
  }
  return lines[0]?.substring(0, 40) ?? 'Unknown Vendor'
}

function extractDate(text: string): string {
  const patterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      try {
        const d = new Date(match[0])
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
      } catch {
        // ignore
      }
    }
  }

  return new Date().toISOString().split('T')[0]
}

export async function processReceiptImage(imageFile: File): Promise<OCRResult> {
  const { data } = await Tesseract.recognize(imageFile, 'eng', {
    // No logger needed - we handle progress in component
  })

  const text = data.text
  const confidence = data.confidence

  const vendor = extractVendor(text)
  const date = extractDate(text)
  const amount = extractAmount(text)

  return {
    vendor,
    date,
    amount,
    rawText: text,
    confidence,
    needsManualReview: confidence < 70 || amount === 0,
  }
}
