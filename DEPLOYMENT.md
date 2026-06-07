# Deployment Guide

Complete guide to deploying your Bisher KC website to various platforms.

## 🚀 Vercel Deployment (Recommended)

Vercel is the easiest and most optimized platform for Next.js applications.

### Step-by-Step Guide

#### 1. Prepare Your Code

```bash
# Make sure your code is in a Git repository
git init
git add .
git commit -m "Initial commit"
```

#### 2. Push to GitHub

```bash
# Create a new repository on GitHub, then:
git remote add origin https://github.com/yourusername/bisher-kc-website.git
git branch -M main
git push -u origin main
```

#### 3. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Sign up/Login with GitHub
3. Click "New Project"
4. Import your `bisher-kc-website` repository
5. Configure:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `./`
   - Build Command: `npm run build`
   - Output Directory: `.next`
6. Click **Deploy**

#### 4. Wait for Deployment

- Initial deployment takes 1-2 minutes
- You'll get a URL like: `bisher-kc-website.vercel.app`

#### 5. Add Custom Domain (Optional)

1. Go to Project Settings → Domains
2. Add your domain (e.g., `bisherkc.com`)
3. Update DNS records as instructed
4. Wait for DNS propagation (5-10 minutes)

### Automatic Deployments

Every push to `main` branch automatically deploys:
```bash
git add .
git commit -m "Update content"
git push
```

---

## 🌐 Netlify Deployment

Alternative to Vercel with similar features.

### Deploy via Git

1. Push code to GitHub (same as above)
2. Go to [netlify.com](https://netlify.com)
3. Click "Add new site" → "Import an existing project"
4. Connect to GitHub
5. Select your repository
6. Configure:
   - Build command: `npm run build`
   - Publish directory: `.next`
   - Node version: `18`
7. Click **Deploy**

### Deploy via Drag & Drop

1. Build locally:
   ```bash
   npm run build
   ```
2. Go to [netlify.com/drop](https://app.netlify.com/drop)
3. Drag the `.next` folder
4. Done!

---

## ☁️ AWS Amplify

For those using AWS ecosystem.

### Steps

1. Push code to GitHub
2. Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify)
3. Click "New app" → "Host web app"
4. Connect repository
5. Configure build settings:
   ```yaml
   version: 1
   frontend:
     phases:
       preBuild:
         commands:
           - npm ci
       build:
         commands:
           - npm run build
     artifacts:
       baseDirectory: .next
       files:
         - '**/*'
     cache:
       paths:
         - node_modules/**/*
   ```
6. Deploy

---

## 🐳 Docker Deployment

For containerized deployments.

### Create Dockerfile

```dockerfile
FROM node:18-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

### Build and Run

```bash
docker build -t bisher-kc-website .
docker run -p 3000:3000 bisher-kc-website
```

---

## 🔧 Environment Variables

If you add API keys or secrets later:

### Vercel
1. Project Settings → Environment Variables
2. Add variables (e.g., `NEXT_PUBLIC_API_KEY`)
3. Redeploy

### Netlify
1. Site Settings → Environment Variables
2. Add variables
3. Trigger new deploy

### Local Development
Create `.env.local`:
```bash
NEXT_PUBLIC_API_KEY=your-key-here
```

---

## 📊 Performance Monitoring

### Vercel Analytics

1. Project Settings → Analytics
2. Enable Analytics
3. View real-time metrics

### Google Analytics

Add to `app/layout.tsx`:

```tsx
import Script from 'next/script'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-XXXXXXXXXX');
          `}
        </Script>
      </body>
    </html>
  )
}
```

---

## 🔒 Security Best Practices

### Headers Configuration

Create `next.config.js`:

```javascript
module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          }
        ]
      }
    ]
  }
}
```

---

## 🌍 Custom Domain Setup

### 1. Buy Domain
- Namecheap
- GoDaddy
- Google Domains

### 2. Configure DNS

For Vercel:
```
A Record: @ → 76.76.21.21
CNAME: www → cname.vercel-dns.com
```

For Netlify:
```
A Record: @ → 75.2.60.5
CNAME: www → your-site.netlify.app
```

### 3. SSL Certificate
- Automatic with Vercel/Netlify
- Free Let's Encrypt certificate
- Usually takes 5-10 minutes

---

## 📱 Testing Before Deploy

```bash
# Test production build locally
npm run build
npm start

# Check for errors
npm run lint

# Test on different devices
# Use Chrome DevTools → Device Mode
```

---

## 🚨 Troubleshooting

### Build Fails

```bash
# Clear cache
rm -rf .next node_modules
npm install
npm run build
```

### Images Not Loading

Ensure images are in `/public` folder and paths start with `/`:
```tsx
<Image src="/image.jpg" ... />
```

### 404 Errors

Check `app/page.tsx` exists and exports default component.

### Slow Performance

1. Optimize images (use Next.js Image)
2. Enable caching
3. Use CDN (automatic with Vercel/Netlify)

---

## ✅ Post-Deployment Checklist

- [ ] Website loads correctly
- [ ] All links work
- [ ] Images display properly
- [ ] Responsive on mobile
- [ ] Contact information is correct
- [ ] SSL certificate active (https://)
- [ ] Custom domain configured (if applicable)
- [ ] Analytics tracking works
- [ ] SEO meta tags present
- [ ] Test on multiple browsers
- [ ] Page load speed < 3 seconds
- [ ] No console errors

---

## 📈 Going Further

### Add Features
- Contact form with Formspree/EmailJS
- Blog with MDX
- Testimonials section
- Gallery/Portfolio
- Newsletter signup

### Optimize
- Implement ISR (Incremental Static Regeneration)
- Add PWA support
- Enable image optimization
- Set up CDN

---

## 🎉 Congratulations!

Your website is now live and accessible worldwide. Share your URL and start making an impact!

For updates and maintenance:
```bash
git pull
# Make changes
git add .
git commit -m "Description of changes"
git push
# Automatic deployment will happen
```

**Need help?** Check the README.md or Next.js documentation.


 