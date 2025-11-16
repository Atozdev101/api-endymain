// helpers/xmlParser.js
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false });

const parseXML = (xmlString) => {
  try {
    return parser.parse(xmlString);
  } catch (error) {
    console.error('Failed to parse XML:', error.message);
    return null;
  }
};

module.exports = parseXML;
