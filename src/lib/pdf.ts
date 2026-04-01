import jsPDF from 'jspdf'
import type { Invoice, Job, UserProfile } from '../types'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function generateInvoicePDF(invoice: Invoice, job: Job, userProfile: UserProfile): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageW = 215.9
  const margin = 20
  const contentW = pageW - margin * 2

  // Colors
  const charcoal: [number, number, number] = [26, 26, 26]
  const orange: [number, number, number] = [255, 107, 43]
  const steel: [number, number, number] = [45, 106, 159]
  const lightGray: [number, number, number] = [245, 240, 235]
  const midGray: [number, number, number] = [150, 150, 150]
  const green: [number, number, number] = [34, 197, 94]

  let y = margin

  // Header bar
  doc.setFillColor(...orange)
  doc.rect(0, 0, pageW, 12, 'F')

  // Business name in header
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(userProfile.businessName.toUpperCase(), margin, 8)

  y = 24

  // Two-column header: business info left, invoice info right
  doc.setTextColor(...charcoal)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('INVOICE', margin, y)

  // Invoice number
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...midGray)
  doc.text(`Invoice #${invoice.number}`, margin, y + 7)

  // Right column - invoice meta
  const rightX = pageW - margin
  doc.setTextColor(...charcoal)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('DATE', rightX - 50, y, { align: 'left' })
  doc.text('DUE', rightX - 50, y + 7, { align: 'left' })
  doc.text('STATUS', rightX - 50, y + 14, { align: 'left' })

  doc.setFont('helvetica', 'normal')
  doc.text(formatDate(invoice.createdAt), rightX, y, { align: 'right' })
  doc.text(invoice.paymentTerms, rightX, y + 7, { align: 'right' })

  if (invoice.paymentStatus === 'Paid') {
    doc.setTextColor(...green)
  } else {
    doc.setTextColor(...orange)
  }
  doc.setFont('helvetica', 'bold')
  doc.text(invoice.paymentStatus.toUpperCase(), rightX, y + 14, { align: 'right' })
  doc.setTextColor(...charcoal)

  y += 30

  // Divider
  doc.setDrawColor(...orange)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageW - margin, y)
  y += 8

  // From / Bill To columns
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...midGray)
  doc.text('FROM', margin, y)
  doc.text('JOB SITE', pageW / 2, y)

  y += 5
  doc.setTextColor(...charcoal)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(userProfile.name, margin, y)
  doc.text(job.clientName, pageW / 2, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  y += 5
  if (userProfile.address) {
    doc.text(userProfile.address, margin, y)
  }
  doc.text(job.address, pageW / 2, y)
  y += 4
  if (userProfile.phone) {
    doc.text(userProfile.phone, margin, y)
  }
  if (userProfile.licenseNumber) {
    y += 4
    doc.setTextColor(...midGray)
    doc.setFontSize(8)
    doc.text(`License: ${userProfile.licenseNumber}`, margin, y)
    doc.setTextColor(...charcoal)
  }

  y += 12

  // Line items table header
  doc.setFillColor(...charcoal)
  doc.rect(margin, y, contentW, 8, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DESCRIPTION', margin + 3, y + 5.5)
  doc.text('QTY', margin + contentW * 0.58, y + 5.5, { align: 'right' })
  doc.text('UNIT PRICE', margin + contentW * 0.75, y + 5.5, { align: 'right' })
  doc.text('TOTAL', margin + contentW, y + 5.5, { align: 'right' })

  y += 8

  // Line items
  doc.setTextColor(...charcoal)
  invoice.lineItems.forEach((item, idx) => {
    const rowH = 9
    if (idx % 2 === 0) {
      doc.setFillColor(...lightGray)
      doc.rect(margin, y, contentW, rowH, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)

    // Type indicator dot
    if (item.type === 'labor') {
      doc.setFillColor(...steel)
    } else {
      doc.setFillColor(...orange)
    }
    doc.circle(margin + 3, y + rowH / 2, 1.2, 'F')

    doc.setTextColor(...charcoal)
    const descLines = doc.splitTextToSize(item.description, contentW * 0.55)
    doc.text(descLines, margin + 7, y + 5.5)
    doc.text(String(item.quantity), margin + contentW * 0.58, y + 5.5, { align: 'right' })
    doc.text(formatCurrency(item.unitPrice), margin + contentW * 0.75, y + 5.5, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(formatCurrency(item.total), margin + contentW, y + 5.5, { align: 'right' })

    y += rowH
  })

  // Legend
  y += 4
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setFillColor(...steel)
  doc.circle(margin + 2, y + 1.5, 1.2, 'F')
  doc.setTextColor(...midGray)
  doc.text('Labor', margin + 5, y + 3)
  doc.setFillColor(...orange)
  doc.circle(margin + 18, y + 1.5, 1.2, 'F')
  doc.text('Materials', margin + 21, y + 3)

  y += 10

  // Totals block — right-aligned
  const totalsX = pageW - margin - 70
  doc.setDrawColor(...lightGray)
  doc.setLineWidth(0.3)
  doc.line(totalsX, y, pageW - margin, y)
  y += 5

  const drawTotalRow = (label: string, value: string, bold = false, color: [number, number, number] = charcoal) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 10 : 9)
    doc.setTextColor(...midGray)
    doc.text(label, totalsX, y)
    doc.setTextColor(...color)
    doc.text(value, pageW - margin, y, { align: 'right' })
    y += 7
  }

  drawTotalRow('Subtotal', formatCurrency(invoice.subtotal))
  if (invoice.taxRate > 0) {
    drawTotalRow(`Tax (${(invoice.taxRate * 100).toFixed(1)}%)`, formatCurrency(invoice.taxAmount))
  }

  doc.setLineWidth(0.5)
  doc.setDrawColor(...charcoal)
  doc.line(totalsX, y, pageW - margin, y)
  y += 6

  drawTotalRow('TOTAL DUE', formatCurrency(invoice.total), true, invoice.paymentStatus === 'Paid' ? green : orange)

  // Notes
  if (invoice.notes) {
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...midGray)
    doc.text('NOTES', margin, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...charcoal)
    const noteLines = doc.splitTextToSize(invoice.notes, contentW)
    doc.text(noteLines, margin, y)
    y += noteLines.length * 4.5
  }

  // Footer
  const footerY = 265
  doc.setDrawColor(...lightGray)
  doc.setLineWidth(0.3)
  doc.line(margin, footerY, pageW - margin, footerY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...midGray)
  doc.text('Thank you for your business. Payment is appreciated within the terms specified above.', pageW / 2, footerY + 5, { align: 'center' })
  doc.text('Generated by FieldCraft — fieldcraft.app', pageW / 2, footerY + 10, { align: 'center' })

  doc.save(`Invoice-${invoice.number}-${job.clientName.replace(/\s+/g, '-')}.pdf`)
}

