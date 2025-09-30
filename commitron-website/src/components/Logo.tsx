'use client'

import { motion } from 'framer-motion'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  animated?: boolean
  className?: string
}

export default function Logo({ size = 'md', animated = true, className = '' }: LogoProps) {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  }

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <motion.svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
        initial={animated ? { scale: 0, rotate: -180 } : {}}
        animate={animated ? { scale: 1, rotate: 0 } : {}}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        {/* Background Circle */}
        <motion.circle
          cx="32"
          cy="32"
          r="30"
          fill="url(#gradient1)"
          stroke="url(#gradient2)"
          strokeWidth="2"
          initial={animated ? { scale: 0 } : {}}
          animate={animated ? { scale: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
        />

        {/* Git Branch Icon */}
        <motion.path
          d="M16 20C16 18.8954 16.8954 18 18 18H20C21.1046 18 22 18.8954 22 20V24C22 25.1046 21.1046 26 20 26H18C16.8954 26 16 25.1046 16 24V20Z"
          fill="url(#gradient3)"
          initial={animated ? { opacity: 0, y: 10 } : {}}
          animate={animated ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, delay: 0.4 }}
        />

        {/* Main Branch Line */}
        <motion.path
          d="M22 22H32"
          stroke="url(#gradient4)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={animated ? { pathLength: 0 } : {}}
          animate={animated ? { pathLength: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.5 }}
        />

        {/* Commit Circle */}
        <motion.circle
          cx="36"
          cy="22"
          r="4"
          fill="url(#gradient5)"
          stroke="url(#gradient6)"
          strokeWidth="2"
          initial={animated ? { scale: 0 } : {}}
          animate={animated ? { scale: 1 } : {}}
          transition={{ duration: 0.4, delay: 0.6 }}
        />

        {/* AI Sparkle */}
        <motion.g
          initial={animated ? { opacity: 0, scale: 0 } : {}}
          animate={animated ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.4, delay: 0.8 }}
        >
          <motion.path
            d="M44 16L46 18L48 16L46 14L44 16Z"
            fill="url(#gradient7)"
            animate={animated ? {
              rotate: [0, 360],
              scale: [1, 1.2, 1]
            } : {}}
            transition={{
              rotate: { duration: 2, repeat: Infinity, ease: "linear" },
              scale: { duration: 1, repeat: Infinity, ease: "easeInOut" }
            }}
          />
          <motion.path
            d="M50 24L51 25L52 24L51 23L50 24Z"
            fill="url(#gradient8)"
            animate={animated ? {
              rotate: [0, -360],
              scale: [1, 1.1, 1]
            } : {}}
            transition={{
              rotate: { duration: 1.5, repeat: Infinity, ease: "linear" },
              scale: { duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.2 }
            }}
          />
        </motion.g>

        {/* Terminal Lines */}
        <motion.g
          initial={animated ? { opacity: 0 } : {}}
          animate={animated ? { opacity: 1 } : {}}
          transition={{ duration: 0.4, delay: 0.7 }}
        >
          <motion.path
            d="M20 40L24 44L20 48"
            stroke="url(#gradient9)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={animated ? { pathLength: 0 } : {}}
            animate={animated ? { pathLength: 1 } : {}}
            transition={{ duration: 0.5, delay: 0.9 }}
          />
          <motion.path
            d="M28 44H40"
            stroke="url(#gradient10)"
            strokeWidth="2"
            strokeLinecap="round"
            initial={animated ? { pathLength: 0 } : {}}
            animate={animated ? { pathLength: 1 } : {}}
            transition={{ duration: 0.5, delay: 1.0 }}
          />
        </motion.g>

        {/* Gradients */}
        <defs>
          <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
          <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#F472B6" />
          </linearGradient>
          <linearGradient id="gradient3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F3E8FF" />
          </linearGradient>
          <linearGradient id="gradient4" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
          <linearGradient id="gradient5" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F3E8FF" />
          </linearGradient>
          <linearGradient id="gradient6" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
          <linearGradient id="gradient7" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <linearGradient id="gradient8" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <linearGradient id="gradient9" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
          <linearGradient id="gradient10" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>
      </motion.svg>
    </div>
  )
}
