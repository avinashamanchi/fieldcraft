import { Droplets, Zap, Wind, Hammer, Wrench, Home, Layers, Paintbrush } from 'lucide-react'
import type { TradeType } from '../../types'

const tradeIcons: Record<TradeType, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  Plumbing: Droplets,
  Electrical: Zap,
  HVAC: Wind,
  Carpentry: Hammer,
  General: Wrench,
  Roofing: Home,
  Flooring: Layers,
  Painting: Paintbrush,
}

const tradeColors: Record<TradeType, string> = {
  Plumbing: 'text-blue-400 bg-blue-500/15',
  Electrical: 'text-yellow-400 bg-yellow-500/15',
  HVAC: 'text-cyan-400 bg-cyan-500/15',
  Carpentry: 'text-amber-400 bg-amber-500/15',
  General: 'text-orange-400 bg-orange-500/15',
  Roofing: 'text-red-400 bg-red-500/15',
  Flooring: 'text-purple-400 bg-purple-500/15',
  Painting: 'text-pink-400 bg-pink-500/15',
}

interface TradeIconProps {
  tradeType: TradeType
  size?: number
  className?: string
}

export default function TradeIcon({ tradeType, size = 16, className = '' }: TradeIconProps) {
  const Icon = tradeIcons[tradeType] ?? Wrench
  const colors = tradeColors[tradeType] ?? 'text-orange-400 bg-orange-500/15'

  return (
    <div className={`w-9 h-9 rounded-xl ${colors} flex items-center justify-center flex-shrink-0 ${className}`}>
      <Icon size={size} strokeWidth={2} />
    </div>
  )
}
