import React from 'react';

interface SectionProps {
  id?: string;
  className?: string;
  children: React.ReactNode;
  background?: 'white' | 'gradient' | 'light';
}

export default function Section({ 
  id, 
  className = '', 
  children, 
  background = 'white' 
}: SectionProps) {
  const bgClass = {
    white: 'bg-white',
    gradient: 'gradient-bg',
    light: 'bg-neutral-50'
  }[background];

  return (
    <section id={id} className={`section-padding ${bgClass} ${className}`}>
      <div className="container-custom">
        {children}
      </div>
    </section>
  );
}
