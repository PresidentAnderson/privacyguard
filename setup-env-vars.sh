#!/bin/bash

echo "🔧 Setting up Vercel Environment Variables"
echo "========================================"
echo ""
echo "This script will help you add the required environment variables to Vercel."
echo ""

# Function to add environment variable
add_env_var() {
    local var_name=$1
    local var_description=$2
    local var_example=$3
    
    echo "📌 $var_name"
    echo "   Description: $var_description"
    echo "   Example: $var_example"
    echo ""
    
    read -p "Enter value for $var_name (or press Enter to skip): " var_value
    
    if [ ! -z "$var_value" ]; then
        echo "Adding $var_name to Vercel..."
        echo "$var_value" | vercel env add "$var_name" production
        echo "✅ $var_name added successfully"
    else
        echo "⏭️  Skipped $var_name"
    fi
    echo ""
}

echo "🚀 Adding environment variables to production..."
echo ""

# MongoDB Configuration
add_env_var "MONGODB_URI" \
    "MongoDB connection string from Atlas" \
    "mongodb+srv://username:password@cluster.mongodb.net/collections"

# Stripe Configuration
add_env_var "STRIPE_SECRET_KEY" \
    "Stripe secret key (starts with sk_)" \
    "sk_live_..."

add_env_var "STRIPE_WEBHOOK_SECRET" \
    "Stripe webhook signing secret" \
    "whsec_..."

# JWT Secret for authentication
add_env_var "JWT_SECRET" \
    "Secret key for JWT tokens (generate a random string)" \
    "your-super-secret-key-here"

echo ""
echo "✅ Environment variables setup complete!"
echo ""
echo "🔄 To apply changes, redeploy your application:"
echo "   vercel --prod"
echo ""
echo "📋 You can view and edit these variables at:"
echo "   https://vercel.com/axaiinovation/collections-pvthostel-com/settings/environment-variables"