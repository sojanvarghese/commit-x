'use client'

import { motion } from 'framer-motion'
import { useInView } from 'framer-motion'
import { useRef } from 'react'
import {
  Brain,
  Zap,
  Shield,
  Code,
  GitBranch,
  Settings,
  Lock,
  Sparkles
} from 'lucide-react'

export default function Features() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  const features = [
    {
      icon: Brain,
      title: 'Smart Analysis',
      description: 'Automatically understands code changes and generates contextual commit messages'
    },
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Quick and easy setup with optimized performance and retry logic'
    },
    {
      icon: Shield,
      title: 'Security First',
      description: 'Path validation, input sanitization, and secure API key handling'
    },
    {
      icon: Code,
      title: 'Multiple Workflows',
      description: 'Batch processing for optimal performance or traditional commits'
    },
    {
      icon: GitBranch,
      title: 'Intelligent Fallbacks',
      description: 'Summary messages for large files, lock files, and build artifacts'
    },
    {
      icon: Settings,
      title: 'Interactive Mode',
      description: 'Choose from AI-generated suggestions or write custom messages'
    },
    {
      icon: Lock,
      title: 'No Data Storing',
      description: 'Your code stays private with secure API key handling'
    },
    {
      icon: Sparkles,
      title: 'Open Source',
      description: 'Fully free and open-source software with powerful preferences'
    }
  ]

  return (
    <section id="features" ref={ref} className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Features
          </h2>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
            Everything you need for intelligent Git commit messages
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 hover:border-purple-500/50 transition-all duration-300 group"
            >
              <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {feature.title}
              </h3>
              <p className="text-slate-300 leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
