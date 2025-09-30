'use client'

import { Github, Twitter, Heart, ExternalLink } from 'lucide-react'
import Logo from './Logo'

export default function Footer() {
  return (
    <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Logo and Description */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <Logo size="md" animated={false} />
              <span className="text-white font-bold text-xl">Commitron</span>
            </div>
            <p className="text-slate-300 mb-6 max-w-md">
              AI-powered Git commit assistant that intelligently analyzes your code changes and generates clear, concise, and context-aware commit messages.
            </p>
            <div className="flex space-x-4">
              <a
                href="https://github.com/sojanvarghese/commit-x"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <Github className="w-6 h-6" />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <Twitter className="w-6 h-6" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <a href="#features" className="text-slate-300 hover:text-white transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#installation" className="text-slate-300 hover:text-white transition-colors">
                  Installation
                </a>
              </li>
              <li>
                <a href="https://www.npmjs.com/package/commitron" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors flex items-center">
                  npm Package
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </li>
              <li>
                <a href="https://github.com/sojanvarghese/commit-x" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors flex items-center">
                  GitHub
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-white font-semibold mb-4">Support</h3>
            <ul className="space-y-2">
              <li>
                <a href="https://github.com/sojanvarghese/commit-x/issues" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors">
                  Report Issues
                </a>
              </li>
              <li>
                <a href="https://github.com/sojanvarghese/commit-x/discussions" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors">
                  Discussions
                </a>
              </li>
              <li>
                <a href="https://github.com/sojanvarghese/commit-x/blob/main/README.md" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors">
                  Documentation
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-slate-800 mt-8 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="text-slate-400 text-sm mb-4 md:mb-0">
              © 2024 Commitron. Made with <Heart className="w-4 h-4 inline text-red-500" /> by{' '}
              <a
                href="https://github.com/sojanvarghese"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                Sojan Varghese
              </a>
            </div>
            <div className="flex space-x-6 text-sm">
              <a href="https://github.com/sojanvarghese/commit-x/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">
                MIT License
              </a>
              <a href="https://github.com/sojanvarghese/commit-x/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">
                Security
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
