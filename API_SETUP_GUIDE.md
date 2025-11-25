# API Setup Guide

This guide explains how to set up the REST API with API key authentication.

## Prerequisites

- Supabase project with database access
- Node.js installed (for generating API keys)

## Step 1: Create the API Keys Table

1. Open your Supabase dashboard
2. Go to SQL Editor
3. Run the SQL script from `create-api-keys-table.sql`

This will create the `api_keys` table with the necessary structure and security policies.

## Step 2: Generate and Insert API Keys

### Option A: Using the Helper Script (Recommended)

1. Run the helper script to generate an API key:

```bash
node generate-api-key.js <user-id> "My API Key Name"
```

Example:
```bash
node generate-api-key.js 123e4567-e89b-12d3-a456-426614174000 "Production API Key"
```

2. The script will output:
   - A secure API key
   - An SQL INSERT statement

3. Copy the SQL statement and run it in your Supabase SQL editor

### Option B: Manual Generation

1. Generate a secure API key (64 characters):
   - Use `crypto.randomBytes(32).toString('hex')` in Node.js
   - Or use an online UUID/random string generator

2. Insert the API key into the database:

```sql
INSERT INTO api_keys (user_id, api_key, name, is_active)
VALUES (
  'user-uuid-here',
  'your-generated-api-key-here',
  'My API Key',
  true
);
```

## Step 3: Verify API Key

You can verify that your API key was created correctly:

```sql
SELECT id, user_id, name, is_active, created_at, last_used_at
FROM api_keys
WHERE user_id = 'your-user-id';
```

## Step 4: Test the API

Test your API key with a simple request:

```bash
curl -X GET https://your-api-domain.com/health \
  -H "X-API-Key: your-api-key-here"
```

Or test with a real endpoint:

```bash
curl -X POST https://your-api-domain.com/api/v1/mailboxes/assign \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "mailboxes": [{
      "firstName": "Test",
      "lastName": "User",
      "username": "testuser",
      "domain": "yourdomain.com"
    }]
  }'
```

## Managing API Keys

### List All API Keys for a User

```sql
SELECT id, name, is_active, created_at, last_used_at
FROM api_keys
WHERE user_id = 'user-uuid-here'
ORDER BY created_at DESC;
```

### Deactivate an API Key

```sql
UPDATE api_keys
SET is_active = false
WHERE id = 'api-key-id-here';
```

### Reactivate an API Key

```sql
UPDATE api_keys
SET is_active = true
WHERE id = 'api-key-id-here';
```

### Delete an API Key

```sql
DELETE FROM api_keys
WHERE id = 'api-key-id-here';
```

## Security Best Practices

1. **Generate Strong Keys**: Always use cryptographically secure random generators
2. **Store Securely**: Never commit API keys to version control
3. **Use Environment Variables**: Store API keys in environment variables in production
4. **Rotate Regularly**: Periodically generate new keys and deactivate old ones
5. **Monitor Usage**: Check `last_used_at` to monitor API key activity
6. **Limit Scope**: Consider adding rate limiting or IP restrictions if needed

## Troubleshooting

### API Key Not Working

1. Check that the API key exists:
   ```sql
   SELECT * FROM api_keys WHERE api_key = 'your-key-here';
   ```

2. Verify it's active:
   ```sql
   SELECT is_active FROM api_keys WHERE api_key = 'your-key-here';
   ```

3. Check the user_id is correct:
   ```sql
   SELECT user_id FROM api_keys WHERE api_key = 'your-key-here';
   ```

### Getting 401 Unauthorized

- Verify the API key is correct (no extra spaces)
- Check the header name: `X-API-Key` or `Authorization: Bearer <key>`
- Ensure the API key is active (`is_active = true`)
- Verify the user_id exists in the users table

### Getting 403 Forbidden

- The API key is valid but the user doesn't have permission
- Check that the resource (domain, mailbox) belongs to the user associated with the API key

## Next Steps

- Read the [API Documentation](./API_DOCUMENTATION.md) for endpoint details
- Test all endpoints with your API key
- Implement rate limiting if needed
- Set up monitoring and logging

