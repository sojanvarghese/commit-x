'use client'

import { motion } from 'framer-motion'
import { Terminal, Sparkles, Zap } from 'lucide-react'
import Logo from './Logo'

export default function Hero() {
  return (
    <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center">
          {/* Main heading */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="mb-8"
          >
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                Commit with AI
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
              Generate intelligent commit messages with AI
            </p>
          </motion.div>

          {/* Floating logo illustration */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.4 }}
            className="mb-12 flex justify-center"
          >
            <div className="relative">
              <Logo size="xl" animated={true} />
              <motion.div
                animate={{
                  y: [0, -10, 0],
                  rotate: [0, 5, 0]
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="absolute -top-4 -right-4"
              >
                <Sparkles className="w-8 h-8 text-yellow-400" />
              </motion.div>
            </div>
          </motion.div>

          {/* Call to action */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="mb-8"
          >
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">
              Never write boring commits again
            </h3>
            <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-8">
              Commitron analyzes your code changes and generates clear, concise, and context-aware commit messages using Google's Gemini AI.
            </p>
          </motion.div>

          {/* Installation commands */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="space-y-4"
          >
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg p-6 max-w-2xl mx-auto border border-slate-700">
              <div className="flex items-center space-x-2 mb-4">
                <Zap className="w-5 h-5 text-purple-400" />
                <span className="text-white font-semibold">Quick Install</span>
              </div>
              <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm">
                <div className="text-green-400 mb-2"># Install globally from npm</div>
                <div className="text-white">npm install -g commitron</div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://www.npmjs.com/package/commitron"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-300 transform hover:scale-105"
              >
                Download on npm
              </a>
              <a
                href="https://github.com/sojanvarghese/commit-x"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-8 py-4 bg-slate-800 text-white font-semibold rounded-lg hover:bg-slate-700 transition-all duration-300 border border-slate-600"
              >
                View on GitHub
              </a>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
