# Bisher KC - Personal Website

A modern, minimal personal website built with Next.js, TypeScript, and Tailwind CSS.

## 🚀 Features

- **Modern Tech Stack**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Fully Responsive**: Optimized for mobile, tablet, and desktop
- **SEO Friendly**: Proper metadata and semantic HTML structure
- **Performance Optimized**: Server components, optimized images, and smooth animations
- **Accessible**: WCAG-friendly contrast ratios and keyboard navigation
- **Clean Design**: Minimal, professional look with soft gradients and micro-interactions

## 📁 Project Structure

```
bisher-kc-website/
├── app/
│   ├── layout.tsx          # Root layout with metadata
│   ├── page.tsx             # Home page
│   └── globals.css          # Global styles and Tailwind directives
├── components/
│   ├── ui/
│   │   ├── Card.tsx         # Reusable card component
│   │   ├── Section.tsx      # Section wrapper component
│   │   └── SectionTitle.tsx # Section heading component
│   └── sections/
│       ├── Header.tsx       # Navigation header
│       ├── Hero.tsx         # Hero section
│       ├── About.tsx        # About section
│       ├── WhatIDo.tsx      # Services section
│       ├── CoreValues.tsx   # Core values section
│       ├── VisionMission.tsx # Vision & Mission
│       ├── Transformation.tsx # Transformation stories
│       ├── CTA.tsx          # Call to action
│       └── Footer.tsx       # Footer
├── public/                  # Static assets (add images here)
├── lib/                     # Utility functions (if needed)
└── styles/                  # Additional styles (if needed)
```

## 🛠️ Installation & Setup

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Step 1: Install Dependencies

```bash
cd bisher-kc-website
npm install
```

### Step 2: Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the website.

### Step 3: Build for Production

```bash
npm run build
npm start
```

## 🎨 Customization

### Adding Images

1. Place your images in the `/public` folder
2. Update the Hero section in `components/sections/Hero.tsx`:

```tsx
import Image from 'next/image';

// Replace the placeholder div with:
<Image
  src="/your-image.jpg"
  alt="Bisher KC"
  width={600}
  height={600}
  className="rounded-3xl"
  priority
/>
```

### Updating Colors

Edit the color scheme in `tailwind.config.ts`:

```typescript
colors: {
  primary: {
    // Your custom colors
  }
}
```

### Modifying Content

All content is in the respective section components under `components/sections/`. Update the text directly in these files.

### Contact Information

Update contact details in `components/sections/CTA.tsx`:
- Email
- Phone number
- Location

## 🚀 Deployment

### Deploy to Vercel (Recommended)

1. Push your code to GitHub
2. Visit [vercel.com](https://vercel.com)
3. Import your repository
4. Deploy with one click

### Deploy to Other Platforms

The website works on any platform that supports Next.js:
- Netlify
- AWS Amplify
- Railway
- Digital Ocean

## 📝 SEO Optimization

The website includes:
- Proper meta tags and Open Graph tags
- Semantic HTML structure
- Mobile-responsive design
- Fast loading times
- Optimized images (when using Next.js Image component)

Update metadata in `app/layout.tsx` for better SEO.

## 🎯 Best Practices Used

- **Component Reusability**: Modular, reusable components
- **Type Safety**: Full TypeScript implementation
- **Performance**: Server components by default
- **Accessibility**: Proper ARIA labels and keyboard navigation
- **Code Organization**: Clear folder structure and separation of concerns
- **Modern CSS**: Utility-first approach with Tailwind CSS

## 📦 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Fonts**: Inter (Google Fonts)

## 🤝 Support

For questions or support, contact:
- Email: contact@bisherkc.com
- Website: [Your website URL]

## 📄 License

© 2024 Bisher KC. All rights reserved.

---

Built with ❤️ using Next.js, TypeScript, and Tailwind CSS
