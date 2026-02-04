# Quick Start Guide - Bisher KC Website

## 🎯 Overview

This is a modern, minimal personal website for Bisher KC built with Next.js, TypeScript, and Tailwind CSS. The website is fully responsive, SEO-friendly, and ready for deployment.

## ⚡ Quick Start (3 Steps)

### 1. Install Dependencies

```bash
cd bisher-kc-website
npm install
```

This will install all required packages including Next.js, React, TypeScript, and Tailwind CSS.

### 2. Run Development Server

```bash
npm run dev
```

Visit http://localhost:3000 to see your website live!

### 3. Build for Production

```bash
npm run build
npm start
```

## 📸 Adding Your Photos

### Add Your Profile Picture

1. Save your professional photo as `profile.jpg` in the `/public` folder
2. Open `components/sections/Hero.tsx`
3. Find the commented section that says `{/* Image placeholder */}`
4. Replace it with:

```tsx
<Image
  src="/profile.jpg"
  alt="Bisher KC - Life Coach and Corporate Trainer"
  width={600}
  height={600}
  className="rounded-3xl w-full h-full object-cover"
  priority
/>
```

5. Add this import at the top of the file:

```tsx
import Image from 'next/image';
```

### Add More Images

For any section where you want images:
- Place images in `/public` folder
- Use the Next.js `Image` component for optimization
- Example: `<Image src="/your-image.jpg" alt="Description" width={800} height={600} />`

## 🎨 Customization Guide

### Change Colors

Edit `tailwind.config.ts`:

```typescript
colors: {
  primary: {
    50: '#fef7ee',   // Lightest shade
    600: '#e15710',  // Main color
    700: '#ba4010',  // Darker shade
  }
}
```

### Update Contact Information

Edit `components/sections/CTA.tsx`:
- Change email address
- Update phone number
- Modify location

### Modify Text Content

All content is in the section components:
- Hero: `components/sections/Hero.tsx`
- About: `components/sections/About.tsx`
- Services: `components/sections/WhatIDo.tsx`
- Values: `components/sections/CoreValues.tsx`
- etc.

## 🚀 Deployment Options

### Option 1: Vercel (Easiest - Recommended)

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Click "Deploy" - Done! ✅

Your site will be live at `your-project.vercel.app`

### Option 2: Netlify

1. Build your project: `npm run build`
2. Go to [netlify.com](https://netlify.com)
3. Drag and drop the `.next` folder
4. Done! ✅

### Option 3: Custom Domain

After deploying to Vercel/Netlify:
1. Go to project settings
2. Add your custom domain
3. Update DNS settings as instructed

## 📱 Responsive Design

The website automatically adapts to:
- Mobile phones (320px+)
- Tablets (768px+)
- Desktops (1024px+)
- Large screens (1920px+)

## 🔧 Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm start        # Run production server
npm run lint     # Check code quality
```

## 💡 Pro Tips

### Performance
- Use Next.js Image component for all images (automatic optimization)
- Images are automatically converted to WebP/AVIF
- Lazy loading is built-in

### SEO
- Update metadata in `app/layout.tsx`
- Add your actual domain in Open Graph tags
- Submit sitemap to Google Search Console after deployment

### Content Updates
- Edit content directly in the component files
- Changes appear instantly in development mode
- Rebuild for production after major changes

## 📋 Checklist Before Going Live

- [ ] Replace placeholder images with real photos
- [ ] Update contact information (email, phone, location)
- [ ] Verify all links work
- [ ] Test on mobile device
- [ ] Update metadata for SEO
- [ ] Add Google Analytics (optional)
- [ ] Test contact form (if added)
- [ ] Check loading speed
- [ ] Verify responsive design

## 🆘 Common Issues

### Port Already in Use
```bash
# Use a different port
npm run dev -- -p 3001
```

### Build Errors
```bash
# Clear cache and rebuild
rm -rf .next
npm run build
```

### Styling Not Showing
```bash
# Restart development server
# Press Ctrl+C, then run npm run dev again
```

## 📞 Need Help?

If you encounter any issues:
1. Check the README.md for detailed documentation
2. Review the component files for inline comments
3. Consult Next.js documentation at [nextjs.org](https://nextjs.org)

## 🎉 You're All Set!

Your website is ready to go live. Follow the deployment steps and share your transformation journey with the world!

---

**Built with:** Next.js 14 • TypeScript • Tailwind CSS • Lucide Icons
