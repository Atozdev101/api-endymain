const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');

/**
 * Middleware to authenticate requests using API keys
 * Expects API key in X-API-Key header or Authorization: Bearer <api_key>
 */
const apiKeyMiddleware = async (req, res, next) => {
  try {
    // Get API key from header (X-API-Key or Authorization Bearer)
    const apiKey = req.headers['x-api-key'] || 
                   req.headers['X-API-Key'] ||
                   (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

    if (!apiKey) {
      logger.warn({
        message: 'API key missing',
        context: {
          method: req.method,
          path: req.originalUrl,
          ip: req.ip
        }
      });
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'API key is required. Provide it in X-API-Key header or Authorization: Bearer <key>'
      });
    }

    // Fetch API key from database
    const { data: apiKeyData, error } = await db
      .from('api_keys')
      .select('user_id, is_active, name')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (error || !apiKeyData) {
      logger.warn({
        message: 'Invalid or inactive API key',
        context: {
          method: req.method,
          path: req.originalUrl,
          ip: req.ip
        }
      });
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid or inactive API key'
      });
    }

    // Update last_used_at timestamp
    await db
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('api_key', apiKey);

    // Fetch user data to attach to request
    const { data: userData, error: userError } = await db
      .from('users')
      .select('id, email')
      .eq('id', apiKeyData.user_id)
      .single();

    if (userError || !userData) {
      logger.error({
        message: 'User not found for API key',
        context: {
          user_id: apiKeyData.user_id,
          api_key_name: apiKeyData.name
        }
      });
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'User associated with API key not found'
      });
    }

    // Attach user to request (similar to authMiddleware)
    req.user = {
      id: userData.id,
      email: userData.email
    };

    // Attach scoped logger
    req.logger = logger.child({ user_id: userData.id, api_key: true });

    next();
  } catch (err) {
    logger.error({
      message: 'Error during API key verification',
      error: err.message,
      context: {
        method: req.method,
        path: req.originalUrl
      }
    });
    return res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Error verifying API key'
    });
  }
};

module.exports = apiKeyMiddleware;

