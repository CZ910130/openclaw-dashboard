// Wrapper for backward compatibility with routes expecting utils/helpers.js
const utils = require('./utils');
module.exports = {
  toNum: utils.toNum,
  normalizeProvider: utils.normalizeProvider,
  normalizeModel: utils.normalizeModel,
  safePath: utils.safePath
};
