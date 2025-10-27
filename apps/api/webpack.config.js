module.exports = function (options, webpack) {
  return {
    ...options,
    externals: {
      // Externalize native modules that don't work with webpack bundling
      'sharp': 'commonjs sharp',
      'fluent-ffmpeg': 'commonjs fluent-ffmpeg',
    },
  };
};
