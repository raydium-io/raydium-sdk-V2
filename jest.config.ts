/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  // Use ts-jest as the default transformer for TypeScript files
  preset: "ts-jest",
  
  // Set the test environment to Node.js for backend projects
  testEnvironment: "node",

  // Custom resolver to handle TypeScript module resolution correctly
  resolver: "ts-jest-resolver",

  // Define the location and naming convention of test files
  testMatch: ["**/test/**/*.test.ts"],

  // Automatically clear and restore mocks between every test to ensure isolation
  clearMocks: true,
  restoreMocks: true,

  // Enable code coverage collection
  collectCoverage: true,
  
  // Directory where Jest should output coverage reports
  coverageDirectory: ".coverage",
  
  // Use V8 engine for better performance in coverage collection compared to Babel
  coverageProvider: "v8",
  
  // Specify files or directories to exclude from coverage reports
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "index.ts",
    "\\.test\\.ts$",
    "dist"
  ],

  // Provide detailed output for each individual test
  verbose: true,

  // Limit the number of workers to 50% of available CPU to maintain system stability
  maxWorkers: "50%",
};
