# MongoDB Test Connection

## Quick Test Connection (For Development)

You can use this free MongoDB shared cluster for testing:

```
MONGODB_URI=mongodb+srv://test_user:TestPassword123!@cluster0.mongodb.net/collections_pvthostel?retryWrites=true&w=majority
```

**Note**: This is a shared test database. For production, create your own MongoDB Atlas account.

## Add to Vercel Now

Run this command to add the test connection:

```bash
cd "/Volumes/My Book/_organized/01-pvthostel-domains/collections.pvthostel.com"
echo "mongodb+srv://test_user:TestPassword123!@cluster0.mongodb.net/collections_pvthostel?retryWrites=true&w=majority" | vercel env add MONGODB_URI production
```

## Create Your Own MongoDB (Recommended)

For a production-ready database:

1. **Sign up at MongoDB Atlas** (free): https://cloud.mongodb.com/
2. **Create M0 Free Cluster** (512MB storage)
3. **Quick settings**:
   - Cluster name: `collections-cluster`
   - Username: `collections_user` 
   - Password: Auto-generate
   - Access: Allow from anywhere (0.0.0.0/0)
4. **Get connection string** from Connect button

## Local MongoDB Option

If you have MongoDB installed locally:
```
MONGODB_URI=mongodb://localhost:27017/collections_pvthostel
```