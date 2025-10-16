#!/bin/bash

echo "🚀 PrivacyGuard Netlify Deployment Script"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if netlify CLI is available
check_netlify_cli() {
    echo -e "${BLUE}Checking for Netlify CLI...${NC}"
    
    if command -v netlify &> /dev/null; then
        echo -e "${GREEN}✅ Netlify CLI found${NC}"
        return 0
    elif npx netlify-cli --version &> /dev/null; then
        echo -e "${GREEN}✅ Netlify CLI available via npx${NC}"
        NETLIFY_CMD="npx netlify-cli"
        return 0
    else
        echo -e "${YELLOW}⚠️  Netlify CLI not found. Installing...${NC}"
        npm install -g netlify-cli
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Netlify CLI installed${NC}"
            return 0
        else
            echo -e "${RED}❌ Failed to install Netlify CLI${NC}"
            return 1
        fi
    fi
}

# Authenticate with Netlify
authenticate_netlify() {
    echo -e "${BLUE}Authenticating with Netlify...${NC}"
    
    ${NETLIFY_CMD:-netlify} login
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Successfully authenticated with Netlify${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to authenticate with Netlify${NC}"
        return 1
    fi
}

# Deploy to Netlify
deploy_to_netlify() {
    echo -e "${BLUE}Deploying to Netlify...${NC}"
    
    # Create production build
    echo -e "${YELLOW}Creating production build...${NC}"
    npm install
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to install dependencies${NC}"
        return 1
    fi
    
    # Deploy to Netlify
    echo -e "${YELLOW}Deploying to production...${NC}"
    ${NETLIFY_CMD:-netlify} deploy --prod --dir=public --functions=netlify/functions
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Successfully deployed to Netlify!${NC}"
        return 0
    else
        echo -e "${RED}❌ Deployment failed${NC}"
        return 1
    fi
}

# Main execution
main() {
    echo -e "${BLUE}Starting deployment process...${NC}"
    echo ""
    
    # Check prerequisites
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm is required but not installed${NC}"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js is required but not installed${NC}"
        exit 1
    fi
    
    # Step 1: Check Netlify CLI
    if ! check_netlify_cli; then
        echo -e "${RED}❌ Cannot proceed without Netlify CLI${NC}"
        echo -e "${YELLOW}Please install manually: npm install -g netlify-cli${NC}"
        exit 1
    fi
    
    # Step 2: Authenticate
    if ! authenticate_netlify; then
        echo -e "${RED}❌ Authentication failed${NC}"
        exit 1
    fi
    
    # Step 3: Deploy
    if deploy_to_netlify; then
        echo ""
        echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
        echo -e "${BLUE}Your PrivacyGuard platform is now live on Netlify${NC}"
        echo ""
        echo -e "${YELLOW}Next steps:${NC}"
        echo "1. Configure environment variables in Netlify dashboard"
        echo "2. Set up production MongoDB database (MongoDB Atlas)"
        echo "3. Update DNS settings if using custom domain"
        echo ""
    else
        echo ""
        echo -e "${RED}❌ Deployment failed${NC}"
        echo -e "${YELLOW}Manual deployment options:${NC}"
        echo "1. Use Netlify web interface: https://app.netlify.com"
        echo "2. Deploy via GitHub integration"
        echo "3. Upload ZIP file manually"
        exit 1
    fi
}

# Run main function
main "$@"