// Fallback print view
export function printInvoice(invoice: Invoice, job: Job, userProfile: UserProfile): void {
  const w = window.open('', '_blank')
  if (!w) return

  const html = `<!DOCTYPE html>
<html>
<head>
<title>Invoice ${invoice.number}</title>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', Arial, sans-serif; color: #1A1A1A; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { background: #FF6B2B; color: white; padding: 16px 20px; margin: -40px -40px 30px; }
  .header h1 { font-size: 14px; font-weight: 800; letter-spacing: 2px; }
  .title-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  h2 { font-size: 28px; font-weight: 800; color: #1A1A1A; }
  .inv-num { color: #999; font-size: 13px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  thead tr { background: #1A1A1A; color: white; }
  thead th { padding: 8px 12px; text-align: left; font-size: 11px; letter-spacing: 1px; }
  tbody tr:nth-child(even) { background: #F5F0EB; }
  tbody td { padding: 8px 12px; font-size: 13px; }
  .total-block { float: right; width: 260px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #eee; }
  .total-final { font-size: 16px; font-weight: 800; color: #FF6B2B; border-bottom: 2px solid #1A1A1A; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<div class="header"><h1>${userProfile.businessName.toUpperCase()}</h1></div>
<div class="title-row">
  <div><h2>INVOICE</h2><div class="inv-num">#${invoice.number} · ${new Date(invoice.createdAt).toLocaleDateString()}</div></div>
  <div style="text-align:right;font-size:13px">
    <div style="font-weight:700;color:#FF6B2B">${invoice.paymentStatus.toUpperCase()}</div>
    <div style="color:#999">${invoice.paymentTerms}</div>
  </div>
</div>
<div style="display:flex;gap:40px;margin-bottom:28px">
  <div><div style="font-size:11px;color:#999;font-weight:700;letter-spacing:1px;margin-bottom:4px">FROM</div>
    <strong>${userProfile.name}</strong><br>${userProfile.address ?? ''}<br>${userProfile.phone ?? ''}</div>
  <div><div style="font-size:11px;color:#999;font-weight:700;letter-spacing:1px;margin-bottom:4px">BILL TO</div>
    <strong>${job.clientName}</strong><br>${job.address}</div>
</div>
<table>
<thead><tr><th>DESCRIPTION</th><th style="text-align:right">QTY</th><th style="text-align:right">UNIT PRICE</th><th style="text-align:right">TOTAL</th></tr></thead>
<tbody>
${invoice.lineItems.map((li) => `<tr><td>${li.description}</td><td style="text-align:right">${li.quantity}</td><td style="text-align:right">$${li.unitPrice.toFixed(2)}</td><td style="text-align:right;font-weight:600">$${li.total.toFixed(2)}</td></tr>`).join('')}
</tbody>
</table>
<div class="total-block">
  <div class="total-row"><span>Subtotal</span><span>$${invoice.subtotal.toFixed(2)}</span></div>
  ${invoice.taxRate > 0 ? `<div class="total-row"><span>Tax (${(invoice.taxRate * 100).toFixed(1)}%)</span><span>$${invoice.taxAmount.toFixed(2)}</span></div>` : ''}
  <div class="total-row total-final"><span>TOTAL DUE</span><span>$${invoice.total.toFixed(2)}</span></div>
</div>
${invoice.notes ? `<div style="clear:both;margin-top:28px;padding:12px 16px;background:#F5F0EB;border-left:3px solid #FF6B2B;font-size:13px">${invoice.notes}</div>` : ''}
<div style="clear:both;margin-top:40px;text-align:center;font-size:11px;color:#999">Thank you for your business · Generated by FieldCraft</div>
<button onclick="window.print()" style="position:fixed;bottom:20px;right:20px;background:#FF6B2B;color:white;border:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">Print / Save PDF</button>
</body></html>`

  w.document.write(html)
  w.document.close()
}
