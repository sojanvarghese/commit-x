'use client'

import { motion } from 'framer-motion'
import { useInView } from 'framer-motion'
import { useRef, useState } from 'react'
import { Copy, Check, Terminal, Package, Download } from 'lucide-react'
import Logo from './Logo'

export default function Installation() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)

  const commands = [
    {
      title: 'Install from npm',
      command: 'npm install -g commitron',
      description: 'Install globally from npm registry'
    },
    {
      title: 'Setup API Key',
      command: 'cx setup',
      description: 'Interactive setup for first-time users'
    },
    {
      title: 'Start Committing',
      command: 'cx',
      description: 'Process files with AI-powered commits'
    }
  ]

  const copyToClipboard = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(command)
      setTimeout(() => setCopiedCommand(null), 2000)
    } catch (err) {
      console.error('Failed to copy: ', err)
    }
  }

  return (
    <section id="installation" ref={ref} className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Installation
          </h2>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
            Get started with Commitron in just a few simple steps
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Installation Steps */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="space-y-6"
          >
            {commands.map((cmd, index) => (
              <div
                key={index}
                className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 hover:border-purple-500/50 transition-all duration-300"
              >
                <div className="flex items-start space-x-4">
                  <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-white font-bold text-sm">{index + 1}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {cmd.title}
                    </h3>
                    <p className="text-slate-300 mb-4">
                      {cmd.description}
                    </p>
                    <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm relative group">
                      <code className="text-green-400">{cmd.command}</code>
                      <button
                        onClick={() => copyToClipboard(cmd.command)}
                        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                      >
                        {copiedCommand === cmd.command ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>

          {/* Visual Elements */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="space-y-8"
          >
            {/* Terminal Demo */}
            <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-slate-400 text-sm ml-4">Terminal</span>
              </div>
              <div className="space-y-2 font-mono text-sm">
                <div className="text-green-400">$ npm install -g commitron</div>
                <div className="text-slate-300">+ commitron@1.0.1</div>
                <div className="text-slate-300">added 1 package in 2s</div>
                <div className="text-green-400 mt-4">$ cx setup</div>
                <div className="text-slate-300">🚀 Welcome to Commitron Setup!</div>
                <div className="text-slate-300">Enter your Gemini API key: ••••••••</div>
                <div className="text-green-400 mt-4">$ cx</div>
                <div className="text-slate-300">📝 Generated commit message:</div>
                <div className="text-purple-400">feat: add user authentication system</div>
              </div>
            </div>

            {/* Package Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700">
                <Package className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                <div className="text-white font-semibold">npm</div>
                <div className="text-slate-400 text-sm">Package Manager</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700">
                <Download className="w-8 h-8 text-pink-400 mx-auto mb-2" />
                <div className="text-white font-semibold">Global</div>
                <div className="text-slate-400 text-sm">Installation</div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Quick Start CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="text-center mt-16"
        >
          <div className="bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-2xl p-8 border border-purple-500/30">
            <Logo size="xl" animated={true} className="mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-4">
              Ready to get started?
            </h3>
            <p className="text-slate-300 mb-6 max-w-2xl mx-auto">
              Install Commitron and start creating intelligent commit messages in seconds
            </p>
            <a
              href="https://www.npmjs.com/package/commitron"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-300 transform hover:scale-105"
            >
              <Download className="w-5 h-5 mr-2" />
              Install Now
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
