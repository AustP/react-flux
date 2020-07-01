module.exports = {
  entry: './build/src/flux.js',
  externals: ['react'],
  mode: 'production',
  output: {
    filename: 'flux.min.js',
    library: 'flux',
    libraryTarget: 'umd',
  },
};
