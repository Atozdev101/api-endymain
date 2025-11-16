const logger = require('../utils/winstonLogger');

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMessage = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
    logger.http(logMessage);
  });

  next();
};

module.exports = requestLogger;
