const supabase = require('../config/supabaseConfig'); 
const logger = require('../utils/winstonLogger');

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    logger.warn({
      message: 'Authorization token missing',
      context: {
        method: req.method,
        path: req.originalUrl
      }
    });
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      logger.warn({
        message: 'Invalid token or user not found',
        token,
        context: {
          method: req.method,
          path: req.originalUrl
        }
      });
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = data.user;

    // ✅ Attach a scoped logger with user_id included for downstream use
    req.logger = logger.child({ user_id: data.user.id });

    next();
  } catch (err) {
    logger.error({
      message: 'Error during token verification',
      error: err.message,
      context: {
        method: req.method,
        path: req.originalUrl
      }
    });
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

module.exports = authMiddleware;
