// config/namecheapConfig.js

const config = {
    apiUser: process.env.NAMECHEAP_API_USER || 'atozadmin',
    apiKey: process.env.NAMECHEAP_API_KEY || '1319a87e27624240b01a098c4b9fe37b',
    userName: process.env.NAMECHEAP_USER_NAME || 'atozadmin',
    clientIp: process.env.NAMECHEAP_CLIENT_IP || '4.213.224.185',
    sandbox: process.env.NAMECHEAP_SANDBOX === 'true',
  };
  
  module.exports = config;
  