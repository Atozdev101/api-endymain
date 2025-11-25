/**
 * Helper script to generate API keys
 * 
 * Usage:
 *   node generate-api-key.js <user-id> [key-name]
 * 
 * Example:
 *   node generate-api-key.js 123e4567-e89b-12d3-a456-426614174000 "My API Key"
 * 
 * This will generate a secure API key and provide the SQL to insert it.
 * You'll need to run the SQL in your Supabase SQL editor.
 */

const crypto = require('crypto');

function generateApiKey() {
  // Generate a secure random API key (64 characters)
  return crypto.randomBytes(32).toString('hex');
}

function generateUUID() {
  // Generate UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node generate-api-key.js <user-id> [key-name]');
  console.error('');
  console.error('Example:');
  console.error('  node generate-api-key.js 123e4567-e89b-12d3-a456-426614174000 "My API Key"');
  process.exit(1);
}

const userId = args[0];
const keyName = args[1] || 'API Key';
const apiKey = generateApiKey();
const keyId = generateUUID();

// Generate SQL insert statement
const sql = `
-- Insert API Key for user ${userId}
-- Key Name: ${keyName}
-- Generated at: ${new Date().toISOString()}

INSERT INTO api_keys (id, user_id, api_key, name, is_active, created_at)
VALUES (
  '${keyId}',
  '${userId}',
  '${apiKey}',
  '${keyName}',
  true,
  NOW()
);
`;

console.log('\n✅ API Key Generated Successfully!\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('API Key ID:', keyId);
console.log('User ID:', userId);
console.log('Key Name:', keyName);
console.log('API Key:', apiKey);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📋 SQL INSERT Statement:\n');
console.log(sql);
console.log('\n⚠️  IMPORTANT:');
console.log('   1. Copy the SQL statement above');
console.log('   2. Run it in your Supabase SQL editor');
console.log('   3. Save the API key securely - you won\'t be able to see it again!');
console.log('   4. Use this API key in the X-API-Key header for API requests\n');

