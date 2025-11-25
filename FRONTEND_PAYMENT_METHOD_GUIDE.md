# Frontend Payment Method Implementation Guide

## Overview

This guide explains how to implement payment method collection, storage, and usage in your frontend application. Payment methods are stored on Stripe (not in your database) and can be reused for multiple purchases via the REST API.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Backend Endpoints Available](#backend-endpoints-available)
4. [Step-by-Step Implementation](#step-by-step-implementation)
5. [Complete Code Examples](#complete-code-examples)
6. [Using Payment Methods with API](#using-payment-methods-with-api)
7. [Error Handling](#error-handling)
8. [Testing](#testing)

---

## Prerequisites

- Stripe account with API keys
- Stripe Publishable Key (starts with `pk_`)
- Backend API endpoints are deployed and accessible
- User authentication system in place

---

## Installation

### Install Required Packages

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

Or with yarn:

```bash
yarn add @stripe/stripe-js @stripe/react-stripe-js
```

---

## Backend Endpoints Available

The backend now provides these endpoints for payment method management:

### 1. Attach Payment Method
**POST** `/api/payments/attach-payment-method`

**Headers:**
```
Authorization: Bearer <user-token>
Content-Type: application/json
```

**Body:**
```json
{
  "payment_method_id": "pm_1234567890abcdef"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Payment method attached successfully",
  "payment_method_id": "pm_1234567890abcdef",
  "customer_id": "cus_1234567890"
}
```

### 2. Get Saved Payment Methods
**GET** `/api/payments/payment-methods`

**Headers:**
```
Authorization: Bearer <user-token>
```

**Response (200):**
```json
{
  "success": true,
  "payment_methods": [
    {
      "id": "pm_1234567890abcdef",
      "type": "card",
      "card": {
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2025,
        "funding": "credit"
      },
      "billing_details": {
        "name": "John Doe",
        "email": "john@example.com"
      },
      "created": 1234567890
    }
  ]
}
```

### 3. Delete Payment Method
**DELETE** `/api/payments/payment-methods/:payment_method_id`

**Headers:**
```
Authorization: Bearer <user-token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Payment method deleted successfully"
}
```

---

## Step-by-Step Implementation

### Step 1: Initialize Stripe

Create a Stripe configuration file:

**`src/config/stripe.js`**
```javascript
import { loadStripe } from '@stripe/stripe-js';

// Replace with your actual publishable key
const STRIPE_PUBLISHABLE_KEY = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY || 'pk_test_...';

export const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
```

**`.env`** (add to your environment variables):
```
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
```

### Step 2: Create Payment Method Form Component

**`src/components/PaymentMethodForm.jsx`**
```javascript
import React, { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

function PaymentMethodForm({ onSuccess, onError, saveToCustomer = true }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!stripe || !elements) {
      setError('Stripe not loaded');
      setLoading(false);
      return;
    }

    const cardElement = elements.getElement(CardElement);

    try {
      // Step 1: Create payment method
      const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: {
          // Optional: Get from form or user profile
          name: 'Customer Name',
          email: 'customer@example.com',
        },
      });

      if (pmError) {
        setError(pmError.message);
        setLoading(false);
        return;
      }

      // Step 2: Optionally save to customer
      if (saveToCustomer) {
        try {
          const token = localStorage.getItem('authToken'); // Adjust based on your auth system
          
          const response = await fetch('/api/payments/attach-payment-method', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              payment_method_id: paymentMethod.id
            })
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || 'Failed to save payment method');
          }
        } catch (saveError) {
          console.error('Error saving payment method:', saveError);
          // Continue anyway - payment method can still be used
        }
      }

      // Step 3: Call success callback
      onSuccess(paymentMethod.id);
      setLoading(false);
    } catch (err) {
      setError(err.message || 'An error occurred');
      setLoading(false);
      if (onError) onError(err);
    }
  };

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#424770',
        '::placeholder': {
          color: '#aab7c4',
        },
      },
      invalid: {
        color: '#9e2146',
      },
    },
  };

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <div className="form-group">
        <label>Card Details</label>
        <CardElement options={cardElementOptions} />
      </div>
      
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      <button 
        type="submit" 
        disabled={!stripe || loading}
        className="submit-button"
      >
        {loading ? 'Processing...' : 'Save Payment Method'}
      </button>
    </form>
  );
}

export default PaymentMethodForm;
```

### Step 3: Create Payment Method List Component

**`src/components/PaymentMethodList.jsx`**
```javascript
import React, { useState, useEffect } from 'react';

function PaymentMethodList({ onSelect, selectedId, showDelete = true }) {
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadPaymentMethods();
  }, []);

  const loadPaymentMethods = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('authToken'); // Adjust based on your auth system
      
      const response = await fetch('/api/payments/payment-methods', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to load payment methods');
      }

      setPaymentMethods(data.payment_methods || []);
      setError(null);
    } catch (err) {
      setError(err.message);
      setPaymentMethods([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (paymentMethodId) => {
    if (!window.confirm('Are you sure you want to delete this payment method?')) {
      return;
    }

    try {
      const token = localStorage.getItem('authToken');
      
      const response = await fetch(`/api/payments/payment-methods/${paymentMethodId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to delete payment method');
      }

      // Reload list
      loadPaymentMethods();
      
      // If deleted method was selected, clear selection
      if (selectedId === paymentMethodId && onSelect) {
        onSelect(null);
      }
    } catch (err) {
      alert('Error deleting payment method: ' + err.message);
    }
  };

  const getCardIcon = (brand) => {
    const icons = {
      visa: '💳',
      mastercard: '💳',
      amex: '💳',
      discover: '💳',
      jcb: '💳',
      diners: '💳',
      unionpay: '💳',
    };
    return icons[brand] || '💳';
  };

  if (loading) {
    return <div>Loading payment methods...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  if (paymentMethods.length === 0) {
    return <div>No saved payment methods</div>;
  }

  return (
    <div className="payment-methods-list">
      {paymentMethods.map((pm) => (
        <div 
          key={pm.id} 
          className={`payment-method-item ${selectedId === pm.id ? 'selected' : ''}`}
        >
          <label className="payment-method-label">
            <input
              type="radio"
              name="paymentMethod"
              value={pm.id}
              checked={selectedId === pm.id}
              onChange={() => onSelect && onSelect(pm.id)}
            />
            <div className="payment-method-details">
              <span className="card-icon">{getCardIcon(pm.card.brand)}</span>
              <span className="card-info">
                {pm.card.brand.toUpperCase()} •••• {pm.card.last4}
              </span>
              <span className="card-expiry">
                Expires {pm.card.exp_month}/{pm.card.exp_year}
              </span>
            </div>
          </label>
          
          {showDelete && (
            <button
              type="button"
              onClick={() => handleDelete(pm.id)}
              className="delete-button"
            >
              Delete
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default PaymentMethodList;
```

### Step 4: Create Complete Payment Flow Component

**`src/components/PaymentFlow.jsx`**
```javascript
import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '../config/stripe';
import PaymentMethodForm from './PaymentMethodForm';
import PaymentMethodList from './PaymentMethodList';

function PaymentFlow({ onPaymentMethodSelected, apiKey }) {
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [mode, setMode] = useState('select'); // 'select' or 'new'

  const handlePaymentMethodCreated = (paymentMethodId) => {
    setSelectedPaymentMethodId(paymentMethodId);
    setShowNewForm(false);
    setMode('select');
    if (onPaymentMethodSelected) {
      onPaymentMethodSelected(paymentMethodId);
    }
  };

  const handlePaymentMethodSelected = (paymentMethodId) => {
    setSelectedPaymentMethodId(paymentMethodId);
    if (onPaymentMethodSelected) {
      onPaymentMethodSelected(paymentMethodId);
    }
  };

  return (
    <div className="payment-flow">
      <h3>Select Payment Method</h3>

      {/* Tabs */}
      <div className="payment-tabs">
        <button
          className={mode === 'select' ? 'active' : ''}
          onClick={() => {
            setMode('select');
            setShowNewForm(false);
          }}
        >
          Saved Cards
        </button>
        <button
          className={mode === 'new' ? 'active' : ''}
          onClick={() => {
            setMode('new');
            setShowNewForm(true);
          }}
        >
          Add New Card
        </button>
      </div>

      {/* Saved Payment Methods */}
      {mode === 'select' && (
        <div className="saved-methods-section">
          <PaymentMethodList
            onSelect={handlePaymentMethodSelected}
            selectedId={selectedPaymentMethodId}
            showDelete={true}
          />
          
          <button
            type="button"
            onClick={() => {
              setMode('new');
              setShowNewForm(true);
            }}
            className="add-new-button"
          >
            + Add New Card
          </button>
        </div>
      )}

      {/* New Payment Method Form */}
      {mode === 'new' && (
        <div className="new-method-section">
          <Elements stripe={stripePromise}>
            <PaymentMethodForm
              onSuccess={handlePaymentMethodCreated}
              onError={(error) => {
                console.error('Payment method creation error:', error);
                alert('Error creating payment method: ' + error.message);
              }}
              saveToCustomer={true}
            />
          </Elements>
          
          <button
            type="button"
            onClick={() => {
              setMode('select');
              setShowNewForm(false);
            }}
            className="cancel-button"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Selected Payment Method Display */}
      {selectedPaymentMethodId && (
        <div className="selected-method-info">
          <p>✓ Payment method selected</p>
          <p className="method-id">ID: {selectedPaymentMethodId}</p>
        </div>
      )}
    </div>
  );
}

export default PaymentFlow;
```

---

## Using Payment Methods with API

### Example: Purchase Domains via API

**`src/services/apiService.js`**
```javascript
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://your-api.com';
const API_VERSION = 'v1';

class ApiService {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async purchaseDomains(domains, paymentMethodId) {
    const response = await fetch(`${API_BASE_URL}/api/${API_VERSION}/domains/purchase`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        domains: domains.map(d => ({
          domain: d.name,
          year: d.years.toString(),
          price: Math.round(d.price * 100), // Convert dollars to cents
        })),
        billing: {
          payment_method_id: paymentMethodId,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `API Error: ${response.status}`);
    }

    return data;
  }

  async purchaseMailboxes(numberOfMailboxes, paymentMethodId) {
    const response = await fetch(`${API_BASE_URL}/api/${API_VERSION}/mailboxes/purchase`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        numberOfMailboxes,
        billing: {
          payment_method_id: paymentMethodId,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `API Error: ${response.status}`);
    }

    return data;
  }

  async assignMailboxes(mailboxes) {
    const response = await fetch(`${API_BASE_URL}/api/${API_VERSION}/mailboxes/assign`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mailboxes: mailboxes.map(m => ({
          firstName: m.firstName,
          lastName: m.lastName,
          username: m.username,
          domain: m.domain,
          recoveryEmail: m.recoveryEmail, // Optional
        })),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `API Error: ${response.status}`);
    }

    return data;
  }

  async deleteMailboxes(mailboxIds) {
    const response = await fetch(`${API_BASE_URL}/api/${API_VERSION}/mailboxes/delete`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mailboxIds,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `API Error: ${response.status}`);
    }

    return data;
  }
}

export default ApiService;
```

### Example: Using the API Service

**`src/pages/PurchasePage.jsx`**
```javascript
import React, { useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '../config/stripe';
import PaymentFlow from '../components/PaymentFlow';
import ApiService from '../services/apiService';

function PurchasePage() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('apiKey') || '');
  const [paymentMethodId, setPaymentMethodId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const apiService = new ApiService(apiKey);

  const handlePurchase = async () => {
    if (!paymentMethodId) {
      alert('Please select a payment method');
      return;
    }

    if (!apiKey) {
      alert('Please enter your API key');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Example: Purchase 10 mailboxes
      const result = await apiService.purchaseMailboxes(10, paymentMethodId);
      setResult(result);
      alert('Purchase successful!');
    } catch (err) {
      setError(err.message);
      alert('Purchase failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="purchase-page">
      <h1>Purchase Mailboxes</h1>

      {/* API Key Input */}
      <div className="form-group">
        <label>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            localStorage.setItem('apiKey', e.target.value);
          }}
          placeholder="Enter your API key"
        />
      </div>

      {/* Payment Method Selection */}
      <Elements stripe={stripePromise}>
        <PaymentFlow
          onPaymentMethodSelected={setPaymentMethodId}
          apiKey={apiKey}
        />
      </Elements>

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={!paymentMethodId || !apiKey || loading}
        className="purchase-button"
      >
        {loading ? 'Processing...' : 'Purchase Mailboxes'}
      </button>

      {/* Results */}
      {result && (
        <div className="result success">
          <h3>Purchase Successful!</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      {error && (
        <div className="result error">
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}

export default PurchasePage;
```

---

## Error Handling

### Common Errors and Solutions

1. **"Stripe not loaded"**
   - Ensure Stripe.js is properly initialized
   - Check that publishable key is correct
   - Verify network connectivity

2. **"Payment method creation failed"**
   - Check card details are valid
   - Verify Stripe account is active
   - Check browser console for detailed errors

3. **"Failed to save payment method"**
   - Verify user is authenticated
   - Check backend endpoint is accessible
   - Verify user has a Stripe customer record

4. **"API Error: 401"**
   - Check API key is valid
   - Verify API key is active in database
   - Ensure API key belongs to the user

5. **"Payment requires action"**
   - Handle 3D Secure authentication
   - Use `stripe.handleCardAction()` for authentication
   - Retry payment after authentication

### 3D Secure Handling

If payment requires 3D Secure authentication:

```javascript
const handle3DSecure = async (paymentIntent) => {
  const { error: confirmError } = await stripe.confirmCardPayment(
    paymentIntent.client_secret,
    {
      payment_method: {
        card: cardElement,
        billing_details: {
          name: 'Customer Name',
        },
      },
    }
  );

  if (confirmError) {
    // Handle error
    console.error('3D Secure authentication failed:', confirmError);
  } else {
    // Payment succeeded
    console.log('Payment confirmed');
  }
};
```

---

## Testing

### Test Card Numbers

Use these test card numbers in development:

- **Success**: `4242 4242 4242 4242`
- **Requires Authentication**: `4000 0025 0000 3155`
- **Declined**: `4000 0000 0000 0002`

Use any future expiry date, any 3-digit CVC, and any ZIP code.

### Testing Checklist

- [ ] Stripe.js loads correctly
- [ ] Payment method form displays
- [ ] Can create payment method
- [ ] Payment method saves to customer
- [ ] Can retrieve saved payment methods
- [ ] Can select saved payment method
- [ ] Can delete payment method
- [ ] API calls work with payment method ID
- [ ] Error handling works correctly
- [ ] 3D Secure authentication works (if applicable)

---

## Summary

### What You Need to Do

1. **Install packages**: `@stripe/stripe-js` and `@stripe/react-stripe-js`
2. **Set up Stripe config**: Add publishable key to environment variables
3. **Create components**: PaymentMethodForm, PaymentMethodList, PaymentFlow
4. **Integrate with API**: Use payment method IDs in API calls
5. **Handle errors**: Implement proper error handling and user feedback

### Key Points

- Payment methods are stored on Stripe, not in your database
- Payment method IDs start with `pm_`
- Always attach payment methods to customers for reuse
- Use the backend endpoints to manage payment methods
- Pass `payment_method_id` in the `billing` object for API calls

### Backend Endpoints Summary

- `POST /api/payments/attach-payment-method` - Save payment method
- `GET /api/payments/payment-methods` - List saved payment methods
- `DELETE /api/payments/payment-methods/:id` - Delete payment method

### API Endpoints Summary

- `POST /api/v1/domains/purchase` - Purchase domains
- `POST /api/v1/mailboxes/purchase` - Purchase mailboxes
- `POST /api/v1/mailboxes/assign` - Assign mailboxes
- `DELETE /api/v1/mailboxes/:id` - Delete mailbox

All API endpoints require `X-API-Key` header and `payment_method_id` in billing object.

---

## Support

If you encounter issues:

1. Check browser console for errors
2. Verify Stripe keys are correct
3. Check backend logs for API errors
4. Ensure user authentication is working
5. Verify API key is valid and active

For backend issues, check the API documentation in `API_DOCUMENTATION.md`.

