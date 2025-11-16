const { createLogger, format, transports } = require('winston');
const path = require('path');
const supabaseLogTransport = require('./supabaseLogTransport');
const supabase  = require('../config/supabaseConfig');

// Detect environment
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV;

// Format logs
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.colorize(), // Add colorization to the log levels
  format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level}: ${message}`;
  })
);

// Configure transports based on environment
const logTransports = [
  new transports.Console(),
  new supabaseLogTransport({ level: 'info', supabase })
];

// Only add file transports in development
if (!isProduction) {
  logTransports.push(
    new transports.File({ filename: path.join(__dirname, '../logs/error.log'), level: 'error' }),
    new transports.File({ filename: path.join(__dirname, '../logs/combined.log') })
  );
}

// Configure exception handlers based on environment
const exceptionHandlers = [
  new transports.Console() // ✅ Console output for uncaught exceptions
];

// Only add file exception handler in development
if (!isProduction) {
  exceptionHandlers.push(
    new transports.File({ filename: path.join(__dirname, '../logs/exceptions.log') })
  );
}

// Create logger
const logger = createLogger({
  level: 'http',
  format: logFormat,
  transports: logTransports,
  exceptionHandlers: exceptionHandlers
});

module.exports = logger;


// for example use like this
// if (!token) {
//   logger.warn({
//     message: 'Authorization token missing',
//     context: {
//       method: req.method,
//       path: req.originalUrl
//     }
//   });
//   return res.status(401).json({ message: 'Unauthorized' });
// }
