# REST API Documentation

This document describes the REST API endpoints for purchasing domains, purchasing mailboxes, assigning mailboxes, and deleting mailboxes.

## Authentication

All API endpoints require API key authentication. Include your API key in one of the following ways:

1. **Header**: `X-API-Key: your-api-key-here`
2. **Authorization Header**: `Authorization: Bearer your-api-key-here`

### Setting Up API Keys

1. Run the SQL script `create-api-keys-table.sql` in your Supabase SQL editor to create the `api_keys` table.

2. Manually insert API keys into the `api_keys` table:

```sql
INSERT INTO api_keys (user_id, api_key, name, is_active)
VALUES (
  'user-uuid-here',
  'your-secret-api-key-here',
  'My API Key',
  true
);
```

**Important**: Generate secure API keys (e.g., using `crypto.randomBytes(32).toString('hex')` or a UUID v4).

## Base URL

```
https://your-api-domain.com/api/v1
```

## Endpoints

### 1. Purchase Domains

Purchase one or more domains with billing details.

**Endpoint**: `POST /api/v1/domains/purchase`

**Request Body**:
```json
{
  "domains": [
    {
      "domain": "example.com",
      "year": "1",
      "price": 1299
    },
    {
      "domain": "example2.com",
      "year": "1",
      "price": 1299
    }
  ],
  "billing": {
    "payment_method_id": "pm_1234567890abcdef"
  }
}
```

**Response** (Success - 200):
```json
{
  "success": true,
  "message": "Domain purchase processed",
  "payment_intent_id": "pi_1234567890",
  "purchased_domains": ["example.com", "example2.com"],
  "failed_domains": []
}
```

**Response** (Error - 400/500):
```json
{
  "error": "Validation Error",
  "message": "domains array is required and must not be empty"
}
```

**Notes**:
- `price` is in cents (e.g., 1299 = $12.99)
- `payment_method_id` is a Stripe Payment Method ID. You need to create this on the frontend using Stripe.js
- Each domain must have `domain`, `year`, and `price` fields

---

### 2. Purchase Mailboxes

Purchase mailbox add-ons with billing details.

**Endpoint**: `POST /api/v1/mailboxes/purchase`

**Request Body**:
```json
{
  "numberOfMailboxes": 10,
  "billing": {
    "payment_method_id": "pm_1234567890abcdef"
  }
}
```

**Response** (Success - 200):
```json
{
  "success": true,
  "message": "Mailbox purchase successful",
  "subscription_id": "api_mb_12345678-1234-1234-1234-123456789012",
  "subscription_stripe_id": "sub_1234567890",
  "numberOfMailboxes": 10,
  "renewsOn": "2024-02-15T10:30:00.000Z"
}
```

**Response** (Error - 400/500):
```json
{
  "error": "Validation Error",
  "message": "numberOfMailboxes must be a positive number"
}
```

**Notes**:
- Pricing is automatically calculated based on user-specific pricing, plan pricing, or default pricing
- `payment_method_id` is a Stripe Payment Method ID

---

### 3. Assign Mailboxes

Assign mailboxes to domains.

**Endpoint**: `POST /api/v1/mailboxes/assign`

**Request Body**:
```json
{
  "mailboxes": [
    {
      "firstName": "John",
      "lastName": "Doe",
      "username": "johndoe",
      "domain": "example.com",
      "recoveryEmail": "recovery@example.com"
    },
    {
      "firstName": "Jane",
      "lastName": "Smith",
      "username": "janesmith",
      "domain": "example.com"
    }
  ]
}
```

**Response** (Success - 200):
```json
{
  "success": true,
  "message": "Mailboxes assigned successfully",
  "count": 2
}
```

**Response** (Error - 400/403/404/500):
```json
{
  "error": "Domain Not Found",
  "message": "Domain example.com not found or does not belong to your account"
}
```

**Notes**:
- All domains must belong to the authenticated user's account
- User must have an active mailbox subscription with available slots
- `recoveryEmail` is optional
- Username will be automatically cleaned (spaces removed, @ symbol handled)

