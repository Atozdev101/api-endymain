const axios = require('axios');
const config = require('../config/namecheapConfig');
const parseXML = require('../utils/xmlParser');
const logger = require('../utils/winstonLogger');
const NAMECHEAP_BASE_URL =  process.env.NAMECHEAP_BASE_URL || 'https://api.sandbox.namecheap.com/xml.response';
const {sendSlackMessage} = require('../config/slackConfig')

// Function to check domain availability
const getDomainAvailability = async (domains) => {
  const params = {
    ApiUser: config.apiUser,
    ApiKey: config.apiKey,
    UserName: config.userName,
    ClientIp: config.clientIp,
    Command: 'namecheap.domains.check',
    DomainList: domains.join(','),
  };

  try {
    const { data } = await axios.get(NAMECHEAP_BASE_URL, { params });
    console.log(data);
    const parsed = parseXML(data);
    const results = parsed?.ApiResponse?.CommandResponse?.DomainCheckResult;

    if (!results) {
      throw new Error('Invalid response structure for domain availability check.');
    }

    logger.info(`Checked domains: ${domains.join(', ')}`);
    return Array.isArray(results) ? results : [results];
  } catch (err) {
    logger.error(`❌ Domain availability check failed: ${err.message}`);
    return [];
  }
};

// Function to get TLD prices
const getTLDPrices = async (tlds = []) => {
  const pricingMap = {};

  for (const tld of tlds) {
    const productName = tld.replace('.', '').toUpperCase();

    try {
      const params = {
        ApiUser: config.apiUser,
        ApiKey: config.apiKey,
        UserName: config.userName,
        ClientIp: config.clientIp,
        Command: 'namecheap.users.getPricing',
        ProductType: 'DOMAIN',
        ProductCategory: 'REGISTER',
        ActionName: 'REGISTER',
        ProductName: productName,
      };

      const { data } = await axios.get(NAMECHEAP_BASE_URL, { params });
      const parsed = parseXML(data);
      const products = parsed?.ApiResponse?.CommandResponse?.UserGetPricingResult?.ProductType?.ProductCategory?.Product;

      if (!products) {
        throw new Error('Failed to fetch pricing data');
      }

      const product = Array.isArray(products)
        ? products.find(p => p?.['@_Name']?.toLowerCase() === productName.toLowerCase())
        : products;

      const priceList = Array.isArray(product?.Price) ? product.Price : [product?.Price];
      const oneYear = priceList.find(p => p['@_Duration'] === '1');

      if (oneYear) {
        pricingMap[tld] = {
          register: oneYear['@_Price'],
          renew: oneYear['@_YourPrice'] || oneYear['@_Price'],
        };
      }
    } catch (err) {
      logger.warn(`Failed to fetch pricing for ${tld}: ${err.message}`);
      pricingMap[tld] = { register: '12.99', renew: '12.99' }; // Default pricing if error occurs
    }
  }

  return pricingMap;
};

// Function to purchase a domain
const purchaseDomain = async (year, domainName) => {
  const params = {
    ApiUser: config.apiUser,
    ApiKey: config.apiKey,
    UserName: config.userName,
    ClientIp: config.clientIp,
    Command: 'namecheap.domains.create',
    DomainName: domainName,
    Years: year,
    
    // Registrant fields
    RegistrantFirstName: "Ayush",
    RegistrantLastName: "Baldota",
    RegistrantEmailAddress: "atozfreeup@gmail.com",
    RegistrantPhone: "+91.9004312271",
    RegistrantAddress1: "603/ Mahavir Phoenix, Bhandup West, Mumbai 78",
    RegistrantCity: "Mumbai",
    RegistrantStateProvince: "Maharashtra",
    RegistrantPostalCode: "400078",
    RegistrantCountry: "IN",
    RegistrantOrganizationName: "Atozfreeup",
  
    // Tech fields
    TechFirstName: "Ayush",
    TechLastName: "Baldota",
    TechEmailAddress: "atozfreeup@gmail.com",
    TechPhone: "+91.9004312271",
    TechAddress1: "603/ Mahavir Phoenix, Bhandup West, Mumbai 78",
    TechCity: "Mumbai",
    TechStateProvince: "Maharashtra",
    TechPostalCode: "400078",
    TechCountry: "IN",
  
    // Admin fields
    AdminFirstName: "Ayush",
    AdminLastName: "Baldota",
    AdminEmailAddress: "atozfreeup@gmail.com",
    AdminPhone: "+91.9004312271",
    AdminAddress1: "603/ Mahavir Phoenix, Bhandup West, Mumbai 78",
    AdminCity: "Mumbai",
    AdminStateProvince: "Maharashtra",
    AdminPostalCode: "400078",
    AdminCountry: "IN",
  
    // AuxBilling fields
    AuxBillingFirstName: "Ayush",
    AuxBillingLastName: "Baldota",
    AuxBillingEmailAddress: "atozfreeup@gmail.com",
    AuxBillingPhone: "+91.9004312271",
    AuxBillingAddress1: "603/ Mahavir Phoenix, Bhandup West, Mumbai 78",
    AuxBillingCity: "Mumbai",
    AuxBillingStateProvince: "Maharashtra",
    AuxBillingPostalCode: "400078",
    AuxBillingCountry: "IN",
  };
  

  try {
    const { data } = await axios.get(NAMECHEAP_BASE_URL, { params });
    const parsed = parseXML(data);
    const errors = parsed?.ApiResponse?.Errors;

    if (errors) {
      const errorMessage = errors[0]?.Message || 'Unknown error during domain registration.';
      logger.error(`❌ Domain registration failed for ${domainName}: ${errorMessage}`);

      // 🔔 Send Slack Alert
      await sendSlackMessage(`❌ *Domain Registration Failed* for \`${domainName}\`\n*Error:* ${errorMessage}`,'ERROR');

      throw new Error(errorMessage);
    }

    const domainStatus = parsed?.ApiResponse?.CommandResponse?.DomainCreateResult?.Domain;

    // Return domain details if registration is successful
    logger.info(`✅ Domain registered successfully: ${domainName}`);
    return {
      success: true,
      domain: domainStatus,
    };
  } catch (err) {
    logger.error(`❌ Domain registration failed for ${domainName}: ${err.message}`);
    return {
      success: false,
      message: err.message,
    };
  }
};

module.exports = { getDomainAvailability, getTLDPrices, purchaseDomain };
