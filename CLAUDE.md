# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a digital privacy control platform called PrivacyGuard that helps users discover, extract data from, and delete accounts across 200+ online platforms. The main application is located in the `privacyguard/` directory.

## Development Commands

All development should be done within the `privacyguard/` directory:

```bash
cd privacyguard/
```

### Common Commands
- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon for hot reloading
- `npm test` - Run Jest test suite
- `npm run lint` - Run ESLint on src/ directory
- `npm run setup` - Install dependencies and create required directories (logs, archives)
- `npm run migrate` - Run database migrations
- `npm run seed` - Seed database with initial data

### Running Tests
- Run all tests: `npm test`
- Run with watch mode (development): `npm test -- --watch`

## Architecture Overview

The application follows a microservices-oriented architecture with these core components:

### Directory Structure
```
privacyguard/src/
├── discovery/         # Account discovery engines (email, username, social graph)
├── extraction/        # Data extraction services (API, GDPR, scraping)
├── deletion/          # Account deletion automation with platform strategies
├── archive/           # Personal encrypted data archive system
├── monitoring/        # Privacy monitoring and breach detection
├── legal/            # Legal compliance engines (GDPR, CCPA)
├── models/           # MongoDB models (User, Account, Archive)
├── routes/           # Express API routes
├── middleware/       # Authentication and other middleware
└── utils/            # Shared utilities and logging
```

### Core Engines
1. **Account Discovery Engine** - Multi-vector account detection using email enumeration, social graph analysis, and breach correlation
2. **Data Extraction Engine** - Three-tier extraction: official APIs → GDPR requests → web scraping
3. **Account Deletion Engine** - Platform-specific deletion strategies with verification
4. **Personal Archive System** - Encrypted storage with timeline reconstruction
5. **Privacy Monitoring System** - Continuous scanning for breaches and new exposures
6. **Legal Compliance Engine** - Automated GDPR/CCPA enforcement

### Technology Stack
- **Backend**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Browser Automation**: Puppeteer for web scraping and account interaction
- **Security**: bcrypt, JWT tokens, AES-256 encryption
- **Testing**: Jest with Supertest for API testing
- **Process Management**: PM2 for production deployment

## Environment Setup

Copy `.env.example` to `.env` and configure:
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing secret
- `ENCRYPTION_KEY` - 32-character key for data encryption
- SMTP settings for email notifications
- Cloud storage credentials (AWS S3 or Google Cloud)
- API keys for external services (Stripe, HaveIBeenPwned)

## Database

The application uses MongoDB with these primary collections:
- **Users** - User accounts with subscription tiers and privacy settings
- **Accounts** - Discovered platform accounts with extraction/deletion status
- **Archives** - Encrypted personal data archives with search indexing

## Key Development Patterns

### Platform Adapters
Each supported platform implements the `PlatformAdapter` interface:
```javascript
interface PlatformAdapter {
  hasOfficialAPI(): boolean;
  authenticate(credentials): Session;
  extractDataType(session, dataType): any;
  executeDeletion(account): DeletionResult;
  verifyDeletion(account): VerificationResult;
}
```

### Error Handling
- All async operations use try/catch with proper error logging
- Winston logger available at `src/utils/logger.js`
- Errors include user-safe messages for production

### Security Considerations
- All personal data is encrypted using user-specific keys
- Platform credentials are encrypted before storage
- Rate limiting applied to all API endpoints
- CORS and security headers configured

## Deployment

The application is configured for deployment on Vercel with the included `vercel.json`. For production deployment:
1. Ensure MongoDB is accessible
2. Configure all environment variables
3. Run `npm run setup` to create required directories
4. Use PM2 for process management in production

## Browser Automation

Puppeteer is used extensively for:
- Account discovery through password reset flows
- Data extraction when APIs aren't available
- Account deletion automation
- Screenshot capture for deletion verification

Chrome/Chromium must be available in the deployment environment.