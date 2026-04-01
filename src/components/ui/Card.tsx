import { motion } from 'framer-motion'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }

export default function Card({ children, className = '', onClick, padding = 'md' }: CardProps) {
  const base = `bg-[#242424] rounded-2xl border border-white/5 ${paddings[padding]} ${className}`

  if (onClick) {
    return (
      <motion.div
        className={`${base} cursor-pointer`}
        onClick={onClick}
        whileTap={{ scale: 0.985 }}
        transition={{ duration: 0.1 }}
      >
        {children}
      </motion.div>
    )
  }

  return <div className={base}>{children}</div>
}
