const { getDefaultConfig } = require('expo/metro-config');
const { disableTypes } = require('image-size');

// image-size has no patched release for GHSA-w3rx-r6r6-pgpr or
// GHSA-5p2g-fcmc-qvqq. Metro never needs these formats for this app.
disableTypes(['heif', 'icns', 'jxl', 'jxl-stream']);

module.exports = getDefaultConfig(__dirname);
