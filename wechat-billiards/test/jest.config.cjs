module.exports = {
  rootDir: "../",
  testEnvironment: "jsdom",
  modulePathIgnorePatterns: ["<rootDir>/release/"],
  testMatch: [
    "<rootDir>/packages/**/*.test.ts",
    "<rootDir>/apps/**/*.test.ts",
    "<rootDir>/test/**/*.test.ts",
  ],
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          target: "es2022",
        },
      },
    ],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(jsoncrush|@tailuge/messaging|three))",
  ],
  moduleNameMapper: {
    "^@friend-billiards/core$": "<rootDir>/packages/core/src/index.ts",
    "^@friend-billiards/protocol$": "<rootDir>/packages/protocol/src/index.ts",
    "^three$": "<rootDir>/node_modules/three/build/three.module.js",
    "^@tailuge/messaging$":
      "<rootDir>/node_modules/@tailuge/messaging/dist/index.js",
    ".*GLTFLoader": "<rootDir>/third_party/billiards/test/mocks/gltfloader.ts",
    ".*GLTFExporter":
      "<rootDir>/third_party/billiards/test/mocks/gltfexporter.ts",
  },
};
