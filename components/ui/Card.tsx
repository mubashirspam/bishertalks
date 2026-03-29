import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export default function Card({ children, className = '', hover = true }: CardProps) {
  return (
    <div 
      className={`
        bg-white dark:bg-neutral-800 rounded-xl p-6 md:p-8 shadow-sm border border-neutral-100 dark:border-neutral-700
        ${hover ? 'card-hover' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
