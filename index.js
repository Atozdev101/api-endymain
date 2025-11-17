require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/logger');
const logger = require('./utils/winstonLogger');
const bodyParser = require('body-parser');

const stripeWebhookController = require('./controllers/stripeWebhookController');
const app = express(); 
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), stripeWebhookController.handleStripeWebhook);

// Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: true, // Allow all origins
  credentials: true
}));
app.use(express.json());



app.use(requestLogger);
app.use((req, res, next) => {
  if (!req.logger) {
    req.logger = logger.child({ user_id: null });
  }
  next();
});
// Routes
const userRoutes = require('./routes/userRoutes');
const domainRoutes = require('./routes/domainRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const walletRoutes = require('./routes/walletRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const mailboxRoutes = require('./routes/mailboxRoutes');
const prewarmMailboxRoutes = require('./routes/prewarmMailboxRoutes');
const supportRoutes = require('./routes/supportRoutes');
// const dnsRoutes = require('./routes/dnsRoutes');

app.use('/api/users', userRoutes);
app.use('/api/domains', domainRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/mailboxes', mailboxRoutes);
app.use('/api/prewarm-mailboxes', prewarmMailboxRoutes);
app.use('/api/support', supportRoutes);
// app.use('/api/dns', dnsRoutes);

// Health Check
app.get('/health', (_, res) => res.send({ status: 'OK', timestamp: Date.now() }));
app.get('/', (req, res) => {
  res.send('Welcome to the AtoZ Email Service!');
});


// Error Handler
app.use(errorHandler);

// Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 V.37 Server running on http://0.0.0.0:${PORT}`);
  console.log(`   Accessible from: http://localhost:${PORT} or http://<your-ip>:${PORT}`);
});
