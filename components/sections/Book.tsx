import React from 'react';
import { Star, BookOpen, ShoppingCart, ArrowUpRight, Sparkles } from 'lucide-react';

const bookHighlights = [
  'Understand your internal programming',
  'Break free from limiting beliefs',
  'Rewire your mindset for success',
  'Practical exercises & techniques',
  'Real-life transformation stories',
];

export default function Book() {
  return (
    <section className="py-20 bg-white relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-20 left-0 w-72 h-72 bg-primary-100/30 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-primary-200/20 rounded-full blur-3xl" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary-100 rounded-full text-sm font-medium text-primary-700 mb-4">
            <BookOpen className="w-4 h-4" />
            Featured Book
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-neutral-900">
            The <span className="text-primary-500">Neuro Code</span>
          </h2>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          
          {/* Book Image Side */}
          <div className="relative flex justify-center">
            {/* Background card */}
            <div className="absolute inset-4 bg-gradient-to-br from-primary-200 to-primary-100 rounded-3xl transform rotate-3" />
            
            {/* Book container */}
            <div className="relative bg-white rounded-3xl p-8 shadow-2xl">
              {/* Book mockup */}
              <div className="relative w-64 md:w-72 mx-auto">
                <div className="aspect-[3/4] bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 rounded-lg shadow-2xl overflow-hidden relative">
                  {/* Book cover design */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                    <Sparkles className="w-10 h-10 text-primary-400 mb-4" />
                    <h3 className="text-2xl md:text-3xl font-bold text-white mb-2">NEURO</h3>
                    <h3 className="text-2xl md:text-3xl font-bold text-primary-400">CODE</h3>
                    <div className="w-16 h-0.5 bg-primary-400 my-4" />
                    <p className="text-neutral-400 text-sm">Rewrite Your Mind</p>
                    <p className="text-neutral-500 text-xs mt-auto">Bisher KC</p>
                  </div>
                  {/* Book spine effect */}
                  <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-neutral-950 to-transparent" />
                </div>
                
                {/* Shadow under book */}
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-48 h-4 bg-neutral-900/20 blur-xl rounded-full" />
              </div>

              {/* Floating elements */}
              <div className="absolute -top-4 -right-4 bg-primary-400 text-neutral-900 px-4 py-2 rounded-full text-sm font-bold shadow-lg">
                Bestseller
              </div>
              
              <div className="absolute -bottom-4 -left-4 bg-neutral-900 text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 shadow-lg">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                4.9 Rating
              </div>
            </div>
          </div>

          {/* Content Side */}
          <div className="lg:pl-8">
            <h3 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4">
              Rewrite Your Internal Programming
            </h3>
            <p className="text-lg text-neutral-600 mb-6 leading-relaxed">
              Discover the hidden codes that drive your thoughts, behaviors, and life outcomes. 
              Learn how to reprogram your mind for success, clarity, and lasting transformation.
            </p>

            {/* Highlights */}
            <div className="space-y-3 mb-8">
              {bookHighlights.map((highlight, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-neutral-700">{highlight}</span>
                </div>
              ))}
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-4">
              <a 
                href="#" 
                className="inline-flex items-center gap-2 px-8 py-4 bg-neutral-900 text-white rounded-full font-semibold hover:bg-neutral-800 transition-colors shadow-lg"
              >
                <ShoppingCart className="w-5 h-5" />
                Buy Now
              </a>
              <a 
                href="#" 
                className="inline-flex items-center gap-2 px-8 py-4 border-2 border-neutral-200 text-neutral-700 rounded-full font-medium hover:bg-neutral-50 transition-colors"
              >
                Learn More
                <ArrowUpRight className="w-5 h-5" />
              </a>
            </div>

            {/* Quote */}
            <div className="mt-8 p-4 bg-neutral-50 rounded-2xl border border-neutral-100">
              <p className="text-neutral-600 italic">
                "This book changed how I think about myself and my potential."
              </p>
              <p className="text-sm text-neutral-500 mt-2">— Reader Review</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
