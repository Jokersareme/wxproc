const path = require("node:path")
const webpack = require("webpack")
const TerserPlugin = require("terser-webpack-plugin")
const CopyPlugin = require("copy-webpack-plugin")

module.exports = {
  entry: path.resolve(__dirname, "src/main.ts"),
  target: ["web", "es2020"],
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "game.js",
    clean: true,
    iife: true,
    globalObject: "globalThis",
  },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules\/(?!(three|@tailuge\/messaging|jsoncrush))/,
      use: { loader: "swc-loader", options: { jsc: { parser: { syntax: "typescript" } }, env: { targets: { ios: "12" } } } },
    }],
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      "@friend-billiards/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@friend-billiards/protocol": path.resolve(__dirname, "../../packages/protocol/src/index.ts"),
      "@friend-billiards/client": path.resolve(__dirname, "../../packages/client/src/index.ts"),
    },
  },
  plugins: [new webpack.DefinePlugin({
    __CLOUD_ENV_ID__: JSON.stringify(process.env.CLOUDBASE_ENV_ID ?? ""),
    __CLOUD_SERVICE__: JSON.stringify(process.env.CLOUDBASE_SERVICE ?? "hc-billiards"),
    __SOURCE_URL__: JSON.stringify(process.env.SOURCE_URL ?? ""),
    __LOCAL_SERVER_URL__: JSON.stringify(process.env.LOCAL_SERVER_URL ?? "ws://127.0.0.1:8080/ws"),
  }), new CopyPlugin({
    patterns: [{
      from: path.resolve(__dirname, "../../third_party/billiards/dist/sounds"),
      to: "sounds",
    }],
  })],
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin({ minify: TerserPlugin.swcMinify, extractComments: false })],
  },
  performance: { hints: false },
  experiments: { typescript: false },
}
