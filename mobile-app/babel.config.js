// NativeWind v4 requires the JSX import source to be rewritten so that
// `className` on core RN primitives is compiled into style props.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};