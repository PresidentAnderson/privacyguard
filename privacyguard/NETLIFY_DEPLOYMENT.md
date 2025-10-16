# Netlify Deployment Guide for PrivacyGuard

## Automatic Deployment via GitHub Integration

Since the Netlify CLI is having installation issues, here's how to deploy via the Netlify web interface:

### Step 1: Connect to Netlify
1. Go to [netlify.com](https://netlify.com) and sign in
2. Click "New site from Git"
3. Choose GitHub as your Git provider
4. Select the `PresidentAnderson/privacyguard` repository

### Step 2: Configure Build Settings
Use these build settings in the Netlify dashboard:

- **Build command**: `npm install`
- **Publish directory**: `public`
- **Functions directory**: `netlify/functions`

### Step 3: Environment Variables
Add these environment variables in Netlify dashboard under Site Settings > Environment Variables:

```
NODE_ENV=production
MONGODB_URI=your-mongodb-atlas-connection-string
JWT_SECRET=your-production-jwt-secret
ENCRYPTION_KEY=your-32-character-production-key
```

### Step 4: Deploy
Click "Deploy site" and Netlify will:
1. Build your project
2. Deploy static files to CDN
3. Deploy API functions to Netlify Functions
4. Provide you with a live URL

## Configuration Files Created

### netlify.toml
- Configures build settings and redirects
- Routes all API calls to Netlify Functions
- Sets up proper Node.js environment

### netlify/functions/api.js
- Serverless wrapper for Express app
- Uses `serverless-http` to adapt Express for Netlify Functions

### public/index.html
- Frontend interface for the PrivacyGuard platform
- Provides links to API endpoints and dashboard

## Expected Result
Your PrivacyGuard platform will be available at:
- Frontend: `https://your-app-name.netlify.app`
- API: `https://your-app-name.netlify.app/api/*`

## Production Notes
- MongoDB Atlas is recommended for production database
- Configure all environment variables in Netlify dashboard
- API functions have a 10-second timeout limit on Netlify free tier
- Consider upgrading to Pro for longer function execution times