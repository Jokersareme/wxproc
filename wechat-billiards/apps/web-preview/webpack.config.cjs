const path = require("node:path")
const webpack = require("webpack")
const CopyPlugin = require("copy-webpack-plugin")

module.exports = {
  mode: "development",
  entry: path.resolve(__dirname, "src/main.ts"),
  output: { path: path.resolve(__dirname, "dist"), filename: "game.js", clean: true },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: { loader: "swc-loader", options: { jsc: { parser: { syntax: "typescript" }, target: "es2020" } } },
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
  plugins: [
    new CopyPlugin({ patterns: [{ from: path.resolve(__dirname, "public"), to: "." }] }),
    new webpack.DefinePlugin({ __SOURCE_URL__: JSON.stringify(process.env.SOURCE_URL ?? "") }),
  ],
  devServer: {
    static: path.resolve(__dirname, "public"),
    host: "0.0.0.0",
    port: 8081,
    hot: false,
    proxy: [{ context: ["/ws"], target: "ws://localhost:8080", ws: true }],
  },
  performance: { hints: false },
  experiments: { typescript: false },
}
