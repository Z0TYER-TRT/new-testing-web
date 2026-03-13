#!/bin/bash

# ============================================================
# 🛡️ Security Setup Script - Generate Secure Secrets
# ============================================================

echo "🔐 Generating secure configuration..."

# Check if .env exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists!"
    read -p "Overwrite? (y/N): " choice
    if [[ "$choice" != "y" && "$choice" != "Y" ]]; then
        echo "❌ Aborted"
        exit 1
    fi
fi

# Copy example
cp .env.example .env

# Generate API Secret Key
echo ""
echo "🔑 Generating API_SECRET_KEY..."
api_key=$(openssl rand -base64 64 | tr -d "=+/" | cut -c1-64)
sed -i "s/API_SECRET_KEY=your_min_32_char_secret_key_here_CHANGE_THIS/API_SECRET_KEY=$api_key/" .env

echo ""
echo "============================================="
echo "✅ .env file generated!"
echo "============================================="
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. Open .env file:"
echo "   nano .env"
echo ""
echo "2. Add your MongoDB credentials:"
echo "   MONGODB_SHARD_0=mongodb+srv://user:pass@cluster0..."
echo "   MONGODB_SHARD_1=mongodb+srv://user:pass@cluster1..."
echo "   MONGODB_SHARD_2=mongodb+srv://user:pass@cluster2..."
echo ""
echo "3. Add Cloudflare Turnstile (FREE - Recommended):"
echo "   Visit: https://dash.cloudflare.com/?to=/:account/turnstile"
echo "   Add domain: redirect-kawaii.vercel.app"
echo "   Copy keys to .env:"
echo "   TURNSTILE_SITE_KEY=0x4AAAAAAA..."
echo "   TURNSTILE_SECRET_KEY=0x4AAAAA..."
echo ""
echo "4. Protect .env file:"
echo "   echo '.env' >> .gitignore"
echo ""
echo "5. Start server:"
echo "   npm start"
echo ""
echo "============================================="
echo "📚 For detailed setup, see: FREE_SECURITY_SETUP.md"
echo "============================================="
