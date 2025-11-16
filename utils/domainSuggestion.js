module.exports.generateSuggestions = (keyword) => {
    const name = keyword.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const prefixes = ['my'];
    const suffixes = ['info'];
    const tlds = ['.com', '.net', '.org', '.co', '.info'];
  
    const variations = new Set();
    variations.add(name);
  
    prefixes.forEach((pre) => variations.add(`${pre}${name}`));
    suffixes.forEach((suf) => variations.add(`${name}${suf}`));
  
    const fullDomains = [];
    variations.forEach((variant) => {
      tlds.forEach((tld) => fullDomains.push(`${variant}${tld}`));
    });
  
    return fullDomains;
  };
  