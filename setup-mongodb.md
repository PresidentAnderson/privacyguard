# MongoDB Setup for Collections System

## 1. Create MongoDB Atlas Account

1. Go to https://cloud.mongodb.com
2. Sign up or log in
3. Create a new project: "PVT Hostel Collections"

## 2. Create Cluster

1. Choose "Build a Database"
2. Select "M0 Sandbox" (Free tier)
3. Choose region closest to your users
4. Cluster Name: "collections-cluster"

## 3. Create Database User

1. Go to "Database Access" 
2. Add new database user:
   - Username: `collections_user`
   - Password: Generate secure password
   - Database User Privileges: "Read and write to any database"

## 4. Configure Network Access

1. Go to "Network Access"
2. Add IP Address: `0.0.0.0/0` (Allow access from anywhere)
   - For production, restrict to specific IPs

## 5. Get Connection String

1. Go to "Databases" 
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Copy the connection string
5. Replace `<password>` with your database user password

## 6. Database Schema

The system will create these collections:
- `customers` - Customer information
- `paymentattempts` - Payment retry records  
- `accounts` - Privacy Guard discovered accounts
- `users` - System users

## 7. Add to Vercel Environment Variables

In your Vercel dashboard:
```
MONGODB_URI=mongodb+srv://collections_user:<password>@collections-cluster.xxxxx.mongodb.net/
MONGODB_DB_NAME=collections_pvthostel
```

## 8. Test Connection

Run this command to test:
```bash
node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient('your-connection-string');
client.connect().then(() => {
  console.log('✅ MongoDB connected successfully');
  client.close();
}).catch(err => {
  console.error('❌ MongoDB connection failed:', err);
});
"
```