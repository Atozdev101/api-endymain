# REST API Implementation Summary

## Overview

This implementation adds REST API endpoints with API key authentication for:
- Purchasing domains
- Purchasing mailboxes
- Assigning mailboxes
- Deleting mailboxes

All endpoints include billing details support via Stripe Payment Methods and comprehensive error handling.

## Files Created/Modified

### New Files

1. **`create-api-keys-table.sql`**
   - SQL script to create the `api_keys` table in Supabase
   - Includes RLS policies for security

2. **`middlewares/apiKeyMiddleware.js`**
   - Middleware to authenticate requests using API keys
   - Validates API key from `X-API-Key` header or `Authorization: Bearer <key>`
   - Attaches user to request (similar to existing `authMiddleware`)

3. **`controllers/apiController.js`**
   - New controller with 4 main functions:
     - `purchaseDomains` - Purchase domains with Stripe payment
     - `purchaseMailboxes` - Purchase mailbox subscriptions with Stripe payment
     - `assignMailboxes` - Assign mailboxes to domains
     - `deleteMailboxes` - Delete mailboxes (single or bulk)

4. **`routes/apiRoutes.js`**
   - REST API routes mounted at `/api/v1`
   - All routes protected by `apiKeyMiddleware`

5. **`generate-api-key.js`**
   - Helper script to generate secure API keys
   - Outputs SQL INSERT statement for easy setup

6. **`API_DOCUMENTATION.md`**
   - Complete API documentation
   - Request/response examples
   - Error handling guide

7. **`API_SETUP_GUIDE.md`**
   - Step-by-step setup instructions
   - API key management guide
   - Troubleshooting tips

### Modified Files

1. **`index.js`**
   - Added `/api/v1` route mounting for new API endpoints
   - Existing routes remain unchanged

## API Endpoints

All endpoints are available at `/api/v1/`:

1. **POST `/api/v1/domains/purchase`**
   - Purchase domains with billing details
   - Requires: `domains` array and `billing.payment_method_id`

2. **POST `/api/v1/mailboxes/purchase`**
   - Purchase mailbox subscriptions with billing details
   - Requires: `numberOfMailboxes` and `billing.payment_method_id`

3. **POST `/api/v1/mailboxes/assign`**
   - Assign mailboxes to domains
   - Requires: `mailboxes` array with mailbox details

4. **DELETE `/api/v1/mailboxes/:mailboxId`** or **POST `/api/v1/mailboxes/delete`**
   - Delete mailboxes (single or bulk)
   - Requires: mailbox ID(s)

## Key Features

### Security
- ✅ API key authentication via middleware
- ✅ User isolation (users can only access their own resources)
- ✅ Secure API key storage in Supabase
- ✅ API key activity tracking (`last_used_at`)

### Error Handling
- ✅ Comprehensive validation for all inputs
- ✅ Consistent error response format
- ✅ Proper HTTP status codes
- ✅ Detailed error messages
- ✅ Stripe payment error handling
- ✅ Database error handling

### Billing Integration
- ✅ Stripe Payment Method support
- ✅ Automatic customer creation
- ✅ Payment method attachment
- ✅ Payment intent confirmation
- ✅ 3D Secure handling
- ✅ Transaction recording

### User Isolation
- ✅ All operations verify resource ownership
- ✅ Domains must belong to the authenticated user
- ✅ Mailboxes must belong to user's domains
- ✅ Subscriptions must belong to the authenticated user

## Database Schema

### `api_keys` Table

```sql
- id (UUID, Primary Key)
- user_id (UUID, Foreign Key to users)
- api_key (TEXT, Unique)
- name (TEXT, Optional)
- created_at (TIMESTAMP)
- last_used_at (TIMESTAMP)
- is_active (BOOLEAN)
```

## Setup Steps

1. **Create the API keys table:**
   ```bash
   # Run create-api-keys-table.sql in Supabase SQL editor
   ```

2. **Generate API keys:**
   ```bash
   node generate-api-key.js <user-id> "Key Name"
   # Then run the generated SQL in Supabase
   ```

3. **Test the API:**
   ```bash
   curl -X POST https://your-api/api/v1/mailboxes/assign \
     -H "X-API-Key: your-key" \
     -H "Content-Type: application/json" \
     -d '{"mailboxes": [...]}'
   ```

## Backward Compatibility

✅ **All existing functionality is preserved:**
- Existing routes (`/api/users`, `/api/domains`, etc.) remain unchanged
- Existing authentication (`authMiddleware`) still works
- No breaking changes to existing controllers
- New API routes are separate at `/api/v1`

## Testing Checklist

- [ ] Create API keys table in Supabase
- [ ] Generate and insert an API key
- [ ] Test domain purchase endpoint
- [ ] Test mailbox purchase endpoint
- [ ] Test mailbox assignment endpoint
- [ ] Test mailbox deletion endpoint
- [ ] Verify user isolation (can't access other users' resources)
- [ ] Test error handling (invalid API key, missing fields, etc.)
- [ ] Test Stripe payment flow
- [ ] Verify existing routes still work

## Notes

1. **Payment Method ID**: Clients need to create Payment Methods using Stripe.js on the frontend before calling the API.

2. **3D Secure**: The API handles 3D Secure by returning a `requires_action` status. Clients should handle the authentication flow.

3. **API Key Security**: API keys are stored as plain text in the database. Consider hashing them in the future for additional security.

4. **Rate Limiting**: Consider adding rate limiting middleware for production use.

5. **Logging**: All API operations are logged via Winston logger and Slack notifications.

## Future Enhancements

- [ ] API key hashing for additional security
- [ ] Rate limiting per API key
- [ ] IP whitelisting for API keys
- [ ] API key scopes/permissions
- [ ] Webhook support for async operations
- [ ] API versioning strategy
- [ ] OpenAPI/Swagger documentation

