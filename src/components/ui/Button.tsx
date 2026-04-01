import { forwardRef } from 'react'
import { motion } from 'framer-motion'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold disabled:bg-orange-300',
  secondary: 'bg-steel text-white hover:bg-blue-700 active:bg-blue-800 font-semibold disabled:opacity-50',
  ghost: 'bg-transparent text-warm-white hover:bg-white/10 active:bg-white/20 border border-white/20 font-medium disabled:opacity-40',
  danger: 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold disabled:opacity-50',
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-2 text-sm rounded-lg min-h-[40px]',
  md: 'px-4 py-3 text-base rounded-xl min-h-[48px]',
  lg: 'px-6 py-4 text-lg rounded-2xl min-h-[56px]',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, fullWidth, children, className = '', disabled, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
        className={`
          inline-flex items-center justify-center gap-2 transition-colors duration-150 cursor-pointer
          focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-charcoal
          ${variantClasses[variant]}
          ${sizeClasses[size]}
          ${fullWidth ? 'w-full' : ''}
          ${disabled || loading ? 'cursor-not-allowed' : ''}
          ${className}
        `}
        disabled={disabled || loading}
        {...(props as React.ComponentProps<typeof motion.button>)}
      >
        {loading && (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {children}
      </motion.button>
    )
  }
)

Button.displayName = 'Button'
export default Button
