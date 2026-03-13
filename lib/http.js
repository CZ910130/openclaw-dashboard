// Wrapper for backward compatibility with routes expecting utils/http.js
const utils = require('./utils');
module.exports = {
  getClientIP: utils.getClientIP,
  setSecurityHeaders: utils.setSecurityHeaders,
  setSameSiteCORS: utils.setSameSiteCORS,
  sendJson: utils.sendJson,
  sendCompressed: utils.sendCompressed,
  httpsEnforcement: utils.httpsEnforcement
};
