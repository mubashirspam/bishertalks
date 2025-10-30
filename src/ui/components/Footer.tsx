'use client';

import React from "react";

type FooterSectionProps = Record<string, never>

const Footer: React.FC<FooterSectionProps> = () => {
  const currentYear = new Date().getFullYear()

  const socialLinks = [
    {
      name: 'LinkedIn',
      href: '#',
      icon: '💼',
      color: 'hover:text-blue-400'
    },
    {
      name: 'Instagram',
      href: '#',
      icon: '📸',
      color: 'hover:text-pink-400'
    },
    {
      name: 'YouTube',
      href: '#',
      icon: '📺',
      color: 'hover:text-red-400'
    },
    {
      name: 'Facebook',
      href: '#',
      icon: '👤',
      color: 'hover:text-blue-500'
    }
  ]

  const quickLinks = [
    { name: 'About Me', href: '#about' },
    { name: 'Services', href: '#what-i-do' },
    { name: 'Expertise', href: '#expertise' },
    { name: 'Core Values', href: '#values' },
    { name: 'Work Experience', href: '#work-experience' }
  ]

  const services = [
    'Life Coaching',
    'Corporate Training',
    'Public Speaking',
    'Leadership Development',
    'Trainer Training',
    'Motivational Sessions'
  ]

  return (
    <footer className="relative mt-20 bg-gradient-to-b from-black via-gray-900/50 to-black border-t border-gray-800/50">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,255,255,0.03)_0%,transparent_70%)]"></div>
      
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        {/* Main Footer Content */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {/* Brand Section */}
          <div className="lg:col-span-2">
            <h3 className="text-2xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              Life Coach Bisher KC
            </h3>
            <p className="text-gray-400 leading-relaxed mb-6 max-w-md">
              Empowering individuals and organizations to grow with clarity, confidence, and purpose through transformative learning experiences and practical tools.
            </p>
            
            {/* Vision Statement */}
            <div className="p-4 bg-gradient-to-r from-cyan-900/20 to-purple-900/20 border border-cyan-400/20 rounded-lg">
              <p className="text-sm text-gray-300 italic">
                &quot;To empower one million people to grow with clarity, confidence, and purpose.&quot;
              </p>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-lg font-semibold text-purple-400 mb-4">Quick Links</h4>
            <ul className="space-y-2">
              {quickLinks.map((link) => (
                <li key={link.name}>
                  <button
                    onClick={() => {
                      const element = document.querySelector(link.href)
                      if (element) element.scrollIntoView({ behavior: 'smooth' })
                    }}
                    className="text-gray-400 hover:text-cyan-400 transition-colors duration-300 hover:translate-x-1 transform"
                  >
                    {link.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h4 className="text-lg font-semibold text-pink-400 mb-4">Services</h4>
            <ul className="space-y-2">
              {services.map((service) => (
                <li key={service} className="text-gray-400 text-sm">
                  <span className="w-1 h-1 bg-pink-400 rounded-full inline-block mr-2"></span>
                  {service}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Contact & Social */}
        <div className="border-t border-gray-800/50 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-6 md:space-y-0">
            {/* Contact Info */}
            <div className="text-center md:text-left">
              <h4 className="text-lg font-semibold text-green-400 mb-2">Get In Touch</h4>
              <div className="space-y-1 text-sm text-gray-400">
                <p>📧 Connect for collaborations & programs</p>
                <p>📱 Download Skillage App for online courses</p>
                <p>🌐 Follow on social media for daily insights</p>
              </div>
            </div>

            {/* Social Links */}
            <div className="flex items-center space-x-6">
              <span className="text-gray-400 text-sm hidden sm:block">Follow me:</span>
              <div className="flex space-x-4">
                {socialLinks.map((social) => (
                  <a
                    key={social.name}
                    href={social.href}
                    className={`text-2xl transition-all duration-300 transform hover:scale-125 hover:drop-shadow-lg ${social.color}`}
                    title={social.name}
                  >
                    {social.icon}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-gray-800/30 mt-8 pt-6 text-center">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <p className="text-gray-500 text-sm">
              © {currentYear} Bisher KC. All rights reserved. | Founder & CEO, Skillage
            </p>
            
            <div className="flex items-center space-x-6 text-xs text-gray-500">
              <span>Privacy Policy</span>
              <span>•</span>
              <span>Terms of Service</span>
              <span>•</span>
              <span>Made with 💜 for transformation</span>
            </div>
          </div>
        </div>

        {/* Floating Back to Top Button */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-8 right-8 w-12 h-12 bg-gradient-to-r from-cyan-500 to-purple-600 text-white rounded-full shadow-[0_0_20px_rgba(0,255,255,0.3)] hover:shadow-[0_0_30px_rgba(0,255,255,0.5)] transition-all duration-300 hover:scale-110 z-50"
          title="Back to top"
        >
          ↑
        </button>
      </div>

      {/* Bottom Gradient Effect */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent"></div>
    </footer>
  )
}

export default Footer;
