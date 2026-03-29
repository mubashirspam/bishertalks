'use client';

import React, { useState } from 'react';
import { Camera, X, ChevronLeft, ChevronRight } from 'lucide-react';

const galleryItems = [
  {
    image: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=800&q=80',
    title: 'Igniting Minds',
    description: 'A powerful keynote session that sparked transformation in over 500 professionals.',
  },
  {
    image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80',
    title: 'Corporate Leadership Summit',
    description: 'Leading a corporate training workshop on mindset reset and team synergy.',
  },
  {
    image: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&q=80',
    title: 'The Breakthrough Camp',
    description: 'A 3-day immersive bootcamp where participants discovered their true potential.',
  },
  {
    image: 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=800&q=80',
    title: 'Team Transformation',
    description: 'Building unbreakable teams through outbound training and shared experiences.',
  },
  {
    image: 'https://images.unsplash.com/photo-1559223607-a43c990c692c?w=800&q=80',
    title: 'Youth Empowerment',
    description: 'Empowering the next generation with clarity, confidence, and purpose.',
  },
  {
    image: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800&q=80',
    title: 'Mindset Masterclass',
    description: 'An exclusive masterclass on reprogramming your internal code for success.',
  },
  {
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&q=80',
    title: 'Coaching Circle',
    description: 'Intimate group coaching sessions creating lasting breakthroughs.',
  },
  {
    image: 'https://images.unsplash.com/photo-1591115765373-5207764f72e7?w=800&q=80',
    title: 'Stage On Fire',
    description: 'Connecting with thousands through stories that heal, inspire, and transform.',
  },
];

export default function Gallery() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const openLightbox = (index: number) => setSelectedIndex(index);
  const closeLightbox = () => setSelectedIndex(null);

  const goToPrev = () => {
    if (selectedIndex === null) return;
    setSelectedIndex(selectedIndex === 0 ? galleryItems.length - 1 : selectedIndex - 1);
  };

  const goToNext = () => {
    if (selectedIndex === null) return;
    setSelectedIndex(selectedIndex === galleryItems.length - 1 ? 0 : selectedIndex + 1);
  };

  return (
    <section className="py-20 bg-neutral-50 dark:bg-neutral-950 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary-100/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-200/20 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-4">
            <Camera className="w-4 h-4 text-primary-500" />
            Moments of Impact
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-neutral-900 dark:text-white mb-4">
            Stories in <span className="text-primary-500">Frames</span>
          </h2>
          <p className="text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
            Every image holds a story of transformation, courage, and breakthrough moments.
          </p>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {galleryItems.map((item, index) => (
            <div
              key={index}
              onClick={() => openLightbox(index)}
              className={`group relative rounded-2xl overflow-hidden cursor-pointer ${
                index === 0 ? 'col-span-2 row-span-2' : ''
              } ${index === 5 ? 'col-span-2' : ''}`}
            >
              <div className={`${index === 0 ? 'aspect-square' : 'aspect-[4/3]'} w-full`}>
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
              </div>

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/80 via-neutral-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300" />

              {/* Content on hover */}
              <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
                <h3 className="text-white font-semibold text-sm md:text-base mb-1">{item.title}</h3>
                <p className="text-neutral-300 text-xs md:text-sm line-clamp-2">{item.description}</p>
              </div>

              {/* Always visible subtle title bar */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-neutral-900/60 to-transparent p-3 group-hover:opacity-0 transition-opacity">
                <h3 className="text-white font-medium text-xs md:text-sm">{item.title}</h3>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {selectedIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-neutral-900/95 flex items-center justify-center p-4"
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-50"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Prev button */}
          <button
            onClick={(e) => { e.stopPropagation(); goToPrev(); }}
            className="absolute left-4 md:left-8 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-50"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          {/* Next button */}
          <button
            onClick={(e) => { e.stopPropagation(); goToNext(); }}
            className="absolute right-4 md:right-8 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-50"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          {/* Image & Info */}
          <div
            className="max-w-4xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-2xl overflow-hidden shadow-2xl">
              <img
                src={galleryItems[selectedIndex].image}
                alt={galleryItems[selectedIndex].title}
                className="w-full max-h-[70vh] object-contain bg-neutral-800"
              />
            </div>
            <div className="mt-4 text-center">
              <h3 className="text-white text-xl font-bold mb-1">
                {galleryItems[selectedIndex].title}
              </h3>
              <p className="text-neutral-400">
                {galleryItems[selectedIndex].description}
              </p>
              <p className="text-neutral-600 text-sm mt-2">
                {selectedIndex + 1} / {galleryItems.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
