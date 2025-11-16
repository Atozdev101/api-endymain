const logger = require('../utils/winstonLogger');

const errorHandler = (err, req, res, next) => {
  const userId = req.user?.id || null; // Safely extract user_id

  // Optional: log the full request context (like method, path, etc.)
  const context = {
    method: req.method,
    path: req.originalUrl,
    stack: err.stack,
  };

  // Log error to Winston and Supabase with user_id
  logger.error(err.message, {
    context,
    user_id: userId,
  });

  // Console output (optional, for dev)
  console.error(err.stack);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};

module.exports = errorHandler;