---

### 4. Delete Mailboxes

Delete one or more mailboxes.

**Endpoint**: `DELETE /api/v1/mailboxes/:mailboxId`

**OR**

**Endpoint**: `POST /api/v1/mailboxes/delete`

**Request Body** (for POST method):
```json
{
  "mailboxIds": ["mailbox-id-1", "mailbox-id-2"]
}
```

**Response** (Success - 200):
```json
{
  "success": true,
  "message": "Mailboxes deleted successfully",
  "count": 2
}
```

**Response** (Error - 400/403/404/500):
```json
{
  "error": "Mailbox Not Found",
  "message": "Mailbox mailbox-id-1 not found"
}
```

**Notes**:
- Mailboxes are marked as "Scheduled for Deletion" (not immediately deleted)
- You can only delete mailboxes that belong to domains in your account
- Use the mailbox ID (not email) to identify mailboxes

---

## Error Handling

All endpoints return consistent error responses:

### Error Response Format
```json
{
  "error": "Error Type",
  "message": "Human-readable error message"
}
```

### Common HTTP Status Codes

- `200` - Success
- `400` - Bad Request (validation errors, missing required fields)
- `401` - Unauthorized (invalid or missing API key)
- `403` - Forbidden (resource doesn't belong to user, subscription issues)
- `404` - Not Found (domain, mailbox, or user not found)
- `500` - Internal Server Error

### Error Types

- `Validation Error` - Invalid input data
- `Unauthorized` - API key issues
- `Payment Failed` - Stripe payment issues
- `Domain Not Found` - Domain doesn't exist or doesn't belong to user
- `Mailbox Not Found` - Mailbox doesn't exist
- `No Active Subscription` - User doesn't have active mailbox subscription
- `Subscription Full` - All subscriptions are fully used
- `Forbidden` - Access denied
- `Internal Server Error` - Server-side errors

---

## Getting Payment Method ID

To get a `payment_method_id` for billing, you need to use Stripe.js on your frontend:

```javascript
// Example using Stripe.js
const stripe = Stripe('your-publishable-key');
const elements = stripe.elements();
const cardElement = elements.create('card');

// When submitting payment
const { paymentMethod, error } = await stripe.createPaymentMethod({
  type: 'card',
  card: cardElement,
});

if (error) {
  console.error(error);
} else {
  // Use paymentMethod.id as payment_method_id
  console.log(paymentMethod.id);
}
```

---

## Security Notes

1. **API Keys**: Keep your API keys secure. Never expose them in client-side code or public repositories.
2. **HTTPS**: Always use HTTPS in production.
3. **Rate Limiting**: Consider implementing rate limiting for API endpoints.
4. **Validation**: All user inputs are validated server-side. Never trust client-side validation alone.

---

## Example Usage

### cURL Example

```bash
# Purchase domains
curl -X POST https://your-api-domain.com/api/v1/domains/purchase \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "domains": [{"domain": "example.com", "year": "1", "price": 1299}],
    "billing": {"payment_method_id": "pm_1234567890"}
  }'

# Assign mailboxes
curl -X POST https://your-api-domain.com/api/v1/mailboxes/assign \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "mailboxes": [{
      "firstName": "John",
      "lastName": "Doe",
      "username": "johndoe",
      "domain": "example.com"
    }]
  }'
```

### JavaScript Example

```javascript
const API_KEY = 'your-api-key-here';
const BASE_URL = 'https://your-api-domain.com/api/v1';

// Purchase mailboxes
async function purchaseMailboxes(numberOfMailboxes, paymentMethodId) {
  const response = await fetch(`${BASE_URL}/mailboxes/purchase`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      numberOfMailboxes,
      billing: { payment_method_id: paymentMethodId }
    })
  });
  
  return await response.json();
}

// Assign mailboxes
async function assignMailboxes(mailboxes) {
  const response = await fetch(`${BASE_URL}/mailboxes/assign`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ mailboxes })
  });
  
  return await response.json();
}
```

---

## Support

For issues or questions, contact support or check the main application documentation.

